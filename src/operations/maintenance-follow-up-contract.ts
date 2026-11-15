import {
 customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,
} from '../customer/customer-contract.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const maintenanceFollowUpKind='operations.follow_up.save' as const;
export const maintenanceFollowUpConflicts=['operation','version','scope','closed','snooze','rebooking'] as const;

type Create=Readonly<{
 kind:'created';customerId:string;vehicleId:string|null;sourceJobId:string|null;dueAt:string;reason:string|null;
}>;
type Change=Readonly<{
 kind:'snoozed'|'completed'|'dismissed';snoozedUntil:string|null;rebookingJobId:string|null;reason:string|null;
}>;
export type MaintenanceFollowUpSave=Readonly<{
 schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;taskId:string;expectedVersion:string;body:Create|Change;
}>;
const nullableUuid=(value:unknown):value is string|null=>value===null||uuid(value);
function validReason(value:unknown,required=false):value is string|null{
 if(value===null)return !required;
 return typeof value==='string'&&value.length<=2000&&value.trim().length>0&&[...value].length<=1000&&
  [...value].every(character=>{
   const point=character.codePointAt(0)!;
   return point===9||point===10||point===13||point>=32&&point!==127&&(point<0xd800||point>0xdfff);
  });
}
function parseBody(value:unknown):Create|Change{
 if(exact(value,['kind','customerId','vehicleId','sourceJobId','dueAt','reason'])){
  check(value.kind==='created'&&uuid(value.customerId)&&nullableUuid(value.vehicleId)&&nullableUuid(value.sourceJobId)&&
   instant(value.dueAt)&&validReason(value.reason));
  return Object.freeze({kind:value.kind,customerId:value.customerId,vehicleId:value.vehicleId,sourceJobId:value.sourceJobId,
   dueAt:value.dueAt,reason:value.reason});
 }
 check(exact(value,['kind','snoozedUntil','rebookingJobId','reason'])&&
  (value.kind==='snoozed'||value.kind==='completed'||value.kind==='dismissed')&&
  (value.kind==='snoozed'?instant(value.snoozedUntil):value.snoozedUntil===null)&&
  nullableUuid(value.rebookingJobId)&&(value.kind!=='dismissed'||value.rebookingJobId===null)&&validReason(value.reason,value.kind==='dismissed'));
 return Object.freeze({kind:value.kind,snoozedUntil:value.snoozedUntil as string|null,rebookingJobId:value.rebookingJobId,reason:value.reason});
}
export function parseMaintenanceFollowUpSave(value:unknown):MaintenanceFollowUpSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','taskId','expectedVersion','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.taskId)&&
  version(value.expectedVersion,true)&&value.expectedVersion!=='9223372036854775807');
 const body=parseBody(value.body);
 check((body.kind==='created')===(value.expectedVersion==='0'));
 return Object.freeze({schemaVersion:1,businessId:value.businessId,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
  taskId:value.taskId,expectedVersion:value.expectedVersion,body});
}

export function maintenanceFollowUpOriginal(request:MaintenanceFollowUpSave){
 const {businessId,operationId,recoveryEpoch,taskId,expectedVersion,body}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:maintenanceFollowUpKind,
  reference:{operationId,recoveryEpoch,taskId,expectedVersion,action:body.kind}});
}

export function parseMaintenanceFollowUpAcknowledgement(value:unknown,request:MaintenanceFollowUpSave){
 const original=maintenanceFollowUpOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}

export function parseMaintenanceFollowUpRecord(value:unknown,taskId:string){
 check(exact(value,['schemaVersion','taskId','customerId','vehicleId','sourceJobId','dueAt','version','eventId','state','snoozedUntil','rebookingJobId','reason','recordedAt'])&&
  value.schemaVersion===1&&uuid(value.taskId)&&value.taskId===taskId&&uuid(value.customerId)&&nullableUuid(value.vehicleId)&&
  nullableUuid(value.sourceJobId)&&instant(value.dueAt)&&version(value.version)&&uuid(value.eventId)&&instant(value.recordedAt)&&
  (value.state==='open'||value.state==='snoozed'||value.state==='completed'||value.state==='dismissed')&&
  (value.state==='open')===(value.version==='1')&&
  (value.state==='snoozed'?instant(value.snoozedUntil):value.snoozedUntil===null)&&
  nullableUuid(value.rebookingJobId)&&((value.state==='snoozed'||value.state==='completed')||value.rebookingJobId===null)&&
  validReason(value.reason,value.state==='dismissed'));
 return Object.freeze({schemaVersion:1 as const,taskId,customerId:value.customerId,vehicleId:value.vehicleId,sourceJobId:value.sourceJobId,
  dueAt:value.dueAt,version:value.version,eventId:value.eventId,state:value.state,snoozedUntil:value.snoozedUntil as string|null,
  rebookingJobId:value.rebookingJobId,reason:value.reason,recordedAt:value.recordedAt});
}

