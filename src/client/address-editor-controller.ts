import {authentication} from './authentication';
import type {Proof} from './authentication';
import {addresses,AddressClientError} from './customer-addresses';
import {customers} from './customers';
import type {AddressSave} from './customer-addresses';
import {customerUuid} from '../customer/customer-contract';
import {draftFromAddress} from '../customer/customer-address-contract';
import {parseAddressDraft} from '../customer/customer-resource-contract';
import type {Customer} from '../customer/customer-contract';
import type {CustomerAddress} from '../customer/customer-address-contract';
import type {AddressDraft} from '../customer/customer-resource-contract';
import {pendingAddress,PendingAddressError} from './pending-address-edit';
import type {PendingAddress,createPendingAddressStore} from './pending-address-edit';

type Snapshot=Awaited<ReturnType<typeof addresses.context>>;
type History=Extract<Awaited<ReturnType<typeof addresses.history>>,{state:'found'}>;
export type AddressEditorView=Readonly<{phase:'loading'|'ready'|'pending'|'review'|'unavailable'|'blocked';message:string;busy:boolean;rows:readonly CustomerAddress[];hasMore:boolean;search:string;includeArchived:boolean;selected:CustomerAddress|null;draft:AddressDraft|null;draftIssue:string;history:History|null;parent:Customer|null;canSave:boolean;canRetry:boolean;reference:string;writesPaused:boolean}>;
export const initialAddressEditorView:AddressEditorView=Object.freeze({phase:'loading',message:'Checking address access…',busy:true,rows:Object.freeze([]),hasMore:false,search:'',includeArchived:false,selected:null,draft:null,draftIssue:'',history:null,parent:null,canSave:false,canRetry:false,reference:'',writesPaused:true});
export const emptyAddressDraft:AddressDraft=Object.freeze({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null});

