import {authentication} from './authentication';
import type {Proof} from './authentication';
import {customers,CustomerClientError} from './customers';
import type {CustomerSave} from './customers';
import {draftFromCustomer,parseCustomerDraft,customerUuid} from '../customer/customer-contract';
import type {Customer,CustomerDraft} from '../customer/customer-contract';
import {pendingCustomer,PendingCustomerError} from './pending-customer-edit';
import type {PendingCustomer,createPendingCustomerStore} from './pending-customer-edit';

type Snapshot=Awaited<ReturnType<typeof customers.context>>;
type History=Extract<Awaited<ReturnType<typeof customers.history>>,{state:'found'}>;
export type CustomerEditorView=Readonly<{phase:'loading'|'ready'|'pending'|'review'|'unavailable'|'blocked';message:string;busy:boolean;rows:readonly Customer[];hasMore:boolean;search:string;includeArchived:boolean;selected:Customer|null;draft:CustomerDraft|null;draftIssue:string;history:History|null;canSave:boolean;canRetry:boolean;reference:string;writesPaused:boolean}>;
export const initialCustomerEditorView:CustomerEditorView=Object.freeze({phase:'loading',message:'Checking customer access…',busy:true,rows:Object.freeze([]),hasMore:false,search:'',includeArchived:false,selected:null,draft:null,draftIssue:'',history:null,canSave:false,canRetry:false,reference:'',writesPaused:true});
export const emptyCustomerDraft:CustomerDraft=Object.freeze({displayName:'',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null});

