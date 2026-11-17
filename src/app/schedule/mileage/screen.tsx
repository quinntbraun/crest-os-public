'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {createMileageController,initialMileageView} from '../../../client/mileage-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import {mileageDistanceUnits,mileageShareFraction,mileageSharePercent,prepareMileageBody} from '../../../operations/mileage';
import type {MileageBody,MileageTrip} from '../../../operations/mileage';
import type {MileageHistoryPage} from '../../../operations/mileage-history';
import {mobileDepartureKind} from '../../../operations/mobile-departure-contract';
import type {LoadedMobileDeparture,MobileDepartureSave} from '../../../operations/mobile-departure-contract';
import {parseWorkCorrectionBody} from '../../../operations/job-work-boundary-contract';
import {calendarToday} from '../../../client/schedule-calendar';
import {BookingInstantInput} from '../booking-fields';
import {MileageAllocationTotals,MileageAttribution,mileageDisplay} from './attribution';
import type {FindMileageJobs,MileageShareDraft} from './attribution';

const labels:Record<MileageTrip['purpose'],string>={
 mobile_work_site:'Travel to job',supply:'Supply trip',between_jobs:'Between jobs',return_to_base:'Return to base',
 pickup:'Vehicle pickup',to_work_site:'Travel to work site',return_to_customer:'Vehicle return',other:'Other trip'
};
const distance:Record<MileageTrip['distanceStatus'],string>={
 unresolved:'Mileage unresolved',estimated:'Estimate recorded',confirmed_actual:'Actual mileage recorded',needs_review:'Mileage needs review'
};
const sources:Record<MileageBody['source'],string>={manual_actual:'Actual miles',odometer:'Odometer readings',route_estimate:'Route estimate'};
const movementLabels:Record<MileageBody['movementKind'],string>={
 business_rig:'Business rig',customer_vehicle:'Customer vehicle',personal:'Personal',unclassified:'Unclassified'
};
const kind='operations.mileage.record';
const value=(row:Readonly<Record<string,unknown>>|undefined,key:string)=>typeof row?.[key]==='string'?row[key]:'';

