import {authentication} from './authentication';
import {scheduling,SchedulingClientError} from './scheduling';
import {maintenanceFollowUpKind,maintenanceFollowUpOriginal,parseMaintenanceFollowUpSave} from '../operations/maintenance-follow-up-contract';
import type {MaintenanceFollowUpSave} from '../operations/maintenance-follow-up-contract';
import {parseVehicle} from '../customer/vehicle-contract';
import {createPendingSchedulingStore,pendingSchedulingKeys} from './pending-scheduling';
import type {PendingScheduling} from './pending-scheduling';
import type {SchedulingOriginalKind} from '../operations/scheduling-original-contract';

type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
type Page=Awaited<ReturnType<typeof scheduling.maintenanceList>>;
type History=Awaited<ReturnType<typeof scheduling.maintenanceHistory>>;
type SavedHistory=Extract<History,{state:'found'}>;
type Entry=Page['entries'][number];
type VehicleChoice=Readonly<{id:string;label:string}>;
type Scope=Readonly<{kind:'customer';id:string;archived:boolean}|{kind:'job';id:string}>;
type SaveBody=MaintenanceFollowUpSave['body'];
export type MaintenanceScope=Scope;
export type MaintenanceHistory=SavedHistory;
export type MaintenanceAction=Exclude<SaveBody,{kind:'created'}>;
export type MaintenanceReminderView=Readonly<{
 phase:'idle'|'ready'|'unavailable'|'review'|'pending';busy:boolean;message:string;timezone:string;
 entries:readonly Entry[];more:boolean;history:SavedHistory|null;vehicles:readonly VehicleChoice[];
 canCreate:boolean;canChange:boolean;
}>;
export const initialMaintenanceReminderView:MaintenanceReminderView=Object.freeze({
 phase:'idle',busy:false,message:'Open to load saved maintenance reminders.',timezone:'',
 entries:[],more:false,history:null,vehicles:[],canCreate:false,canChange:false,
});
const conflictMessages:Readonly<Record<string,string>>={
 version:'Another save changed this reminder. Reload before editing it.',
 scope:'The customer, vehicle or source job is no longer eligible. Reload before continuing.',
 closed:'This reminder is already closed. Reload its saved history.',
 snooze:'Choose a future time to snooze the reminder.',
 rebooking:'That saved job cannot be linked to this reminder. Check the customer and vehicle.',
};
function sameContext(a:Context,b:Context){
 return a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.operatorId===b.context.operatorId&&
  a.context.timezone===b.context.timezone&&a.context.writeState===b.context.writeState&&
  a.context.recoveryEpoch===b.context.recoveryEpoch&&b.maintenanceFollowUpAvailable===true;
}

