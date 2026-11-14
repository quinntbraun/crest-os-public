import 'server-only';
import {createValidatedFileIntake} from '../files/validated-file-intake.ts';
import {PrivateObjectError,maximumFileBytes,uploadLifetimeSeconds} from '../files/private-object-store.ts';
import type {createPrivateObjectStore} from '../files/private-object-store.ts';
import type {createLocalSandboxValidator} from '../files/local-sandbox-validator.ts';
import {heicValidationVersion,imageValidationVersion} from '../files/validation-contract.ts';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';

const photoTypes=['image/jpeg','image/png','image/heic'] as const;
type PhotoType=typeof photoTypes[number];
type Store=ReturnType<typeof createPrivateObjectStore>;
const reservationKeys=['id','business_id','job_id','job_vehicle_id','vehicle_id','case_id','handoff_version',
 'actor_id','recovery_epoch','dispatch_id','declared_type','byte_size','reserved_at'];
const metadataKeys=['detected_type','byte_size','sha256','validation_version','width','height','display_width',
 'display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height'];
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=(value:unknown,limit:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=limit;
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
export class DropoffPhotoError extends Error{
 constructor(){super('DROPOFF_PHOTO_UNCONFIRMED');this.name='DropoffPhotoError';}
}
function check(ok:unknown):asserts ok{if(!ok)throw new DropoffPhotoError();}
function photoType(value:unknown):value is PhotoType{return photoTypes.some(type=>value===type);}
export type DropoffPhotoScope=Readonly<{businessId:string;jobVehicleId:string;photoId:string}>;
export function parsePhotoReservation(value:unknown,scope:DropoffPhotoScope){
 check(exact(value,reservationKeys)&&uuid(scope.businessId)&&uuid(scope.jobVehicleId)&&uuid(scope.photoId)&&
  value.id===scope.photoId&&value.business_id===scope.businessId&&value.job_vehicle_id===scope.jobVehicleId&&
  uuid(value.job_id)&&uuid(value.vehicle_id)&&uuid(value.case_id)&&uuid(value.actor_id)&&uuid(value.recovery_epoch)&&
  uuid(value.dispatch_id)&&(value.handoff_version===1||value.handoff_version===2)&&
  photoType(value.declared_type)&&count(value.byte_size,maximumFileBytes)&&date(value.reserved_at));
 return Object.freeze({...value,declared_type:value.declared_type,byte_size:value.byte_size,
  case_id:value.case_id,handoff_version:value.handoff_version,dispatch_id:value.dispatch_id,
  recovery_epoch:value.recovery_epoch,reserved_at:value.reserved_at});
}
type Reservation=ReturnType<typeof parsePhotoReservation>;
function parseMetadata(value:unknown,reservation:Reservation){
 check(exact(value,metadataKeys));
 const heic=reservation.declared_type==='image/heic';
 check(value.detected_type===reservation.declared_type&&value.byte_size===reservation.byte_size&&hash(value.sha256)&&
  value.validation_version===(heic?heicValidationVersion:imageValidationVersion)&&count(value.width,60_000_000)&&
  count(value.height,60_000_000)&&value.width*value.height<=60_000_000&&hash(value.preview_sha256)&&
  count(value.preview_byte_size,8*1024*1024)&&count(value.preview_width,2048)&&count(value.preview_height,2048));
 check(heic?count(value.display_width,60_000_000)&&count(value.display_height,60_000_000)&&
  value.display_width*value.display_height<=60_000_000&&count(value.bit_depth,16)&&value.bit_depth>=8:
  value.display_width===null&&value.display_height===null&&value.bit_depth===null);
 return Object.freeze({...value,sha256:value.sha256,preview_sha256:value.preview_sha256,
  preview_byte_size:value.preview_byte_size});
}
type Metadata=ReturnType<typeof parseMetadata>;
function parseOriginal(value:unknown,reservation:Reservation,scope:DropoffPhotoScope){
 check(exact(value,[...metadataKeys,'business_id','photo_id','verified_at'])&&value.business_id===scope.businessId&&
  value.photo_id===scope.photoId&&date(value.verified_at)&&Date.parse(value.verified_at)>=Date.parse(reservation.reserved_at));
 const {business_id,photo_id,verified_at,...metadata}=value;
 return Object.freeze({business_id,photo_id,verified_at,...parseMetadata(metadata,reservation)});
}
function parseRecord(value:unknown,scope:DropoffPhotoScope){
 check(exact(value,['reservation','original','linked'])&&typeof value.linked==='boolean'&&
  (!value.linked||value.original!==null));
 const reservation=parsePhotoReservation(value.reservation,scope);
 return Object.freeze({reservation,original:value.original===null?null:parseOriginal(value.original,reservation,scope),linked:value.linked});
}
export function photoStatus(value:unknown,scope:DropoffPhotoScope){
 if(value===null)return 'absent';
 return parseRecord(value,scope).original===null?'pending':'verified';
}
function sameRecord(left:Record<string,unknown>,right:Record<string,unknown>){
 return Object.entries(left).every(([key,value])=>value===right[key]);
}

// The database adapter must reverify the current session and scoped booking on
// every call. The caller's HTTP body never supplies original or preview metadata.
export type DropoffPhotoReadAuthority=Readonly<{
 read:(credential:string,scope:DropoffPhotoScope,signal:AbortSignal)=>Promise<unknown>;
 writable:(credential:string,scope:DropoffPhotoScope,epoch:string,signal:AbortSignal)=>Promise<number>;
}>;
export type DropoffPhotoDispatchAuthority=DropoffPhotoReadAuthority&Readonly<{
 publish:(credential:string,scope:DropoffPhotoScope,epoch:string,metadata:Metadata,signal:AbortSignal)=>Promise<unknown>;
}>;
function keys(scope:DropoffPhotoScope,reservation:Reservation){
 const parent=scope.businessId,serverId=reservation.dispatch_id;
 return {stagingKey:`staging/${parent}/${scope.photoId}/${serverId}`,
  originalKey:`originals/${parent}/${serverId}`,previewKey:`previews/${parent}/${serverId}`};
}

export function createDropoffPhotoAccess(authority:DropoffPhotoReadAuthority,objects:Store){
 return Object.freeze({
  async upload(credential:string,scope:DropoffPhotoScope,signal:AbortSignal){
   const subject=Object.freeze({...scope});
   const {reservation,original}=parseRecord(await authority.read(credential,subject,signal),subject);
   check(original===null);
   const remaining=await authority.writable(credential,subject,reservation.recovery_epoch,signal);
   const expiresIn=Math.min(remaining,Math.floor((Date.parse(reservation.reserved_at)+uploadLifetimeSeconds*1000-Date.now())/1000));
   check(count(expiresIn,uploadLifetimeSeconds));
   return objects.issueReservedStagingUpload(keys(subject,reservation).stagingKey,reservation.declared_type,expiresIn,signal);
  },
  async download(credential:string,scope:DropoffPhotoScope,variant:'original'|'preview',signal:AbortSignal){
   check(variant==='original'||variant==='preview');
   const subject=Object.freeze({...scope});
   const first=parseRecord(await authority.read(credential,subject,signal),subject);
   check(first.original&&first.linked);
   const {original,reservation}=first,objectKeys=keys(subject,reservation);
   const file=variant==='original'?{key:objectKeys.originalKey,contentType:reservation.declared_type,
    byteSize:reservation.byte_size,sha256:original.sha256}:{key:objectKeys.previewKey,contentType:'image/jpeg',
    byteSize:original.preview_byte_size,sha256:original.preview_sha256};
   const bytes=await objects.readVerifiedCandidate(file,signal);
   try{
    const latest=parseRecord(await authority.read(credential,subject,signal),subject);
    check(!signal.aborted&&latest.linked&&latest.original&&sameRecord(original,latest.original)&&sameRecord(reservation,latest.reservation));
    return Object.freeze({bytes,contentType:file.contentType,sha256:file.sha256});
   }catch{
    bytes.fill(0);
    throw new DropoffPhotoError();
   }
  }
 });
}

// Construct this in the isolated dispatcher. A lost object response can only
// be confirmed by reading the exact immutable bytes. No overwrite or retry.
export function createDropoffPhotoDispatch(authority:DropoffPhotoDispatchAuthority,objects:Store,
 validator:ReturnType<typeof createLocalSandboxValidator>){
 function reconciledWrite<Input extends Parameters<Store['writeOriginalCandidate']>[0]>(
  write:(input:Input,signal?:AbortSignal)=>ReturnType<Store['writeOriginalCandidate']>){
  return async(input:Input,signal?:AbortSignal)=>{
   const digest={key:input.key,byteSize:input.bytes.byteLength,sha256:input.sha256,contentType:input.contentType};
   try{return await write(input,signal);}catch(error){
    if(!(error instanceof PrivateObjectError)||!['OBJECT_KEY_EXISTS','OBJECT_WRITE_UNCERTAIN'].includes(error.code))throw new DropoffPhotoError();
    const bytes=await objects.readVerifiedCandidate(digest,signal);bytes.fill(0);
    return Object.freeze({key:digest.key,byteSize:digest.byteSize,sha256:digest.sha256});
   }
  };
 }
 const intake=createValidatedFileIntake({...objects,writeOriginalCandidate:reconciledWrite(objects.writeOriginalCandidate),
  writePreviewCandidate:reconciledWrite(objects.writePreviewCandidate)},validator);
 return async(credential:string,scope:DropoffPhotoScope,signal:AbortSignal)=>{
  const subject=Object.freeze({...scope});
  const {reservation,original}=parseRecord(await authority.read(credential,subject,signal),subject);
  if(original)return original;
  check(count(await authority.writable(credential,subject,reservation.recovery_epoch,signal),uploadLifetimeSeconds));
  const prepared=await intake.prepare({...keys(subject,reservation),businessId:subject.businessId,attemptId:subject.photoId,
   dispatchId:reservation.dispatch_id,byteSize:reservation.byte_size,contentType:reservation.declared_type},signal);
  const {source,preview}=prepared;
  const metadata=parseMetadata({detected_type:source.detectedType,byte_size:source.byteSize,sha256:prepared.original.sha256,
   validation_version:prepared.validationVersion,width:source.width,height:source.height,display_width:source.displayWidth??null,
   display_height:source.displayHeight??null,bit_depth:source.bitDepth??null,preview_sha256:preview.sha256,
   preview_byte_size:preview.byteSize,preview_width:preview.width,preview_height:preview.height},reservation);
  const saved=parseOriginal(await authority.publish(credential,subject,reservation.recovery_epoch,metadata,signal),reservation,subject);
  check(!signal.aborted&&sameRecord(metadata,saved));
  return saved;
 };
}