function MileageForm({trip,history,jobId,timezone,disabled,findJobs,save}:{
 trip:MileageTrip;history:MileageHistoryPage;jobId:string;timezone:string;disabled:boolean;
 findJobs:FindMileageJobs;save:(body:MileageBody)=>void;
}){
 const id=useId(),latest=history.evidence.at(-1),recorded=history.allocations.filter(row=>row.evidence_id===latest?.id);
 const [source,setSource]=useState<MileageBody['source']>(trip.state==='open'?'route_estimate':(latest?.source as MileageBody['source']??'manual_actual'));
 const [error,setError]=useState('');
 const [proposal,setProposal]=useState<MileageBody|null>(null);
 const [readings,setReadings]=useState(()=>({
  actual:value(latest,'actual_miles'),estimate:value(latest,'estimate_miles'),
  start:value(latest,'odometer_start'),end:value(latest,'odometer_end')
 }));
 const reviewHeading=useRef<HTMLHeadingElement>(null),reviewButton=useRef<HTMLButtonElement>(null);
 const start=mileageDistanceUnits(readings.start),end=mileageDistanceUnits(readings.end);
 const preview=source==='odometer'?(start!==null&&end!==null&&end>=start?end-start:null):
  mileageDistanceUnits(source==='manual_actual'?readings.actual:readings.estimate);
 const changeReading=(key:keyof typeof readings,next:string)=>setReadings(current=>({...current,[key]:next}));
 const [allocation,setAllocation]=useState(recorded.length?'preserve':'none');
 const [shares,setShares]=useState<readonly MileageShareDraft[]>(()=>recorded.map((row,index)=>({
  jobId:String(row.job_id),label:row.job_id===jobId?'This job':'Previously allocated job '+(index+1),
  percent:mileageSharePercent(String(row.fraction))
 })));
 const correction=trip.evidenceVersion!=='0';
 return <form className="field-work-form" onSubmit={event=>{
  event.preventDefault();
  if(proposal)return;
  const form=new FormData(event.currentTarget),raw=(key:string)=>String(form.get(key)??''),
   text=(key:string)=>raw(key).trim(),optional=(key:string)=>text(key)?raw(key):null;
  let split: {jobId:string;fraction:string}[]=[];
  if(allocation==='split'){
   try{
    split=shares.map(share=>({jobId:share.jobId,fraction:mileageShareFraction(share.percent)}));
    if(split.length<(jobId?2:1)||split.reduce((sum,share)=>sum+BigInt(share.fraction.replace('.','')),0n)!==100000000n)throw Error();
   }catch{setError(jobId
    ?'Choose at least two saved jobs and enter positive shares totaling exactly 100%. Use up to six decimal places.'
    :'Choose saved jobs and enter positive shares totaling exactly 100%. Use up to six decimal places.');return;}
  }
  try{
   const body=prepareMileageBody({source,movementKind:text('movement'),
    actualMiles:source==='manual_actual'?text('actual'):null,estimateMiles:text('estimate'),estimateSource:text('estimateSource'),
    odometerStart:source==='route_estimate'?null:text('start'),odometerEnd:source==='route_estimate'?null:text('end'),
    notes:optional('notes'),reason:optional('reason'),allocationState:allocation==='preserve'?latest?.allocation_state:allocation==='none'?'unallocated':'allocated',
    allocations:allocation==='preserve'?recorded.map(row=>({jobId:row.job_id,fraction:row.fraction})):allocation==='job'?[{jobId,fraction:'1'}]:split});
   setError('');setProposal(body);
   requestAnimationFrame(()=>reviewHeading.current?.focus());
  }catch{setError('Use up to four decimal places, enter both odometer readings, or give the source of an estimate. Check the fields shown above.');}
 }}>
  <fieldset disabled={disabled} hidden={proposal!==null} className="mileage-form-body">
   <legend>{correction?'Correct mileage':'Record mileage'}</legend>
   <section className="mileage-form-panel" aria-label="Source distance">
   <h3>Source distance</h3>
   {trip.state==='open'&&<p>Record an estimate now. Actual mileage can be entered after the trip ends.</p>}
   <label htmlFor={id+'-source'}>Distance source</label>
   <select id={id+'-source'} value={source} onChange={event=>setSource(event.target.value as MileageBody['source'])}>
    {trip.state!=='open'&&<><option value="manual_actual">Actual miles</option><option value="odometer">Odometer readings</option></>}
    <option value="route_estimate">Route estimate</option>
   </select>
   {source==='manual_actual'&&<><label htmlFor={id+'-actual'}>Actual miles</label>
    <input id={id+'-actual'} name="actual" inputMode="decimal" required value={readings.actual} onChange={event=>changeReading('actual',event.target.value)}/></>}
   {source==='odometer'&&<>
    <label htmlFor={id+'-start'}>Starting odometer (mi)</label><input id={id+'-start'} name="start" inputMode="decimal" required value={readings.start} onChange={event=>changeReading('start',event.target.value)}/>
    <label htmlFor={id+'-end'}>Ending odometer (mi)</label><input id={id+'-end'} name="end" inputMode="decimal" required value={readings.end} onChange={event=>changeReading('end',event.target.value)}/>
   </>}
   {source==='manual_actual'&&value(latest,'odometer_start')!==''&&<details><summary>Existing odometer readings</summary>
    <label htmlFor={id+'-start'}>Starting odometer (mi)</label><input id={id+'-start'} name="start" inputMode="decimal" value={readings.start} onChange={event=>changeReading('start',event.target.value)}/>
    <label htmlFor={id+'-end'}>Ending odometer (mi)</label><input id={id+'-end'} name="end" inputMode="decimal" value={readings.end} onChange={event=>changeReading('end',event.target.value)}/>
   </details>}
   {source==='route_estimate'?<>
    <label htmlFor={id+'-estimate'}>Estimated miles</label><input id={id+'-estimate'} name="estimate" inputMode="decimal" required value={readings.estimate} onChange={event=>changeReading('estimate',event.target.value)}/>
    <label htmlFor={id+'-estimate-source'}>Where the estimate came from</label><input id={id+'-estimate-source'} name="estimateSource" maxLength={1000} required defaultValue={value(latest,'estimate_source')}/>
   </>:<details><summary>Optional route estimate</summary>
    <label htmlFor={id+'-estimate'}>Estimated miles</label><input id={id+'-estimate'} name="estimate" inputMode="decimal" value={readings.estimate} onChange={event=>changeReading('estimate',event.target.value)}/>
    <label htmlFor={id+'-estimate-source'}>Where the estimate came from</label><input id={id+'-estimate-source'} name="estimateSource" maxLength={1000} defaultValue={value(latest,'estimate_source')}/>
   </details>}
   <label htmlFor={id+'-movement'}>Type of travel</label>
   <select id={id+'-movement'} name="movement" defaultValue={value(latest,'movement_kind')||'unclassified'}>
    <option value="unclassified">Unclassified</option><option value="business_rig">Business rig</option>
    <option value="customer_vehicle">Customer vehicle</option><option value="personal">Personal</option>
   </select>
   {preview!==null&&<p className="mileage-distance-preview"><span>{source==='route_estimate'?'Route estimate':'Trip distance'}</span><strong>{mileageDisplay(preview)}</strong></p>}
   </section>
   <section className="mileage-form-panel" aria-label="Business attribution">
    <h3>Business attribution</h3>
   <label htmlFor={id+'-allocation'}>Job attribution</label>
   <select id={id+'-allocation'} value={allocation} onChange={event=>{setAllocation(event.target.value);setError('');}}>
    {recorded.length>0&&<option value="preserve">Keep recorded allocation</option>}
    <option value="none">Unallocated</option>{jobId&&<option value="job">Allocate to this job</option>}
    <option value="split">{jobId?'Split across jobs':'Allocate to saved jobs'}</option>
   </select>
   {allocation==='split'&&<MileageAttribution jobId={jobId} day={calendarToday(timezone,new Date(trip.departedAt))}
    timezone={timezone} shares={shares} distance={preview} change={next=>{setShares(next);setError('');}} findJobs={findJobs}/>}
   {allocation!=='split'&&<MileageAllocationTotals shares={allocation==='preserve'?recorded.map(row=>mileageSharePercent(String(row.fraction))):allocation==='job'?['100']:[]} distance={preview}/>}
   </section>
   <section className="mileage-form-panel" aria-label="Mileage notes">
   <label htmlFor={id+'-notes'}>Notes (optional)</label>
   <textarea id={id+'-notes'} name="notes" maxLength={2000} rows={2} defaultValue={value(latest,'notes')}/>
   {correction&&<><label htmlFor={id+'-reason'}>Reason for correction</label><textarea id={id+'-reason'} name="reason" maxLength={1000} rows={2} required/></>}
   {error&&<p role="alert">{error}</p>}
   <button ref={reviewButton} type="submit">Review mileage</button>
   </section>
  </fieldset>
  {proposal&&<MileageReview proposal={proposal} latest={latest} shares={shares} jobId={jobId} disabled={disabled}
   heading={reviewHeading} onSave={()=>save(proposal)} onBack={()=>{
    setProposal(null);requestAnimationFrame(()=>reviewButton.current?.focus());
   }}/>}
 </form>;
}

