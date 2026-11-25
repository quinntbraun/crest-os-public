import {authentication,AuthenticationError} from './authentication';
import {sourceExportOwnerContext,createSourceExportStopClient,SourceExportClientError} from './source-exports';
import {parseSourceExportOwnerContext} from '../security/source-export-owner-context';
import type {SourceExportOwnerContext} from '../security/source-export-owner-context';
import {parseSourceExportJob} from '../security/source-export-job-contract';
import type {SourceExportJob} from '../security/source-export-job-contract';
import {parseSourceExportStopCommand} from '../security/source-export-stop-contract';
import {createPendingExportStopStore,PendingExportStopError} from './pending-export-stop';
import type {PendingExportStop} from './pending-export-stop';
import {customerUuid} from '../customer/customer-contract';
export type ExportStopView=Readonly<{phase:'loading'|'ready'|'pending'|'stopped'|'review'|'blocked'|'unavailable';message:string;busy:boolean;state:string;reference:string;canStop:boolean;canCheck:boolean;canRetry:boolean}>;
export const initialExportStopView:ExportStopView=Object.freeze({phase:'loading',message:'Checking the export…',busy:false,state:'',reference:'',canStop:false,canCheck:false,canRetry:false});
type Dependencies={jobId:string;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;change:(view:ExportStopView)=>void;onResolved?:()=>void;onAccessDenied?:()=>void;session?:typeof authentication.session;context?:typeof sourceExportOwnerContext;api?:typeof createSourceExportStopClient;id?:()=>string};
class ChangedPrincipal extends Error{}
export function createSourceExportStopController(deps:Dependencies){
 if(!customerUuid(deps.jobId))throw Error('SOURCE_EXPORT_STOP_REVIEW_REQUIRED');
 const session=deps.session??authentication.session,readContext=deps.context??sourceExportOwnerContext,apiFactory=deps.api??createSourceExportStopClient,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,context:SourceExportOwnerContext|null=null,store:ReturnType<typeof createPendingExportStopStore>|null=null,api:ReturnType<typeof createSourceExportStopClient>|null=null,pending:PendingExportStop|null=null,job:SourceExportJob|null=null,mayRetry=false,phase:ExportStopView['phase']='loading',message=initialExportStopView.message;
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted)throw Error();};
 const visible=()=>context!==null&&!['loading','review','blocked','unavailable'].includes(phase);
 const view=():ExportStopView=>Object.freeze({phase,message,busy:active!==null,state:visible()?job?.state??'':'',reference:visible()?pending?.command.reference.operationId??'':'',canStop:visible()&&!active&&!pending&&context?.writeState==='ready'&&(job?.state==='Queued'||job?.state==='Running'),canCheck:visible()&&!active&&pending!==null,canRetry:visible()&&!active&&pending!==null&&mayRetry&&job!==null&&context?.writeState==='ready'&&pending.command.reference.recoveryEpoch===context.recoveryEpoch});
 const emit=()=>{if(alive)deps.change(view());};
 function hide(){context=null;store=null;api=null;pending=null;job=null;mayRetry=false;}
 async function fresh(signal:AbortSignal){
  const issued=await session(signal);live(signal);const proof=Object.freeze({csrfToken:issued.csrfToken,expiresAt:issued.expiresAt}),next=parseSourceExportOwnerContext(await readContext(proof,signal));live(signal);
  if(context&&(context.businessId!==next.businessId||context.actorId!==next.actorId))throw new ChangedPrincipal();
  if(next.profile!=='crest.current-business-source-bundle.v1'||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=Date.now())throw Error();
  context=next;store??=createPendingExportStopStore(deps.storage,next.businessId,next.actorId,deps.jobId);api??=apiFactory(next.businessId,next.actorId);return {proof,context:next};
 }
 async function readJob(proof:Awaited<ReturnType<typeof authentication.session>>,signal:AbortSignal){
  const result=await api!.status(deps.jobId,proof,signal);live(signal);if(result.state==='absent'){job=null;return;}
  const found=parseSourceExportJob(result.job,context!.businessId);if(found.id!==deps.jobId)throw Error();job=found;
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  if(!alive||active)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);active=controller;emit();
  try{await work(signal);}catch(error){if(alive&&active===controller){
   if(error instanceof ChangedPrincipal||error instanceof AuthenticationError&&error.kind==='denied'){hide();phase='review';message='Check your sign-in again. The saved stop reference has been kept.';deps.onAccessDenied?.();}
   else if(error instanceof PendingExportStopError){phase='blocked';message='The saved stop reference changed or needs review. Reload before another action.';}
   else if(pending){phase='pending';mayRetry=error instanceof SourceExportClientError&&error.kind==='not_submitted';message=mayRetry?'The stop was not submitted. You can retry the same saved request.':'The stop result is unconfirmed. Check the saved stop request before another attempt.';}
   else{hide();phase='unavailable';message='The export could not be checked. Refresh its status before trying again.';}
  }}finally{if(active===controller){active=null;emit();}}
 }
 function current(){if(!pending||!store)throw new PendingExportStopError();store.require(pending);return pending;}
 function committed(result:unknown,signal:AbortSignal){const p=current(),receipt=store!.releaseCommitted(p,result,signal);job=receipt.receipt.job;pending=null;mayRetry=false;phase='stopped';message='Export stopped. Its history is kept. You can request a fresh export.';deps.onResolved?.();}
 async function fenced(signal:AbortSignal){
  const p=current(),f=await fresh(signal);store!.require(p);await readJob(f.proof,signal);live(signal);store!.require(p);
  if(job&&(BigInt(job.version)>BigInt(p.command.reference.expectedVersion)||f.context.writeState==='ready'&&f.context.recoveryEpoch!==p.command.reference.recoveryEpoch)){
   store!.releaseFenced(p,job,f.context.writeState==='ready'?f.context.recoveryEpoch:null,signal);pending=null;mayRetry=false;phase='ready';message='The saved stop can no longer change this export version. Review the current status before stopping again.';deps.onResolved?.();return true;
  }return false;
 }
 async function send(signal:AbortSignal){
  const p=current(),f=await fresh(signal);store!.require(p);
  if(f.context.writeState!=='ready'||f.context.recoveryEpoch!==p.command.reference.recoveryEpoch){phase='pending';mayRetry=false;message='This stop belongs to a previous recovery or writes are paused. Check its saved result.';return;}
  mayRetry=false;const result=await api!.stop(p.command,f.proof,signal);live(signal);store!.require(p);
  if(result.state==='committed'){committed(result,signal);return;}
  if(result.state==='conflict'&&['version','state'].includes(result.reason)&&await fenced(signal))return;
  phase='pending';message='The stop was not confirmed. Check the saved result; its reference has been kept.';
 }
 return Object.freeze({view,
  load:()=>run(async signal=>{hide();phase='loading';message='Checking the export…';const f=await fresh(signal);pending=store!.read();await readJob(f.proof,signal);phase=pending?'pending':'ready';message=pending?'A saved stop request needs review. Check its result before another attempt.':job?.state==='Queued'||job?.state==='Running'?'Stop this unfinished attempt before requesting a fresh export.':job?'This export is no longer being prepared. Its recorded history remains available.':'The export could not be found.';}),
  stop(){if(!view().canStop)return Promise.resolve();return run(async signal=>{
   const f=await fresh(signal);pending=store!.read();if(pending){phase='pending';message='A saved stop request needs review first.';return;}if(f.context.writeState!=='ready')throw Error();await readJob(f.proof,signal);
   if(!job||!['Queued','Running'].includes(job.state)){phase='ready';message='The export already finished or stopped. Refresh the export list.';deps.onResolved?.();return;}
   const command=parseSourceExportStopCommand({schemaVersion:1,businessId:f.context.businessId,commandType:'export.stop',reference:{operationId:id(),recoveryEpoch:f.context.recoveryEpoch,exportJobId:deps.jobId,expectedVersion:job.version}},f.context.businessId);
   pending=store!.record(command);mayRetry=false;phase='pending';message='Stopping this export…';emit();await send(signal);
  });},
  check(){if(!view().canCheck)return Promise.resolve();return run(async signal=>{const p=current(),f=await fresh(signal);store!.require(p);const result=await api!.lookup(p.command,f.proof,signal);live(signal);store!.require(p);if(result.state==='committed'){committed(result,signal);return;}if(await fenced(signal))return;mayRetry=!!job&&context?.writeState==='ready'&&context.recoveryEpoch===p.command.reference.recoveryEpoch;phase='pending';message=mayRetry?'No stop receipt was found. The reference is kept; you may explicitly retry this same stop request.':'No stop receipt was found. Keep the reference and check again when access and writes are available.';});},
  retry(){if(!view().canRetry)return Promise.resolve();return run(send);},
  reviewOnReturn(){if(!alive)return;active?.abort();active=null;hide();phase='review';message='Refresh access after returning to this tab. Saved stop references have been kept.';emit();},
  dispose(){alive=false;active?.abort();active=null;hide();}
 });
}
