// BR07 timing arithmetic over recorded intervals. This is not a storage schema,
// a write authorization, or proof that the supplied job history is complete.
// observedAt must come from a verified server read, never browser uptime.
import {customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {scheduleInstantMicroseconds} from './schedule-time.ts';

export type RecordedWorkInterval=Readonly<{kind:'active'|'pause';startedAt:string;endedAt:string|null}>;
export type WorkTimeSummary=Readonly<{
 observedAt:string;firstStartedAt:string|null;closedThrough:string|null;
 closedActiveMicroseconds:string;closedPauseMicroseconds:string;
 observedActiveMicroseconds:string;observedPauseMicroseconds:string;
 elapsedMicroseconds:string|null;unrecordedMicroseconds:string;
 openInterval:Readonly<{kind:'active'|'pause';startedAt:string}>|null;
 continuous:boolean;
}>;
export class WorkTimeError extends Error{
 constructor(){super('WORK_TIME_REVIEW_REQUIRED');this.name='WorkTimeError';}
}
function requireTime(value:unknown):asserts value{if(!value)throw new WorkTimeError();}

export function summarizeWorkTime(value:unknown,observedAt:unknown):WorkTimeSummary{
 requireTime(Array.isArray(value)&&customerInstant(observedAt));
 const observed=scheduleInstantMicroseconds(observedAt);
 let closedActive=0n,closedPause=0n,active=0n,pause=0n,unrecorded=0n;
 let firstStartedAt:string|null=null,closedThrough:string|null=null;
 let openInterval:WorkTimeSummary['openInterval']=null,previousEnd:bigint|null=null,first:bigint|null=null;
 for(const raw of value){
  requireTime(exact(raw,['kind','startedAt','endedAt'])&&(raw.kind==='active'||raw.kind==='pause')
   &&customerInstant(raw.startedAt)&&(raw.endedAt===null||customerInstant(raw.endedAt)));
  // An open interval is a real unresolved end, even when observed duration is0.
  requireTime(openInterval===null);
  const start=scheduleInstantMicroseconds(raw.startedAt),end=raw.endedAt===null?observed:scheduleInstantMicroseconds(raw.endedAt);
  requireTime(start<=end&&end<=observed&&(previousEnd===null||start>=previousEnd));
  if(first===null){first=start;firstStartedAt=raw.startedAt;}
  if(previousEnd!==null)unrecorded+=start-previousEnd;
  const duration=end-start;
  if(raw.kind==='active')active+=duration;else pause+=duration;
  if(raw.endedAt===null)openInterval=Object.freeze({kind:raw.kind,startedAt:raw.startedAt});
  else{
   closedThrough=raw.endedAt;
   if(raw.kind==='active')closedActive+=duration;else closedPause+=duration;
  }
  previousEnd=end;
 }
 const elapsed=first===null?null:previousEnd!-first;
 requireTime(elapsed===null||elapsed===active+pause+unrecorded);
 return Object.freeze({observedAt,firstStartedAt,closedThrough,
  closedActiveMicroseconds:closedActive.toString(),closedPauseMicroseconds:closedPause.toString(),
  observedActiveMicroseconds:active.toString(),observedPauseMicroseconds:pause.toString(),
  elapsedMicroseconds:elapsed===null?null:elapsed.toString(),unrecordedMicroseconds:unrecorded.toString(),
  openInterval,continuous:unrecorded===0n});
}
