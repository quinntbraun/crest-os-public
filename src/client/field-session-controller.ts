import {authentication,AuthenticationError} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {vehicles} from './vehicles';
import {lookupSchedulingOriginal} from './scheduling-original';
import {parseFieldSessionSave,fieldSessionOriginal} from '../operations/field-session-contract';
import type {FieldSessionSave} from '../operations/field-session-contract';
import {parseFieldOriginal,parseFieldOriginalResult} from '../operations/field-original-contract';
import type {PendingScheduling,createPendingSchedulingStore} from './pending-scheduling';
import {customerUuid} from '../customer/customer-contract';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Resources=Exclude<Awaited<ReturnType<typeof scheduling.resources>>,{state:'absent'}>;
type Vehicle=Awaited<ReturnType<typeof vehicles.list>>['vehicles'][number];
type Store=ReturnType<typeof createPendingSchedulingStore>;
export type FieldSessionView=Readonly<{phase:'loading'|'ready'|'pending'|'review'|'blocked'|'signed-out'|'unavailable'|'committed';busy:boolean;message:string;context:Context|null;resources:Resources|null;vehicles:readonly Vehicle[];moreVehicles:boolean;reference:string;savedJobId:string;savedVersion:string}>;
export const initialFieldSessionView:FieldSessionView=Object.freeze({phase:'loading',busy:true,message:'Checking current work and access…',context:null,resources:null,vehicles:[],moreVehicles:false,reference:'',savedJobId:'',savedVersion:''});
// Keep only the existing opaque pending identity between navigations. Private
// work/location drafts remain in memory and are cleared on suspension.
export function createFieldSessionController(deps:{store:Store;blockers?:readonly Store[];change:(view:FieldSessionView)=>void;api?:typeof scheduling;vehicleApi?:typeof vehicles;session?:typeof authentication.session;lookup?:typeof lookupSchedulingOriginal;id?:()=>string}){
 const api=deps.api??scheduling,vehicleApi=deps.vehicleApi??vehicles,session=deps.session??authentication.session,lookup=deps.lookup??lookupSchedulingOriginal,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,context:Context|null=null,resources:Resources|null=null,rows:readonly Vehicle[]=[],hasMore=false,pending:PendingScheduling|null=null,phase:FieldSessionView['phase']='loading',message=initialFieldSessionView.message,savedJobId='',savedVersion='';
 const eligible=()=>!!pending&&!!context&&pending.businessId===context.context.businessId&&pending.binding===context.binding;
 const view=():FieldSessionView=>Object.freeze({phase,busy:!!active,message,context:phase==='ready'?context:null,resources:phase==='ready'?resources:null,vehicles:phase==='ready'?rows:[],moreVehicles:phase==='ready'&&hasMore,reference:phase==='pending'&&eligible()?pending!.reference.operationId:'',savedJobId:(phase==='committed'||phase==='pending'&&eligible())?savedJobId:'',savedVersion:(phase==='committed'||phase==='pending'&&eligible())?savedVersion:''});
 const emit=()=>{if(alive)deps.change(view());};
 const clear=()=>{resources=null;rows=[];hasMore=false;savedJobId='';savedVersion='';};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch&&a.fieldSessionAvailable===b.fieldSessionAvailable;
 async function fresh(signal:AbortSignal){const proof=await session(signal);live(signal);const next=await api.workspace(proof,signal);live(signal);return {proof,next};}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failed:(error:unknown)=>void){if(!alive||active)return;const controller=new AbortController();active=controller;emit();try{await work(controller.signal);}catch(error){if(alive&&!controller.signal.aborted&&active===controller)failed(error);}finally{if(active===controller){active=null;emit();}}}
 function unavailable(error:unknown){clear();context=null;phase=error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable';message=phase==='signed-out'?'Sign in to review work status.':'Current work or access could not be verified. Reload before continuing.';}
 function original(){if(!pending)throw Error();return parseFieldOriginal({schemaVersion:1,businessId:pending.businessId,commandType:'operations.job.field',reference:pending.reference});}
 function finish(result:Awaited<ReturnType<typeof scheduling.saveFieldSession>>){
  if(!pending)throw Error();if('state'in result&&result.reason==='operation'){clear();phase='pending';message='The original action conflicts with retained evidence. Keep its reference for Save review.';return;}
  const saved='state'in result?null:parseFieldOriginalResult(result,original());if(saved&&saved.state!=='committed')throw Error();
  try{deps.store.clear(pending);}catch{clear();if(saved&&saved.state==='committed'){savedJobId=saved.receipt.subjectId;savedVersion=saved.receipt.sourceVersion;}phase='pending';message=saved?'The server confirmed the action was saved. Local reference cleanup could not be verified. Check Save review before another action.':'No action was saved. Local reference cleanup could not be verified. Check Save review.';return;}
  pending=null;clear();context=null;if(!saved){phase='review';message='The saved job or work status changed. No action was saved. Reload before continuing.';return;}
  savedJobId=saved.receipt.subjectId;savedVersion=saved.receipt.sourceVersion;phase='committed';message='Work status saved. Open the job to reload its current status and history.';
 }
 async function inspect(proof:Awaited<ReturnType<typeof authentication.session>>,signal:AbortSignal){if(!pending||!eligible())throw Error();deps.store.require(pending);const ref=original(),result=await lookup(ref,proof,signal);live(signal);if(result.state==='absent'){message='No committed original was found. Keep the reference and use Save review before another action. No request is retried automatically.';return;}const saved=parseFieldOriginalResult({schemaVersion:1,original:ref,result},ref);if(saved.state!=='committed')throw Error();finish({schemaVersion:1,original:ref,result:saved});}
 const load=(jobId:string)=>run(async signal=>{clear();context=null;phase='loading';message='Loading saved work and checking access…';pending=deps.store.read();const {proof,next}=await fresh(signal);context=next;
  if(pending){phase='pending';message='Checking original work action…';if(eligible())await inspect(proof,signal);else message='The interrupted action belongs to a different signed-in context. Return there for Save review.';return;}
  if(deps.blockers?.some(store=>store.read()!==null)){phase='blocked';message='Review other interrupted saves before recording work.';return;}
  if(next.fieldSessionAvailable!==true){phase='blocked';message='Work controls are not enabled in this build. Saved jobs remain available in Schedule.';return;}
  if(!customerUuid(jobId)){phase='blocked';message='Open a saved job in Schedule to record work.';return;}
  const saved=await api.resources(next.context.businessId,jobId,proof,signal);live(signal);if('state'in saved){phase='blocked';message='This job is unavailable in the current workspace.';return;}
  const job=saved.head.job;if(job.fulfillment_mode!=='mobile'||job.operator_actor_id!==next.context.operatorId||!['scheduled','en_route','in_progress','paused'].includes(job.state)){phase='blocked';message='These controls support the assigned operator’s active Mobile jobs. Completed, cancelled and custody workflows remain separate.';return;}
  resources=saved;if(job.state==='scheduled'){const page=await vehicleApi.list(next.context.businessId,{search:'',afterId:null,includeArchived:false,pageSize:50},proof,signal);live(signal);rows=page.vehicles;hasMore=page.hasMore;}
  phase='ready';message=next.context.writeState==='ready'?'Saved job loaded. Record what is happening now.':'Changes are paused. Saved work is available for review.';
 },error=>{if(pending){clear();phase='pending';message='The original action could not be verified. Keep its reference and check again.';}else unavailable(error);});
 const moreVehicles=()=>run(async signal=>{if(phase!=='ready'||!context||!resources||!hasMore||rows.length===0)return;const prior=context,{proof,next}=await fresh(signal);if(!same(prior,next))throw Error();const page=await vehicleApi.list(next.context.businessId,{search:'',afterId:rows.at(-1)!.id,includeArchived:false,pageSize:50},proof,signal);live(signal);rows=Object.freeze([...rows,...page.vehicles]);hasMore=page.hasMore;},unavailable);
 const save=(body:FieldSessionSave['body'])=>{
  if(active||phase!=='ready'||!resources||!context||context.context.writeState!=='ready')return Promise.resolve();const prior=context,job=resources.head.job;let request:FieldSessionSave;
  try{request=parseFieldSessionSave({schemaVersion:1,businessId:prior.context.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,jobId:job.id,expectedJobVersion:job.version,body});const selected=request.body.action==='depart'?request.body.trip.drivenVehicleId:null;if(selected&&!rows.some(row=>row.id===selected))throw Error();const allowed={scheduled:['depart','direct_arrive'],en_route:['arrive'],in_progress:['pause'],paused:['resume']};if(!Object.hasOwn(allowed,job.state)||!allowed[job.state as keyof typeof allowed].includes(request.body.action))throw Error();}catch{message='Review the action, actual vehicle and required details. No request was submitted.';emit();return Promise.resolve();}
  let submitted=false;return run(async signal=>{const {proof,next}=await fresh(signal);if(!same(prior,next)||deps.store.read()!==null||deps.blockers?.some(store=>store.read()!==null))throw Error();context=next;const ref=fieldSessionOriginal(request);pending={schemaVersion:1,businessId:request.businessId,binding:next.binding,reference:ref.reference};deps.store.write(pending);submitted=true;const result=await api.saveFieldSession(request,proof,signal);live(signal);finish(result);},error=>{
   if(submitted){if(error instanceof SchedulingClientError&&['input','not_submitted'].includes(error.kind)&&pending){try{deps.store.clear(pending);pending=null;clear();context=null;phase='review';message='The action was not submitted. Reload before another request.';return;}catch{clear();phase='pending';message='The action was not submitted, but local reference cleanup could not be verified. Check Save review before another action.';return;}}clear();phase='pending';message='The save outcome is unknown. Keep the original reference and check its status before another action.';}
   else if(pending){clear();context=null;phase='blocked';message='The original reference could not be stored and verified. No action was submitted. Check Save review.';}else unavailable(error);
  });
 };
 const check=()=>run(async signal=>{if(phase!=='pending'||!pending)return;const {proof,next}=await fresh(signal);context=next;if(!eligible()){message='This action belongs to a different signed-in context. Return there for Save review.';return;}await inspect(proof,signal);},()=>{clear();phase='pending';message='The original action could not be verified. Keep its reference and check again.';});
 function suspend(){active?.abort();active=null;clear();context=null;phase=pending?'pending':'review';message=pending?'Private details cleared. Check the original action before continuing.':'Private form cleared. Reload saved work before continuing.';emit();}
 return Object.freeze({view,load,save,check,moreVehicles,suspend,dispose(){alive=false;active?.abort();active=null;clear();context=null;}});
}
