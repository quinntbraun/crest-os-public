import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingAppointment,parseBookingCommunication,parseBookingLocation,requireBooking as check} from './confirmed-booking-contract.ts';
import type {BookingAppointment,BookingCommunication,BookingLocation,BookingPayload} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

type Stop=Extract<BookingLocation,{kind:'manual'}>;
export type FieldScopeObservation=Readonly<{sourceAllocationId:string;expectedPlanId:string;expectedSequence:string;entitlementVersionId:string}>;
export type InterruptionChange=Readonly<{action:'cancel';customerCommunication:BookingCommunication}>
 |Readonly<{action:'reschedule';appointment:BookingAppointment;conflictReview:BookingPayload['conflictReview']}>;
export type InterruptionDraft=InterruptionChange&Readonly<{reason:string;actualStop:Stop}>;
type Body=Readonly<{reason:string;trip:Readonly<{legId:string;expectedLegVersionId:string;actualStop:Stop}>;
 expectedAppointmentId:string;scope:readonly FieldScopeObservation[]}> & (
  Readonly<{action:'cancel';expectedModeSequence:null;appointment:null;conflictReview:null;customerCommunication:BookingCommunication}>|
  Readonly<{action:'reschedule';expectedModeSequence:string;appointment:BookingAppointment;conflictReview:BookingPayload['conflictReview'];customerCommunication:null}>
 );
export type TripInterruptionSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 jobId:string;expectedJobVersion:string;body:Body}>;
export const tripInterruptionConflicts=['operation','job','version','state','travel','appointment','mode','resources','review','allocation'] as const;
const required=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&
 [...value].length<=max&&[...value].every(character=>{
  const point=character.codePointAt(0)!;
  return [9,10,13].includes(point)||point>=32&&point!==127&&!(point>=0xd800&&point<=0xdfff);
 });
const scopeKeys=['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId'];
const belowMaximum=(value:unknown):value is string=>version(value)&&BigInt(value)<9223372036854775807n;
const sorted=(values:readonly string[])=>values.every((id,index)=>index===0||values[index-1]!<id);

export function parseFieldScopeObservations(value:unknown):readonly FieldScopeObservation[]{
 check(Array.isArray(value)&&value.length>0&&value.length<=1000&&Reflect.ownKeys(value).length===value.length+1);
 const scope=Array.from({length:value.length},(_,index)=>{
  const entry=Object.getOwnPropertyDescriptor(value,String(index));
  check(entry?.enumerable&&Object.hasOwn(entry,'value'));
  const row:unknown=entry.value;
  check(exact(row,scopeKeys)&&uuid(row.sourceAllocationId)&&uuid(row.expectedPlanId)&&belowMaximum(row.expectedSequence)&&uuid(row.entitlementVersionId));
  return Object.freeze({...row}) as FieldScopeObservation;
 });
 check(sorted(scope.map(row=>row.sourceAllocationId)));
 return Object.freeze(scope);
}

export function tripInterruptionOriginal(request:TripInterruptionSave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion,body}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:'operations.job.interrupt',
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion,action:body.action}});
}
export function parseTripInterruptionSave(value:unknown):TripInterruptionSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','body'])
  &&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.jobId)
  &&belowMaximum(value.expectedJobVersion));
 const body=value.body;
 check(exact(body,['action','reason','trip','expectedAppointmentId','expectedModeSequence','appointment','conflictReview','customerCommunication','scope'])
  &&required(body.reason,1000)&&uuid(body.expectedAppointmentId));
 const trip=body.trip;
 check(exact(trip,['legId','expectedLegVersionId','actualStop'])&&uuid(trip.legId)&&uuid(trip.expectedLegVersionId));
 check(exact(trip.actualStop,['schemaVersion','kind','locationText','instructions'])&&trip.actualStop.kind==='manual');
 const actualStop=parseBookingLocation(trip.actualStop,value.businessId,value.jobId);
 check(actualStop.kind==='manual');
 const scope=parseFieldScopeObservations(body.scope);
 const base={reason:body.reason,trip:Object.freeze({legId:trip.legId,expectedLegVersionId:trip.expectedLegVersionId,actualStop}),
  expectedAppointmentId:body.expectedAppointmentId,scope};
 let parsed:Body;
 if(body.action==='cancel'){
  check(body.expectedModeSequence===null&&body.appointment===null&&body.conflictReview===null);
  parsed={...base,action:'cancel',expectedModeSequence:null,appointment:null,conflictReview:null,customerCommunication:parseBookingCommunication(body.customerCommunication)};
 }else{
  check(body.action==='reschedule'&&version(body.expectedModeSequence)&&body.customerCommunication===null);
  const appointment=parseBookingAppointment(body.appointment),review=body.conflictReview;
  check(exact(review,['expectedAppointmentIds','expectedUnknownTravel','overrideReason'])
   &&Array.isArray(review.expectedAppointmentIds)&&review.expectedAppointmentIds.length<=1000
   &&review.expectedAppointmentIds.every(uuid)&&sorted(review.expectedAppointmentIds)
   &&typeof review.expectedUnknownTravel==='boolean'&&(!review.expectedUnknownTravel||appointment.unknown_travel_reviewed)
   &&(review.expectedAppointmentIds.length?required(review.overrideReason,1000):review.overrideReason===null));
  parsed={...base,action:'reschedule',expectedModeSequence:body.expectedModeSequence,appointment,customerCommunication:null,
   conflictReview:Object.freeze({expectedAppointmentIds:Object.freeze([...review.expectedAppointmentIds]),expectedUnknownTravel:review.expectedUnknownTravel,
    overrideReason:review.overrideReason as string|null})};
 }
 return Object.freeze({schemaVersion:1,businessId:value.businessId,operationId:value.operationId,
  recoveryEpoch:value.recoveryEpoch,jobId:value.jobId,expectedJobVersion:value.expectedJobVersion,body:Object.freeze(parsed)});
}
export function parseTripInterruptionCommitted(value:unknown,request:TripInterruptionSave){
 const original=tripInterruptionOriginal(parseTripInterruptionSave(request)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
