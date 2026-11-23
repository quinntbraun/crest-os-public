// Isolated recovery tooling, never imported by web/worker composition. Accepts
// already age-encrypted files only; no plaintext, decryption key or ambient AWS
// credential. A versioned artifact is not a complete recovery point.
import {createHash} from 'node:crypto';
import {open,unlink} from 'node:fs/promises';
import {S3Client,GetObjectCommand,GetObjectRetentionCommand,PutObjectCommand} from '@aws-sdk/client-s3';

const maximumBytes=1024*1024*1024,header=Buffer.from('age-encryption.org/v1\n');
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const keyPattern=new RegExp(`^recovery/${uuid}/artifacts/${uuid}\\.age$`);
export type RecoveryVaultArtifact=Readonly<{key:string;versionId:string;byteSize:number;sha256:string;retainUntil:string}>;
export class RecoveryVaultError extends Error{
 readonly code:'RECOVERY_VAULT_INPUT_REQUIRED'|'RECOVERY_VAULT_READ_FAILED'|'RECOVERY_VAULT_WRITE_UNCERTAIN';
 constructor(code:RecoveryVaultError['code']){super(code);this.name='RecoveryVaultError';this.code=code;}
}
function require(value:unknown):asserts value{if(!value)throw new RecoveryVaultError('RECOVERY_VAULT_INPUT_REQUIRED');}
const controlOrSpace=(value:string)=>Array.from(value).some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127||/\s/.test(c));
function validVersion(value:unknown):asserts value is string{require(typeof value==='string'&&value.length>=1&&value.length<=1024&&value!=='null'&&!controlOrSpace(value));}
function validDate(value:string){const date=new Date(value);require(Number.isFinite(date.getTime())&&date.toISOString()===value);return date;}
function validArtifact(value:RecoveryVaultArtifact){
 require(value&&Object.keys(value).sort().join(',')==='byteSize,key,retainUntil,sha256,versionId'&&keyPattern.test(value.key));
 validVersion(value.versionId);validDate(value.retainUntil);require(Number.isSafeInteger(value.byteSize)&&value.byteSize>=header.length&&value.byteSize<=maximumBytes&&/^[a-f0-9]{64}$/.test(value.sha256));
}
export function recoveryVaultArtifactKey(pointId:string,artifactId:string){const key=`recovery/${pointId}/artifacts/${artifactId}.age`;require(keyPattern.test(key));return key;}

