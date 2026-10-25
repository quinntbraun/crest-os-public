import {authentication} from './authentication';
import type {Proof} from './authentication';
import {leads} from './leads';
import {leadVehicles,LeadVehicleClientError} from './lead-vehicles';
import type {LeadVehicleSave} from './lead-vehicles';
import {customerUuid as uuid,requireCustomer as checkValue} from '../customer/customer-contract';
import {parseLeadVehicleDraft} from '../customer/lead-resource-contract';
import type {LeadVehicleDraft} from '../customer/lead-resource-contract';
import {draftFromLeadVehicle} from '../customer/lead-vehicle-contract';
import type {LeadVehicle} from '../customer/lead-vehicle-contract';
import {pendingLeadVehicle,PendingLeadVehicleError} from './pending-lead-vehicle-edit';
import type {PendingLeadVehicle,createPendingLeadVehicleStore} from './pending-lead-vehicle-edit';
type Snapshot=Awaited<ReturnType<typeof leads.context>>;
type History=Extract<Awaited<ReturnType<typeof leadVehicles.history>>,{state:'found'}>;
export type LeadVehicleEditorView=Readonly<{phase:'idle'|'loading'|'ready'|'pending'|'review'|'blocked'|'unavailable';busy:boolean;message:string;rows:readonly LeadVehicle[];hasMore:boolean;includeArchived:boolean;selected:LeadVehicle|null;draft:LeadVehicleDraft|null;history:History|null;draftIssue:string;canSave:boolean;canRetry:boolean;writesPaused:boolean;reference:string}>;
export const emptyLeadVehicleDraft:LeadVehicleDraft=Object.freeze({vehicleId:null,reportedVehicle:Object.freeze({schemaVersion:1,label:'',year:null,make:null,model:null,color:null,vin:null,plate:null,notes:null}),requestedServices:Object.freeze({schemaVersion:1,text:null}),conditionNotes:null,archived:false,archiveReason:null});
export const initialLeadVehicleEditorView:LeadVehicleEditorView=Object.freeze({phase:'idle',busy:false,message:'Load reported vehicles for this lead before making a change.',rows:Object.freeze([]),hasMore:false,includeArchived:false,selected:null,draft:null,history:null,draftIssue:'',canSave:false,canRetry:false,writesPaused:true,reference:''});
type Dependencies={businessId:string;leadId:string;store:ReturnType<typeof createPendingLeadVehicleStore>;intakeStore:{read:()=>unknown};statusStore:{read:()=>unknown};addressStore:{read:()=>unknown};change:(view:LeadVehicleEditorView)=>void;api?:typeof leadVehicles;context?:typeof leads.context;session?:typeof authentication.session;id?:()=>string};
export function createLeadVehicleEditorController(deps:Dependencies){
 checkValue(uuid(deps.businessId)&&uuid(deps.leadId));
 const businessId=deps.businessId,leadId=deps.leadId,api=deps.api??leadVehicles,context=deps.context??leads.context,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,activeSignal:AbortSignal|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingLeadVehicle|null=null,original:LeadVehicleSave|null=null;
 let phase:LeadVehicleEditorView['phase']='idle',message=initialLeadVehicleEditorView.message,rows:readonly LeadVehicle[]=[],hasMore=false,includeArchived=false,selected:LeadVehicle|null=null,draft:LeadVehicleDraft|null=null,history:History|null=null,canRetry=false;
 const siblingsClear=()=>{try{return deps.intakeStore.read()===null&&deps.statusStore.read()===null&&deps.addressStore.read()===null;}catch{return false;}};
 const clearPrivate=()=>{proof=null;snapshot=null;rows=[];hasMore=false;includeArchived=false;selected=null;draft=null;history=null;original=null;canRetry=false;};
 const dirty=()=>draft!==null&&(!selected||draftIssue()!==''||JSON.stringify(draft)!==JSON.stringify(draftFromLeadVehicle(selected)));
 function draftIssue(){if(!draft)return '';try{parseLeadVehicleDraft(draft);return '';}catch{return 'Review the reported label, optional year/details, requested work, condition and archive reason before saving.';}}
 const view=():LeadVehicleEditorView=>Object.freeze({phase,busy:!!active,message,rows:phase==='ready'?rows:Object.freeze([]),hasMore:phase==='ready'&&hasMore,includeArchived:phase==='ready'&&includeArchived,selected:phase==='ready'?selected:null,draft:phase==='ready'?draft:null,history:phase==='ready'?history:null,draftIssue:phase==='ready'?draftIssue():'',canSave:!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&dirty()&&draftIssue()===''&&siblingsClear(),canRetry:!active&&canRetry,writesPaused:snapshot?.context.writeState!=='ready',reference:phase==='pending'&&snapshot?.context.businessId===pending?.businessId?pending?.reference.operationId??'':''});
 const emit=()=>{if(alive)deps.change(view());};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||activeSignal!==signal)throw new Error();};
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
  if(!alive||active)return;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);active=controller;activeSignal=signal;emit();
  try{await work(signal);}catch(error){if(alive&&active===controller&&!controller.signal.aborted)failure(error);}finally{if(active===controller){active=null;activeSignal=null;emit();}}
 }
 async function fresh(signal:AbortSignal){const p=await session(signal);live(signal);const next=await context(p,signal);live(signal);checkValue(next.context.businessId===businessId);proof=p;snapshot=next;}
 const retain=(text:string)=>{phase='pending';message=text;rows=[];selected=null;draft=null;history=null;hasMore=false;canRetry=false;};
 const eligible=()=>siblingsClear()&&!!pending&&!!original&&!!snapshot&&pending.businessId===businessId&&pending.reference.leadId===leadId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&(['operationId','leadId','leadVehicleId','expectedVersion','recoveryEpoch'] as const).every(k=>original![k]===pending!.reference[k]);
 const load=()=>run(async signal=>{
  clearPrivate();phase='loading';message='Checking reported vehicle access…';emit();pending=deps.store.read();await fresh(signal);
  if(pending){if(pending.businessId!==businessId){phase='blocked';message='A pending vehicle report belongs to another business. Its reference has been kept for review.';return;}retain('A pending vehicle report was found. Check its original outcome before another edit.');return;}
  if(!siblingsClear()){phase='blocked';message='An intake, status or address change needs review. Resolve its original outcome before editing reported vehicles.';return;}
  const page=await api.list(businessId,{leadId,afterId:null,includeArchived:false,pageSize:10},proof!,signal);live(signal);
  if(page.state==='absent'){phase='review';message='This lead was not found. Reload the lead directory before continuing.';return;}rows=page.leadVehicles;hasMore=page.hasMore;phase='ready';message=snapshot!.context.writeState==='ready'?'Review a reported vehicle or add another report.':'Vehicle report changes are paused. Retained records remain available.';
 },error=>{clearPrivate();phase=error instanceof PendingLeadVehicleError?'blocked':'unavailable';message=error instanceof PendingLeadVehicleError?'The pending vehicle reference cannot be read. Editing is blocked to protect it.':'Reported vehicles could not be verified. Load them again; any pending reference has been kept.';});
 const query=(archived:boolean,more=false)=>{
  if(phase!=='ready'||!proof||typeof archived!=='boolean'||more&&(!hasMore||includeArchived!==archived))return Promise.resolve();const authorization=proof,afterId=more?rows.at(-1)?.id??null:null;
  return run(async signal=>{rows=[];selected=null;draft=null;history=null;hasMore=false;includeArchived=archived;emit();const page=await api.list(businessId,{leadId,afterId,includeArchived:archived,pageSize:10},authorization,signal);live(signal);if(page.state==='absent'){clearPrivate();phase='review';message='This lead was not found. Reload current lead details.';return;}rows=page.leadVehicles;hasMore=page.hasMore;message='Reported vehicle page loaded.';},()=>{clearPrivate();phase='unavailable';message='Reported vehicles could not be verified. Load current records again.';});
 };
 const open=(leadVehicleId:string)=>{
  if(phase!=='ready'||!proof||!uuid(leadVehicleId))return Promise.resolve();const authorization=proof;
  return run(async signal=>{selected=null;draft=null;history=null;emit();const page=await api.history(businessId,{leadId,leadVehicleId,afterVersion:'0',pageSize:5},authorization,signal);live(signal);if(page.state==='absent'){message='This report was not found on this lead. Reload the current vehicle reports.';return;}selected=page.leadVehicle;draft=draftFromLeadVehicle(selected);history=page;message='Review the original report, directory link and retained history before saving.';},()=>{clearPrivate();phase='unavailable';message='Vehicle report history could not be verified. Load current records again.';});
 };
 const moreHistory=()=>{
  if(phase!=='ready'||!proof||!selected||!history?.hasMore||dirty())return Promise.resolve();const current=selected,authorization=proof,afterVersion=history.history.at(-1)?.version;if(!afterVersion)return Promise.resolve();
  return run(async signal=>{history=null;emit();const page=await api.history(businessId,{leadId,leadVehicleId:current.id,afterVersion,pageSize:5},authorization,signal);live(signal);if(page.state==='absent'||page.leadVehicle.version!==current.version){selected=null;draft=null;message='The report changed while history was loading. Open its current details before editing.';return;}history=page;message='Showing the next retained vehicle history page.';},()=>{clearPrivate();phase='unavailable';message='Vehicle report history could not be verified. Load current reports again.';});
 };
 function finish(result:Awaited<ReturnType<typeof leadVehicles.save>>,lookup=false){
  if(!pending)throw new Error();if(result.state==='conflict'&&result.reason==='operation'){original=null;retain('The original vehicle reference conflicts with the recorded request. Keep it for review; a replacement is blocked.');return;}
  try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Vehicle report confirmed, but its reference could not be cleared. Check its original outcome again.':'No vehicle change was saved, but its reference could not be cleared. Check its original outcome again.');return;}
  pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original vehicle report save is confirmed. Load current reports to review it.':'Vehicle report saved. Load current reports before another edit.'):'The lead, vehicle or report version changed. Reload current reports and review before a new edit.';
 }
 const check=()=>run(async signal=>{
  pending=deps.store.read();if(!pending)throw new PendingLeadVehicleError();retain('Checking the original vehicle report save…');emit();
  if(pending.businessId!==businessId){original=null;phase='blocked';message='This vehicle reference belongs to another business. It will not be checked or sent here.';return;}await fresh(signal);
  const result=await api.lookup(businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);if(result.state==='committed'){finish(result,true);return;}
  canRetry=eligible();message=canRetry?'No completed save was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original report.':!original?'No completed save was found. The original draft is no longer in memory. Its reference has been kept for review; a replacement save is blocked.':'The original lead, sign-in, recovery or another pending change prevents retry. Keep its original reference for review.';
 },()=>{retain('The original vehicle save could not be confirmed. Keep its reference and check again before another action.');proof=null;snapshot=null;});
 function failedWrite(error:unknown,first:boolean,dispatched:boolean){
  if(!dispatched){clearPrivate();phase='blocked';message='The pending vehicle reference could not be secured. No report change was sent.';return;}
  const kind=error instanceof LeadVehicleClientError?error.kind:'unknown';if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The vehicle report was not submitted. Reload current reports before trying again.';return;}catch{/* Keep a reference whose removal is uncertain. */}}
  retain(kind==='recovery'?'Recovery review is required. The original report reference has been kept without changing its epoch.':'The vehicle report save could not be confirmed. Check its original outcome before another edit.');
 }
 const save=()=>{
  if(!view().canSave||!snapshot||!draft)return Promise.resolve();const before=snapshot,input=parseLeadVehicleDraft(draft),leadVehicleId=selected?.id,expectedVersion=selected?.version??'0';let dispatched=false,checked=false;
  return run(async signal=>{await fresh(signal);checked=true;if(snapshot!.binding!==before.binding||snapshot!.context.writeState!=='ready'||snapshot!.context.recoveryEpoch!==before.context.recoveryEpoch){clearPrivate();phase='review';message='Lead access or recovery changed. No report was sent. Reload before editing.';return;}
   if(!siblingsClear()){clearPrivate();phase='blocked';message='An intake, status or address change needs review. No vehicle report was sent.';return;}
   const command:LeadVehicleSave=Object.freeze({schemaVersion:1,operationId:id(),leadId,leadVehicleId:leadVehicleId??id(),expectedVersion,recoveryEpoch:before.context.recoveryEpoch!,draft:input});
   const {draft:unused,schemaVersion,...reference}=command;void unused;void schemaVersion;const record=pendingLeadVehicle({schemaVersion:1,businessId,binding:before.binding,reference});deps.store.write(record);pending=record;original=command;retain('Saving vehicle report…');emit();dispatched=true;
   const result=await api.save(businessId,command,proof!,signal);live(signal);finish(result);
  },error=>{if(!checked){clearPrivate();phase='unavailable';message='Lead access could not be reverified. No vehicle report was sent.';}else failedWrite(error,true,dispatched);});
 };
 const retry=()=>{
  if(!view().canRetry||!pending||!original)return Promise.resolve();const record=pending,command=original;let dispatched=false;
  return run(async signal=>{retain('Rechecking the original vehicle save before retry…');emit();deps.store.require(record);await fresh(signal);if(!eligible()){retain('The original report context is no longer eligible. Nothing was retried.');return;}deps.store.require(record);dispatched=true;const result=await api.save(businessId,command,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failedWrite(error,false,true);else retain('The original vehicle reference could not be verified. Nothing was retried. Check its outcome again.');});
 };
 function suspend(){if(!alive)return;active?.abort();active=null;activeSignal=null;clearPrivate();phase='review';message='Private vehicle report details were cleared. Reload before continuing; any original pending reference has been kept.';emit();}
 return Object.freeze({load,query,open,moreHistory,save,check,retry,view,suspend,
  create(){if(alive&&!active&&phase==='ready'&&siblingsClear()){selected=null;history=null;draft=emptyLeadVehicleDraft;message='Record only what was reported. Directory linking and ownership are separate choices.';emit();}},
  edit(value:LeadVehicleDraft){if(alive&&!active&&phase==='ready'&&draft){draft=Object.freeze({...value,reportedVehicle:Object.freeze({...value.reportedVehicle}),requestedServices:Object.freeze({...value.requestedServices})});emit();}},
  dispose(){alive=false;active?.abort();active=null;activeSignal=null;clearPrivate();pending=null;}
 });
}
