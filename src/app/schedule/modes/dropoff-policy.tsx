'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../../client/authentication';
import {scheduling} from '../../../client/scheduling';
import {postScheduling,SchedulingClientError} from '../../../client/scheduling-transport';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {PendingScheduling} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import {dropoffPolicyConflicts,dropoffPolicyKind,dropoffPolicyOriginal,dropoffPolicyRevisionConflicts,
 dropoffPolicyRevisionKind,dropoffPolicyRevisionOriginal,parseDropoffPolicy,parseDropoffPolicyAcknowledgement,
 parseDropoffPolicyRevision,parseDropoffPolicyRevisionAcknowledgement,parseDropoffPolicySave} from '../../../operations/dropoff-custody-contract';
import type {SavedDropoffPolicy} from '../../../operations/dropoff-custody-contract';
import type {FulfillmentModeVersion} from '../../../operations/fulfillment-mode-contract';
import {exactCustomerObject as exact} from '../../../customer/customer-contract';

const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
type PolicyKind=typeof dropoffPolicyKind|typeof dropoffPolicyRevisionKind;
const initial={busy:false,loaded:false,pending:false,pendingKind:dropoffPolicyKind as PolicyKind,
 reloadRequired:false,policy:null as SavedDropoffPolicy|null,message:'Load the saved policy for this arrangement.'};
