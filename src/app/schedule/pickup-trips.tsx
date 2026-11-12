'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../client/pending-scheduling';
import type {PendingScheduling} from '../../client/pending-scheduling';
import {scheduling,SchedulingClientError} from '../../client/scheduling';
import {vehicles} from '../../client/vehicles';
import {parseVehicle} from '../../customer/vehicle-contract';
import type {SchedulingOriginalKind} from '../../operations/scheduling-original-contract';
import {parsePickupTripSave,pickupTripKind,pickupTripOriginal} from '../../operations/pickup-trip-contract';
import type {PickupTrip,PickupTripBody,PickupTripPage} from '../../operations/pickup-trip-contract';
import {parseBookingLocation} from '../../operations/confirmed-booking-contract';
import type {BookingLocation} from '../../operations/confirmed-booking-contract';
import {BookingInstantInput} from './booking-fields';
import type {SavedJobResources} from './job-details';

const initialCursor={beforeDepartedAt:null,beforeLegId:null};
const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),
 removeItem:(key:string)=>sessionStorage.removeItem(key)};
const store=()=>createPendingSchedulingStore(storage,pickupTripKind);
const initial={busy:false,message:'',page:null as PickupTripPage|null,pending:false,signedOut:false};
const outcomes={
 pickup:{open:'Traveling to pickup',closed:'Arrived at pickup',cancelled:'Pickup trip stopped'},
 to_work_site:{open:'Transporting to work site',closed:'Arrived at work site',cancelled:'Work-site transport stopped'},
 return_to_customer:{open:'Returning to customer',closed:'Arrived at return stop',cancelled:'Return trip stopped'}
};
const conflicts:Readonly<Record<string,string>>={
 occupancy:'Another trip or work session is open. Finish it and reload pickup travel.',
 pickup_location:'The selected vehicles no longer share a saved pickup stop. Reload the job.',
 return_location:'The selected vehicles no longer share a saved return stop. Reload the job.',
 already_at_return:'A selected vehicle already arrived at its return stop. Reload the trip history.',
 custody:'Record collection before transporting these vehicles. Reload the saved job.',
 already_at_work_site:'A selected vehicle already arrived at the work site. Reload the trip history.',
 vehicle:'The driving vehicle is unavailable. Reload and choose an active vehicle.',
 job_version:'The saved job changed. Reload before recording travel.',
 leg_version:'This pickup trip changed. Reload its saved history.'
};
type Choices=Awaited<ReturnType<typeof vehicles.list>>;
const noChoices:Choices={vehicles:[],hasMore:false};
const site=(locationText:string)=>({schemaVersion:1 as const,kind:'manual' as const,locationText:locationText.trim(),instructions:null});
function locationLabel(value:BookingLocation){
 if(value.kind==='manual')return value.locationText;
 const address=value.snapshot;
 return address.exact_location_text||[address.line1,address.line2,address.city,address.region,address.postal_code].filter(Boolean).join(', ');
}
function time(value:string,timezone:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
}
function stopOptions(resources:SavedJobResources,returnVehicleIds?:readonly string[]){
 const groups=new Map<string,{location:string;vehicles:{id:string;label:string}[]}>();
 for(const row of resources.vehicles){
  if(returnVehicleIds&&!returnVehicleIds.includes(row.id))continue;
  const saved=returnVehicleIds?row.return_location_snapshot:row.pickup_location_snapshot;
  if(saved===null)continue;
  const snapshot=parseBookingLocation(saved,resources.businessId,resources.head.job.customer_id),key=JSON.stringify(snapshot);
  const group=groups.get(key)??{location:locationLabel(snapshot),vehicles:[]};
  group.vehicles.push({id:row.id,label:parseVehicle(row.vehicle_snapshot,resources.businessId).label});
  groups.set(key,group);
 }
 return Array.from(groups.values()).flatMap(group=>[
  ...group.vehicles.length>1?[{ids:group.vehicles.map(row=>row.id),location:group.location,label:'All at '+group.location+' ('+group.vehicles.length+' vehicles)'}]:[],
  ...group.vehicles.map(row=>({ids:[row.id],location:group.location,label:row.label+' · '+group.location}))
 ]);
}
function DepartureForm({resources,choices,busy,timezone,more,save,worksiteVehicleIds,returnVehicleIds}:{
 resources:SavedJobResources;choices:Choices;busy:boolean;timezone:string;more:()=>void;save:(body:PickupTripBody)=>void;
 worksiteVehicleIds?:readonly string[];returnVehicleIds?:readonly string[];
}){
 const id=useId(),[chooseWorksite,setWorksite]=useState(false);
 const eligible=resources.vehicles.filter(vehicle=>worksiteVehicleIds?.includes(vehicle.id));
 const returning=returnVehicleIds!==undefined;
 const worksite=chooseWorksite&&eligible.length>0;
 const tripLabel=returning?'return':worksite?'work-site':'pickup';
 const destination=worksite?locationLabel(parseBookingLocation(resources.head.job.work_location_snapshot,
  resources.businessId,resources.head.job.customer_id)):'';
 const options=worksite?[
  ...eligible.length>1?[{ids:eligible.map(row=>row.id),location:destination,label:'All collected vehicles ('+eligible.length+')'}]:[],
  ...eligible.map(row=>({ids:[row.id],location:destination,label:parseVehicle(row.vehicle_snapshot,resources.businessId).label}))
 ]:stopOptions(resources,returnVehicleIds);
 const [stop,setStop]=useState(''),[driven,setDriven]=useState(''),
  [origin,setOrigin]=useState(''),[eta,setEta]=useState(''),[notes,setNotes]=useState('');
 const selection=options.length===1?options[0]:stop===''?undefined:options[Number(stop)];
 return <form className="field-work-form" onSubmit={event=>{
  event.preventDefault();
  if(!busy&&selection&&driven&&origin.trim())save({action:'depart',reason:null,trip:{
   jobVehicleIds:selection.ids,drivenVehicleId:driven,origin:site(origin),etaAt:eta||null,notes:notes.trim()||null,
   ...returning?{purpose:'return_to_customer'}:worksite?{purpose:'to_work_site'}:{}
  }});
 }}>
  <fieldset disabled={busy}>
   <legend>{returning?'Return vehicles to customer':worksite?'Transport collected vehicles':'Leave for pickup'}</legend>
   {eligible.length>0&&<>
    <label htmlFor={id+'-task'}>Travel task</label>
    <select id={id+'-task'} value={worksite?'worksite':'pickup'} onChange={event=>{
     setWorksite(event.target.value==='worksite');setStop('');
    }}>
     <option value="pickup">Leave for pickup</option>
     <option value="worksite">Transport to the work site</option>
    </select>
   </>}
   {options.length>1&&<><label htmlFor={id+'-stop'}>{returning?'Return stop and vehicles':worksite?'Vehicles on this trip':'Pickup stop and vehicles'}</label>
   <select id={id+'-stop'} aria-describedby={selection?id+'-location':undefined} required value={stop} onChange={event=>setStop(event.target.value)}>
    <option value="">{worksite?'Choose collected vehicles':'Choose a saved '+tripLabel+' stop'}</option>
    {options.map((row,index)=><option key={row.ids.join(',')} value={index}>{row.label}</option>)}
   </select></>}
   {selection&&<p id={id+'-location'} className="field-help"><strong>{returning?'Return stop':worksite?'Work site':'Pickup stop'}</strong> {selection.location}</p>}
   <label htmlFor={id+'-driven'}>Vehicle you are driving</label>
   <select id={id+'-driven'} required value={driven} onChange={event=>setDriven(event.target.value)}>
    <option value="">Choose the actual vehicle</option>
    {choices.vehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}
   </select>
   {choices.hasMore&&<button type="button" className="secondary" onClick={more}>Load more driving vehicles</button>}
   {!choices.vehicles.length&&<p><a href="/vehicles">Save an active driving vehicle</a>, then reload pickup travel.</p>}
   <label htmlFor={id+'-origin'}>Where are you leaving from?</label>
   <input id={id+'-origin'} required maxLength={2000} autoComplete="off" value={origin} onChange={event=>setOrigin(event.target.value)}/>
   <details><summary>Arrival estimate and notes</summary>
    <BookingInstantInput label="Estimated arrival (optional)" value={eta} zone={timezone} change={setEta} required={false}/>
    <label htmlFor={id+'-notes'}>Trip notes (optional)</label>
    <textarea id={id+'-notes'} rows={2} maxLength={2000} value={notes} onChange={event=>setNotes(event.target.value)}/>
   </details>
   <button type="submit">Record {tripLabel} departure</button>
  </fieldset>
 </form>;
}
function ArrivalForm({busy,canArrive,purpose,save}:{busy:boolean;canArrive:boolean;purpose:PickupTrip['purpose'];save:(body:PickupTripBody)=>void}){
 const worksite=purpose==='to_work_site',returning=purpose==='return_to_customer';
 const id=useId(),[stop,setStop]=useState(''),[reason,setReason]=useState('');
 return <>
  {canArrive&&<form onSubmit={event=>{event.preventDefault();if(!busy)save({action:'arrive',reason:null,trip:null});}}>
   <p className="field-help">{returning?'Record arrival at the return stop. Vehicle handoff is recorded separately.':worksite?'Record the arrival of these vehicles. Work time is recorded separately.':'Record arrival at the pickup stop. Vehicle handoff and work time are separate.'}</p>
   <button type="submit" disabled={busy}>{returning?'Record return arrival':worksite?'Record work-site arrival':'Record pickup arrival'}</button>
  </form>}
  <details><summary>{returning?'Stop this return trip':worksite?'Stop work-site transport':'Stop this pickup trip'}</summary>
   <form className="field-work-form" onSubmit={event=>{
    event.preventDefault();
    if(!busy&&stop.trim()&&reason.trim())save({action:'cancel',reason:reason.trim(),trip:{actualStop:site(stop)}});
   }}>
    <fieldset disabled={busy}>
     <legend>Record where the trip ended</legend>
     <label htmlFor={id+'-stop'}>Actual stop</label>
     <input id={id+'-stop'} required maxLength={2000} autoComplete="off" value={stop} onChange={event=>setStop(event.target.value)}/>
     <label htmlFor={id+'-reason'}>Why did the trip stop?</label>
     <textarea id={id+'-reason'} required rows={2} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
     <button type="submit" className="secondary">Record stopped trip</button>
    </fieldset>
   </form>
  </details>
 </>;
}
function TripHistory({trips,resources,timezone}:{trips:readonly PickupTrip[];resources:SavedJobResources;timezone:string}){
 const labels=new Map(resources.vehicles.map(row=>[row.id,parseVehicle(row.vehicle_snapshot,resources.businessId).label]));
 return <ol>{trips.map(trip=><li key={trip.legId}>
  <p><strong>{outcomes[trip.purpose][trip.state]}</strong> · {trip.drivenVehicleLabel}</p>
  <p>{trip.jobVehicleIds.map(id=>labels.get(id)).join(', ')}</p>
  <p>Left {locationLabel(trip.origin)} at <time dateTime={trip.departedAt}>{time(trip.departedAt,timezone)}</time></p>
  <p>{trip.state==='cancelled'?'Stopped at':trip.state==='closed'?'Arrived at':'Heading to'} {locationLabel(trip.destination)}
   {trip.arrivedAt&&<> at <time dateTime={trip.arrivedAt}>{time(trip.arrivedAt,timezone)}</time></>}</p>
  {trip.etaAt&&<p className="field-help">Recorded estimate {time(trip.etaAt,timezone)}</p>}
  {trip.reason&&<p>{trip.reason}</p>}
  {trip.notes&&<p>{trip.notes}</p>}
  {trip.state==='cancelled'&&<p className="field-help">{trip.purpose!=='pickup'?'Custody stays open after a stopped trip. Review the stop before continuing.':'Pickup still needs attention. Review the visit before arranging another trip.'}</p>}
 </li>)}</ol>;
}

