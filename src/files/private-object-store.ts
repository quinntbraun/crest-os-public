import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export const maximumFileBytes=25*1024*1024;
export const uploadLifetimeSeconds=600;
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const businessPattern=new RegExp(`^${uuid}$`);
const stagingPattern=new RegExp(`^staging/${uuid}/${uuid}/${uuid}$`);
const originalPattern=new RegExp(`^originals/${uuid}/${uuid}$`);
const previewPattern=new RegExp(`^previews/${uuid}/${uuid}$`);
const contentTypes=new Set(['image/jpeg','image/png','image/heic','application/pdf']);
type Failure='OBJECT_INPUT_INVALID'|'OBJECT_STORAGE_FAILED'|'OBJECT_BYTES_MISMATCH'|'OBJECT_TOO_LARGE'
  |'OBJECT_ABORTED'|'OBJECT_TIMEOUT'|'OBJECT_KEY_EXISTS'|'OBJECT_WRITE_UNCERTAIN';
export class PrivateObjectError extends Error {
  readonly code:Failure;
  constructor(code:Failure){super(code);this.name='PrivateObjectError';this.code=code;}
}
function fail(code:Failure):never{throw new PrivateObjectError(code);}
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function validSize(value:number){if(!Number.isSafeInteger(value)||value<1||value>maximumFileBytes)fail('OBJECT_INPUT_INVALID');}
function validType(value:string){if(!contentTypes.has(value))fail('OBJECT_INPUT_INVALID');}
function validBusiness(value:string){if(!businessPattern.test(value))fail('OBJECT_INPUT_INVALID');}
function validBucket(value:string){
  if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value))fail('OBJECT_INPUT_INVALID');
}
function guardSignal(signal:AbortSignal){
  if(signal.aborted)fail(signal.reason?.name==='TimeoutError'?'OBJECT_TIMEOUT':'OBJECT_ABORTED');
}
function storageFailure(error:unknown,signal:AbortSignal):never{
  guardSignal(signal);
  if(error instanceof PrivateObjectError)throw error;
  // SDK exceptions can carry credential-bearing URLs/request details. Never forward them.
  return fail('OBJECT_STORAGE_FAILED');
}

