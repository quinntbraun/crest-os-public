import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const pickupReturnFailureKind='operations.pickup_custody.fail_return' as const;
export const pickupReturnFailureConflicts=['job','job_version','custody','released','arrival','failed','operation'] as const;
export const pickupReleaseKind='operations.pickup_custody.release' as const;
export const pickupReleaseConflicts=['job','job_version','custody','released','photo','acknowledgement','arrival','operation'] as const;
export const pickupCollectionKind='operations.pickup_custody.collect' as const;
export const pickupCollectionConflicts=['job','job_version','vehicle','policy','photo','acknowledgement','arrival','vehicle_held','collected','operation'] as const;

export type PickupPhotoBinding=Readonly<{arrivalVersionId:string;jobVersion:string}&({policyId:string}|{collectionId:string})>;

type Scope=Readonly<{businessId:string;jobId:string;jobVehicleId:string}>;
type Body=Readonly<{
 effectiveAt:string;
 person:Readonly<{schemaVersion:1;displayName:string}>;
 location:Readonly<{schemaVersion:1;kind:'manual';locationText:string;instructions:string|null}>;
 notes:string|null;
 missingPhotoReason:string|null;
 conditionPhotoId?:string;
 acknowledgementConfirmed:true|null;
}>;
export type PickupReleaseSave=Readonly<{
 schemaVersion:1;businessId:string;jobId:string;expectedJobVersion:string;collectionId:string;returnLegVersionId:string;
 operationId:string;recoveryEpoch:string;body:Body;
}>;
export type PickupCollectionSave=Scope&Readonly<{
 schemaVersion:1;expectedJobVersion:string;pickupLegVersionId:string;policyId:string;operationId:string;recoveryEpoch:string;body:Body;
}>;
const states=['awaiting_arrival','requires_policy','ready','vehicle_held','photo_required','held','awaiting_return','return_required','return_failed','ready_to_release','released','closed'] as const;
function check(condition:unknown):asserts condition{if(!condition)throw Error('PICKUP_COLLECTION_DATA_REQUIRED');}
function text(value:unknown,max:number):value is string{
 return typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&[...value].every(character=>{
  const code=character.codePointAt(0)!;
  return code===9||code===10||code===13||code>=32&&code!==127&&(code<0xd800||code>0xdfff);
 });
}
function parseBody(body:unknown):Body{
 const keys=['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed'];
 const photo=body!==null&&typeof body==='object'&&Object.hasOwn(body,'conditionPhotoId');
 check(exact(body,photo?[...keys,'conditionPhotoId']:keys));
 const {person,location}=body;
 check(instant(body.effectiveAt)&&exact(person,['schemaVersion','displayName'])&&person.schemaVersion===1&&text(person.displayName,200));
 check(exact(location,['schemaVersion','kind','locationText','instructions'])&&location.schemaVersion===1&&location.kind==='manual'&&
  text(location.locationText,2000)&&(location.instructions===null||text(location.instructions,2000)));
 check((body.notes===null||text(body.notes,1000))&&
  (photo?uuid(body.conditionPhotoId)&&body.missingPhotoReason===null:text(body.missingPhotoReason,1000))&&
  (body.acknowledgementConfirmed===null||body.acknowledgementConfirmed===true));
 return Object.freeze({...body,person:Object.freeze(person),location:Object.freeze(location)}) as Body;
}
export function parsePickupCollectionSave(value:unknown):PickupCollectionSave{
 check(exact(value,['schemaVersion','businessId','jobId','jobVehicleId','expectedJobVersion','pickupLegVersionId','policyId','operationId','recoveryEpoch','body']));
 check(value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.jobId)&&uuid(value.jobVehicleId)&&
  version(value.expectedJobVersion)&&BigInt(value.expectedJobVersion)<9223372036854775807n&&uuid(value.pickupLegVersionId)&&
  uuid(value.policyId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch));
 return Object.freeze({...value,body:parseBody(value.body)}) as PickupCollectionSave;
}
export function pickupCollectionOriginal(request:PickupCollectionSave){
 const {businessId,jobId,jobVehicleId,expectedJobVersion,pickupLegVersionId,policyId,operationId,recoveryEpoch}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:pickupCollectionKind,
  reference:{jobId,jobVehicleId,expectedJobVersion,pickupLegVersionId,policyId,operationId,recoveryEpoch}});
}
export function parsePickupCollectionAcknowledgement(value:unknown,request:PickupCollectionSave){
 const original=pickupCollectionOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
function parseCollectionRow(value:unknown,scope:Scope){
 const keys=['id','business_id','job_id','job_vehicle_id','vehicle_id','pickup_leg_version_id','policy_id','effective_at','recorded_at',
  'person_snapshot','location_snapshot','notes','missing_photo_reason','acknowledgement_confirmed','created_by','operation_id'];
 const photo=value!==null&&typeof value==='object'&&Object.hasOwn(value,'condition_photo_id');
 check(exact(value,photo?[...keys,'condition_photo_id']:keys));
 check(uuid(value.id)&&value.operation_id===value.id&&value.business_id===scope.businessId&&value.job_id===scope.jobId&&
  value.job_vehicle_id===scope.jobVehicleId&&uuid(value.vehicle_id)&&uuid(value.pickup_leg_version_id)&&
  uuid(value.policy_id)&&uuid(value.created_by)&&instant(value.recorded_at));
 const body=parseBody({effectiveAt:value.effective_at,person:value.person_snapshot,location:value.location_snapshot,notes:value.notes,
  missingPhotoReason:value.missing_photo_reason,acknowledgementConfirmed:value.acknowledgement_confirmed,
  ...(photo?{conditionPhotoId:value.condition_photo_id}:{})});
 check(body.effectiveAt<=value.recorded_at);
 return Object.freeze({id:value.id,vehicleId:value.vehicle_id,policyId:value.policy_id,pickupLegVersionId:value.pickup_leg_version_id,recordedAt:value.recorded_at,body});
}
export function verifyPickupCollectionWrite(value:unknown,request:PickupCollectionSave){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['collection','auditId'])&&uuid(value.receipt.auditId));
 const row=parseCollectionRow(value.receipt.collection,request);
 check(row.id===request.operationId&&row.policyId===request.policyId&&row.pickupLegVersionId===request.pickupLegVersionId&&
  row.body.effectiveAt===request.body.effectiveAt&&row.body.person.displayName===request.body.person.displayName&&
  row.body.location.locationText===request.body.location.locationText&&row.body.location.instructions===request.body.location.instructions&&
  row.body.notes===request.body.notes&&row.body.missingPhotoReason===request.body.missingPhotoReason&&
  row.body.acknowledgementConfirmed===request.body.acknowledgementConfirmed&&row.body.conditionPhotoId===request.body.conditionPhotoId);
}
function parsePolicy(value:unknown){
 if(value===null)return null;
 check(exact(value,['id','conditionPhotoRequired','acknowledgementText'])&&uuid(value.id)&&typeof value.conditionPhotoRequired==='boolean'&&
  (value.acknowledgementText===null||text(value.acknowledgementText,2000)));
 return {id:value.id,conditionPhotoRequired:value.conditionPhotoRequired,acknowledgementText:value.acknowledgementText};
}
function parseArrival(value:unknown){
 if(value===null)return null;
 check(exact(value,['versionId','arrivedAt'])&&uuid(value.versionId)&&instant(value.arrivedAt));
 return {versionId:value.versionId,arrivedAt:value.arrivedAt};
}
type PickupReturnReference=Omit<PickupReleaseSave,'body'>;
export type PickupReturnFailureSave=PickupReturnReference&Readonly<{body:Readonly<{reason:string}>}>;
function returnReference(value:unknown):asserts value is PickupReturnReference&{body:unknown}{
 check(exact(value,['schemaVersion','businessId','jobId','expectedJobVersion','collectionId','returnLegVersionId','operationId','recoveryEpoch','body']));
 check(value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.jobId)&&uuid(value.collectionId)&&uuid(value.returnLegVersionId)&&
  version(value.expectedJobVersion)&&BigInt(value.expectedJobVersion)<9223372036854775807n&&
  uuid(value.operationId)&&value.operationId!==value.collectionId&&uuid(value.recoveryEpoch));
}
export function parsePickupReleaseSave(value:unknown):PickupReleaseSave{
 returnReference(value);
 return Object.freeze({...value,body:parseBody(value.body)});
}
export function parsePickupReturnFailureSave(value:unknown):PickupReturnFailureSave{
 returnReference(value);
 check(exact(value.body,['reason'])&&text(value.body.reason,1000)&&value.body.reason.trim()===value.body.reason);
 return Object.freeze({...value,body:Object.freeze({reason:value.body.reason})});
}
export function pickupReturnFailureOriginal(request:PickupReturnFailureSave){
 const {businessId,jobId,expectedJobVersion,collectionId,returnLegVersionId,operationId,recoveryEpoch}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:pickupReturnFailureKind,
  reference:{jobId,expectedJobVersion,collectionId,returnLegVersionId,operationId,recoveryEpoch}});
}
export function parsePickupReturnFailureAcknowledgement(value:unknown,request:PickupReturnFailureSave){
 const original=pickupReturnFailureOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
function failureRow(value:unknown){
 check(exact(value,['id','business_id','collection_id','return_leg_version_id','job_version','reason','recorded_at','created_by','operation_id'])&&
  uuid(value.id)&&value.operation_id===value.id&&uuid(value.business_id)&&uuid(value.collection_id)&&
  uuid(value.return_leg_version_id)&&uuid(value.created_by)&&version(value.job_version)&&
  instant(value.recorded_at)&&text(value.reason,1000)&&value.reason===value.reason.trim());
 return value;
}
export function verifyPickupReturnFailureWrite(value:unknown,request:PickupReturnFailureSave){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['failure','auditId'])&&uuid(value.receipt.auditId));
 const row=failureRow(value.receipt.failure);
 check(row.id===request.operationId&&row.business_id===request.businessId&&row.collection_id===request.collectionId&&
  row.return_leg_version_id===request.returnLegVersionId&&row.job_version===request.expectedJobVersion&&row.reason===request.body.reason);
}
export function pickupReleaseOriginal(request:PickupReleaseSave){
 const {businessId,jobId,expectedJobVersion,collectionId,returnLegVersionId,operationId,recoveryEpoch}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:pickupReleaseKind,
  reference:{jobId,expectedJobVersion,collectionId,returnLegVersionId,operationId,recoveryEpoch}});
}
export function parsePickupReleaseAcknowledgement(value:unknown,request:PickupReleaseSave){
 const original=pickupReleaseOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
function releaseRow(value:unknown){
 const keys=['id','business_id','collection_id','job_id','job_vehicle_id','vehicle_id','policy_id','return_leg_version_id','job_version',
  'effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason','acknowledgement_confirmed','created_by','operation_id'];
 const photo=value!==null&&typeof value==='object'&&Object.hasOwn(value,'condition_photo_id');
 check(exact(value,photo?[...keys,'condition_photo_id']:keys)&&uuid(value.id)&&value.operation_id===value.id&&uuid(value.business_id)&&uuid(value.job_id)&&
  uuid(value.job_vehicle_id)&&uuid(value.vehicle_id)&&uuid(value.policy_id)&&uuid(value.collection_id)&&uuid(value.return_leg_version_id)&&
  version(value.job_version)&&uuid(value.created_by)&&instant(value.recorded_at));
 const body=parseBody({effectiveAt:value.effective_at,person:value.person_snapshot,location:value.location_snapshot,notes:value.notes,
  missingPhotoReason:value.missing_photo_reason,acknowledgementConfirmed:value.acknowledgement_confirmed,
  ...(photo?{conditionPhotoId:value.condition_photo_id}:{})});
 check(body.effectiveAt<=value.recorded_at);
 return {row:value,body};
}
export function verifyPickupReleaseWrite(value:unknown,request:PickupReleaseSave){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['release','auditId'])&&uuid(value.receipt.auditId));
 const {row,body}=releaseRow(value.receipt.release),expected=request.body;
 check(row.id===request.operationId&&row.business_id===request.businessId&&row.job_id===request.jobId&&
  row.job_version===request.expectedJobVersion&&row.collection_id===request.collectionId&&row.return_leg_version_id===request.returnLegVersionId&&
  body.effectiveAt===expected.effectiveAt&&body.person.displayName===expected.person.displayName&&
  body.location.locationText===expected.location.locationText&&body.location.instructions===expected.location.instructions&&
  body.notes===expected.notes&&body.missingPhotoReason===expected.missingPhotoReason&&
  body.conditionPhotoId===expected.conditionPhotoId&&body.acknowledgementConfirmed===expected.acknowledgementConfirmed);
}
function parseReleaseRow(value:unknown,scope:Scope,collection:ReturnType<typeof parseCollectionRow>,jobVersion:string){
 const {row,body}=releaseRow(value);
 check(row.business_id===scope.businessId&&row.job_id===scope.jobId&&row.job_vehicle_id===scope.jobVehicleId&&
  row.vehicle_id===collection.vehicleId&&row.policy_id===collection.policyId&&row.collection_id===collection.id&&
  BigInt(row.job_version as string)<=BigInt(jobVersion)&&body.effectiveAt>=collection.body.effectiveAt&&
  body.acknowledgementConfirmed===collection.body.acknowledgementConfirmed);
 return Object.freeze({id:row.id,returnLegVersionId:row.return_leg_version_id,recordedAt:row.recorded_at,body});
}
export function parsePickupCollectionContext(value:unknown,scope:Scope){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
 const record=value!==null&&typeof value==='object';
 const hasRelease=record&&Object.hasOwn(value,'release'),hasReturnArrival=record&&Object.hasOwn(value,'returnArrival');
 const hasFailure=record&&Object.hasOwn(value,'returnFailure');
 check(exact(value,['schemaVersion','state','businessId','jobId','jobVehicleId','jobVersion','policy','arrival','collection',
  ...(hasRelease?['release']:[]),...(hasReturnArrival?['returnArrival']:[]),...(hasFailure?['returnFailure']:[])])&&
  value.schemaVersion===1&&value.businessId===scope.businessId&&value.jobId===scope.jobId&&value.jobVehicleId===scope.jobVehicleId&&version(value.jobVersion));
 const state=states.find(state=>state===value.state);
 check(state);
 const policy=parsePolicy(value.policy),arrival=parseArrival(value.arrival),collection=value.collection===null?null:parseCollectionRow(value.collection,scope);
 check((state==='held'||state==='awaiting_return'||state==='return_required'||state==='return_failed'||state==='ready_to_release'||state==='released')===(collection!==null));
 if(collection)check(!arrival&&policy&&policy.id===collection.policyId&&(!policy.conditionPhotoRequired||collection.body.conditionPhotoId!==undefined)&&
  collection.body.acknowledgementConfirmed===(policy.acknowledgementText===null?null:true));
 if(state==='ready'||state==='photo_required')check(arrival&&policy&&policy.conditionPhotoRequired===(state==='photo_required'));
 if(state==='vehicle_held')check(arrival&&policy);
 if(state==='awaiting_arrival')check(arrival===null);
 if(state==='requires_policy')check(arrival&&policy===null);
 check(hasRelease===(state==='released')&&hasReturnArrival===(state==='ready_to_release'));
 const returnArrival=hasReturnArrival?parseArrival(value.returnArrival):null;
 if(hasReturnArrival)check(returnArrival&&collection&&returnArrival.arrivedAt>=collection.body.effectiveAt);
 const release=hasRelease&&collection?parseReleaseRow(value.release,scope,collection,value.jobVersion):null;
 if(release&&policy?.conditionPhotoRequired)check(release.body.conditionPhotoId);
 const failure=hasFailure?failureRow(value.returnFailure):null;
 if(failure)check(collection&&failure.business_id===scope.businessId&&failure.collection_id===collection.id&&
  BigInt(failure.job_version as string)<=BigInt(value.jobVersion)&&String(failure.recorded_at)>=collection.body.effectiveAt&&
  failure.return_leg_version_id!==returnArrival?.versionId&&failure.return_leg_version_id!==release?.returnLegVersionId&&
  (state==='return_failed'||state==='ready_to_release'||state==='released'));
 if(state==='return_failed')check(failure);
 const returnFailure=failure?Object.freeze({id:String(failure.id),recordedAt:String(failure.recorded_at),reason:String(failure.reason)}):null;
 return {schemaVersion:1 as const,...scope,state,jobVersion:value.jobVersion,policy,arrival,collection,returnArrival,release,returnFailure};
}
export type PickupCollectionContext=ReturnType<typeof parsePickupCollectionContext>;