function MileageReview({proposal,latest,shares,jobId,heading,disabled,onBack,onSave}:{
 proposal:MileageBody;latest:MileageHistoryPage['evidence'][number]|undefined;shares:readonly MileageShareDraft[];jobId:string;
 heading:React.Ref<HTMLHeadingElement>;disabled:boolean;onBack:()=>void;onSave:()=>void;
}){
 const distance=mileageDistanceUnits(proposal.actualMiles??proposal.estimateMiles??'');
 return <section className="home-panel mileage-review" aria-label="Mileage review">
  <h3 ref={heading} tabIndex={-1}>Review mileage</h3>
  <dl className="mileage-review-facts">
   {latest&&<div><dt>Previously saved</dt><dd>{String(latest.actual_miles??latest.estimate_miles)} mi · {sources[latest.source as MileageBody['source']]}</dd></div>}
   <div><dt>{latest?'Proposed distance':'Distance to save'}</dt><dd>{distance!==null&&mileageDisplay(distance)} · {sources[proposal.source]}</dd></div>
   <div><dt>Type of travel</dt><dd>{movementLabels[proposal.movementKind]}</dd></div>
   {proposal.odometerStart&&<div><dt>Odometer (mi)</dt><dd>{proposal.odometerStart} → {proposal.odometerEnd}</dd></div>}
   {proposal.estimateMiles!==null&&proposal.source!=='route_estimate'&&
    <div><dt>Route estimate</dt><dd>{proposal.estimateMiles} mi</dd></div>}
   {proposal.estimateSource&&<div><dt>Estimate source</dt><dd>{proposal.estimateSource}</dd></div>}
  </dl>
  {proposal.allocationState==='draft'&&<p className="field-help">The job allocation will stay a draft.</p>}
  {proposal.allocations.length>0?<ul className="mileage-review-jobs">{proposal.allocations.map((row,index)=><li key={row.jobId}>
   <span>{row.jobId===jobId?'This job':shares.find(share=>share.jobId===row.jobId)?.label??'Allocated job '+(index+1)}</span><strong>{mileageSharePercent(row.fraction)}%</strong>
  </li>)}</ul>:<p>No job allocation.</p>}
  <MileageAllocationTotals shares={proposal.allocations.map(row=>mileageSharePercent(row.fraction))} distance={distance}/>
  {(proposal.reason||proposal.notes)&&<dl className="mileage-review-facts">
   {proposal.reason&&<div><dt>Reason</dt><dd>{proposal.reason}</dd></div>}
   {proposal.notes&&<div><dt>Notes</dt><dd>{proposal.notes}</dd></div>}
  </dl>}
  <div className="mileage-review-actions">
   <button type="button" disabled={disabled} onClick={onSave}>{latest?'Save correction':'Save mileage'}</button>
   <button type="button" className="secondary" disabled={disabled} onClick={onBack}>Back to mileage details</button>
  </div>
 </section>;
}

