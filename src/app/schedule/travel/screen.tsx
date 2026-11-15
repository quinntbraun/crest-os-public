'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createSupportTripController,initialSupportTripView} from '../../../client/support-trip-controller';
import type {SupportTripView} from '../../../client/support-trip-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import type {SupportTrip,SupportTripBody} from '../../../operations/support-trip';
import {followUpCandidates,followUpWall} from '../../leads/follow-up-time';

const kinds=['operations.support_trip.record','operations.support_trip.correct'] as const;
const purpose={supply:'Supply run',between_jobs:'Between jobs',return_to_base:'Return to base',other:'Other trip'};
const states={open:'In progress',closed:'Arrived',cancelled:'Cancelled'};
const place=(text:string)=>({schemaVersion:1 as const,kind:'manual' as const,locationText:text,instructions:null});
const value=(form:FormData,name:string)=>String(form.get(name)??'').trim();
function tripText(form:FormData,name:string,original?:string|null){
 const entered=String(form.get(name)??'');
 // Browsers normalize textarea line endings even when the operator leaves a field alone.
 if(original!=null&&entered.replace(/\r\n?/g,'\n')===original.replace(/\r\n?/g,'\n'))return original;
 return entered.trim()?entered:null;
}
function when(instant:string,timezone:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(instant));
}
function effectiveTime(value:string,timezone:string,original?:string|null){
 if(original&&value===followUpWall(original,timezone))return original;
 const candidates=followUpCandidates(value,timezone);
 if(candidates.length!==1)throw Error();
 return candidates[0]!;
}
function TripForm({mode,trip,view,save,moreVehicles}:{
 mode:'depart'|'record'|'correct';trip?:SupportTrip;view:SupportTripView;
 save:(body:SupportTripBody,legId?:string)=>void;moreVehicles:()=>void;
}){
 const id=useId(),[error,setError]=useState('');
 const [state,setState]=useState<SupportTrip['state']>(trip?.state??'closed');
 const title=mode==='depart'?'Start a trip':mode==='correct'?'Correct saved trip':'Record an earlier trip';
 const retired=trip&&!view.vehicles.some(row=>row.id===trip.drivenVehicleId);
 return <form className="field-work-form" aria-label={title} onSubmit={event=>{
  event.preventDefault();
  const form=new FormData(event.currentTarget),selectedPurpose=value(form,'purpose') as keyof typeof purpose;
  const origin=tripText(form,'origin',trip?.origin.locationText)??'';
  const destination=tripText(form,'destination',trip?.destination.locationText)??'';
  const reason=value(form,'reason')||null;
  const route={drivenVehicleId:value(form,'vehicle'),jobId:trip?.jobId??null,purpose:selectedPurpose,
   origin:trip?{...trip.origin,locationText:origin}:place(origin),
   destination:trip?{...trip.destination,locationText:destination}:place(destination),
   notes:tripText(form,'notes',trip?.notes)};
  setError('');
  if(!origin||!destination){setError('Enter a departure and destination.');return;}
  if(mode==='depart'){save({action:'depart',reason:null,trip:route});return;}
  try{
   const departedAt=effectiveTime(value(form,'departed'),view.timezone,trip?.departedAt);
   const arrivedAt=state==='open'?null:effectiveTime(value(form,'arrived'),view.timezone,trip?.arrivedAt);
   if(!reason||arrivedAt&&arrivedAt<departedAt)throw Error();
   save({action:mode,reason,trip:{...route,state,departedAt,arrivedAt}},trip?.legId);
  }catch{setError('Enter a reason and a valid departure and stop time. Times must be ordered and unambiguous in the business time zone.');}
 }}>
  <fieldset disabled={view.busy||!view.canSave}>
   <legend>{title}</legend>
   <label htmlFor={id+'-purpose'}>Purpose</label>
   <select id={id+'-purpose'} name="purpose" defaultValue={trip?.purpose??''} required>
    <option value="">Choose a purpose</option>
    {Object.entries(purpose).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select>
   <label htmlFor={id+'-vehicle'}>Vehicle you are driving</label>
   <select id={id+'-vehicle'} name="vehicle" defaultValue={trip?.drivenVehicleId??''} required>
    <option value="">Choose the actual vehicle</option>
    {retired&&<option value={trip.drivenVehicleId}>Keep previously recorded vehicle</option>}
    {view.vehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}
   </select>
   {view.moreVehicles&&<button type="button" className="secondary" onClick={moreVehicles}>Load more vehicles</button>}
   {view.vehicles.length===0&&!retired&&<p><a href="/vehicles">Save a vehicle</a> before recording a trip.</p>}
   <label htmlFor={id+'-origin'}>Leaving from</label>
   <textarea id={id+'-origin'} name="origin" rows={2} maxLength={2000} defaultValue={trip?.origin.locationText} required/>
   <label htmlFor={id+'-destination'}>Going to</label>
   <textarea id={id+'-destination'} name="destination" rows={2} maxLength={2000} defaultValue={trip?.destination.locationText} required/>
   <label htmlFor={id+'-notes'}>Notes (optional)</label>
   <textarea id={id+'-notes'} name="notes" rows={2} maxLength={2000} defaultValue={trip?.notes??''}/>
   {mode!=='depart'&&<>
    <p>Enter the actual times in {view.timezone}.</p>
    <label htmlFor={id+'-state'}>Trip outcome</label>
    <select id={id+'-state'} value={state} onChange={event=>setState(event.target.value as SupportTrip['state'])}>
     {(mode==='record'||trip?.state==='open')&&<option value="open">Still in progress</option>}
     <option value="closed">Arrived</option><option value="cancelled">Cancelled</option>
    </select>
    <label htmlFor={id+'-departed'}>Actual departure</label>
    <input id={id+'-departed'} name="departed" type="datetime-local" required defaultValue={trip?followUpWall(trip.departedAt,view.timezone):''}/>
    {state!=='open'&&<>
     <label htmlFor={id+'-arrived'}>Actual stop time</label>
     <input id={id+'-arrived'} name="arrived" type="datetime-local" required defaultValue={trip?.arrivedAt?followUpWall(trip.arrivedAt,view.timezone):''}/>
    </>}
    <label htmlFor={id+'-reason'}>{mode==='correct'?'Reason for correction':'Reason for recording now'}</label>
    <textarea id={id+'-reason'} name="reason" rows={2} maxLength={1000} required/>
   </>}
   {error&&<p role="alert">{error}</p>}
   <button type="submit" disabled={view.vehicles.length===0&&!retired}>{title}</button>
  </fieldset>
 </form>;
}
function CancelTrip({trip,disabled,save}:{trip:SupportTrip;disabled:boolean;save:(body:SupportTripBody,legId:string)=>void}){
 const id=useId();
 return <details><summary>Cancel this trip</summary>
  <form className="field-work-form" onSubmit={event=>{
   event.preventDefault();const form=new FormData(event.currentTarget);
   save({action:'cancel',reason:value(form,'reason'),trip:{actualStop:place(value(form,'stop'))}},trip.legId);
  }}>
   <fieldset disabled={disabled}>
    <legend>Record where the trip actually stopped</legend>
    <label htmlFor={id+'-stop'}>Actual stop location</label><textarea id={id+'-stop'} name="stop" rows={2} maxLength={2000} required/>
    <label htmlFor={id+'-reason'}>Reason for cancellation</label><textarea id={id+'-reason'} name="reason" rows={2} maxLength={1000} required/>
    <button type="submit">Record cancellation</button>
   </fieldset>
  </form>
 </details>;
}
function TripFacts({trip,timezone}:{trip:SupportTrip;timezone:string}){
 return <div>
  <p><strong>{purpose[trip.purpose]}</strong> · {states[trip.state]}</p>
  <p>{trip.origin.locationText} → {trip.destination.locationText}</p>
  {trip.origin.instructions&&<p>Departure instructions {trip.origin.instructions}</p>}
  {trip.destination.instructions&&<p>Destination instructions {trip.destination.instructions}</p>}
  <p><time dateTime={trip.departedAt}>{when(trip.departedAt,timezone)}</time>
   {trip.arrivedAt&&<> – <time dateTime={trip.arrivedAt}>{when(trip.arrivedAt,timezone)}</time></>}</p>
  {trip.notes&&<p>{trip.notes}</p>}{trip.reason&&<p>{trip.reason}</p>}
  {trip.jobId&&<a href={'/schedule?job='+encodeURIComponent(trip.jobId)}>Open related job</a>}
 </div>;
}
export function SupportTripScreen(){
 const [view,setView]=useState(initialSupportTripView),controller=useRef<ReturnType<typeof createSupportTripController>|null>(null);
 const [downloadMessage,setDownloadMessage]=useState<{history:typeof view.history;text:string}|null>(null);
 const downloadUrl=useRef<string|null>(null);
 const historyHeading=useRef<HTMLHeadingElement>(null);
 const selectedId=view.selected?.legId;
 useEffect(()=>{if(selectedId)historyHeading.current?.focus();},[selectedId]);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const current=createSupportTripController({stores:{[kinds[0]]:createPendingSchedulingStore(storage,kinds[0]),
   [kinds[1]]:createPendingSchedulingStore(storage,kinds[1])},
   blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(kind=>kind!==kinds[0]&&kind!==kinds[1]).map(kind=>createPendingSchedulingStore(storage,kind)),
   change:setView});
  controller.current=current;void current.load();
  const clearDownload=()=>{if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;};
  const leave=()=>{current.suspend();clearDownload();setDownloadMessage(null);};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  document.addEventListener('visibilitychange',hidden);
  return()=>{controller.current=null;current.dispose();clearDownload();window.removeEventListener('pagehide',leave);
   window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',hidden);};
 },[]);
 const save=(body:SupportTripBody,legId?:string)=>void controller.current?.save(body,legId);
 const moreVehicles=()=>void controller.current?.moreVehicles();
 const trip=view.activeTrip,selected=view.selected;
 async function downloadHistory(){
  const current=controller.current;
  if(!current||!selected||current.view().busy)return;
  const isCurrent=()=>controller.current===current&&document.visibilityState!=='hidden'
   &&current.view().phase==='ready'&&current.view().history===view.history;
  const message=(text:string)=>setDownloadMessage({history:view.history,text});
  message('Checking saved trip history…');
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  try{
   bytes=await current.historyDownload();
   if(!isCurrent())return;
   if(!bytes)throw Error();
   if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/json;charset=utf-8'}));
   downloadUrl.current=url;
   const link=document.createElement('a');
   link.href=url;link.download='crest-standalone-trip-history.json';link.hidden=true;
   document.body.append(link);
   try{link.click();}
   finally{
    link.remove();
    window.setTimeout(()=>{URL.revokeObjectURL(url);if(downloadUrl.current===url)downloadUrl.current=null;},1000);
   }
   message('Download requested. Check your browser’s downloads.');
  }catch{if(isCurrent())message('The download could not be confirmed. Check your browser’s downloads before trying again.');}
  finally{bytes?.fill(0);}
 }
 return <section aria-label="Saved standalone travel" aria-busy={view.busy}>
  <p role="status" className="job-change-status">{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view travel</a>}
  {(view.phase==='unavailable'||view.phase==='review')&&<button type="button" onClick={()=>void controller.current?.load()} disabled={view.busy}>Reload saved travel</button>}
  {view.phase==='pending'&&<>
   {view.pending&&<p className="save-reference">Original trip reference <code>{view.pending.reference}</code></p>}
   <button type="button" onClick={()=>void controller.current?.check()} disabled={view.busy}>Check original trip</button>
  </>}
  {view.phase==='ready'&&<>
   {!view.canSave&&<p>Changes are paused. You can review saved travel.</p>}
   <section aria-label="Active trip">
    <h2>Active trip</h2>
    {trip?<><TripFacts trip={trip} timezone={view.timezone}/>
     {view.canSave&&<>
      <button type="button" disabled={view.busy} onClick={()=>save({action:'arrive',reason:null,trip:null},trip.legId)}>Record arrival</button>
      <CancelTrip trip={trip} disabled={view.busy} save={save}/>
     </>}
     <button type="button" className="secondary" disabled={view.busy} onClick={()=>void controller.current?.history(trip.legId)}>Review active trip history</button>
    </>:<p>No standalone trip is in progress.</p>}
   </section>
   {view.canSave&&!trip&&<TripForm key={'start-'+view.saveCount} mode="depart" view={view} save={save} moreVehicles={moreVehicles}/>}
   {view.canSave&&<details key={'earlier-'+view.saveCount}><summary>Record an earlier trip</summary>
    <TripForm mode="record" view={view} save={save} moreVehicles={moreVehicles}/>
   </details>}
   <section aria-label="Recent saved trips">
    <h2>Recent trips</h2>
    {view.trips.length===0?<p>No ended standalone trips are saved.</p>:<ul className="customer-list">{view.trips.map(row=><li key={row.legId}>
     <button type="button" className="secondary" aria-pressed={selected?.legId===row.legId} disabled={view.busy}
      onClick={()=>void controller.current?.history(row.legId)}>{purpose[row.purpose]} · {when(row.departedAt,view.timezone)}</button>
     <p>{states[row.state]} · {row.origin.locationText} → {row.destination.locationText}</p>
    </li>)}</ul>}
    {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void controller.current?.moreTrips()}>Load more saved trips</button>}
   </section>
   {selected&&<section aria-label="Saved trip history">
    <h2 ref={historyHeading} tabIndex={-1}>Saved trip history</h2>
    <p>Travel records describe the trip. Mileage is recorded separately.</p>
    {view.mileageAvailable&&selected.state!=='open'&&<p>
     <a href={'/schedule/mileage?leg='+encodeURIComponent(selected.legId)}>Review trip mileage</a>
    </p>}
    <ol>{view.history.map(row=><li key={row.legVersionId}>
     <strong>Version {row.sequence}</strong> · Recorded {when(row.recordedAt,view.timezone)}
     <TripFacts trip={row} timezone={view.timezone}/>
    </li>)}</ol>
    {view.moreHistory&&<button type="button" className="secondary" disabled={view.busy}
     onClick={()=>void controller.current?.history(selected.legId,true)}>Load more trip versions</button>}
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>void downloadHistory()}>Download trip history (JSON)</button>
    <p>Includes up to the last 10 loaded versions of this trip.</p>
    {downloadMessage?.history===view.history&&<p role="status" aria-label="Trip history download status">{downloadMessage.text}</p>}
    {view.canSave&&<details key={selected.legVersionId}><summary>Correct saved trip</summary>
     <TripForm mode="correct" trip={selected} view={view} save={save} moreVehicles={moreVehicles}/>
    </details>}
   </section>}
  </>}
  <nav className="work-links" aria-label="Related travel pages">
   <a href="/schedule">Schedule</a>
   <a href={view.pending?'/save-review?kind='+view.pending.kind:'/save-review'}>Interrupted saves</a>
  </nav>
 </section>;
}
