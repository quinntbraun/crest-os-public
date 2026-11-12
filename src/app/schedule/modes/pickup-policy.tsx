'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../../client/authentication';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {PendingScheduling} from '../../../client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../../client/scheduling';
import {parsePickupPolicySave,pickupPolicyKind,pickupPolicyOriginal} from '../../../operations/pickup-custody-contract';
import type {PickupPolicy,PickupPolicySave} from '../../../operations/pickup-custody-contract';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';

const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const store=()=>createPendingSchedulingStore(storage,pickupPolicyKind);
type Page=Awaited<ReturnType<typeof scheduling.pickupPolicy>>;
type Body=PickupPolicySave['body'];
const initial={page:null as Page|null,busy:false,pending:false,signedOut:false,message:''};
const conflicts:Readonly<Record<string,string>>={
 arrangements:'Initialize service arrangements before saving a pickup policy.',
 version:'The pickup policy changed. Reload the saved policy before editing.',
 unchanged:'The pickup requirements match the current policy. No revision was saved.'
};

function PolicyForm({policy,busy,save}:{policy:PickupPolicy|undefined;busy:boolean;save:(body:Body)=>Promise<void>}){
 const id=useId();
 return <form className="field-work-form" onSubmit={event=>{
  event.preventDefault();
  if(busy)return;
  const fields=new FormData(event.currentTarget),text=(name:string)=>String(fields.get(name)??'').trim();
  const photo=fields.get('photo');
  if(photo!=='required'&&photo!=='reason')return;
  void save({acknowledgementText:text('acknowledgement')||null,conditionPhotoRequired:photo==='required',reason:text('reason')||null});
 }}>
  <fieldset disabled={busy}>
   <legend>{policy?'Revise pickup policy':'Set pickup policy'}</legend>
   <label htmlFor={id+'-photo'}>Condition photos</label>
   <select id={id+'-photo'} name="photo" required defaultValue={policy?policy.conditionPhotoRequired?'required':'reason':''}>
    <option value="">Choose a photo requirement</option>
    <option value="required">Require a verified photo</option>
    <option value="reason">Allow a reason when a photo is missing</option>
   </select>
   <label htmlFor={id+'-acknowledgement'}>Handoff acknowledgement (optional)</label>
   <textarea id={id+'-acknowledgement'} name="acknowledgement" autoComplete="off" rows={3} maxLength={2000} defaultValue={policy?.acknowledgementText??''}/>
   <p className="field-help">If entered, this acknowledgement must be recorded at handoff.</p>
   {policy&&<>
    <label htmlFor={id+'-reason'}>Reason for revision</label>
    <textarea id={id+'-reason'} name="reason" autoComplete="off" rows={3} maxLength={1000} required/>
   </>}
   <button type="submit">Save pickup policy</button>
  </fieldset>
 </form>;
}

