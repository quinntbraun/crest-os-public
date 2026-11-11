import {customerInstant as instant,customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingLocation,requireBooking as check} from './confirmed-booking-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const dropoffPolicyKind='operations.custody.policy.save' as const;
export const dropoffPolicyConflicts=['mode','configured','operation'] as const;
export const dropoffCustodyKind='operations.custody.save' as const;
export const dropoffCustodyConflicts=['operation','job','version','policy','photo','acknowledgement','vehicle_held'] as const;

const jobStates=['scheduled','en_route','in_progress','paused','completed','cancelled'] as const;
type JobState=typeof jobStates[number];
const states=['expected','not_received','in_custody','awaiting_collection','return_required','released'] as const;
type CustodyState=typeof states[number];
type Scope=Readonly<{businessId:string;jobId:string;jobVehicleId:string;vehicleId?:string}>;
type Policy=Readonly<{id:string;acknowledgementText:string|null;conditionPhotoRequired:boolean}>;
const evidenceKeys=['person','location','notes','missingPhotoReason','acknowledgementConfirmed'];
function text(value:unknown,max:number):value is string{
 return typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&[...value].every(character=>{
  const point=character.codePointAt(0)!;
  return (point===9||point===10||point===13||point>=32&&point!==127)&&(point<0xd800||point>0xdfff);
 });
}
function parsePolicy(value:unknown):Policy|null{
 if(value===null)return null;
 check(exact(value,['id','acknowledgementText','conditionPhotoRequired'])&&uuid(value.id)&&
  (value.acknowledgementText===null||text(value.acknowledgementText,2000))&&typeof value.conditionPhotoRequired==='boolean');
 return Object.freeze({id:value.id,acknowledgementText:value.acknowledgementText,conditionPhotoRequired:value.conditionPhotoRequired});
}
function parseEvidence(value:Record<string,unknown>,businessId:string){
 const photo=value.conditionPhotoId;
 check(exact(value.person,['schemaVersion','displayName'])&&value.person.schemaVersion===1&&text(value.person.displayName,200)&&
  (value.notes===null||text(value.notes,1000))&&
  (value.acknowledgementConfirmed===null||value.acknowledgementConfirmed===true));
 const location=parseBookingLocation(value.location,businessId,businessId);
 check(location.kind==='manual');
 const details={person:Object.freeze({schemaVersion:1 as const,displayName:value.person.displayName}),location,
  notes:value.notes,acknowledgementConfirmed:value.acknowledgementConfirmed};
 if('conditionPhotoId' in value){
  check(uuid(photo)&&value.missingPhotoReason===null);
  return Object.freeze({...details,conditionPhotoId:photo,missingPhotoReason:null});
 }
 check(text(value.missingPhotoReason,1000));
 return Object.freeze({...details,missingPhotoReason:value.missingPhotoReason});
}
function evidenceKeysFor(value:unknown,keys:string[]){
 return typeof value==='object'&&value!==null&&'conditionPhotoId' in value
  ?[...keys,...evidenceKeys,'conditionPhotoId']:[...keys,...evidenceKeys];
}
export function parseDropoffCustody(value:unknown,scope:Scope){
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobState','jobVehicleId','vehicleId','caseId','version','state','policy','events'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&value.businessId===scope.businessId&&uuid(value.jobId)&&value.jobId===scope.jobId&&
  uuid(value.jobVehicleId)&&value.jobVehicleId===scope.jobVehicleId&&uuid(value.vehicleId)&&
  (scope.vehicleId===undefined||scope.vehicleId===value.vehicleId)&&jobStates.includes(value.jobState as JobState)&&
  (value.version==='0'||value.version==='1'||value.version==='2')&&Array.isArray(value.events)&&value.events.length===Number(value.version));
 const {businessId,jobId,jobVehicleId,vehicleId}=value,jobState=value.jobState as JobState,version=value.version;
 const state:CustodyState=version==='2'?'released':version==='1'?
  jobState==='cancelled'?'return_required':jobState==='completed'?'awaiting_collection':'in_custody':
  jobState==='scheduled'?'expected':'not_received';
 check(states.includes(value.state as CustodyState)&&value.state===state&&
  (version==='0'?value.caseId===null:uuid(value.caseId)));
 const caseId=value.caseId as string|null,policy=parsePolicy(value.policy);
 check(version==='0'||policy!==null);
 const events=value.events.map((event:unknown,index:number)=>{
  check(exact(event,evidenceKeysFor(event,['schemaVersion','caseId','jobId','jobVehicleId','vehicleId','eventId','version',
   'action','effectiveAt','recordedAt','authorizationConfigId']))&&
   event.schemaVersion===1&&event.caseId===caseId&&event.jobId===jobId&&event.jobVehicleId===jobVehicleId&&event.vehicleId===vehicleId&&
   uuid(event.eventId)&&event.version===String(index+1)&&event.action===(index===0?'received':'released')&&
   instant(event.effectiveAt)&&instant(event.recordedAt)&&event.effectiveAt<=event.recordedAt&&policy!==null&&
   event.authorizationConfigId===policy.id&&event.acknowledgementConfirmed===(policy.acknowledgementText===null?null:true)&&
   (!policy.conditionPhotoRequired||'conditionPhotoId' in event));
  return Object.freeze({schemaVersion:1 as const,caseId,jobId,jobVehicleId,vehicleId,eventId:event.eventId,version:String(index+1),
   action:event.action,effectiveAt:event.effectiveAt,recordedAt:event.recordedAt,authorizationConfigId:policy.id,...parseEvidence(event,businessId)});
 });
 if(events.length===2)check(events[0]!.eventId!==events[1]!.eventId&&events[0]!.effectiveAt<=events[1]!.effectiveAt&&events[0]!.recordedAt<=events[1]!.recordedAt);
 return Object.freeze({schemaVersion:1 as const,businessId,jobId,jobVehicleId,vehicleId,jobState,state,version,caseId,policy,events:Object.freeze(events)});
}
export type DropoffCustody=Exclude<ReturnType<typeof parseDropoffCustody>,{state:'absent'}>;