export function PickupTrips({resources,canChange,workAvailable}:{resources:SavedJobResources;canChange:boolean;workAvailable:boolean}){
 const {businessId,jobId}=resources,jobVersion=resources.head.job.version,timezone=resources.head.appointment.timezone;
 const [view,setView]=useState(initial),[choices,setChoices]=useState(noChoices);
 const panel=useRef<HTMLDetailsElement>(null),status=useRef<HTMLParagraphElement>(null),running=useRef<AbortController|null>(null);
 function clear(){
  running.current?.abort();running.current=null;setChoices(noChoices);setView(initial);
 }
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   running.current?.abort();running.current=null;
   document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);
 const activeLeg=view.page?.trips.find(trip=>trip.legId===view.page?.activeLegId);
 const worksiteVehicleIds=view.page?.worksiteVehicleIds??[];
 const returnVehicleIds=view.page?.returnVehicleIds??[];
 const blocked=()=> (Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[])
  .some(kind=>createPendingSchedulingStore(storage,kind).read()!==null);
 async function load(more=false){
  if(running.current||!panel.current?.open)return;
  const active=new AbortController();running.current=active;
  const prior=more?view.page:null,oldest=prior?.trips.at(-1);
  setView({...view,busy:true,message:'Loading saved pickup travel…'});
  try{
   const proof=await authentication.session(active.signal),pending=store().read()!==null;
   const cursor=oldest?{beforeDepartedAt:oldest.departedAt,beforeLegId:oldest.legId}:initialCursor;
   const page=await scheduling.pickupTrips(businessId,jobId,cursor,proof,active.signal);
   if(page.state==='absent'||page.jobVersion!==jobVersion||prior&&page.activeLegId!==prior.activeLegId)throw Error();
   const readyChoices=!prior&&canChange&&!page.activeLegId&&(page.jobState==='scheduled'||Boolean(page.returnVehicleIds?.length))&&!pending?
    await vehicles.list(businessId,{search:'',afterId:null,includeArchived:false,pageSize:25},proof,active.signal):choices;
   active.signal.throwIfAborted();
   setChoices(readyChoices);
   setView({...initial,pending,page:prior?{...page,trips:[...prior.trips,...page.trips]}:page,
    message:pending?'Review the interrupted pickup save before making changes.':'Saved pickup travel loaded.'});
  }catch(error){
   if(!active.signal.aborted){
    const signedOut=error instanceof AuthenticationError&&error.kind==='denied';
    const limited=error instanceof SchedulingClientError&&error.kind==='limited';
    setChoices(noChoices);
    setView({...initial,signedOut,message:signedOut?'Sign in again to review pickup travel.':
     limited?'History requests are temporarily limited. Wait a minute before reloading pickup travel.':
     'Pickup travel could not be loaded. Reload the saved job and try again.'});
   }
  }finally{if(running.current===active){running.current=null;status.current?.focus();}}
 }
 async function loadDrivingVehicles(){
  if(running.current||!choices.hasMore)return;
  const active=new AbortController();running.current=active;
  setView({...view,busy:true,message:'Loading driving vehicles…'});
  try{
   const proof=await authentication.session(active.signal);
   const next=await vehicles.list(businessId,{search:'',afterId:choices.vehicles.at(-1)!.id,includeArchived:false,pageSize:25},proof,active.signal);
   active.signal.throwIfAborted();
   setChoices({...next,vehicles:[...choices.vehicles,...next.vehicles]});
   setView({...view,busy:false,message:'More driving vehicles loaded.'});
  }catch{if(!active.signal.aborted)setView({...view,busy:false,message:'Additional vehicles could not be loaded. Try again.'});}
  finally{if(running.current===active){running.current=null;status.current?.focus();}}
 }
 async function save(body:PickupTripBody){
  if(running.current||!canChange||!view.page||view.pending||(body.action==='depart')===Boolean(activeLeg))return;
  const active=new AbortController();running.current=active;
  const pendingStore=store();
  let retained:PendingScheduling|null=null,confirmed=false;
  const purpose=body.action==='depart'?body.trip.purpose:activeLeg?.purpose;
  const tripLabel=purpose==='return_to_customer'?'Return':purpose==='to_work_site'?'Work-site':'Pickup';
  const savedMessage=body.action==='depart'?tripLabel+' departure saved.':body.action==='arrive'?tripLabel+' arrival saved.':tripLabel+' trip stopped.';
  setView({...view,busy:true,message:'Saving pickup travel…'});
  try{
   const proof=await authentication.session(active.signal),workspace=await scheduling.workspace(proof,active.signal);
   active.signal.throwIfAborted();
   if(workspace.context.businessId!==businessId||workspace.pickupTripsAvailable!==true||workspace.context.writeState!=='ready')
    throw new SchedulingClientError('recovery');
   if(blocked()){
    setView({...initial,pending:true,message:'Review the interrupted scheduling save before recording pickup travel.'});
    return;
   }
   let input;
   try{input=parsePickupTripSave({schemaVersion:1,businessId,jobId,expectedJobVersion:jobVersion,
    recoveryEpoch:workspace.context.recoveryEpoch,operationId:crypto.randomUUID(),legId:activeLeg?.legId??crypto.randomUUID(),
    expectedLegVersionId:activeLeg?.legVersionId??null,body});}
   catch{throw new SchedulingClientError('input');}
   const pending:PendingScheduling={schemaVersion:1,businessId,binding:workspace.binding,reference:pickupTripOriginal(input).reference};
   pendingStore.write(pending);
   retained=pending;
   const result=await scheduling.savePickupTrip(input,proof,active.signal);
   active.signal.throwIfAborted();
   if('state'in result){
    if(result.reason==='operation')throw Error();
    pendingStore.clear(retained);retained=null;
    setView({...initial,message:conflicts[result.reason]??'Pickup travel changed. Reload to see the saved trip.'});
    return;
   }
   confirmed=true;
   pendingStore.clear(retained);retained=null;
   const page=await scheduling.pickupTrips(businessId,jobId,initialCursor,proof,active.signal);
   active.signal.throwIfAborted();
   if(page.state==='absent'||page.jobVersion!==jobVersion||!page.trips.some(trip=>trip.legVersionId===result.result.receipt.sourceRecordId))throw Error();
   if(!page.activeLegId&&page.jobState==='scheduled'&&!choices.vehicles.length){
    const available=await vehicles.list(businessId,{search:'',afterId:null,includeArchived:false,pageSize:25},proof,active.signal);
    active.signal.throwIfAborted();
    setChoices(available);
   }
   setView({...initial,page,message:savedMessage});
  }catch(error){
   if(active.signal.aborted)return;
   if(retained&&error instanceof SchedulingClientError&&['input','not_submitted','recovery','limited'].includes(error.kind)){
    try{pendingStore.clear(retained);retained=null;}catch{/* The stored reference remains available for review. */}
   }
   const limited=error instanceof SchedulingClientError&&error.kind==='limited';
   setView(retained?{...initial,pending:true,message:'The pickup save could not be confirmed. Check Save review before trying again.'}:
    confirmed?{...initial,message:savedMessage+(limited?' History requests are temporarily limited. Wait a minute before reloading.':
     ' Reload to see the latest history.')}:
    {...view,busy:false,message:error instanceof SchedulingClientError&&error.kind==='input'?'Check the required trip details and try again.':'Pickup travel was not submitted. Check your sign-in and try again.'});
  }finally{if(running.current===active){running.current=null;status.current?.focus();}}
 }
 return <details ref={panel} onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Pickup travel</summary>
  <p role="status" ref={status} tabIndex={-1}>{view.message}</p>
  {view.signedOut&&<p><a href="/sign-in">Sign in</a></p>}
  <button type="button" className="secondary" disabled={view.busy} onClick={()=>void load()}>{view.page?'Reload pickup travel':'Load pickup travel'}</button>
  {view.pending&&<p><a href={'/save-review?kind='+pickupTripKind}>Open Save review</a></p>}
  {view.page&&!view.pending&&canChange&&activeLeg&&<ArrivalForm key={activeLeg.legId} busy={view.busy}
   canArrive={view.page.jobState==='scheduled'||activeLeg.purpose==='return_to_customer'} purpose={activeLeg.purpose} save={body=>void save(body)}/>}
  {view.page?.worksiteReady===true&&workAvailable&&canChange&&!view.pending&&!activeLeg&&
   <p><a className="primary-action" href={'/schedule/work?job='+encodeURIComponent(jobId)}>Start Work</a></p>}
  {view.page&&!view.pending&&canChange&&!activeLeg&&view.page.jobState==='scheduled'&&view.page.worksiteReady!==true&&
   <DepartureForm key={view.page.trips[0]?.legVersionId??'planned'} resources={resources} choices={choices}
    worksiteVehicleIds={worksiteVehicleIds} busy={view.busy} timezone={timezone}
    more={()=>void loadDrivingVehicles()} save={body=>void save(body)}/>}
  {view.page&&!view.pending&&canChange&&!activeLeg&&returnVehicleIds.length>0&&
   <DepartureForm key={view.page.trips[0]?.legVersionId??'awaiting-return'} resources={resources} choices={choices}
    returnVehicleIds={returnVehicleIds} busy={view.busy} timezone={timezone}
    more={()=>void loadDrivingVehicles()} save={body=>void save(body)}/>}
  {view.page&&<section aria-label="Saved pickup trips">
   {view.page.trips.length?<TripHistory trips={view.page.trips} resources={resources} timezone={timezone}/>:<p>No pickup trip has been recorded.</p>}
   {view.page.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void load(true)}>Load earlier trips</button>}
  </section>}
 </details>;
}
