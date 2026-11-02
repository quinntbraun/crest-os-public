import {customerUuid as uuid,customerInstant as instant,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {scheduleInstantMicroseconds} from './schedule-time.ts';
export const bookingConflictRequestFields=['schemaVersion','businessId','operatorId','rescheduledJobId','startAt','endAt','travelBeforeSeconds','travelAfterSeconds'] as const;
export type BookingConflictRequest=Readonly<{schemaVersion:1;businessId:string;operatorId:string;rescheduledJobId:string|null;startAt:string;endAt:string;travelBeforeSeconds:number|null;travelAfterSeconds:number|null}>;
export const reviewedReservationFields=['appointmentId','jobId','jobVersion','appointmentSequence','customerName','startAt','endAt','timezone','travelBeforeSeconds','travelAfterSeconds','relation'] as const;
export type ReviewedReservation=Readonly<{appointmentId:string;jobId:string;jobVersion:string;appointmentSequence:string;customerName:string;startAt:string;endAt:string;timezone:string;travelBeforeSeconds:number|null;travelAfterSeconds:number|null;relation:'before'|'overlap'|'after'}>;
const travel=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=2147483647;
function range(v:{startAt:string;endAt:string;travelBeforeSeconds:number|null;travelAfterSeconds:number|null}){return {start:scheduleInstantMicroseconds(v.startAt)-BigInt(v.travelBeforeSeconds??0)*1000000n,end:scheduleInstantMicroseconds(v.endAt)+BigInt(v.travelAfterSeconds??0)*1000000n};}
export function parseBookingConflictRequest(v:unknown):BookingConflictRequest{
 check(exact(v,bookingConflictRequestFields)&&v.schemaVersion===1&&uuid(v.businessId)&&uuid(v.operatorId)&&(v.rescheduledJobId===null||uuid(v.rescheduledJobId))&&instant(v.startAt)&&instant(v.endAt)&&v.endAt>v.startAt&&travel(v.travelBeforeSeconds)&&travel(v.travelAfterSeconds));return Object.freeze({...v}) as BookingConflictRequest;
}
export function parseBookingConflictReview(v:unknown,input:BookingConflictRequest){
 const request=parseBookingConflictRequest(input);if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(v,[...bookingConflictRequestFields,'conflictingAppointmentIds','unknownTravel','reservations'])&&bookingConflictRequestFields.every(key=>v[key]===request[key])&&Array.isArray(v.conflictingAppointmentIds)&&v.conflictingAppointmentIds.length<=1000&&typeof v.unknownTravel==='boolean'&&Array.isArray(v.reservations)&&v.reservations.length<=1002);
 let prior='',before=0,after=0,unknown=request.travelBeforeSeconds===null||request.travelAfterSeconds===null;const conflicts:string[]=[],jobs=new Set<string>(),target=range(request);
 const reservations=v.reservations.map(item=>{
  check(exact(item,reviewedReservationFields)&&uuid(item.appointmentId)&&item.appointmentId>prior&&uuid(item.jobId)&&item.jobId!==request.rescheduledJobId&&!jobs.has(item.jobId)&&version(item.jobVersion)&&version(item.appointmentSequence)&&BigInt(item.appointmentSequence)<=BigInt(item.jobVersion)&&typeof item.customerName==='string'&&item.customerName.trim()!==''&&[...item.customerName].length<=200&&[...item.customerName].every(c=>{const n=c.codePointAt(0)!;return n>=32&&n!==127&&(n<0xd800||n>0xdfff);})&&instant(item.startAt)&&instant(item.endAt)&&item.endAt>item.startAt&&typeof item.timezone==='string'&&item.timezone.length<=100&&travel(item.travelBeforeSeconds)&&travel(item.travelAfterSeconds)&&['before','overlap','after'].includes(item.relation as string));
  try{new Intl.DateTimeFormat('en-US',{timeZone:item.timezone}).format(0);}catch{check(false);}
  const row=Object.freeze({...item}) as ReviewedReservation,occupied=range(row);prior=row.appointmentId;jobs.add(row.jobId);
  if(row.relation==='overlap'){check(occupied.start<target.end&&target.start<occupied.end);conflicts.push(row.appointmentId);unknown ||= row.travelBeforeSeconds===null||row.travelAfterSeconds===null;}
  else if(row.relation==='before'){check(++before===1&&occupied.end<=target.start);unknown ||= row.travelAfterSeconds===null;}
  else{check(++after===1&&occupied.start>=target.end);unknown ||= row.travelBeforeSeconds===null;}
  return row;
 });
 check(v.conflictingAppointmentIds.every((id,index)=>uuid(id)&&id===conflicts[index])&&v.conflictingAppointmentIds.length===conflicts.length&&v.unknownTravel===unknown);
 return Object.freeze({...request,conflictingAppointmentIds:Object.freeze(conflicts),unknownTravel:unknown,reservations:Object.freeze(reservations)});
}
