'use client';
import {SignInLink} from "../sign-in-link";

import {ScheduleLink,ScheduleNavigationProvider,useScheduleNavigation} from './navigation';
import {scheduleNavigationHref} from '../../client/schedule-navigation';

import {useEffect,useRef,useState} from 'react';
import {createScheduleReader,initialScheduleReadView} from '../../client/schedule-reader';
import {observeInitialReadDeparture} from '../../client/initial-read-departure';
import {SavedJobDetails} from './job-details';
import {CalendarNavigation} from './calendar-navigation';
import {ScheduleAgenda} from './agenda';
import {VehicleCustodyQueue} from './vehicle-custody-queue';
import {calendarRange,calendarToday,moveCalendarRange} from '../../client/schedule-calendar';
import type {CalendarMode,CalendarRange} from '../../client/schedule-calendar';
// Install when this client module evaluates, before the initial React effect.
const initialReadDeparture=typeof window==='undefined'?null:observeInitialReadDeparture(window);
function when(value:string,timezone:string){return new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));}
export function ScheduleScreen({initialJobId,initialJobVehicleId,visitsSource}:{initialJobId?:string;initialJobVehicleId?:string;visitsSource?:'customer'|'vehicle'}){
 const initialNavigation=useScheduleNavigation();
 const pendingReturn=useRef(initialNavigation?.focusJobId);
 const [navigationFocus,setNavigationFocus]=useState(initialNavigation?.focusJobId);
 const [navigationOrigin,setNavigationOrigin]=useState<{originY:number;originWidth:number}|null>(initialNavigation?.originY!==undefined&&initialNavigation.originWidth!==undefined?{originY:initialNavigation.originY,originWidth:initialNavigation.originWidth}:null);
 const [view,setView]=useState(initialScheduleReadView),[downloadMessage,setDownloadMessage]=useState(''),reader=useRef<ReturnType<typeof createScheduleReader>|null>(null),status=useRef<HTMLParagraphElement>(null),review=useRef<HTMLElement|null>(null),url=useRef<string|null>(null);
 const [fromDate,setFrom]=useState(initialNavigation?.fromDate??''),[throughDate,setThrough]=useState(initialNavigation?.throughDate??'');
 const [calendarMode,setCalendarMode]=useState<CalendarMode>(initialNavigation?.mode??'week');
 const [rangeOpen,setRangeOpen]=useState(initialNavigation?.rangeOpen??false);
 const [calendarOpen,setCalendarOpen]=useState(initialNavigation?.calendarOpen??false),[reviewing,setReviewing]=useState(false);
 const agendaSource=useRef<{button:HTMLButtonElement;scrollY:number;width:number}|null>(null),restoreAgendaFocus=useRef(false);
 const mobileBack=useRef<HTMLButtonElement>(null),jobHeading=useRef<HTMLHeadingElement>(null);
 const calendarToggle=useRef<HTMLButtonElement>(null),agendaHeading=useRef<HTMLHeadingElement>(null);
 const calendarPanel=useRef<HTMLDivElement>(null);
 const focusPlanner=useRef(false);
 const linkedJob=initialJobId!==undefined;
 const selected=linkedJob&&view.selected?.jobId!==initialJobId?null:view.selected;
 const navigationDates=view.dates??initialNavigation;
 const navigation=navigationDates?{fromDate:navigationDates.fromDate,throughDate:navigationDates.throughDate,mode:calendarMode,calendarOpen,rangeOpen,
  ...selected?{focusJobId:selected.jobId}:navigationFocus?{focusJobId:navigationFocus}:{},
  ...navigationOrigin??{}}:null;
 useEffect(()=>{
  if(linkedJob||!pendingReturn.current||view.busy||view.phase!=='ready'||!view.loaded)return;
  const button=agendaHeading.current?.closest('section')?.querySelector<HTMLButtonElement>('[data-schedule-job="'+pendingReturn.current+'"]');
  if(!button){agendaHeading.current?.focus();if(!view.hasMore)pendingReturn.current=undefined;return;}
  pendingReturn.current=undefined;
  const sameWidth=initialNavigation?.originWidth===window.innerWidth&&initialNavigation.originY!==undefined;
  button.focus({preventScroll:sameWidth});
  if(sameWidth){
   window.scrollTo({top:initialNavigation.originY,behavior:'instant'});
   const box=button.getBoundingClientRect(),clearance=parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd)||0;
   // Layout edges can differ from the browser's rounded scroll offset by a fraction of a CSS pixel.
   if(Math.round(box.top)<0||Math.round(box.bottom)>Math.round(innerHeight-clearance))button.scrollIntoView({block:'center',behavior:'instant'});
  }
 },[initialNavigation,linkedJob,view.busy,view.loaded,view.phase,view.rows,view.hasMore]);
 useEffect(()=>{
  if(initialJobId&&view.phase==='ready'&&selected?.jobId===initialJobId&&!selected.vehicles.some(vehicle=>vehicle.id===initialJobVehicleId)){
   jobHeading.current?.focus({preventScroll:true});
  }
 },[initialJobId,initialJobVehicleId,selected,view.phase]);
 useEffect(()=>{
  if(!linkedJob&&reviewing&&selected){
   if(mobileBack.current?.getClientRects().length){
    mobileBack.current.focus({preventScroll:true});
    review.current?.scrollIntoView({block:'start',behavior:'instant'});
   }else jobHeading.current?.focus();
  }else if(restoreAgendaFocus.current){
   restoreAgendaFocus.current=false;
   const origin=agendaSource.current;
   if(origin?.button.isConnected){
    const sameWidth=origin.width===window.innerWidth;
    origin.button.focus({preventScroll:sameWidth});
    if(sameWidth)window.scrollTo({top:origin.scrollY,behavior:'instant'});
   }
  }
 },[linkedJob,reviewing,selected]);
 useEffect(()=>{
  if(!focusPlanner.current||view.busy)return;
  focusPlanner.current=false;
  if(view.phase==='ready'&&view.loaded&&calendarToggle.current?.getClientRects().length){
   (calendarOpen?calendarToggle.current:agendaHeading.current)?.focus();
  }else if(view.phase==='ready'&&view.loaded){
   const mode=calendarPanel.current?.querySelector<HTMLButtonElement>('.calendar-toolbar button[aria-pressed="true"]');
   (mode??agendaHeading.current??status.current)?.focus();
  }else status.current?.focus();
 },[calendarOpen,view.busy,view.loaded,view.phase]);
 function revoke(){if(url.current){URL.revokeObjectURL(url.current);url.current=null;}}
 useEffect(()=>{
  const current=createScheduleReader({change:next=>{setView(next);if(next.dates){setFrom(next.dates.fromDate);setThrough(next.dates.throughDate);}}});
  reader.current=current;
  const clear=()=>{focusPlanner.current=false;pendingReturn.current=undefined;setNavigationFocus(undefined);setNavigationOrigin(null);current.suspend();revoke();setDownloadMessage('');setReviewing(false);agendaSource.current=null;restoreAgendaFocus.current=false;},hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  if(document.visibilityState==='hidden'||initialReadDeparture?.canStart()===false)clear();else void current.load(initialNavigation??undefined,initialJobId);
  return()=>{reader.current=null;current.dispose();revoke();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[initialJobId,initialNavigation]);
 async function action(kind:'load'|'more'|'morePending'|'moreHistory',dates?:{fromDate:string;throughDate:string}){
  const current=reader.current;
  if(!current||current.view().busy)return;
  if(kind==='load'){
   focusPlanner.current=!linkedJob;
   setReviewing(false);
   if(!dates&&!view.dates&&!initialNavigation)setCalendarMode('week');
  }
  await(kind==='load'?current.load(dates??view.dates??initialNavigation??undefined,initialJobId):current[kind]());
  if(current!==reader.current)return;
  if(kind==='load'&&!linkedJob)return;
  if(kind==='load'&&linkedJob&&current.view().selected)return;
  if(kind==='load'||current.view().phase!=='ready')status.current?.focus();
  else if(kind==='moreHistory')review.current?.focus();
 }
 function selectCalendar(range:CalendarRange,mode:CalendarMode){const current=reader.current;if(!current||current.view().busy||current.view().phase!=='ready')return;pendingReturn.current=undefined;setNavigationFocus(undefined);setNavigationOrigin(null);setCalendarMode(mode);setRangeOpen(mode==='custom');setDownloadMessage('');void action('load',range);}
 async function open(jobId:string,source:HTMLButtonElement){
  const current=reader.current;if(!current||current.view().busy)return;
  const origin={button:source,scrollY:window.scrollY,width:window.innerWidth};
  setDownloadMessage('');
  await current.open(jobId);
  if(current!==reader.current)return;
  if(current.view().phase==='ready'&&current.view().selected?.jobId===jobId){
   agendaSource.current=origin;setNavigationFocus(jobId);setNavigationOrigin({originY:origin.scrollY,originWidth:origin.width});
   setReviewing(true);
  }else status.current?.focus();
 }
 function backToAgenda(){
  restoreAgendaFocus.current=true;
  setReviewing(false);
 }
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
 const jobReview=<section className="schedule-detail" aria-label="Job review" ref={review} tabIndex={-1}>
  {!linkedJob&&selected&&<button type="button" className="secondary schedule-mobile-back" ref={mobileBack} onClick={backToAgenda}>Back to agenda</button>}
  {selected?<SavedJobDetails resources={selected} headingRef={jobHeading}
   {...selected.jobId===initialJobId&&initialJobVehicleId?{initialJobVehicleId}:{}}
   {...selected.jobId===initialJobId&&visitsSource?{visitsSource}:{}}
   history={view.history} historyComplete={view.historyComplete} busy={view.busy} canChange={!view.writesPaused}
   completionAvailable={view.jobCompletionAvailable===true} invoiceDraftsAvailable={view.invoiceDraftsAvailable===true}
   googleCalendarAvailable={view.googleCalendarAvailable===true} mileageAvailable={view.jobMileageAvailable===true} workTimeAvailable={view.workTimeAvailable===true}
   dropoffCustodyAvailable={view.dropoffCustodyAvailable===true} pickupTripsAvailable={view.pickupTripsAvailable===true}
   pickupWorkAvailable={view.pickupWorkAvailable===true} pickupCollectionAvailable={view.pickupCollectionAvailable===true}
   pickupPhotosAvailable={view.pickupPhotosAvailable===true} pickupReleaseAvailable={view.pickupReleaseAvailable===true}
   onWorkStatus={view.fieldSessionAvailable===true&&selected.head.job.operator_actor_id===view.operatorId?()=>window.location.assign(scheduleNavigationHref('/schedule/work?job='+encodeURIComponent(selected.jobId),navigation)):undefined}
   onChangeAppointment={()=>window.location.assign(scheduleNavigationHref('/schedule/change?job='+encodeURIComponent(selected.jobId)+'&kind=reschedule',navigation))}
   onCancel={()=>window.location.assign(scheduleNavigationHref('/schedule/change?job='+encodeURIComponent(selected.jobId)+'&kind=cancel',navigation))}
   onDownload={()=>void download()} onMoreHistory={()=>void action('moreHistory')}/>:
   linkedJob?<ScheduleLink className="primary-action" href="/schedule">Open Schedule</ScheduleLink>:<p>Select a saved job to review its vehicles, location, work and history.</p>}
  {downloadMessage&&<p role="status" aria-label="Job download status">{downloadMessage}</p>}
 </section>;
 const previous=view.dates?moveCalendarRange(view.dates,calendarMode,-1):null;
 const next=view.dates?moveCalendarRange(view.dates,calendarMode,1):null;
 const todayMode=calendarMode==='custom'?'day':calendarMode;
 return <ScheduleNavigationProvider context={navigation}><section className="schedule-reader" aria-label={linkedJob?'Saved visit':'Saved schedule'} aria-busy={view.busy}
  data-reviewing={!linkedJob&&reviewing&&!!selected||undefined}
  data-agenda-loaded={!linkedJob&&view.phase==='ready'&&view.loaded||undefined}>
  <p ref={status} className={'schedule-status'+(linkedJob&&selected?' visually-hidden':'')} role="status" tabIndex={-1}>{view.message}</p>
  {view.phase==='loading'&&<div aria-hidden="true" className="schedule-loading">
   <div className={'workspace-skeleton '+(linkedJob?'schedule-loading-job':'schedule-loading-calendar')}/>
   <div className="workspace-skeleton"/>
   <div className="workspace-skeleton"/>
  </div>}
  {view.phase==='signed-out'&&<ScheduleLink className="primary-action" href={'/sign-in?returnTo=schedule'+(initialJobId?'&job='+encodeURIComponent(initialJobId):'')}>Sign in to view your schedule</ScheduleLink>}
  {view.phase==='unavailable'&&<><p>Private schedule records stay hidden until access is checked again.</p><button type="button" disabled={view.busy} onClick={()=>void action('load')}>Check schedule access</button><SignInLink returnTo="schedule">Check sign-in</SignInLink></>}
  {view.phase==='ready'&&linkedJob&&jobReview}
  {view.phase==='ready'&&!linkedJob&&<>
   <div className="schedule-intro"><p className="field-help">Business time zone: {view.timezone}.</p>{view.supportTripsAvailable&&<ScheduleLink href="/schedule/travel">Standalone travel</ScheduleLink>}</div>
   <div className="schedule-planner"><div className="schedule-planner-nav">
   {view.loaded&&view.dates&&<>
    <div className="schedule-mobile-controls" role="group" aria-label="Agenda navigation">
     <button type="button" className="secondary" aria-label="Previous agenda period" disabled={view.busy||!previous} onClick={()=>{if(previous)selectCalendar(previous,calendarMode);}}>Previous</button>
     <button type="button" className="secondary" aria-label="Today in agenda" disabled={view.busy} onClick={()=>selectCalendar(calendarRange(calendarToday(view.timezone),todayMode),todayMode)}>Today</button>
     <button type="button" className="secondary" aria-label="Next agenda period" disabled={view.busy||!next} onClick={()=>{if(next)selectCalendar(next,calendarMode);}}>Next</button>
     <button type="button" className="secondary schedule-calendar-toggle" ref={calendarToggle} aria-expanded={calendarOpen} aria-controls="schedule-calendar-panel" onClick={()=>setCalendarOpen(!calendarOpen)}>{calendarOpen?'Hide calendar':'Calendar'}</button>
    </div>
    <div id="schedule-calendar-panel" ref={calendarPanel} className="schedule-calendar-panel" data-open={calendarOpen}>
     <CalendarNavigation range={view.dates} mode={calendarMode} timezone={view.timezone} jobs={view.rows} incomplete={view.hasMore}
      busy={view.busy} select={selectCalendar} showDay={range=>{setCalendarOpen(false);selectCalendar(range,'day');}}/>
    </div>
   </>}
   <details className="schedule-custom-range" open={rangeOpen||!view.loaded} onToggle={event=>{if(view.loaded)setRangeOpen(event.currentTarget.open);}}><summary>Custom date range</summary><form aria-label="Schedule date range" onSubmit={event=>{event.preventDefault();selectCalendar({fromDate,throughDate},'custom');}}><div className="schedule-date-fields"><div><label htmlFor="schedule-from">From date</label><input id="schedule-from" type="date" value={fromDate} required disabled={view.busy} onChange={event=>setFrom(event.target.value)}/></div><div><label htmlFor="schedule-through">Through date</label><input id="schedule-through" type="date" value={throughDate} min={fromDate} required disabled={view.busy} onChange={event=>setThrough(event.target.value)}/></div></div><button type="submit" disabled={view.busy}>Load saved schedule</button></form></details>
   </div>{view.loaded&&view.dates&&<div className="schedule-layout"><div className="schedule-list-pane">
    <ScheduleAgenda dates={view.dates} mode={calendarMode} timezone={view.timezone} rows={view.rows} hasMore={view.hasMore}
     busy={view.busy} selectedId={selected?.jobId} open={(id,source)=>void open(id,source)} more={()=>void action('more')} headingRef={agendaHeading}/>
    <section className="schedule-proposals" aria-label="Proposed time changes"><h2>Changes to review</h2><p className="field-help">All dates. A proposed change does not replace the confirmed reservation.</p>{view.pending.length===0?<p>No proposed time changes recorded.</p>:<ul className="customer-list">{view.pending.map(item=><li key={item.head.job.id}><button type="button" className="secondary" disabled={view.busy} onClick={event=>void open(item.head.job.id,event.currentTarget)}>Review proposed change · {item.head.confirmationDraft?.customerName??'Saved job'}</button><p>Proposed {when(item.head.latestAppointment.start_at,item.head.latestAppointment.timezone)}</p><p className="field-help">Confirmed {when(item.head.appointment.start_at,item.head.appointment.timezone)}</p></li>)}</ul>}{view.pendingHasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('morePending')}>Load more proposed changes</button>}</section>
   </div>{selected&&jobReview}</div>}</div>
  </>}
  {view.phase==='ready'&&(!linkedJob||!!selected)&&(view.dropoffCustodyAvailable||view.pickupReturnsAvailable)&&<div className="schedule-custody-tools">
    {view.dropoffCustodyAvailable&&<VehicleCustodyQueue key="dropoff" kind="dropoff" timezone={view.timezone}/>}
    {view.pickupReturnsAvailable&&<VehicleCustodyQueue key="pickup" kind="pickup" timezone={view.timezone}/>}
  </div>}
  {!linkedJob&&<nav aria-label="Schedule tools"><ScheduleLink href="/schedule/modes">Service arrangements</ScheduleLink><ScheduleLink href="/quotes">Accepted quote scope</ScheduleLink><ScheduleLink href="/appointment-holds">Unconfirmed appointment proposals</ScheduleLink><ScheduleLink href="/save-review">Interrupted saves</ScheduleLink></nav>}
 </section></ScheduleNavigationProvider>;
}
