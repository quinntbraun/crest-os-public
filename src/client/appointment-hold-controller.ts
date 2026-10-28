import {authentication} from './authentication';
import {appointmentHolds,HoldClientError} from './appointment-holds';
import {pendingHold} from './pending-appointment-hold';
import type {createPendingHoldStore,PendingHold} from './pending-appointment-hold';
import {holdPayload,holdPayloadKeys,parseHoldPayload,parseHoldSave} from '../operations/appointment-hold-contract';
import type {HoldPayload,HoldSave,StoredHold} from '../operations/appointment-hold-contract';
import type {Proof} from './authentication';
type Context=Awaited<ReturnType<typeof appointmentHolds.context>>;
type History=Extract<Awaited<ReturnType<typeof appointmentHolds.history>>,{state:'found'}>;
type Phase='loading'|'ready'|'pending'|'review'|'unavailable'|'blocked';
export type HoldView=Readonly<{phase:Phase;message:string;busy:boolean;businessId:string|null;rows:readonly StoredHold[];hasMore:boolean;selected:StoredHold|null;draft:HoldPayload|null;history:History|null;canSave:boolean;canRetry:boolean;writesPaused:boolean;reference:string;issue:string}>;
export const initialHoldView:HoldView=Object.freeze({phase:'loading',message:'Checking appointment proposal access…',busy:true,businessId:null,rows:[],hasMore:false,selected:null,draft:null,history:null,canSave:false,canRetry:false,writesPaused:true,reference:'',issue:''});
export const emptyHoldPayload:HoldPayload=Object.freeze({customer_id:null,lead_id:null,label:'',state:'proposed',start_at:'',end_at:'',timezone:'America/Indiana/Indianapolis',local_start:'',local_end:'',start_offset_minutes:0,end_offset_minutes:0,notes:null,reason:null});
export function createHoldController(deps:{store:ReturnType<typeof createPendingHoldStore>;change:(v:HoldView)=>void;api?:typeof appointmentHolds;session?:typeof authentication.session;id?:()=>string}){
 const api=deps.api??appointmentHolds,session=deps.session??authentication.session,id=deps.id??(()=>crypto.randomUUID());
 let alive=true,active:AbortController|null=null,phase:Phase='loading',message=initialHoldView.message,context:Context|null=null,proof:Proof|null=null,pending:PendingHold|null=null,original:HoldSave|null=null,rows:readonly StoredHold[]=[],hasMore=false,selected:StoredHold|null=null,draft:HoldPayload|null=null,history:History|null=null,canRetry=false;
 const same=(a:Context,b:Context)=>a.binding===b.binding&&a.context.businessId===b.context.businessId&&a.context.writeState===b.context.writeState&&a.context.recoveryEpoch===b.context.recoveryEpoch;
 const eligible=()=>!!pending&&!!context&&pending.businessId===context.context.businessId&&pending.binding===context.binding;
 const issue=()=>{if(!draft)return '';try{parseHoldPayload(draft);if(selected&&draft.reason===null)throw Error();return '';}catch{return 'Choose a customer or lead, review the label and actual time window, and provide a reason for a revision or withdrawal.';}};
 const view=():HoldView=>Object.freeze({phase,message,busy:!!active,businessId:phase==='ready'?context?.context.businessId??null:null,rows:phase==='ready'?rows:[],hasMore:phase==='ready'&&hasMore,selected:phase==='ready'?selected:null,draft:phase==='ready'?draft:null,history:phase==='ready'?history:null,canSave:!active&&phase==='ready'&&context?.context.writeState==='ready'&&!!draft&&selected?.state!=='withdrawn'&&issue()===''&&(!selected||holdPayloadKeys.some(k=>k!=='reason'&&draft![k]!==selected![k])),canRetry:!active&&canRetry,writesPaused:context?.context.writeState!=='ready',reference:phase==='pending'&&eligible()?pending!.reference.operationId:'',issue:phase==='ready'?issue():''});
 const emit=()=>{if(alive)deps.change(view());};
 const clearData=()=>{rows=[];hasMore=false;selected=null;draft=null;history=null;};
 const clearPrivate=()=>{clearData();proof=null;context=null;original=null;canRetry=false;};
 const live=(signal:AbortSignal)=>{if(!alive||signal.aborted||active?.signal!==signal)throw Error();};
 async function fresh(signal:AbortSignal){const p=await session(signal);live(signal);const c=await api.context(p,signal);live(signal);proof=p;context=c;}
 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:(e:unknown)=>void){if(!alive||active)return;const c=new AbortController();active=c;emit();try{await work(c.signal);}catch(e){if(alive&&!c.signal.aborted&&active===c)failure(e);}finally{if(active===c){active=null;emit();}}}
 function retain(text:string){clearData();phase='pending';message=text;canRetry=false;}
 function finish(result:Awaited<ReturnType<typeof appointmentHolds.save>>){
  if(!pending)throw Error();if(result.state==='conflict'){
   if(result.reason==='operation'){retain('The original operation conflicts with retained evidence. Keep its reference for review.');return;}
   deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The proposal changed or cannot be revised. No new version was saved. Load current proposals.';return;
  }
  deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='Unconfirmed proposal version '+result.receipt.sequence+' saved. Load current proposals to review the retained record.';
 }
 function failedSave(error:unknown,first:boolean){
  if(first&&error instanceof HoldClientError&&['input','not_submitted','denied'].includes(error.kind)&&pending){try{deps.store.clear(pending);pending=null;clearPrivate();phase='review';message='The proposal was not submitted. Load current proposals before trying again.';return;}catch{/* Keep a reference whose removal was not verified. */}}
  retain('The save outcome is not confirmed. Keep the original reference and check its status before another change.');
 }
 async function inspect(signal:AbortSignal){
  if(!pending||!eligible()||!proof)throw Error();deps.store.require(pending);const result=await api.lookup(pending.businessId,pending.reference,proof,signal);live(signal);
  if(result.state!=='absent'){finish(result);return;}canRetry=!!original&&context?.context.writeState==='ready'&&context.context.recoveryEpoch===pending.reference.recoveryEpoch;message=canRetry?'No committed original was found. You may retry only the unchanged original draft.':'No committed original was found. Keep this reference for original-operation review; the draft is no longer available. No new change has been sent.';
 }
 const load=()=>run(async signal=>{clearPrivate();phase='loading';message='Checking current proposal access…';pending=deps.store.read();await fresh(signal);
  if(pending){retain('Reviewing the original proposal reference…');if(eligible())await inspect(signal);else message='This save belongs to a different authenticated context. Keep the original reference and return to that context for review.';return;}
  const result=await api.list(context!.context.businessId,{afterId:null,pageSize:10},proof!,signal);live(signal);rows=result.holds;hasMore=result.hasMore;phase='ready';message='Recorded proposals loaded. Proposed times are unconfirmed and do not reserve operator time.';
 },()=>{clearPrivate();phase='unavailable';message='Proposal access or saved records could not be verified. Load again.';});
 const more=()=>{if(phase!=='ready'||!hasMore||!context)return Promise.resolve();const prior=context,after=rows.at(-1)?.hold_id??null;return run(async signal=>{clearData();await fresh(signal);if(!same(prior,context!))throw Error();const result=await api.list(context!.context.businessId,{afterId:after,pageSize:10},proof!,signal);live(signal);rows=result.holds;hasMore=result.hasMore;message='Showing the next page of recorded proposals.';},()=>{clearPrivate();phase='unavailable';message='Proposal paging could not be verified. Load current records again.';});};
 const open=(row:StoredHold)=>{if(phase!=='ready'||!context||!rows.some(r=>r.id===row.id))return Promise.resolve();const prior=context;return run(async signal=>{selected=null;draft=null;history=null;await fresh(signal);if(!same(prior,context!))throw Error();const result=await api.history(prior.context.businessId,{holdId:row.hold_id,afterSequence:'0',pageSize:20},proof!,signal);live(signal);if(result.state==='absent'||result.currentSequence!==row.sequence){message='This proposal changed. Load current records before editing.';return;}selected=row;draft=row.state==='withdrawn'?holdPayload(row):Object.freeze({...holdPayload(row),reason:null});history=result;message=row.state==='withdrawn'?'Withdrawn proposal and its history are retained.':'Review this unconfirmed proposal and its history.';},()=>{clearPrivate();phase='unavailable';message='Proposal history could not be verified. Load again.';});};
 const save=()=>{if(!view().canSave||!context||!proof||!draft)return Promise.resolve();const prior=context,input=parseHoldPayload(draft),current=selected;let dispatched=false;return run(async signal=>{
  await fresh(signal);if(!same(prior,context!)||context!.context.writeState!=='ready'){clearPrivate();phase='review';message='Access or recovery changed. No proposal was submitted. Load current records.';return;}
  original=parseHoldSave({schemaVersion:1,businessId:prior.context.businessId,operationId:id(),recoveryEpoch:prior.context.recoveryEpoch,holdId:current?.hold_id??id(),expectedSequence:current?.sequence??'0',payload:input});
  const record=pendingHold({schemaVersion:1,businessId:original.businessId,binding:prior.binding,reference:{operationId:original.operationId,holdId:original.holdId,expectedSequence:original.expectedSequence,recoveryEpoch:original.recoveryEpoch}});deps.store.write(record);pending=record;retain('Saving the unconfirmed proposal…');emit();dispatched=true;const result=await api.save(original,proof!,signal);live(signal);finish(result);
 },error=>{if(dispatched||pending)failedSave(error,dispatched);else{clearPrivate();phase='blocked';message='The original reference could not be retained or access could not be verified. No new request was sent. Load again.';}});};
 const moreHistory=()=>{if(phase!=='ready'||!context||!selected||!history?.hasMore)return Promise.resolve();const prior=context,source=selected,afterSequence=history.versions.at(-1)?.sequence??'0';return run(async signal=>{history=null;await fresh(signal);if(!same(prior,context!))throw Error();const result=await api.history(prior.context.businessId,{holdId:source.hold_id,afterSequence,pageSize:20},proof!,signal);live(signal);if(result.state==='absent'||result.currentSequence!==source.sequence){selected=null;draft=null;message='This proposal changed while history was loading. Load current records.';return;}history=result;message='Showing the next retained proposal history page.';},()=>{clearPrivate();phase='unavailable';message='Retained history could not be verified. Load current proposals again.';});};
 const check=()=>{if(phase!=='pending'||!pending)return Promise.resolve();return run(async signal=>{canRetry=false;await fresh(signal);await inspect(signal);},()=>retain('The original save could not be verified. Keep its reference and check again.'));};
 const retry=()=>{if(phase!=='pending'||!view().canRetry||!pending||!original||!context)return Promise.resolve();const command=original,prior=context;return run(async signal=>{canRetry=false;await fresh(signal);if(!same(prior,context!)||!eligible()||context!.context.writeState!=='ready'||context!.context.recoveryEpoch!==command.recoveryEpoch)throw Error();deps.store.require(pending!);const result=await api.save(command,proof!,signal);live(signal);finish(result);},error=>failedSave(error,false));};
 return Object.freeze({view,load,more,open,save,check,retry,moreHistory,
  create(){if(active||phase!=='ready'||context?.context.writeState!=='ready')return;selected=null;history=null;draft=emptyHoldPayload;message='Choose an existing customer and review the proposed time. This creates no confirmed job.';emit();},
  edit(value:HoldPayload){if(!active&&phase==='ready'&&draft&&context?.context.writeState==='ready'&&selected?.state!=='withdrawn'){draft=Object.freeze({...value});emit();}},
  suspend(){active?.abort();active=null;clearPrivate();phase='review';message='Private proposal details cleared. Load current records before continuing.';emit();},
  dispose(){alive=false;active?.abort();active=null;clearPrivate();}
 });
}
