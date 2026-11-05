import 'server-only';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createPrivateObjectStore,PrivateObjectError,maximumFileBytes,uploadLifetimeSeconds} from '../../files/private-object-store.ts';
import {parseReceiptReservation,parseReceiptCandidate} from './receipt-contract.ts';
import type {ReceiptReservation,ReceiptCandidate} from './receipt-contract.ts';
export class ReceiptStorageError extends Error{constructor(){super('RECEIPT_STORAGE_UNCONFIRMED');this.name='ReceiptStorageError';}}
class ReceiptUpload{#url:string;readonly contentType:string;constructor(url:string,type:string){this.#url=url;this.contentType=type;Object.freeze(this);}forUpload(){return {url:this.#url,method:'PUT' as const,headers:{'content-type':this.contentType},expiresInSeconds:uploadLifetimeSeconds};}toJSON():never{throw new ReceiptStorageError();}}
class ReceiptBytes{#bytes:Buffer;constructor(bytes:Buffer){this.#bytes=Buffer.from(bytes);Object.freeze(this);}forResponse(){return Buffer.from(this.#bytes);}toJSON():never{throw new ReceiptStorageError();}}
// Explicit trusted SDK seam; no ambient credentials, browser bucket URL, delete,
// overwrite, public GET capability or automatic write retry is introduced.
export function createReceiptObjectStore(client:S3Client,bucket:string){
 const store=createPrivateObjectStore(client,bucket);
 async function readExact(key:string,byteSize:number,sha256:string,type:string,signal?:AbortSignal){
  const bounded=AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]);let body:Readable|undefined;
  const abort=()=>body?.destroy(new ReceiptStorageError());
  try{if(bounded.aborted)throw new Error();const result=await client.send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:bounded});
   if(!(result.Body instanceof Readable))throw new Error();body=result.Body;bounded.addEventListener('abort',abort,{once:true});
   if(bounded.aborted||result.ContentLength!==byteSize||result.ContentType!==type||!Number.isSafeInteger(byteSize)||byteSize<1||byteSize>maximumFileBytes)throw new Error();
   const chunks:Buffer[]=[];let size=0;const digest=createHash('sha256');for await(const part of body){if(bounded.aborted||!(part instanceof Uint8Array)||(size+=part.byteLength)>byteSize)throw new Error();digest.update(part);chunks.push(Buffer.from(part));}
   if(bounded.aborted||size!==byteSize||digest.digest('hex')!==sha256)throw new Error();return Buffer.concat(chunks,size);
  }catch{throw new ReceiptStorageError();}finally{bounded.removeEventListener('abort',abort);body?.destroy();}
 }
 async function reconcileWrite(input:Parameters<typeof store.writeOriginalCandidate>[0],write:()=>ReturnType<typeof store.writeOriginalCandidate>,signal?:AbortSignal){const pinned={key:input.key,byteSize:input.bytes.byteLength,sha256:input.sha256,contentType:input.contentType};try{return await write();}catch(error){if(!(error instanceof PrivateObjectError)||!['OBJECT_KEY_EXISTS','OBJECT_WRITE_UNCERTAIN'].includes(error.code))throw new ReceiptStorageError();await readExact(pinned.key,pinned.byteSize,pinned.sha256,pinned.contentType,signal);return Object.freeze({key:pinned.key,byteSize:pinned.byteSize,sha256:pinned.sha256});}}
 return Object.freeze({
  // Only give this store to the existing validated intake AFTER a durable reservation.
  intakeStore:Object.freeze({...store,
   writeOriginalCandidate:(input:Parameters<typeof store.writeOriginalCandidate>[0],signal?:AbortSignal)=>reconcileWrite(input,()=>store.writeOriginalCandidate(input,signal),signal),
   writePreviewCandidate:(input:Parameters<typeof store.writePreviewCandidate>[0],signal?:AbortSignal)=>reconcileWrite(input,()=>store.writePreviewCandidate(input,signal),signal)}),
  async issueReservedUpload(input:ReceiptReservation,signal?:AbortSignal){const r=parseReceiptReservation(input),bounded=AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])]);try{if(bounded.aborted)throw new Error();const url=await getSignedUrl(client,new PutObjectCommand({Bucket:bucket,Key:r.stagingKey,ContentType:r.declaredType}),{expiresIn:uploadLifetimeSeconds,signableHeaders:new Set(['content-type'])});if(bounded.aborted)throw new Error();return new ReceiptUpload(url,r.declaredType);}catch{throw new ReceiptStorageError();}},
  async readAvailable(input:ReceiptReservation,candidate:ReceiptCandidate,variant:'original'|'preview',signal?:AbortSignal){const r=parseReceiptReservation(input),c=parseReceiptCandidate(candidate,r);if(!['original','preview'].includes(variant))throw new ReceiptStorageError();const object=variant==='original'?c.original:c.preview,type=variant==='original'?r.declaredType:'image/jpeg';return new ReceiptBytes(await readExact(object.key,object.byteSize,object.sha256,type,signal));}
 });
}
