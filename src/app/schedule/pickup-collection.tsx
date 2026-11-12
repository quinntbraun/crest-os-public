'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import type {Proof} from '../../client/authentication';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../client/pending-scheduling';
import type {PendingScheduling} from '../../client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../client/scheduling';
import {parsePickupCollectionSave,pickupCollectionKind,pickupCollectionOriginal} from '../../operations/pickup-custody-contract';
import type {PickupCollectionContext,PickupCollectionSave} from '../../operations/pickup-custody-contract';
import type {SchedulingOriginalKind} from '../../operations/scheduling-original-contract';
import {BookingInstantInput} from './booking-fields';
import {DropoffPhotoPicker,DropoffPhotoViewer} from './dropoff-photo-fields';

type Props=Readonly<{businessId:string;jobId:string;jobVehicleId:string;jobVersion:string;timezone:string;canChange:boolean;photosAvailable:boolean}>;
type Collection=Exclude<PickupCollectionContext,{state:'absent'}>;
type Body=PickupCollectionSave['body'];
const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const store=()=>createPendingSchedulingStore(storage,pickupCollectionKind);
const initial={context:null as Collection|null,busy:false,pending:false,signedOut:false,message:''};
const statusText={
 awaiting_arrival:'Record arrival at this vehicle’s pickup stop first.',
 requires_policy:'This booking has no pickup handoff policy.',
 ready:'Ready to record collection.',
 vehicle_held:'This vehicle is already in Crest custody on another job.',
 photo_required:'The saved policy requires a verified condition photo. Pickup photo capture is unavailable.',
 held:'In Crest custody.',
 return_required:'The job was cancelled. Vehicle return is still required.',
 closed:'Collection is closed for this job.'
};
const conflicts:Readonly<Record<string,string>>={
 collected:'Collection already exists for this vehicle. Reload to see the saved handoff.',
 vehicle_held:statusText.vehicle_held,
 photo:statusText.photo_required,
 acknowledgement:'Record the acknowledgement required by the saved policy.',
 policy:'The collection policy changed. Reload the saved handoff.',
 arrival:'The collection must follow the saved pickup arrival. Check the handoff time and reload.'
};
function formatTime(value:string,timezone:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'medium'}).format(new Date(value));
}
function CollectionForm({policy,arrival,timezone,busy,save,businessId,jobVehicleId,jobVersion,photosAvailable}:{
 policy:NonNullable<Collection['policy']>;arrival:NonNullable<Collection['arrival']>;
 timezone:string;busy:boolean;save:(body:Body,operationId:string)=>Promise<void>;
 businessId:string;jobVehicleId:string;jobVersion:string;photosAvailable:boolean;
}){
 const id=useId(),[effectiveAt,setEffectiveAt]=useState(''),[operationId]=useState(()=>crypto.randomUUID());
 const [photo,setPhoto]=useState<{selected:boolean;verifiedId:string|null}>({selected:false,verifiedId:null});
 const waitingForPhoto=(policy.conditionPhotoRequired||photo.selected)&&!photo.verifiedId;
 return <form className="field-work-form pickup-collection-form" onSubmit={event=>{
  event.preventDefault();
  if(busy||waitingForPhoto)return;
  const fields=new FormData(event.currentTarget);
  const value=(name:string)=>String(fields.get(name)??'').trim();
  void save({effectiveAt:effectiveAt||new Date().toISOString().replace(/Z$/,'000Z'),
   person:{schemaVersion:1,displayName:value('person')},
   location:{schemaVersion:1,kind:'manual',locationText:value('location'),instructions:null},
   ...(photo.verifiedId?{missingPhotoReason:null,conditionPhotoId:photo.verifiedId}:{missingPhotoReason:value('missingPhotoReason')}),
   notes:value('notes')||null,acknowledgementConfirmed:fields.get('acknowledged')==='on'?true:null},operationId);
 }}>
  <fieldset disabled={busy}>
   <legend>Record vehicle collection</legend>
   <p className="field-help">Pickup arrival recorded at {formatTime(arrival.arrivedAt,timezone)}.</p>
   <BookingInstantInput label="Actual collection time (optional)" zone={timezone} value={effectiveAt} change={setEffectiveAt} seconds required={false}/>
   <p className="field-help">Leave the time blank only when saving as the handoff happens. Times are in {timezone}.</p>
   <label htmlFor={id+'-person'}>Who handed over the vehicle?</label>
   <input id={id+'-person'} name="person" autoComplete="off" maxLength={200} required/>
   <label htmlFor={id+'-location'}>Actual handoff location</label>
   <input id={id+'-location'} name="location" autoComplete="off" maxLength={2000} required/>
   {photosAvailable&&<DropoffPhotoPicker businessId={businessId} jobVehicleId={jobVehicleId} caseId={operationId} handoff={1}
    pickup={{arrivalVersionId:arrival.versionId,policyId:policy.id,jobVersion}} required={policy.conditionPhotoRequired}
    change={(selected,verifiedId)=>setPhoto({selected,verifiedId})}/>}
   {!photo.selected&&!policy.conditionPhotoRequired&&<>
    <label htmlFor={id+'-reason'}>Why is a condition photo missing?</label>
    <textarea id={id+'-reason'} name="missingPhotoReason" autoComplete="off" rows={2} maxLength={1000} required/>
   </>}
   <details><summary>Add collection notes</summary>
    <label htmlFor={id+'-notes'}>Collection notes (optional)</label>
    <textarea id={id+'-notes'} name="notes" autoComplete="off" rows={2} maxLength={1000}/>
   </details>
   {policy.acknowledgementText!==null&&<>
    <p id={id+'-acknowledgement'}>{policy.acknowledgementText}</p>
    <label className="checkbox"><input type="checkbox" name="acknowledged" aria-describedby={id+'-acknowledgement'} required/> Record the required acknowledgement</label>
   </>}
   <button type="submit" disabled={waitingForPhoto}>Save vehicle collection</button>
  </fieldset>
 </form>;
}
export function PickupCollection({businessId,jobId,jobVehicleId,jobVersion,timezone,canChange,photosAvailable}:Props){
 const [view,setView]=useState(initial);
 const anchor=useRef<HTMLElement>(null),status=useRef<HTMLParagraphElement>(null),request=useRef<AbortController|null>(null);
 useEffect(()=>{
  const clear=()=>{request.current?.abort();request.current=null;setView(initial);};
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  const parent=anchor.current?.closest('details');
  const collapsed=()=>{if(parent&&!parent.open)clear();};
  parent?.addEventListener('toggle',collapsed);
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   request.current?.abort();request.current=null;
   parent?.removeEventListener('toggle',collapsed);
   document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);
 async function read(proof:Proof,signal:AbortSignal){
  const context=await scheduling.pickupCollection(businessId,jobId,jobVehicleId,proof,signal);
  signal.throwIfAborted();
  if(context.state==='absent'||context.jobVersion!==jobVersion)throw Error('PICKUP_COLLECTION_JOB_CHANGED');
  return context;
 }
 function finish(active:AbortController){
  if(request.current===active){request.current=null;status.current?.focus();}
 }
 async function load(){
  if(request.current)return;
  const active=new AbortController();request.current=active;
  setView({...initial,busy:true,message:'Loading saved collection…'});
  try{
   const proof=await authentication.session(active.signal),context=await read(proof,active.signal);
   const pending=store().read()!==null;
   setView({...initial,context,pending,message:pending?'Review the interrupted collection save before making changes.':
    context.state==='photo_required'&&photosAvailable?'Upload a verified condition photo to record collection.':statusText[context.state]});
  }catch(error){
   if(active.signal.aborted)return;
   const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
   setView({...initial,signedOut,message:signedOut?'Sign in again to review collection.':'Collection could not be loaded. Reload the saved job and try again.'});
  }finally{finish(active);}
 }
 async function save(body:Body,operationId:string){
  const context=view.context;
  if(request.current||!canChange||view.pending||!context?.policy||!context.arrival||
   !(context.state==='ready'||context.state==='photo_required'&&photosAvailable&&body.conditionPhotoId))return;
  const active=new AbortController();request.current=active;
  let retained:PendingScheduling|null=null,confirmed=false;
  const pendingStore=store();
  setView({...view,busy:true,message:'Saving vehicle collection…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   if(workspace.context.businessId!==businessId||workspace.pickupCollectionAvailable!==true||workspace.context.writeState!=='ready'||
    body.conditionPhotoId&&workspace.pickupPhotosAvailable!==true)
    throw new SchedulingClientError('recovery');
   const pending=(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[])
    .some(kind=>createPendingSchedulingStore(storage,kind).read()!==null);
   if(pending){
    setView({...initial,pending:true,message:'Review the interrupted scheduling save before recording collection.'});
    return;
   }
   let input;
   try{input=parsePickupCollectionSave({schemaVersion:1,businessId,jobId,jobVehicleId,expectedJobVersion:jobVersion,
    operationId,recoveryEpoch:workspace.context.recoveryEpoch,pickupLegVersionId:context.arrival.versionId,policyId:context.policy.id,body});}
   catch{throw new SchedulingClientError('input');}
   if(input.body.effectiveAt<context.arrival.arrivedAt){
    setView({...view,message:'Enter a collection time after the recorded pickup arrival.'});
    return;
   }
   const original={schemaVersion:1 as const,businessId,binding:workspace.binding,reference:pickupCollectionOriginal(input).reference};
   pendingStore.write(original);retained=original;
   const result=await scheduling.savePickupCollection(input,proof,active.signal);
   active.signal.throwIfAborted();
   if('state'in result){
    if(result.reason==='operation')throw Error();
    pendingStore.clear(retained);retained=null;
    setView({...initial,message:result.reason==='photo'&&photosAvailable?'The photo does not match this handoff. Reload and verify a photo for this collection.':
     conflicts[result.reason]??'The saved job changed. Reload before recording collection.'});
    return;
   }
   confirmed=true;
   pendingStore.clear(retained);retained=null;
   const saved=await read(proof,active.signal);
   if(saved.collection?.id!==result.result.receipt.sourceRecordId)throw Error();
   setView({...initial,context:saved,message:'Vehicle collection saved.'});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* Keep the original available for review. */}
   }
   setView(retained?{...initial,pending:true,message:'The collection save could not be confirmed. Check Save review before trying again.'}:
    confirmed?{...initial,message:'Vehicle collection saved. Reload to see the retained handoff.'}:
    {...view,busy:false,message:error instanceof SchedulingClientError&&error.kind==='input'?
     'Check the required handoff details.':'Collection was not submitted. Check your sign-in and reload.'});
  }finally{finish(active);}
 }
 const context=view.context,collection=context?.collection;
 return <section ref={anchor} aria-label="Pickup vehicle collection">
  <h4>Pickup collection</h4>
  <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>{context?'Reload pickup collection':'Load pickup collection'}</button>
  <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.signedOut&&<p><a href="/sign-in">Sign in</a></p>}
  {view.pending&&<p><a href={'/save-review?kind='+pickupCollectionKind}>Open Save review</a></p>}
  {(context?.state==='ready'||context?.state==='photo_required'&&photosAvailable)&&!view.pending&&canChange&&context.policy&&context.arrival&&
   <CollectionForm policy={context.policy} arrival={context.arrival} timezone={timezone} busy={view.busy} save={save}
    businessId={businessId} jobVehicleId={jobVehicleId} jobVersion={jobVersion} photosAvailable={photosAvailable}/>}
  {collection&&<dl className="customer-values">
   <dt>Custody</dt><dd>{statusText[context.state]}</dd>
   <dt>Collected</dt><dd><time dateTime={collection.body.effectiveAt}>{formatTime(collection.body.effectiveAt,timezone)}</time></dd>
   <dt>Handed over by</dt><dd>{collection.body.person.displayName}</dd>
   <dt>Handoff location</dt><dd>{collection.body.location.locationText}</dd>
   {collection.body.missingPhotoReason&&<><dt>Missing condition photo</dt><dd>{collection.body.missingPhotoReason}</dd></>}
   {collection.body.acknowledgementConfirmed&&<><dt>Acknowledgement</dt><dd>{context.policy?.acknowledgementText}</dd></>}
   {collection.body.notes&&<><dt>Notes</dt><dd>{collection.body.notes}</dd></>}
  </dl>}
  {photosAvailable&&collection?.body.conditionPhotoId&&<DropoffPhotoViewer jobVehicleId={jobVehicleId} photoId={collection.body.conditionPhotoId}/>}
 </section>;
}