export function createMaintenanceReminderController(deps:{
 scope:Scope;businessId:string;storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;
 change:(value:MaintenanceReminderView)=>void;
 api?:Pick<typeof scheduling,'workspace'|'resources'|'maintenanceList'|'maintenanceHistory'|'saveMaintenance'>;
 session?:typeof authentication.session;id?:()=>string;
}){
 const api=deps.api??scheduling,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
 const store=createPendingSchedulingStore(deps.storage,maintenanceFollowUpKind);
 const blockers=(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[])
  .filter(kind=>kind!==maintenanceFollowUpKind).map(kind=>createPendingSchedulingStore(deps.storage,kind));
 let active:AbortController|null=null,alive=true,context:Context|null=null;
 let customerId='',vehicles:readonly VehicleChoice[]=[],entries:readonly Entry[]=[],next:Page['next']=null,history:SavedHistory|null=null;
 let phase:MaintenanceReminderView['phase']='idle',message=initialMaintenanceReminderView.message;
 const {scope,businessId}=deps;
 const mayWrite=()=>phase==='ready'&&context?.context.writeState==='ready';
 const emit=()=>{if(alive)deps.change(Object.freeze({phase,busy:active!==null,message,timezone:context?.context.timezone??'',
  entries,more:next!==null,history,vehicles,canCreate:mayWrite()&&!!customerId&&(scope.kind!=='customer'||!scope.archived),canChange:mayWrite()}));};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 function clear(){context=null;customerId='';vehicles=[];entries=[];next=null;history=null;}
 function setStatus(state:MaintenanceReminderView['phase'],text:string){phase=state;message=text;}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failed=()=>{
  clear();setStatus('unavailable','Saved reminders could not be verified. Reload to try again.');
 }){
  if(!alive||active)return;
  const controller=new AbortController();active=controller;emit();
  try{await work(controller.signal);}catch{if(alive&&!controller.signal.aborted&&active===controller)failed();}
  finally{if(active===controller){active=null;emit();}}
 }
 async function fresh(signal:AbortSignal){
  const proof=await session(signal);live(signal);
  const current=await api.workspace(proof,signal);live(signal);
  if(current.context.businessId!==businessId||current.maintenanceFollowUpAvailable!==true||
   context&&!sameContext(context,current))throw Error();
  return {proof,current};
 }
 async function readPage(signal:AbortSignal,cursor:Page['next']){
  const {proof,current}=await fresh(signal);
  if(scope.kind==='job'&&!customerId){
   const job=await api.resources(businessId,scope.id,proof,signal);live(signal);
   if('state'in job||job.head.job.state!=='completed')throw Error();
   customerId=job.head.job.customer_id;
   vehicles=job.vehicles.map(row=>{const vehicle=parseVehicle(row.vehicle_snapshot,businessId);return {id:vehicle.id,label:vehicle.label};});
  }
  if(scope.kind==='customer')customerId=scope.id;
  const page=await api.maintenanceList(businessId,{scopeKind:scope.kind,scopeId:scope.id,throughAt:null,
   afterDueAt:cursor?.effectiveDueAt??null,afterTaskId:cursor?.taskId??null},proof,signal);live(signal);
  const confirmed=await fresh(signal);
  if(!sameContext(current,confirmed.current)||page.entries.some(row=>row.record.customerId!==customerId))throw Error();
  const combined=cursor?[...entries,...page.entries]:page.entries;
  if(new Set(combined.map(row=>row.record.taskId)).size!==combined.length)throw Error();
  context=confirmed.current;entries=combined;next=page.next;
 }
 async function load(){
  await run(async signal=>{
   clear();setStatus('idle','Loading saved maintenance reminders…');emit();
   await readPage(signal,null);
   if(store.read()){setStatus('pending','Review the interrupted maintenance save before making another change.');return;}
   setStatus('ready','Saved maintenance reminders loaded.');
  });
 }
 async function more(){
  if(!next||phase!=='ready')return;
  const cursor=next;
  await run(async signal=>{await readPage(signal,cursor);message='More saved maintenance reminders loaded.';});
 }
 async function showHistory(taskId:string,more=false){
  if(phase!=='ready'||!entries.some(row=>row.record.taskId===taskId))return;
  const previous=more&&history?.taskId===taskId&&history.hasMore?history:null;
  if(more&&!previous)return;
  await run(async signal=>{
   const {proof,current}=await fresh(signal),afterVersion=previous?.entries.at(-1)?.version??'0';
   const page=await api.maintenanceHistory(businessId,{taskId,afterVersion},proof,signal);live(signal);
   const confirmed=await fresh(signal);
   if(!sameContext(current,confirmed.current)||page.state!=='found'||page.current.customerId!==customerId||
    scope.kind==='job'&&page.current.sourceJobId!==scope.id)throw Error();
   history={...page,entries:previous?[...previous.entries,...page.entries]:page.entries};
   message='Saved maintenance history loaded.';
  },()=>{clear();setStatus('unavailable','Saved history or workspace access could not be verified. Reload to try again.');});
 }
 async function save(taskId:string|null,body:SaveBody){
  if(!mayWrite()||!context)return;
  const selected=taskId===null?null:entries.find(row=>row.record.taskId===taskId)?.record;
  if(body.kind==='created'?taskId!==null||body.customerId!==customerId||
   body.sourceJobId!==(scope.kind==='job'?scope.id:null)||scope.kind==='customer'&&scope.archived||
   body.vehicleId!==null&&!vehicles.some(row=>row.id===body.vehicleId):
   !selected||!['open','snoozed'].includes(selected.state))return;
  const oldContext=context,epoch=oldContext.context.recoveryEpoch;
  if(epoch===null)return;
  let request:MaintenanceFollowUpSave;
  try{request=parseMaintenanceFollowUpSave({schemaVersion:1,businessId,operationId:id(),recoveryEpoch:epoch,
   taskId:taskId??id(),expectedVersion:selected?.version??'0',body});}
  catch{message='Enter a valid time and any required reason before saving.';emit();return;}
  const ref=maintenanceFollowUpOriginal(request);
  let retained:PendingScheduling|null=null,dispatched=false,confirmedSave=false;
  const uncertain=()=>{
   clear();setStatus('pending',confirmedSave?
    'The reminder was saved. Review the retained reference before making another change.':dispatched?
    'The save could not be confirmed. Review the original before making another change.':
    'The reminder was not submitted. Review the local reference before making another change.');
  };
  await run(async signal=>{
   const {proof,current}=await fresh(signal);
   if(!sameContext(oldContext,current)||current.context.writeState!=='ready')throw Error();
   if(store.read()||blockers.some(item=>item.read())){
    clear();setStatus('pending','Review interrupted saves before changing maintenance reminders.');return;
   }
   retained={schemaVersion:1,businessId,binding:current.binding,reference:ref.reference};
   store.write(retained);dispatched=true;
   const result=await api.saveMaintenance(request,proof,signal).catch((error:unknown)=>{
    if(error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
     live(signal);store.clear(retained!);retained=null;
     if(error.kind==='recovery'){clear();setStatus('review','Changes are paused for recovery review. Reload before continuing.');}
     else message=error.kind==='limited'?'Too many requests. Wait before trying again.':'The reminder was not submitted.';
     return null;
    }
    throw error;
   });live(signal);
   if(!result)return;
   if('state'in result&&result.reason==='operation'){uncertain();return;}
   confirmedSave=!('state'in result);
   store.clear(retained);retained=null;history=null;
   if('state'in result){
    if(result.reason==='snooze'||result.reason==='rebooking'){message=conflictMessages[result.reason]!;return;}
    clear();setStatus('review',conflictMessages[result.reason]??'Reload saved reminders before continuing.');return;
   }
   await readPage(signal,null);
   message='Maintenance reminder saved.';
  },()=>{
   if(retained){uncertain();return;}
   clear();setStatus('review',confirmedSave?'Maintenance reminder saved. Reload to see its current status.':
    'The reminder was not submitted. Reload to verify access and saved records.');
  });
  return confirmedSave;
 }
 function suspend(){
  active?.abort();active=null;clear();setStatus('idle',initialMaintenanceReminderView.message);emit();
 }
 return Object.freeze({load,more,showHistory,closeHistory:()=>{history=null;emit();},
  create:(dueAt:string,vehicleId:string|null,reason:string|null)=>save(null,{kind:'created',customerId,
   sourceJobId:scope.kind==='job'?scope.id:null,vehicleId,dueAt,reason}),
  change:(taskId:string,body:MaintenanceAction)=>save(taskId,body),suspend,dispose:()=>{alive=false;suspend();}});
}