type Dependencies={store:ReturnType<typeof createPendingCustomerStore>;change:(view:CustomerEditorView)=>void;api?:typeof customers;session?:typeof authentication.session;id?:()=>string};
export function createCustomerEditorController(deps:Dependencies){
  const api=deps.api??customers,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
  let alive=true,active:AbortController|null=null,proof:Proof|null=null,snapshot:Snapshot|null=null,pending:PendingCustomer|null=null,original:CustomerSave|null=null;
  let phase:CustomerEditorView['phase']='loading',message=initialCustomerEditorView.message,rows:readonly Customer[]=[],hasMore=false,search='',includeArchived=false,selected:Customer|null=null,draft:CustomerDraft|null=null,history:History|null=null,canRetry=false;
  const clearPrivate=()=>{proof=null;snapshot=null;rows=[];hasMore=false;search='';includeArchived=false;selected=null;draft=null;history=null;original=null;canRetry=false;};
  function draftIssue(){if(draft===null)return '';try{parseCustomerDraft(draft);}catch{return 'Review the name, field lengths, date and archive reason before saving.';}
    // UUIDs have a fixed wire length. Match the actual flat JSON input and
    // exact current version before creating IDs, a reference or a request.
    const placeholder='00000000-0000-0000-0000-000000000000',body={schemaVersion:1,operationId:placeholder,customerId:placeholder,expectedVersion:selected?.version??'0',recoveryEpoch:placeholder,...draft};
    return new TextEncoder().encode(JSON.stringify(body)).byteLength>8192?'This draft is too large to send. Shorten the contact details or notes before saving.':'';
  }
  const view=():CustomerEditorView=>Object.freeze({phase,message,busy:!!active,rows:phase==='ready'?rows:Object.freeze([]),hasMore:phase==='ready'&&hasMore,search:phase==='ready'?search:'',includeArchived:phase==='ready'&&includeArchived,selected:phase==='ready'?selected:null,draft:phase==='ready'?draft:null,draftIssue:phase==='ready'?draftIssue():'',history:phase==='ready'?history:null,
    canSave:!active&&phase==='ready'&&snapshot?.context.writeState==='ready'&&draft!==null&&draftIssue()===''&&(!selected||JSON.stringify(draft)!==JSON.stringify(draftFromCustomer(selected))),canRetry:!active&&canRetry,
    reference:phase==='pending'&&snapshot?.context.businessId===pending?.businessId?pending?.reference.operationId??'':'',writesPaused:snapshot?.context.writeState!=='ready'});
  const emit=()=>{if(alive)deps.change(view());};
  const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw new Error();};
  async function fresh(signal:AbortSignal){const nextProof=await session(signal);live(signal);const next=await api.context(nextProof,signal);live(signal);proof=nextProof;snapshot=next;}
  const retain=(text:string)=>{phase='pending';message=text;canRetry=false;rows=[];selected=null;draft=null;history=null;search='';hasMore=false;};
  const eligible=()=>!!pending&&!!original&&!!snapshot&&snapshot.context.businessId===pending.businessId&&snapshot.binding===pending.binding&&snapshot.context.writeState==='ready'&&snapshot.context.recoveryEpoch===pending.reference.recoveryEpoch&&(['operationId','customerId','expectedVersion','recoveryEpoch'] as const).every(key=>original![key]===pending!.reference[key]);
  async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(error:unknown)=>void){
    if(!alive||active)return;const controller=new AbortController();active=controller;emit();
    try{await work(controller.signal);}catch(error){if(alive&&active===controller&&!controller.signal.aborted)failure(error);}finally{if(active===controller){active=null;emit();}}
  }
  const load=()=>run(async signal=>{
    clearPrivate();phase='loading';message='Checking customer access…';emit();pending=deps.store.read();await fresh(signal);
    if(pending){if(pending.businessId!==snapshot!.context.businessId){phase='blocked';message='A pending save belongs to a different business. Its reference has been kept for review.';return;}retain('A pending customer save was found. Check its status before another edit.');return;}
    const result=await api.list(snapshot!.context.businessId,{search:'',afterId:null,includeArchived:false,pageSize:25},proof!,signal);live(signal);rows=result.customers;hasMore=result.hasMore;phase='ready';message=snapshot!.context.writeState==='ready'?'Choose a customer or add a new customer.':'Customer changes are paused. Current records remain available for review.';
  },error=>{clearPrivate();phase=error instanceof PendingCustomerError?'blocked':'unavailable';message=error instanceof PendingCustomerError?'The pending-save reference cannot be read. Editing is blocked to protect it.':'Customer access could not be verified. Sign in or check again; any pending reference has been kept.';});
  const query=(text:string,archived:boolean,more=false)=>{
    if(phase!=='ready'||!snapshot||!proof||typeof text!=='string'||[...text].length>200||typeof archived!=='boolean'||more&&(!hasMore||text!==search||archived!==includeArchived))return Promise.resolve();
    const context=snapshot,authorization=proof,after=more?rows.at(-1)?.id??null:null;
    return run(async signal=>{selected=null;draft=null;history=null;rows=[];hasMore=false;emit();const result=await api.list(context.context.businessId,{search:text,afterId:after,includeArchived:archived,pageSize:25},authorization,signal);live(signal);rows=result.customers;hasMore=result.hasMore;search=text;includeArchived=archived;message=more?'Showing the next customer page.':'Customer search complete.';},()=>{clearPrivate();phase='unavailable';message='Customer search could not be verified. Load current records again.';});
  };
  const open=(customerId:string)=>{
    if(phase!=='ready'||!snapshot||!proof||!customerUuid(customerId))return Promise.resolve();const context=snapshot,authorization=proof;
    return run(async signal=>{selected=null;draft=null;history=null;emit();const result=await api.history(context.context.businessId,{customerId,afterVersion:'0',pageSize:20},authorization,signal);live(signal);if(result.state==='absent'){message='This customer was not found. Load the current directory before editing.';return;}selected=result.customer;draft=draftFromCustomer(selected);history=result;message='Review customer details and retained history before saving.';},()=>{clearPrivate();phase='unavailable';message='Customer details could not be verified. Load current records again.';});
  };
  const moreHistory=()=>{
    if(phase!=='ready'||!snapshot||!proof||!history?.hasMore||!selected)return Promise.resolve();const context=snapshot,authorization=proof,source=selected,after=history.history.at(-1)?.after.version;if(!after)return Promise.resolve();
    return run(async signal=>{history=null;emit();const result=await api.history(context.context.businessId,{customerId:source.id,afterVersion:after,pageSize:20},authorization,signal);live(signal);if(result.state==='absent'||result.customer.version!==source.version){selected=null;draft=null;message='The customer changed while history was loading. Open the current record before editing.';return;}history=result;message='Showing the next retained history page.';},()=>{clearPrivate();phase='unavailable';message='Customer history could not be verified. Load current records again.';});
  };
  function finish(result:Awaited<ReturnType<typeof customers.save>>,lookup=false){
    if(!pending)throw new Error();
    if(result.state==='conflict'&&result.reason==='operation'){retain('The save reference conflicts with the recorded request. Keep it for review; no replacement will be sent.');original=null;return;}
    try{deps.store.clear(pending);}catch{retain(result.state==='committed'?'Save confirmed, but its reference could not be cleared. Check save status before another edit.':'No change was saved, but its reference could not be cleared. Check save status before another edit.');return;}
    pending=null;clearPrivate();phase='review';message=result.state==='committed'?(lookup?'The original save is confirmed. Load current customers to review the recorded result.':'Customer saved. Load current customers before another edit.'):'The record changed or the customer ID is already in use. Load current customers and review before starting a new edit.';
  }
  const check=()=>run(async signal=>{
    pending=deps.store.read();if(!pending)throw new PendingCustomerError();retain('Checking the original customer save…');emit();await fresh(signal);
    if(snapshot!.context.businessId!==pending.businessId){original=null;phase='blocked';message='This save belongs to a different business. It will not be checked or sent here.';return;}
    const result=await api.lookup(pending.businessId,pending.reference,proof!,signal);live(signal);deps.store.require(pending);
    if(result.state==='committed'){finish(result,true);return;}
    canRetry=eligible();message=canRetry?'No completed save was found. This does not prove an earlier request failed. You may explicitly retry the unchanged original draft.':!original?'No completed save was found. The original draft is no longer in memory. Its reference has been kept for review; a replacement save is blocked.':'No completed save was found. The sign-in or recovery context changed, or writes are paused. Keep the original reference for review.';
  },()=>{retain('The save status could not be confirmed. Keep its reference and check again before another action.');proof=null;snapshot=null;});
  function failedWrite(error:unknown,first:boolean,dispatched:boolean){
    if(!dispatched){original=null;clearPrivate();phase='blocked';message='The pending-save reference could not be secured. No change was sent.';return;}
    const kind=error instanceof CustomerClientError?error.kind:'unknown';
    if(first&&['input','not_submitted','denied'].includes(kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The customer change was not submitted. Load current customers and review before trying again.';return;}catch{/* Keep any reference whose removal is unconfirmed. */}}
    retain(kind==='recovery'?'Recovery review is required. The original customer request has been kept without changing its epoch.':'The customer save could not be confirmed. Check its original status before another action.');
  }
  const save=()=>{
    if(!view().canSave||!snapshot||!proof||!draft)return Promise.resolve();const context=snapshot,input=parseCustomerDraft(draft),current=selected;let dispatched=false,checkedContext=false;
    return run(async signal=>{
      await fresh(signal);checkedContext=true;
      if(snapshot!.context.businessId!==context.context.businessId||snapshot!.binding!==context.binding||snapshot!.context.writeState!=='ready'||snapshot!.context.recoveryEpoch!==context.context.recoveryEpoch){clearPrivate();phase='review';message='Customer access or recovery changed. No change was sent. Load current customers before editing.';return;}
      const command:CustomerSave=Object.freeze({schemaVersion:1,operationId:id(),customerId:current?.id??id(),expectedVersion:current?.version??'0',recoveryEpoch:context.context.recoveryEpoch!,draft:input});
      const {draft:unused,schemaVersion,...reference}=command;void unused;void schemaVersion;
      const record=pendingCustomer({schemaVersion:1,businessId:context.context.businessId,binding:context.binding,reference});deps.store.write(record);pending=record;original=command;retain('Saving customer…');emit();dispatched=true;
      const result=await api.save(record.businessId,command,proof!,signal);live(signal);finish(result);
    },error=>{if(!checkedContext){clearPrivate();phase='unavailable';message='Customer access could not be reverified. No change was sent. Load current customers before editing.';}else failedWrite(error,true,dispatched);});
  };
  const retry=()=>{
    if(!view().canRetry||!pending||!original)return Promise.resolve();const record=pending,command=original;let dispatched=false;
    return run(async signal=>{retain('Rechecking before retrying the original customer change…');emit();deps.store.require(record);await fresh(signal);if(!eligible()){retain('The original sign-in or recovery context is no longer eligible. Nothing was retried.');return;}deps.store.require(record);dispatched=true;const result=await api.save(record.businessId,command,proof!,signal);live(signal);finish(result);},error=>{if(dispatched)failedWrite(error,false,true);else retain('The original reference could not be verified. Check save status again; nothing was retried.');});
  };
  function suspend(){if(!alive)return;active?.abort();active=null;clearPrivate();phase='review';message='Private customer details were cleared. Load current customers before continuing; any pending reference has been kept.';emit();}
  return Object.freeze({load,query,open,moreHistory,save,check,retry,view,suspend,
    create(){if(alive&&!active&&phase==='ready'){selected=null;history=null;draft=emptyCustomerDraft;message='Add only the customer details you know. Contact fields and customer-since date can remain unknown.';emit();}},
    edit(value:CustomerDraft){if(alive&&!active&&phase==='ready'&&draft){draft=Object.freeze({...value});emit();}},
    dispose(){alive=false;active?.abort();active=null;clearPrivate();pending=null;}
  });
}
