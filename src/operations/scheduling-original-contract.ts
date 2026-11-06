import {parseOriginalOperationReference} from '../security/original-operation-reference.ts';
import type {OriginalOperationReference} from '../security/original-operation-reference.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookedJobCommitted,parseCancelledJobCommitted,requireBooking as check} from './confirmed-booking-contract.ts';
import {parseRescheduledJobCommitted} from './confirmed-reschedule-contract.ts';
import {parseFulfillmentModeCommitted} from './fulfillment-mode-contract.ts';
import {parseAmendedBookedJobCommitted,parseAmendedCancelledJobCommitted} from './amended-booking-contract.ts';
import {fieldOriginalKinds,parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import type {FieldOriginalKind} from './field-original-contract.ts';
export const schedulingOriginalKinds=['operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book','operations.job.cancel','operations.job.reschedule',...fieldOriginalKinds] as const;
export type SchedulingOriginalKind=typeof schedulingOriginalKinds[number];
export type SchedulingOriginal=Extract<OriginalOperationReference,{commandType:SchedulingOriginalKind}>;
function amended(value:unknown){if(value===null||typeof value!=='object')return false;const r=Object.getOwnPropertyDescriptor(value,'receipt');return !!r&&Object.hasOwn(r,'value')&&r.value!==null&&typeof r.value==='object'&&Object.getOwnPropertyDescriptor(r.value,'schemaVersion')?.value===2;}
export function parseSchedulingOriginal(v:unknown):SchedulingOriginal{
 const original=parseOriginalOperationReference(v);check(schedulingOriginalKinds.includes(original.commandType as SchedulingOriginalKind));return original as SchedulingOriginal;
}
export function parseSchedulingOriginalResult(v:unknown,input:SchedulingOriginal){
 const original=parseSchedulingOriginal(input);if(fieldOriginalKinds.includes(original.commandType as FieldOriginalKind))return parseFieldOriginalResult(v,parseFieldOriginal(original));if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(v,['schemaVersion','original','result'])&&v.schemaVersion===1);const actual=parseSchedulingOriginal(v.original);
 check(actual.businessId===original.businessId&&actual.commandType===original.commandType&&Object.keys(original.reference).every(k=>(actual.reference as unknown as Record<string,unknown>)[k]===(original.reference as unknown as Record<string,unknown>)[k]));
 const ref=original.reference,business=original.businessId,operation=ref.operationId;
 if(original.commandType==='operations.fulfillment_modes.initialize'||original.commandType==='operations.fulfillment_modes.save'){
  const result=parseFulfillmentModeCommitted(v.result,business,operation);check(result.recoveryEpoch===ref.recoveryEpoch&&BigInt(result.receipt.sequence)===BigInt(original.reference.expectedSequence)+1n);return result;
 }
 if(original.commandType==='operations.job.book'){
  const result=(amended(v.result)?parseAmendedBookedJobCommitted:parseBookedJobCommitted)(v.result,business,operation);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.jobId===original.reference.jobId);return result;
 }
 if(original.commandType==='operations.job.cancel'){
  const result=(amended(v.result)?parseAmendedCancelledJobCommitted:parseCancelledJobCommitted)(v.result,business,operation);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.jobId===original.reference.jobId&&BigInt(result.receipt.version)===BigInt(original.reference.expectedJobVersion)+1n);return result;
 }
 check(original.commandType==='operations.job.reschedule');const result=parseRescheduledJobCommitted(v.result,business,operation);check(result.recoveryEpoch===ref.recoveryEpoch&&result.receipt.jobId===original.reference.jobId&&BigInt(result.receipt.version)===BigInt(original.reference.expectedJobVersion)+1n&&result.receipt.action===original.reference.action);return result;
}