export type B2RecoveryVaultConfiguration=Readonly<{region:string;bucket:string;accessKeyId:string;secretAccessKey:string}>;
export function createB2RecoveryVault(config:B2RecoveryVaultConfiguration){
 require(config&&/^[a-z]{2}-[a-z]+-[0-9]{3}$/.test(config.region));
 require([config.accessKeyId,config.secretAccessKey].every(value=>typeof value==='string'&&value.length>=16&&value.length<=512&&!controlOrSpace(value)));
 const client=new S3Client({region:config.region,endpoint:`https://s3.${config.region}.backblazeb2.com`,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',requestHandler:{connectionTimeout:5000,requestTimeout:300000,throwOnRequestTimeout:true}});
 try{return Object.freeze({vault:createRecoveryVault(client,config.bucket),close:()=>client.destroy()});}catch(error){client.destroy();throw error;}
}

// Explicit SDK seam permits local protocol verification without cloud accounts.
// No delete, retention shortening, bucket configuration or retry is exposed.
export function createRecoveryVault(client:S3Client,bucket:string,timeoutMs=300000){
 require(client instanceof S3Client&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=300000);
 const bounded=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]);
 async function verify(artifact:RecoveryVaultArtifact,signal:AbortSignal,sink?:(chunk:Uint8Array)=>Promise<void>){
  validArtifact(artifact);signal.throwIfAborted();
  const retention=await client.send(new GetObjectRetentionCommand({Bucket:bucket,Key:artifact.key,VersionId:artifact.versionId}),{abortSignal:signal});
  require(retention.Retention?.Mode==='COMPLIANCE'&&retention.Retention.RetainUntilDate instanceof Date&&retention.Retention.RetainUntilDate.getTime()>=Date.parse(artifact.retainUntil)&&Date.parse(artifact.retainUntil)>Date.now());
  const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:artifact.key,VersionId:artifact.versionId}),{abortSignal:signal});
  const body=result.Body;
  try{
   require(body&&Symbol.asyncIterator in body&&result.VersionId===artifact.versionId&&result.ContentLength===artifact.byteSize&&result.ContentType==='application/octet-stream');
   const hash=createHash('sha256');let bytes=0;for await(const chunk of body as AsyncIterable<Uint8Array>){signal.throwIfAborted();require(chunk instanceof Uint8Array);bytes+=chunk.byteLength;require(bytes<=artifact.byteSize);hash.update(chunk);await sink?.(chunk);}
   signal.throwIfAborted();require(bytes===artifact.byteSize&&hash.digest('hex')===artifact.sha256);
  }finally{if(body&&'destroy' in body&&typeof body.destroy==='function')body.destroy();}
 }
 return Object.freeze({
  async verify(artifact:RecoveryVaultArtifact,external:AbortSignal){try{await verify(artifact,bounded(external));return Object.freeze({...artifact});}catch{throw new RecoveryVaultError('RECOVERY_VAULT_READ_FAILED');}},
  async retrieveEncryptedFile(artifact:RecoveryVaultArtifact,destination:string,external:AbortSignal){
   let file:Awaited<ReturnType<typeof open>>|undefined,created=false,complete=false;
   try{
    validArtifact(artifact);require(typeof destination==='string'&&destination.length>0);const signal=bounded(external);signal.throwIfAborted();
    // Caller supplies a private, owned recovery directory. Existing files are
    // never replaced; partial ciphertext is not a usable restore artifact.
    file=await open(destination,'wx',0o600);created=true;
    await verify(artifact,signal,async chunk=>{let offset=0;while(offset<chunk.byteLength){signal.throwIfAborted();const result=await file!.write(chunk,offset,chunk.byteLength-offset);require(result.bytesWritten>0);offset+=result.bytesWritten;}});
    await file.sync();await file.close();file=undefined;signal.throwIfAborted();complete=true;return Object.freeze({...artifact});
   }catch{throw new RecoveryVaultError('RECOVERY_VAULT_READ_FAILED');}
   finally{await file?.close().catch(()=>{});if(created&&!complete)await unlink(destination).catch(()=>{});}
  },
  async publishEncryptedFile(input:Readonly<{key:string;path:string;retainUntil:string}>,external:AbortSignal):Promise<RecoveryVaultArtifact>{
   let submitted=false;const signal=bounded(external);let file:Awaited<ReturnType<typeof open>>|undefined;
   try{
    require(input&&Object.keys(input).sort().join(',')==='key,path,retainUntil'&&keyPattern.test(input.key)&&typeof input.path==='string'&&input.path.length>0);
    const retainUntil=validDate(input.retainUntil);require(retainUntil.getTime()>=Date.now()+7*86400000&&retainUntil.getTime()<=Date.now()+500*86400000);signal.throwIfAborted();
    file=await open(input.path,'r');const before=await file.stat();require(before.isFile()&&before.size>=header.length&&before.size<=maximumBytes);
    const prefix=Buffer.alloc(header.length);require((await file.read(prefix,0,prefix.length,0)).bytesRead===header.length&&prefix.equals(header));
    const sha=createHash('sha256'),md5=createHash('md5');let bytes=0;
    const first=file.createReadStream({start:0,autoClose:false,signal});try{for await(const chunk of first){signal.throwIfAborted();bytes+=chunk.length;require(bytes<=before.size);sha.update(chunk);md5.update(chunk);}}finally{if(!first.readableEnded)first.destroy();}
    require(bytes===before.size);const digest=sha.digest('hex');const after=await file.stat();require(before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs);signal.throwIfAborted();
    const body=file.createReadStream({start:0,autoClose:false,signal});let version:unknown;
    try{
     submitted=true;
     version=(await client.send(new PutObjectCommand({Bucket:bucket,Key:input.key,Body:body,ContentLength:bytes,ContentMD5:md5.digest('base64'),ContentType:'application/octet-stream',CacheControl:'no-store',ObjectLockMode:'COMPLIANCE',ObjectLockRetainUntilDate:retainUntil}),{abortSignal:signal})).VersionId;
    }finally{if(!body.readableEnded)body.destroy();}
    validVersion(version);const final=await file.stat();require(before.size===final.size&&before.mtimeMs===final.mtimeMs&&before.ctimeMs===final.ctimeMs);await file.close();file=undefined;
    const artifact=Object.freeze({key:input.key,versionId:version,byteSize:bytes,sha256:digest,retainUntil:input.retainUntil});await verify(artifact,signal);return artifact;
   }catch{throw new RecoveryVaultError(submitted?'RECOVERY_VAULT_WRITE_UNCERTAIN':'RECOVERY_VAULT_INPUT_REQUIRED');}
   finally{await file?.close().catch(()=>{});}
  }
 });
}
