// BR06 comparison only. A trusted booking transaction must load current
// reservations and recheck under the operator lock before applying any override.
import {customerUuid,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {scheduleInstantMicroseconds} from './schedule-time.ts';
export type ScheduleInterval=Readonly<{startAt:string;endAt:string;travelBeforeSeconds:number|null;travelAfterSeconds:number|null}>;
export type ScheduleReservation=ScheduleInterval&Readonly<{businessId:string;operatorId:string;appointmentId:string;jobId:string}>;
export class ScheduleConflictError extends Error{constructor(){super('SCHEDULE_CONFLICT_REVIEW_REQUIRED');this.name='ScheduleConflictError';}}
function check(value:unknown):asserts value{if(!value)throw new ScheduleConflictError();}
const intervalFields=['startAt','endAt','travelBeforeSeconds','travelAfterSeconds'] as const;
function interval(value:unknown):ScheduleInterval{
 check(exact(value,intervalFields)&&customerInstant(value.startAt)&&customerInstant(value.endAt)&&value.endAt>value.startAt);
 for(const key of ['travelBeforeSeconds','travelAfterSeconds'] as const){const v=value[key];check(v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=2147483647);}
 return Object.freeze({...value}) as ScheduleInterval;
}
function range(value:ScheduleInterval){return {start:scheduleInstantMicroseconds(value.startAt)-BigInt(value.travelBeforeSeconds??0)*1000000n,end:scheduleInstantMicroseconds(value.endAt)+BigInt(value.travelAfterSeconds??0)*1000000n};}
export function compareScheduleReservations(context:Readonly<{businessId:string;operatorId:string;rescheduledJobId:string|null}>,proposed:unknown,candidates:unknown){
 check(exact(context,['businessId','operatorId','rescheduledJobId'])&&customerUuid(context.businessId)&&customerUuid(context.operatorId)&&(context.rescheduledJobId===null||customerUuid(context.rescheduledJobId))&&Array.isArray(candidates));
 const next=interval(proposed),target=range(next),ids=new Set<string>(),conflicts:string[]=[];let unknownTravel=next.travelBeforeSeconds===null||next.travelAfterSeconds===null;
 for(const value of candidates){
  check(exact(value,[...intervalFields,'businessId','operatorId','appointmentId','jobId'])&&value.businessId===context.businessId&&value.operatorId===context.operatorId&&customerUuid(value.appointmentId)&&customerUuid(value.jobId)&&!ids.has(value.appointmentId));ids.add(value.appointmentId);
  const current=interval(Object.fromEntries(intervalFields.map(key=>[key,value[key]])));
  if(value.jobId===context.rescheduledJobId)continue;
  unknownTravel ||= current.travelBeforeSeconds===null||current.travelAfterSeconds===null;
  const occupied=range(current);if(target.start<occupied.end&&occupied.start<target.end)conflicts.push(value.appointmentId);
 }
 return Object.freeze({conflictingAppointmentIds:Object.freeze(conflicts.sort()),unknownTravel});
}
