import {authentication} from './authentication';
import {createSourceExportClient,sourceExportOwnerContext} from './source-exports';
import {createPendingExportRequestStore,PendingExportRequestError} from './pending-export-request';
import type {PendingExportRequest} from './pending-export-request';
import {parseExportRequestReference,parseExportRequestRetirement,parseExportRequestResolution} from '../security/source-export-request-resolution';
import {parseSourceExportOwnerContext} from '../security/source-export-owner-context';
import type {SourceExportOwnerContext} from '../security/source-export-owner-context';
import {parseSourceExportJob} from '../security/source-export-job-contract';
import type {SourceExportJob} from '../security/source-export-job-contract';
import {parseSourceExportList} from '../security/source-export-owner-list';
import type {SourceExportCursor} from '../security/source-export-owner-list';

export type SourceExportView=Readonly<{phase:'loading'|'ready'|'pending'|'confirmed'|'retired'|'review'|'blocked'|'unavailable';message:string;busy:boolean;reason:string;reference:string;jobId:string;jobState:string;jobs:readonly Readonly<{id:string;state:string;createdAt:string}>[];hasOlder:boolean;canLoadOlder:boolean;canRequest:boolean;canCheckOriginal:boolean;canCheckResolution:boolean;canRetire:boolean;canCheckJob:boolean}>;
export const initialSourceExportView:SourceExportView=Object.freeze({phase:'loading',message:'Check your sign-in before creating an export.',busy:false,reason:'',reference:'',jobId:'',jobState:'',jobs:Object.freeze([]),hasOlder:false,canLoadOlder:false,canRequest:false,canCheckOriginal:false,canCheckResolution:false,canRetire:false,canCheckJob:false});
type Dependencies={storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;change:(view:SourceExportView)=>void;session?:typeof authentication.session;context?:typeof sourceExportOwnerContext;api?:typeof createSourceExportClient;id?:()=>string};
class PrincipalChanged extends Error{}
export function createSourceExportController(deps:Dependencies){
 const session=deps.session??authentication.session,readContext=deps.context??sourceExportOwnerContext,createApi=deps.api??createSourceExportClient,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,context:SourceExportOwnerContext|null=null,store:ReturnType<typeof createPendingExportRequestStore>|null=null,api:ReturnType<typeof createSourceExportClient>|null=null,pending:PendingExportRequest|null=null,job:SourceExportJob|null=null,jobId='',reason='',phase:SourceExportView['phase']='loading',message=initialSourceExportView.message;
 let jobs:readonly SourceExportJob[]=Object.freeze([]),next:SourceExportCursor|null=null;
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted)throw Error();};
 function reasonValid(){try{if(!pending||context?.writeState!=='ready')return false;parseExportRequestRetirement({schemaVersion:1,recoveryEpoch:context.recoveryEpoch,original:pending.command,reason});return true;}catch{return false;}}
 const visible=()=>!!context&&!['loading','review','blocked','unavailable'].includes(phase);
 const view=():SourceExportView=>Object.freeze({phase,message,busy:!!active,reason:phase==='pending'?reason:'',reference:phase==='pending'?pending?.command.reference.operationId??'':'',jobId:visible()?jobId:'',jobState:visible()?job?.state??'':'',jobs:Object.freeze(visible()&&!pending?jobs.map(j=>Object.freeze({id:j.id,state:j.state,createdAt:j.created_at})):[]),hasOlder:visible()&&!pending&&!!next,canLoadOlder:!active&&visible()&&!pending&&!!next,canRequest:!active&&phase==='ready'&&context?.writeState==='ready'&&!pending&&!jobs.some(j=>j.state==='Queued'||j.state==='Running')&&(!jobId||job?.state==='Ready'||job?.state==='Failed'),canCheckOriginal:!active&&phase==='pending'&&!!pending,canCheckResolution:!active&&phase==='pending'&&!!pending,canRetire:!active&&phase==='pending'&&reasonValid(),canCheckJob:!active&&visible()&&!!jobId&&!pending});
 const emit=()=>{if(alive)deps.change(view());};
 const retain=(text:string)=>{phase='pending';message=text;};
 function hide(){context=null;store=null;api=null;pending=null;job=null;jobId='';reason='';jobs=Object.freeze([]);next=null;}
 async function fresh(signal:AbortSignal){
  const issued=await session(signal);live(signal);const proof=Object.freeze({csrfToken:issued.csrfToken,expiresAt:issued.expiresAt}),next=parseSourceExportOwnerContext(await readContext(proof,signal));live(signal);if(!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=Date.now())throw Error();
  if(context&&(context.businessId!==next.businessId||context.actorId!==next.actorId))throw new PrincipalChanged();
  context=next;store??=createPendingExportRequestStore(deps.storage,next.businessId,next.actorId);api??=createApi(next.businessId,next.actorId);return {proof,context:next};
 }
 async function run(work:(signal:AbortSignal)=>Promise<void>){
  if(!alive||active)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]);active=controller;emit();
  try{await work(signal);}catch(error){
   if(alive&&active===controller){
    if(error instanceof PrincipalChanged){hide();phase='blocked';message='Your account or business changed. Check your sign-in again; saved requests have been kept.';}
    else if(error instanceof PendingExportRequestError){phase='blocked';message='The saved export reference needs review. It has not been replaced or cleared.';}
    else if(pending)retain('The result could not be confirmed. Keep this request and check its original status before another action.');
    else{phase='unavailable';message='Exports could not be verified. Check your sign-in and try loading again.';}
   }
  }finally{if(active===controller){active=null;emit();}}
 }
 function current(){if(!pending||!store)throw new PendingExportRequestError();store.require(pending);return pending;}
 function committed(result:unknown,signal:AbortSignal){const p=current();store!.releaseCommitted(p,result,signal);jobId=p.command.reference.exportJobId;pending=null;job=null;reason='';phase='confirmed';message='Export request confirmed. Check its current status to see whether the file is ready.';}
 function resolution(result:unknown,signal:AbortSignal,decision?:ReturnType<typeof parseExportRequestRetirement>){
  const p=current(),value=parseExportRequestResolution(result,p.command);
  if(value.state==='retired'){
   if(decision&&(value.retirement.recoveryEpoch!==decision.recoveryEpoch||value.retirement.reason!==decision.reason))throw Error();
   store!.releaseRetired(p,value,signal);pending=null;reason='';phase='retired';message='This interrupted request is closed. Load exports before making a new request.';return;
  }
  retain(value.state==='original_recorded'?'The original request was recorded. Check its original status to confirm the receipt.':value.state==='conflict'?'The recorded decision does not match this request. Keep its reference for review.':'No closing decision was found. The original request is still kept; this does not prove that it failed.');
 }
 return Object.freeze({view,
  load:()=>run(async signal=>{
   const previous=context,previousId=jobId;hide();phase='loading';message='Checking your sign-in and exports…';emit();const f=await fresh(signal);
   if(previous?.businessId===context!.businessId&&previous.actorId===context!.actorId)jobId=previousId;
   pending=store!.read();if(pending){retain('An interrupted export request was found. Check its original status before requesting another export.');return;}
   const page=parseSourceExportList(await api!.list(null,f.proof,signal),f.context.businessId);live(signal);jobs=page.jobs;next=page.next;
   if(!jobId&&jobs[0])jobId=jobs[0].id;job=jobs.find(j=>j.id===jobId)??null;
   phase='ready';message=context!.writeState==='paused'?'Export requests are paused for recovery review. Existing request status can still be checked.':'Create an export of the supported business records.';
  }),
  older(){if(!view().canLoadOlder)return Promise.resolve();const cursor=next;return run(async signal=>{const f=await fresh(signal);pending=store!.read();if(pending){retain('An interrupted export request was found. Check its original status first.');return;}const page=parseSourceExportList(await api!.list(cursor,f.proof,signal),f.context.businessId,cursor);live(signal);jobs=page.jobs;next=page.next;message='Showing older exports. Load exports again to return to the newest page.';});},
  selectJob(selected:string){if(!alive||active||pending||!visible())return;const selectedJob=jobs.find(j=>j.id===selected);if(!selectedJob)return;jobId=selectedJob.id;job=selectedJob;message='Export selected. Check its current status before using it.';emit();},
  request(){if(!view().canRequest)return Promise.resolve();return run(async signal=>{
   const currentContext=await fresh(signal);pending=store!.read();if(pending){retain('An interrupted export request was found. Check its original status first.');return;}
   if(currentContext.context.writeState!=='ready'){phase='ready';message='Export requests are paused for recovery review.';return;}
   const c=currentContext.context,original=parseExportRequestReference({schemaVersion:1,businessId:c.businessId,commandType:'export.request',reference:{operationId:id(),exportJobId:id(),recoveryEpoch:c.recoveryEpoch,appReleaseId:c.appReleaseId,profile:c.profile,sourceSchemaVersion:c.sourceSchemaVersion}});
   pending=store!.record(original);retain('Requesting an export…');emit();current();const result=await api!.request(pending.command,currentContext.proof,signal);live(signal);current();
   if(result.state==='committed')committed(result,signal);else retain('This request was not confirmed. Keep its reference and check the original status before another request.');
  });},
  checkOriginal(){if(!view().canCheckOriginal)return Promise.resolve();return run(async signal=>{const p=current(),f=await fresh(signal);store!.require(p);const result=await api!.lookupRequest(p.command,f.proof,signal);live(signal);store!.require(p);if(result.state==='committed')committed(result,signal);else retain('No original receipt was found. This does not prove that the request failed. Keep its reference or explicitly close it after review.');});},
  checkResolution(){if(!view().canCheckResolution)return Promise.resolve();return run(async signal=>{const p=current(),f=await fresh(signal);store!.require(p);const result=await api!.lookupResolution(p.command,f.proof,signal);live(signal);resolution(result,signal);});},
  retire(){if(!view().canRetire)return Promise.resolve();const reviewedReason=reason;return run(async signal=>{
   const p=current(),f=await fresh(signal);store!.require(p);if(f.context.writeState!=='ready'){retain('Closing requests is paused for recovery review. The original request has been kept.');return;}
   const decision=parseExportRequestRetirement({schemaVersion:1,recoveryEpoch:f.context.recoveryEpoch,original:p.command,reason:reviewedReason});const result=await api!.retireRequest(decision,f.proof,signal);live(signal);resolution(result,signal,decision);
  });},
  checkJob(){if(!view().canCheckJob)return Promise.resolve();return run(async signal=>{const expected=jobId,f=await fresh(signal),result=await api!.status(expected,f.proof,signal);live(signal);if(result.state==='absent'){job=null;message='The export could not be found. Keep its reference for review.';return;}const value=parseSourceExportJob(result.job,f.context.businessId);if(value.id!==expected)throw Error();job=value;message=value.state==='Ready'?'The export is ready. Download controls are being prepared.':value.state==='Failed'?'This export stopped. Its recorded history has been kept.':value.state==='Running'?'The export is being prepared. Check its status again later.':'The export is waiting to be prepared.';});},
  editReason(value:string){if(alive&&!active&&phase==='pending'){reason=value;emit();}},
  reviewOnReturn(){if(!alive)return;active?.abort();active=null;hide();phase='review';message='Check your sign-in again after returning to this tab. Saved export references have been kept.';emit();},
  dispose(){alive=false;active?.abort();active=null;hide();}
 });
}