export const pickupPolicyKind='operations.pickup_custody.policy.save' as const;
export const pickupPolicyConflicts=['arrangements','version','unchanged','operation'] as const;
type PolicyBody=Readonly<{acknowledgementText:string|null;conditionPhotoRequired:boolean;reason:string|null}>;
export type PickupPolicySave=Readonly<{
 schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;expectedSequence:string;body:PolicyBody;
}>;
export type PickupPolicy=PolicyBody&Readonly<{id:string;modeVersionId:string;sequence:string;recordedAt:string}>;
function policyBody(value:unknown,initial:boolean):PolicyBody{
 check(exact(value,['acknowledgementText','conditionPhotoRequired','reason'])&&typeof value.conditionPhotoRequired==='boolean'&&
  (value.acknowledgementText===null||text(value.acknowledgementText,2000))&&
  (value.reason===null||text(value.reason,1000)));
 check(initial||value.reason!==null);
 return {acknowledgementText:value.acknowledgementText,conditionPhotoRequired:value.conditionPhotoRequired,reason:value.reason};
}
function policyVersion(value:unknown):PickupPolicy{
 check(exact(value,['id','modeVersionId','sequence','recordedAt','acknowledgementText','conditionPhotoRequired','reason'])&&
  uuid(value.id)&&uuid(value.modeVersionId)&&version(value.sequence)&&instant(value.recordedAt));
 return Object.freeze({id:value.id,modeVersionId:value.modeVersionId,sequence:value.sequence,recordedAt:value.recordedAt,
  ...policyBody({acknowledgementText:value.acknowledgementText,conditionPhotoRequired:value.conditionPhotoRequired,reason:value.reason},value.sequence==='1')});
}
export function parsePickupPolicySave(value:unknown):PickupPolicySave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','expectedSequence','body'])&&value.schemaVersion===1&&
  uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&version(value.expectedSequence,true)&&
  BigInt(value.expectedSequence)<9223372036854775807n);
 return Object.freeze({...value,body:policyBody(value.body,value.expectedSequence==='0')}) as PickupPolicySave;
}
export function pickupPolicyOriginal(request:PickupPolicySave){
 const {businessId,operationId,recoveryEpoch,expectedSequence}=request;
 return parseFieldOriginal({schemaVersion:1,businessId,commandType:pickupPolicyKind,reference:{operationId,recoveryEpoch,expectedSequence}});
}
export function parsePickupPolicyAcknowledgement(value:unknown,request:PickupPolicySave){
 const original=pickupPolicyOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
export function verifyPickupPolicyWrite(value:unknown,request:PickupPolicySave){
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['schemaVersion','policy','auditId'])&&
  value.receipt.schemaVersion===1&&uuid(value.receipt.auditId));
 const policy=policyVersion(value.receipt.policy);
 check(policy.id===request.operationId&&BigInt(policy.sequence)===BigInt(request.expectedSequence)+1n&&
  policy.acknowledgementText===request.body.acknowledgementText&&policy.conditionPhotoRequired===request.body.conditionPhotoRequired&&policy.reason===request.body.reason);
}
export function parsePickupPolicyPage(value:unknown,businessId:string,beforeSequence:string|null){
 check(exact(value,['schemaVersion','businessId','currentSequence','versions','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&
  version(value.currentSequence,true)&&Array.isArray(value.versions)&&typeof value.hasMore==='boolean');
 const latest=BigInt(value.currentSequence),cursor=beforeSequence===null?latest+1n:BigInt(beforeSequence);
 check(beforeSequence===null||cursor<=latest);
 const remaining=cursor-1n,count=remaining<20n?Number(remaining):20;
 check(value.versions.length===count&&value.hasMore===(remaining>20n));
 const versions=value.versions.map((row,index)=>{
  const policy=policyVersion(row);
  check(BigInt(policy.sequence)===cursor-1n-BigInt(index));
  return policy;
 });
 check(new Set(versions.map(policy=>policy.id)).size===versions.length);
 return Object.freeze({schemaVersion:1 as const,businessId,currentSequence:value.currentSequence,versions,hasMore:value.hasMore});
}