export function MileageScreen({jobId,legId,initialTrip}:{jobId:string;legId:string;initialTrip:Pick<MileageTrip,'legId'|'departedAt'>|null}){
 const [view,setView]=useState(initialMileageView),controller=useRef<ReturnType<typeof createMileageController>|null>(null);
 const [downloadMessage,setDownloadMessage]=useState('');
 const downloadUrl=useRef<string|null>(null);
 const status=useRef<HTMLParagraphElement>(null),tripHeading=useRef<HTMLHeadingElement>(null);
 const awaitingReturnFocus=useRef(initialTrip!==null);
 const revoke=useCallback(()=>{
  if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);
  downloadUrl.current=null;
 },[]);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const current=createMileageController({jobId,legId,...initialTrip?{initialTrip}:{},store:createPendingSchedulingStore(storage,kind),
   departureStore:createPendingSchedulingStore(storage,mobileDepartureKind),
   blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(key=>key!==kind&&key!==mobileDepartureKind)
    .map(key=>createPendingSchedulingStore(storage,key)),change:setView});
  controller.current=current;void current.load();
  const leave=()=>{current.suspend();revoke();setDownloadMessage('');};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',hidden);
  return()=>{controller.current=null;current.dispose();revoke();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',hidden);};
 },[jobId,legId,initialTrip,revoke]);
 async function action(run:(current:NonNullable<typeof controller.current>)=>Promise<void>){
  const current=controller.current;if(!current)return;
  setDownloadMessage('');
  await run(current);if(controller.current===current)status.current?.focus();
 }
 const {selected,history}=view;
 useEffect(()=>{
  if(awaitingReturnFocus.current&&selected?.legId===initialTrip?.legId){
   awaitingReturnFocus.current=false;tripHeading.current?.focus();
  }
 },[initialTrip,selected]);
 const pendingDeparture=view.pendingKind===mobileDepartureKind;
 const format=(instant:string)=>new Intl.DateTimeFormat('en-US',{timeZone:view.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(instant));
 async function downloadHistory(){
  const current=controller.current;
  if(!current||!history||current.view().busy)return;
  const isCurrent=()=>controller.current===current&&document.visibilityState!=='hidden'
   &&current.view().phase==='ready'&&current.view().history===history;
  setDownloadMessage('Checking saved mileage history…');
  let bytes:Uint8Array<ArrayBuffer>|undefined;
  try{
   bytes=await current.archive();
   if(!isCurrent())return;
   if(!bytes)throw Error();
   revoke();
   const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
   downloadUrl.current=url;
   const link=document.createElement('a');
   link.href=url;link.download='crest-mileage-history-page.zip';link.hidden=true;
   document.body.append(link);
   try{link.click();}
   finally{
    link.remove();
    window.setTimeout(()=>{if(downloadUrl.current===url)revoke();},1000);
   }
   setDownloadMessage('Download requested. Check your browser’s downloads.');
  }catch{if(isCurrent())setDownloadMessage('No file could be prepared. Try downloading this history page again.');}
  finally{bytes?.fill(0);}
 }
 function renderTrip(trip:MileageTrip,saved:MileageHistoryPage){
  const latest=saved.evidence.find(row=>row.sequence===trip.evidenceVersion);
  const shareRows=latest?saved.allocations.filter(row=>row.evidence_id===latest.id):[];
  const amount=mileageDistanceUnits(String(latest?.actual_miles??latest?.estimate_miles??''));
  return <article className="mileage-selected">
   <header className="customer-record-header mileage-trip-summary">
    <p>{trip.state==='open'?'In progress':trip.state==='cancelled'?'Cancelled':'Ended'} · {distance[trip.distanceStatus]}</p>
    <h2 ref={tripHeading} tabIndex={-1}>{labels[trip.purpose]}</h2>
    <dl>
     <div><dt>Departure</dt><dd><time dateTime={trip.departedAt}>{format(trip.departedAt)}</time></dd></div>
     {trip.arrivedAt&&<div><dt>{trip.state==='cancelled'?'Stopped':'Arrival'}</dt><dd><time dateTime={trip.arrivedAt}>{format(trip.arrivedAt)}</time></dd></div>}
    </dl>
   </header>
   {latest&&<section className="home-panel mileage-result" aria-label="Current saved mileage">
    <div className="mileage-result-heading"><h2>Current saved mileage</h2><strong>{amount!==null&&mileageDisplay(amount)}</strong></div>
    <p>{sources[latest.source as MileageBody['source']]} · {movementLabels[latest.movement_kind as MileageBody['movementKind']]}</p>
    {trip.distanceStatus==='needs_review'&&<p className="notice">Review this distance against the current trip before relying on it.</p>}
    {shareRows.length>0&&<MileageAllocationTotals shares={shareRows.map(row=>mileageSharePercent(String(row.fraction)))} distance={amount}/>}
    <SavedAttribution history={saved} evidenceId={String(latest.id)} currentJob={jobId} trip={trip} state={String(latest.allocation_state)}/>
   </section>}
   {view.canSave&&saved.throughVersion===trip.evidenceVersion&&
    <MileageEditor trip={trip} history={saved} jobId={jobId} timezone={view.timezone} disabled={view.busy}
     findJobs={async(day,after)=>controller.current?.findJobs(day,after)}
     save={body=>void action(current=>current.save(body))}/>}
   <section className="home-panel mileage-history" aria-label="Saved mileage history">
    <h2>Saved mileage history</h2>
    {saved.evidence.length===0?<p>No mileage has been saved for this trip.</p>:<ol className="mileage-versions">{[...saved.evidence].reverse().map(row=><li key={String(row.id)}>
     <strong>Version {String(row.sequence)}</strong> · {sources[row.source as MileageBody['source']]}
     {row.actual_miles!==null&&<> · {String(row.actual_miles)} actual miles</>}
     {row.estimate_miles!==null&&<> · {String(row.estimate_miles)} estimated miles</>}
     {row.reason!==null&&<p>{String(row.reason)}</p>}
     <SavedAttribution history={saved} evidenceId={String(row.id)} currentJob={jobId} trip={trip} state={String(row.allocation_state)}/>
    </li>)}</ol>}
    <div className="mileage-history-actions">
     {saved.afterVersion!=='0'&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action(current=>current.older())}>Load earlier versions</button>}
     {saved.evidence.length>0&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void downloadHistory()}>Download loaded history (CSV + JSON)</button>}
    </div>
    {saved.evidence.length>0&&<p className="field-help">Includes the versions shown here, with their allocation and audit records.</p>}
    {downloadMessage&&<p role="status" aria-label="Mileage download status">{downloadMessage}</p>}
   </section>
   {view.canSave&&view.departure&&<DepartureEditor key={view.departure.legVersionId} departure={view.departure}
    timezone={view.timezone} disabled={view.busy} hasMileage={trip.evidenceVersion!=='0'}
    save={body=>void action(current=>current.correctDeparture(body))}/>}
  </article>;
 }
 return <section className="mileage-screen" aria-label="Saved trip mileage" aria-busy={view.busy}>
  <p className="job-change-status" ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view mileage</a>}
  {(view.phase==='review'||view.phase==='unavailable')&&<button type="button" disabled={view.busy} onClick={()=>void action(current=>current.load())}>Reload saved trips</button>}
  {view.phase==='pending'&&<>
   {view.reference&&<p className="save-reference">Original {pendingDeparture?'departure correction':'mileage'} reference <code>{view.reference}</code></p>}
   <button type="button" disabled={view.busy} onClick={()=>void action(current=>current.check())}>{pendingDeparture?'Check original departure correction':'Check original mileage'}</button>
  </>}
  {view.phase==='ready'&&<>
   {!view.canSave&&<p className="notice">Changes are paused. Saved mileage is available for review.</p>}
   {!!jobId&&(view.trips.length>0||selected)&&<div className="mileage-layout" data-picker={view.trips.length>0}>
    {view.trips.length>0&&<section className="home-panel mileage-picker" aria-label="Find a trip">
     <h2>Trips for this job</h2>
     <ul className="mileage-trip-list" role="list" aria-label="Trips for this job">{view.trips.map(trip=><li key={trip.legId}>
      <button type="button" className="secondary" aria-pressed={selected?.legId===trip.legId} disabled={view.busy}
       onClick={()=>void action(async current=>{
        await current.select(trip.legId);
        if(current.view().selected?.legId===trip.legId)requestAnimationFrame(()=>tripHeading.current?.focus());
       })}>{labels[trip.purpose]} · {format(trip.departedAt)}</button>
      <p>{trip.state==='open'?'In progress':trip.state==='cancelled'?'Cancelled':'Ended'} · {distance[trip.distanceStatus]}</p>
     </li>)}</ul>
     {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action(current=>current.moreTrips())}>Load more trips</button>}
    </section>}
    {selected&&history&&renderTrip(selected,history)}
   </div>}
   {!!legId&&selected&&history&&renderTrip(selected,history)}
  </>}
  <nav className="work-links" aria-label="Related mileage pages">
   {jobId&&<a href={'/schedule?job='+encodeURIComponent(jobId)}>Saved job</a>}
   {legId&&<a href={selected?'/schedule/travel?'+new URLSearchParams({trip:legId,at:selected.departedAt}):'/schedule/travel'}>Standalone travel</a>}
   {!jobId&&!legId&&<a href="/schedule">Schedule</a>}
   {view.phase!=='ready'&&<a href={'/save-review?kind='+(pendingDeparture?mobileDepartureKind:kind)}>Interrupted saves</a>}
  </nav>
 </section>;
}

