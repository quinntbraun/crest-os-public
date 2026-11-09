'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {createMileageController,initialMileageView} from '../../../client/mileage-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import {mileageShareFraction,mileageSharePercent,prepareMileageBody} from '../../../operations/mileage';
import type {MileageBody,MileageTrip} from '../../../operations/mileage';
import type {MileageHistoryPage} from '../../../operations/mileage-history';
import {calendarToday} from '../../../client/schedule-calendar';
import {MileageAttribution} from './attribution';
import type {FindMileageJobs,MileageShareDraft} from './attribution';

const labels:Record<MileageTrip['purpose'],string>={
 mobile_work_site:'Travel to job',supply:'Supply trip',between_jobs:'Between jobs',return_to_base:'Return to base',
 pickup:'Vehicle pickup',to_work_site:'Travel to work site',return_to_customer:'Vehicle return',other:'Other trip'
};
const distance:Record<MileageTrip['distanceStatus'],string>={
 unresolved:'Mileage unresolved',estimated:'Estimate recorded',confirmed_actual:'Actual mileage recorded',needs_review:'Mileage needs review'
};
const sources:Record<MileageBody['source'],string>={manual_actual:'Actual miles',odometer:'Odometer readings',route_estimate:'Route estimate'};
const kind='operations.mileage.record';
const value=(row:Readonly<Record<string,unknown>>|undefined,key:string)=>typeof row?.[key]==='string'?row[key]:'';

function MileageForm({trip,history,jobId,timezone,disabled,findJobs,save}:{
 trip:MileageTrip;history:MileageHistoryPage;jobId:string;timezone:string;disabled:boolean;
 findJobs:FindMileageJobs;save:(body:MileageBody)=>void;
}){
 const id=useId(),latest=history.evidence.at(-1),recorded=history.allocations.filter(row=>row.evidence_id===latest?.id);
 const [source,setSource]=useState<MileageBody['source']>(trip.state==='open'?'route_estimate':(latest?.source as MileageBody['source']??'manual_actual'));
 const [error,setError]=useState('');
 const [allocation,setAllocation]=useState(recorded.length?'preserve':'none');
 const [shares,setShares]=useState<readonly MileageShareDraft[]>(()=>recorded.map((row,index)=>({
  jobId:String(row.job_id),label:row.job_id===jobId?'This job':'Previously allocated job '+(index+1),
  percent:mileageSharePercent(String(row.fraction))
 })));
 const correction=trip.evidenceVersion!=='0';
 return <form className="field-work-form" onSubmit={event=>{
  event.preventDefault();
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
   setError('');save(body);
  }catch{setError('Use up to four decimal places, enter both odometer readings, or give the source of an estimate. Check the fields shown above.');}
 }}>
  <fieldset disabled={disabled}>
   <legend>{correction?'Correct mileage':'Record mileage'}</legend>
   {trip.state==='open'&&<p>Record an estimate now. Actual mileage can be entered after the trip ends.</p>}
   <label htmlFor={id+'-source'}>Distance source</label>
   <select id={id+'-source'} value={source} onChange={event=>setSource(event.target.value as MileageBody['source'])}>
    {trip.state!=='open'&&<><option value="manual_actual">Actual miles</option><option value="odometer">Odometer readings</option></>}
    <option value="route_estimate">Route estimate</option>
   </select>
   {source==='manual_actual'&&<><label htmlFor={id+'-actual'}>Actual miles</label>
    <input id={id+'-actual'} name="actual" inputMode="decimal" required defaultValue={value(latest,'actual_miles')}/></>}
   {source==='odometer'&&<>
    <label htmlFor={id+'-start'}>Starting odometer</label><input id={id+'-start'} name="start" inputMode="decimal" required defaultValue={value(latest,'odometer_start')}/>
    <label htmlFor={id+'-end'}>Ending odometer</label><input id={id+'-end'} name="end" inputMode="decimal" required defaultValue={value(latest,'odometer_end')}/>
   </>}
   {source==='manual_actual'&&value(latest,'odometer_start')!==''&&<details><summary>Existing odometer readings</summary>
    <label htmlFor={id+'-start'}>Starting odometer</label><input id={id+'-start'} name="start" inputMode="decimal" defaultValue={value(latest,'odometer_start')}/>
    <label htmlFor={id+'-end'}>Ending odometer</label><input id={id+'-end'} name="end" inputMode="decimal" defaultValue={value(latest,'odometer_end')}/>
   </details>}
   {source==='route_estimate'?<>
    <label htmlFor={id+'-estimate'}>Estimated miles</label><input id={id+'-estimate'} name="estimate" inputMode="decimal" required defaultValue={value(latest,'estimate_miles')}/>
    <label htmlFor={id+'-estimate-source'}>Where the estimate came from</label><input id={id+'-estimate-source'} name="estimateSource" maxLength={1000} required defaultValue={value(latest,'estimate_source')}/>
   </>:<details><summary>Optional route estimate</summary>
    <label htmlFor={id+'-estimate'}>Estimated miles</label><input id={id+'-estimate'} name="estimate" inputMode="decimal" defaultValue={value(latest,'estimate_miles')}/>
    <label htmlFor={id+'-estimate-source'}>Where the estimate came from</label><input id={id+'-estimate-source'} name="estimateSource" maxLength={1000} defaultValue={value(latest,'estimate_source')}/>
   </details>}
   <label htmlFor={id+'-movement'}>Type of travel</label>
   <select id={id+'-movement'} name="movement" defaultValue={value(latest,'movement_kind')||'unclassified'}>
    <option value="unclassified">Unclassified</option><option value="business_rig">Business rig</option>
    <option value="customer_vehicle">Customer vehicle</option><option value="personal">Personal</option>
   </select>
   <label htmlFor={id+'-allocation'}>Job attribution</label>
   <select id={id+'-allocation'} value={allocation} onChange={event=>{setAllocation(event.target.value);setError('');}}>
    {recorded.length>0&&<option value="preserve">Keep recorded allocation</option>}
    <option value="none">Unallocated</option>{jobId&&<option value="job">Allocate to this job</option>}
    <option value="split">{jobId?'Split across jobs':'Allocate to saved jobs'}</option>
   </select>
   {allocation==='split'&&<MileageAttribution jobId={jobId} day={calendarToday(timezone,new Date(trip.departedAt))}
    timezone={timezone} shares={shares} change={next=>{setShares(next);setError('');}} findJobs={findJobs}/>}
   <label htmlFor={id+'-notes'}>Notes (optional)</label>
   <textarea id={id+'-notes'} name="notes" maxLength={2000} rows={2} defaultValue={value(latest,'notes')}/>
   {correction&&<><label htmlFor={id+'-reason'}>Reason for correction</label><textarea id={id+'-reason'} name="reason" maxLength={1000} rows={2} required/></>}
   {error&&<p role="alert">{error}</p>}
   <button type="submit">{correction?'Save correction':'Save mileage'}</button>
  </fieldset>
 </form>;
}