function PolicyEditor({businessId,mode,canWrite,canRevise,reloadModes}:{businessId:string;mode:FulfillmentModeVersion;
 canWrite:boolean;canRevise:boolean;reloadModes:()=>Promise<void>}){
 const [view,setView]=useState(initial),[text,setText]=useState(''),[photo,setPhoto]=useState(''),prefix=useId();
 const [editing,setEditing]=useState(false),[reason,setReason]=useState('');
 const request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const store=(kind:PolicyKind)=>createPendingSchedulingStore(storage,kind);
 function clearDraft(){setText('');setPhoto('');setReason('');setEditing(false);}
 useEffect(()=>{
  const clear=()=>{request.current?.abort();request.current=null;setText('');setPhoto('');setReason('');setEditing(false);setView(initial);};
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
   const proof=await authentication.session(active.signal),value=await read(proof,active.signal);
   const pendingKind=store(dropoffPolicyRevisionKind).read()?dropoffPolicyRevisionKind:dropoffPolicyKind;
   const pending=store(pendingKind).read()!==null;
   if(!active.signal.aborted)setView({...initial,loaded:true,pending,pendingKind,policy:'state'in value?null:value,
    message:pending?'Review the interrupted policy save before another change.':'state'in value?'No policy is saved for this arrangement.':'Saved Drop-Off policy loaded.'});
  }catch{if(!active.signal.aborted)setView({...initial,message:'The policy could not be verified. Reload to try again.'});}
  finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 async function save(){
  if(request.current||!canWrite||!view.loaded||view.pending||!['required','reason'].includes(photo))return;
  const priorPolicy=view.policy;
  if(priorPolicy&&(!canRevise||!editing||!reason.trim()))return;
  const kind=priorPolicy?dropoffPolicyRevisionKind:dropoffPolicyKind;
  const active=new AbortController();request.current=active;
  const pendingStore=store(kind);let retained:PendingScheduling|null=null,confirmed=false;
  setView({...view,busy:true,message:'Saving the Drop-Off policy…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   const context=workspace.context;
   if(workspace.dropoffCustodyAvailable!==true||context.businessId!==businessId||context.writeState!=='ready')throw new SchedulingClientError('recovery');
   if(priorPolicy&&(workspace.dropoffPolicyRevisionAvailable!==true||context.modeVersion?.id!==mode.id)){
    clearDraft();setView({...initial,reloadRequired:true,message:'The current service arrangement changed. Reload arrangements before revising its policy.'});return;
   }
   if(pendingStore.read()){
    clearDraft();setView({...initial,pending:true,pendingKind:kind,message:'Review the interrupted policy save before another change.'});return;
   }
   if((Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).some(other=>other!==kind&&createPendingSchedulingStore(storage,other).read())){
    clearDraft();setView({...initial,message:'Review the other interrupted scheduling save before saving a policy.'});return;
   }
   const body={acknowledgementText:text.trim()||null,conditionPhotoRequired:photo==='required'};
   const base={schemaVersion:1,businessId,operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,modeVersionId:mode.id};
   const revision=priorPolicy?parseDropoffPolicyRevision({...base,policyId:priorPolicy.id,body:{...body,reason:reason.trim()}}):null;
   const input=revision??parseDropoffPolicySave({...base,body});
   const original=revision?dropoffPolicyRevisionOriginal(revision):dropoffPolicyOriginal(input);
   retained={schemaVersion:1,businessId,binding:workspace.binding,reference:original.reference};pendingStore.write(retained);
   const {schemaVersion,operationId,recoveryEpoch,modeVersionId,body:payload}=input;
   const submitted={schemaVersion,operationId,recoveryEpoch,modeVersionId,body:payload,
    ...revision?{policyId:revision.policyId}:{}};
   const result=await postScheduling(priorPolicy?'custody-policy-revise':'custody-policy-save',submitted,proof,active.signal);
   active.signal.throwIfAborted();
   if(result.status===409&&exact(result.value,['state','reason'])&&result.value.state==='conflict'){
    const reason=result.value.reason;
    const conflicts=priorPolicy?dropoffPolicyRevisionConflicts:dropoffPolicyConflicts;
    if(reason==='operation'||!conflicts.some(expected=>reason===expected))throw Error();
    pendingStore.clear(retained);retained=null;clearDraft();
    setView({...initial,reloadRequired:reason==='version',message:reason==='version'?'The current arrangement changed. Reload arrangements before revising its policy.':
     reason==='unchanged'?'The requirements are already saved. No revision was created.':
     reason==='configured'?'A policy was already saved for this arrangement. Reload to review it.':
     'This arrangement is unavailable for Drop-Off policy setup.'});return;
   }
   if(result.status!==200)throw Error();
   if(revision){
    parseDropoffPolicyRevisionAcknowledgement(result.value,revision);confirmed=true;
    pendingStore.clear(retained);retained=null;clearDraft();
    setView({...initial,reloadRequired:true,message:'Drop-Off policy saved for future bookings.'});return;
   }
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
   setView(retained?{...initial,pending:true,pendingKind:kind,message:confirmed?'Policy saved. Review the retained reference before another change.':
    'The policy save could not be confirmed. Check Save review before trying again.'}:confirmed?
    {...initial,message:'Policy saved. Reload to review it.'}:{...view,busy:false,message:
     error instanceof SchedulingClientError&&error.kind==='recovery'?'Policy changes are unavailable during recovery review.':
     'No policy was submitted. Check your sign-in and the required fields.'});
  }finally{if(request.current===active){request.current=null;status.current?.focus();}}
 }
 return <section aria-label="Selected Drop-Off policy" aria-busy={view.busy}>
  <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.pending&&<a href={'/save-review?kind='+view.pendingKind}>Open policy Save review</a>}
  {view.reloadRequired?<button type="button" className="secondary" disabled={view.busy} onClick={()=>void reloadModes()}>Reload service arrangements</button>:
   <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>
    {view.loaded?'Reload Drop-Off policy':'Load Drop-Off policy'}
   </button>}
  {view.policy&&<dl className="customer-values">
   <dt>Condition photos</dt><dd>{view.policy.conditionPhotoRequired?'Verified photo required':'Missing-photo reason allowed'}</dd>
   <dt>Acknowledgement</dt><dd>{view.policy.acknowledgementText??'No acknowledgement configured'}</dd>
  </dl>}
  {view.policy&&canRevise&&!view.busy&&!view.pending&&!editing&&<button type="button" className="secondary" onClick={()=>{
   const policy=view.policy;if(!policy)return;
   setText(policy.acknowledgementText??'');setPhoto(policy.conditionPhotoRequired?'required':'reason');setEditing(true);
  }}>Revise for future bookings</button>}
  {view.loaded&&(!view.policy||editing&&canRevise)&&!view.pending&&canWrite&&<form className="field-work-form" onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset disabled={view.busy}><legend>{editing?'New Drop-Off policy':`Policy for arrangement ${mode.sequence}`}</legend>
    <p className="field-help">{editing?'Existing bookings keep their saved policy. This revision applies to future bookings.':
     'This policy applies to jobs booked under this arrangement.'}</p>
    <label htmlFor={prefix+'-photo'}>Condition photo requirement</label>
    <select id={prefix+'-photo'} required value={photo} onChange={event=>setPhoto(event.target.value)}>
     <option value="">Choose a requirement</option><option value="required">Verified photo required</option>
     <option value="reason">Allow missing-photo reason</option>
    </select>
    <label htmlFor={prefix+'-ack'}>Handoff acknowledgement (optional)</label>
    <textarea id={prefix+'-ack'} rows={3} maxLength={2000} value={text} onChange={event=>setText(event.target.value)}/>
    <p className="field-help">Leave blank if no acknowledgement is required.</p>
    {editing&&<><label htmlFor={prefix+'-reason'}>Reason for the revision</label>
     <textarea id={prefix+'-reason'} required rows={2} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></>}
    <p className="field-help">Saving needs a recent owner sign-in.</p>
    <button type="submit">{editing?'Save policy revision':'Save Drop-Off policy'}</button>
    {editing&&<button type="button" className="secondary" onClick={clearDraft}>Cancel revision</button>}
   </fieldset>
  </form>}
 </section>;
}

export function DropoffPolicySettings({businessId,current,history,canWrite,revisionAvailable,reloadModes}:{businessId:string;current:FulfillmentModeVersion;
 history:readonly FulfillmentModeVersion[];canWrite:boolean;revisionAvailable:boolean;reloadModes:()=>Promise<void>}){
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
   <PolicyEditor key={selected.id} businessId={businessId} mode={selected} canWrite={canWrite}
    canRevise={canWrite&&revisionAvailable&&selected.id===current.id} reloadModes={reloadModes}/>
  </>}
 </details>;
}
