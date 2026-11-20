'use client';
import {mileageEvidenceChanges} from './mileage-evidence-presentation';
import {TaskPrerequisite} from '../../task-prerequisite';
import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
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

function MileageForm({trip,history,jobId,timezone,disabled,findJobs,save,draftChanged}:{
 trip:MileageTrip;history:MileageHistoryPage;jobId:string;timezone:string;disabled:boolean;
 findJobs:FindMileageJobs;save:(body:MileageBody,id:string)=>void;draftChanged:(id:string,dirty:boolean)=>void;
}){
 const id=useId(),latest=history.evidence.at(-1),recorded=history.allocations.filter(row=>row.evidence_id===latest?.id);
 const [source,setSource]=useState<MileageBody['source']>(trip.state==='open'?'route_estimate':(latest?.source as MileageBody['source']??'manual_actual'));
 const [error,setError]=useState('');
 const [proposal,setProposal]=useState<MileageBody|null>(null);
 const [readings,setReadings]=useState(()=>({
  actual:value(latest,'actual_miles'),estimate:value(latest,'estimate_miles'),
  start:value(latest,'odometer_start'),end:value(latest,'odometer_end')
 }));
 const reviewFocus=useRef<'review'|'form'|null>(null);
 const reviewHeading=useRef<HTMLHeadingElement>(null),reviewButton=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{
  if(reviewFocus.current==='review'&&proposal)reviewHeading.current?.focus();
  if(reviewFocus.current==='form'&&!proposal)reviewButton.current?.focus();
  reviewFocus.current=null;
 },[proposal]);
 useEffect(()=>()=>draftChanged(id,false),[draftChanged,id]);
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
 return <form className="field-work-form" onChange={()=>draftChanged(id,true)} onSubmit={event=>{
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
   reviewFocus.current='review';setError('');setProposal(body);
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
    timezone={timezone} shares={shares} distance={preview} change={next=>{setShares(next);setError('');draftChanged(id,true);}} findJobs={findJobs}/>}
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
   heading={reviewHeading} onSave={()=>save(proposal,id)} onBack={()=>{
    reviewFocus.current='form';setProposal(null);
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
 const [dirtyDrafts,setDirtyDrafts]=useState<ReadonlySet<string>>(()=>new Set()),[editorRevision,setEditorRevision]=useState(0);
 const [dismissedRecord,setDismissedRecord]=useState<string|null>(null),[focusRequest,setFocusRequest]=useState<{target:'record'|'picker'}|null>(null);
 const handledFocus=useRef<typeof focusRequest>(null),tripOrigin=useRef<HTMLButtonElement|null>(null),pickerHeading=useRef<HTMLHeadingElement>(null);
 const draftChanged=useCallback((id:string,dirty:boolean)=>setDirtyDrafts(previous=>{if(previous.has(id)===dirty)return previous;const next=new Set(previous);if(dirty)next.add(id);else next.delete(id);return next;}),[]);
 const recordKey=view.selected&&view.history?view.selected.legVersionId+':'+view.history.afterVersion+':'+view.history.throughVersion:null;
 const showingRecord=recordKey!==null&&recordKey!==dismissedRecord;
 useLayoutEffect(()=>{
  if(!focusRequest||handledFocus.current===focusRequest||view.busy||view.phase!=='ready')return;
  if(focusRequest.target==='record'){if(!showingRecord)return;tripHeading.current?.focus();}
  else if(tripOrigin.current?.isConnected)tripOrigin.current.focus();
  else pickerHeading.current?.focus();
  handledFocus.current=focusRequest;
 },[focusRequest,view.busy,view.phase,showingRecord]);
 useEffect(()=>{if(!dirtyDrafts.size)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirtyDrafts]);
 function mayReplaceDrafts(exceptId?:string){
  if(!Array.from(dirtyDrafts).some(id=>id!==exceptId))return true;
  if(!window.confirm('Discard unfinished mileage or departure correction drafts before continuing?'))return false;
  setEditorRevision(value=>value+1);return true;
 }
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
  const leave=()=>{current.suspend();revoke();setDownloadMessage('');setDismissedRecord(null);setFocusRequest(null);tripOrigin.current=null;};
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
 useLayoutEffect(()=>{
  if(awaitingReturnFocus.current&&selected?.legId===initialTrip?.legId){
   awaitingReturnFocus.current=false;tripHeading.current?.focus();
  }
 },[initialTrip,selected]);
 const pendingDeparture=view.pendingKind===mobileDepartureKind;
 const format=(instant:string)=>new Intl.DateTimeFormat('en-US',{timeZone:view.timezone,dateStyle:'medium',timeStyle:'medium'}).format(new Date(instant));
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
 function handleEarlierVersions(){if(!mayReplaceDrafts())return;void action(current=>current.older());}
 function handleMileageSave(body:MileageBody,id:string){if(!mayReplaceDrafts(id))return;void action(current=>current.save(body));}
 function handleDepartureSave(body:MobileDepartureSave['body'],id:string){if(!mayReplaceDrafts(id))return;void action(current=>current.correctDeparture(body));}
 function renderTrip(trip:MileageTrip,saved:MileageHistoryPage){
  const latest=saved.evidence.find(row=>row.sequence===trip.evidenceVersion);
  const shareRows=latest?saved.allocations.filter(row=>row.evidence_id===latest.id):[];
  const amount=mileageDistanceUnits(String(latest?.actual_miles??latest?.estimate_miles??''));
  return <article className="mileage-selected" hidden={!showingRecord}>
   {!!jobId&&view.trips.length>0&&<button type="button" className="secondary mileage-back" disabled={view.busy} onClick={()=>{setDismissedRecord(recordKey);setFocusRequest({target:'picker'});}}>Back to trips</button>}
   <header className="customer-record-header mileage-trip-summary">
    <p>{trip.state==='open'?'In progress':trip.state==='cancelled'?'Cancelled':'Ended'} · {distance[trip.distanceStatus]}</p>
    <p className="field-help">Time zone: {view.timezone}</p>
    <h2 ref={tripHeading} tabIndex={-1}>{labels[trip.purpose]}</h2>
    <dl>
     <div><dt>Departure</dt><dd><time dateTime={trip.departedAt}>{format(trip.departedAt)}</time></dd></div>
     {trip.arrivedAt&&<div><dt>{trip.state==='cancelled'?'Stopped':'Arrival'}</dt><dd><time dateTime={trip.arrivedAt}>{format(trip.arrivedAt)}</time></dd></div>}
    </dl>
   </header>
   {!latest&&trip.evidenceVersion!=='0'&&<p className="field-help">This page contains earlier mileage evidence. {jobId?'Choose this trip again to review current saved mileage.':'Reload this page to review current saved mileage.'}</p>}
   {latest&&<section className="home-panel mileage-result" aria-label="Current saved mileage">
    <div className="mileage-result-heading"><h2>Current saved mileage</h2><strong>{amount!==null&&mileageDisplay(amount)}</strong></div>
    <p>{sources[latest.source as MileageBody['source']]} · {movementLabels[latest.movement_kind as MileageBody['movementKind']]}</p>
    {trip.distanceStatus==='needs_review'&&<p className="notice">Review this distance against the current trip before relying on it.</p>}
    {shareRows.length>0&&<MileageAllocationTotals shares={shareRows.map(row=>mileageSharePercent(String(row.fraction)))} distance={amount}/>}
    <SavedAttribution history={saved} evidenceId={String(latest.id)} currentJob={jobId} trip={trip} state={String(latest.allocation_state)}/>
   </section>}
   {view.canSave&&saved.throughVersion===trip.evidenceVersion&&
    <MileageEditor key={editorRevision} trip={trip} history={saved} jobId={jobId} timezone={view.timezone} disabled={view.busy}
     findJobs={async(day,after)=>controller.current?.findJobs(day,after)}
     draftChanged={draftChanged} save={handleMileageSave}/>}
   <section className="home-panel mileage-history" aria-label="Saved mileage history">
    <h2>Saved mileage history</h2>
    {saved.evidence.length===0?<p>No mileage has been saved for this trip.</p>:<>
     <p className="field-help">Loaded versions {String(saved.evidence[0]!.sequence)}–{String(saved.evidence.at(-1)!.sequence)}. {saved.afterVersion==='0'?'No earlier versions for this trip.':'Earlier versions are available.'}</p>
     <table className="mileage-evidence-table" role="table"><caption className="visually-hidden">Recorded mileage versions, distances, vehicle types and evidence</caption><thead role="rowgroup"><tr role="row"><th scope="col">Entry</th><th scope="col">Distance</th><th scope="col">Vehicle used</th><th scope="col">Evidence and attribution</th></tr></thead><tbody role="rowgroup">{saved.evidence.map((row,index)=>{
      const previous=saved.evidence[index-1],changes=mileageEvidenceChanges(saved,previous,row);
      const fieldValue=(key:string,raw:string|null)=>raw===null?'Not recorded':key==='source'?sources[raw as MileageBody['source']]:key==='movement_kind'?movementLabels[raw as MileageBody['movementKind']]:key==='allocations'?<SavedAttribution history={saved} evidenceId={raw} currentJob={jobId} trip={trip} state={String(saved.evidence.find(entry=>entry.id===raw)?.allocation_state)}/>:raw;
      return <tr key={String(row.id)} role="row">
       <th scope="row" role="rowheader"><header><strong>Version {String(row.sequence)}</strong><span>{row.sequence==='1'?'First entry':'Correction'} · {sources[row.source as MileageBody['source']]}</span><p>Recorded <time dateTime={String(row.created_at)} title={String(row.created_at)}>{format(String(row.created_at))}</time></p></header></th>
       <td role="cell"><p className="mileage-history-distance">{row.actual_miles!==null&&<strong>{String(row.actual_miles)} actual miles</strong>}{row.estimate_miles!==null&&<span>{String(row.estimate_miles)} estimated miles</span>}</p></td>
       <td role="cell"><p>{movementLabels[row.movement_kind as MileageBody['movementKind']]}</p></td>
       <td role="cell">
       {row.reason!==null&&<p className="mileage-history-reason"><strong>Reason recorded</strong><span>{String(row.reason)}</span></p>}
       {changes?.length?<details className="mileage-history-changes"><summary>Changes from version {String(previous!.sequence)}</summary><dl>{changes.map(change=><div key={change.key}><dt>{change.label}</dt><dd><span>Before</span><div>{fieldValue(change.key,change.before)}</div></dd><dd><span>This version</span><div>{fieldValue(change.key,change.after)}</div></dd></div>)}</dl></details>:row.sequence!=='1'&&<p className="field-help">{changes===null?'The preceding version is not on this loaded page.':'Distance, source and allocations unchanged; the retained reason is shown above.'}</p>}
       <SavedAttribution history={saved} evidenceId={String(row.id)} currentJob={jobId} trip={trip} state={String(row.allocation_state)}/>
       <details className="mileage-history-evidence"><summary>Saved evidence for mileage version {String(row.sequence)}</summary><dl>
        <div><dt>Actual miles</dt><dd>{row.actual_miles===null?'Not recorded':String(row.actual_miles)}</dd></div><div><dt>Estimated miles</dt><dd>{row.estimate_miles===null?'Not recorded':String(row.estimate_miles)}</dd></div><div><dt>Estimate source</dt><dd>{row.estimate_source===null?'Not recorded':String(row.estimate_source)}</dd></div><div><dt>Odometer (mi)</dt><dd>{row.odometer_start===null?'Not recorded':String(row.odometer_start)+' → '+String(row.odometer_end)}</dd></div><div><dt>Notes</dt><dd>{row.notes===null?'Not recorded':String(row.notes)}</dd></div><div><dt>Recorded (UTC)</dt><dd>{String(row.created_at)}</dd></div><div><dt>Evidence reference</dt><dd>{String(row.id)}</dd></div><div><dt>Trip version reference</dt><dd>{String(row.leg_version_id)}</dd></div><div><dt>Operation reference</dt><dd>{String(row.operation_id)}</dd></div>
       </dl></details>
       </td>
      </tr>;
     }).reverse()}</tbody></table>
    </>}
    <div className="mileage-history-actions">
     {saved.afterVersion!=='0'&&<button className="secondary" type="button" disabled={view.busy} onClick={handleEarlierVersions}>Load earlier versions</button>}
     {saved.evidence.length>0&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void downloadHistory()}>Download loaded history (CSV + JSON)</button>}
    </div>
    {saved.evidence.length>0&&<p className="field-help">Includes the versions shown here, with their allocation and audit records.</p>}
    {downloadMessage&&<p role="status" aria-label="Mileage download status">{downloadMessage}</p>}
   </section>
   {view.canSave&&view.departure&&<DepartureEditor key={view.departure.legVersionId+':'+editorRevision} departure={view.departure}
    timezone={view.timezone} disabled={view.busy} hasMileage={trip.evidenceVersion!=='0'}
    draftChanged={draftChanged} save={handleDepartureSave}/>}
  </article>;
 }
 return <section className="mileage-screen" aria-label="Saved trip mileage" aria-busy={view.busy}>
  <p className={view.selectionNeeded?'visually-hidden':'job-change-status'} ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view mileage</a>}
  {view.selectionNeeded&&<TaskPrerequisite kind="mileage"/>}
  {!view.selectionNeeded&&(view.phase==='review'||view.phase==='unavailable')&&<button type="button" disabled={view.busy} onClick={()=>void action(current=>current.load())}>Reload saved trips</button>}
  {view.phase==='pending'&&<>
   {view.reference&&<p className="save-reference">Original {pendingDeparture?'departure correction':'mileage'} reference <code>{view.reference}</code></p>}
   <button type="button" disabled={view.busy} onClick={()=>void action(current=>current.check())}>{pendingDeparture?'Check original departure correction':'Check original mileage'}</button>
  </>}
  {view.phase==='ready'&&<>
   {jobId&&<section className="mileage-job-context" aria-label="Saved job context">
    {view.jobContext?<><div><p className="field-help">Mileage for this job</p><h2>{view.jobContext.customerName}</h2></div>
     <details><summary>Job vehicles · {view.jobContext.vehicleLabels.length}</summary><ul>{view.jobContext.vehicleLabels.map((label,index)=><li key={index}>{label}</li>)}</ul><p className="field-help">These are the job’s vehicles. The saved mileage identifies the type of vehicle used for travel separately.</p></details></>
     :<p>Job identity could not be verified. <a href={'/schedule?job='+encodeURIComponent(jobId)}>Open saved job</a> to review its customer and vehicles.</p>}
   </section>}
   {legId&&<p className="field-help mileage-standalone-context">Standalone travel · Job attribution is recorded separately for each mileage entry.</p>}
   {!view.canSave&&<p className="notice">Changes are paused. Saved mileage is available for review.</p>}
   {jobId&&view.trips.length===0&&<section className="home-panel" aria-label="No recorded trips"><h2>No trips recorded yet</h2><p>Mileage appears here after travel is recorded for this job. No distance has been assumed.</p><a className="primary-action" href={'/schedule?job='+encodeURIComponent(jobId)}>Return to saved job</a></section>}
   {dirtyDrafts.size>0&&!showingRecord&&selected&&<aside className="mileage-draft-notice" aria-label="Unfinished mileage draft"><p>Your unfinished mileage or departure draft is still open.</p><button type="button" className="secondary" onClick={()=>{setDismissedRecord(null);setFocusRequest({target:'record'});}}>Return to mileage draft</button></aside>}
   {!!jobId&&(view.trips.length>0||selected)&&<div className="mileage-layout" data-picker={view.trips.length>0} data-selected={showingRecord}>
    {view.trips.length>0&&<section className="home-panel mileage-picker" aria-label="Find a trip">
     <h2 ref={pickerHeading} tabIndex={-1}>Trips for this job</h2>
     <ul className="mileage-trip-list" role="list" aria-label="Trips for this job">{view.trips.map(trip=><li key={trip.legId}>
      <button type="button" className="secondary" aria-pressed={selected?.legId===trip.legId} disabled={view.busy}
       onClick={async event=>{
        if(!mayReplaceDrafts())return;tripOrigin.current=event.currentTarget;setDismissedRecord(null);
        await action(current=>current.select(trip.legId));setFocusRequest({target:'record'});
       }}>{labels[trip.purpose]} · {format(trip.departedAt)}</button>
      <p>{trip.state==='open'?'In progress':trip.state==='cancelled'?'Cancelled':'Ended'} · {distance[trip.distanceStatus]}</p>
     </li>)}</ul>
     {view.hasMore&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action(current=>current.moreTrips())}>Load more trips</button>}
    </section>}
    {!showingRecord&&<section className="home-panel mileage-guide" aria-label="Mileage selection guidance"><h2>Review one journey</h2><p>Choose a trip to review its recorded distance, source and job attribution.</p><p className="field-help">Missing mileage stays unresolved until evidence is saved.</p></section>}
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

function DepartureEditor({departure,timezone,disabled,hasMileage,save,draftChanged}:{
 departure:LoadedMobileDeparture;timezone:string;disabled:boolean;hasMileage:boolean;save:(body:MobileDepartureSave['body'],id:string)=>void;draftChanged:(id:string,dirty:boolean)=>void;
}){
 const id=useId(),[correctedAt,setCorrectedAt]=useState(''),[issue,setIssue]=useState('');
 const format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,dateStyle:'medium',timeStyle:'medium'});
 const when=(instant:string)=>format.format(new Date(instant));
 useEffect(()=>()=>draftChanged(id,false),[draftChanged,id]);
 return <details className="mileage-correction">
  <summary>Correct departure time</summary>
  <form className="field-work-form" onChange={()=>draftChanged(id,true)} onSubmit={event=>{
   event.preventDefault();
   try{
    const reason=String(new FormData(event.currentTarget).get('reason')??'');
    if(!correctedAt||correctedAt===departure.departedAt||departure.arrivedAt&&correctedAt>departure.arrivedAt)throw Error();
    const body=parseWorkCorrectionBody({correctedAt,reason});
    setIssue('');save(body,id);
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
