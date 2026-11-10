import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import {parseWorkCorrectionBody} from './job-work-boundary-contract.ts';

export const workStartKind='operations.job.work_start.correct' as const;
export const workStartConflicts=['operation','job','version','state','boundary','occupancy'] as const;
export type WorkStartSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;
 expectedJobVersion:string;workVersionId:string;arrivalVersionId:string|null;body:Readonly<{correctedAt:string;reason:string}>}>;
const utc=(value:unknown):value is string=>instant(value)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);

export function parseWorkStartContext(value:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobVersion','originalStartedAt','startedAt','workVersionId','workEndedAt','arrival'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.jobId===jobId&&version(value.jobVersion)&&
  uuid(value.workVersionId)&&utc(value.originalStartedAt)&&utc(value.startedAt)&&
  (value.workEndedAt===null||utc(value.workEndedAt)&&value.workEndedAt>=value.startedAt));
 const arrival=value.arrival;
 check(arrival===null||exact(arrival,['versionId','departedAt'])&&uuid(arrival.versionId)&&arrival.versionId!==value.workVersionId&&
  utc(arrival.departedAt)&&arrival.departedAt<=value.startedAt);
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,jobVersion:value.jobVersion,
  originalStartedAt:value.originalStartedAt,startedAt:value.startedAt,workVersionId:value.workVersionId,
  workEndedAt:value.workEndedAt,arrival:arrival===null?null:Object.freeze({versionId:arrival.versionId as string,departedAt:arrival.departedAt as string})});
}
export type LoadedWorkStart=Exclude<ReturnType<typeof parseWorkStartContext>,{state:'absent'}>;

export function parseWorkStartSave(value:unknown):WorkStartSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','workVersionId','arrivalVersionId','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.jobId)&&
  version(value.expectedJobVersion)&&BigInt(value.expectedJobVersion)<9223372036854775807n&&uuid(value.workVersionId)&&
  (value.arrivalVersionId===null||uuid(value.arrivalVersionId)&&value.arrivalVersionId!==value.workVersionId));
 return Object.freeze({...value,body:parseWorkCorrectionBody(value.body)}) as WorkStartSave;
}

export function workStartOriginal(request:WorkStartSave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion,workVersionId,arrivalVersionId}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:workStartKind,
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion,workVersionId,arrivalVersionId}});
}

export function parseWorkStartCommitted(value:unknown,request:WorkStartSave){
 const original=workStartOriginal(parseWorkStartSave(request)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
