// Shared booking data only. Source authority, concurrency and exact accepted
// amounts are re-read and enforced by the trusted PostgreSQL transaction.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseCustomerAddress} from '../customer/customer-address-contract.ts';
import type {CustomerAddress} from '../customer/customer-address-contract.ts';
import {fulfillmentModes} from './fulfillment-mode-contract.ts';
import type {FulfillmentMode} from './fulfillment-mode-contract.ts';
import {parseScheduleTime,scheduleTimeFields} from './schedule-time.ts';
import type {ScheduleTime} from './schedule-time.ts';
import {validateScopeAllocationPlan} from './scope-allocation-plan.ts';
import type {AllocationPart} from './scope-allocation-plan.ts';
export class BookingDataError extends Error{constructor(){super('BOOKING_DATA_INVALID');this.name='BookingDataError';}}
export function requireBooking(value:unknown):asserts value{if(!value)throw new BookingDataError();}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
export type BookingLocation=Readonly<{schemaVersion:1;kind:'manual';locationText:string;instructions:string|null}>|Readonly<{schemaVersion:1;kind:'customer_address';addressId:string;addressVersion:string;snapshot:CustomerAddress}>;
export type BookingContact=Readonly<{kind:'phone'|'email';value:string}>|Readonly<{kind:'no_contact';reason:string}>;
export type BookingConfirmation=Readonly<{channel:'text'|'phone'|'email'|'in_person';effectiveAt:string;evidenceNote:string}>;
export type BookingAppointment=ScheduleTime&Readonly<{travel_before_seconds:number|null;travel_after_seconds:number|null;customer_confirmation:BookingConfirmation;contact_snapshot:BookingContact;unknown_travel_reviewed:boolean}>;
export type BookingVehicle=Readonly<{vehicleId:string;expectedVersion:string;customerVehicleId:string|null;pickupLocation:BookingLocation|null;returnLocation:BookingLocation|null}>;
export type BookingPlan=Readonly<{sourceAllocationId:string;expectedSequence:string;reason:string|null;parts:readonly AllocationPart[]}>;
export type BookingPayload=Readonly<{customerId:string;expectedCustomerVersion:string;operatorId:string;fulfillmentMode:FulfillmentMode;workLocation:BookingLocation;vehicles:readonly BookingVehicle[];appointment:BookingAppointment;allocationPlans:readonly BookingPlan[];conflictReview:Readonly<{expectedAppointmentIds:readonly string[];expectedUnknownTravel:boolean;overrideReason:string|null}>}>;
export type BookJobSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;expectedModeSequence:string;payload:BookingPayload}>;
export function parseBookingLocation(value:unknown,businessId:string,customerId:string):BookingLocation{
 requireBooking(value&&typeof value==='object');const v=value as Record<string,unknown>;
 if(v.kind==='manual'){requireBooking(exact(v,['schemaVersion','kind','locationText','instructions'])&&v.schemaVersion===1&&text(v.locationText,2000)&&(v.instructions===null||text(v.instructions,2000)));return Object.freeze({...v}) as BookingLocation;}
 requireBooking(exact(v,['schemaVersion','kind','addressId','addressVersion','snapshot'])&&v.schemaVersion===1&&v.kind==='customer_address'&&customerUuid(v.addressId)&&customerVersion(v.addressVersion));
 let snapshot:CustomerAddress;try{snapshot=parseCustomerAddress(v.snapshot,businessId,customerId);}catch{throw new BookingDataError();}
 requireBooking(snapshot.id===v.addressId&&snapshot.version===v.addressVersion&&snapshot.archived_at===null&&(text(snapshot.exact_location_text,2000)||text(snapshot.line1,512)&&text(snapshot.city,200)));
 return Object.freeze({...v,snapshot}) as BookingLocation;
}
export function parseBookingContact(v:unknown):BookingContact{
 if(exact(v,['kind','reason'])&&v.kind==='no_contact'&&text(v.reason,1000))return Object.freeze({...v}) as BookingContact;
 requireBooking(exact(v,['kind','value'])&&text(v.value,512));
 if(v.kind==='email')requireBooking(/^[^\s@]+@[^\s@]+$/.test(v.value));
 else{requireBooking(v.kind==='phone');const match=v.value.match(/^([+]?[0-9(). -]+?)(?: *(?:ext\.?|x|#) *[0-9]+)?$/i),digits=match?.[1]?.replace(/[^0-9]/g,'');requireBooking(digits&&digits.length>=7&&digits.length<=15);}
 return Object.freeze({...v}) as BookingContact;
}
export function parseBookingAppointment(v:unknown):BookingAppointment{
 requireBooking(exact(v,[...scheduleTimeFields,'travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed']));
 let time:ScheduleTime;try{time=parseScheduleTime(Object.fromEntries(scheduleTimeFields.map(k=>[k,v[k]])));}catch{throw new BookingDataError();}
 for(const key of ['travel_before_seconds','travel_after_seconds'])requireBooking(v[key]===null||typeof v[key]==='number'&&Number.isInteger(v[key])&&v[key]>=0&&v[key]<=2147483647);
 const c=v.customer_confirmation;requireBooking(exact(c,['channel','effectiveAt','evidenceNote'])&&['text','phone','email','in_person'].includes(c.channel as string)&&customerInstant(c.effectiveAt)&&text(c.evidenceNote,2000)&&typeof v.unknown_travel_reviewed==='boolean');
 // Factual effective time is compared to the server's clock by the command.
 return Object.freeze({...time,travel_before_seconds:v.travel_before_seconds as number|null,travel_after_seconds:v.travel_after_seconds as number|null,customer_confirmation:Object.freeze({...c}) as BookingConfirmation,contact_snapshot:parseBookingContact(v.contact_snapshot),unknown_travel_reviewed:v.unknown_travel_reviewed});
}
export function parseBookingPayload(v:unknown,businessId:string):BookingPayload{
 requireBooking(customerUuid(businessId)&&exact(v,['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview'])&&customerUuid(v.customerId)&&customerUuid(v.operatorId)&&customerVersion(v.expectedCustomerVersion)&&fulfillmentModes.includes(v.fulfillmentMode as FulfillmentMode)&&Array.isArray(v.vehicles)&&v.vehicles.length>0&&Array.isArray(v.allocationPlans)&&v.allocationPlans.length>0);
 const customerId=v.customerId,vehicles=v.vehicles.map(row=>{
  requireBooking(exact(row,['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation'])&&customerUuid(row.vehicleId)&&customerVersion(row.expectedVersion)&&(row.customerVehicleId===null||customerUuid(row.customerVehicleId)));
  const pickupLocation=row.pickupLocation===null?null:parseBookingLocation(row.pickupLocation,businessId,customerId),returnLocation=row.returnLocation===null?null:parseBookingLocation(row.returnLocation,businessId,customerId);
  requireBooking(v.fulfillmentMode!=='pickup_return'||pickupLocation!==null&&returnLocation!==null);
  return Object.freeze({...row,pickupLocation,returnLocation}) as BookingVehicle;
 });requireBooking(new Set(vehicles.map(row=>row.vehicleId)).size===vehicles.length);
 const allocationPlans=v.allocationPlans.map(row=>{
  requireBooking(exact(row,['sourceAllocationId','expectedSequence','reason','parts'])&&customerUuid(row.sourceAllocationId)&&customerVersion(row.expectedSequence,true)&&BigInt(row.expectedSequence)<9223372036854775807n&&(row.reason===null||text(row.reason,1000))&&Array.isArray(row.parts)&&row.parts.length>0);
  // Reuse the proven exact arithmetic boundary for request structure, without
  // treating caller-supplied sums as the actual accepted source amount.
  const total={grossInclusiveCents:0n,discountInclusiveCents:0n,amountCents:0n};
  for(const part of row.parts){requireBooking(exact(part,['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription']));for(const key of ['grossInclusiveCents','discountInclusiveCents','amountCents'] as const){requireBooking(customerVersion(part[key],true));total[key]+=BigInt(part[key]);}}
  let parts:readonly AllocationPart[];try{parts=validateScopeAllocationPlan({id:row.sourceAllocationId,...Object.fromEntries(Object.entries(total).map(([k,n])=>[k,n.toString()]))},row.parts).parts;}catch{throw new BookingDataError();}
  return Object.freeze({...row,parts}) as BookingPlan;
 });requireBooking(new Set(allocationPlans.map(row=>row.sourceAllocationId)).size===allocationPlans.length);
 const r=v.conflictReview;requireBooking(exact(r,['expectedAppointmentIds','expectedUnknownTravel','overrideReason'])&&Array.isArray(r.expectedAppointmentIds)&&r.expectedAppointmentIds.every(customerUuid)&&new Set(r.expectedAppointmentIds).size===r.expectedAppointmentIds.length&&typeof r.expectedUnknownTravel==='boolean'&&(r.overrideReason===null||text(r.overrideReason,1000)));
 const result=Object.freeze({...v,workLocation:parseBookingLocation(v.workLocation,businessId,customerId),vehicles:Object.freeze(vehicles),appointment:parseBookingAppointment(v.appointment),allocationPlans:Object.freeze(allocationPlans),conflictReview:Object.freeze({...r,expectedAppointmentIds:Object.freeze([...r.expectedAppointmentIds])})}) as BookingPayload;
 requireBooking(new TextEncoder().encode(JSON.stringify(result)).byteLength<=1048576);return result;
}
export function parseBookJobSave(v:unknown):BookJobSave{
 requireBooking(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedModeSequence','payload'])&&v.schemaVersion===1&&[v.businessId,v.operationId,v.recoveryEpoch,v.jobId].every(customerUuid)&&customerVersion(v.expectedModeSequence,true));
 return Object.freeze({...v,payload:parseBookingPayload(v.payload,v.businessId as string)}) as BookJobSave;
}
export const bookingConflictReasons=['operation','mode','mode_disabled','pickup_policy','job','customer','vehicle','operator','location','scope','allocation','review'] as const;
function parseJobCommitted(v:unknown,businessId:string,operationId:string){
 requireBooking(customerUuid(businessId)&&customerUuid(operationId)&&exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operationId&&customerUuid(v.recoveryEpoch));const r=v.receipt;
 requireBooking(exact(r,['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'])&&r.schemaVersion===1&&r.businessId===businessId&&[r.jobId,r.appointmentId,r.jobAuditEventId].every(customerUuid)&&customerVersion(r.version)&&customerVersion(r.appointmentSequence)&&Array.isArray(r.sourceAuditIds)&&r.sourceAuditIds.length>0&&r.sourceAuditIds.every(customerUuid)&&new Set(r.sourceAuditIds).size===r.sourceAuditIds.length&&r.sourceAuditIds.includes(r.jobAuditEventId as string));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r,sourceAuditIds:Object.freeze([...r.sourceAuditIds])}) as Readonly<{schemaVersion:1;businessId:string;jobId:string;version:string;appointmentId:string;appointmentSequence:string;jobAuditEventId:string;sourceAuditIds:readonly string[]}>});
}
export function parseBookedJobCommitted(v:unknown,businessId:string,operationId:string){const r=parseJobCommitted(v,businessId,operationId);requireBooking(r.receipt.version==='1'&&r.receipt.appointmentSequence==='1');return r;}
export function parseCancelledJobCommitted(v:unknown,businessId:string,operationId:string){const r=parseJobCommitted(v,businessId,operationId);requireBooking(BigInt(r.receipt.version)>1n&&BigInt(r.receipt.appointmentSequence)>1n);return r;}
export type BookingCommunication=Readonly<{state:'not_sent'|'sent'|'no_contact';channel:BookingConfirmation['channel']|null;effectiveAt:string|null;evidenceNote:string|null}>;
export type CancelScheduledJobSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;expectedJobVersion:string;payload:Readonly<{reason:string;customerCommunication:BookingCommunication}>}>;
export function parseBookingCommunication(c:unknown):BookingCommunication{
 requireBooking(exact(c,['state','channel','effectiveAt','evidenceNote'])&&['not_sent','sent','no_contact'].includes(c.state as string));
 if(c.state==='sent')requireBooking(['text','phone','email','in_person'].includes(c.channel as string)&&customerInstant(c.effectiveAt)&&text(c.evidenceNote,2000));
 else requireBooking(c.channel===null&&c.effectiveAt===null&&(c.state==='no_contact'?text(c.evidenceNote,2000):c.evidenceNote===null||text(c.evidenceNote,2000)));
 return Object.freeze({...c}) as BookingCommunication;
}
export function parseCancelScheduledJobSave(v:unknown):CancelScheduledJobSave{
 requireBooking(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','payload'])&&v.schemaVersion===1&&[v.businessId,v.operationId,v.recoveryEpoch,v.jobId].every(customerUuid)&&customerVersion(v.expectedJobVersion)&&BigInt(v.expectedJobVersion)<9223372036854775807n&&exact(v.payload,['reason','customerCommunication'])&&text(v.payload.reason,1000));
 return Object.freeze({...v,payload:Object.freeze({...v.payload,customerCommunication:parseBookingCommunication(v.payload.customerCommunication)})}) as CancelScheduledJobSave;
}
