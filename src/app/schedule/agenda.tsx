import {calendarRangeLabel,calendarToday} from '../../client/schedule-calendar';
import type {CalendarMode,CalendarRange} from '../../client/schedule-calendar';
import type {JobSummary} from '../../operations/confirmed-job-read-contract';
import type {Ref} from 'react';
import {loadedAppointmentOverlaps} from '../../client/schedule-agenda-overlaps';

const states={
 scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',
 completed:'Completed',cancelled:'Cancelled',
};
const agendaDay=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'short',day:'numeric'});
function visitTime(job:JobSummary){
 const businessTime=new Intl.DateTimeFormat('en-US',{timeZone:job.timezone,hour:'numeric',minute:'2-digit'});
 const differentDays=calendarToday(job.timezone,new Date(job.startAt))!==calendarToday(job.timezone,new Date(job.endAt));
 const display=differentDays?new Intl.DateTimeFormat('en-US',{timeZone:job.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):businessTime;
 return display.formatRange(new Date(job.startAt),new Date(job.endAt));
}
export function ScheduleAgenda({dates,mode,timezone,rows,hasMore,busy,selectedId,open,more,headingRef}:{
 dates:CalendarRange;mode:CalendarMode;timezone:string;rows:readonly JobSummary[];hasMore:boolean;busy:boolean;
 selectedId?:string|undefined;open:(id:string,source:HTMLButtonElement)=>void;more:()=>void;
 headingRef:Ref<HTMLHeadingElement>;
}){
 const days=new Map<string,JobSummary[]>();
 const overlapping=loadedAppointmentOverlaps(rows);
 for(const job of rows){
  const day=calendarToday(timezone,new Date(job.startAt));
  const group=days.get(day);
  if(group)group.push(job);
  else days.set(day,[job]);
 }
 return <section aria-label="Jobs in selected dates" className="schedule-agenda">
  <h2 ref={headingRef} tabIndex={-1}>Scheduled work</h2>
  <p className="schedule-agenda-range">{calendarRangeLabel(dates,mode)}</p>
  {overlapping.size>0&&<p className="schedule-overlap-note">{overlapping.size} loaded visits have overlapping appointment times. Open a saved job to review its scheduling history.</p>}
  {rows.length===0?<p>No saved jobs in this range.</p>:<div className="schedule-agenda-days">
   {[...days].map(([day,jobs])=><div key={day}>
    {(dates.fromDate!==dates.throughDate||day!==dates.fromDate)&&
     <h3><time dateTime={day}>{agendaDay.format(new Date(day+'T12:00:00Z'))}</time></h3>}
    <ul className="customer-list schedule-job-list">{jobs.map(job=><li key={job.jobId} aria-current={selectedId===job.jobId?'true':undefined}>
     <button type="button" data-schedule-job={job.jobId} className="secondary" disabled={busy}
      aria-label={job.customerName+' · '+states[job.state]+(job.state==='cancelled'?'':' · View job')}
      onClick={event=>open(job.jobId,event.currentTarget)}>
      {job.customerName}{' '}<span id={'schedule-state-'+job.jobId} className="schedule-visit-state" data-state={job.state}>{states[job.state]}</span>
     </button>
     <p className="schedule-agenda-time"><time dateTime={job.startAt}>{visitTime(job)}</time>{job.timezone!==timezone?' · '+job.timezone:''}{overlapping.has(job.jobId)&&<span className="schedule-time-overlap">Time overlap</span>}</p>
     <p className="field-help">{job.vehicleLabels.join(' · ')}{job.pendingAppointment?' · Time change proposed':''}{job.unknownTravel?' · Travel needs review':''}</p>
    </li>)}</ul>
   </div>)}
  </div>}
  {hasMore&&<button type="button" className="secondary" disabled={busy} onClick={more}>Load more saved jobs</button>}
 </section>;
}
