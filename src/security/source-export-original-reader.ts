import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {exportOriginalKinds,parseExportOriginalRequest,parseExportOriginalPermit,parseExportOriginalAudit} from './source-export-original-contract.ts';
import type {ExportOriginalKind,ExportOriginalPermit,ExportOriginalRequest} from './source-export-original-contract.ts';
type Authority=Readonly<{
 read:(credential:string,request:ExportOriginalRequest,signal:AbortSignal)=>Promise<Readonly<{actorId:string;record:unknown}>>;
 record:(credential:string,request:ExportOriginalRequest,permit:ExportOriginalPermit,signal:AbortSignal)=>Promise<unknown>;
}>;
type ObjectRequest=Readonly<{key:string;byteSize:number;sha256:string;contentType:string}>;
export type ExportOriginalStores=Readonly<Record<ExportOriginalKind,(input:ObjectRequest,signal:AbortSignal)=>Promise<Uint8Array>>>;
export type ExportOriginalDelivery=Readonly<{header:ExportOriginalPermit['header'];file:ExportOriginalPermit['file'];bytes:Uint8Array}>;
function require(value:unknown):asserts value{if(!value)throw Error('SOURCE_EXPORT_ORIGINAL_UNAVAILABLE');}
async function bounded<T>(work:Promise<T>,signal:AbortSignal,late?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{let settled=false;const abort=()=>{if(!settled){settled=true;signal.removeEventListener('abort',abort);reject(Error('SOURCE_EXPORT_ORIGINAL_UNAVAILABLE'));}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();work.then(value=>{if(settled){try{late?.(value);}catch{/* Private cleanup only. */}return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},()=>{if(!settled){settled=true;signal.removeEventListener('abort',abort);reject(Error('SOURCE_EXPORT_ORIGINAL_UNAVAILABLE'));}});});
}
// Trusted server-only composition. The SQL ports must freshly verify provider,
// owner/recovery/job authority and acknowledge the audit transaction's COMMIT.
// Store methods receive only the fixed object chosen by that SQL permit.
export function createExportOriginalReader(businessId:string,authority:Authority,stores:ExportOriginalStores,timeoutMs=95000){
 require(uuid(businessId)&&typeof authority?.read==='function'&&typeof authority.record==='function'&&exportOriginalKinds.every(kind=>typeof stores?.[kind]==='function')&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=95000);
 const read=authority.read.bind(authority),record=authority.record.bind(authority),objects=Object.freeze({...stores});let active=0;
 const permit=async(credential:string,request:ExportOriginalRequest,signal:AbortSignal)=>{const value=await bounded(read(credential,request,signal),signal);require(!signal.aborted);return parseExportOriginalPermit(value.record,businessId,value.actorId,request);};
 return Object.freeze({
  async deliver(credential:string,input:unknown,external:AbortSignal,consume:(value:ExportOriginalDelivery,signal:AbortSignal)=>Promise<void>){
   let bytes:Uint8Array|undefined,entered=false;const signal=AbortSignal.any([external,AbortSignal.timeout(timeoutMs)]);
   try{
    const request=parseExportOriginalRequest(input);require(typeof credential==='string'&&credential.length>0&&typeof consume==='function'&&!signal.aborted&&active<2);active++;entered=true;
    const first=await permit(credential,request,signal),f=first.file;
    bytes=await bounded(objects[first.object.domain](Object.freeze({key:first.object.key,byteSize:f.byteSize,sha256:f.sha256,contentType:f.mediaType}),signal),signal,value=>value.fill(0));
    require(bytes instanceof Uint8Array&&bytes.byteLength===f.byteSize&&createHash('sha256').update(bytes).digest('hex')===f.sha256&&!signal.aborted);
    const last=await permit(credential,request,signal);require(isDeepStrictEqual(first,last));
    const receipt=await bounded(record(credential,request,last,signal),signal);parseExportOriginalAudit(receipt,last);require(!signal.aborted&&Date.parse(last.header.expiresAt)>Date.now());
    await bounded(consume(Object.freeze({header:last.header,file:last.file,bytes}),signal),signal);require(!signal.aborted);
   }catch{throw Error('SOURCE_EXPORT_ORIGINAL_UNAVAILABLE');}
   finally{try{bytes?.fill(0);}catch{/* A transferred buffer has no writable local view. */}if(entered)active--;}
  },
  toJSON():never{throw Error('SOURCE_EXPORT_ORIGINAL_PRIVATE');}
 });
}
