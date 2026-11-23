// Isolated recovery reader: no upload, delete, rendering, signed URL or retry.
import {createHash} from 'node:crypto';
import {S3Client,ListObjectsV2Command,GetObjectCommand} from '@aws-sdk/client-s3';
import {createR2ObjectClient} from '../files/private-object-store.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';

export type RecoveryPrimaryDomain='expense_receipt'|'supplier_document'|'condition_photo';
export type RecoveryPrimaryObject=Readonly<{key:string;byteSize:number;etag:string;lastModified:string}>;
export class RecoveryPrimaryStoreError extends Error{constructor(){super('RECOVERY_PRIMARY_STORE_REVIEW_REQUIRED');this.name='RecoveryPrimaryStoreError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryPrimaryStoreError();}
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',keyPattern=new RegExp(`^(?:(?:originals|previews)/${uuid}/${uuid}|staging/${uuid}/${uuid}/${uuid})$`);
type Catalog=Readonly<{domain:RecoveryPrimaryDomain;observedAt:string;objects:readonly RecoveryPrimaryObject[];atomicSnapshot:false}>;

export function createR2RecoveryPrimaryStore(config:R2ObjectConfiguration,domain:RecoveryPrimaryDomain){
 const client=createR2ObjectClient(config);try{return Object.freeze({store:createRecoveryPrimaryStore(client,config.bucket,domain),close:()=>client.destroy()});}catch(error){client.destroy();throw error;}
}
// Explicit SDK seam for native protocol fixtures. Production fixes R2 HTTPS and
// supplies a distinct read/list-only credential. Dedicated bucket scope required.
export function createRecoveryPrimaryStore(client:S3Client,bucket:string,domain:RecoveryPrimaryDomain){
 require(client instanceof S3Client&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)&&['expense_receipt','supplier_document','condition_photo'].includes(domain));
 const catalogs=new WeakSet<object>(),descriptors=new WeakSet<object>();
 const bounded=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(300000)]);
 async function listing(signal:AbortSignal){
  const objects:RecoveryPrimaryObject[]=[],tokens=new Set<string>();let token:string|undefined,prior='';
  do{
   signal.throwIfAborted();const response=await client.send(new ListObjectsV2Command({Bucket:bucket,MaxKeys:1000,...(token?{ContinuationToken:token}:{})}),{abortSignal:signal}),page=response.Contents??[];
   require(Array.isArray(page)&&page.length<=1000&&response.KeyCount===page.length&&typeof response.IsTruncated==='boolean');
   for(const item of page){
    require(typeof item.Key==='string'&&keyPattern.test(item.Key)&&Buffer.compare(Buffer.from(item.Key),Buffer.from(prior))>0&&Number.isSafeInteger(item.Size)&&item.Size!>=0&&item.Size!<=26214400&&typeof item.ETag==='string'&&/^"[a-zA-Z0-9-]{1,128}"$/.test(item.ETag)&&item.LastModified instanceof Date&&Number.isFinite(item.LastModified.getTime()));
    prior=item.Key;const object=Object.freeze({key:item.Key,byteSize:item.Size!,etag:item.ETag,lastModified:item.LastModified.toISOString()});objects.push(object);descriptors.add(object);require(objects.length<=100000);
   }
   if(!response.IsTruncated)break;
   const next=response.NextContinuationToken;require(page.length>0&&typeof next==='string'&&next.length>0&&next.length<=4096&&!/[\p{Cc}]/u.test(next)&&!tokens.has(next));tokens.add(next);token=next;
  }while(token!==undefined);
  signal.throwIfAborted();return Object.freeze(objects);
 }
 return Object.freeze({domain,
  async listRetained(external:AbortSignal){try{const signal=bounded(external),objects=await listing(signal),catalog=Object.freeze({domain,observedAt:new Date().toISOString(),objects,atomicSnapshot:false as const});catalogs.add(catalog);return Object.freeze({forRecoveryTools:()=>catalog,toJSON():never{throw new RecoveryPrimaryStoreError();}});}catch{throw new RecoveryPrimaryStoreError();}},
  async readObserved(object:RecoveryPrimaryObject,external:AbortSignal){
   let body:unknown,active:AbortSignal|undefined,abort:(()=>void)|undefined;const chunks:Buffer[]=[];try{
    require(descriptors.has(object));const signal=bounded(external);signal.throwIfAborted();const response=await client.send(new GetObjectCommand({Bucket:bucket,Key:object.key,IfMatch:object.etag}),{abortSignal:signal});body=response.Body;
    require(body&&typeof body==='object'&&Symbol.asyncIterator in body&&response.ETag===object.etag&&response.ContentLength===object.byteSize&&response.LastModified instanceof Date&&response.LastModified.toISOString()===object.lastModified);active=signal;abort=()=>{if(body&&typeof body==='object'&&'destroy' in body&&typeof body.destroy==='function')body.destroy(new RecoveryPrimaryStoreError());};signal.addEventListener('abort',abort,{once:true});signal.throwIfAborted();
    require(response.VersionId===undefined||typeof response.VersionId==='string'&&response.VersionId.length>0&&response.VersionId.length<=1024&&!/\s|\p{Cc}/u.test(response.VersionId));
    const hash=createHash('sha256');let count=0;
    for await(const chunk of body as AsyncIterable<Uint8Array>){signal.throwIfAborted();require(chunk instanceof Uint8Array);count+=chunk.byteLength;require(count<=object.byteSize);hash.update(chunk);chunks.push(Buffer.from(chunk));}
    signal.throwIfAborted();require(count===object.byteSize);const bytes=Buffer.concat(chunks,count),observation=Object.freeze({...object,sha256:hash.digest('hex'),versionId:response.VersionId&&response.VersionId!=='null'?response.VersionId:null,observedAt:new Date().toISOString()});
    return Object.freeze({forRecoveryTools:()=>Object.freeze({bytes,observation}),toJSON():never{throw new RecoveryPrimaryStoreError();}});
   }catch{throw new RecoveryPrimaryStoreError();}finally{if(active&&abort)active.removeEventListener('abort',abort);for(const chunk of chunks)chunk.fill(0);if(body&&typeof body==='object'&&'destroy' in body&&typeof body.destroy==='function')body.destroy();}
  },
  async verifyStable(catalog:Catalog,external:AbortSignal){try{require(catalogs.has(catalog));const after=await listing(bounded(external));require(JSON.stringify(after)===JSON.stringify(catalog.objects));return Object.freeze({verification:'two-matching-listings' as const,verifiedAt:new Date().toISOString(),atomicSnapshot:false as const});}catch{throw new RecoveryPrimaryStoreError();}}
 });
}