export function parseDropoffCustodySave(value:unknown){
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobVehicleId','caseId','expectedVersion','body'])&&
  value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&
  uuid(value.jobVehicleId)&&uuid(value.caseId)&&(value.expectedVersion==='0'||value.expectedVersion==='1'));
 const body=value.body;
 check(exact(body,evidenceKeysFor(body,['authorizationConfigId','effectiveAt']))&&
  uuid(body.authorizationConfigId)&&instant(body.effectiveAt));
 return Object.freeze({schemaVersion:1 as const,businessId:value.businessId,operationId:value.operationId,
  recoveryEpoch:value.recoveryEpoch,jobVehicleId:value.jobVehicleId,caseId:value.caseId,expectedVersion:value.expectedVersion,
  body:Object.freeze({authorizationConfigId:body.authorizationConfigId,effectiveAt:body.effectiveAt,...parseEvidence(body,value.businessId)})});
}
export type DropoffCustodySave=ReturnType<typeof parseDropoffCustodySave>;

export function dropoffCustodyOriginal({businessId,operationId,recoveryEpoch,jobVehicleId,caseId,expectedVersion}:DropoffCustodySave){
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:dropoffCustodyKind,
  reference:{operationId,recoveryEpoch,jobVehicleId,caseId,expectedVersion}});
}

export function parseDropoffCustodyCommitted(value:unknown,request:DropoffCustodySave){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['schemaVersion','caseId','eventId','version'])&&
  value.receipt.schemaVersion===1&&value.receipt.caseId===request.caseId&&uuid(value.receipt.eventId)&&
  value.receipt.version===(request.expectedVersion==='0'?'1':'2'));
}

export function parseDropoffCustodyAcknowledgement(value:unknown,request:DropoffCustodySave){
 const original=dropoffCustodyOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}

export function parseDropoffPolicy(value:unknown,modeVersionId:string){
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['id','modeVersionId','acknowledgementText','conditionPhotoRequired'])&&
  uuid(value.id)&&uuid(value.modeVersionId)&&value.modeVersionId===modeVersionId&&
  (value.acknowledgementText===null||text(value.acknowledgementText,2000))&&typeof value.conditionPhotoRequired==='boolean');
 return Object.freeze({id:value.id,modeVersionId:value.modeVersionId,acknowledgementText:value.acknowledgementText,
  conditionPhotoRequired:value.conditionPhotoRequired});
}

export function parseDropoffPolicySave(value:unknown){
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','modeVersionId','body'])&&value.schemaVersion===1&&
  uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.modeVersionId));
 const body=value.body;
 check(exact(body,['acknowledgementText','conditionPhotoRequired'])&&
  (body.acknowledgementText===null||text(body.acknowledgementText,2000))&&typeof body.conditionPhotoRequired==='boolean');
 return Object.freeze({schemaVersion:1 as const,businessId:value.businessId,operationId:value.operationId,
  recoveryEpoch:value.recoveryEpoch,modeVersionId:value.modeVersionId,body:Object.freeze({...body}) as Readonly<{
   acknowledgementText:string|null;conditionPhotoRequired:boolean
  }>});
}
export type DropoffPolicySave=ReturnType<typeof parseDropoffPolicySave>;
export type SavedDropoffPolicy=Exclude<ReturnType<typeof parseDropoffPolicy>,{state:'absent'}>;

export function dropoffPolicyOriginal({businessId,operationId,recoveryEpoch,modeVersionId}:DropoffPolicySave){
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:dropoffPolicyKind,reference:{operationId,recoveryEpoch,modeVersionId}});
}
export function parseDropoffPolicyCommitted(value:unknown,request:DropoffPolicySave){
 check(exact(value,['state','policy','auditId'])&&value.state==='committed'&&uuid(value.auditId));
 const policy=parseDropoffPolicy(value.policy,request.modeVersionId);
 check(!('state'in policy)&&policy.id===request.operationId&&policy.acknowledgementText===request.body.acknowledgementText&&
  policy.conditionPhotoRequired===request.body.conditionPhotoRequired);
}
export function parseDropoffPolicyAcknowledgement(value:unknown,request:DropoffPolicySave){
 const original=dropoffPolicyOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
