'use client';
import {useEffect,useRef,useState} from 'react';
import {createScheduleReader,initialScheduleReadView} from '../../client/schedule-reader';
import {SavedJobDetails} from './job-details';
import {CalendarNavigation} from './calendar-navigation';
import {VehicleCustodyQueue} from './vehicle-custody-queue';
import type {CalendarMode,CalendarRange} from '../../client/schedule-calendar';
function when(value:string,timezone:string){return new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}
export function ScheduleScreen({initialJobId,initialJobVehicleId}:{initialJobId?:string;initialJobVehicleId?:string}){
 const [view,setView]=useState(initialScheduleReadView),[downloadMessage,setDownloadMessage]=useState(''),reader=useRef<ReturnType<typeof createScheduleReader>|null>(null),status=useRef<HTMLParagraphElement>(null),review=useRef<HTMLElement|null>(null),url=useRef<string|null>(null);
 const [fromDate,setFrom]=useState(''),[throughDate,setThrough]=useState('');
 const [calendarMode,setCalendarMode]=useState<CalendarMode>('week');
 function revoke(){if(url.current){URL.revokeObjectURL(url.current);url.current=null;}}
 useEffect(()=>{
  const current=createScheduleReader({change:next=>{setView(next);if(next.dates){setFrom(next.dates.fromDate);setThrough(next.dates.throughDate);}}});reader.current=current;void current.load(undefined,initialJobId).then(()=>{if(initialJobId&&current===reader.current&&current.view().selected?.jobId===initialJobId&&!current.view().selected?.vehicles.some(vehicle=>vehicle.id===initialJobVehicleId))review.current?.focus();});
  const clear=()=>{current.suspend();revoke();setDownloadMessage('');},hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{reader.current=null;current.dispose();revoke();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[initialJobId,initialJobVehicleId]);
 async function action(kind:'load'|'more'|'morePending'|'moreHistory',dates?:{fromDate:string;throughDate:string}){const current=reader.current;if(!current||current.view().busy)return;if(kind==='load'&&!dates)setCalendarMode('week');await(kind==='load'?current.load(dates,dates?undefined:initialJobId):current[kind]());if(current!==reader.current)return;
  // An explicit access retry should recover the requested job after verifying
  // fresh access. A changed date filter continues to show the chosen list.
  if(kind==='load'&&!dates&&initialJobId&&current.view().selected?.jobId===initialJobId){
   if(!current.view().selected?.vehicles.some(vehicle=>vehicle.id===initialJobVehicleId))review.current?.focus();
   return;
  }
  if(kind==='load'||current.view().phase!=='ready')status.current?.focus();else if(kind==='moreHistory')review.current?.focus();}
 function selectCalendar(range:CalendarRange,mode:CalendarMode){const current=reader.current;if(!current||current.view().busy||current.view().phase!=='ready')return;setCalendarMode(mode);setDownloadMessage('');void action('load',range);}
 async function open(jobId:string){const current=reader.current;if(!current)return;setDownloadMessage('');await current.open(jobId);if(current!==reader.current)return;if(current.view().phase==='ready'&&current.view().selected?.jobId===jobId)review.current?.focus();else status.current?.focus();}
 async function download(){
  const current=reader.current,selected=view.selected;if(!current||!selected||view.busy)return;let bytes:Uint8Array<ArrayBuffer>|undefined;
  setDownloadMessage('Checking retained job history…');
  try{
   bytes=await current.archive();if(!bytes||current!==reader.current||current.view().phase!=='ready'||current.view().selected!==selected)throw Error();
   revoke();const copy=url.current=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),link=document.createElement('a');link.href=copy;link.download='crest-job-history.zip';link.hidden=true;document.body.append(link);try{link.click();}finally{link.remove();setTimeout(()=>{if(url.current===copy)revoke();},1000);}
   setDownloadMessage('Saved job history download requested. Check your browser’s downloads. This is not a complete business export or backup.');
  }catch{if(current===reader.current)setDownloadMessage('No file could be prepared. Reload the saved job and try again. History retrieval is limited to 1,000 versions and 8 MiB.');}
  finally{bytes?.fill(0);}
 }
 return <section className="schedule-reader" aria-label="Saved schedule" aria-busy={view.busy}>
  <p ref={status} className="schedule-status" role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to view your schedule</a>}
  {view.phase==='unavailable'&&<><p>Private schedule records stay hidden until access is checked again.</p><button type="button" disabled={view.busy} onClick={()=>void action('load')}>Check schedule access</button><a href="/sign-in">Check sign-in</a></>}
  {view.phase==='ready'&&<>
   <div className="schedule-intro"><p className="field-help">Business time zone: {view.timezone}.</p>{view.supportTripsAvailable&&<a href="/schedule/travel">Standalone travel</a>}</div>
   {view.loaded&&view.dates&&<CalendarNavigation range={view.dates} mode={calendarMode} timezone={view.timezone} jobs={view.rows} incomplete={view.hasMore} busy={view.busy} select={selectCalendar}/>}
   <details className="schedule-custom-range" open={calendarMode==='custom'||!view.loaded}><summary>Custom date range</summary><form aria-label="Schedule date range" onSubmit={event=>{event.preventDefault();selectCalendar({fromDate,throughDate},'custom');}}><div className="schedule-date-fields"><div><label htmlFor="schedule-from">From date</label><input id="schedule-from" type="date" value={fromDate} required disabled={view.busy} onChange={event=>setFrom(event.target.value)}/></div><div><label htmlFor="schedule-through">Through date</label><input id="schedule-through" type="date" value={throughDate} min={fromDate} required disabled={view.busy} onChange={event=>setThrough(event.target.value)}/></div></div><button type="submit" disabled={view.busy}>Load saved schedule</button></form></details>
   {view.loaded&&<div className="schedule-layout"><div>
    <section aria-label="Jobs in selected dates"><h2>Scheduled work</h2>{view.rows.length===0?<p>No saved jobs in this range.</p>:<ul className="customer-list schedule-job-list">{view.rows.map(job=><li key={job.jobId} aria-current={view.selected?.jobId===job.jobId?'true':undefined}><button type="button" className="secondary" disabled={view.busy} aria-label={job.customerName+' · '+(job.state==='cancelled'?'Cancelled':'View job')} onClick={()=>void open(job.jobId)}>{job.customerName}<span aria-hidden="true">{job.state==='cancelled'?'Cancelled':'View job'}</span></button><p><time dateTime={job.startAt}>{when(job.startAt,job.timezone)}</time> – {when(job.endAt,job.timezone)}</p><p className="field-help">{job.vehicleLabels.join(' · ')}{job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}</p></li>)}</ul>}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('more')}>Load more saved jobs</button>}</section>
    <section aria-label="Proposed time changes"><h2>Changes to review</h2><p className="field-help">All dates. A proposed change does not replace the confirmed reservation.</p>{view.pending.length===0?<p>No proposed time changes recorded.</p>:<ul className="customer-list">{view.pending.map(item=><li key={item.head.job.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void open(item.head.job.id)}>Review proposed change · {item.head.confirmationDraft?.customerName??'Saved job'}</button><p>Proposed {when(item.head.latestAppointment.start_at,item.head.latestAppointment.timezone)}</p><p className="field-help">Confirmed {when(item.head.appointment.start_at,item.head.appointment.timezone)}</p></li>)}</ul>}{view.pendingHasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('morePending')}>Load more proposed changes</button>}</section>
   </div><section className="schedule-detail" aria-label="Job review" ref={review} tabIndex={-1}>{view.selected?<SavedJobDetails resources={view.selected} {...view.selected.jobId===initialJobId&&initialJobVehicleId?{initialJobVehicleId}:{}} history={view.history} historyComplete={view.historyComplete} busy={view.busy} canChange={!view.writesPaused} completionAvailable={view.jobCompletionAvailable===true} invoiceDraftsAvailable={view.invoiceDraftsAvailable===true} googleCalendarAvailable={view.googleCalendarAvailable===true} mileageAvailable={view.jobMileageAvailable===true} workTimeAvailable={view.workTimeAvailable===true} dropoffCustodyAvailable={view.dropoffCustodyAvailable===true} pickupTripsAvailable={view.pickupTripsAvailable===true} pickupWorkAvailable={view.pickupWorkAvailable===true} pickupCollectionAvailable={view.pickupCollectionAvailable===true} pickupPhotosAvailable={view.pickupPhotosAvailable===true} pickupReleaseAvailable={view.pickupReleaseAvailable===true} onWorkStatus={view.fieldSessionAvailable===true?()=>window.location.assign("/schedule/work?job="+encodeURIComponent(view.selected!.jobId)):undefined} onChangeAppointment={()=>window.location.assign("/schedule/change?job="+encodeURIComponent(view.selected!.jobId)+"&kind=reschedule")} onCancel={()=>window.location.assign("/schedule/change?job="+encodeURIComponent(view.selected!.jobId)+"&kind=cancel")} onDownload={()=>void download()} onMoreHistory={()=>void action('moreHistory')}/>:<p>Select a saved job to review its vehicles, location, work and history.</p>}{downloadMessage&&<p role="status" aria-label="Job download status">{downloadMessage}</p>}</section></div>}
   {(view.dropoffCustodyAvailable||view.pickupReturnsAvailable)&&<div className="schedule-custody-tools">
    {view.dropoffCustodyAvailable&&<VehicleCustodyQueue key="dropoff" kind="dropoff" timezone={view.timezone}/>}
    {view.pickupReturnsAvailable&&<VehicleCustodyQueue key="pickup" kind="pickup" timezone={view.timezone}/>}
   </div>}
  </>}
  <nav aria-label="Schedule tools"><a href="/schedule/modes">Service arrangements</a><a href="/quotes">Accepted quote scope</a><a href="/appointment-holds">Unconfirmed appointment proposals</a><a href="/save-review">Interrupted saves</a></nav>
 </section>;
}
