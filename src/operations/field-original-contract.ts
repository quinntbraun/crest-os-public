import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOriginalOperationReference} from '../security/original-operation-reference.ts';
import type {OriginalOperationReference} from '../security/original-operation-reference.ts';
export const fieldOriginalKinds=['operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.job.work_boundary.correct','operations.job.work_start.correct','operations.job.work_end.correct','operations.mobile_departure.correct','operations.message.record_outcome','operations.follow_up.save','operations.custody.save','operations.custody.policy.save','operations.custody.policy.revise','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct','operations.pickup_trip.record','operations.pickup_custody.collect','operations.pickup_custody.policy.save'] as const;
export type FieldOriginalKind=typeof fieldOriginalKinds[number];
export type FieldOriginal=Extract<OriginalOperationReference,{commandType:FieldOriginalKind}>;
export class FieldOriginalError extends Error{constructor(){super('FIELD_ORIGINAL_REVIEW_REQUIRED');this.name='FieldOriginalError';}}
function check(v:unknown):asserts v{if(!v)throw new FieldOriginalError();}
export function parseFieldOriginal(value:unknown):FieldOriginal{
 try{const v=parseOriginalOperationReference(value);check(fieldOriginalKinds.includes(v.commandType as FieldOriginalKind));return v as FieldOriginal;}catch{throw new FieldOriginalError();}
}
// This minimized recovery receipt is emitted only after the database's full
// domain lookup has independently verified immutable source/audit closure.
// It is not the generic original_recorded observation or a domain export.
export function parseFieldOriginalResult(value:unknown,input:FieldOriginal){
 const original=parseFieldOriginal(input);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','original','result'])&&value.schemaVersion===1);
 const actual=parseFieldOriginal(value.original);check(JSON.stringify(actual)===JSON.stringify(original));
 check(exact(value.result,['state','receipt'])&&value.result.state==='committed');
 const r=value.result.receipt,ref=original.reference;
 check(exact(r,['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','subjectId','sourceRecordId','sourceVersion','sourceAuditIds'])&&r.schemaVersion===1&&r.commandType===original.commandType&&r.businessId===original.businessId&&uuid(r.actorId)&&r.operationId===ref.operationId&&r.recoveryEpoch===ref.recoveryEpoch&&uuid(r.subjectId)&&uuid(r.sourceRecordId)&&version(r.sourceVersion)&&Array.isArray(r.sourceAuditIds)&&r.sourceAuditIds.length>0&&r.sourceAuditIds.length<=10000&&r.sourceAuditIds.every(uuid)&&new Set(r.sourceAuditIds).size===r.sourceAuditIds.length);
 if(original.commandType==='operations.job.work_boundary.correct'){
  check(r.subjectId===original.reference.jobId&&r.sourceRecordId===original.reference.jobId&&
   r.sourceVersion===original.reference.expectedJobVersion&&r.sourceAuditIds.length===2);
 }
 else if(original.commandType==='operations.job.work_start.correct'){
  check(r.subjectId===original.reference.jobId&&r.sourceRecordId===original.reference.jobId&&
   BigInt(r.sourceVersion)===BigInt(original.reference.expectedJobVersion)+1n&&
   r.sourceAuditIds.length===(original.reference.arrivalVersionId===null?3:4));
 }
 else if(original.commandType==='operations.mobile_departure.correct'){
  check(r.subjectId===original.reference.legId&&r.sourceRecordId!==original.reference.legVersionId&&
   r.sourceRecordId!==original.reference.legId&&BigInt(r.sourceVersion)>1n&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.message.record_outcome'){
  check(r.subjectId===original.reference.messageId&&r.sourceRecordId!==original.reference.priorEventId&&
   r.sourceRecordId!==original.reference.messageId&&r.sourceVersion==='1'&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.custody.policy.save'){
  check(r.subjectId===original.reference.modeVersionId&&r.sourceRecordId===ref.operationId&&r.sourceVersion==='1'&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.custody.policy.revise'){
  check(r.subjectId===original.reference.modeVersionId&&r.sourceRecordId===ref.operationId&&
   BigInt(r.sourceVersion)>1n&&r.sourceAuditIds.length===2);
 }
 else if(original.commandType==='operations.custody.save'){
  check(r.subjectId===original.reference.caseId&&r.sourceRecordId!==r.subjectId&&
   r.sourceVersion===(original.reference.expectedVersion==='0'?'1':'2')&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.follow_up.save'){
  check(r.subjectId===original.reference.taskId&&r.sourceRecordId!==original.reference.taskId&&
   BigInt(r.sourceVersion)===BigInt(original.reference.expectedVersion)+1n&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.pickup_trip.record'){
  const target=original.reference;
  check(r.subjectId===target.legId&&r.sourceAuditIds.length===1&&(target.action==='depart'?
   r.sourceVersion==='1'&&r.sourceRecordId===target.legId:
   r.sourceVersion==='2'&&r.sourceRecordId!==target.expectedLegVersionId&&r.sourceRecordId!==target.legId));
 }
 else if(original.commandType==='operations.pickup_custody.policy.save'){
  check(r.subjectId===original.businessId&&r.sourceRecordId===ref.operationId&&
   BigInt(r.sourceVersion)===BigInt(original.reference.expectedSequence)+1n&&r.sourceAuditIds.length===1);
 }
 else if(original.commandType==='operations.pickup_custody.collect'){
  check(r.subjectId===original.reference.jobVehicleId&&r.sourceRecordId===ref.operationId&&r.sourceVersion==='1'&&r.sourceAuditIds.length===1);
 }
 else if('expectedJobVersion' in ref){
  check(r.subjectId===ref.jobId&&r.sourceRecordId===ref.jobId&&BigInt(r.sourceVersion)===BigInt(ref.expectedJobVersion)+1n);
  if(original.commandType==='operations.job.work_end.correct')check(r.sourceAuditIds.length===3);
 }
 else if('expectedEvidenceVersion' in ref){check(r.subjectId===ref.legId&&BigInt(r.sourceVersion)===BigInt(ref.expectedEvidenceVersion)+1n);}
 else{check('expectedLegVersionId' in ref&&r.subjectId===ref.legId&&(ref.expectedLegVersionId===null?r.sourceVersion==='1':BigInt(r.sourceVersion)>1n));}
 return Object.freeze({state:'committed' as const,receipt:Object.freeze({schemaVersion:1 as const,commandType:r.commandType,businessId:r.businessId,actorId:r.actorId,operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,subjectId:r.subjectId,sourceRecordId:r.sourceRecordId,sourceVersion:r.sourceVersion,sourceAuditIds:Object.freeze([...r.sourceAuditIds])})});
}