class UploadCapability {
  #url:string;
  readonly contentType:string;
  constructor(url:string,contentType:string){this.#url=url;this.contentType=contentType;Object.freeze(this);}
  // Explicit handoff to an authorized upload response; never log or persist this bearer URL.
  forUpload(){return {url:this.#url,method:'PUT' as const,headers:{'content-type':this.contentType},expiresInSeconds:uploadLifetimeSeconds};}
  toJSON():never{return fail('OBJECT_INPUT_INVALID');}
}
export type ObjectDigest=Readonly<{key:string;byteSize:number;sha256:string}>;
export function newOriginalKey(businessId:string){validBusiness(businessId);return `originals/${businessId}/${randomUUID()}`;}
export function newPreviewKey(businessId:string){validBusiness(businessId);return `previews/${businessId}/${randomUUID()}`;}

// Only the trusted server composition root supplies credentials. No ambient AWS credentials,
// arbitrary URL, public bucket hostname, browser configuration or automatic write retry.
export function createR2ObjectStore(config:{accountId:string;bucket:string;accessKeyId:string;secretAccessKey:string}){
  if(!/^[a-f0-9]{32}$/.test(config.accountId)
    ||![config.accessKeyId,config.secretAccessKey].every(v=>typeof v==='string'&&v.length>=16&&v.length<=512
      &&!Array.from(v).some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127||/\s/.test(c))))fail('OBJECT_INPUT_INVALID');
  validBucket(config.bucket);
  const client=new S3Client({region:'auto',endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},forcePathStyle:true,maxAttempts:1,
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
    requestHandler:{connectionTimeout:5000,requestTimeout:60000,throwOnRequestTimeout:true}});
  return {store:createPrivateObjectStore(client,config.bucket),close:()=>client.destroy()};
}

// Storage mechanics only. This does NOT authorize a parent, validate a file format,
// claim a lease/recovery fence, or transition an attachment to Available.
// The explicit client seam also supports native SDK/HTTP fault tests without a cloud account.
export function createPrivateObjectStore(client:S3Client,bucket:string,timeoutMs=60000){
  validBucket(bucket);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)fail('OBJECT_INPUT_INVALID');
  const deadline=(signal?:AbortSignal)=>AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
  async function read(key:string,expectedSize:number,signal:AbortSignal,collect:boolean){
    guardSignal(signal);
    let body:Readable|undefined;
    const abort=()=>body?.destroy(new PrivateObjectError(signal.reason?.name==='TimeoutError'?'OBJECT_TIMEOUT':'OBJECT_ABORTED'));
    try{
      const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:signal});
      const stream=response.Body,length=response.ContentLength;
      if(!(stream instanceof Readable))throw new PrivateObjectError('OBJECT_STORAGE_FAILED');
      body=stream;
      signal.addEventListener('abort',abort,{once:true});
      guardSignal(signal);
      if(typeof length!=='number'||!Number.isSafeInteger(length)||length<1)throw new PrivateObjectError('OBJECT_BYTES_MISMATCH');
      if(length>maximumFileBytes)fail('OBJECT_TOO_LARGE');
      if(length!==expectedSize)fail('OBJECT_BYTES_MISMATCH');
      let byteSize=0;const sha=createHash('sha256'),chunks:Buffer[]=[];
      for await(const chunk of stream){
        guardSignal(signal);
        if(!(chunk instanceof Uint8Array))fail('OBJECT_STORAGE_FAILED');
        byteSize+=chunk.byteLength;
        if(byteSize>maximumFileBytes)fail('OBJECT_TOO_LARGE');
        if(byteSize>expectedSize)fail('OBJECT_BYTES_MISMATCH');
        sha.update(chunk);
        if(collect)chunks.push(Buffer.from(chunk));
      }
      guardSignal(signal);
      if(byteSize!==expectedSize)fail('OBJECT_BYTES_MISMATCH');
      return {key,byteSize,sha256:sha.digest('hex'),bytes:collect?Buffer.concat(chunks,byteSize):undefined};
    }catch(error){return storageFailure(error,signal);}
    finally{signal.removeEventListener('abort',abort);body?.destroy();}
  }
  async function writeCandidate(input:{key:string;bytes:Uint8Array;sha256:string;contentType:string},signal?:AbortSignal):Promise<ObjectDigest>{
    // Seal before the first await; mutable callers cannot replace verified bytes.
    const bytes=Buffer.from(input.bytes),sha256=hash(bytes),key=input.key;
    if(sha256!==input.sha256)fail('OBJECT_BYTES_MISMATCH');
    const bounded=deadline(signal);guardSignal(bounded);
    try{
      await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentLength:bytes.length,
        ContentType:input.contentType,CacheControl:'no-store',IfNoneMatch:'*'}),{abortSignal:bounded});
    }catch(error){
      if(error&&typeof error==='object'&&'$metadata' in error
        &&(error.$metadata as {httpStatusCode?:number})?.httpStatusCode===412)fail('OBJECT_KEY_EXISTS');
      // A timeout/connection loss may follow a committed PUT. Keep the recorded key
      // for reconciliation; never infer absence, overwrite, delete, or retry here.
      return fail('OBJECT_WRITE_UNCERTAIN');
    }
    const verified=await read(key,bytes.length,bounded,false);
    if(verified.sha256!==sha256)fail('OBJECT_BYTES_MISMATCH');
    return Object.freeze({key,byteSize:verified.byteSize,sha256});
  }
  return Object.freeze({
    async issueStagingUpload(input:{businessId:string;attemptId:string;byteSize:number;contentType:string}){
      validBusiness(input.businessId);validBusiness(input.attemptId);validSize(input.byteSize);validType(input.contentType);
      const key=`staging/${input.businessId}/${input.attemptId}/${randomUUID()}`;
      try{
        const url=await getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:input.contentType}),
          {expiresIn:uploadLifetimeSeconds,signableHeaders:new Set(['content-type'])});
        // PUT signing deliberately does not claim a hard byte-size restriction.
        return {key,expectedByteSize:input.byteSize,declaredType:input.contentType,capability:new UploadCapability(url,input.contentType)};
      }catch{return fail('OBJECT_STORAGE_FAILED');}
    },
    async readStaging(key:string,expectedSize:number,signal?:AbortSignal){
      if(!stagingPattern.test(key))fail('OBJECT_INPUT_INVALID');validSize(expectedSize);
      const result=await read(key,expectedSize,deadline(signal),true);
      if(!result.bytes)fail('OBJECT_STORAGE_FAILED');
      return {...result,bytes:result.bytes};
    },
    async writeOriginalCandidate(input:{key:string;bytes:Uint8Array;sha256:string;contentType:string},signal?:AbortSignal):Promise<ObjectDigest>{
      if(!originalPattern.test(input.key)||!(input.bytes instanceof Uint8Array)||!/^[a-f0-9]{64}$/.test(input.sha256))fail('OBJECT_INPUT_INVALID');
      validSize(input.bytes.byteLength);validType(input.contentType);
      return writeCandidate(input,signal);
    },
    async writePreviewCandidate(input:{key:string;bytes:Uint8Array;sha256:string;contentType:'image/jpeg'},signal?:AbortSignal):Promise<ObjectDigest>{
      if(!previewPattern.test(input.key)||!(input.bytes instanceof Uint8Array)||!/^[a-f0-9]{64}$/.test(input.sha256)
        ||input.contentType!=='image/jpeg'||input.bytes.byteLength>8*1024*1024)fail('OBJECT_INPUT_INVALID');
      validSize(input.bytes.byteLength);
      return writeCandidate(input,signal);
    }
  });
}
