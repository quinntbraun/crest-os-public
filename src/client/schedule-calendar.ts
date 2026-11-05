import {customerDate,customerInstant} from '../customer/customer-contract';
import type {JobSummary} from '../operations/confirmed-job-read-contract';

export type CalendarMode='day'|'week'|'month'|'custom';
export type CalendarRange=Readonly<{fromDate:string;throughDate:string}>;
const dayMs=86400000;
function date(day:string){if(!customerDate(day))throw Error('CALENDAR_DATE_REQUIRED');return new Date(day+'T12:00:00Z');}
function label(value:Date){const result=value.toISOString().slice(0,10);if(!customerDate(result))throw Error('CALENDAR_DATE_REQUIRED');return result;}
export function shiftCalendarDay(day:string,amount:number){if(!Number.isSafeInteger(amount)||Math.abs(amount)>93)throw Error('CALENDAR_DATE_REQUIRED');return label(new Date(date(day).getTime()+amount*dayMs));}
export function calendarRange(anchor:string,mode:Exclude<CalendarMode,'custom'>):CalendarRange{
 const value=date(anchor);if(mode==='day')return {fromDate:anchor,throughDate:anchor};if(mode==='week')return {fromDate:anchor,throughDate:shiftCalendarDay(anchor,6)};
 if(mode!=='month')throw Error('CALENDAR_DATE_REQUIRED');value.setUTCDate(1);const fromDate=label(value);value.setUTCMonth(value.getUTCMonth()+1);value.setUTCDate(0);return {fromDate,throughDate:label(value)};
}
export function moveCalendarRange(range:CalendarRange,mode:CalendarMode,direction:-1|1):CalendarRange|null{
 try{
  if(direction!==-1&&direction!==1)throw Error();date(range.throughDate);if(range.throughDate<range.fromDate)throw Error();
  if(mode==='month'){const value=date(range.fromDate);value.setUTCDate(1);value.setUTCMonth(value.getUTCMonth()+direction);return calendarRange(label(value),'month');}
  const span=mode==='day'?1:mode==='week'?7:(date(range.throughDate).getTime()-date(range.fromDate).getTime())/dayMs+1;if(span<1||span>93)throw Error();return {fromDate:shiftCalendarDay(range.fromDate,direction*span),throughDate:shiftCalendarDay(range.throughDate,direction*span)};
 }catch{return null;}
}
export function calendarDays(range:CalendarRange,mode:CalendarMode):readonly string[]{
 date(range.fromDate);date(range.throughDate);if(range.throughDate<range.fromDate)throw Error('CALENDAR_DATE_REQUIRED');if(mode==='custom')return [];
 if(mode==='day')return Array.from({length:7},(_,i)=>{try{return shiftCalendarDay(range.fromDate,i-3);}catch{return null;}}).filter((v):v is string=>v!==null);
 const actual=mode==='month'?calendarRange(range.fromDate,'month'):calendarRange(range.fromDate,'week'),count=(date(actual.throughDate).getTime()-date(actual.fromDate).getTime())/dayMs+1;
 return Array.from({length:count},(_,i)=>shiftCalendarDay(actual.fromDate,i));
}
function wallParts(formatter:Intl.DateTimeFormat,value:Date){const parts=formatter.formatToParts(value),get=(name:string)=>parts.find(part=>part.type===name)?.value??'';return {day:get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day'),time:get('hour')+':'+get('minute')+':'+get('second')};}
function formatter(timezone:string){return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});}
export function calendarToday(timezone:string,now=new Date()){return wallParts(formatter(timezone),now).day;}
export function calendarMarks(days:readonly string[],jobs:readonly Pick<JobSummary,'jobId'|'state'|'startAt'|'endAt'>[],timezone:string):ReadonlyMap<string,Readonly<{visits:number;cancelled:number}>>{
 const result=new Map<string,{visits:number;cancelled:number}>(),display=formatter(timezone),seen=new Set<string>();for(const day of days){date(day);result.set(day,{visits:0,cancelled:0});}
 for(const job of jobs){if(seen.has(job.jobId)||!customerInstant(job.startAt)||!customerInstant(job.endAt)||job.endAt<=job.startAt)throw Error('CALENDAR_RECORD_REVIEW_REQUIRED');seen.add(job.jobId);
  const first=wallParts(display,new Date(job.startAt)),last=wallParts(display,new Date(job.endAt));let through=last.day;
  // An exact midnight end is exclusive. One microsecond past it still belongs
  // to the next date; Date's millisecond precision must not erase that visit.
  if(last.time==='00:00:00'&&job.endAt.slice(20,26)==='000000')through=shiftCalendarDay(through,-1);
  for(const [day,mark]of result)if(day>=first.day&&day<=through){mark.visits++;if(job.state==='cancelled')mark.cancelled++;}
 }
 return result;
}
