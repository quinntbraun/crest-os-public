import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import {parseWorkCorrectionBody} from './job-work-boundary-contract.ts';

export const mobileDepartureKind='operations.mobile_departure.correct' as const;
export const mobileDepartureConflicts=['operation','trip','version','boundary','occupancy'] as const;
export type MobileDepartureSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 jobId:string;expectedJobVersion:string;legId:string;legVersionId:string;departureEventId:string;body:ReturnType<typeof parseWorkCorrectionBody>}>;
const utc=(value:unknown):value is string=>instant(value)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);

export function parseMobileDepartureContext(value:unknown,businessId:string,jobId:string,legId:string){
 check(uuid(businessId)&&uuid(jobId)&&uuid(legId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobVersion','legId','legVersionId','departureEventId',
  'originalDepartedAt','departedAt','arrivedAt','legState'])&&value.schemaVersion===1&&value.businessId===businessId&&
  value.jobId===jobId&&value.legId===legId&&version(value.jobVersion)&&uuid(value.legVersionId)&&uuid(value.departureEventId)&&
  utc(value.originalDepartedAt)&&utc(value.departedAt)&&(value.arrivedAt===null||utc(value.arrivedAt))&&
  (value.legState==='open'?value.arrivedAt===null:
   (value.legState==='closed'||value.legState==='cancelled')&&value.arrivedAt!==null&&value.arrivedAt>=value.departedAt));
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,legId,jobVersion:value.jobVersion,legVersionId:value.legVersionId,
  departureEventId:value.departureEventId,originalDepartedAt:value.originalDepartedAt,departedAt:value.departedAt,
  arrivedAt:value.arrivedAt,legState:value.legState});
}
export type LoadedMobileDeparture=Exclude<ReturnType<typeof parseMobileDepartureContext>,{state:'absent'}>;

export function parseMobileDepartureSave(value:unknown):MobileDepartureSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','legId','legVersionId','departureEventId','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.jobId)&&
  version(value.expectedJobVersion)&&uuid(value.legId)&&uuid(value.legVersionId)&&uuid(value.departureEventId));
 return Object.freeze({...value,body:parseWorkCorrectionBody(value.body)}) as MobileDepartureSave;
}

export function mobileDepartureOriginal(request:MobileDepartureSave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion,legId,legVersionId,departureEventId}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:mobileDepartureKind,
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion,legId,legVersionId,departureEventId}});
}

export function parseMobileDepartureCommitted(value:unknown,request:MobileDepartureSave){
 const original=mobileDepartureOriginal(parseMobileDepartureSave(request)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
