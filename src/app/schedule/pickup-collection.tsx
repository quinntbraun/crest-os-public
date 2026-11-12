'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import type {Proof} from '../../client/authentication';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../client/pending-scheduling';
import type {PendingScheduling} from '../../client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../client/scheduling';
import {parsePickupCollectionSave,pickupCollectionKind,pickupCollectionOriginal,
 parsePickupReleaseSave,pickupReleaseKind,pickupReleaseOriginal,parsePickupReturnFailureSave,pickupReturnFailureKind,pickupReturnFailureOriginal} from '../../operations/pickup-custody-contract';
import type {PickupCollectionSave} from '../../operations/pickup-custody-contract';
import type {SchedulingOriginalKind} from '../../operations/scheduling-original-contract';
import {BookingInstantInput} from './booking-fields';
import {DropoffPhotoPicker,DropoffPhotoViewer} from './dropoff-photo-fields';

type Props=Readonly<{businessId:string;jobId:string;jobVehicleId:string;jobVersion:string;timezone:string;canChange:boolean;photosAvailable:boolean;releaseAvailable?:boolean}>;
type Collection=Exclude<Awaited<ReturnType<typeof scheduling.pickupCollection>>,{state:'absent'}>;
type Body=PickupCollectionSave['body'];
const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const store=(kind:SchedulingOriginalKind)=>createPendingSchedulingStore(storage,kind);
const initial={context:null as Collection|null,busy:false,pending:null as SchedulingOriginalKind|null,signedOut:false,message:''};
const statusText={
 awaiting_arrival:'Record arrival at this vehicle’s pickup stop first.',
 requires_policy:'This booking has no pickup handoff policy.',
 ready:'Ready to record collection.',
 vehicle_held:'This vehicle is already in Crest custody on another job.',
 photo_required:'The saved policy requires a verified condition photo. Pickup photo capture is unavailable.',
 held:'In Crest custody.',
 awaiting_return:'Work is complete. Vehicle return is still required.',
 return_required:'The job was cancelled. Vehicle return is still required.',
 return_failed:'Return could not be completed. The vehicle is still in Crest custody. Reload Pickup travel to record a new return trip.',
 ready_to_release:'Return arrival saved. The vehicle is still in Crest custody until the handoff is recorded.',
 released:'Vehicle released to the customer.',
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
function FailedReturnForm({busy,save}:{busy:boolean;save:(reason:string)=>void}){
 const id=useId(),[reason,setReason]=useState('');
 return <details>
  <summary>Unable to hand over the vehicle?</summary>
  <form className="field-work-form" onSubmit={event=>{
   event.preventDefault();
   if(!busy&&reason.trim())save(reason.trim());
  }}>
   <fieldset disabled={busy}>
    <legend>Record a failed return</legend>
    <p className="field-help">Use this after arriving at the return stop. The vehicle stays in Crest custody until a later handoff.</p>
    <label htmlFor={id}>Why could the vehicle not be handed over?</label>
    <textarea id={id} value={reason} onChange={event=>setReason(event.target.value)} required maxLength={1000} rows={3}/>
    <button type="submit" className="secondary" disabled={!reason.trim()}>Save failed return</button>
   </fieldset>
  </form>
 </details>;
}
function formatTime(value:string,timezone:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'medium'}).format(new Date(value));
}
function HandoffForm({policy,arrival,timezone,busy,save,businessId,jobVehicleId,jobVersion,photosAvailable,returnCollectionId}:{
 returnCollectionId?:string;
 policy:NonNullable<Collection['policy']>;arrival:NonNullable<Collection['arrival']>;
 timezone:string;busy:boolean;save:(body:Body,operationId:string)=>Promise<void>;
 businessId:string;jobVehicleId:string;jobVersion:string;photosAvailable:boolean;
}){
 const id=useId(),[effectiveAt,setEffectiveAt]=useState(''),[operationId]=useState(()=>crypto.randomUUID());
 const [photo,setPhoto]=useState<{selected:boolean;verifiedId:string|null}>({selected:false,verifiedId:null});
 const returning=returnCollectionId!==undefined;
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
   <legend>{returning?'Record return handoff':'Record vehicle collection'}</legend>
   <p className="field-help">{returning?'Return':'Pickup'} arrival recorded at {formatTime(arrival.arrivedAt,timezone)}.</p>
   {!returning&&<>
    <BookingInstantInput label="Actual collection time (optional)" zone={timezone} value={effectiveAt} change={setEffectiveAt} seconds required={false}/>
    <p className="field-help">Leave the time blank only when saving as the handoff happens. Times are in {timezone}.</p>
   </>}
   <label htmlFor={id+'-person'}>{returning?'Who received the vehicle?':'Who handed over the vehicle?'}</label>
   <input id={id+'-person'} name="person" autoComplete="off" maxLength={200} required/>
   <label htmlFor={id+'-location'}>Actual handoff location</label>
   <input id={id+'-location'} name="location" autoComplete="off" maxLength={2000} required/>
   {photosAvailable&&<DropoffPhotoPicker businessId={businessId} jobVehicleId={jobVehicleId} caseId={operationId} handoff={returning?2:1}
    pickup={{arrivalVersionId:arrival.versionId,jobVersion,...returning?{collectionId:returnCollectionId}:{policyId:policy.id}}} required={policy.conditionPhotoRequired}
    change={(selected,verifiedId)=>setPhoto({selected,verifiedId})}/>}
   {!photo.selected&&!policy.conditionPhotoRequired&&<>
    <label htmlFor={id+'-reason'}>Why is a condition photo missing?</label>
    <textarea id={id+'-reason'} name="missingPhotoReason" autoComplete="off" rows={2} maxLength={1000} required/>
   </>}
   <details><summary>{returning?'Set an earlier handoff time or add notes':'Add collection notes'}</summary>
    {returning&&<>
     <BookingInstantInput label="Actual return time (optional)" zone={timezone} value={effectiveAt} change={setEffectiveAt} seconds required={false}/>
     <p className="field-help">Leave blank to record the current time. Times are in {timezone}.</p>
    </>}
    <label htmlFor={id+'-notes'}>{returning?'Return notes (optional)':'Collection notes (optional)'}</label>
    <textarea id={id+'-notes'} name="notes" autoComplete="off" rows={2} maxLength={1000}/>
   </details>
   {policy.acknowledgementText!==null&&<>
    <p id={id+'-acknowledgement'}>{policy.acknowledgementText}</p>
    <label className="checkbox"><input type="checkbox" name="acknowledged" aria-describedby={id+'-acknowledgement'} required/> Record the required acknowledgement</label>
   </>}
   <button type="submit" disabled={waitingForPhoto}>{returning?'Save return handoff':'Save vehicle collection'}</button>
  </fieldset>
 </form>;
}
export function PickupCollection({businessId,jobId,jobVehicleId,jobVersion,timezone,canChange,photosAvailable,releaseAvailable}:Props){
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
   const pending=[pickupCollectionKind,pickupReleaseKind,pickupReturnFailureKind].find(kind=>store(kind).read()!==null)??null;
   setView({...initial,context,pending,message:pending?'Review the interrupted '+(pending===pickupCollectionKind?'collection':'return')+' save before making changes.':
    context.state==='photo_required'&&photosAvailable?'Upload a verified condition photo to record collection.':statusText[context.state]});
  }catch(error){
   if(active.signal.aborted)return;
   const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
   setView({...initial,signedOut,message:signedOut?'Sign in again to review collection.':'Collection could not be loaded. Reload the saved job and try again.'});
  }finally{finish(active);}
 }

 async function save(body:Body|{reason:string},operationId:string){
  const context=view.context;
  if(request.current||!canChange||view.pending||!context?.policy)return;
  const failed='reason'in body,returning=context.state==='ready_to_release';
  const arrival=returning?context.returnArrival:context.arrival;
  const photoId=failed?undefined:body.conditionPhotoId;
  if(!arrival||failed&&(!returning||!context.pickupReturnFailureAvailable)||
   returning&&(!releaseAvailable||!context.collection||!failed&&context.policy.conditionPhotoRequired&&!photoId)||
   !returning&&!(context.state==='ready'||context.state==='photo_required'&&photosAvailable&&photoId))return;
  const kind=failed?pickupReturnFailureKind:returning?pickupReleaseKind:pickupCollectionKind;
  const label=failed?'failed return':returning?'return handoff':'collection';
  const savedMessage=failed?'Failed return saved. The vehicle is still in Crest custody. Reload Pickup travel to record a new return trip.':
   returning?'Return handoff saved.':'Vehicle collection saved.';
  const active=new AbortController();request.current=active;
  let retained:PendingScheduling|null=null,confirmed=false;
  const pendingStore=store(kind);
  setView({...view,busy:true,message:failed?'Saving failed return…':returning?'Saving return handoff…':'Saving vehicle collection…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   if(workspace.context.businessId!==businessId||workspace.pickupCollectionAvailable!==true||workspace.context.writeState!=='ready'||
    returning&&workspace.pickupReleaseAvailable!==true||photoId&&workspace.pickupPhotosAvailable!==true)
    throw new SchedulingClientError('recovery');
   const pending=(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).find(kind=>store(kind).read()!==null);
   if(pending){
    setView({...initial,pending,message:'Review the interrupted scheduling save before recording the '+label+'.'});
    return;
   }

   if(!failed&&body.effectiveAt<arrival.arrivedAt){
    setView({...view,message:returning?'Enter a handoff time after the recorded return arrival.':'Enter a collection time after the recorded pickup arrival.'});
    return;
   }
   const common={schemaVersion:1,businessId,jobId,expectedJobVersion:jobVersion,operationId,recoveryEpoch:workspace.context.recoveryEpoch,body};
   const returnInput={...common,collectionId:context.collection?.id,returnLegVersionId:arrival.versionId};
   const prepared=(()=>{
    try{
     if(failed){
      const input=parsePickupReturnFailureSave(returnInput);
      return {reference:pickupReturnFailureOriginal(input).reference,submit:()=>scheduling.savePickupReturnFailure(input,proof,active.signal)};
     }
     if(returning){
      const input=parsePickupReleaseSave(returnInput);
      return {reference:pickupReleaseOriginal(input).reference,submit:()=>scheduling.savePickupRelease(input,proof,active.signal)};
     }
     const input=parsePickupCollectionSave({...common,jobVehicleId,pickupLegVersionId:arrival.versionId,policyId:context.policy!.id});
     return {reference:pickupCollectionOriginal(input).reference,submit:()=>scheduling.savePickupCollection(input,proof,active.signal)};
    }catch{throw new SchedulingClientError('input');}
   })();
   const original={schemaVersion:1 as const,businessId,binding:workspace.binding,reference:prepared.reference};
   pendingStore.write(original);retained=original;
   const result=await prepared.submit();
   active.signal.throwIfAborted();
   if('state'in result){
    if(result.reason==='operation')throw Error();
    pendingStore.clear(retained);retained=null;
    const message=result.reason==='photo'&&photosAvailable?'The photo does not match this handoff. Reload and verify a photo for the '+label+'.':
     returning&&result.reason==='arrival'?'Return arrival could not be verified. Reload the saved job.':
     returning&&result.reason==='released'?'This vehicle already has a saved return handoff. Reload to see it.':
     result.reason==='failed'?'A failed handoff is already saved for this arrival. Reload to see it.':
     conflicts[result.reason]??'The saved job changed. Reload before recording the '+label+'.';
    setView({...initial,message});
    return;
   }
   confirmed=true;
   pendingStore.clear(retained);retained=null;
   const saved=await read(proof,active.signal);
   if((failed?saved.returnFailure?.id:returning?saved.release?.id:saved.collection?.id)!==result.result.receipt.sourceRecordId)throw Error();
   setView({...initial,context:saved,message:savedMessage});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* Keep the original available for review. */}
   }
   setView(retained?{...initial,pending:kind,message:'The '+label+' save could not be confirmed. Check Save review before trying again.'}:
    confirmed?{...initial,message:savedMessage+' Reload collection to see the saved record.'}:
    {...view,busy:false,message:error instanceof SchedulingClientError&&error.kind==='input'?
     'Check the required handoff details.':(failed?'Failed return':returning?'Return handoff':'Collection')+' was not submitted. Check your sign-in and reload.'});
  }finally{finish(active);}
 }
 const context=view.context,collection=context?.collection,release=context?.release;
 return <section ref={anchor} aria-label="Pickup vehicle collection">
  <h4>Pickup collection</h4>
  <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>{context?'Reload pickup collection':'Load pickup collection'}</button>
  <p ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.signedOut&&<p><a href="/sign-in">Sign in</a></p>}
  {view.pending&&<p><a href={'/save-review?kind='+view.pending}>Open Save review</a></p>}
  {(context?.state==='ready'||context?.state==='photo_required'&&photosAvailable)&&!view.pending&&canChange&&context.policy&&context.arrival&&
   <HandoffForm policy={context.policy} arrival={context.arrival} timezone={timezone} busy={view.busy} save={save}
    businessId={businessId} jobVehicleId={jobVehicleId} jobVersion={jobVersion} photosAvailable={photosAvailable}/>}
  {context?.state==='ready_to_release'&&releaseAvailable&&context.pickupReturnFailureAvailable&&!view.pending&&canChange&&
   <FailedReturnForm key={context.returnArrival?.versionId} busy={view.busy} save={reason=>void save({reason},crypto.randomUUID())}/>}
  {context?.state==='ready_to_release'&&releaseAvailable&&!view.pending&&canChange&&context.policy&&context.returnArrival&&collection&&
   <HandoffForm policy={context.policy} arrival={context.returnArrival} timezone={timezone} busy={view.busy} save={save}
    businessId={businessId} jobVehicleId={jobVehicleId} jobVersion={jobVersion} photosAvailable={photosAvailable} returnCollectionId={collection.id}/>}
  {collection&&<dl className="customer-values">
   <dt>Custody</dt><dd>{statusText[context.state]}</dd>
   <dt>Collected</dt><dd><time dateTime={collection.body.effectiveAt}>{formatTime(collection.body.effectiveAt,timezone)}</time></dd>
   <dt>Handed over by</dt><dd>{collection.body.person.displayName}</dd>
   <dt>Handoff location</dt><dd>{collection.body.location.locationText}</dd>
   {collection.body.missingPhotoReason&&<><dt>Missing condition photo</dt><dd>{collection.body.missingPhotoReason}</dd></>}
   {collection.body.acknowledgementConfirmed&&<><dt>Acknowledgement</dt><dd>{context.policy?.acknowledgementText}</dd></>}
   {collection.body.notes&&<><dt>Notes</dt><dd>{collection.body.notes}</dd></>}
  </dl>}
  {context?.returnFailure&&<dl className="customer-values">
   <dt>Last failed return</dt><dd><time dateTime={context.returnFailure.recordedAt}>{formatTime(context.returnFailure.recordedAt,timezone)}</time></dd>
   <dt>Reason</dt><dd>{context.returnFailure.reason}</dd>
  </dl>}
  {release&&<dl className="customer-values">
   <dt>Released</dt><dd><time dateTime={release.body.effectiveAt}>{formatTime(release.body.effectiveAt,timezone)}</time></dd>
   <dt>Received by</dt><dd>{release.body.person.displayName}</dd>
   <dt>Return handoff location</dt><dd>{release.body.location.locationText}</dd>
   {release.body.missingPhotoReason&&<><dt>Missing return condition photo</dt><dd>{release.body.missingPhotoReason}</dd></>}
   {release.body.notes&&<><dt>Return notes</dt><dd>{release.body.notes}</dd></>}
  </dl>}
  {photosAvailable&&collection?.body.conditionPhotoId&&<DropoffPhotoViewer jobVehicleId={jobVehicleId} photoId={collection.body.conditionPhotoId}/>}
  {photosAvailable&&release?.body.conditionPhotoId&&<section aria-label="Return condition evidence">
   <DropoffPhotoViewer jobVehicleId={jobVehicleId} photoId={release.body.conditionPhotoId}/>
  </section>}
 </section>;
}
