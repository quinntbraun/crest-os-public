import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {vehicles} from './vehicles';
import {lookupSchedulingOriginal} from './scheduling-original';
import {parseFieldSessionSave,fieldSessionOriginal} from '../operations/field-session-contract';
import type {FieldSessionSave} from '../operations/field-session-contract';
import {completionOriginal,parseCompletionSave} from '../operations/work-completion-contract';
import type {CompletionBody,CompletionContext,CompletionSave,CompletionSummary} from '../operations/work-completion-contract';
import {parseFieldOriginal,parseFieldOriginalResult} from '../operations/field-original-contract';
import type {FieldOriginalKind} from '../operations/field-original-contract';
import {parseReviewOutcomeSave,reviewOutcomeKind,reviewOutcomeOriginal} from '../operations/review-message-contract';
import type {ReviewOutcomeBody,ReviewOutcomeContext} from '../operations/review-message-contract';
import type {PendingScheduling,createPendingSchedulingStore} from './pending-scheduling';
import {customerUuid} from '../customer/customer-contract';
import {parseTripInterruptionSave,tripInterruptionOriginal} from '../operations/trip-interruption-contract';
import type {InterruptionDraft,TripInterruptionSave} from '../operations/trip-interruption-contract';
import type {MileageTrip} from '../operations/mileage';
import {parseUnfulfilledCancellationSave,unfulfilledCancellationOriginal} from '../operations/unfulfilled-cancellation-contract';
import type {UnfulfilledCancellationContext,UnfulfilledCancellationDraft} from '../operations/unfulfilled-cancellation-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Resources=Exclude<Awaited<ReturnType<typeof scheduling.resources>>,{state:'absent'}>;
type Vehicle=Awaited<ReturnType<typeof vehicles.list>>['vehicles'][number];
type Store=ReturnType<typeof createPendingSchedulingStore>;
type Proof=Awaited<ReturnType<typeof authentication.session>>;
type FieldResult=Awaited<ReturnType<typeof scheduling.saveFieldSession>>;
export type FieldSessionMode='work'|'completion'|'interruption'|'cancellation';
export const fieldSessionKind={work:'operations.job.field',completion:'operations.job.complete',
 interruption:'operations.job.interrupt',cancellation:'operations.job.cancel_unfulfilled'} as const;
