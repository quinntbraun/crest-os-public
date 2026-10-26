import 'server-only';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {createExportPartCodec,parseExportPartBinding,exportPartObjectKey,maximumExportPartBytes,maximumEncryptedExportPartBytes} from '../security/export-part-crypto.ts';
import type {ExportPartBinding,EncryptedExportPart} from '../security/export-part-crypto.ts';

export type ExportPartIntent=Readonly<{
 formatVersion:1;objectKey:string;keyId:string;plaintextBytes:number;plaintextSha256:string;ciphertextBytes:number;ciphertextSha256:string;
}>;
type Failure='EXPORT_OBJECT_REVIEW_REQUIRED'|'EXPORT_OBJECT_WRITE_UNCERTAIN'|'EXPORT_OBJECT_EXISTS';
export class ExportObjectError extends Error{readonly code:Failure;constructor(code:Failure='EXPORT_OBJECT_REVIEW_REQUIRED'){super(code);this.name='ExportObjectError';this.code=code;}}
function require(value:unknown):asserts value{if(!value)throw new ExportObjectError();}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),hash=/^[a-f0-9]{64}$/;
const fields=['formatVersion','objectKey','keyId','plaintextBytes','plaintextSha256','ciphertextBytes','ciphertextSha256'];
function exact(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));}
function intent(value:unknown,binding:ExportPartBinding):ExportPartIntent{
 require(exact(value)&&value.formatVersion===1&&value.objectKey===exportPartObjectKey(binding)&&typeof value.keyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value.keyId)
  &&typeof value.plaintextBytes==='number'&&Number.isSafeInteger(value.plaintextBytes)&&value.plaintextBytes>=1&&value.plaintextBytes<=maximumExportPartBytes
  &&typeof value.ciphertextBytes==='number'&&Number.isSafeInteger(value.ciphertextBytes)&&value.ciphertextBytes>=1&&value.ciphertextBytes<=maximumEncryptedExportPartBytes
  &&typeof value.plaintextSha256==='string'&&hash.test(value.plaintextSha256)&&typeof value.ciphertextSha256==='string'&&hash.test(value.ciphertextSha256));
 return Object.freeze({...value}) as ExportPartIntent;
}
function bucketName(value:string){require(typeof value==='string'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value));}
const check=(signal:AbortSignal)=>require(!signal.aborted);

