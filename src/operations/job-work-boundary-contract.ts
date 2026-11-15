import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import type {LoadedJobWorkTime} from './job-work-time-contract.ts';

export const workBoundaryKind='operations.job.work_boundary.correct' as const;
export const workBoundaryConflicts=['operation','job','version','state','boundary','occupancy'] as const;
export type WorkBoundarySave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;
 expectedJobVersion:string;leftVersionId:string;rightVersionId:string;body:Readonly<{correctedAt:string;reason:string}>}>;

export function parseWorkBoundarySave(value:unknown):WorkBoundarySave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','leftVersionId','rightVersionId','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.jobId)&&
  version(value.expectedJobVersion)&&uuid(value.leftVersionId)&&uuid(value.rightVersionId)&&value.leftVersionId!==value.rightVersionId);
 return Object.freeze({...value,body:parseWorkCorrectionBody(value.body)}) as WorkBoundarySave;
}

export function parseWorkCorrectionBody(body:unknown){
 check(exact(body,['correctedAt','reason'])&&instant(body.correctedAt)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(body.correctedAt)&&
  typeof body.reason==='string'&&body.reason.trim().length>0&&[...body.reason].length<=1000&&
  [...body.reason].every(character=>{
   const code=character.codePointAt(0)!;
   return (code>=32&&code!==127&&!(code>=0xd800&&code<=0xdfff))||[9,10,13].includes(code);
  }));
 return Object.freeze({correctedAt:body.correctedAt,reason:body.reason});
}

export function workBoundaryOriginal(request:WorkBoundarySave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion,leftVersionId,rightVersionId}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:workBoundaryKind,
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion,leftVersionId,rightVersionId}});
}

export function parseWorkBoundaryCommitted(value:unknown,request:WorkBoundarySave){
 const original=workBoundaryOriginal(parseWorkBoundarySave(request));
 const result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}

export function workBoundaries(data:LoadedJobWorkTime){
 return data.intervals.flatMap((left,index)=>{
  const right=data.intervals[index+1];
  if(!right||left.kind===right.kind||left.endedAt===null||left.endedAt!==right.startedAt||
   data.intervals[index+2]?.startedAt===left.endedAt)return [];
  return [{leftVersionId:left.versionId,rightVersionId:right.versionId,at:left.endedAt,
   after:left.startedAt,before:right.endedAt??data.record.observedAt,action:left.kind==='active'?'Pause':'Resume'}] as const;
 });
}
