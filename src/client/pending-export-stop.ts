import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {parseSourceExportStopCommand} from '../security/source-export-stop-contract';
import type {SourceExportStopCommand} from '../security/source-export-stop-contract';
import {parseSourceExportCommitted,parseSourceExportJob} from '../security/source-export-job-contract';
export type PendingExportStop=Readonly<{actorId:string;command:SourceExportStopCommand;binding:string}>;
export class PendingExportStopError extends Error{constructor(){super('PENDING_EXPORT_STOP_REVIEW_REQUIRED');this.name='PendingExportStopError';}}
function require(value:unknown):asserts value{if(!value)throw new PendingExportStopError();}
// Reference persistence only. Neither IDs nor a local binding authorize a stop.
export function createPendingExportStopStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,businessId:string,actorId:string,jobId:string){
 require(customerUuid(businessId)&&customerUuid(actorId)&&customerUuid(jobId));const key='crest.pending-export-stop.v1:'+businessId+':'+actorId+':'+jobId;
 function encode(input:unknown):PendingExportStop{const command=parseSourceExportStopCommand(input,businessId);require(command.reference.exportJobId===jobId);return Object.freeze({actorId,command,binding:JSON.stringify({schemaVersion:1,actorId,command})});}
 function read():PendingExportStop|null{
  try{const raw=storage.getItem(key);if(raw===null)return null;require(typeof raw==='string'&&raw.length<=4096);const value:unknown=JSON.parse(raw);require(exact(value,['schemaVersion','actorId','command'])&&value.schemaVersion===1&&value.actorId===actorId);const pending=encode(value.command);require(pending.binding===raw);return pending;}catch{throw new PendingExportStopError();}
 }
 function current(input:PendingExportStop,signal?:AbortSignal){require(!signal?.aborted&&exact(input,['actorId','command','binding']));const expected=encode(input.command),stored=read();require(input.actorId===actorId&&input.binding===expected.binding&&stored?.binding===expected.binding);return expected;}
 function remove(input:PendingExportStop,signal:AbortSignal){current(input,signal);storage.removeItem(key);require(read()===null);}
 return Object.freeze({read,
  record(input:unknown){try{const next=encode(input),prior=read();if(prior){require(prior.binding===next.binding);return prior;}storage.setItem(key,next.binding);return current(next);}catch{throw new PendingExportStopError();}},
  require(input:PendingExportStop){return current(input);},
  releaseCommitted(input:PendingExportStop,result:unknown,signal:AbortSignal){const pending=current(input,signal),receipt=parseSourceExportCommitted(result,pending.command,actorId);remove(pending,signal);return receipt;},
  releaseFenced(input:PendingExportStop,currentJob:unknown,currentEpoch:string|null,signal:AbortSignal){
   const pending=current(input,signal),job=parseSourceExportJob(currentJob,businessId);require(job.id===jobId&&(BigInt(job.version)>BigInt(pending.command.reference.expectedVersion)||customerUuid(currentEpoch)&&currentEpoch!==pending.command.reference.recoveryEpoch));remove(pending,signal);
  }
 });
}