type MaintenanceFollowUpReference=Pick<MaintenanceFollowUpSave,'businessId'|'operationId'|'taskId'|'expectedVersion'>&
 Readonly<{kind:MaintenanceFollowUpSave['body']['kind']}>;
function parseReceipt(value:unknown,reference:MaintenanceFollowUpReference){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&
  exact(value.receipt,['schemaVersion','businessId','operationId','record','auditId'])&&value.receipt.schemaVersion===1&&
  value.receipt.businessId===reference.businessId&&value.receipt.operationId===reference.operationId&&uuid(value.receipt.auditId));
 const record=parseMaintenanceFollowUpRecord(value.receipt.record,reference.taskId);
 check(BigInt(record.version)===BigInt(reference.expectedVersion)+1n&&record.state===(reference.kind==='created'?'open':reference.kind));
 return Object.freeze({state:'committed' as const,receipt:Object.freeze({schemaVersion:1 as const,businessId:reference.businessId,
  operationId:reference.operationId,record,auditId:value.receipt.auditId})});
}

export function parseMaintenanceFollowUpCommitted(value:unknown,raw:MaintenanceFollowUpSave){
 const request=parseMaintenanceFollowUpSave(raw),body=request.body;
 const saved=parseReceipt(value,{...request,kind:body.kind}),record=saved.receipt.record;
 check(record.reason===body.reason);
 if(body.kind==='created'){
  check(record.customerId===body.customerId&&record.vehicleId===body.vehicleId&&
   record.sourceJobId===body.sourceJobId&&record.dueAt===body.dueAt);
 }else check(record.snoozedUntil===body.snoozedUntil&&record.rebookingJobId===body.rebookingJobId);
 return saved;
}

export function parseMaintenanceFollowUpOriginal(value:unknown,reference:MaintenanceFollowUpReference){
 check(uuid(reference.businessId)&&uuid(reference.operationId)&&uuid(reference.taskId)&&version(reference.expectedVersion,true)&&
  reference.expectedVersion!=='9223372036854775807'&&['created','snoozed','completed','dismissed'].includes(reference.kind)&&
  (reference.kind==='created')===(reference.expectedVersion==='0'));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 return parseReceipt(value,reference);
}

export function parseMaintenanceFollowUpHistoryQuery(value:unknown){
 check(exact(value,['taskId','afterVersion'])&&uuid(value.taskId)&&version(value.afterVersion,true));
 return Object.freeze({taskId:value.taskId,afterVersion:value.afterVersion});
}

export function parseMaintenanceFollowUpHistory(value:unknown,businessId:string,taskId:string,afterVersion:string){
 check(uuid(businessId)&&uuid(taskId)&&version(afterVersion,true));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','taskId','entries','current','hasMore'])&&value.schemaVersion===1&&
  value.businessId===businessId&&value.taskId===taskId&&Array.isArray(value.entries)&&value.entries.length<=20&&typeof value.hasMore==='boolean');
 const current=parseMaintenanceFollowUpRecord(value.current,taskId),entries=value.entries.map(entry=>parseMaintenanceFollowUpRecord(entry,taskId));
 const after=BigInt(afterVersion),head=BigInt(current.version);
 check(head>=after&&entries.length===Number(head-after>20n?20n:head-after)&&value.hasMore===(head-after>20n));
 check(entries.every((entry,index)=>BigInt(entry.version)===after+BigInt(index)+1n&&
  entry.customerId===current.customerId&&entry.vehicleId===current.vehicleId&&entry.sourceJobId===current.sourceJobId&&entry.dueAt===current.dueAt));
 check(value.hasMore||entries.length===0||JSON.stringify(entries.at(-1))===JSON.stringify(current));
 return Object.freeze({state:'found' as const,businessId,taskId,current,entries:Object.freeze(entries),hasMore:value.hasMore});
}

