'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../../client/authentication';
import {scheduling} from '../../../client/scheduling';
import {postScheduling,SchedulingClientError} from '../../../client/scheduling-transport';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {PendingScheduling} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import {dropoffPolicyConflicts,dropoffPolicyKind,dropoffPolicyOriginal,parseDropoffPolicy,parseDropoffPolicyAcknowledgement,
 parseDropoffPolicySave} from '../../../operations/dropoff-custody-contract';
import type {SavedDropoffPolicy} from '../../../operations/dropoff-custody-contract';
import type {FulfillmentModeVersion} from '../../../operations/fulfillment-mode-contract';
import {exactCustomerObject as exact} from '../../../customer/customer-contract';

const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const initial={busy:false,loaded:false,pending:false,policy:null as SavedDropoffPolicy|null,message:'Load the saved policy for this arrangement.'};
function PolicyEditor({businessId,mode,canWrite}:{businessId:string;mode:FulfillmentModeVersion;canWrite:boolean}){
 const [view,setView]=useState(initial),[text,setText]=useState(''),[photo,setPhoto]=useState(''),prefix=useId();
 const request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const store=()=>createPendingSchedulingStore(storage,dropoffPolicyKind);
 function clearDraft(){setText('');setPhoto('');}
 useEffect(()=>{
  const clear=()=>{request.current?.abort();request.current=null;setText('');setPhoto('');setView(initial);};
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);
  return()=>{request.current?.abort();request.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);};
 },[]);
 async function read(proof:Awaited<ReturnType<typeof authentication.session>>,signal:AbortSignal){
  const result=await postScheduling('custody-policy',{modeVersionId:mode.id},proof,signal);
  if(result.status!==200)throw Error();
  return parseDropoffPolicy(result.value,mode.id);
 }
 async function load(){
  if(request.current)return;
  const active=new AbortController();request.current=active;clearDraft();setView({...initial,busy:true,message:'Loading the saved Drop-Off policy…'});
  try{
   const proof=await authentication.session(active.signal),value=await read(proof,active.signal),pending=store().read()!==null;
   if(!active.signal.aborted)setView({...initial,loaded:true,pending,policy:'state'in value?null:value,
    message:pending?'Review the interrupted policy save before another change.':'state'in value?'No policy is saved for this arrangement.':'Saved Drop-Off policy loaded.'});
  }catch{if(!active.signal.aborted)setView({...initial,message:'The policy could not be verified. Reload to try again.'});}
  finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 async function save(){
  if(request.current||!canWrite||!view.loaded||view.pending||view.policy||!['required','reason'].includes(photo))return;
  const active=new AbortController();request.current=active;
  const pendingStore=store();let retained:PendingScheduling|null=null,confirmed=false;
  setView({...view,busy:true,message:'Saving the Drop-Off policy…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   const context=workspace.context;
   if(workspace.dropoffCustodyAvailable!==true||context.businessId!==businessId||context.writeState!=='ready')throw new SchedulingClientError('recovery');
   if(pendingStore.read()){
    clearDraft();setView({...initial,pending:true,message:'Review the interrupted policy save before another change.'});return;
   }
   if((Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).some(kind=>kind!==dropoffPolicyKind&&createPendingSchedulingStore(storage,kind).read())){
    clearDraft();setView({...initial,message:'Review the other interrupted scheduling save before saving a policy.'});return;
   }
   const input=parseDropoffPolicySave({schemaVersion:1,businessId,operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,
    modeVersionId:mode.id,body:{acknowledgementText:text.trim()||null,conditionPhotoRequired:photo==='required'}});
   retained={schemaVersion:1,businessId,binding:workspace.binding,reference:dropoffPolicyOriginal(input).reference};pendingStore.write(retained);
   const {schemaVersion,operationId,recoveryEpoch,modeVersionId,body}=input;
   const result=await postScheduling('custody-policy-save',{schemaVersion,operationId,recoveryEpoch,modeVersionId,body},proof,active.signal);
   active.signal.throwIfAborted();
   if(result.status===409&&exact(result.value,['state','reason'])&&result.value.state==='conflict'){
    const reason=result.value.reason;
    if(reason==='operation'||!dropoffPolicyConflicts.some(expected=>reason===expected))throw Error();
    pendingStore.clear(retained);retained=null;clearDraft();
    setView({...initial,message:reason==='configured'?'A policy was already saved for this arrangement. Reload to review it.':
     'This arrangement is unavailable for Drop-Off policy setup.'});return;
   }
   if(result.status!==200)throw Error();
   const receipt=parseDropoffPolicyAcknowledgement(result.value,input).result.receipt;confirmed=true;
   pendingStore.clear(retained);retained=null;clearDraft();
   const saved=await read(proof,active.signal);active.signal.throwIfAborted();
   if('state'in saved||saved.id!==receipt.sourceRecordId)throw Error();
   setView({...initial,loaded:true,policy:saved,message:'Drop-Off policy saved.'});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* Keep the original reference. */}
   }
   if(retained||confirmed)clearDraft();
   setView(retained?{...initial,pending:true,message:confirmed?'Policy saved. Review the retained reference before another change.':
    'The policy save could not be confirmed. Check Save review before trying again.'}:confirmed?
    {...initial,message:'Policy saved. Reload to review it.'}:{...view,busy:false,message:
     error instanceof SchedulingClientError&&error.kind==='recovery'?'Policy changes are unavailable during recovery review.':
     'No policy was submitted. Check your sign-in and the required fields.'});
  }finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 return <section aria-label="Selected Drop-Off policy" aria-busy={view.busy}>
  <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.pending&&<a href={'/save-review?kind='+dropoffPolicyKind}>Open policy Save review</a>}
  <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>
   {view.loaded?'Reload Drop-Off policy':'Load Drop-Off policy'}
  </button>
  {view.policy&&<dl className="customer-values">
   <dt>Condition photos</dt><dd>{view.policy.conditionPhotoRequired?'Verified photo required':'Missing-photo reason allowed'}</dd>
   <dt>Acknowledgement</dt><dd>{view.policy.acknowledgementText??'No acknowledgement configured'}</dd>
  </dl>}
  {view.loaded&&!view.policy&&!view.pending&&canWrite&&<form className="field-work-form" onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset disabled={view.busy}><legend>Policy for arrangement {mode.sequence}</legend>
    <p className="field-help">This policy applies to jobs booked under this arrangement. Saving it does not change your enabled services.</p>
    <label htmlFor={prefix+'-photo'}>Condition photo requirement</label>
    <select id={prefix+'-photo'} required value={photo} onChange={event=>setPhoto(event.target.value)}>
     <option value="">Choose a requirement</option><option value="required">Verified photo required</option>
     <option value="reason">Allow missing-photo reason</option>
    </select>
    <label htmlFor={prefix+'-ack'}>Handoff acknowledgement (optional)</label>
    <textarea id={prefix+'-ack'} rows={3} maxLength={2000} value={text} onChange={event=>setText(event.target.value)}/>
    <p className="field-help">Leave blank if no acknowledgement is required. Saving needs a recent owner sign-in.</p>
    <button type="submit">Save Drop-Off policy</button>
   </fieldset>
  </form>}
 </section>;
}

export function DropoffPolicySettings({businessId,current,history,canWrite}:{businessId:string;current:FulfillmentModeVersion;
 history:readonly FulfillmentModeVersion[];canWrite:boolean}){
 const [open,setOpen]=useState(false),[id,setId]=useState(''),label=useId();
 const modes=[current,...history.filter(row=>row.id!==current.id)].filter(row=>row.dropoff_enabled);
 const selected=modes.find(row=>row.id===id)??modes[0];
 if(!selected)return null;
 return <details onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>Drop-Off handoff policy</summary>
  {open&&<>
   <label htmlFor={label}>Saved service arrangement</label>
   <select id={label} value={selected.id} onChange={event=>setId(event.target.value)}>
    {modes.map(mode=><option key={mode.id} value={mode.id}>Version {mode.sequence}{mode.id===current.id?' · current':''}</option>)}
   </select>
   <PolicyEditor key={selected.id} businessId={businessId} mode={selected} canWrite={canWrite}/>
  </>}
 </details>;
}
