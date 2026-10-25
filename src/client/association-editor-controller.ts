import {authentication} from './authentication';
import type {Proof} from './authentication';
import {associations,associationReference,AssociationClientError} from './associations';
import type {AssociationCommand} from './associations';
import {customers} from './customers';
import {customerUuid as uuid,requireCustomer as requireValue} from '../customer/customer-contract';
import {parseAssociationBody} from '../customer/association-command-contract';
import type {AssociationBody} from '../customer/association-command-contract';
import type {VehicleAssociationRow} from '../customer/vehicle-association-contract';
import {pendingAssociation,PendingAssociationError} from './pending-association-edit';
import type {PendingAssociation,createPendingAssociationStore} from './pending-association-edit';

export type AssociationDraft=Readonly<Pick<AssociationBody,'action'|'customerId'|'effectiveAt'|'relationship'|'isBilling'|'evidence'|'reason'>>;
type CustomerChoice=Readonly<{id:string;label:string;archived:boolean}>;
type Link=Readonly<{source:VehicleAssociationRow;customer:CustomerChoice}>;
type Snapshot=Awaited<ReturnType<typeof associations.context>>;
type History=Extract<Awaited<ReturnType<typeof associations.history>>,{state:'found'}>;
export type AssociationEditorView=Readonly<{phase:'idle'|'loading'|'ready'|'pending'|'review'|'blocked'|'unavailable';busy:boolean;message:string;rows:readonly Link[];hasMore:boolean;customers:readonly CustomerChoice[];customerSearch:string;customerHasMore:boolean;selectedCustomer:CustomerChoice|null;selected:VehicleAssociationRow|null;draft:AssociationDraft|null;draftIssue:string;history:History|null;canSave:boolean;canRetry:boolean;writesPaused:boolean;reference:string}>;
export const initialAssociationEditorView:AssociationEditorView=Object.freeze({phase:'idle',busy:false,message:'Load customer links to review or change this vehicle’s owner, keeper or billing selection.',rows:Object.freeze([]),hasMore:false,customers:Object.freeze([]),customerSearch:'',customerHasMore:false,selectedCustomer:null,selected:null,draft:null,draftIssue:'',history:null,canSave:false,canRetry:false,writesPaused:true,reference:''});
type Dependencies={businessId:string;vehicleId:string;store:ReturnType<typeof createPendingAssociationStore>;change:(view:AssociationEditorView)=>void;api?:typeof associations;customerApi?:Pick<typeof customers,'list'|'history'>;session?:typeof authentication.session;id?:()=>string};
export function createAssociationEditorController(deps:Dependencies){
 requireValue(uuid(deps.businessId)&&uuid(deps.vehicleId));
 const api=deps.api??associations,customerApi=deps.customerApi??customers,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID()),businessId=deps.businessId,vehicleId=deps.vehicleId;
 let alive=true,active:AbortController|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingAssociation|null=null,original:AssociationCommand|null=null;
 let phase:AssociationEditorView['phase']='idle',message=initialAssociationEditorView.message,rows:readonly Link[]=[],hasMore=false,choices:readonly CustomerChoice[]=[],customerSearch='',customerHasMore=false,selectedCustomer:CustomerChoice|null=null,selected:VehicleAssociationRow|null=null,draft:AssociationDraft|null=null,history:History|null=null,canRetry=false;
 const clearPrivate=()=>{proof=null;snapshot=null;rows=[];hasMore=false;choices=[];customerSearch='';customerHasMore=false;selectedCustomer=null;selected=null;draft=null;history=null;original=null;canRetry=false;};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||!active)throw new Error();};
 const emit=()=>{if(alive)deps.change(view());};
 const placeholder='00000000-0000-0000-0000-000000000001',nextPlaceholder='00000000-0000-0000-0000-000000000002';
 function draftIssue(){
  if(!draft)return '';
  try{
   parseAssociationBody({...draft,vehicleId,associationId:selected?.id??placeholder,nextAssociationId:draft.action==='transfer'?(selected?.id===nextPlaceholder?placeholder:nextPlaceholder):null});
   requireValue(selectedCustomer?.id===draft.customerId);
   if(draft.action!=='open')requireValue(!!selected&&selected.valid_to===null&&selected.version==='1'&&draft.effectiveAt>=selected.valid_from);
  }catch{return 'Choose the customer, relationship and billing selection, review the effective time, and enter a reason when ending a link.';}
  const wire={schemaVersion:1,operationId:placeholder,recoveryEpoch:placeholder,expectedVersion:draft.action==='open'?'0':'1',...draft,vehicleId,associationId:selected?.id??placeholder,nextAssociationId:draft.action==='transfer'?(selected?.id===nextPlaceholder?placeholder:nextPlaceholder):null};
  return new TextEncoder().encode(JSON.stringify(wire)).byteLength>8192?'This change is too large to send. Shorten its evidence or reason.':'';
 }
 function view():AssociationEditorView{return Object.freeze({phase,busy:!!active,message,rows:phase==='ready'?rows:Object.freeze([]),hasMore:phase==='ready'&&hasMore,customers:phase==='ready'?choices:Object.freeze([]),customerSearch:phase==='ready'?customerSearch:'',customerHasMore:phase==='ready'&&customerHasMore,selectedCustomer:phase==='ready'?selectedCustomer:null,selected:phase==='ready'?selected:null,draft:phase==='ready'?draft:null,draftIssue:phase==='ready'?draftIssue():'',history:phase==='ready'?history:null,canSave:!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&draft!==null&&draftIssue()==='',canRetry:!active&&canRetry,writesPaused:snapshot?.context.writeState!=='ready',reference:phase==='pending'?pending?.reference.operationId??'':''});}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
  if(!alive||active)return;const controller=new AbortController();active=controller;const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);emit();
  try{await work(signal);}catch(error){if(alive&&active===controller&&!controller.signal.aborted)failure(error);}finally{if(active===controller){active=null;emit();}}
 }
 async function fresh(signal:AbortSignal){const nextProof=await session(signal);live(signal);const next=await api.context(businessId,vehicleId,nextProof,signal);live(signal);requireValue(next.context.businessId===businessId&&next.context.vehicleId===vehicleId);proof=nextProof;snapshot=next;}
 async function customerLabel(customerId:string,signal:AbortSignal):Promise<CustomerChoice>{
  const result=await customerApi.history(businessId,{customerId,afterVersion:'0',pageSize:1},proof!,signal);live(signal);requireValue(result.state==='found'&&result.customer.id===customerId&&result.customer.business_id===businessId);
  return Object.freeze({id:result.customer.id,label:result.customer.display_name,archived:result.customer.archived_at!==null});
 }
 async function list(signal:AbortSignal,afterId:string|null=null){
  const page=await api.list(businessId,{vehicleId,afterId,pageSize:10},proof!,signal);live(signal);const labels=new Map<string,CustomerChoice>();
  // At most ten unique label reads, using existing authorized commands. Never
  // retain contact fields/history in the label map or silently retry failures.
  for(const row of page.associations)if(!labels.has(row.customer_id))labels.set(row.customer_id,await customerLabel(row.customer_id,signal));
  live(signal);rows=Object.freeze(page.associations.map(source=>Object.freeze({source,customer:labels.get(source.customer_id)!})));hasMore=page.hasMore;
 }
 const retain=(text:string)=>{phase='pending';message=text;canRetry=false;rows=[];hasMore=false;choices=[];customerHasMore=false;customerSearch='';selectedCustomer=null;selected=null;draft=null;history=null;};
 const reference=(c:AssociationCommand)=>associationReference({operationId:c.operationId,recoveryEpoch:c.recoveryEpoch,expectedVersion:c.expectedVersion,action:c.body.action,associationId:c.body.associationId,vehicleId:c.body.vehicleId,nextAssociationId:c.body.nextAssociationId});
 const eligible=()=>!!pending&&!!original&&!!snapshot&&pending.businessId===businessId&&pending.reference.vehicleId===vehicleId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&(['operationId','recoveryEpoch','expectedVersion','action','associationId','vehicleId','nextAssociationId'] as const).every(k=>reference(original!)[k]===pending!.reference[k]);
 const load=()=>run(async signal=>{
  clearPrivate();phase='loading';message='Checking customer-link access…';emit();pending=deps.store.read();await fresh(signal);
  if(pending){if(pending.businessId!==businessId){phase='blocked';message='A pending customer-link save belongs to a different business. Its reference has been kept for review.';return;}retain(pending.reference.vehicleId===vehicleId?'A pending customer-link save was found. Check its original outcome before another change.':'A pending customer-link save belongs to another vehicle. Check its original outcome before another change.');return;}
  await list(signal);phase='ready';message=snapshot!.context.writeState==='ready'?'Review the retained customer links or start an explicit change.':'Customer-link changes are paused. Retained records remain available for review.';
 },error=>{clearPrivate();phase=error instanceof PendingAssociationError?'blocked':'unavailable';message=error instanceof PendingAssociationError?'The pending-link reference cannot be read. Changes are blocked to protect it.':'Customer links or names could not be verified. Load current links again; any pending reference has been kept.';});
 const more=()=>{if(phase!=='ready'||!hasMore||!proof||!snapshot)return Promise.resolve();const after=rows.at(-1)?.source.id??null;return run(async signal=>{selected=null;selectedCustomer=null;draft=null;history=null;rows=[];hasMore=false;emit();await list(signal,after);message='Showing the next retained customer-link page.';},()=>{clearPrivate();phase='unavailable';message='The next link page could not be verified. Load current links again.';});};
 const searchCustomers=(text:string,more=false)=>{
  if(phase!=='ready'||!snapshot||!proof||typeof text!=='string'||[...text].length>200||more&&(!customerHasMore||text!==customerSearch))return Promise.resolve();
  const afterId=more?choices.at(-1)?.id??null:null;
  return run(async signal=>{choices=[];customerHasMore=false;emit();const result=await customerApi.list(businessId,{search:text,afterId,includeArchived:true,pageSize:25},proof!,signal);live(signal);choices=Object.freeze(result.customers.map(c=>Object.freeze({id:c.id,label:c.display_name,archived:c.archived_at!==null})));customerHasMore=result.hasMore;customerSearch=text;message='Customer search complete. Select the exact customer to use.';},()=>{clearPrivate();phase='unavailable';message='Customers could not be verified. Load current links again.';});
 };
 const begin=(action:AssociationBody['action'],associationId?:string)=>{
  if(phase!=='ready'||!snapshot||!proof||!['open','close','transfer'].includes(action))return Promise.resolve();
  return run(async signal=>{
   draft=null;selected=null;selectedCustomer=null;history=null;choices=[];customerHasMore=false;emit();
   if(action==='open'){draft=Object.freeze({action,customerId:'',effectiveAt:'',relationship:null,isBilling:null,evidence:null,reason:null});message='Choose a customer, relationship, billing selection and effective time.';return;}
   requireValue(uuid(associationId));const result=await api.history(businessId,{associationId,afterVersion:'0',pageSize:20},proof!,signal);live(signal);
   if(result.state==='absent'||result.association.vehicle_id!==vehicleId||result.association.valid_to!==null||result.association.version!=='1'){message='The link changed or has ended. Load current links before changing it.';return;}
   history=result;selected=result.association;
   if(action==='close')selectedCustomer=await customerLabel(selected.customer_id,signal);
   live(signal);draft=Object.freeze({action,customerId:action==='close'?selected.customer_id:'',effectiveAt:'',relationship:null,isBilling:null,evidence:null,reason:''});message=action==='close'?'Choose the effective end time and record why this link is ending.':'Choose the next customer and explicit relationship, billing selection, transfer time and reason. The earlier link will be retained.';
  },()=>{clearPrivate();phase='unavailable';message='The original link could not be verified. Load current links again.';});
 };
 const inspect=(associationId:string)=>{
  if(phase!=='ready'||!proof||!snapshot||!uuid(associationId))return Promise.resolve();
  return run(async signal=>{draft=null;selectedCustomer=null;selected=null;history=null;emit();const result=await api.history(businessId,{associationId,afterVersion:'0',pageSize:20},proof!,signal);live(signal);
   if(result.state==='absent'||result.association.vehicle_id!==vehicleId){message='This link was not found for this vehicle. Load current links again.';return;}selectedCustomer=await customerLabel(result.association.customer_id,signal);live(signal);history=result;selected=result.association;message='Review the complete retained link history.';
  },()=>{clearPrivate();phase='unavailable';message='Retained link history could not be verified. Load current links again.';});
 };
 function finish(result:Awaited<ReturnType<typeof associations.save>>,lookup=false){
  if(!pending)throw new Error();
  if(result.state==='conflict'&&result.reason==='operation'){retain('The operation reference conflicts with the recorded request. Keep it for review; a replacement is blocked.');original=null;return;}
  try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Save confirmed, but its reference could not be cleared. Check the original status before another change.':'No change was saved, but its reference could not be cleared. Check its status before another change.');return;}
  pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original customer-link save is confirmed. Load current links to review it.':'Customer link saved. Load current links before another change.'):'The parent, link or ownership/billing period changed or conflicts. Load current links and review before starting a new change.';
 }
 const check=()=>run(async signal=>{
  pending=deps.store.read();if(!pending)throw new PendingAssociationError();retain('Checking the original customer-link save…');emit();
  if(pending.businessId!==businessId){original=null;phase='blocked';message='The pending save belongs to a different business. It will not be checked or sent here.';return;}await fresh(signal);
  const result=await api.lookup(businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);
  if(result.state==='committed'){finish(result,true);return;}canRetry=eligible();message=canRetry?'No completed save was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original change.':!original?'No completed save was found. The original draft is no longer in memory. Its reference has been kept for review; a replacement is blocked.':'No completed save was found. The original vehicle, sign-in or recovery context changed, or writes are paused. Keep its reference for review.';
 },()=>{retain('The save status could not be confirmed. Keep the original reference and check again before another change.');proof=null;snapshot=null;});
 function failedWrite(error:unknown,first:boolean,dispatched:boolean){
  if(!dispatched){clearPrivate();phase='blocked';message='The pending-link reference could not be secured. No change was sent.';return;}
  const kind=error instanceof AssociationClientError?error.kind:'unknown';
  if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The customer-link change was not submitted. Load current links and review before trying again.';return;}catch{/* Retain a reference whose removal is unconfirmed. */}}
  retain(kind==='recovery'?'Recovery review is required. The original request has been kept without changing its epoch.':'The customer-link save could not be confirmed. Check its original status before another change.');
 }
 const save=()=>{
  if(!view().canSave||!draft||!snapshot||!proof)return Promise.resolve();const context=snapshot,input=Object.freeze({...draft}),source=selected;let checkedContext=false,dispatched=false;
  return run(async signal=>{
   await fresh(signal);checkedContext=true;
   if(snapshot!.binding!==context.binding||snapshot!.context.writeState!=='ready'||snapshot!.context.recoveryEpoch!==context.context.recoveryEpoch){clearPrivate();phase='review';message='Vehicle access or recovery changed. No change was sent. Load current links before editing.';return;}
   const command:AssociationCommand=Object.freeze({schemaVersion:1,operationId:id(),recoveryEpoch:context.context.recoveryEpoch!,expectedVersion:input.action==='open'?'0':'1',body:parseAssociationBody({...input,vehicleId,associationId:input.action==='open'?id():source!.id,nextAssociationId:input.action==='transfer'?id():null})});
   const record=pendingAssociation({schemaVersion:1,businessId,binding:context.binding,reference:reference(command)});deps.store.write(record);pending=record;original=command;retain('Saving customer link…');emit();dispatched=true;
   const result=await api.save(businessId,command,proof!,signal);live(signal);finish(result);
  },error=>{if(!checkedContext){clearPrivate();phase='unavailable';message='Customer-link access could not be reverified. No change was sent.';}else failedWrite(error,true,dispatched);});
 };
 const retry=()=>{
  if(!view().canRetry||!pending||!original)return Promise.resolve();const record=pending,command=original;let dispatched=false;
  return run(async signal=>{retain('Rechecking the original customer-link request…');emit();deps.store.require(record);await fresh(signal);if(!eligible()){retain('The original vehicle, sign-in or recovery context is no longer eligible. Nothing was retried.');return;}deps.store.require(record);dispatched=true;const result=await api.save(businessId,command,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failedWrite(error,false,true);else retain('The original reference could not be verified. Check save status again; nothing was retried.');});
 };
 function suspend(){if(!alive)return;active?.abort();active=null;clearPrivate();phase='review';message='Private customer-link details were cleared. Load current links before continuing; any pending reference has been kept.';emit();}
 return Object.freeze({load,more,searchCustomers,begin,inspect,save,check,retry,suspend,view,
  chooseCustomer(customerId:string){if(!alive||active||phase!=='ready'||!draft||draft.action==='close')return;const choice=choices.find(c=>c.id===customerId);if(!choice)return;selectedCustomer=choice;draft=Object.freeze({...draft,customerId:choice.id});emit();},
  edit(value:AssociationDraft){if(!alive||active||phase!=='ready'||!draft||value.action!==draft.action||value.customerId!==draft.customerId)return;draft=Object.freeze({...value});emit();},
  dispose(){alive=false;active?.abort();active=null;clearPrivate();pending=null;}
 });
}
