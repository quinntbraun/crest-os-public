import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingCommunication,requireBooking as check} from './confirmed-booking-contract.ts';
import type {BookingCommunication} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import {parseFieldScopeObservations} from './trip-interruption-contract.ts';
import type {FieldScopeObservation} from './trip-interruption-contract.ts';

export type UnfulfilledCancellationContext=Readonly<{schemaVersion:1;businessId:string;jobId:string;jobVersion:string;
 jobState:'in_progress'|'paused';workIntervalId:string;openTravelLegVersionIds:readonly string[];
 scope:readonly FieldScopeObservation[]}>;
export type UnfulfilledCancellationDraft=Readonly<{reason:string;noFulfilledScopeConfirmed:true;customerCommunication:BookingCommunication}>;
export type UnfulfilledCancellationSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 jobId:string;expectedJobVersion:string;body:UnfulfilledCancellationDraft&Readonly<{expectedWorkIntervalId:string;
 expectedOpenTravelLegVersionIds:readonly string[];scope:readonly FieldScopeObservation[]}>}>;
export const unfulfilledCancellationConflicts=['operation','job','version','state','scope','work','travel'] as const;
const currentVersion=(value:unknown):value is string=>version(value)&&BigInt(value)<9223372036854775807n;
function cancellationReason(value:unknown):value is string{
 return typeof value==='string'&&value.trim().length>0&&[...value].length<=1000&&[...value].every(character=>{
  const code=character.codePointAt(0)!;
  return (code>=32&&code!==127&&!(code>=0xd800&&code<=0xdfff))||[9,10,13].includes(code);
 });
}
function travelIds(value:unknown):readonly string[]{
 check(Array.isArray(value)&&value.length<=1&&Reflect.ownKeys(value).length===value.length+1);
 if(value.length===0)return Object.freeze([]);
 const entry=Object.getOwnPropertyDescriptor(value,'0');
 check(entry?.enumerable&&Object.hasOwn(entry,'value')&&uuid(entry.value));
 return Object.freeze([entry.value]);
}
export function parseUnfulfilledCancellationContext(value:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobVersion','jobState','workIntervalId','openTravelLegVersionIds','scope'])
  &&value.schemaVersion===1&&value.businessId===businessId&&value.jobId===jobId&&currentVersion(value.jobVersion)
  &&(value.jobState==='in_progress'||value.jobState==='paused')&&uuid(value.workIntervalId));
 const {jobVersion,jobState,workIntervalId}=value;
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,jobVersion,jobState,workIntervalId,
  openTravelLegVersionIds:travelIds(value.openTravelLegVersionIds),scope:parseFieldScopeObservations(value.scope)});
}
export function unfulfilledCancellationOriginal(request:UnfulfilledCancellationSave){
 const {businessId,operationId,recoveryEpoch,jobId,expectedJobVersion}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:'operations.job.cancel_unfulfilled',
  reference:{operationId,recoveryEpoch,jobId,expectedJobVersion}});
}
export function parseUnfulfilledCancellationSave(value:unknown):UnfulfilledCancellationSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','body'])
  &&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)
  &&uuid(value.jobId)&&currentVersion(value.expectedJobVersion));
 const body=value.body;
 check(exact(body,['reason','noFulfilledScopeConfirmed','expectedWorkIntervalId','expectedOpenTravelLegVersionIds','customerCommunication','scope'])
  &&body.noFulfilledScopeConfirmed===true&&uuid(body.expectedWorkIntervalId)&&cancellationReason(body.reason));
 return Object.freeze({schemaVersion:1,businessId:value.businessId,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
  jobId:value.jobId,expectedJobVersion:value.expectedJobVersion,body:Object.freeze({reason:body.reason,noFulfilledScopeConfirmed:true,
   expectedWorkIntervalId:body.expectedWorkIntervalId,expectedOpenTravelLegVersionIds:travelIds(body.expectedOpenTravelLegVersionIds),
   scope:parseFieldScopeObservations(body.scope),customerCommunication:parseBookingCommunication(body.customerCommunication)})});
}
export function parseUnfulfilledCancellationCommitted(value:unknown,request:UnfulfilledCancellationSave){
 const original=unfulfilledCancellationOriginal(parseUnfulfilledCancellationSave(request));
 const result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
