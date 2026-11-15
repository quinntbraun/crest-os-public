// BR07/BR08: validate one complete, current operator timeline before display or
// command preparation. Database exclusion/locking and write authority remain
// mandatory; this calculation alone cannot authorize or persist a transition.
import {customerUuid,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {scheduleInstantMicroseconds} from './schedule-time.ts';

type Work=Readonly<{id:string;jobId:string;operatorId:string;kind:'active'|'pause';startedAt:string;endedAt:string|null}>;
type Travel=Readonly<{id:string;operatorId:string;departedAt:string;arrivedAt:string|null}>;
export type OperatorOccupation=Readonly<{source:'work'|'travel';id:string;operatorId:string;startedAt:string;endedAt:string|null}>;
export class WorkOccupancyError extends Error{
 constructor(){super('WORK_TRAVEL_TIMELINE_REVIEW_REQUIRED');this.name='WorkOccupancyError';}
}
function requireTimeline(value:unknown):asserts value{if(!value)throw new WorkOccupancyError();}
type Range=Readonly<{start:bigint;end:bigint|null}>;
function range(start:unknown,end:unknown,observed:bigint):Range{
 requireTimeline(customerInstant(start)&&(end===null||customerInstant(end)));
 const a=scheduleInstantMicroseconds(start),b=end===null?null:scheduleInstantMicroseconds(end);
 requireTimeline(a<=observed&&(b===null||(b>=a&&b<=observed)));
 return {start:a,end:b};
}
function overlap(a:Range,b:Range):boolean{
 // Empty closed ranges do not occupy an instant. Open ends remain infinite,
 // including a leg that has just departed at this exact observation.
 if(a.end===a.start||b.end===b.start)return false;
 return (a.end===null||b.start<a.end)&&(b.end===null||a.start<b.end);
}
function disjoint(rows:readonly Readonly<{operatorId:string;startedAt:string;endedAt:string|null}>[],observed:bigint):void{
 const ranges=rows.map(row=>({operator:row.operatorId,...range(row.startedAt,row.endedAt,observed)})).sort((a,b)=>a.operator.localeCompare(b.operator)||(a.start<b.start?-1:a.start>b.start?1:0));
 let previous:typeof ranges[number]|null=null;
 for(const current of ranges){
  if(current.end===current.start)continue;
  if(previous?.operator===current.operator)requireTimeline(!overlap(previous,current));
  previous=current;
 }
}

export function recordedOperatorOccupancy(workValue:unknown,travelValue:unknown,observedAt:unknown):readonly OperatorOccupation[]{
 requireTimeline(Array.isArray(workValue)&&Array.isArray(travelValue)&&customerInstant(observedAt));
 const observed=scheduleInstantMicroseconds(observedAt),work:Work[]=[],travel:Travel[]=[];
 const workIds=new Set<string>(),travelIds=new Set<string>();
 for(const row of workValue){
  requireTimeline(exact(row,['id','jobId','operatorId','kind','startedAt','endedAt'])&&customerUuid(row.id)&&customerUuid(row.jobId)&&customerUuid(row.operatorId)&&(row.kind==='active'||row.kind==='pause')&&!workIds.has(row.id));
  range(row.startedAt,row.endedAt,observed);workIds.add(row.id);work.push(row as Work);
 }
 for(const row of travelValue){
  requireTimeline(exact(row,['id','operatorId','departedAt','arrivedAt'])&&customerUuid(row.id)&&customerUuid(row.operatorId)&&!travelIds.has(row.id));
  range(row.departedAt,row.arrivedAt,observed);travelIds.add(row.id);travel.push(row as Travel);
 }
 // A pause retains the unfinished job session even though it does not occupy
 // active labor. Never permit a second job to start merely because it is paused.
 const unfinished=new Map<string,string>(),openJobs=new Set<string>();
 for(const row of work){
  if(row.endedAt===null){requireTimeline(!unfinished.has(row.operatorId)&&!openJobs.has(row.jobId));unfinished.set(row.operatorId,row.jobId);openJobs.add(row.jobId);}
 }
 // Pausing retains a session: another job cannot start during that pause.
 // Historical closed pauses retain this rule when evidence is reconstructed.
 disjoint(work,observed);
 const occupations:OperatorOccupation[]=[...work.filter(w=>w.kind==='active').map(w=>({source:'work' as const,id:w.id,operatorId:w.operatorId,startedAt:w.startedAt,endedAt:w.endedAt})),...travel.map(t=>({source:'travel' as const,id:t.id,operatorId:t.operatorId,startedAt:t.departedAt,endedAt:t.arrivedAt}))];
 const openLegs=new Set<string>();
 for(const row of travel)if(row.arrivedAt===null){requireTimeline(!openLegs.has(row.operatorId));openLegs.add(row.operatorId);}
 disjoint(occupations,observed);
 // Keep precise source text and opaque IDs. Sorting is deterministic without
 // guessing a timezone, rounding timestamps, or allocating labor to vehicles.
 occupations.sort((a,b)=>a.operatorId.localeCompare(b.operatorId)||compareInstant(a.startedAt,b.startedAt)||a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
 return Object.freeze(occupations.map(row=>Object.freeze(row)));
}
function compareInstant(a:string,b:string):number{
 const x=scheduleInstantMicroseconds(a),y=scheduleInstantMicroseconds(b);return x<y?-1:x>y?1:0;
}