export type FieldSessionView=Readonly<{phase:'loading'|'ready'|'pending'|'review'|'blocked'|'signed-out'|'unavailable'|'committed';busy:boolean;message:string;context:Context|null;resources:Resources|null;vehicles:readonly Vehicle[];moreVehicles:boolean;reference:string;savedJobId:string;savedVersion:string;completion?:CompletionContext;summary?:CompletionSummary;reviewOutcome?:ReviewOutcomeContext;reviewOutcomeEnabled?:boolean;reviewHistoryAvailable?:true;maintenanceFollowUpAvailable?:true;canRecordReviewOutcome?:boolean;pendingKind?:FieldOriginalKind;openTrip?:MileageTrip;cancellation?:UnfulfilledCancellationContext}>;
export const initialFieldSessionView:FieldSessionView=Object.freeze({phase:'loading',busy:true,message:'Checking current work and access…',context:null,resources:null,vehicles:[],moreVehicles:false,reference:'',savedJobId:'',savedVersion:''});
// Keep only the existing opaque pending identity between navigations. Private
// work/location drafts remain in memory and are cleared on suspension.
export function createFieldSessionController(deps:{mode?:FieldSessionMode;store:Store;outcomeStore?:Store;blockers?:readonly Store[];change:(view:FieldSessionView)=>void;api?:typeof scheduling;vehicleApi?:typeof vehicles;session?:typeof authentication.session;lookup?:typeof lookupSchedulingOriginal;id?:()=>string}){
 const api=deps.api??scheduling,vehicleApi=deps.vehicleApi??vehicles,session=deps.session??authentication.session,lookup=deps.lookup??lookupSchedulingOriginal,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,context:Context|null=null,resources:Resources|null=null,rows:readonly Vehicle[]=[],hasMore=false,pending:PendingScheduling|null=null,phase:FieldSessionView['phase']='loading',message=initialFieldSessionView.message,savedJobId='',savedVersion='';
 const mode=deps.mode??'work',completing=mode==='completion',interrupting=mode==='interruption',cancelling=mode==='cancellation';
 const kind=fieldSessionKind[mode];
 let pendingKind:FieldOriginalKind=kind,routeJobId='';
 const pendingStore=()=>pendingKind===reviewOutcomeKind?deps.outcomeStore!:deps.store;
 let reviewOutcome:ReviewOutcomeContext|null=null,reviewOutcomeEnabled=false;
 let openTrip:MileageTrip|null=null;
 let completion:CompletionContext|null=null,summary:CompletionSummary|null=null,cancellation:UnfulfilledCancellationContext|null=null;
 const eligible=()=>!!pending&&!!context&&pending.businessId===context.context.businessId&&pending.binding===context.binding;
 const view=():FieldSessionView=>Object.freeze({phase,busy:!!active,message,context:phase==='ready'?context:null,resources:phase==='ready'?resources:null,vehicles:phase==='ready'?rows:[],moreVehicles:phase==='ready'&&hasMore,reference:phase==='pending'&&eligible()?pending!.reference.operationId:'',savedJobId:(phase==='committed'||phase==='pending'&&eligible())?savedJobId:'',savedVersion:(phase==='committed'||phase==='pending'&&eligible())?savedVersion:'',...(phase==='ready'&&completion?{completion}:{}),...(phase==='ready'&&openTrip?{openTrip}:{}),...(phase==='ready'&&cancellation?{cancellation}:{}),...(phase==='committed'&&summary?{summary,reviewOutcomeEnabled,...context?.reviewHistoryAvailable?{reviewHistoryAvailable:true as const}:{},...context?.maintenanceFollowUpAvailable?{maintenanceFollowUpAvailable:true as const}:{},...reviewOutcome?{reviewOutcome,canRecordReviewOutcome:context?.context.writeState==='ready'&&reviewOutcome.kind!=='owner_confirmed_sent'}:{}}:{}),...(phase==='pending'?{pendingKind}:{})});
 const emit=()=>{if(alive)deps.change(view());};
 const clear=()=>{resources=null;completion=null;summary=null;reviewOutcome=null;reviewOutcomeEnabled=false;openTrip=null;cancellation=null;rows=[];hasMore=false;savedJobId='';savedVersion='';};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch&&a.fieldSessionAvailable===b.fieldSessionAvailable&&a.dropoffCustodyAvailable===b.dropoffCustodyAvailable&&(!completing||a.jobCompletionAvailable===b.jobCompletionAvailable&&a.reviewOutcomeAvailable===b.reviewOutcomeAvailable)&&(!interrupting||a.jobMileageAvailable===b.jobMileageAvailable)&&(!cancelling||a.unfulfilledCancellationAvailable===b.unfulfilledCancellationAvailable);
 async function fresh(signal:AbortSignal){const proof=await session(signal);live(signal);const next=await api.workspace(proof,signal);live(signal);return {proof,next};}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failed:(error:unknown)=>void){if(!alive||active)return;const controller=new AbortController();active=controller;emit();try{await work(controller.signal);}catch(error){if(alive&&!controller.signal.aborted&&active===controller)failed(error);}finally{if(active===controller){active=null;emit();}}}
 function unavailable(error:unknown){clear();context=null;phase=error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable';message=phase==='signed-out'?(completing?'Sign in to review completion.':'Sign in to review work status.'):'Current work or access could not be verified. Reload before continuing.';}
 function original(){if(!pending)throw Error();return parseFieldOriginal({schemaVersion:1,businessId:pending.businessId,commandType:pendingKind,reference:pending.reference});}
 function finish(result:FieldResult){
  if(!pending)throw Error();if('state'in result&&result.reason==='operation'){clear();phase='pending';message='The original action conflicts with retained evidence. Keep its reference for Save review.';return;}
  const ref=original(),saved='state'in result?null:parseFieldOriginalResult(result,ref);if(saved&&saved.state!=='committed')throw Error();
  const confirmed=()=>{if(saved?.state==='committed'){savedJobId=ref.commandType===reviewOutcomeKind?ref.reference.jobId:saved.receipt.subjectId;savedVersion=ref.commandType===reviewOutcomeKind?'':saved.receipt.sourceVersion;}};
  try{pendingStore().clear(pending);}catch{clear();confirmed();phase='pending';message=saved?'The server confirmed the action was saved. Local reference cleanup could not be verified. Check Save review before another action.':'No action was saved. Local reference cleanup could not be verified. Check Save review.';return;}
  pending=null;clear();context=null;if(!saved){phase='review';message='state'in result&&result.reason==='custody'?'Record intake for every booked vehicle before starting work. No work action was saved.':'The saved job or work status changed. No action was saved. Reload before continuing.';return;}
  confirmed();phase='committed';
  message=ref.commandType===reviewOutcomeKind?'Review message outcome saved.':completing?'Job completion saved.':interrupting?'Trip interruption saved. Open the job to review the current appointment and history.':cancelling?'Job cancelled. Open the job to review its saved history.':'Work status saved. Open the job to reload its current status and history.';
 }
 async function loadReviewOutcome(next:Context,proof:Proof,signal:AbortSignal){
  reviewOutcomeEnabled=next.reviewOutcomeAvailable===true&&deps.outcomeStore!==undefined;
  if(!reviewOutcomeEnabled||!summary?.review.message)return;
  try{
   const loaded=await api.reviewOutcome(summary.businessId,summary.jobId,proof,signal);live(signal);
   if('state'in loaded)throw Error();
   reviewOutcome=loaded;
  }catch{live(signal);reviewOutcome=null;}
 }
 async function readSavedCompletion(next:Context,proof:Proof,signal:AbortSignal){
  if(!completing||phase!=='committed')return;
  try{
   const saved=await api.completionContext(next.context.businessId,savedJobId,proof,signal);
   live(signal);
   if('state'in saved||saved.jobState!=='completed'||BigInt(saved.jobVersion)<BigInt(savedVersion||'0'))throw Error();
   summary=saved;savedVersion=saved.jobVersion;context=next;
   await loadReviewOutcome(next,proof,signal);
  }catch{
   if(alive&&!signal.aborted&&active?.signal===signal)message=pendingKind===reviewOutcomeKind?
    'Review message outcome saved. Reload to see its saved status.':'Job completion saved. Reload to see its saved outcomes and follow-up.';
  }
 }
 async function inspect(proof:Proof,signal:AbortSignal){
  if(!pending||!eligible())throw Error();
  const next=context!,ref=original();
  pendingStore().require(pending);
  if(ref.commandType===reviewOutcomeKind&&ref.reference.jobId!==routeJobId){
   message='The interrupted message outcome belongs to a different saved job. Open that job or use Save review.';return;
  }
  const result=await lookup(ref,proof,signal);live(signal);
  if(result.state==='absent'){message='No committed original was found. Keep the reference and use Save review before another action. No request is retried automatically.';return;}
  const saved=parseFieldOriginalResult({schemaVersion:1,original:ref,result},ref);
  if(saved.state!=='committed')throw Error();
  finish({schemaVersion:1,original:ref,result:saved});
  await readSavedCompletion(next,proof,signal);
 }
 const load=(jobId:string)=>run(async signal=>{clear();context=null;phase='loading';message='Loading saved work and checking access…';routeJobId=jobId;pendingKind=kind;pending=deps.store.read();
  if(!pending&&completing&&deps.outcomeStore){pending=deps.outcomeStore.read();if(pending)pendingKind=reviewOutcomeKind;}
  const {proof,next}=await fresh(signal);context=next;
  if(pending){phase='pending';message='Checking original work action…';if(eligible())await inspect(proof,signal);else message='The interrupted action belongs to a different signed-in context. Return there for Save review.';return;}
  if(deps.blockers?.some(store=>store.read()!==null)){phase='blocked';message='Review other interrupted saves before recording work.';return;}
  if(next.fieldSessionAvailable!==true){phase='blocked';message='Work controls are not enabled in this build. Saved jobs remain available in Schedule.';return;}
  if(!customerUuid(jobId)){phase='blocked';message='Open a saved job in Schedule to record work.';return;}
  if(cancelling){
   if(next.unfulfilledCancellationAvailable!==true){phase='blocked';message='Cancellation after starting work is unavailable in this build.';return;}
   const saved=await api.cancellationContext(next.context.businessId,jobId,proof,signal);live(signal);
   if('state'in saved){phase='blocked';message='This job is no longer eligible for cancellation after starting work. Open its saved history.';return;}
   const detail=await api.resources(next.context.businessId,jobId,proof,signal);live(signal);
   if('state'in detail||detail.head.job.version!==saved.jobVersion||detail.head.job.state!==saved.jobState){
    phase='review';message='The saved job changed while loading. Reload before continuing.';return;
   }
   resources=detail;cancellation=saved;phase='ready';
   message=next.context.writeState==='ready'?'Review the saved work before cancelling.':'Changes are paused. Saved work is available for review.';
   return;
  }
  if(completing){
   if(next.jobCompletionAvailable!==true){phase='blocked';message='Job completion is unavailable in this build.';return;}
   const saved=await api.completionContext(next.context.businessId,jobId,proof,signal);live(signal);
   if('state'in saved){phase='blocked';message='Open a supported active job to record completion.';return;}
   if(saved.jobState==='completed'){summary=saved;savedJobId=saved.jobId;savedVersion=saved.jobVersion;phase='committed';message='Saved completion loaded.';await loadReviewOutcome(next,proof,signal);return;}
   completion=saved;phase='ready';
   message=next.context.writeState==='ready'?'Review the assigned work before ending this job.':'Changes are paused. Assigned work is available for review.';
   return;
  }
  const saved=await api.resources(next.context.businessId,jobId,proof,signal);live(signal);if('state'in saved){phase='blocked';message='This job is unavailable in the current workspace.';return;}
  const job=saved.head.job;
  const mobile=job.fulfillment_mode==='mobile'&&['scheduled','en_route','in_progress','paused'].includes(job.state);
  const dropoff=mode==='work'&&next.dropoffCustodyAvailable===true&&job.fulfillment_mode==='dropoff'&&['scheduled','in_progress','paused'].includes(job.state);
  if((!mobile&&!dropoff)||job.operator_actor_id!==next.context.operatorId){phase='blocked';message='Open a supported active job assigned to you to record work.';return;}
  if(interrupting){
   if(next.jobMileageAvailable!==true||job.state!=='en_route'){phase='blocked';message='Open an en-route Mobile job to record a trip interruption.';return;}
   const trips=await api.mileageTrips({businessId:next.context.businessId,jobId,after:null,pageSize:25},proof,signal);live(signal);
   const open=trips.state==='loaded'?trips.trips.filter(trip=>trip.state==='open'&&trip.purpose==='mobile_work_site'):[];
   if(open.length!==1){phase='blocked';message='The open trip could not be verified. Reload the job before making any change.';return;}
   openTrip=open[0]!;resources=saved;phase='ready';message='Saved open trip loaded.';
   return;
  }
  resources=saved;if(mobile&&job.state==='scheduled'){const page=await vehicleApi.list(next.context.businessId,{search:'',afterId:null,includeArchived:false,pageSize:50},proof,signal);live(signal);rows=page.vehicles;hasMore=page.hasMore;}
  phase='ready';message=next.context.writeState==='ready'?'Saved job loaded. Record what is happening now.':'Changes are paused. Saved work is available for review.';
 },error=>{if(pending){clear();phase='pending';message='The original action could not be verified. Keep its reference and check again.';}else unavailable(error);});
 const moreVehicles=()=>run(async signal=>{if(phase!=='ready'||!context||!resources||!hasMore||rows.length===0)return;const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();const page=await vehicleApi.list(next.context.businessId,{search:'',afterId:rows.at(-1)!.id,includeArchived:false,pageSize:50},proof,signal);live(signal);rows=Object.freeze([...rows,...page.vehicles]);hasMore=page.hasMore;},unavailable);
 function submit(prior:Context,ref:ReturnType<typeof parseFieldOriginal>,send:(proof:Proof,signal:AbortSignal)=>Promise<FieldResult>){
  let submitted=false;return run(async signal=>{const {proof,next}=await fresh(signal);if(!same(prior,next)||deps.store.read()!==null||deps.outcomeStore?.read()||deps.blockers?.some(store=>store.read()!==null))throw Error();context=next;pendingKind=ref.commandType;pending={schemaVersion:1,businessId:ref.businessId,binding:next.binding,reference:ref.reference};pendingStore().write(pending);submitted=true;const result=await send(proof,signal);live(signal);finish(result);await readSavedCompletion(next,proof,signal);},error=>{
   if(submitted){if(error instanceof SchedulingClientError&&['input','not_submitted'].includes(error.kind)&&pending){try{pendingStore().clear(pending);pending=null;clear();context=null;phase='review';message='The action was not submitted. Reload before another request.';return;}catch{clear();phase='pending';message='The action was not submitted, but local reference cleanup could not be verified. Check Save review before another action.';return;}}clear();phase='pending';message='The save outcome is unknown. Keep the original reference and check its status before another action.';}
   else if(pending){clear();context=null;phase='blocked';message='The original reference could not be stored and verified. No action was submitted. Check Save review.';}else unavailable(error);
  });
 }
 const save=(body:FieldSessionSave['body'])=>{
  if(active||mode!=='work'||phase!=='ready'||!resources||!context||context.context.writeState!=='ready')return Promise.resolve();const prior=context,job=resources.head.job;let request:FieldSessionSave;
  try{
   request=parseFieldSessionSave({schemaVersion:1,businessId:prior.context.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,jobId:job.id,expectedJobVersion:job.version,body});
   const selected=request.body.action==='depart'?request.body.trip.drivenVehicleId:null;
   if(selected&&!rows.some(row=>row.id===selected))throw Error();
   const allowed={scheduled:job.fulfillment_mode==='dropoff'?['start_dropoff']:['depart','direct_arrive'],en_route:['arrive'],in_progress:['pause'],paused:['resume']};
   if(!Object.hasOwn(allowed,job.state)||!allowed[job.state as keyof typeof allowed].includes(request.body.action))throw Error();
  }catch{message='Review the action, actual vehicle and required details. No request was submitted.';emit();return Promise.resolve();}
  return submit(prior,fieldSessionOriginal(request),(proof,signal)=>api.saveFieldSession(request,proof,signal));
 };
 const interrupt=(draft:InterruptionDraft)=>{
  if(active||!interrupting||phase!=='ready'||!openTrip||!resources||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context,{head,scopeParts}=resources;
  let request:TripInterruptionSave;
  try{
   const scope=new Map<string,TripInterruptionSave['body']['scope'][number]>();
   for(const part of scopeParts){
    if(part.state!=='assigned')throw Error();
    const observation={sourceAllocationId:part.sourceAllocationId,expectedPlanId:part.planId,
     expectedSequence:part.planSequence,entitlementVersionId:part.entitlementVersionId};
    const previous=scope.get(part.sourceAllocationId);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(observation))throw Error();
    scope.set(part.sourceAllocationId,observation);
   }
   const {action,reason,actualStop}=draft;
   request=parseTripInterruptionSave({schemaVersion:1,businessId:prior.context.businessId,operationId:id(),
    recoveryEpoch:prior.context.recoveryEpoch,jobId:head.job.id,expectedJobVersion:head.job.version,body:{
     action,reason,expectedAppointmentId:head.latestAppointment.id,
     trip:{legId:openTrip.legId,expectedLegVersionId:openTrip.legVersionId,actualStop},
     scope:[...scope.keys()].sort().map(key=>scope.get(key)!),
     ...draft.action==='cancel'?{expectedModeSequence:null,appointment:null,conflictReview:null,customerCommunication:draft.customerCommunication}
      :{expectedModeSequence:prior.context.modeVersion?.sequence,appointment:draft.appointment,conflictReview:draft.conflictReview,customerCommunication:null}
    }});
  }catch{message='Review the actual stop, reason, and appointment details. No request was submitted.';emit();return Promise.resolve();}
  return submit(prior,tripInterruptionOriginal(request),(proof,signal)=>api.interrupt(request,proof,signal));
 };
 const complete=(body:CompletionBody)=>{
  if(active||!completing||phase!=='ready'||!completion||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context,loaded=completion;
  let request:CompletionSave;
  try{
   request=parseCompletionSave({schemaVersion:1,businessId:loaded.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,
    jobId:loaded.jobId,expectedJobVersion:loaded.jobVersion,body});
   if(request.body.scope.length!==loaded.assignments.length||!loaded.assignments.every(assignment=>
    request.body.scope.some(row=>row.assignedPartId===assignment.assignedPartId&&row.expectedPlanId===assignment.planId&&row.expectedPlanSequence===assignment.planSequence)))throw Error();
  }catch{
   message='Review each assigned item and the walkthrough. No completion was submitted.';emit();return Promise.resolve();
  }
  return submit(prior,completionOriginal(request),(proof,signal)=>api.complete(request,proof,signal));
 };
 const recordReviewOutcome=(body:ReviewOutcomeBody)=>{
  if(active||!completing||phase!=='committed'||!reviewOutcome||!reviewOutcomeEnabled||reviewOutcome.kind==='owner_confirmed_sent'||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context,loaded=reviewOutcome;
  let request:ReturnType<typeof parseReviewOutcomeSave>;
  try{
   request=parseReviewOutcomeSave({schemaVersion:1,businessId:loaded.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,
    jobId:loaded.jobId,messageId:loaded.messageId,priorEventId:loaded.eventId,body});
  }catch{message='Review the message outcome and any required reason. No action was submitted.';emit();return Promise.resolve();}
  return submit(prior,reviewOutcomeOriginal(request),(proof,signal)=>api.recordReviewOutcome(request,proof,signal));
 };
 const cancelUnfulfilled=(draft:UnfulfilledCancellationDraft)=>{
  if(active||!cancelling||phase!=='ready'||!cancellation||!context||context.context.writeState!=='ready')return Promise.resolve();
  const prior=context,loaded=cancellation;
  let request:ReturnType<typeof parseUnfulfilledCancellationSave>;
  try{
   request=parseUnfulfilledCancellationSave({schemaVersion:1,businessId:loaded.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,
    jobId:loaded.jobId,expectedJobVersion:loaded.jobVersion,body:{...draft,expectedWorkIntervalId:loaded.workIntervalId,
     expectedOpenTravelLegVersionIds:loaded.openTravelLegVersionIds,scope:loaded.scope}});
  }catch{message='Confirm no work was completed and review the reason and communication. No request was submitted.';emit();return Promise.resolve();}
  return submit(prior,unfulfilledCancellationOriginal(request),(proof,signal)=>api.cancelUnfulfilled(request,proof,signal));
 };
 const check=()=>run(async signal=>{if(phase!=='pending'||!pending)return;const {proof,next}=await fresh(signal);context=next;if(!eligible()){message='This action belongs to a different signed-in context. Return there for Save review.';return;}await inspect(proof,signal);},()=>{clear();phase='pending';message='The original action could not be verified. Keep its reference and check again.';});
 function suspend(){active?.abort();active=null;clear();context=null;phase=pending?'pending':'review';message=pending?'Private details cleared. Check the original action before continuing.':'Private form cleared. Reload saved work before continuing.';emit();}
 return Object.freeze({view,load,save,complete,recordReviewOutcome,interrupt,cancelUnfulfilled,check,moreVehicles,suspend,dispose(){alive=false;active?.abort();active=null;clear();context=null;}});
}
