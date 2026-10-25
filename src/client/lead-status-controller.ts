import {authentication} from './authentication';
import type {Proof} from './authentication';
import {leads} from './leads';
import {leadStates,LeadStateClientError} from './lead-states';
import type {createPendingLeadStore} from './pending-lead-edit';
import type {LeadStateChange} from './lead-states';
import {customerUuid as uuid,requireCustomer as checkValue} from '../customer/customer-contract';
import type {Lead} from '../customer/lead-contract';
import {manualLeadTargets,parseLeadStateDraft} from '../customer/lead-state-contract';
import type {LeadEvent,ManualLeadTarget} from '../customer/lead-state-contract';
import {pendingLeadState,PendingLeadStateError} from './pending-lead-state-edit';
import type {PendingLeadState,createPendingLeadStateStore} from './pending-lead-state-edit';
type Snapshot=Awaited<ReturnType<typeof leads.context>>;
export type LeadStatusDraft=Readonly<{toState:ManualLeadTarget;reason:string|null}>;
export type LeadStatusView=Readonly<{phase:'idle'|'loading'|'ready'|'pending'|'review'|'blocked'|'unavailable';busy:boolean;message:string;source:Lead|null;events:readonly LeadEvent[];hasMore:boolean;draft:LeadStatusDraft|null;draftIssue:string;canSave:boolean;canRetry:boolean;writesPaused:boolean;reference:string}>;
export const initialLeadStatusView:LeadStatusView=Object.freeze({phase:'idle',busy:false,message:'Load current lead status and retained reasons before making a change.',source:null,events:Object.freeze([]),hasMore:false,draft:null,draftIssue:'',canSave:false,canRetry:false,writesPaused:true,reference:''});
type Dependencies={businessId:string;leadId:string;store:ReturnType<typeof createPendingLeadStateStore>;intakeStore:Pick<ReturnType<typeof createPendingLeadStore>,'read'>;vehicleStore:{read:()=>unknown};addressStore:{read:()=>unknown};change:(view:LeadStatusView)=>void;api?:typeof leadStates;leadApi?:Pick<typeof leads,'context'|'history'>;session?:typeof authentication.session;id?:()=>string;committed?:(leadId:string)=>void};
export function createLeadStatusController(deps:Dependencies){
 checkValue(uuid(deps.businessId)&&uuid(deps.leadId));
 const businessId=deps.businessId,leadId=deps.leadId,api=deps.api??leadStates,leadApi=deps.leadApi??leads,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,activeSignal:AbortSignal|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingLeadState|null=null,original:LeadStateChange|null=null;
 let phase:LeadStatusView['phase']='idle',message=initialLeadStatusView.message,source:Lead|null=null,events:readonly LeadEvent[]=[],hasMore=false,draft:LeadStatusDraft|null=null,canRetry=false;
 const intakeClear=()=>{try{return deps.intakeStore.read()===null&&deps.vehicleStore.read()===null&&deps.addressStore.read()===null;}catch{return false;}};
 const clearPrivate=()=>{proof=null;snapshot=null;source=null;events=[];hasMore=false;draft=null;original=null;canRetry=false;};
 function draftIssue(){if(!draft||!source)return '';try{parseLeadStateDraft({fromState:source.state,...draft});return '';}catch{return 'Choose a different manual status. Lost and reopening Lost or Won require a meaningful reason of at most 1,000 characters.';}}
 function view():LeadStatusView{return Object.freeze({phase,busy:!!active,message,source:phase==='ready'?source:null,events:phase==='ready'?events:Object.freeze([]),hasMore:phase==='ready'&&hasMore,draft:phase==='ready'?draft:null,draftIssue:phase==='ready'?draftIssue():'',canSave:!active&&phase==='ready'&&!!source&&!!draft&&snapshot?.context.writeState==='ready'&&intakeClear()&&draftIssue()==='',canRetry:!active&&canRetry,writesPaused:snapshot?.context.writeState!=='ready',reference:phase==='pending'&&snapshot?.context.businessId===pending?.businessId?pending?.reference.operationId??'':''});}
 const emit=()=>{if(alive)deps.change(view());};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||activeSignal!==signal)throw new Error();};
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
  if(!alive||active)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);active=controller;activeSignal=signal;emit();
  try{await work(signal);}catch(error){if(alive&&active===controller&&!controller.signal.aborted)failure(error);}finally{if(active===controller){active=null;activeSignal=null;emit();}}
 }
 async function fresh(signal:AbortSignal){const nextProof=await session(signal);live(signal);const next=await leadApi.context(nextProof,signal);live(signal);checkValue(next.context.businessId===businessId);proof=nextProof;snapshot=next;}
 const retain=(text:string)=>{phase='pending';message=text;canRetry=false;source=null;events=[];hasMore=false;draft=null;};
 const eligible=()=>!!pending&&!!original&&!!snapshot&&pending.businessId===businessId&&pending.reference.leadId===leadId&&intakeClear()&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&(['operationId','leadId','expectedVersion','recoveryEpoch'] as const).every(k=>original![k]===pending!.reference[k]);
 const load=()=>run(async signal=>{
  clearPrivate();phase='loading';message='Checking current lead status…';emit();pending=deps.store.read();await fresh(signal);
  if(pending){if(pending.businessId!==businessId){phase='blocked';message='A pending status change belongs to a different business. Its reference has been kept for review.';return;}retain(pending.reference.leadId===leadId?'A pending status change was found. Check its original outcome before another status change.':'A pending status change belongs to another lead. Check its original outcome before another status change.');return;}
  if(!intakeClear()){phase='blocked';message='An intake save is pending or its reference cannot be read, or a vehicle report or address needs review. Resolve that save before another status change.';return;}
  const current=await leadApi.history(businessId,{leadId,afterVersion:'0',pageSize:1},proof!,signal);live(signal);
  if(current.state==='absent'){phase='review';message='This lead was not found. Load the current lead directory before continuing.';return;}
  const page=await api.events(businessId,{leadId,afterVersion:'0',pageSize:20},proof!,signal);live(signal);
  checkValue(page.state==='found'&&page.leadVersion===current.lead.version);source=current.lead;events=page.events;hasMore=page.hasMore;phase='ready';message=snapshot!.context.writeState==='ready'?'Review the current status and retained reasons, then choose an explicit change.':'Status changes are paused. Retained status history remains available.';
 },error=>{clearPrivate();phase=error instanceof PendingLeadStateError?'blocked':'unavailable';message=error instanceof PendingLeadStateError?'The pending status reference cannot be read. Status changes are blocked to protect it.':'Current lead status or history could not be verified. Load it again; any pending reference has been kept.';});
 const more=()=>{
  if(phase!=='ready'||!source||!proof||!hasMore)return Promise.resolve();const current=source,after=events.at(-1)?.lead_version,authorization=proof;if(!after)return Promise.resolve();
  return run(async signal=>{source=null;events=[];hasMore=false;draft=null;emit();const page=await api.events(businessId,{leadId,afterVersion:after,pageSize:20},authorization,signal);live(signal);if(page.state==='absent'||page.leadVersion!==current.version){clearPrivate();phase='review';message='The lead changed while history was loading. Load current status before another change.';return;}source=current;events=page.events;hasMore=page.hasMore;message='Showing the next retained status history page.';},()=>{clearPrivate();phase='unavailable';message='Status history could not be verified. Load current status again.';});
 };
 function finish(result:Awaited<ReturnType<typeof leadStates.change>>,lookup=false){
  if(!pending)throw new Error();
  if(result.state==='conflict'&&result.reason==='operation'){retain('The status reference conflicts with the recorded request. Keep it for review; a replacement is blocked.');original=null;return;}
  try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Status save confirmed, but its reference could not be cleared. Check its original outcome before another change.':'No status change was saved, but its reference could not be cleared. Check its original outcome before another change.');return;}
  const changedLeadId=result.state==='committed'?pending.reference.leadId:null;
  pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original status change is confirmed. Load current status to review it.':'Status change saved. Load current status before another change.'):'The lead, version or status changed. Load current status and review before starting a new change.';
  if(changedLeadId){try{deps.committed?.(changedLeadId);}catch{message='Status change confirmed. Load current lead details before continuing.';}}
 }
 const check=()=>run(async signal=>{
  pending=deps.store.read();if(!pending)throw new PendingLeadStateError();retain('Checking the original status change…');emit();
  if(pending.businessId!==businessId){original=null;phase='blocked';message='This status reference belongs to a different business. It will not be checked or sent here.';return;}await fresh(signal);
  const result=await api.lookup(businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);if(result.state==='committed'){finish(result,true);return;}
  canRetry=eligible();message=canRetry?'No completed status change was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original change.':!original?'No completed status change was found. The original draft is no longer in memory. Its reference has been kept for review; a replacement is blocked.':'No completed status change was found. The original lead, sign-in or recovery context changed, or writes are paused. Keep its reference for review.';
 },()=>{retain('The original status change could not be confirmed. Keep its reference and check again before another action.');proof=null;snapshot=null;});
 function failedWrite(error:unknown,first:boolean,dispatched:boolean){
  if(!dispatched){clearPrivate();phase='blocked';message='The pending status reference could not be secured. No status change was sent.';return;}
  const kind=error instanceof LeadStateClientError?error.kind:'unknown';
  if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The status change was not submitted. Load current status and review before trying again.';return;}catch{/* Retain a reference whose removal is unconfirmed. */}}
  retain(kind==='recovery'?'Recovery review is required. The original status change has been kept without changing its epoch.':'The status change could not be confirmed. Check its original outcome before another action.');
 }
 const save=()=>{
  if(!view().canSave||!source||!draft||!snapshot)return Promise.resolve();const expectedVersion=source.version,context=snapshot,input=parseLeadStateDraft({fromState:source.state,...draft});let checkedContext=false,dispatched=false;
  return run(async signal=>{
   await fresh(signal);checkedContext=true;
   if(snapshot!.binding!==context.binding||snapshot!.context.writeState!=='ready'||snapshot!.context.recoveryEpoch!==context.context.recoveryEpoch){clearPrivate();phase='review';message='Lead access or recovery changed. No status change was sent. Load current status before editing.';return;}
   if(!intakeClear()){clearPrivate();phase='blocked';message='An intake save, vehicle report or address needs review. No status change was sent.';return;}
   const command:LeadStateChange=Object.freeze({schemaVersion:1,operationId:id(),leadId,expectedVersion,recoveryEpoch:context.context.recoveryEpoch!,draft:input});
   const record=pendingLeadState({schemaVersion:1,businessId,binding:context.binding,reference:{operationId:command.operationId,leadId,expectedVersion:command.expectedVersion,recoveryEpoch:command.recoveryEpoch}});
   deps.store.write(record);pending=record;original=command;retain('Saving status change…');emit();dispatched=true;const result=await api.change(businessId,command,proof!,signal);live(signal);finish(result);
  },error=>{if(!checkedContext){clearPrivate();phase='unavailable';message='Lead access could not be reverified. No status change was sent.';}else failedWrite(error,true,dispatched);});
 };
 const retry=()=>{
  if(!view().canRetry||!pending||!original)return Promise.resolve();const record=pending,command=original;let dispatched=false;
  return run(async signal=>{retain('Rechecking before retrying the original status change…');emit();deps.store.require(record);await fresh(signal);if(!eligible()){retain('The original lead, sign-in or recovery context is no longer eligible. Nothing was retried.');return;}deps.store.require(record);dispatched=true;const result=await api.change(businessId,command,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failedWrite(error,false,true);else retain('The original status reference could not be verified. Check its outcome again; nothing was retried.');});
 };
 function suspend(){if(!alive)return;active?.abort();active=null;activeSignal=null;clearPrivate();phase='review';message='Private status details were cleared. Load current status before continuing; any pending reference has been kept.';emit();}
 return Object.freeze({load,more,save,check,retry,view,suspend,
  choose(toState:ManualLeadTarget){if(!alive||active||phase!=='ready'||!source||!manualLeadTargets.includes(toState)||toState===source.state||source.state==='won'&&toState==='lost')return;draft=Object.freeze({toState,reason:draft?.reason??null});emit();},
  reason(value:string|null){if(alive&&!active&&phase==='ready'&&draft&&(value===null||typeof value==='string')){draft=Object.freeze({...draft,reason:value===''?null:value});emit();}},
  dispose(){alive=false;active?.abort();active=null;activeSignal=null;clearPrivate();pending=null;}
 });
}
