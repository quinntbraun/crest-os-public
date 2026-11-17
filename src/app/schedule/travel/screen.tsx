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
 const [proposal,setProposal]=useState<Extract<SupportTripBody,{action:'record'|'correct'}>|null>(null);
 const proposalHeading=useRef<HTMLHeadingElement>(null),reviewButton=useRef<HTMLButtonElement>(null);
 const [state,setState]=useState<SupportTrip['state']>(trip?.state??'closed');
 const title=mode==='depart'?'Start a trip':mode==='correct'?'Correct saved trip':'Record an earlier trip';
 const retired=trip&&!view.vehicles.some(row=>row.id===trip.drivenVehicleId);
 return <form className="field-work-form" aria-label={title} onSubmit={event=>{
  event.preventDefault();
  if(proposal)return;
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
   setProposal({action:mode,reason,trip:{...route,state,departedAt,arrivedAt}});
   requestAnimationFrame(()=>proposalHeading.current?.focus());
  }catch{setError('Enter a reason and a valid departure and stop time. Times must be ordered and unambiguous in the business time zone.');}
 }}>
  <fieldset disabled={view.busy||!view.canSave} hidden={proposal!==null}>
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
   <button ref={reviewButton} type="submit" disabled={view.vehicles.length===0&&!retired}>{mode==='depart'?title:'Review trip'}</button>
  </fieldset>
  {proposal&&<section className="travel-review" aria-label="Trip change review">
   <h3 ref={proposalHeading} tabIndex={-1}>Review trip</h3>
   <div className="travel-comparison">
    {trip&&<div><h4>Saved trip</h4><p>{purpose[trip.purpose]} · {states[trip.state]}</p><TripFacts trip={trip} timezone={view.timezone}/></div>}
    <div><h4>{trip?'Proposed trip':'Trip to record'}</h4><p>{purpose[proposal.trip.purpose]} · {states[proposal.trip.state]}</p>
     <TripFacts trip={{...proposal.trip,reason:proposal.reason}} timezone={view.timezone}/>
    </div>
   </div>
   <div className="travel-review-actions">
    <button type="button" disabled={view.busy||!view.canSave} onClick={()=>save(proposal,trip?.legId)}>{title}</button>
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>{
     setProposal(null);requestAnimationFrame(()=>reviewButton.current?.focus());
    }}>Back to trip details</button>
   </div>
  </section>}
 </form>;
}
function CancelTrip({trip,disabled,save}:{trip:SupportTrip;disabled:boolean;save:(body:SupportTripBody,legId:string)=>void}){
 const id=useId();
 return <details className="travel-auxiliary"><summary>Interrupt this trip</summary>
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
type TripFactValues=Pick<SupportTrip,'state'|'origin'|'destination'|'departedAt'|'arrivedAt'|'notes'|'reason'|'jobId'>;
function TripFacts({trip,timezone}:{trip:TripFactValues;timezone:string}){
 const stopLabel=trip.state==='open'?'Destination':trip.state==='cancelled'?'Actual stop':'Arrival';
 return <div className="travel-facts">
  <dl className="travel-route">
   <div className="travel-route-stop">
    <dt>Departure</dt>
    <dd><strong>{trip.origin.locationText}</strong><time dateTime={trip.departedAt}>{when(trip.departedAt,timezone)}</time>
     {trip.origin.instructions&&<p>{trip.origin.instructions}</p>}
    </dd>
   </div>
   <div className="travel-route-stop">
    <dt>{stopLabel}</dt>
    <dd><strong>{trip.destination.locationText}</strong>
     {trip.arrivedAt&&<time dateTime={trip.arrivedAt}>{when(trip.arrivedAt,timezone)}</time>}
     {trip.destination.instructions&&<p>{trip.destination.instructions}</p>}
    </dd>
   </div>
  </dl>
  {(trip.notes||trip.reason)&&<dl className="travel-notes">
   {trip.notes&&<div><dt>Notes</dt><dd>{trip.notes}</dd></div>}
   {trip.reason&&<div><dt>Reason recorded</dt><dd>{trip.reason}</dd></div>}
  </dl>}
  {trip.jobId&&<a href={'/schedule?job='+encodeURIComponent(trip.jobId)}>Open related job</a>}
 </div>;
}

function RecentTrips({view,open,more}:{view:SupportTripView;open:(legId:string)=>void;more:()=>void}){
 const date=new Intl.DateTimeFormat('en-US',{timeZone:view.timezone,dateStyle:'full'});
 const time=new Intl.DateTimeFormat('en-US',{timeZone:view.timezone,hour:'numeric',minute:'2-digit'});
 const groups=new Map<string,SupportTrip[]>();
 for(const row of view.trips){
  const day=date.format(new Date(row.departedAt)),previous=groups.get(day);
  if(previous)previous.push(row);
  else groups.set(day,[row]);
 }
 return <section className="home-panel travel-recent" aria-label="Recent saved trips">
  <h2>Recent trips</h2>
  {groups.size===0?<p>No ended standalone trips are saved.</p>:
   Array.from(groups,([day,rows])=><details className="travel-day" key={day}>
    <summary><span>{day}</span><small>{rows.length} {rows.length===1?'trip':'trips'}</small></summary>
    <ul className="customer-list customer-directory-list">{rows.map(row=><li key={row.legId}>
     <button type="button" className="secondary" aria-current={view.selected?.legId===row.legId?'true':undefined}
      disabled={view.busy} onClick={()=>open(row.legId)}>
      {purpose[row.purpose]} <time dateTime={row.departedAt}>{time.format(new Date(row.departedAt))}</time>
     </button>
     <p className="customer-contact">{states[row.state]} · {row.origin.locationText} → {row.destination.locationText}</p>
    </li>)}</ul>
   </details>)}
  {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={more}>Load more saved trips</button>}
 </section>;
}
export function SupportTripScreen({initialTrip}:{initialTrip:{legId:string;departedAt:string}|null}){
 const [view,setView]=useState(initialSupportTripView),controller=useRef<ReturnType<typeof createSupportTripController>|null>(null);
 const [downloadMessage,setDownloadMessage]=useState<{history:typeof view.history;text:string}|null>(null);
 const downloadUrl=useRef<string|null>(null);
 const historyHeading=useRef<HTMLHeadingElement>(null),activeHeading=useRef<HTMLHeadingElement>(null);
 const startHeading=useRef<HTMLHeadingElement>(null),startButton=useRef<HTMLButtonElement>(null);
 const [startRevision,setStartRevision]=useState<number|null>(null);
 const canStart=view.phase==='ready'&&view.canSave&&view.activeTrip===null;
 const showStart=canStart&&startRevision===view.saveCount;
 const activeId=view.activeTrip?.legId;
 useEffect(()=>{
  if(showStart)startHeading.current?.focus();
 },[showStart]);
 const selectedId=view.selected?.legId;
 useEffect(()=>{
  if(selectedId)historyHeading.current?.focus();
  else if(activeId&&view.saveCount>0)activeHeading.current?.focus();
 },[selectedId,activeId,view.saveCount]);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const current=createSupportTripController({...initialTrip?{initialTrip}:{},stores:{[kinds[0]]:createPendingSchedulingStore(storage,kinds[0]),
   [kinds[1]]:createPendingSchedulingStore(storage,kinds[1])},
   blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(kind=>kind!==kinds[0]&&kind!==kinds[1]).map(kind=>createPendingSchedulingStore(storage,kind)),
   change:setView});
  controller.current=current;void current.load();
  const clearDownload=()=>{if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);downloadUrl.current=null;};
  const leave=()=>{current.suspend();clearDownload();setDownloadMessage(null);setStartRevision(null);};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  document.addEventListener('visibilitychange',hidden);
  return()=>{controller.current=null;current.dispose();clearDownload();window.removeEventListener('pagehide',leave);
   window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',hidden);};
 },[initialTrip]);
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
 return <section className="travel-screen" aria-label="Saved standalone travel" aria-busy={view.busy}>
  <p role="status" className="job-change-status">{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view travel</a>}
  {(view.phase==='unavailable'||view.phase==='review')&&<button type="button" onClick={()=>void controller.current?.load()} disabled={view.busy}>Reload saved travel</button>}
  {view.phase==='pending'&&<>
   {view.pending&&<p className="save-reference">Original trip reference <code>{view.pending.reference}</code></p>}
   <button type="button" onClick={()=>void controller.current?.check()} disabled={view.busy}>Check original trip</button>
  </>}
  {view.phase==='ready'&&<>
   {!view.canSave&&<p className="notice">Changes are paused. You can review saved travel.</p>}
   <section className="home-panel travel-active" aria-label="Active trip">
    {trip?<>
     <div className="travel-active-heading">
      <div>
       <p className="travel-status-line">{states[trip.state]}</p>
       <h2 ref={activeHeading} tabIndex={-1}>{purpose[trip.purpose]}</h2>
      </div>
      {view.canSave&&<button type="button" disabled={view.busy} onClick={()=>save({action:'arrive',reason:null,trip:null},trip.legId)}>Record arrival</button>}
     </div>
     <TripFacts trip={trip} timezone={view.timezone}/>
     <div className="travel-active-actions">
      <button type="button" className="secondary" disabled={view.busy} onClick={()=>void controller.current?.history(trip.legId)}>Review active trip history</button>
      {view.canSave&&<CancelTrip trip={trip} disabled={view.busy} save={save}/>}
     </div>
    </>:<>
     <div className="travel-start-heading">
      <h2>No standalone trip is in progress.</h2>
      {canStart&&<button ref={startButton} type="button" aria-expanded={showStart} disabled={view.busy} onClick={()=>{
       setStartRevision(showStart?null:view.saveCount);
       if(showStart)requestAnimationFrame(()=>startButton.current?.focus());
      }}>{showStart?'Close trip form':'Start a trip'}</button>}
     </div>
     {showStart&&<div className="travel-start-form">
      <h3 ref={startHeading} tabIndex={-1}>Trip details</h3>
      <TripForm mode="depart" view={view} save={save} moreVehicles={moreVehicles}/>
     </div>}
    </>}
   </section>
   {view.canSave&&<details className="home-panel travel-earlier" key={'earlier-'+view.saveCount}><summary>Record an earlier trip</summary>
    <TripForm mode="record" view={view} save={save} moreVehicles={moreVehicles}/>
   </details>}
   <div className="travel-history-layout" data-selected={selected!==null}>
    <RecentTrips view={view} open={legId=>void controller.current?.history(legId)} more={()=>void controller.current?.moreTrips()}/>
    {selected&&<section className="home-panel travel-history" aria-label="Saved trip history">
     <h2 ref={historyHeading} tabIndex={-1}>Saved trip history</h2>
     <div className="travel-saved-heading">
      <strong>{purpose[selected.purpose]}</strong><span>{states[selected.state]}</span>
     </div>
     <TripFacts trip={selected} timezone={view.timezone}/>
     {view.mileageAvailable&&selected.state!=='open'&&<a className="primary-action travel-mileage" href={'/schedule/mileage?leg='+encodeURIComponent(selected.legId)}>Review trip mileage</a>}
     <details className="travel-versions">
      <summary>Saved versions ({view.history.length}{view.moreHistory?'+':''})</summary>
      <ol>{view.history.map(row=><li key={row.legVersionId}>
       <strong>Version {row.sequence}</strong> · {states[row.state]} · <time dateTime={row.recordedAt}>{when(row.recordedAt,view.timezone)}</time>
       <TripFacts trip={row} timezone={view.timezone}/>
      </li>)}</ol>
      {view.moreHistory&&<button type="button" className="secondary" disabled={view.busy}
       onClick={()=>void controller.current?.history(selected.legId,true)}>Load more trip versions</button>}
     </details>
     {view.canSave&&<details className="travel-auxiliary" key={selected.legVersionId}><summary>Correct saved trip</summary>
      <TripForm mode="correct" trip={selected} view={view} save={save} moreVehicles={moreVehicles}/>
     </details>}
     <button type="button" className="secondary travel-download" disabled={view.busy} onClick={()=>void downloadHistory()}>Download trip history (JSON)</button>
     <p className="field-help">Includes up to the last 10 loaded versions of this trip.</p>
     {downloadMessage?.history===view.history&&<p role="status" aria-label="Trip history download status">{downloadMessage.text}</p>}
    </section>}
   </div>
  </>}
  {view.phase!=='ready'&&view.phase!=='loading'&&<nav className="work-links" aria-label="Travel help">
   <a href={view.pending?'/save-review?kind='+view.pending.kind:'/save-review'}>Interrupted saves</a>
  </nav>}
 </section>;
}
