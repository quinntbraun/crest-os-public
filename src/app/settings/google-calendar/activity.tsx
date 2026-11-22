'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createCalendarActivitySource,CalendarActivityReadError} from '../../../client/calendar-activity';
import type {CalendarActivityCursor,CalendarActivityPage} from '../../../client/calendar-activity';
import {customerUuid} from '../../../customer/customer-contract';
import {calendarRangeLabel} from '../../../client/schedule-calendar';
import {calendarJobStatusLabel,SyntheticCalendarJobStatus} from './job-status';
import {AuthenticationError} from '../../../client/authentication';

type Dates=Readonly<{fromDate:string;throughDate:string}>;
type FocusRequest=Readonly<{target:'list'|'selected'|'feedback';trigger?:HTMLElement}>;
const readActivity=createCalendarActivitySource();
function locationDates():Dates|undefined {
 if(typeof window==='undefined')return;
 const params=new URL(window.location.href).searchParams;
 if(!params.has('activityFrom')&&!params.has('activityThrough'))return;
 return {fromDate:params.get('activityFrom')??'',throughDate:params.get('activityThrough')??''};
}
function locationJob(fallback:string|null){
 if(typeof window==='undefined')return fallback;
 const value=new URL(window.location.href).searchParams.get('job');return customerUuid(value)?value:null;
}
function updateLocation(job:string|null,dates:Dates|undefined,method:'push'|'replace'){
 const url=new URL(window.location.href);if(url.pathname!=='/settings/google-calendar')return;
 if(job)url.searchParams.set('job',job);else url.searchParams.delete('job');
 if(dates){url.searchParams.set('activityFrom',dates.fromDate);url.searchParams.set('activityThrough',dates.throughDate);}
 const target=url.pathname+url.search;if(target===window.location.pathname+window.location.search)return;
 if(method==='push')window.history.pushState(null,'',target);else window.history.replaceState(null,'',target);
}
export function CalendarAppointmentActivity({initialJobId,recoveryEpoch,onAccessDenied,simulated=true}:{initialJobId:string|null;recoveryEpoch:string;onAccessDenied?:()=>void;simulated?:boolean}){
 const [page,setPage]=useState<CalendarActivityPage|null>(null),pageRef=useRef<CalendarActivityPage|null>(null);
 const [fields,setFields]=useState<Dates>(()=>locationDates()??{fromDate:'',throughDate:''});
 const [filtersOpen,setFiltersOpen]=useState(false);
 const [selected,setSelected]=useState(()=>locationJob(initialJobId)),selectedRef=useRef(selected);
 const [busy,setBusy]=useState(true),[message,setMessage]=useState('Loading appointment activity…');
 const [cursor,setCursor]=useState<CalendarActivityCursor|null>(null),[previous,setPrevious]=useState<readonly (CalendarActivityCursor|null)[]>([]);
 const [focusRequest,setFocusRequest]=useState<FocusRequest|null>(()=>locationJob(initialJobId)?{target:'selected'}:null),consumedFocus=useRef<FocusRequest|null>(null);
 const active=useRef<AbortController|null>(null),directory=useRef<HTMLHeadingElement>(null),feedback=useRef<HTMLParagraphElement>(null),inspector=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null);
 const choose=useCallback((id:string|null)=>{selectedRef.current=id;setSelected(id);},[]);
 const load=useCallback(async(dates:Dates|undefined,after:CalendarActivityCursor|null,back:readonly (CalendarActivityCursor|null)[],preserveSelection=false,moveFocus=true,navigation:'push'|'replace'='replace')=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;
  setBusy(true);pageRef.current=null;setPage(null);setMessage('Loading appointment activity…');
  if(!preserveSelection){choose(null);updateLocation(null,undefined,'replace');}
  try{
   const result=await readActivity({epoch:recoveryEpoch,...dates?{dates}:{},...after?{after}:{}},controller.signal);
   if(controller.signal.aborted||active.current!==controller)return;
   pageRef.current=result;setPage(result);setFields(result.dates);setFiltersOpen(false);setCursor(after);setPrevious(back);
   const failures=result.rows.filter(row=>row.status===null).length;
   setMessage(result.rows.length===0?'No saved appointments found in these dates.':`${result.rows.length} appointment${result.rows.length===1?'':'s'} loaded.${failures?' Some sync checks could not be verified.':''}${result.next?' More appointments are available in this range.':''}`);
   updateLocation(selectedRef.current,result.dates,navigation);
   if(moveFocus)setFocusRequest({target:'list'});
  }catch(error){
   if(controller.signal.aborted||active.current!==controller)return;
   if(error instanceof AuthenticationError&&error.kind==='denied'){
    choose(null);setCursor(null);setPrevious([]);
    setFields({fromDate:'',throughDate:''});setFiltersOpen(false);
    setMessage('Sign in again to review appointment activity.');
    onAccessDenied?.();return;
   }
   choose(null);setCursor(null);setPrevious([]);updateLocation(null,undefined,'replace');
   if(error instanceof CalendarActivityReadError&&error.kind==='input')setFiltersOpen(true);
   setMessage(error instanceof CalendarActivityReadError&&error.kind==='input'?'Choose valid dates spanning at most 92 days in the business time zone.':error instanceof CalendarActivityReadError&&error.kind==='changed'?'Appointment or access details changed. Reload the list before reviewing sync.':'Crest could not verify appointment activity. Check access and reload.');
   if(moveFocus)setFocusRequest({target:'feedback'});
  }finally{if(active.current===controller){active.current=null;setBusy(false);}}
 },[choose,recoveryEpoch,onAccessDenied]);
 useEffect(()=>{
  const initial=window.setTimeout(()=>void load(locationDates(),null,[],true,false),0);
  function restore(){
   if(window.location.pathname!=='/settings/google-calendar')return;
   const id=locationJob(null),dates=locationDates(),current=pageRef.current;choose(id);setFocusRequest({target:id?'selected':'list',...!id&&trigger.current?{trigger:trigger.current}:{}});
   if(!current||!dates||dates.fromDate!==current.dates.fromDate||dates.throughDate!==current.dates.throughDate)void load(dates,null,[],true,false);
  }
  window.addEventListener('popstate',restore);
  return()=>{window.clearTimeout(initial);window.removeEventListener('popstate',restore);active.current?.abort();active.current=null;pageRef.current=null;};
 },[choose,load]);
 useLayoutEffect(()=>{
  if(!focusRequest||busy||consumedFocus.current===focusRequest)return;
  const target=focusRequest.target==='selected'?inspector.current?.querySelector<HTMLHeadingElement>('h2'):focusRequest.target==='feedback'?feedback.current:focusRequest.trigger?.isConnected&&focusRequest.trigger.getClientRects().length?focusRequest.trigger:directory.current;
  if(target){target.focus();if(focusRequest.target==='selected')inspector.current?.scrollIntoView({block:'start'});else target.scrollIntoView({block:'nearest'});consumedFocus.current=focusRequest;}
 },[focusRequest,busy,page,selected]);
 const dirty=page!==null&&(fields.fromDate!==page.dates.fromDate||fields.throughDate!==page.dates.throughDate);
 const selectedRow=page?.rows.find(row=>row.job.jobId===selected);
 function close(){choose(null);updateLocation(null,pageRef.current?.dates,'push');setFocusRequest({target:'list',...trigger.current?{trigger:trigger.current}:{}});}
 function cancel(){active.current?.abort();active.current=null;pageRef.current=null;setPage(null);choose(null);setBusy(false);setMessage('Activity loading cancelled. Reload when you are ready.');updateLocation(null,undefined,'replace');setFocusRequest({target:'feedback'});}
 return <section className="calendar-activity-workspace" aria-label="Appointment activity workspace" data-selected={selected!==null}>
  <header><h2>Appointment activity</h2><p className="field-help">{simulated?'Fictional calendar · No events are sent to Google.':'Saved appointments and their confirmed Google Calendar status.'}</p></header>
  <div className="calendar-activity-columns">
   <section className="calendar-directory" aria-label="Appointment activity directory" aria-busy={busy}>
    <h3 ref={directory} tabIndex={-1}>Appointments in range</h3>
    <div className="calendar-activity-tools"><details className="calendar-date-disclosure" open={filtersOpen}>
     <summary aria-disabled={busy} onClick={event=>{event.preventDefault();if(!busy)setFiltersOpen(value=>!value);}}>Dates{page&&<> · {calendarRangeLabel(page.dates,'custom')}</>}</summary>
     <form className="calendar-activity-filters" aria-label="Appointment activity dates" onSubmit={event=>{event.preventDefault();void load(fields,null,[],false,true,'push');}}>
     <label>From date<input type="date" required value={fields.fromDate} onChange={event=>setFields({...fields,fromDate:event.target.value})} disabled={busy}/></label>
     <label>Through date<input type="date" required min={fields.fromDate||undefined} value={fields.throughDate} onChange={event=>setFields({...fields,throughDate:event.target.value})} disabled={busy}/></label>
     <button type="submit" disabled={busy}>Load dates</button>
     </form>
    </details>
    {busy?<button type="button" className="secondary" onClick={cancel}>Cancel loading</button>:<button type="button" className="secondary" aria-label="Reload activity" disabled={dirty} onClick={()=>void load(page?.dates??locationDates(),cursor,previous)}>Reload</button>}
    </div>
    {page&&<p className="field-help">Dates: {page.timezone} · Appointment times: saved time zone.</p>}
    {dirty&&<p className="field-help">Load dates to apply your changed range before paging.</p>}
    <p ref={feedback} tabIndex={-1} role="status" aria-label="Appointment activity status">{message}</p>
    {busy&&<div className="calendar-activity-loading" aria-hidden="true">{[0,1,2].map(key=><div key={key}><div className="workspace-skeleton"/><div className="workspace-skeleton"/></div>)}</div>}
    {page&&<ul className="calendar-activity-list" role="list" aria-label="Appointments in chosen dates">
     {page.rows.map(({job,status})=><li key={job.jobId} className="calendar-activity-row calendar-directory-row">
      <div className="calendar-activity-body"><div className="calendar-activity-heading"><h3><a href={'/settings/google-calendar?'+new URLSearchParams({job:job.jobId,activityFrom:page.dates.fromDate,activityThrough:page.dates.throughDate})} aria-current={selected===job.jobId?'true':undefined} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();trigger.current=event.currentTarget;choose(job.jobId);updateLocation(job.jobId,page.dates,'push');setFocusRequest({target:'selected'});}}>{job.customerName}</a></h3><span className="calendar-activity-state">{status?calendarJobStatusLabel(status.state,simulated):'Check failed'}</span></div>
       <p><time dateTime={job.startAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:job.timezone}).formatRange(new Date(job.startAt),new Date(job.endAt))}</time> · {job.timezone}</p>
       <p className="field-help">{job.vehicleCount} vehicle{job.vehicleCount===1?'':'s'} · Saved job: {job.state.replaceAll('_',' ')}{status?'':' · Reload or open this appointment to check its sync.'}</p>
      </div></li>)}
    </ul>}
    {page&&<p className="field-help">Sync states were checked during this load. Reload to check again.</p>}
    {page&&<nav className="calendar-activity-pagination" aria-label="Appointment activity pages"><button type="button" className="secondary" disabled={busy||dirty||previous.length===0} onClick={()=>void load(page.dates,previous.at(-1)??null,previous.slice(0,-1))}>Previous appointments</button><span>Page {previous.length+1}</span><button type="button" className="secondary" disabled={busy||dirty||!page.next} onClick={()=>void load(page.dates,page.next,[...previous,cursor])}>Next appointments</button></nav>}
   </section>
   {selected&&<div ref={inspector} className="calendar-activity-inspector" aria-busy={busy}><button type="button" className="secondary" onClick={close}>Back to appointment activity</button>
    {busy?<p role="status">Loading appointment activity before checking this visit…</p>:<>
     {selectedRow?<header className="calendar-selected-identity"><p className="eyebrow">Listed appointment</p><h3>{selectedRow.job.customerName}</h3><p><time dateTime={selectedRow.job.startAt}>{new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:selectedRow.job.timezone}).formatRange(new Date(selectedRow.job.startAt),new Date(selectedRow.job.endAt))}</time> · {selectedRow.job.timezone}</p></header>:<p className="field-help">This appointment is outside the loaded page. Open its saved job for full details.</p>}
     <SyntheticCalendarJobStatus key={selected+recoveryEpoch+(selectedRow?.job.appointmentSequence??'')} jobId={selected} recoveryEpoch={recoveryEpoch} simulated={simulated} {...selectedRow?{appointmentSequence:selectedRow.job.appointmentSequence}:{}} {...onAccessDenied?{onAccessDenied}:{}} onReloadActivity={()=>void load(pageRef.current?.dates,null,[])}/>
    </>}
   </div>}
  </div>
 </section>;
}