// Mechanism only: no owner authorization, queue lease, Ready transition,
// public/signed GET, overwrite, delete/list, worker dispatch or retry policy.
// The caller records the complete immutable intent BEFORE attempting a PUT.
export async function createEncryptedExportPartStore(client:S3Client,bucket:string,activeKeyId:string,keys:ReadonlyArray<Readonly<{id:string;key:Uint8Array}>>,timeoutMs=60000){
 bucketName(bucket);require(client instanceof S3Client&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=60000);
 const codec=await createExportPartCodec(activeKeyId,keys);
 const prepared=new WeakMap<object,{binding:ExportPartBinding;record:EncryptedExportPart;intent:ExportPartIntent;attempted:boolean}>();
 const deadline=(external:AbortSignal)=>AbortSignal.any([external,AbortSignal.timeout(timeoutMs)]);
 async function noRetries(signal:AbortSignal){
  let aborted:()=>void=()=>{};
  const interruption=new Promise<never>((_,reject)=>{aborted=()=>reject(new ExportObjectError());signal.addEventListener('abort',aborted,{once:true});});
  try{check(signal);require(await Promise.race([client.config.maxAttempts(),interruption])===1);check(signal);}
  finally{signal.removeEventListener('abort',aborted);}
 }
 async function encryptedRead(expected:ExportPartIntent,signal:AbortSignal):Promise<Uint8Array>{
  let body:Readable|undefined;const abort=()=>body?.destroy(new ExportObjectError());
  try{
   check(signal);await noRetries(signal);check(signal);
   const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:expected.objectKey}),{abortSignal:signal});
   require(response.Body instanceof Readable);body=response.Body;signal.addEventListener('abort',abort,{once:true});check(signal);
   require(response.ContentLength===expected.ciphertextBytes&&response.ContentType==='application/jose+json');
   const chunks:Buffer[]=[],sha=createHash('sha256');let size=0;
   for await(const chunk of body){check(signal);require(chunk instanceof Uint8Array);size+=chunk.byteLength;require(size<=expected.ciphertextBytes&&size<=maximumEncryptedExportPartBytes);sha.update(chunk);chunks.push(Buffer.from(chunk));}
   check(signal);require(size===expected.ciphertextBytes&&sha.digest('hex')===expected.ciphertextSha256);return Buffer.concat(chunks,size);
  }finally{signal.removeEventListener('abort',abort);body?.destroy();}
 }
 async function read(raw:ExportPartIntent,rawBinding:ExportPartBinding,external:AbortSignal){
  let opened:Awaited<ReturnType<typeof codec.decrypt>>|undefined;
  try{
   const binding=parseExportPartBinding(rawBinding),expected=intent(raw,binding),signal=deadline(external);check(signal);
   const ciphertext=await encryptedRead(expected,signal);opened=await codec.decrypt({keyId:expected.keyId,ciphertext},binding,signal);
   const value=opened.metadataForServer();require(value.byteSize===expected.plaintextBytes&&value.sha256===expected.plaintextSha256);check(signal);return opened;
  }catch{opened?.dispose();throw new ExportObjectError();}
 }
 return Object.freeze({
  async prepare(source:Uint8Array,rawBinding:ExportPartBinding,external:AbortSignal){
   let bytes:Buffer|undefined;
   try{
    const signal=deadline(external);check(signal);const binding=parseExportPartBinding(rawBinding);
    require(source instanceof Uint8Array&&source.byteLength>=1&&source.byteLength<=maximumExportPartBytes);bytes=Buffer.from(source);
    const plaintextBytes=bytes.length,plaintextSha256=digest(bytes),record=await codec.encrypt(bytes,binding,signal);check(signal);
    const expected:ExportPartIntent=Object.freeze({formatVersion:1,objectKey:exportPartObjectKey(binding),keyId:record.keyId,plaintextBytes,plaintextSha256,ciphertextBytes:record.ciphertext.byteLength,ciphertextSha256:digest(record.ciphertext)});
    const sealed=Object.freeze({intentForServer:()=>expected,toJSON():never{throw new ExportObjectError();}});
    prepared.set(sealed,{binding,record,intent:expected,attempted:false});return sealed;
   }catch{throw new ExportObjectError();}
   finally{bytes?.fill(0);}
  },
  async writeCandidate(sealed:object,external:AbortSignal):Promise<ExportPartIntent>{
   let attempting=false;
   try{
    const candidate=prepared.get(sealed),signal=deadline(external);check(signal);require(candidate&&!candidate.attempted);await noRetries(signal);check(signal);require(!candidate.attempted);
    candidate.attempted=true;attempting=true;
    await client.send(new PutObjectCommand({Bucket:bucket,Key:candidate.intent.objectKey,Body:candidate.record.ciphertext,ContentLength:candidate.intent.ciphertextBytes,ContentType:'application/jose+json',CacheControl:'no-store',ContentDisposition:'attachment',IfNoneMatch:'*'}),{abortSignal:signal});
    attempting=false;check(signal);const opened=await read(candidate.intent,candidate.binding,signal);opened.dispose();check(signal);return candidate.intent;
   }catch(error){
    if(attempting&&error&&typeof error==='object'&&'$metadata' in error&&(error.$metadata as {httpStatusCode?:number})?.httpStatusCode===412)throw new ExportObjectError('EXPORT_OBJECT_EXISTS');
    throw new ExportObjectError(attempting?'EXPORT_OBJECT_WRITE_UNCERTAIN':'EXPORT_OBJECT_REVIEW_REQUIRED');
   }
  },
  // Reconcile the ORIGINAL recorded ciphertext intent after an uncertain PUT.
  // Absence/read failure never grants permission to retry or choose new bytes.
  async verifyCandidate(expected:ExportPartIntent,binding:ExportPartBinding,external:AbortSignal):Promise<ExportPartIntent>{
   try{const verified=intent(expected,parseExportPartBinding(binding)),opened=await read(verified,binding,external);opened.dispose();return verified;}catch{throw new ExportObjectError();}
  },
  readVerified:read
 });
}

// Production composition has one fixed verified HTTPS provider endpoint and
// explicit credentials; the SDK seam above is for trusted server/tests only.
export async function createR2EncryptedExportPartStore(config:{accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string;activeKeyId:string;keys:ReadonlyArray<Readonly<{id:string;key:Uint8Array}>>}){
 require(typeof config.accountId==='string'&&/^[a-f0-9]{32}$/.test(config.accountId)&&[config.accessKeyId,config.secretAccessKey].every(v=>typeof v==='string'&&v.length>=16&&v.length<=512&&!Array.from(v).some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127||/\s/.test(c))));bucketName(config.bucket);
 const client=new S3Client({region:'auto',endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:{connectionTimeout:5000,requestTimeout:60000,throwOnRequestTimeout:true}});
 try{return Object.freeze({store:await createEncryptedExportPartStore(client,config.bucket,config.activeKeyId,config.keys),close:()=>client.destroy()});}
 catch(error){client.destroy();throw error;}
}
