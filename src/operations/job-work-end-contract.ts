import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import {parseWorkCorrectionBody,workBoundaryConflicts} from './job-work-boundary-contract.ts';

export const workEndKind='operations.job.work_end.correct' as const;
export const workEndConflicts=workBoundaryConflicts;
export type WorkEndSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;
 expectedJobVersion:string;workVersionId:string;completionEventId:string;body:ReturnType<typeof parseWorkCorrectionBody>}>;
const utc=(value:unknown):value is string=>instant(value)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);

export function parseWorkEndContext(value:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobVersion','completionEventId','workVersionId','originalCompletedAt',
  'completedAt','finalIntervalStartedAt','finalIntervalKind'])&&value.schemaVersion===1&&value.businessId===businessId&&
  value.jobId===jobId&&version(value.jobVersion)&&uuid(value.completionEventId)&&uuid(value.workVersionId)&&
  utc(value.originalCompletedAt)&&utc(value.completedAt)&&utc(value.finalIntervalStartedAt)&&
  value.finalIntervalStartedAt<=value.completedAt&&(value.finalIntervalKind==='active'||value.finalIntervalKind==='pause'));
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,jobVersion:value.jobVersion,
  completionEventId:value.completionEventId,workVersionId:value.workVersionId,originalCompletedAt:value.originalCompletedAt,
  completedAt:value.completedAt,finalIntervalStartedAt:value.finalIntervalStartedAt,finalIntervalKind:value.finalIntervalKind});
}
export type LoadedWorkEnd=Exclude<ReturnType<typeof parseWorkEndContext>,{state:'absent'}>;

export function parseWorkEndSave(value:unknown):WorkEndSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','workVersionId','completionEventId','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.jobId)&&
  version(value.expectedJobVersion)&&BigInt(value.expectedJobVersion)<9223372036854775807n&&uuid(value.workVersionId)&&uuid(value.completionEventId));
 return Object.freeze({...value,body:parseWorkCorrectionBody(value.body)}) as WorkEndSave;
}

export function workEndOriginal(request:WorkEndSave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion,workVersionId,completionEventId}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:workEndKind,
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion,workVersionId,completionEventId}});
}

export function parseWorkEndCommitted(value:unknown,request:WorkEndSave){
 const original=workEndOriginal(parseWorkEndSave(request)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
