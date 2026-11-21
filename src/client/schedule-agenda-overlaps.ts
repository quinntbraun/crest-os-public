import type {JobSummary} from '../operations/confirmed-job-read-contract';
import {scheduleInstantMicroseconds} from '../operations/schedule-time';

type Visit=Pick<JobSummary,'jobId'|'operatorId'|'state'|'startAt'|'endAt'>;

// Presentation evidence from loaded appointment times only. Reservation/travel
// conflict review remains the protected scheduling command's responsibility.
export function loadedAppointmentOverlaps(visits:readonly Visit[]):ReadonlySet<string>{
 const operators=new Map<string,{id:string;start:bigint;end:bigint}[]>(),overlapping=new Set<string>();
 for(const visit of visits){
  if(visit.state==='cancelled')continue;
  const interval={id:visit.jobId,start:scheduleInstantMicroseconds(visit.startAt),end:scheduleInstantMicroseconds(visit.endAt)};
  const group=operators.get(visit.operatorId);if(group)group.push(interval);else operators.set(visit.operatorId,[interval]);
 }
 for(const group of operators.values()){
  group.sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:a.id<b.id?-1:a.id>b.id?1:0);
  let active:typeof group=[];
  for(const current of group){
   active=active.filter(prior=>prior.end>current.start);
   for(const prior of active){overlapping.add(prior.id);overlapping.add(current.id);}
   active.push(current);
  }
 }
 return overlapping;
}