export function PickupPolicySettings({businessId,timezone,canWrite}:{businessId:string;timezone:string;canWrite:boolean}){
 const [view,setView]=useState(initial),[editing,setEditing]=useState(false);
 const request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 function clear(){request.current?.abort();request.current=null;setView(initial);setEditing(false);}
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   request.current?.abort();request.current=null;
   document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);
 function finish(active:AbortController){
  if(request.current===active){request.current=null;status.current?.focus();}
 }
 async function load(more=false){
  if(request.current)return;
  const prior=more?view.page:null,cursor=prior?.versions.at(-1)?.sequence??null;
  const active=new AbortController();request.current=active;setEditing(false);
  setView({...initial,page:prior,busy:true,message:'Loading pickup policy history…'});
  try{
   const proof=await authentication.session(active.signal);
   const page=await scheduling.pickupPolicy(businessId,cursor,proof,active.signal);
   active.signal.throwIfAborted();
   if(prior&&prior.currentSequence!==page.currentSequence)throw Error();
   const pending=store().read()!==null;
   setView({...initial,page:prior?{...page,versions:[...prior.versions,...page.versions]}:page,pending,
    message:pending?'Review the interrupted pickup policy save.':page.versions.length?'Saved pickup policy loaded.':'No pickup policy is saved.'});
  }catch(error){
   if(active.signal.aborted)return;
   const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
   setView({...initial,signedOut,message:signedOut?'Sign in to load the pickup policy.':'Pickup policy could not be verified. Reload to try again.'});
  }finally{finish(active);}
 }
 async function save(body:Body){
  const page=view.page;
  if(request.current||!canWrite||!page||view.pending)return;
  const active=new AbortController();request.current=active;
  const pendingStore=store();
  let retained:PendingScheduling|null=null,confirmed=false;
  setView({...view,busy:true,message:'Saving pickup policy…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   if(workspace.context.businessId!==businessId||workspace.pickupPolicyAvailable!==true||workspace.context.writeState!=='ready')
    throw new SchedulingClientError('recovery');
   const blocker=(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).find(kind=>createPendingSchedulingStore(storage,kind).read()!==null);
   if(blocker){
    setEditing(false);setView({...initial,pending:blocker===pickupPolicyKind,message:'Resolve the interrupted scheduling save before editing the pickup policy.'});
    return;
   }
   let input;
   try{input=parsePickupPolicySave({schemaVersion:1,businessId,operationId:crypto.randomUUID(),recoveryEpoch:workspace.context.recoveryEpoch,
    expectedSequence:page.currentSequence,body});}
   catch{throw new SchedulingClientError('input');}
   const original={schemaVersion:1 as const,businessId,binding:workspace.binding,reference:pickupPolicyOriginal(input).reference};
   pendingStore.write(original);retained=original;
   const result=await scheduling.savePickupPolicy(input,proof,active.signal);
   active.signal.throwIfAborted();
   if('state'in result){
    if(result.reason==='operation')throw Error();
    pendingStore.clear(retained);retained=null;
    if(result.reason==='unchanged')setView({...view,message:conflicts.unchanged!});
    else{setEditing(false);setView({...initial,message:conflicts[result.reason]??'Reload the current policy.'});}
    return;
   }
   confirmed=true;pendingStore.clear(retained);retained=null;setEditing(false);
   const saved=await scheduling.pickupPolicy(businessId,null,proof,active.signal);
   active.signal.throwIfAborted();
   if(!saved.versions.some(policy=>policy.id===result.result.receipt.sourceRecordId))throw Error();
   setView({...initial,page:saved,message:'Pickup policy saved.'});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* The opaque original remains available in Save review. */}
   }
   if(retained||confirmed)setEditing(false);
   setView(retained?{...initial,pending:true,message:'The policy save could not be confirmed. Check Save review before trying again.'}:
    confirmed?{...initial,message:'Pickup policy saved. Reload to see the current version.'}:
    {...view,busy:false,message:error instanceof SchedulingClientError&&error.kind==='input'?
     'Check the pickup policy fields and try again.':'Pickup policy was not submitted. Check your sign-in and try again.'});
  }finally{finish(active);}
 }
 const current=view.page?.versions[0];
 const format=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:timezone});
 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Pickup handoff policy</summary>
  <section aria-label="Pickup handoff policy settings">
   <p className="field-help">Changes apply to future Pickup + Return bookings. Enable the service separately in Service arrangements.</p>
   <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
   <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>{view.page?'Reload pickup policy':'Load pickup policy'}</button>
   {view.signedOut&&<p><a href="/sign-in">Sign in</a></p>}
   {view.pending&&<p><a href={'/save-review?kind='+pickupPolicyKind}>Open Save review</a></p>}
   {view.page&&!view.pending&&canWrite&&(editing?
    <><PolicyForm key={current?.id??'initial'} policy={current} busy={view.busy} save={save}/>
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>setEditing(false)}>Cancel policy edit</button></>:
    <button type="button" disabled={view.busy} onClick={()=>setEditing(true)}>{current?'Edit pickup policy':'Create pickup policy'}</button>)}
   {current&&<dl className="customer-values">
    <dt>Current policy</dt><dd>Version {current.sequence}</dd>
    <dt>Condition photos</dt><dd>{current.conditionPhotoRequired?'Verified photo required':'Missing photo requires a reason'}</dd>
    <dt>Acknowledgement</dt><dd>{current.acknowledgementText??'None configured'}</dd>
   </dl>}
   {current&&(view.page!.versions.length>1||view.page!.hasMore)&&<details><summary>Earlier pickup policies</summary>
    <ol>{view.page!.versions.slice(1).map(policy=><li key={policy.id}>
     <p><strong>Version {policy.sequence}</strong> · <time dateTime={policy.recordedAt}>{format.format(new Date(policy.recordedAt))}</time></p>
     <p>{policy.conditionPhotoRequired?'Verified photo required':'Missing photo requires a reason'}</p>
     {policy.acknowledgementText&&<p>{policy.acknowledgementText}</p>}{policy.reason&&<p>{policy.reason}</p>}
    </li>)}</ol>
    {view.page!.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void load(true)}>Load more pickup policies</button>}
   </details>}
  </section>
 </details>;
}