type Dependencies={customerId:string|null;parentHistory?:typeof customers.history;store:ReturnType<typeof createPendingAddressStore>;change:(view:AddressEditorView)=>void;api?:typeof addresses;session?:typeof authentication.session;id?:()=>string};
export function createAddressEditorController(deps:Dependencies){
  const api=deps.api??addresses,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
  const parentHistory=deps.parentHistory??customers.history;let customerId:string|null=null,parent:Customer|null=null;
  let alive=true,active:AbortController|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingAddress|null=null,original:AddressSave|null=null;
  let phase:AddressEditorView['phase']='loading',message=initialAddressEditorView.message,rows:readonly CustomerAddress[]=[],hasMore=false,search='',includeArchived=false,selected:CustomerAddress|null=null,draft:AddressDraft|null=null,history:History|null=null,canRetry=false;
  const clearPrivate=()=>{proof=null;snapshot=null;parent=null;rows=[];hasMore=false;search='';includeArchived=false;selected=null;draft=null;history=null;original=null;canRetry=false;};
  function draftIssue(){if(draft===null)return '';let validated:AddressDraft;try{validated=parseAddressDraft(draft);}catch{return 'Review field lengths, paired coordinates, verification time and archive reason before saving.';}
    // UUIDs have a fixed wire length. Match the actual flat JSON input and
    // exact current version before creating IDs, a reference or a request.
    const placeholder='00000000-0000-0000-0000-000000000000',body={schemaVersion:1,operationId:placeholder,customerId:placeholder,addressId:placeholder,expectedVersion:selected?.version??'0',recoveryEpoch:placeholder,...validated};
    return new TextEncoder().encode(JSON.stringify(body)).byteLength>8192?'This draft is too large to send. Shorten the location text or instructions before saving.':'';
  }
  const view=():AddressEditorView=>Object.freeze({phase,message,busy:!!active,rows:phase==='ready'?rows:Object.freeze([]),hasMore:phase==='ready'&&hasMore,search:phase==='ready'?search:'',includeArchived:phase==='ready'&&includeArchived,selected:phase==='ready'?selected:null,draft:phase==='ready'?draft:null,draftIssue:phase==='ready'?draftIssue():'',history:phase==='ready'?history:null,parent:phase==='ready'?parent:null,
    canSave:!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&draft!==null&&draftIssue()===''&&(!selected||JSON.stringify(draft)!==JSON.stringify(draftFromAddress(selected))),canRetry:!active&&canRetry,
    reference:phase==='pending'&&snapshot?.context.businessId===pending?.businessId?pending?.reference.operationId??'':'',writesPaused:snapshot?.context.writeState!=='ready'});
  const emit=()=>{if(alive)deps.change(view());};
  const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw new Error();};
  async function fresh(signal:AbortSignal){const nextProof=await session(signal);live(signal);if(!customerId)throw new Error();const next=await api.context(customerId,nextProof,signal);live(signal);if(next.context.customerId!==customerId)throw new Error();proof=nextProof;snapshot=next;}
  const retain=(text:string)=>{phase='pending';message=text;canRetry=false;parent=null;rows=[];selected=null;draft=null;history=null;search='';hasMore=false;};
  const eligible=()=>!!pending&&!!original&&!!snapshot&&snapshot.context.businessId===pending.businessId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&(['operationId','customerId','addressId','expectedVersion','recoveryEpoch'] as const).every(key=>original![key]===pending!.reference[key]);
  async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
    if(!alive||active)return;const controller=new AbortController();active=controller;emit();
    try{await work(controller.signal);}catch(error){if(alive&&active===controller&&!controller.signal.aborted)failure(error);}finally{if(active===controller){active=null;emit();}}
  }
  const load=()=>run(async signal=>{
    clearPrivate();phase='loading';message='Checking address access…';emit();pending=deps.store.read();customerId=pending?.reference.customerId??deps.customerId;if(!customerUuid(customerId)){phase='unavailable';message='Choose a customer in the customer directory to manage addresses. Any pending reference has been kept.';return;}await fresh(signal);
    if(pending){if(pending.businessId!==snapshot!.context.businessId){phase='blocked';message='A pending save belongs to a different business. Its reference has been kept for review.';return;}retain('A pending address save was found. Check its status before another edit.');return;}
    const customer=await parentHistory(snapshot!.context.businessId,{customerId:customerId!,afterVersion:'0',pageSize:1},proof!,signal);live(signal);if(customer.state==='absent'){clearPrivate();phase='unavailable';message='This customer was not found. Choose a current customer before managing addresses.';return;}parent=customer.customer;
    const result=await api.list(snapshot!.context.businessId,{customerId:customerId!,search:'',afterId:null,includeArchived:false,pageSize:25},proof!,signal);live(signal);rows=result.addresses;hasMore=result.hasMore;phase='ready';message=snapshot!.context.writeState==='ready'?'Choose an address or add a new address.':'Address changes are paused. Current records remain available for review.';
  },error=>{clearPrivate();phase=error instanceof PendingAddressError?'blocked':'unavailable';message=error instanceof PendingAddressError?'The pending-save reference cannot be read. Editing is blocked to protect it.':'Address access could not be verified. Sign in or check again; any pending reference has been kept.';});
  const query=(text:string,archived:boolean,more=false)=>{
    if(phase!=='ready'||!snapshot||!proof||typeof text!=='string'||[...text].length>200||typeof archived!=='boolean'||more&&(!hasMore||text!==search||archived!==includeArchived))return Promise.resolve();
    const context=snapshot,authorization=proof,after=more?rows.at(-1)?.id??null:null;
    return run(async signal=>{selected=null;draft=null;history=null;rows=[];hasMore=false;emit();const result=await api.list(context.context.businessId,{customerId:customerId!,search:text,afterId:after,includeArchived:archived,pageSize:25},authorization,signal);live(signal);rows=result.addresses;hasMore=result.hasMore;search=text;includeArchived=archived;message=more?'Showing the next address page.':'Address search complete.';},()=>{clearPrivate();phase='unavailable';message='Address search could not be verified. Load current records again.';});
  };
  const open=(addressId:string)=>{
    if(phase!=='ready'||!snapshot||!proof||!customerUuid(addressId))return Promise.resolve();const context=snapshot,authorization=proof;
    return run(async signal=>{selected=null;draft=null;history=null;emit();const result=await api.history(context.context.businessId,{customerId:customerId!,addressId,afterVersion:'0',pageSize:20},authorization,signal);live(signal);if(result.state==='absent'){message='This address was not found. Load the current directory before editing.';return;}selected=result.address;draft=draftFromAddress(selected);history=result;message='Review address details and retained history before saving.';},()=>{clearPrivate();phase='unavailable';message='Address details could not be verified. Load current records again.';});
  };
  const moreHistory=()=>{
    if(phase!=='ready'||!snapshot||!proof||!history?.hasMore||!selected)return Promise.resolve();const context=snapshot,authorization=proof,source=selected,after=history.history.at(-1)?.after.version;if(!after)return Promise.resolve();
    return run(async signal=>{history=null;emit();const result=await api.history(context.context.businessId,{customerId:customerId!,addressId:source.id,afterVersion:after,pageSize:20},authorization,signal);live(signal);if(result.state==='absent'||result.address.version!==source.version){selected=null;draft=null;message='The address changed while history was loading. Open the current record before editing.';return;}history=result;message='Showing the next retained history page.';},()=>{clearPrivate();phase='unavailable';message='Address history could not be verified. Load current records again.';});
  };
  function finish(result:Awaited<ReturnType<typeof addresses.save>>,lookup=false){
    if(!pending)throw new Error();
    if(result.state==='conflict'&&result.reason==='operation'){retain('The save reference conflicts with the recorded request. Keep it for review; no replacement will be sent.');original=null;return;}
    try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Save confirmed, but its reference could not be cleared. Check save status before another edit.':'No change was saved, but its reference could not be cleared. Check save status before another edit.');return;}
    pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original save is confirmed. Load current addresses to review the recorded result.':'Address saved. Load current addresses before another edit.'):'The record, address ID or customer link changed. Load current addresses and review before starting a new edit.';
  }
  const check=()=>run(async signal=>{
    pending=deps.store.read();if(!pending)throw new PendingAddressError();customerId=pending.reference.customerId;retain('Checking the original address save…');emit();await fresh(signal);
    if(snapshot!.context.businessId!==pending.businessId){original=null;phase='blocked';message='This save belongs to a different business. It will not be checked or sent here.';return;}
    const result=await api.lookup(pending.businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);
    if(result.state==='committed'){finish(result,true);return;}
    canRetry=eligible();message=canRetry?'No completed save was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original draft.':!original?'No completed save was found. The original draft is no longer in memory. Its reference has been kept for review; a replacement save is blocked.':'No completed save was found. The sign-in or recovery context changed, or writes are paused. Keep the original reference for review.';
  },()=>{retain('The save status could not be confirmed. Keep its reference and check again before another action.');proof=null;snapshot=null;});
  function failedWrite(error:unknown,first:boolean,dispatched:boolean){
    if(!dispatched){original=null;clearPrivate();phase='blocked';message='The pending-save reference could not be secured. No change was sent.';return;}
    const kind=error instanceof AddressClientError?error.kind:'unknown';
    if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The address change was not submitted. Load current addresses and review before trying again.';return;}catch{/* Keep any reference whose removal is unconfirmed. */}}
    retain(kind==='recovery'?'Recovery review is required. The original address request has been kept without changing its epoch.':'The address save could not be confirmed. Check its original status before another action.');
  }
  const save=()=>{
    if(!view().canSave||!snapshot||!proof||!draft)return Promise.resolve();const context=snapshot,input=parseAddressDraft(draft),current=selected;let dispatched=false,checkedContext=false;
    return run(async signal=>{
      await fresh(signal);checkedContext=true;
      if(snapshot!.context.businessId!==context.context.businessId||snapshot!.binding!==context.binding||snapshot!.context.writeState!=='ready'||snapshot!.context.recoveryEpoch!==context.context.recoveryEpoch){clearPrivate();phase='review';message='Address access or recovery changed. No change was sent. Load current addresses before editing.';return;}
      const command:AddressSave=Object.freeze({schemaVersion:1,operationId:id(),customerId:customerId!,addressId:current?.id??id(),expectedVersion:current?.version??'0',recoveryEpoch:context.context.recoveryEpoch!,draft:input});
      const {draft:unused,schemaVersion,...reference}=command;void unused;void schemaVersion;
      const record=pendingAddress({schemaVersion:1,businessId:context.context.businessId,binding:context.binding,reference});deps.store.write(record);pending=record;original=command;retain('Saving address…');emit();dispatched=true;
      const result=await api.save(record.businessId,command,proof!,signal);live(signal);finish(result);
    },error=>{if(!checkedContext){clearPrivate();phase='unavailable';message='Address access could not be reverified. No change was sent. Load current addresses before editing.';}else failedWrite(error,true,dispatched);});
  };
  const retry=()=>{
    if(!view().canRetry||!pending||!original)return Promise.resolve();const record=pending,command=original;let dispatched=false;
    return run(async signal=>{retain('Rechecking before retrying the original address change…');emit();deps.store.require(record);await fresh(signal);if(!eligible()){retain('The original sign-in or recovery context is no longer eligible. Nothing was retried.');return;}deps.store.require(record);dispatched=true;const result=await api.save(record.businessId,command,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failedWrite(error,false,true);else retain('The original reference could not be verified. Check save status again; nothing was retried.');});
  };
  function suspend(){if(!alive)return;active?.abort();active=null;clearPrivate();phase='review';message='Private address details were cleared. Load current addresses before continuing; any pending reference has been kept.';emit();}
  return Object.freeze({load,query,open,moreHistory,save,check,retry,view,suspend,
    create(){if(alive&&!active&&phase==='ready'){selected=null;history=null;draft=emptyAddressDraft;message='Add only the location details you know. Postal fields, coordinates and verification can remain unknown.';emit();}},
    edit(value:AddressDraft){if(alive&&!active&&phase==='ready'&&draft){draft=Object.freeze({...value});emit();}},
    dispose(){alive=false;active?.abort();active=null;clearPrivate();pending=null;}
  });
}