function DepartureEditor({departure,timezone,disabled,hasMileage,save}:{
 departure:LoadedMobileDeparture;timezone:string;disabled:boolean;hasMileage:boolean;save:(body:MobileDepartureSave['body'])=>void;
}){
 const id=useId(),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 const format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'medium'});
 const when=(instant:string)=>format.format(new Date(instant));
 return <details className="mileage-correction">
  <summary>Correct departure time</summary>
  <form className="field-work-form" onSubmit={event=>{
   event.preventDefault();
   try{
    const reason=String(new FormData(event.currentTarget).get('reason')??'');
    if(!correctedAt||correctedAt===departure.departedAt||departure.arrivedAt&&correctedAt>departure.arrivedAt)throw Error();
    const body=parseWorkCorrectionBody({correctedAt,reason});
    setIssue('');save(body);
   }catch{setIssue('Enter a different departure time within the saved trip and give a reason.');}
  }}>
   <fieldset disabled={disabled}>
    <p>Saved departure <time dateTime={departure.departedAt}>{when(departure.departedAt)}</time>.</p>
    {departure.originalDepartedAt!==departure.departedAt&&<p>First recorded as <time dateTime={departure.originalDepartedAt}>{when(departure.originalDepartedAt)}</time>.</p>}
    {departure.arrivedAt&&<p>{departure.legState==='cancelled'?'Recorded stop':'Recorded arrival'} <time dateTime={departure.arrivedAt}>{when(departure.arrivedAt)}</time>.</p>}
    {hasMileage&&<p>Saved mileage will need review after the correction.</p>}
    <BookingInstantInput label="Corrected departure time" value={correctedAt} zone={timezone} change={setCorrectedAt} seconds/>
    <label htmlFor={id+'-reason'}>Departure correction reason</label>
    <textarea id={id+'-reason'} name="reason" maxLength={1000} rows={2} required/>
    {issue&&<p role="alert">{issue}</p>}
    <button type="submit">Save departure correction</button>
   </fieldset>
  </form>
 </details>;
}

