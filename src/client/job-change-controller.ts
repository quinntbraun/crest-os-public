import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {lookupSchedulingOriginal} from './scheduling-original';
import {parseSchedulingOriginal} from '../operations/scheduling-original-contract';
import {parseCancelledJobCommitted} from '../operations/confirmed-booking-contract';
import type {CancelScheduledJobSave} from '../operations/confirmed-booking-contract';
import {parseCancelJobCommand,parseAmendedCancelledJobCommitted} from '../operations/amended-booking-contract';
import type {CancelJobCommand,CancellationPlanObservation} from '../operations/amended-booking-contract';
import {parseChangeJobScheduleSave,parseRescheduledJobCommitted} from '../operations/confirmed-reschedule-contract';
import type {ChangeJobScheduleSave,ScheduleChangePayload} from '../operations/confirmed-reschedule-contract';
import type {createPendingSchedulingStore,PendingScheduling} from './pending-scheduling';
import {customerUuid} from '../customer/customer-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Resources=Exclude<Awaited<ReturnType<typeof scheduling.resources>>,{state:'absent'}>;
type Request=CancelJobCommand|ChangeJobScheduleSave;
type Result=Awaited<ReturnType<typeof scheduling.cancel>>|Awaited<ReturnType<typeof scheduling.reschedule>>;
type Store=ReturnType<typeof createPendingSchedulingStore>;
export type JobChangeKind='cancel'|'reschedule';
export type JobChangeView=Readonly<{phase:'loading'|'ready'|'pending'|'review'|'blocked'|'signed-out'|'unavailable'|'committed';busy:boolean;message:string;context:Context|null;resources:Resources|null;reference:string;canRetry:boolean;savedJobId:string;savedVersion:string}>;
export const initialJobChangeView:JobChangeView=Object.freeze({phase:'loading',busy:true,message:'Checking saved job and current access…',context:null,resources:null,reference:'',canRetry:false,savedJobId:'',savedVersion:''});
export function createJobChangeController(deps:{kind:JobChangeKind;store:Store;blockers?:readonly Store[];change:(view:JobChangeView)=>void;api?:typeof scheduling;session?:typeof authentication.session;lookup?:typeof lookupSchedulingOriginal;id?:()=>string}){
 if(!['cancel','reschedule'].includes(deps.kind))throw Error('JOB_CHANGE_CONFIGURATION_REQUIRED');
 const api=deps.api??scheduling,session=deps.session??authentication.session,lookup=deps.lookup??lookupSchedulingOriginal,id=deps.id??(()=>crypto.randomUUID()),kind=deps.kind;
 let alive=true,active:AbortController|null=null,phase:JobChangeView['phase']='loading',message=initialJobChangeView.message,context:Context|null=null,resources:Resources|null=null,pending:PendingScheduling|null=null,original:Request|null=null,canRetry=false,savedJobId='',savedVersion='';
 const eligible=()=>!!context&&!!pending&&context.binding===pending.binding&&context.context.businessId===pending.businessId;
 const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&a.amendedSchedulingAvailable===b.amendedSchedulingAvailable&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch;
 const view=():JobChangeView=>Object.freeze({phase,busy:!!active,message,context:phase==='ready'?context:null,resources:phase==='ready'?resources:null,reference:phase==='pending'&&eligible()?pending!.reference.operationId:'',canRetry:phase==='pending'&&!active&&canRetry,savedJobId:phase==='committed'||phase==='pending'&&eligible()?savedJobId:'',savedVersion:phase==='committed'||phase==='pending'&&eligible()?savedVersion:''});
 const emit=()=>{if(alive)deps.change(view());};
 function clearPrivate(){resources=null;original=null;canRetry=false;savedJobId='';savedVersion='';}
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 async function fresh(signal:AbortSignal){const proof=await session(signal);live(signal);const next=await api.workspace(proof,signal);live(signal);return {proof,next};}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){if(!alive||active)return;const controller=new AbortController();active=controller;emit();try{await work(controller.signal);}catch(error){if(alive&&!controller.signal.aborted&&active===controller)failure(error);}finally{if(active===controller){active=null;emit();}}}
 function unavailable(error:unknown){clearPrivate();context=null;phase=error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable';message=phase==='signed-out'?'Sign in to review this job change.':'Current job facts or access could not be verified. Reload before continuing.';}
 function originalFor(request:Request){const common={operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,jobId:request.jobId,expectedJobVersion:request.expectedJobVersion};return parseSchedulingOriginal('action'in request.payload?{schemaVersion:1,businessId:request.businessId,commandType:'operations.job.reschedule',reference:{...common,action:request.payload.action,latestAppointmentId:request.payload.latestAppointmentId}}:{schemaVersion:1,businessId:request.businessId,commandType:'operations.job.cancel',reference:common});}
 function pendingOriginal(){if(!pending)throw Error();return parseSchedulingOriginal({schemaVersion:1,businessId:pending.businessId,commandType:kind==='cancel'?'operations.job.cancel':'operations.job.reschedule',reference:pending.reference});}
 function committed(value:unknown){if(!pending)throw Error();const modern=value!==null&&typeof value==='object'&&(value as {receipt?:{schemaVersion?:unknown}}).receipt?.schemaVersion===2;const parsed=kind==='cancel'?(modern?parseAmendedCancelledJobCommitted:parseCancelledJobCommitted)(value,pending.businessId,pending.reference.operationId):parseRescheduledJobCommitted(value,pending.businessId,pending.reference.operationId),ref=pendingOriginal().reference;
  if(!('expectedJobVersion'in ref)||parsed.recoveryEpoch!==ref.recoveryEpoch||parsed.receipt.jobId!==ref.jobId||BigInt(parsed.receipt.version)!==BigInt(ref.expectedJobVersion)+1n||'action'in ref&&(!('action'in parsed.receipt)||parsed.receipt.action!==ref.action))throw Error();return parsed;
 }
 function finish(result:Result){
  if(!pending)throw Error();if(result.state==='conflict'&&result.reason==='operation'){clearPrivate();phase='pending';message='The original request conflicts with retained evidence. Keep its reference for original-request review.';return;}
  const saved=result.state==='committed'?committed(result):null;
  try{deps.store.clear(pending);}catch{clearPrivate();savedJobId=saved?.receipt.jobId??'';savedVersion=saved?.receipt.version??'';phase='pending';message=saved?'The server confirmed this change was saved. Local reference cleanup could not be verified. Check the original before another change.':'No change was saved. Local reference cleanup could not be verified. Review the original request before another change.';return;}
  pending=null;clearPrivate();context=null;
  if(!saved){phase='review';message='The saved job, operating arrangement or schedule review changed. No new change was saved. Reload the current job before continuing.';return;}
  savedJobId=saved.receipt.jobId;savedVersion=saved.receipt.version;phase='committed';message=kind==='cancel'?'Job cancellation saved. Its prior appointments, accepted terms and history remain.':'Appointment change saved. Open the job to review its confirmed and proposed times.';
 }
 async function inspect(proof:Awaited<ReturnType<typeof authentication.session>>,signal:AbortSignal){if(!pending||!eligible())throw Error();deps.store.require(pending);const result=await lookup(pendingOriginal(),proof,signal);live(signal);if(result.state!=='absent'){finish(committed(result));return;}canRetry=!!original&&context?.context.writeState==='ready'&&context.context.recoveryEpoch===pending.reference.recoveryEpoch;message=canRetry?'No committed original was found. You may retry only the unchanged original request.':'No committed original was found. The private draft is unavailable. Keep this reference for original-request review.';}
 const load=(jobId:string)=>run(async signal=>{clearPrivate();context=null;phase='loading';message='Loading the saved job and checking current access…';pending=deps.store.read();const {proof,next}=await fresh(signal);context=next;
  if(pending){phase='pending';message='Checking the original job change…';if(eligible())await inspect(proof,signal);else message='The original request belongs to a different authenticated context. Return to that context for review.';return;}
  if(deps.blockers?.some(store=>store.read()!==null)){phase='blocked';message='Review the other interrupted scheduling request before another change.';return;}
  if(!customerUuid(jobId)){phase='blocked';message='Open a saved job from Schedule to choose the visit to change.';return;}
  const saved=await api.resources(next.context.businessId,jobId,proof,signal);live(signal);if('state'in saved){phase='blocked';message='This saved job is unavailable in the current workspace.';return;}
  if(saved.head.job.state!=='scheduled'||saved.head.job.first_work_at!==null){phase='blocked';message='This form changes scheduled jobs before work starts. Active work needs its field-work workflow; cancelled and completed history stays read-only.';return;}
  resources=saved;phase='ready';message=next.context.writeState==='ready'?'Saved job loaded. Review the reason and actual facts before saving.':'Changes are paused. Saved job details are available for review.';
 },error=>{if(pending){clearPrivate();phase='pending';message='The original request could not be checked. Keep its reference and check again.';}else unavailable(error);});
 function failedSave(error:unknown){
  if(error instanceof SchedulingClientError&&['input','not_submitted'].includes(error.kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();context=null;phase='review';message='The change was not submitted. Reload the saved job before another request.';return;}catch{clearPrivate();phase='pending';message='The change was not submitted, but local reference cleanup could not be verified. Review the original request.';return;}}
  resources=null;canRetry=false;phase='pending';message='The change’s save outcome is unknown. Keep the original reference and check its status before another change.';
 }
 const save=(payload:CancelScheduledJobSave['payload']|ScheduleChangePayload)=>{
  if(active||phase!=='ready'||!resources||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context,head=resources.head;let request:Request;
  try{const common={schemaVersion:1,businessId:prior.context.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,jobId:head.job.id,expectedJobVersion:head.job.version,payload};if(kind==='cancel'&&resources.schemaVersion===2){
    if(!prior.amendedSchedulingAvailable)throw Error();const observations=new Map<string,CancellationPlanObservation>();
    for(const part of resources.scopeParts.filter(part=>part.state==='assigned')){const observation={sourceAllocationId:part.sourceAllocationId,entitlementVersionId:part.entitlementVersionId,expectedPlanId:part.planId,expectedSequence:part.planSequence},existing=observations.get(part.sourceAllocationId);if(existing&&(existing.entitlementVersionId!==observation.entitlementVersionId||existing.expectedPlanId!==observation.expectedPlanId||existing.expectedSequence!==observation.expectedSequence))throw Error();observations.set(part.sourceAllocationId,observation);}
    request=parseCancelJobCommand({...common,schemaVersion:2,payload:{...payload,allocationPlans:[...observations.values()]}});
   }else request=kind==='cancel'?parseCancelJobCommand(common):parseChangeJobScheduleSave(common);if('action'in request.payload&&(request.payload.latestAppointmentId!==head.latestAppointment.id||request.payload.action!=='propose'&&head.latestAppointment.confirmation_state!=='proposed'))throw Error();}
  catch{message='Review the reason, actual appointment facts and required confirmation or communication details. No request was submitted.';emit();return Promise.resolve();}
  let submitted=false;return run(async signal=>{const {proof,next}=await fresh(signal);if(!same(prior,next)||deps.store.read()!==null||deps.blockers?.some(store=>store.read()!==null))throw Error();context=next;const ref=originalFor(request);pending={schemaVersion:1,businessId:request.businessId,binding:next.binding,reference:ref.reference};original=request;deps.store.write(pending);submitted=true;
   const result='action'in request.payload?await api.reschedule(request as ChangeJobScheduleSave,proof,signal):await api.cancel(request as CancelJobCommand,proof,signal);live(signal);finish(result);
  },error=>{if(submitted)failedSave(error);else if(pending){clearPrivate();context=null;phase='blocked';message='The original reference could not be stored and verified. No request was submitted. Review interrupted saves before trying again.';}else unavailable(error);});
 };
 const check=()=>run(async signal=>{if(phase!=='pending'||!pending)return;canRetry=false;savedJobId='';savedVersion='';const {proof,next}=await fresh(signal);context=next;if(!eligible()){message='This original request belongs to a different authenticated context. Return to that context for review.';return;}await inspect(proof,signal);},()=>{canRetry=false;message='The original request could not be checked. Keep the reference and check again.';});
 const retry=()=>run(async signal=>{if(phase!=='pending'||!pending||!original||!canRetry)return;canRetry=false;const request=original,{proof,next}=await fresh(signal);context=next;if(!eligible()||next.context.writeState!=='ready'||next.context.recoveryEpoch!==request.recoveryEpoch)throw Error();deps.store.require(pending);const found=await lookup(pendingOriginal(),proof,signal);live(signal);if(found.state!=='absent'){finish(committed(found));return;}const result='action'in request.payload?await api.reschedule(request as ChangeJobScheduleSave,proof,signal):await api.cancel(request as CancelJobCommand,proof,signal);live(signal);finish(result);},failedSave);
 function suspend(){active?.abort();active=null;clearPrivate();context=null;phase=pending?'pending':'review';message=pending?'Private change details cleared. Load and check the original request before continuing.':'Private change form cleared. Reload the saved job before continuing.';emit();}
 return Object.freeze({view,load,save,check,retry,suspend,dispose(){alive=false;active?.abort();active=null;clearPrivate();context=null;}});
}
