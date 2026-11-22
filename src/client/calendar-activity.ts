import {authentication,AuthenticationError} from './authentication';
import {scheduling} from './scheduling';
import {readSyntheticCalendarJobStatus} from './google-calendar-consent';
import {scheduleDateWindow} from './schedule-reader';
import {shiftCalendarDay} from './schedule-calendar';
import {customerUuid} from '../customer/customer-contract';
import type {GoogleCalendarJobStatus} from '../operations/google-calendar-job-status';
import type {JobSummary} from '../operations/confirmed-job-read-contract';

type Dates=Readonly<{fromDate:string;throughDate:string}>;
export type CalendarActivityCursor=Readonly<Dates&{businessId:string;operatorId:string;epoch:string;binding:string;timezone:string;afterStart:string;afterJob:string}>;
export type CalendarActivityPage=Readonly<{dates:Dates;timezone:string;rows:readonly Readonly<{job:JobSummary;status:GoogleCalendarJobStatus|null}>[];next:CalendarActivityCursor|null}>;
export class CalendarActivityReadError extends Error {
 readonly kind:'input'|'changed'|'unavailable';
 constructor(kind:CalendarActivityReadError['kind']){super('CALENDAR_ACTIVITY_UNVERIFIED');this.name='CalendarActivityReadError';this.kind=kind;}
}
type Dependencies={session:typeof authentication.session;workspace:typeof scheduling.workspace;list:typeof scheduling.list;status:typeof readSyntheticCalendarJobStatus;now:()=>Date};
export function createCalendarActivitySource(dependencies:Partial<Dependencies>={}){
 const {session=authentication.session,workspace=scheduling.workspace,list=scheduling.list,status=readSyntheticCalendarJobStatus,now=()=>new Date()}=dependencies;
 return async(input:Readonly<{epoch:string;dates?:Dates;after?:CalendarActivityCursor}>,external:AbortSignal):Promise<CalendarActivityPage>=>{
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]);
  signal.throwIfAborted();
  if(!customerUuid(input.epoch))throw new CalendarActivityReadError('input');
  const proof=await session(signal),before=await workspace(proof,signal);signal.throwIfAborted();
  const context=before.context;
  if(before.googleCalendarAvailable!==true||context.writeState!=='ready'||context.recoveryEpoch!==input.epoch)throw new CalendarActivityReadError('unavailable');
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:context.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
  const dates=Object.freeze({...input.dates??{fromDate:shiftCalendarDay(today,-30),throughDate:shiftCalendarDay(today,30)}});
  let window;try{window=scheduleDateWindow(dates,context.timezone);}catch{throw new CalendarActivityReadError('input');}
  const cursor=input.after;
  if(cursor&&(cursor.businessId!==context.businessId||cursor.operatorId!==context.operatorId||cursor.epoch!==input.epoch||cursor.binding!==before.binding||cursor.timezone!==context.timezone||cursor.fromDate!==dates.fromDate||cursor.throughDate!==dates.throughDate))throw new CalendarActivityReadError('changed');
  const page=await list({businessId:context.businessId,...window,afterStart:cursor?.afterStart??null,afterJob:cursor?.afterJob??null,pageSize:5},proof,signal);
  signal.throwIfAborted();
  const rows:Readonly<{job:JobSummary;status:GoogleCalendarJobStatus|null}>[]=[];
  for(const job of page.jobs){
   let current:GoogleCalendarJobStatus|null=null;
   try{current=await status(job.jobId,input.epoch,signal);}catch(error){signal.throwIfAborted();if(error instanceof AuthenticationError&&error.kind==='denied')throw error;}
   signal.throwIfAborted();
   // Appointment sequence, not mutable job version, binds the status to its date.
   if(current&&(current.jobId!==job.jobId||current.appointmentVersion!==job.appointmentSequence))throw new CalendarActivityReadError('changed');
   rows.push(Object.freeze({job,status:current}));
  }
  // No private page is handed to the view after a changed/revoked authority.
  const fresh=await session(signal),after=await workspace(fresh,signal);signal.throwIfAborted();
  if(after.binding!==before.binding||after.googleCalendarAvailable!==true||after.context.businessId!==context.businessId||after.context.operatorId!==context.operatorId||after.context.timezone!==context.timezone||after.context.writeState!=='ready'||after.context.recoveryEpoch!==input.epoch)throw new CalendarActivityReadError('changed');
  const last=page.jobs.at(-1);
  const next=page.hasMore&&last?Object.freeze({...dates,businessId:context.businessId,operatorId:context.operatorId,epoch:input.epoch,binding:before.binding,timezone:context.timezone,afterStart:last.startAt,afterJob:last.jobId}):null;
  return Object.freeze({dates,timezone:context.timezone,rows:Object.freeze(rows),next});
 };
}