function SavedAttribution({history,evidenceId,currentJob,trip,state}:{history:MileageHistoryPage;evidenceId:string;currentJob:string;trip:MileageTrip;state:string}){
 const shares=history.allocations.filter(row=>row.evidence_id===evidenceId);
 if(!shares.length)return <p>Unallocated</p>;
 return <details className="mileage-saved-attribution">
  <summary>{state==='draft'?'Draft job attribution':'Job attribution'} · {shares.length} {shares.length===1?'job':'jobs'}</summary>
  <ul>{shares.map((row,index)=><li key={String(row.id)}>
   {mileageSharePercent(String(row.fraction))}% · {row.job_id===currentJob?'This job':
    <a href={'/schedule?'+new URLSearchParams({job:String(row.job_id),from:'mileage',mileageLeg:trip.legId,
     ...currentJob?{mileageJob:currentJob,mileageAt:trip.departedAt}:{}})}>Open allocated job {index+1}</a>}
  </li>)}</ul>
 </details>;
}

function MileageEditor(props:Parameters<typeof MileageForm>[0]){
 const identity=props.trip.legVersionId+':'+props.history.throughVersion;
 if(props.trip.evidenceVersion==='0')return <MileageForm key={identity} {...props}/>;
 return <details className="mileage-correction" key={identity}>
  <summary>Correct saved mileage</summary>
  <MileageForm {...props}/>
 </details>;
}
