// Version2 construction binds scheduling to the currently accepted entitlement
// version. Existing version1 commands and receipts retain their exact format.
import {customerUuid,customerVersion} from '../customer/customer-contract.ts';
import {parseBookJobSave,parseCancelScheduledJobSave,parseBookedJobCommitted,parseCancelledJobCommitted,BookingDataError,requireBooking as check} from './confirmed-booking-contract.ts';
import type {BookJobSave,BookingPlan,CancelScheduledJobSave} from './confirmed-booking-contract.ts';

export type AmendedBookingPlan=BookingPlan&Readonly<{entitlementVersionId:string}>;
export type AmendedBookJobSave=Omit<BookJobSave,'schemaVersion'|'payload'>&Readonly<{schemaVersion:2;payload:Omit<BookJobSave['payload'],'allocationPlans'>&Readonly<{allocationPlans:readonly AmendedBookingPlan[]}>}>;
export type CancellationPlanObservation=Readonly<{sourceAllocationId:string;entitlementVersionId:string;expectedPlanId:string;expectedSequence:string}>;
export type AmendedCancelJobSave=Omit<CancelScheduledJobSave,'schemaVersion'|'payload'>&Readonly<{schemaVersion:2;payload:CancelScheduledJobSave['payload']&Readonly<{allocationPlans:readonly CancellationPlanObservation[]}>}>;
export type BookJobCommand=BookJobSave|AmendedBookJobSave;
export type CancelJobCommand=CancelScheduledJobSave|AmendedCancelJobSave;
const bookFields=['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedModeSequence','payload'],cancelFields=['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','payload'];
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));const d=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function array(value:unknown):unknown[]{check(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);const d=Object.getOwnPropertyDescriptors(value),length=Object.getOwnPropertyDescriptor(value,'length')?.value;check(Number.isSafeInteger(length)&&length>0&&Reflect.ownKeys(d).length===length+1);return Array.from({length},(_,i)=>{const v=d[String(i)];check(v&&v.enumerable&&Object.hasOwn(v,'value'));return v.value;});}
function size(value:unknown){check(new TextEncoder().encode(JSON.stringify(value)).byteLength<=1048576);}
export function parseAmendedBookJobSave(value:unknown):AmendedBookJobSave{
 try{
  const row=record(value,bookFields);check(row.schemaVersion===2);const payload=record(row.payload,['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview']),plans=array(payload.allocationPlans).map(v=>{const p=record(v,['sourceAllocationId','entitlementVersionId','expectedSequence','reason','parts']);check(customerUuid(p.entitlementVersionId));return p;});
  const legacy=parseBookJobSave({...row,schemaVersion:1,payload:{...payload,allocationPlans:plans.map(p=>Object.fromEntries(Object.entries(p).filter(([key])=>key!=='entitlementVersionId')))}});
  const result=Object.freeze({...legacy,schemaVersion:2 as const,payload:Object.freeze({...legacy.payload,allocationPlans:Object.freeze(legacy.payload.allocationPlans.map((p,i)=>Object.freeze({...p,entitlementVersionId:plans[i]!.entitlementVersionId as string})))})});size(result);return result;
 }catch{throw new BookingDataError();}
}
export function parseAmendedCancelJobSave(value:unknown):AmendedCancelJobSave{
 try{
  const row=record(value,cancelFields);check(row.schemaVersion===2);const payload=record(row.payload,['reason','customerCommunication','allocationPlans']),plans=array(payload.allocationPlans).map(v=>{const p=record(v,['sourceAllocationId','entitlementVersionId','expectedPlanId','expectedSequence']);check([p.sourceAllocationId,p.entitlementVersionId,p.expectedPlanId].every(customerUuid)&&customerVersion(p.expectedSequence)&&BigInt(p.expectedSequence)<9223372036854775807n);return Object.freeze(p) as CancellationPlanObservation;});check(new Set(plans.map(p=>p.sourceAllocationId)).size===plans.length);
  const legacy=parseCancelScheduledJobSave({...row,schemaVersion:1,payload:{reason:payload.reason,customerCommunication:payload.customerCommunication}}),result=Object.freeze({...legacy,schemaVersion:2 as const,payload:Object.freeze({...legacy.payload,allocationPlans:Object.freeze(plans)})});size(result);return result;
 }catch{throw new BookingDataError();}
}
function committed(value:unknown,kind:'book'|'cancel',businessId:string,operationId:string){
 try{
  const row=record(value,['state','operationId','recoveryEpoch','receipt']),r=record(row.receipt,['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']);check(r.schemaVersion===2);
  // Reuse only the common immutable receipt shape; retain version2 in output.
  const parsed=(kind==='book'?parseBookedJobCommitted:parseCancelledJobCommitted)({...row,receipt:{...r,schemaVersion:1}},businessId,operationId);return Object.freeze({...parsed,receipt:Object.freeze({...parsed.receipt,schemaVersion:2 as const})});
 }catch{throw new BookingDataError();}
}
export const parseAmendedBookedJobCommitted=(value:unknown,businessId:string,operationId:string)=>committed(value,'book',businessId,operationId);
export const parseAmendedCancelledJobCommitted=(value:unknown,businessId:string,operationId:string)=>committed(value,'cancel',businessId,operationId);
export function bindAmendedBookingReceipt(value:unknown,kind:'book'|'cancel',input:AmendedBookJobSave|AmendedCancelJobSave){
 const q=kind==='book'?parseAmendedBookJobSave(input):parseAmendedCancelJobSave(input),parsed=committed(value,kind,q.businessId,q.operationId);check(parsed.recoveryEpoch===q.recoveryEpoch&&parsed.receipt.jobId===q.jobId);if('expectedJobVersion'in q)check(parsed.receipt.version===(BigInt(q.expectedJobVersion)+1n).toString());return parsed;
}
// Explicit dispatch preserves both strict wire formats. Never strip version2
// observations or reinterpret an unknown profile as a legacy request.
const version2=(v:unknown)=>v!==null&&typeof v==='object'&&Object.getOwnPropertyDescriptor(v,'schemaVersion')?.value===2;
export const parseBookJobCommand=(v:unknown):BookJobCommand=>version2(v)?parseAmendedBookJobSave(v):parseBookJobSave(v);
export const parseCancelJobCommand=(v:unknown):CancelJobCommand=>version2(v)?parseAmendedCancelJobSave(v):parseCancelScheduledJobSave(v);
export function bindBookingCommandReceipt(value:unknown,kind:'book'|'cancel',input:BookJobCommand|CancelJobCommand){
 const q=kind==='book'?parseBookJobCommand(input):parseCancelJobCommand(input);
 if(q.schemaVersion===2)return bindAmendedBookingReceipt(value,kind,q);
 const result=(kind==='book'?parseBookedJobCommitted:parseCancelledJobCommitted)(value,q.businessId,q.operationId);check(result.recoveryEpoch===q.recoveryEpoch&&result.receipt.jobId===q.jobId);if('expectedJobVersion'in q)check(result.receipt.version===(BigInt(q.expectedJobVersion)+1n).toString());return result;
}
