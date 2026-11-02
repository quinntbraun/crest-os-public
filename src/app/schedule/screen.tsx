'use client';
import {useEffect,useRef,useState} from 'react';
import {createScheduleReader,initialScheduleReadView} from '../../client/schedule-reader';
import {SavedJobDetails} from './job-details';
function when(value:string,timezone:string){return new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}
export function ScheduleScreen({initialJobId}:{initialJobId?:string}){
 const [view,setView]=useState(initialScheduleReadView),[downloadMessage,setDownloadMessage]=useState(''),reader=useRef<ReturnType<typeof createScheduleReader>|null>(null),status=useRef<HTMLParagraphElement>(null),review=useRef<HTMLElement|null>(null),url=useRef<string|null>(null);
 const [fromDate,setFrom]=useState(''),[throughDate,setThrough]=useState('');
 function revoke(){if(url.current){URL.revokeObjectURL(url.current);url.current=null;}}
 useEffect(()=>{
  const current=createScheduleReader({change:next=>{setView(next);if(next.dates){setFrom(next.dates.fromDate);setThrough(next.dates.throughDate);}}});reader.current=current;void current.load().then(async()=>{if(initialJobId&&current===reader.current&&current.view().phase==='ready'){await current.open(initialJobId);if(current===reader.current&&current.view().selected?.jobId===initialJobId)review.current?.focus();}});
  const clear=()=>{current.suspend();revoke();setDownloadMessage('');},hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{reader.current=null;current.dispose();revoke();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[initialJobId]);
 async function action(kind:'load'|'more'|'morePending'|'moreHistory',dates?:{fromDate:string;throughDate:string}){const current=reader.current;if(!current)return;await(kind==='load'?current.load(dates):current[kind]());if(current===reader.current){if(kind==='load'||current.view().phase!=='ready')status.current?.focus();else if(kind==='moreHistory')review.current?.focus();}}
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
   <p className="field-help">Business time zone: {view.timezone}. This view shows saved jobs. Book accepted work from its saved quote. Open a saved scheduled job to propose, confirm or cancel its appointment.</p>
   <form aria-label="Schedule date range" onSubmit={event=>{event.preventDefault();setDownloadMessage('');void action('load',{fromDate,throughDate});}}><div className="schedule-date-fields"><div><label htmlFor="schedule-from">From date</label><input id="schedule-from" type="date" value={fromDate} required disabled={view.busy} onChange={event=>setFrom(event.target.value)}/></div><div><label htmlFor="schedule-through">Through date</label><input id="schedule-through" type="date" value={throughDate} min={fromDate} required disabled={view.busy} onChange={event=>setThrough(event.target.value)}/></div></div><button type="submit" disabled={view.busy}>Load saved schedule</button></form>
   {view.loaded&&<div className="schedule-layout"><div>
    <section aria-label="Jobs in selected dates"><h2>Scheduled work</h2>{view.rows.length===0?<p>No saved jobs in this range.</p>:<ul className="customer-list">{view.rows.map(job=><li key={job.jobId}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void open(job.jobId)}>{job.customerName} · {job.state==='cancelled'?'Cancelled':'View job'}</button><p><time dateTime={job.startAt}>{when(job.startAt,job.timezone)}</time> – {when(job.endAt,job.timezone)}</p><p className="field-help">{job.vehicleLabels.join(' · ')}{job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}</p></li>)}</ul>}{view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('more')}>Load more saved jobs</button>}</section>
    <section aria-label="Proposed time changes"><h2>Changes to review</h2><p className="field-help">All dates. A proposed change does not replace the confirmed reservation.</p>{view.pending.length===0?<p>No proposed time changes recorded.</p>:<ul className="customer-list">{view.pending.map(item=><li key={item.head.job.id}><button type="button" className="secondary" disabled={view.busy} onClick={()=>void open(item.head.job.id)}>Review proposed change · {item.head.confirmationDraft?.customerName??'Saved job'}</button><p>Proposed {when(item.head.latestAppointment.start_at,item.head.latestAppointment.timezone)}</p><p className="field-help">Confirmed {when(item.head.appointment.start_at,item.head.appointment.timezone)}</p></li>)}</ul>}{view.pendingHasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('morePending')}>Load more proposed changes</button>}</section>
   </div><section className="schedule-detail" aria-label="Job review" ref={review} tabIndex={-1}>{view.selected?<SavedJobDetails resources={view.selected} history={view.history} historyComplete={view.historyComplete} busy={view.busy} canChange={!view.writesPaused} onChangeAppointment={()=>window.location.assign("/schedule/change?job="+encodeURIComponent(view.selected!.jobId)+"&kind=reschedule")} onCancel={()=>window.location.assign("/schedule/change?job="+encodeURIComponent(view.selected!.jobId)+"&kind=cancel")} onDownload={()=>void download()} onMoreHistory={()=>void action('moreHistory')}/>:<p>Select a saved job to review its vehicles, location, work and history.</p>}{downloadMessage&&<p role="status" aria-label="Job download status">{downloadMessage}</p>}</section></div>}
  </>}
  <nav aria-label="Schedule tools"><a href="/schedule/modes">Service arrangements</a><a href="/quotes">Accepted quote scope</a><a href="/appointment-holds">Unconfirmed appointment proposals</a><a href="/save-review">Interrupted saves</a></nav>
 </section>;
}
