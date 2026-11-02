import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireBooking,parseBookJobSave,parseBookedJobCommitted,bookingConflictReasons,parseCancelScheduledJobSave,parseCancelledJobCommitted} from './confirmed-booking-contract.ts';
import type {BookJobSave,CancelScheduledJobSave} from './confirmed-booking-contract.ts';
import {parseChangeJobScheduleSave,parseRescheduledJobCommitted} from './confirmed-reschedule-contract.ts';
import type {ChangeJobScheduleSave} from './confirmed-reschedule-contract.ts';
import {parseJobListRequest,parseJobListPage,parseJobDetail,parseJobHistoryRequest,parseJobHistoryPage} from './confirmed-job-read-contract.ts';
import type {JobListRequest,JobHistoryRequest} from './confirmed-job-read-contract.ts';
import {parseSchedulingOriginal,parseSchedulingOriginalResult} from './scheduling-original-contract.ts';
import {parseBookingWorkspace,parseBookingAgreement,parseJobResources,parsePendingChangesRequest,parsePendingChangesPage} from './booking-context-contract.ts';
import type {PendingChangesRequest} from './booking-context-contract.ts';
import {parseBookingConflictRequest,parseBookingConflictReview} from './booking-conflict-review-contract.ts';
import type {BookingConflictRequest} from './booking-conflict-review-contract.ts';
export class BookingDirectoryError extends Error{constructor(code:string){super(code);this.name='BookingDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;}forServer(){return this.#value;}toJSON():never{throw new BookingDirectoryError('BOOKING_VALUE_PRIVATE');}}
export function createBookingDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  requireBooking(customerUuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);if(bounded.aborted)throw Error();let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async workspace(credential:string,businessId:string,signal:AbortSignal){
   try{return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_booking_workspace($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid) AS result',args,bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseBookingWorkspace(value,businessId));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async reviewSlot(credential:string,input:BookingConflictRequest,signal:AbortSignal){
   try{const request=parseBookingConflictRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.review_booking_slot($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::timestamptz,$12::timestamptz,$13::integer,$14::integer) AS result',[...args,request.operatorId,request.rescheduledJobId,request.startAt,request.endAt,request.travelBeforeSeconds,request.travelAfterSeconds],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseBookingConflictReview(value,request));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async agreement(credential:string,input:{businessId:string;familyId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','familyId'])&&customerUuid(input.businessId)&&customerUuid(input.familyId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_booking_agreement($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.familyId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseBookingAgreement(value,request.businessId,request.familyId));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async resources(credential:string,input:{businessId:string;jobId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','jobId'])&&customerUuid(input.businessId)&&customerUuid(input.jobId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_confirmed_job_resources($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.jobId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseJobResources(value,request.businessId,request.jobId));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async pending(credential:string,input:PendingChangesRequest,signal:AbortSignal){
   try{const request=parsePendingChangesRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_pending_job_changes($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::timestamptz,$10::uuid,$11::integer) AS result',[...args,request.afterCreatedAt,request.afterAppointmentId,request.pageSize],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parsePendingChangesPage(value,request));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async lookupOriginal(credential:string,input:unknown,signal:AbortSignal){
   try{const original=parseSchedulingOriginal(input);return await authorized(credential,original.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_scheduling_original($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result',[...args,original],bounded);requireBooking(!bounded.aborted);
    if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'operation' as const}));
    const result=parseSchedulingOriginalResult(value,original);return new PrivateValue(result.state==='absent'?result:Object.freeze({schemaVersion:1 as const,original,result}));
   });}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async list(credential:string,input:JobListRequest,signal:AbortSignal){
   try{const request=parseJobListRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_confirmed_jobs($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::timestamptz,$10::timestamptz,$11::timestamptz,$12::uuid,$13::integer) AS result',[...args,request.from,request.until,request.afterStart,request.afterJob,request.pageSize],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseJobListPage(value,request));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async read(credential:string,input:{businessId:string;jobId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','jobId'])&&customerUuid(input.businessId)&&customerUuid(input.jobId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_confirmed_job($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.jobId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseJobDetail(value,request.businessId,request.jobId));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async history(credential:string,input:JobHistoryRequest,signal:AbortSignal){
   try{const request=parseJobHistoryRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_confirmed_job_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::bigint,$12::integer) AS result',[...args,request.jobId,request.throughVersion,request.afterVersion,request.pageSize],bounded);requireBooking(!bounded.aborted);return new PrivateValue(parseJobHistoryPage(value,request));});}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async book(credential:string,input:BookJobSave,signal:AbortSignal){let submitted=false;
   try{const request=parseBookJobSave(input);return await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;const value=await query('SELECT crest_commands.book_job($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&bookingConflictReasons.includes(value.reason as typeof bookingConflictReasons[number]))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as typeof bookingConflictReasons[number]}));
    const result=parseBookedJobCommitted(value,request.businessId,request.operationId);requireBooking(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.jobId===request.jobId);return new PrivateValue(result);
   },bounded));}catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new BookingDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new BookingDirectoryError(submitted?'BOOKING_SAVE_OUTCOME_UNKNOWN':'BOOKING_SAVE_NOT_SUBMITTED');}
  },
  async cancel(credential:string,input:CancelScheduledJobSave,signal:AbortSignal){let submitted=false;
   try{const request=parseCancelScheduledJobSave(input);return await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;const value=await query('SELECT crest_commands.cancel_scheduled_job($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion,request.payload]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','version','state','job'].includes(value.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'version'|'state'|'job'}));
    const result=parseCancelledJobCommitted(value,request.businessId,request.operationId);requireBooking(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.jobId===request.jobId&&BigInt(result.receipt.version)===BigInt(request.expectedJobVersion)+1n);return new PrivateValue(result);
   },bounded));}catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new BookingDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new BookingDirectoryError(submitted?'BOOKING_CANCEL_SAVE_OUTCOME_UNKNOWN':'BOOKING_CANCEL_SAVE_NOT_SUBMITTED');}
  },
  async lookupCancelled(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_cancelled_job_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseCancelledJobCommitted(value,request.businessId,request.operationId));
   });}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async reschedule(credential:string,input:ChangeJobScheduleSave,signal:AbortSignal){let submitted=false;
   try{const request=parseChangeJobScheduleSave(input);return await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;const value=await query('SELECT crest_commands.change_job_schedule($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion,request.payload]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','job','customer','mode','version','state','appointment','proposal','review'].includes(value.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'job'|'customer'|'mode'|'version'|'state'|'appointment'|'proposal'|'review'}));
    const result=parseRescheduledJobCommitted(value,request.businessId,request.operationId);requireBooking(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.jobId===request.jobId&&result.receipt.action===request.payload.action&&BigInt(result.receipt.version)===BigInt(request.expectedJobVersion)+1n);return new PrivateValue(result);
   },bounded));}catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new BookingDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new BookingDirectoryError(submitted?'BOOKING_RESCHEDULE_SAVE_OUTCOME_UNKNOWN':'BOOKING_RESCHEDULE_SAVE_NOT_SUBMITTED');}
  },
  async lookupRescheduled(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_rescheduled_job_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseRescheduledJobCommitted(value,request.businessId,request.operationId));
   });}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{requireBooking(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_booked_job_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);requireBooking(!bounded.aborted);return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseBookedJobCommitted(value,request.businessId,request.operationId));
   });}catch{throw new BookingDirectoryError('BOOKING_REQUEST_FAILED');}
  }
 });
}