type FollowUpCursor=Readonly<{taskId:string;effectiveDueAt:string}>;
type FollowUpScope=Readonly<{scopeKind:'due';scopeId:null;throughAt:string}>|
 Readonly<{scopeKind:'customer'|'job';scopeId:string;throughAt:null}>;
function parseCursor(value:unknown):FollowUpCursor{
 check(exact(value,['taskId','effectiveDueAt'])&&uuid(value.taskId)&&instant(value.effectiveDueAt));
 return Object.freeze({taskId:value.taskId,effectiveDueAt:value.effectiveDueAt});
}
export function parseMaintenanceFollowUpListQuery(value:unknown){
 check(exact(value,['scopeKind','scopeId','throughAt','afterDueAt','afterTaskId']));
 let scope:FollowUpScope;
 if(value.scopeKind==='due'){
  check(value.scopeId===null&&instant(value.throughAt));
  scope=Object.freeze({scopeKind:'due',scopeId:null,throughAt:value.throughAt});
 }else{
  check((value.scopeKind==='customer'||value.scopeKind==='job')&&uuid(value.scopeId)&&value.throughAt===null);
  scope=Object.freeze({scopeKind:value.scopeKind,scopeId:value.scopeId,throughAt:null});
 }
 const after=value.afterDueAt===null&&value.afterTaskId===null?null:
  parseCursor({taskId:value.afterTaskId,effectiveDueAt:value.afterDueAt});
 return Object.freeze({scope,after});
}
const sortKey=(row:FollowUpCursor)=>row.effectiveDueAt+':'+row.taskId;

export function parseMaintenanceFollowUpList(value:unknown,businessId:string,scope:FollowUpScope,after:FollowUpCursor|null){
 check(uuid(businessId)&&(scope.scopeKind==='due'?scope.scopeId===null&&instant(scope.throughAt):
  (scope.scopeKind==='customer'||scope.scopeKind==='job')&&uuid(scope.scopeId)&&scope.throughAt===null));
 check(exact(value,['schemaVersion','businessId','scopeKind','scopeId','throughAt','entries','next'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.scopeKind===scope.scopeKind&&value.scopeId===scope.scopeId&&
  value.throughAt===scope.throughAt&&Array.isArray(value.entries)&&value.entries.length<=20);
 let previous=after===null?null:sortKey(parseCursor(after));
 const entries=value.entries.map(entry=>{
  check(exact(entry,['record','customerName','vehicleLabel','effectiveDueAt'])&&
   typeof entry.customerName==='string'&&entry.customerName.length>0&&entry.customerName.length<=400&&
   (entry.vehicleLabel===null||typeof entry.vehicleLabel==='string'&&entry.vehicleLabel.length>0&&entry.vehicleLabel.length<=400)&&
   instant(entry.effectiveDueAt)&&entry.record&&typeof entry.record==='object'&&'taskId' in entry.record&&uuid(entry.record.taskId));
  const record=parseMaintenanceFollowUpRecord(entry.record,entry.record.taskId),key=sortKey({taskId:record.taskId,effectiveDueAt:entry.effectiveDueAt});
  check((previous===null||key>previous)&&entry.effectiveDueAt===(record.snoozedUntil??record.dueAt));
  check(scope.scopeKind==='due'?(record.state==='open'||record.state==='snoozed')&&entry.effectiveDueAt<scope.throughAt:
   scope.scopeId===(scope.scopeKind==='customer'?record.customerId:record.sourceJobId));
  previous=key;
  return Object.freeze({record,customerName:entry.customerName,vehicleLabel:entry.vehicleLabel,effectiveDueAt:entry.effectiveDueAt});
 });
 check(new Set(entries.map(entry=>entry.record.taskId)).size===entries.length);
 const next=value.next===null?null:parseCursor(value.next);
 if(next)check(entries.length===20&&sortKey(next)===previous);
 return Object.freeze({schemaVersion:1 as const,businessId,...scope,entries:Object.freeze(entries),next});
}
