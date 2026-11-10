import {customerInstant as instant,customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {isReviewOutcomeAction} from '../security/original-operation-reference.ts';
import type {ReviewOutcomeAction} from '../security/original-operation-reference.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const reviewOutcomeKind='operations.message.record_outcome' as const;
export const reviewOutcomeConflicts=['operation','message','version','sent'] as const;
export type ReviewOutcomeBody=Readonly<{kind:ReviewOutcomeAction;reason:string|null}>;
export type ReviewOutcomeSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 jobId:string;messageId:string;priorEventId:string;body:ReviewOutcomeBody}>;

function validReason(kind:ReviewOutcomeAction|'prepared',reason:unknown):reason is string|null{
 if(reason===null)return kind!=='failed'&&kind!=='skipped';
 return typeof reason==='string'&&reason.length<=2000&&reason.trim().length>0&&[...reason].length<=1000&&
  [...reason].every(character=>{
   const point=character.codePointAt(0)!;
   return point===9||point===10||point===13||point>=32&&point!==127&&(point<0xd800||point>0xdfff);
  });
}

export function parseReviewOutcomeContext(value:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','messageId','eventId','kind','reason','effectiveAt'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.jobId===jobId&&uuid(value.messageId)&&
  uuid(value.eventId)&&(value.kind==='prepared'||isReviewOutcomeAction(value.kind))&&
  validReason(value.kind,value.reason)&&instant(value.effectiveAt));
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,messageId:value.messageId,eventId:value.eventId,
  kind:value.kind,reason:value.reason,effectiveAt:value.effectiveAt});
}
export type ReviewOutcomeContext=Exclude<ReturnType<typeof parseReviewOutcomeContext>,{state:'absent'}>;

export function parseReviewOutcomeSave(value:unknown):ReviewOutcomeSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','messageId','priorEventId','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&
  uuid(value.jobId)&&uuid(value.messageId)&&uuid(value.priorEventId)&&exact(value.body,['kind','reason'])&&
  isReviewOutcomeAction(value.body.kind)&&validReason(value.body.kind,value.body.reason));
 return Object.freeze({...value,body:Object.freeze({kind:value.body.kind,reason:value.body.reason})}) as ReviewOutcomeSave;
}

export function reviewOutcomeOriginal(request:ReviewOutcomeSave){
 const {businessId,operationId,recoveryEpoch,jobId,messageId,priorEventId,body}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:reviewOutcomeKind,
  reference:{operationId,recoveryEpoch,jobId,messageId,priorEventId,action:body.kind}});
}

export function parseReviewOutcomeCommitted(value:unknown,request:ReviewOutcomeSave){
 const original=reviewOutcomeOriginal(parseReviewOutcomeSave(request)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