export function MileageScreen({jobId,legId}:{jobId:string;legId:string}){
 const [view,setView]=useState(initialMileageView),controller=useRef<ReturnType<typeof createMileageController>|null>(null);
 const [downloadMessage,setDownloadMessage]=useState('');
 const downloadUrl=useRef<string|null>(null);
 const status=useRef<HTMLParagraphElement>(null);
 const revoke=useCallback(()=>{
  if(downloadUrl.current)URL.revokeObjectURL(downloadUrl.current);
  downloadUrl.current=null;
 },[]);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const current=createMileageController({jobId,legId,store:createPendingSchedulingStore(storage,kind),
   blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(key=>key!==kind).map(key=>createPendingSchedulingStore(storage,key)),change:setView});
  controller.current=current;void current.load();
  const leave=()=>{current.suspend();revoke();setDownloadMessage('');};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);document.addEventListener('visibilitychange',hidden);
  return()=>{controller.current=null;current.dispose();revoke();window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',hidden);};
 },[jobId,legId,revoke]);
 async function action(run:(current:NonNullable<typeof controller.current>)=>Promise<void>){
  const current=controller.current;if(!current)return;
  setDownloadMessage('');
  await run(current);if(controller.current===current)status.current?.focus();
 }
 const {selected,history}=view;
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
 return <section aria-label="Saved trip mileage" aria-busy={view.busy}>
  <p className="job-change-status" ref={status} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view mileage</a>}
  {(view.phase==='review'||view.phase==='unavailable')&&<button type="button" disabled={view.busy} onClick={()=>void action(current=>current.load())}>Reload saved trips</button>}
  {view.phase==='pending'&&<>
   {view.reference&&<p className="save-reference">Original mileage reference <code>{view.reference}</code></p>}
   <button type="button" disabled={view.busy} onClick={()=>void action(current=>current.check())}>Check original mileage</button>
  </>}
  {view.phase==='ready'&&<>
   {!view.canSave&&<p>Changes are paused. Saved mileage is available for review.</p>}
   {!legId&&view.trips.length>0&&<ul className="mileage-trip-list" role="list" aria-label="Trips for this job">{view.trips.map(trip=><li key={trip.legId}>
    <button type="button" className="secondary" aria-pressed={selected?.legId===trip.legId} disabled={view.busy}
     onClick={()=>void action(current=>current.select(trip.legId))}>{labels[trip.purpose]} · {format(trip.departedAt)}</button>
    <p>{trip.state==='open'?'In progress':trip.state==='cancelled'?'Cancelled':'Ended'} · {distance[trip.distanceStatus]}{selected?.legId===trip.legId?' · Selected':''}</p>
   </li>)}</ul>}
   {view.hasMore&&<button type="button" disabled={view.busy} onClick={()=>void action(current=>current.moreTrips())}>Load more trips</button>}
   {selected&&history&&<>
    <section aria-label="Saved mileage history">
     <h2>Saved mileage history</h2>
     <p>{labels[selected.purpose]} · {format(selected.departedAt)}</p>
     {history.evidence.length===0?<p>No mileage has been saved for this trip.</p>:<ul>{[...history.evidence].reverse().map(row=><li key={String(row.id)}>
      <strong>Version {String(row.sequence)}</strong> · {sources[row.source as MileageBody['source']]}
      {row.actual_miles!==null&&<> · {String(row.actual_miles)} actual miles</>}
      {row.estimate_miles!==null&&<> · {String(row.estimate_miles)} estimated miles</>}
      {row.reason!==null&&<p>{String(row.reason)}</p>}
      <SavedAttribution history={history} evidenceId={String(row.id)} currentJob={jobId} state={String(row.allocation_state)}/>
     </li>)}</ul>}
     <div className="mileage-history-actions">
      {history.afterVersion!=='0'&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void action(current=>current.older())}>Load earlier versions</button>}
      {history.evidence.length>0&&<button className="secondary" type="button" disabled={view.busy} onClick={()=>void downloadHistory()}>Download loaded history (CSV + JSON)</button>}
     </div>
     {history.evidence.length>0&&<p>Includes the versions shown here, with their allocation and audit records.</p>}
     {downloadMessage&&<p role="status" aria-label="Mileage download status">{downloadMessage}</p>}
    </section>
    {view.canSave&&history.throughVersion===selected.evidenceVersion&&
     <MileageEditor trip={selected} history={history} jobId={jobId} timezone={view.timezone} disabled={view.busy}
      findJobs={async(day,after)=>controller.current?.findJobs(day,after)}
      save={body=>void action(current=>current.save(body))}/>}
   </>}
  </>}
  <nav className="work-links" aria-label="Related mileage pages">
   {jobId&&<a href={'/schedule?job='+encodeURIComponent(jobId)}>Saved job</a>}
   {legId&&<a href="/schedule/travel">Standalone travel</a>}
   <a href="/schedule">Schedule</a>
   <a href={'/save-review?kind='+kind}>Interrupted saves</a>
  </nav>
 </section>;
}

function SavedAttribution({history,evidenceId,currentJob,state}:{history:MileageHistoryPage;evidenceId:string;currentJob:string;state:string}){
 const shares=history.allocations.filter(row=>row.evidence_id===evidenceId);
 if(!shares.length)return <p>Unallocated</p>;
 return <details className="mileage-saved-attribution">
  <summary>{state==='draft'?'Draft job attribution':'Job attribution'} · {shares.length} {shares.length===1?'job':'jobs'}</summary>
  <ul>{shares.map((row,index)=><li key={String(row.id)}>
   {mileageSharePercent(String(row.fraction))}% · {row.job_id===currentJob?'This job':
    <a href={'/schedule?job='+encodeURIComponent(String(row.job_id))}>Open allocated job {index+1}</a>}
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
