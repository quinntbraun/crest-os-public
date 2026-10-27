import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {downloadObject,parseSourceExportDownloadPartRequest} from './source-export-download-contract.ts';
import {parseSourceExportDownloadPermit,parseSourceExportDownloadHandoff,parseSourceExportDownloadAccessReceipt} from './source-export-download-permit.ts';
import {parseExportPartBinding,maximumExportPartBytes} from './export-part-crypto.ts';
import type {createSourceExportOwnerAccess} from './source-export-owner-access.ts';
import type {createEncryptedExportPartStore} from '../files/export-part-store.ts';

type Permit=ReturnType<typeof parseSourceExportDownloadPermit>;
export type SourceExportDelivery=Readonly<{header:Permit['header'];file:Permit['file'];bytes:Uint8Array}>;
export class SourceExportDeliveryError extends Error{constructor(){super('SOURCE_EXPORT_DOWNLOAD_UNAVAILABLE');this.name='SourceExportDeliveryError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportDeliveryError();}
async function bounded<T>(work:Promise<T>,signal:AbortSignal,late?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false;const abort=()=>{if(!settled){settled=true;signal.removeEventListener('abort',abort);reject(new SourceExportDeliveryError());}};
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  work.then(value=>{if(settled){try{late?.(value);}catch{/* Late cleanup must not expose provider details. */}return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},()=>{if(!settled){settled=true;signal.removeEventListener('abort',abort);reject(new SourceExportDeliveryError());}});
 });
}
const bindingKeys=['businessId','actorId','exportJobId','generationId','recoveryEpoch','partId','fileName','contentType'] as const;
export function createSourceExportDownloadReader(businessId:string,access:Pick<ReturnType<typeof createSourceExportOwnerAccess>,'downloadPart'|'recordDownloadAccess'>,store:Pick<Awaited<ReturnType<typeof createEncryptedExportPartStore>>,'readVerified'>,timeoutMs=60000){
 require(uuid(businessId)&&typeof access?.downloadPart==='function'&&typeof access?.recordDownloadAccess==='function'&&typeof store?.readVerified==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=60000);
 const scope=businessId,authorize=access.downloadPart.bind(access),record=access.recordDownloadAccess.bind(access),read=store.readVerified.bind(store);let active=0;
 function permit(input:unknown,request:ReturnType<typeof parseSourceExportDownloadPartRequest>){
  const p=downloadObject(input,['header','currentActorId','originalActorId','recoveryEpoch','planSha256','file','binding','intent']);require(typeof p.currentActorId==='string');
  return parseSourceExportDownloadHandoff(p,scope,p.currentActorId,request);
 }
 function metadata(input:unknown,p:Permit){const m=downloadObject(input,['binding','byteSize','sha256']);require(JSON.stringify(parseExportPartBinding(downloadObject(m.binding,bindingKeys)))===JSON.stringify(p.binding)&&m.byteSize===p.file.bytes&&m.sha256===p.file.sha256);}
 return Object.freeze({
  async deliver(credential:string,input:unknown,external:AbortSignal,consume:(value:SourceExportDelivery,signal:AbortSignal)=>Promise<void>):Promise<void>{
   let opened:Awaited<ReturnType<typeof read>>|undefined,owned:Uint8Array|undefined,entered=false;
   try{
    const request=parseSourceExportDownloadPartRequest(input),signal=AbortSignal.any([external,AbortSignal.timeout(timeoutMs)]);require(typeof credential==='string'&&typeof consume==='function'&&!signal.aborted&&active<2);active++;entered=true;
    const first=permit((await bounded(authorize(credential,request,signal),signal)).forServer(),request);require(!signal.aborted);
    opened=await bounded(read(first.intent,first.binding,signal),signal,value=>value.dispose());metadata(opened.metadataForServer(),first);require(!signal.aborted);
    const last=permit((await bounded(authorize(credential,request,signal),signal)).forServer(),request);require(!signal.aborted&&JSON.stringify(first)===JSON.stringify(last));
    const copy=downloadObject(opened.forServer(),['binding','byteSize','sha256','bytes']);if(copy.bytes instanceof Uint8Array)owned=copy.bytes;metadata({binding:copy.binding,byteSize:copy.byteSize,sha256:copy.sha256},last);
    require(owned&&owned.byteLength===last.file.bytes&&owned.byteLength<=maximumExportPartBytes&&createHash('sha256').update(owned).digest('hex')===last.file.sha256&&!signal.aborted&&Date.parse(last.header.expiresAt)>Date.now());
    const receipt=await bounded(record(credential,request,last,signal),signal);parseSourceExportDownloadAccessReceipt(receipt.forServer(),last);require(!signal.aborted&&Date.parse(last.header.expiresAt)>Date.now());
    await bounded(consume(Object.freeze({header:last.header,file:last.file,bytes:owned}),signal),signal);require(!signal.aborted);
   }catch{throw new SourceExportDeliveryError();}
   finally{try{owned?.fill(0);}catch{/* A detached consumer buffer has no writable local view. */}try{opened?.dispose();}catch{/* Cleanup never replaces the sanitized delivery outcome. */}if(entered)active--;}
  },
  toJSON():never{throw new SourceExportDeliveryError();}
 });
}
