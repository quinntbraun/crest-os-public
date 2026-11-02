// Data boundary only. Proposed times are never inferred to be confirmed.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking,parseBookingContact} from './confirmed-booking-contract.ts';
import type {BookingContact,BookingConfirmation} from './confirmed-booking-contract.ts';
import {parseScheduleTime,scheduleTimeFields} from './schedule-time.ts';
import type {ScheduleTime} from './schedule-time.ts';
type ProposedTime=ScheduleTime&Readonly<{travel_before_seconds:number|null;travel_after_seconds:number|null;contact_snapshot:BookingContact}>;
type ConfirmReview=Readonly<{expectedAppointmentIds:readonly string[];expectedUnknownTravel:boolean;unknownTravelReviewed:boolean;overrideReason:string|null}>;
type Common=Readonly<{reason:string;latestAppointmentId:string}>;
export type ScheduleChangePayload=Common&(
 Readonly<{action:'propose';expectedModeSequence:string;appointment:ProposedTime;customerConfirmation:null;conflictReview:null}>|
 Readonly<{action:'confirm';expectedModeSequence:string;appointment:null;customerConfirmation:BookingConfirmation;conflictReview:ConfirmReview}>|
 Readonly<{action:'withdraw';expectedModeSequence:null;appointment:null;customerConfirmation:null;conflictReview:null}>);
export type ChangeJobScheduleSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;expectedJobVersion:string;payload:ScheduleChangePayload}>;
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&[...v].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
export function parseScheduleChangePayload(v:unknown):ScheduleChangePayload{
 requireBooking(exact(v,['action','reason','latestAppointmentId','expectedModeSequence','appointment','customerConfirmation','conflictReview'])&&['propose','confirm','withdraw'].includes(v.action as string)&&text(v.reason,1000)&&customerUuid(v.latestAppointmentId));
 if(v.action==='withdraw'){requireBooking(v.expectedModeSequence===null&&v.appointment===null&&v.customerConfirmation===null&&v.conflictReview===null);return Object.freeze({...v}) as ScheduleChangePayload;}
 requireBooking(customerVersion(v.expectedModeSequence));
 let result:ScheduleChangePayload;
 if(v.action==='propose'){
  const a=v.appointment;requireBooking(v.customerConfirmation===null&&v.conflictReview===null&&exact(a,[...scheduleTimeFields,'travel_before_seconds','travel_after_seconds','contact_snapshot']));
  for(const key of ['travel_before_seconds','travel_after_seconds'])requireBooking(a[key]===null||typeof a[key]==='number'&&Number.isInteger(a[key])&&a[key]>=0&&a[key]<=2147483647);
  let time:ScheduleTime;try{time=parseScheduleTime(Object.fromEntries(scheduleTimeFields.map(key=>[key,a[key]])));}catch{requireBooking(false);}
  result=Object.freeze({...v,appointment:Object.freeze({...time,travel_before_seconds:a.travel_before_seconds,travel_after_seconds:a.travel_after_seconds,contact_snapshot:parseBookingContact(a.contact_snapshot)})}) as ScheduleChangePayload;
 }else{
  const c=v.customerConfirmation,r=v.conflictReview;requireBooking(v.appointment===null&&exact(c,['channel','effectiveAt','evidenceNote'])&&['text','phone','email','in_person'].includes(c.channel as string)&&customerInstant(c.effectiveAt)&&text(c.evidenceNote,2000));
  requireBooking(exact(r,['expectedAppointmentIds','expectedUnknownTravel','unknownTravelReviewed','overrideReason'])&&Array.isArray(r.expectedAppointmentIds)&&r.expectedAppointmentIds.every(customerUuid)&&new Set(r.expectedAppointmentIds).size===r.expectedAppointmentIds.length&&typeof r.expectedUnknownTravel==='boolean'&&typeof r.unknownTravelReviewed==='boolean'&&(r.overrideReason===null||text(r.overrideReason,1000)));
  result=Object.freeze({...v,customerConfirmation:Object.freeze({...c}),conflictReview:Object.freeze({...r,expectedAppointmentIds:Object.freeze([...r.expectedAppointmentIds])})}) as ScheduleChangePayload;
 }
 requireBooking(new TextEncoder().encode(JSON.stringify(result)).byteLength<=1048576);return result;
}
export function parseChangeJobScheduleSave(v:unknown):ChangeJobScheduleSave{
 requireBooking(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','payload'])&&v.schemaVersion===1&&[v.businessId,v.operationId,v.recoveryEpoch,v.jobId].every(customerUuid)&&customerVersion(v.expectedJobVersion)&&BigInt(v.expectedJobVersion)<9223372036854775807n);
 return Object.freeze({...v,payload:parseScheduleChangePayload(v.payload)}) as ChangeJobScheduleSave;
}
export function parseRescheduledJobCommitted(v:unknown,businessId:string,operationId:string){
 requireBooking(customerUuid(businessId)&&customerUuid(operationId)&&exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operationId&&customerUuid(v.recoveryEpoch));const r=v.receipt;
 requireBooking(exact(r,['schemaVersion','businessId','jobId','version','latestAppointmentId','appointmentSequence','currentAppointmentId','confirmationState','action','jobAuditEventId','sourceAuditIds'])&&r.schemaVersion===1&&r.businessId===businessId&&[r.jobId,r.latestAppointmentId,r.currentAppointmentId,r.jobAuditEventId].every(customerUuid)&&customerVersion(r.version)&&BigInt(r.version)>1n&&customerVersion(r.appointmentSequence)&&BigInt(r.appointmentSequence)>1n&&['propose','confirm','withdraw'].includes(r.action as string)&&Array.isArray(r.sourceAuditIds)&&r.sourceAuditIds.length>0&&r.sourceAuditIds.every(customerUuid)&&new Set(r.sourceAuditIds).size===r.sourceAuditIds.length&&r.sourceAuditIds.includes(r.jobAuditEventId as string));
 const action=r.action as 'propose'|'confirm'|'withdraw';requireBooking(r.confirmationState===({propose:'proposed',confirm:'confirmed',withdraw:'withdrawn'} as const)[action]&&(r.currentAppointmentId===r.latestAppointmentId)===(action==='confirm'));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r,sourceAuditIds:Object.freeze([...r.sourceAuditIds])}) as Readonly<{schemaVersion:1;businessId:string;jobId:string;version:string;latestAppointmentId:string;appointmentSequence:string;currentAppointmentId:string;confirmationState:'proposed'|'confirmed'|'withdrawn';action:'propose'|'confirm'|'withdraw';jobAuditEventId:string;sourceAuditIds:readonly string[]}>});
}
