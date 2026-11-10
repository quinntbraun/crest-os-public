import {randomUUID} from 'node:crypto';
import {originalOperationFixture} from '../support/original-operation-fixture.ts';
import {parseSchedulingOriginal} from '../../src/operations/scheduling-original-contract.ts';
import type {SchedulingOriginalKind} from '../../src/operations/scheduling-original-contract.ts';
import {fieldOriginalKinds,parseFieldOriginal} from '../../src/operations/field-original-contract.ts';
import type {FieldOriginalKind} from '../../src/operations/field-original-contract.ts';
export function schedulingOriginalFixture(kind:SchedulingOriginalKind){
 const original=parseSchedulingOriginal(originalOperationFixture(kind)),ref=original.reference,audit=randomUUID(),latest=randomUUID(),version='expectedJobVersion' in ref?(BigInt(ref.expectedJobVersion)+1n).toString():'1';
 if(fieldOriginalKinds.includes(kind as FieldOriginalKind)){
  const r=parseFieldOriginal(original).reference,receipt={schemaVersion:1,commandType:kind,businessId:original.businessId,actorId:randomUUID(),operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,subjectId:'legId'in r?r.legId:r.jobId,sourceRecordId:'legId'in r?randomUUID():r.jobId,sourceVersion:'legVersionId'in r?'2':'jobId'in r?(BigInt(r.expectedJobVersion)+(kind==='operations.job.work_boundary.correct'?0n:1n)).toString():'expectedEvidenceVersion'in r?(BigInt(r.expectedEvidenceVersion)+1n).toString():r.expectedLegVersionId===null?'1':'2',sourceAuditIds:kind==='operations.job.work_boundary.correct'?[audit,randomUUID()]:(kind==='operations.job.work_start.correct'||kind==='operations.job.work_end.correct')?[audit,randomUUID(),randomUUID()]:[audit]};
  return {original,envelope:{schemaVersion:1,original,result:{state:'committed',receipt}}};
 }
 const receipt=kind.startsWith('operations.fulfillment_modes.')?{schemaVersion:1,businessId:original.businessId,sequence:(BigInt((ref as {expectedSequence:string}).expectedSequence)+1n).toString(),versionId:randomUUID(),auditEventId:audit}:kind==='operations.job.reschedule'?{schemaVersion:1,businessId:original.businessId,jobId:(ref as {jobId:string}).jobId,version,latestAppointmentId:latest,appointmentSequence:'2',currentAppointmentId:randomUUID(),confirmationState:'proposed',action:'propose',jobAuditEventId:audit,sourceAuditIds:[audit]}:{schemaVersion:1,businessId:original.businessId,jobId:(ref as {jobId:string}).jobId,version,appointmentId:latest,appointmentSequence:kind==='operations.job.book'?'1':'2',jobAuditEventId:audit,sourceAuditIds:[audit]};
 return {original,envelope:{schemaVersion:1,original,result:{state:'committed',operationId:ref.operationId,recoveryEpoch:ref.recoveryEpoch,receipt}}};
}
