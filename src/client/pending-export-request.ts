import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseSourceExportCommitted} from '../security/source-export-job-contract.ts';
import {parseExportRequestReference,parseExportRequestResolution} from '../security/source-export-request-resolution.ts';
import type {ExportRequestReference} from '../security/source-export-request-resolution.ts';

type StorageAccess=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PendingExportRequest=Readonly<{actorId:string;command:ExportRequestReference;binding:string}>;
export class PendingExportRequestError extends Error{constructor(){super('PENDING_EXPORT_REQUEST_REVIEW_REQUIRED');this.name='PendingExportRequestError';}}
function require(v:unknown):asserts v{if(!v)throw new PendingExportRequestError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
// Per-tab reference persistence only. Binding is an exact comparison string,
// never authentication. The caller must use its currently verified principal
// and separately authenticated transport before releasing a result.
export function createPendingExportRequestStore(storage:StorageAccess,businessId:string,actorId:string){
 require(uuid(businessId)&&uuid(actorId));const key='crest.pending-export-request.v1:'+businessId+':'+actorId;
 function encode(input:unknown){const command=parseExportRequestReference(input);require(command.businessId===businessId);const binding=JSON.stringify({schemaVersion:1,actorId,command});require(binding.length<=4096);return Object.freeze({actorId,command,binding});}
 function read():PendingExportRequest|null{
  try{const raw=storage.getItem(key);if(raw===null)return null;require(typeof raw==='string'&&raw.length<=4096);const value=object(JSON.parse(raw),['schemaVersion','actorId','command']);require(value.schemaVersion===1&&value.actorId===actorId);const pending=encode(value.command);require(pending.binding===raw);return pending;}catch{throw new PendingExportRequestError();}
 }
 function current(input:unknown){
  const p=object(input,['actorId','command','binding']),expected=encode(p.command);require(p.actorId===actorId&&p.binding===expected.binding);const value=read();require(value&&value.binding===expected.binding);return value;
 }
 function live(input:unknown,signal:AbortSignal){require(!signal.aborted);return current(input);}
 function remove(input:unknown,signal:AbortSignal){live(input,signal);storage.removeItem(key);require(read()===null);}
 return Object.freeze({read,
  record(input:unknown):PendingExportRequest{
   try{const next=encode(input),prior=read();if(prior){require(prior.binding===next.binding);return prior;}storage.setItem(key,next.binding);return current(next);}catch{throw new PendingExportRequestError();}
  },
  require(input:PendingExportRequest){try{current(input);}catch{throw new PendingExportRequestError();}},
  releaseCommitted(input:PendingExportRequest,result:unknown,signal:AbortSignal){
   try{const pending=live(input,signal),receipt=parseSourceExportCommitted(result,pending.command,actorId);remove(pending,signal);return receipt;}catch{throw new PendingExportRequestError();}
  },
  releaseRetired(input:PendingExportRequest,result:unknown,signal:AbortSignal){
   try{const pending=live(input,signal),outcome=parseExportRequestResolution(result,pending.command);require(outcome.state==='retired');remove(pending,signal);return outcome;}catch{throw new PendingExportRequestError();}
  }
 });
}
