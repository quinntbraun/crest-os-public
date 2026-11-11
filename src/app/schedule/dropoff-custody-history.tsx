'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {postScheduling,SchedulingClientError} from '../../client/scheduling-transport';
import {scheduling} from '../../client/scheduling';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../client/pending-scheduling';
import type {PendingScheduling} from '../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../operations/scheduling-original-contract';
import {dropoffCustodyConflicts,dropoffCustodyKind,dropoffCustodyOriginal,parseDropoffCustody,parseDropoffCustodyAcknowledgement,
 parseDropoffCustodySave} from '../../operations/dropoff-custody-contract';
import type {DropoffCustody,DropoffCustodySave} from '../../operations/dropoff-custody-contract';
import type {Proof} from '../../client/authentication';
import {BookingInstantInput} from './booking-fields';
import {DropoffPhotoPicker,DropoffPhotoViewer} from './dropoff-photo-fields';
import {exactCustomerObject as exact} from '../../customer/customer-contract';
import {buildDropoffCustodyArchive} from '../../operations/dropoff-custody-archive';

const labels={
 expected:'Expected',not_received:'No intake recorded',in_custody:'In Crest custody',
 awaiting_collection:'Awaiting collection',return_required:'Return required',released:'Released'
} as const;
type Props=Readonly<{businessId:string;jobId:string;jobVehicleId:string;vehicleId:string;timezone:string;canChange:boolean}>;
const initial={message:'Load the saved handoffs for this vehicle.',busy:false,record:null as DropoffCustody|null,signedOut:false,pending:false,photos:false};
type Body=DropoffCustodySave['body'];
const browserStorage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const store=()=>createPendingSchedulingStore(browserStorage,dropoffCustodyKind);
const conflictMessages:Readonly<Record<string,string>>={
 job:'The saved job state changed. Reload to review the current vehicle.',
 version:'The custody record changed. Reload before trying again.',
 policy:'The handoff policy changed. Reload to review the saved policy.',
 photo:'This policy requires a verified condition photo.',
 acknowledgement:'The saved policy requires an acknowledgement.',
 vehicle_held:'This vehicle is already in Crest custody on another job.'
};
function HandoffForm({policy,timezone,release,busy,save,close,photos,businessId,jobVehicleId,caseId}:{
 policy:NonNullable<DropoffCustody['policy']>;timezone:string;release:boolean;busy:boolean;
 save:(body:Body)=>Promise<void>;close:()=>void;photos:boolean;businessId:string;jobVehicleId:string;caseId:string}){
 const prefix=useId(),[effectiveAt,setEffectiveAt]=useState(''),[person,setPerson]=useState(''),[location,setLocation]=useState(''),
  [reason,setReason]=useState(''),[notes,setNotes]=useState(''),[acknowledged,setAcknowledged]=useState(false);
 const [photo,setPhoto]=useState<{selected:boolean;id:string|null}>({selected:false,id:null});
 const waitingForPhoto=(policy.conditionPhotoRequired||photo.selected)&&!photo.id;
 return <form className="field-work-form" onSubmit={event=>{
  event.preventDefault();
  if(busy||waitingForPhoto)return;
  void save({authorizationConfigId:policy.id,effectiveAt,person:{schemaVersion:1,displayName:person.trim()},
   location:{schemaVersion:1,kind:'manual',locationText:location.trim(),instructions:null},notes:notes.trim()||null,
   ...photo.id?{conditionPhotoId:photo.id,missingPhotoReason:null}:{missingPhotoReason:reason.trim()},
   acknowledgementConfirmed:policy.acknowledgementText===null?null:acknowledged?true:null});
 }}>
  <fieldset disabled={busy}><legend>{release?'Release vehicle':'Receive vehicle'}</legend>
   <BookingInstantInput label="Actual handoff time" value={effectiveAt} zone={timezone} change={setEffectiveAt} seconds={release}/>
   <p className="field-help">Enter the time of the handoff in {timezone}.{release?' Include seconds if collection happened in the same minute as completion.':''}</p>
   <label htmlFor={prefix+'-person'}>{release?'Who collected the vehicle?':'Who handed over the vehicle?'}</label>
   <input id={prefix+'-person'} autoComplete="off" maxLength={200} required value={person} onChange={event=>setPerson(event.target.value)}/>
   <label htmlFor={prefix+'-location'}>Handoff location</label>
   <input id={prefix+'-location'} autoComplete="off" maxLength={2000} required value={location} onChange={event=>setLocation(event.target.value)}/>
   {photos&&<DropoffPhotoPicker businessId={businessId} jobVehicleId={jobVehicleId} caseId={caseId}
    handoff={release?2:1} required={policy.conditionPhotoRequired} change={(selected,id)=>setPhoto({selected,id})}/>}
   {!photo.selected&&!policy.conditionPhotoRequired&&<>
    <label htmlFor={prefix+'-photo'}>Why is a condition photo missing?</label>
    <textarea id={prefix+'-photo'} rows={2} maxLength={1000} required value={reason} onChange={event=>setReason(event.target.value)}/>
   </>}
   <label htmlFor={prefix+'-notes'}>Notes (optional)</label>
   <textarea id={prefix+'-notes'} rows={2} maxLength={1000} value={notes} onChange={event=>setNotes(event.target.value)}/>
   {policy.acknowledgementText!==null&&<>
    <p id={prefix+'-requirement'}>{policy.acknowledgementText}</p>
    <label><input type="checkbox" required aria-describedby={prefix+'-requirement'} checked={acknowledged}
     onChange={event=>setAcknowledged(event.target.checked)}/> Record the required acknowledgement</label>
   </>}
   <button type="submit" disabled={!effectiveAt||waitingForPhoto}>{busy?'Saving…':release?'Save release':'Save intake'}</button>
   <button type="button" className="secondary" onClick={close}>Cancel handoff entry</button>
  </fieldset>
 </form>;
}
export function DropoffCustodyHistory({businessId,jobId,jobVehicleId,vehicleId,timezone,canChange}:Props){
 const [view,setView]=useState(initial),[editing,setEditing]=useState<string|null>(null);
 const anchor=useRef<HTMLElement>(null),request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const downloadUrl=useRef<string|null>(null);
 function revokeDownload(){if(downloadUrl.current){URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;}}
 useEffect(()=>{
  const clear=()=>{request.current?.abort();request.current=null;revokeDownload();setEditing(null);setView(initial);};
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  const parent=anchor.current?.closest('details');
  const collapsed=()=>{if(parent&&!parent.open)clear();};
  parent?.addEventListener('toggle',collapsed);document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{
   request.current?.abort();request.current=null;revokeDownload();
   parent?.removeEventListener('toggle',collapsed);document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);
 async function read(proof:Proof,signal:AbortSignal){
  const response=await postScheduling('custody-context',{jobId,jobVehicleId},proof,signal);
  if(response.status!==200)throw Error();
  return {record:parseDropoffCustody(response.value,{businessId,jobId,jobVehicleId,vehicleId}),
   photos:response.dropoffPhotosAvailable===true};
 }
 async function load(){
  if(request.current)return;
  const active=new AbortController();request.current=active;
  setEditing(null);setView({...initial,message:'Loading saved custody…',busy:true});
  try{
   const proof=await authentication.session(active.signal);
   const {record:value,photos}=await read(proof,active.signal),pending=store().read()!==null;
   if(!active.signal.aborted)setView({...initial,pending,photos,message:pending?'Review the interrupted handoff before another change.':
    value.state==='absent'?'Custody details are unavailable for this vehicle.':'Saved custody loaded.',record:value.state==='absent'?null:value});
  }catch(error){
   if(!active.signal.aborted){
    const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
    setView({...initial,signedOut,message:signedOut?'Sign in again to review custody.':'Custody details could not be loaded. Try again.'});
   }
  }finally{
   if(request.current===active){request.current=null;status.current?.focus();}
  }
 }
 async function save(body:Body){
  const record=view.record;
  if(!canChange||!editing||request.current||view.pending||!record?.policy||
   (record.policy.conditionPhotoRequired&&!('conditionPhotoId'in body))||
   !['expected','awaiting_collection','return_required'].includes(record.state))return;
  if(!body.effectiveAt||Date.parse(body.effectiveAt)>Date.now()){
   setView({...view,message:'Enter the actual handoff time. It cannot be in the future.'});return;
  }
  const active=new AbortController();request.current=active;
  const pendingStore=store();
  let retained:PendingScheduling|null=null,confirmed=false;
  setView({...view,busy:true,message:'Saving the handoff…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   const context=workspace.context;
   if(context.businessId!==businessId||workspace.dropoffCustodyAvailable!==true||context.writeState!=='ready')
    throw new SchedulingClientError('recovery');
   if(pendingStore.read()){
    setEditing(null);setView({...initial,pending:true,message:'Review the interrupted handoff before another change.'});return;
   }
   if((Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).some(kind=>kind!==dropoffCustodyKind&&createPendingSchedulingStore(browserStorage,kind).read())){
    setEditing(null);setView({...initial,message:'Review the other interrupted scheduling save before entering a handoff.'});return;
   }
   const input=parseDropoffCustodySave({schemaVersion:1,businessId,operationId:crypto.randomUUID(),
    recoveryEpoch:context.recoveryEpoch,jobVehicleId,caseId:editing,expectedVersion:record.version,body});
   const original=dropoffCustodyOriginal(input);
   retained={schemaVersion:1,businessId,binding:workspace.binding,reference:original.reference};
   pendingStore.write(retained);
   const {schemaVersion,operationId,recoveryEpoch,caseId,expectedVersion,body:payload}=input;
   const response=await postScheduling('custody-save',{schemaVersion,operationId,recoveryEpoch,jobVehicleId,caseId,expectedVersion,body:payload},proof,active.signal);
   active.signal.throwIfAborted();
   const value=response.value;
   if(response.status===409&&exact(value,['state','reason'])&&value.state==='conflict'&&
    typeof value.reason==='string'&&dropoffCustodyConflicts.some(reason=>reason===value.reason)){
    if(value.reason==='operation')throw Error();
    pendingStore.clear(retained);retained=null;setEditing(null);
    setView({...initial,message:conflictMessages[value.reason]??'Reload to review saved custody.'});return;
   }
   if(response.status!==200)throw Error();
   const saved=parseDropoffCustodyAcknowledgement(response.value,input).result.receipt;
   confirmed=true;
   pendingStore.clear(retained);retained=null;
   const {record:current,photos}=await read(proof,active.signal);active.signal.throwIfAborted();
   if(current.state==='absent'||!current.events.some(event=>event.eventId===saved.sourceRecordId))throw Error();
   setEditing(null);setView({...initial,message:'Handoff saved.',record:current,photos});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* Retain the reference for review. */}
   }
   if(retained||confirmed)setEditing(null);
   setView(retained?{...initial,pending:true,message:confirmed?'Handoff saved. Review the retained reference before another change.':
    'The handoff could not be confirmed. Check Save review before trying again.'}:confirmed?
    {...initial,message:'Handoff saved. Reload to see the latest history.'}:{...view,busy:false,message:
     error instanceof SchedulingClientError&&error.kind==='recovery'?'Handoff changes are unavailable during recovery review.':
     'No handoff was submitted. Check the details and try again.'});
  }finally{
   if(request.current===active){request.current=null;status.current?.focus();}
  }
 }
 async function downloadHistory(){
  const selected=view.record;
  if(!selected||request.current||view.pending||editing)return;
  const active=new AbortController();request.current=active;
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  setView({...view,busy:true,message:'Preparing saved custody history…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   if(workspace.context.businessId!==businessId||workspace.dropoffCustodyAvailable!==true)throw Error();
   const expected=JSON.stringify(selected);
   const current=await read(proof,active.signal);
   if(JSON.stringify(current.record)!==expected)throw Error();
   bytes=await buildDropoffCustodyArchive(current.record,{businessId,jobId,jobVehicleId,vehicleId});
   const confirmed=await read(proof,active.signal),authority=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   if(JSON.stringify(confirmed.record)!==expected||workspace.binding!==authority.binding||
    authority.context.businessId!==businessId||authority.dropoffCustodyAvailable!==true||
    workspace.context.recoveryEpoch!==authority.context.recoveryEpoch)throw Error();
   revokeDownload();
   const url=downloadUrl.current=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
   const link=document.createElement('a');link.href=url;link.download='crest-custody-history.zip';link.rel='noopener noreferrer';link.hidden=true;
   document.body.append(link);
   try{link.click();}finally{link.remove();setTimeout(()=>{if(downloadUrl.current===url)revokeDownload();},1000);}
   setView({...view,busy:false,message:'Custody history download requested. Check your downloads.'});
  }catch{
   if(!active.signal.aborted)setView({...initial,message:'No file could be prepared. Reload the saved custody history before downloading.'});
  }finally{
   bytes?.fill(0);
   if(request.current===active){request.current=null;status.current?.focus();}
  }
 }
 function time(instant:string){
  return new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(instant));
 }
 const record=view.record;
 const release=record?.state==='awaiting_collection'||record?.state==='return_required';
 const maySave=canChange&&!view.pending&&record?.policy&&(!record.policy.conditionPhotoRequired||view.photos)&&(record.state==='expected'||release);
 return <section ref={anchor} aria-label="Vehicle custody" aria-busy={view.busy}>
  <h4>Vehicle custody</h4>
  <p role="status" tabIndex={-1} ref={status}>{view.message}</p>
  {view.signedOut&&<a href="/sign-in">Sign in</a>}
  {record&&<p><strong>{labels[record.state]}</strong></p>}
  {view.pending&&<p><a href={'/save-review?kind='+dropoffCustodyKind}>Open Save review</a></p>}
  <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>
   {record?'Reload custody history':'Load custody history'}
  </button>
  {record&&<>
   {record.state==='return_required'&&<p>The job was cancelled while the vehicle was held. Collection still needs to be recorded.</p>}
   {record.state==='expected'&&record.policy===null&&<p>A handoff policy needs to be configured for this booking.</p>}
   {record.policy?.conditionPhotoRequired&&<p>A verified condition photo is required by the saved policy.</p>}
   {record.policy?.acknowledgementText&&<details><summary>Saved acknowledgement requirement</summary><p>{record.policy.acknowledgementText}</p></details>}
   <button type="button" className="secondary" disabled={view.busy||view.pending||!!editing} onClick={()=>void downloadHistory()}>
    Download custody history (CSV + JSON)
   </button>
   <p className="field-help">Includes saved handoffs and photo IDs. Download photo files separately from the handoff.</p>
   {maySave&&record.policy&&(editing?<HandoffForm policy={record.policy} timezone={timezone} release={release}
    busy={view.busy} save={save} close={()=>setEditing(null)} photos={view.photos} businessId={businessId}
    jobVehicleId={jobVehicleId} caseId={editing}/>:<button type="button" disabled={view.busy}
     onClick={()=>setEditing(record.caseId??crypto.randomUUID())}>{release?'Record release…':'Record intake…'}</button>)}
   {record.events.length>0&&<><p className="field-help">Time zone: {timezone}</p><ol>{record.events.map(event=><li key={event.eventId}>
    <p><strong>{event.action==='received'?'Received':'Released'}</strong> · <time dateTime={event.effectiveAt}>{time(event.effectiveAt)}</time></p>
    <dl className="customer-values"><dt>Person</dt><dd>{event.person.displayName}</dd><dt>Location</dt><dd>{event.location.locationText}
    {event.location.instructions&&<p>{event.location.instructions}</p>}</dd><dt>Photo</dt>
    <dd>{event.missingPhotoReason===null?<>{'Verified condition photo linked'}
     {view.photos&&'conditionPhotoId'in event&&typeof event.conditionPhotoId==='string'&&
      <DropoffPhotoViewer jobVehicleId={jobVehicleId} photoId={event.conditionPhotoId}/>}</>:<>Missing · {event.missingPhotoReason}</>}</dd>
    {event.notes&&<><dt>Notes</dt><dd>{event.notes}</dd></>}
    {event.acknowledgementConfirmed&&<><dt>Policy</dt><dd>Acknowledged</dd></>}
    <dt>Recorded</dt><dd><time dateTime={event.recordedAt}>{time(event.recordedAt)}</time></dd></dl>
   </li>)}</ol></>}
  </>}
 </section>;
}
