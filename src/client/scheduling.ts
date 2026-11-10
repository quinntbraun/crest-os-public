import type {Proof} from './authentication';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingWorkspace,parseBookingAgreement,parseJobResources,parsePendingChangesRequest,parsePendingChangesPage} from '../operations/booking-context-contract.ts';
import type {PendingChangesRequest} from '../operations/booking-context-contract.ts';
import {parseJobListRequest,parseJobListPage,parseJobDetail,parseJobHistoryRequest,parseJobHistoryPage} from '../operations/confirmed-job-read-contract.ts';
import type {JobListRequest,JobHistoryRequest} from '../operations/confirmed-job-read-contract.ts';
import {bookingConflictReasons,requireBooking as check} from '../operations/confirmed-booking-contract.ts';
import {parseBookJobCommand,parseCancelJobCommand,bindBookingCommandReceipt} from '../operations/amended-booking-contract.ts';
import type {BookJobCommand,CancelJobCommand} from '../operations/amended-booking-contract.ts';
import {parseChangeJobScheduleSave,parseRescheduledJobCommitted} from '../operations/confirmed-reschedule-contract.ts';
import type {ChangeJobScheduleSave} from '../operations/confirmed-reschedule-contract.ts';
import {parseFulfillmentModeSave,parseFulfillmentModeCommitted,parseFulfillmentModeHistory} from '../operations/fulfillment-mode-contract.ts';
import type {FulfillmentModeSave} from '../operations/fulfillment-mode-contract.ts';
import {parseBookingConflictRequest,parseBookingConflictReview} from '../operations/booking-conflict-review-contract.ts';
import type {BookingConflictRequest} from '../operations/booking-conflict-review-contract.ts';
import {postScheduling,SchedulingClientError} from './scheduling-transport.ts';
import {parseFieldSessionSave,parseFieldSessionCommitted,fieldSessionConflicts} from '../operations/field-session-contract.ts';
import type {FieldSessionSave} from '../operations/field-session-contract.ts';
import {completionConflicts,parseCompletionCommitted,parseCompletionContext,parseCompletionSave} from '../operations/work-completion-contract.ts';
import type {CompletionSave} from '../operations/work-completion-contract.ts';
import {mileageSaveConflicts,parseMileageCommitted,parseMileageSave,parseMileageTripPage,parseMileageTripQuery,parseSupportTripMileage} from '../operations/mileage.ts';
import type {MileageSave,MileageTripQuery} from '../operations/mileage.ts';
import {parseMileageHistoryPage,parseMileageHistoryQuery} from '../operations/mileage-history.ts';
import type {MileageHistoryQuery} from '../operations/mileage-history.ts';
import {parseSupportTripCommitted,parseSupportTripHistory,parseSupportTripHistoryQuery,parseSupportTripList,
 parseSupportTripListQuery,parseSupportTripSave,supportTripConflicts} from '../operations/support-trip.ts';
import type {SupportTripHistoryQuery,SupportTripListQuery,SupportTripSave} from '../operations/support-trip.ts';
import {parseTripInterruptionSave,parseTripInterruptionCommitted,tripInterruptionConflicts} from '../operations/trip-interruption-contract.ts';
import type {TripInterruptionSave} from '../operations/trip-interruption-contract.ts';
import {parseUnfulfilledCancellationContext,parseUnfulfilledCancellationSave,parseUnfulfilledCancellationCommitted,
 unfulfilledCancellationConflicts} from '../operations/unfulfilled-cancellation-contract.ts';
import type {UnfulfilledCancellationSave} from '../operations/unfulfilled-cancellation-contract.ts';
import {parseJobWorkTime} from '../operations/job-work-time-contract.ts';
export {SchedulingClientError};
function failure(error:unknown,kind:'input'|'unknown'|'unavailable'):never{throw error instanceof SchedulingClientError?error:new SchedulingClientError(kind);}
function conflict(v:unknown,status:number,reasons:readonly string[]){if(status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&typeof v.reason==='string'&&reasons.includes(v.reason))return Object.freeze({state:'conflict' as const,reason:v.reason});return null;}
export const scheduling=Object.freeze({
 async workspace(proof:Proof,signal:AbortSignal){try{
  const r=await postScheduling('workspace',{},proof,signal),v=r.value;check(r.status===200&&exact(v,['schemaVersion','businessId','operatorId','timezone','modeVersion','writeState','recoveryEpoch'])&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding));
  const workspace=parseBookingWorkspace({schemaVersion:v.schemaVersion,businessId:v.businessId,operatorId:v.operatorId,timezone:v.timezone,modeVersion:v.modeVersion},v.businessId as string);check(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null);
  return Object.freeze({...r.amendedSchedulingAvailable===true?{amendedSchedulingAvailable:true as const}:{},...r.fieldSessionAvailable===true?{fieldSessionAvailable:true as const}:{},...r.jobCompletionAvailable===true?{jobCompletionAvailable:true as const}:{},...r.jobMileageAvailable===true?{jobMileageAvailable:true as const}:{},...r.supportTripsAvailable===true?{supportTripsAvailable:true as const}:{},...r.unfulfilledCancellationAvailable===true?{unfulfilledCancellationAvailable:true as const}:{},...r.workTimeAvailable===true?{workTimeAvailable:true as const}:{},context:Object.freeze({...workspace,...v.writeState==='ready'?{writeState:'ready' as const,recoveryEpoch:v.recoveryEpoch as string}:{writeState:'paused' as const,recoveryEpoch:null}}),binding:r.binding});
 }catch(e){failure(e,'unavailable');}},
 async reviewSlot(input:BookingConflictRequest,proof:Proof,signal:AbortSignal){let request:BookingConflictRequest;try{request=parseBookingConflictRequest(input);}catch{throw new SchedulingClientError('input');}try{const {businessId,...body}=request,r=await postScheduling('slot-review',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseBookingConflictReview(r.value,request);}catch(e){failure(e,'unavailable');}},
 async agreement(businessId:string,familyId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(familyId));const r=await postScheduling('agreement',{familyId},proof,signal);check(r.status===200);return parseBookingAgreement(r.value,businessId,familyId);}catch(e){failure(e,'unavailable');}},
 async resources(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(jobId));const r=await postScheduling('resources',{jobId},proof,signal);check(r.status===200);return parseJobResources(r.value,businessId,jobId);}catch(e){failure(e,'unavailable');}},
 async completionContext(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try {
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('completion-context',{jobId},proof,signal);
   check(response.status===200);
   return parseCompletionContext(response.value,businessId,jobId);
  } catch(error) {failure(error,'unavailable');}
 },
 async read(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(jobId));const r=await postScheduling('read',{jobId},proof,signal);check(r.status===200);return parseJobDetail(r.value,businessId,jobId);}catch(e){failure(e,'unavailable');}},
 async pending(input:PendingChangesRequest,proof:Proof,signal:AbortSignal){try{const request=parsePendingChangesRequest(input),{businessId,...body}=request,r=await postScheduling('pending',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parsePendingChangesPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async list(input:JobListRequest,proof:Proof,signal:AbortSignal){try{const request=parseJobListRequest(input),{businessId,...body}=request,r=await postScheduling('list',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseJobListPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async history(input:JobHistoryRequest,proof:Proof,signal:AbortSignal){try{const request=parseJobHistoryRequest(input),{businessId,...body}=request,r=await postScheduling('history',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseJobHistoryPage(r.value,request);}catch(e){failure(e,'unavailable');}},
 async modeHistory(businessId:string,input:{afterSequence:string;pageSize:number},proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&exact(input,['afterSequence','pageSize'])&&version(input.afterSequence,true)&&Number.isInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const body=Object.freeze({...input}),r=await postScheduling('mode-history',body,proof,signal);check(r.status===200);return parseFulfillmentModeHistory(r.value,businessId,body.afterSequence,body.pageSize);}catch(e){failure(e,'unavailable');}},
 async book(input:BookJobCommand,proof:Proof,signal:AbortSignal){let request:BookJobCommand;try{request=parseBookJobCommand(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('book',body,proof,signal),clash=conflict(r.value,r.status,bookingConflictReasons);if(clash)return clash;check(r.status===200);return bindBookingCommandReceipt(r.value,'book',request);
 }catch(e){failure(e,'unknown');}},
 async cancel(input:CancelJobCommand,proof:Proof,signal:AbortSignal){let request:CancelJobCommand;try{request=parseCancelJobCommand(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('cancel',body,proof,signal),clash=conflict(r.value,r.status,['operation','job','version','state']);if(clash)return clash;check(r.status===200);return bindBookingCommandReceipt(r.value,'cancel',request);
 }catch(e){failure(e,'unknown');}},
 async reschedule(input:ChangeJobScheduleSave,proof:Proof,signal:AbortSignal){let request:ChangeJobScheduleSave;try{request=parseChangeJobScheduleSave(input);}catch{throw new SchedulingClientError('input');}try{
  const {businessId,...body}=request,r=await postScheduling('reschedule',body,proof,signal),clash=conflict(r.value,r.status,['operation','job','customer','mode','version','state','appointment','proposal','review']);if(clash)return clash;check(r.status===200);const result=parseRescheduledJobCommitted(r.value,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.jobId===request.jobId&&BigInt(result.receipt.version)===BigInt(request.expectedJobVersion)+1n&&result.receipt.action===request.payload.action);return result;
 }catch(e){failure(e,'unknown');}},
 async saveFieldSession(input:FieldSessionSave,proof:Proof,signal:AbortSignal){let request:FieldSessionSave;try{request=parseFieldSessionSave(input);}catch{throw new SchedulingClientError('input');}try{
  const body=Object.fromEntries(Object.entries(request).filter(([key])=>key!=='businessId')),r=await postScheduling('field-save',body,proof,signal),clash=conflict(r.value,r.status,fieldSessionConflicts);if(clash)return clash;check(r.status===200);return parseFieldSessionCommitted(r.value,request);
 }catch(e){failure(e,'unknown');}},
 async complete(input:CompletionSave,proof:Proof,signal:AbortSignal){
  let request:CompletionSave;
  try {request=parseCompletionSave(input);} catch {throw new SchedulingClientError('input');}
  try {
   const {businessId,...body}=request;
   const response=await postScheduling('complete',body,proof,signal);
   const clash=conflict(response.value,response.status,completionConflicts);
   if(clash)return clash;
   check(response.status===200&&businessId===request.businessId);
   return parseCompletionCommitted(response.value,request);
  } catch(error) {failure(error,'unknown');}
 },
 async mileageTrips(input:MileageTripQuery,proof:Proof,signal:AbortSignal){
  try{
   const query=parseMileageTripQuery(input);
   const response=await postScheduling('mileage-trips',{jobId:query.jobId,pageSize:query.pageSize,
    afterDepartedAt:query.after?.departedAt??null,afterLegId:query.after?.legId??null},proof,signal);
   check(response.status===200);
   if(exact(response.value,['state'])&&response.value.state==='not_found')return Object.freeze({state:'not_found' as const});
   return parseMileageTripPage(response.value,query);
  }catch(error){failure(error,'unavailable');}
 },
 async mileageHistory(input:MileageHistoryQuery,proof:Proof,signal:AbortSignal){
  try{
   const query=parseMileageHistoryQuery(input),{legId,afterVersion,throughVersion,pageSize}=query;
   const response=await postScheduling('mileage-history',{legId,afterVersion,throughVersion,pageSize},proof,signal);
   const clash=conflict(response.value,response.status,['history_boundary']);if(clash)return clash;
   check(response.status===200);
   if(exact(response.value,['state'])&&response.value.state==='not_found')return Object.freeze({state:'not_found' as const});
   return parseMileageHistoryPage(response.value,query);
  }catch(error){failure(error,'unavailable');}
 },
 async interrupt(input:TripInterruptionSave,proof:Proof,signal:AbortSignal){
  let request:TripInterruptionSave;
  try{request=parseTripInterruptionSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {schemaVersion,operationId,recoveryEpoch,jobId,expectedJobVersion,body}=request;
   const response=await postScheduling('interrupt',{schemaVersion,operationId,recoveryEpoch,jobId,expectedJobVersion,body},proof,signal);
   const clash=conflict(response.value,response.status,tripInterruptionConflicts);if(clash)return clash;
   check(response.status===200);
   return parseTripInterruptionCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async supportTripMileage(businessId:string,legId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(legId));
   const r=await postScheduling('support-trip-mileage',{legId},proof,signal);
   check(r.status===200);
   if(exact(r.value,['state'])&&r.value.state==='not_found')return Object.freeze({state:'not_found' as const});
   return parseSupportTripMileage(r.value,businessId,legId);
  }catch(error){failure(error,'unavailable');}
 },
 async cancellationContext(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('unfulfilled-context',{jobId},proof,signal);
   check(response.status===200);
   return parseUnfulfilledCancellationContext(response.value,businessId,jobId);
  }catch(error){failure(error,'unavailable');}
 },
 async jobWorkTime(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('work-time',{jobId},proof,signal);
   check(response.status===200);
   return parseJobWorkTime(response.value,businessId,jobId);
  }catch(error){failure(error,'unavailable');}
 },
 async cancelUnfulfilled(input:UnfulfilledCancellationSave,proof:Proof,signal:AbortSignal){
  let request:UnfulfilledCancellationSave;
  try{request=parseUnfulfilledCancellationSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {schemaVersion,operationId,recoveryEpoch,jobId,expectedJobVersion,body}=request;
   const response=await postScheduling('cancel-unfulfilled',{schemaVersion,operationId,recoveryEpoch,jobId,expectedJobVersion,body},proof,signal);
   const clash=conflict(response.value,response.status,unfulfilledCancellationConflicts);if(clash)return clash;
   check(response.status===200);
   return parseUnfulfilledCancellationCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async saveMileage(input:MileageSave,proof:Proof,signal:AbortSignal){
  let request:MileageSave;
  try{request=parseMileageSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {schemaVersion,operationId,recoveryEpoch,legId,expectedLegVersionId,expectedEvidenceVersion,body}=request;
   const response=await postScheduling('mileage-save',{schemaVersion,operationId,recoveryEpoch,legId,expectedLegVersionId,expectedEvidenceVersion,body},proof,signal);
   const clash=conflict(response.value,response.status,mileageSaveConflicts);if(clash)return clash;
   check(response.status===200);
   return parseMileageCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async supportTrips(input:SupportTripListQuery,proof:Proof,signal:AbortSignal){
  try{
   const query=parseSupportTripListQuery(input);
   const r=await postScheduling('support-trips',{afterDepartedAt:query.after?.departedAt??null,
    afterLegId:query.after?.legId??null,pageSize:query.pageSize},proof,signal);
   check(r.status===200);
   return parseSupportTripList(r.value,query);
  }catch(error){failure(error,'unavailable');}
 },
 async supportTripHistory(input:SupportTripHistoryQuery,proof:Proof,signal:AbortSignal){
  try{
   const query=parseSupportTripHistoryQuery(input),{legId,afterVersion,throughVersion,pageSize}=query;
   const r=await postScheduling('support-trip-history',{legId,afterVersion,throughVersion,pageSize},proof,signal);
   check(r.status===200);
   if(exact(r.value,['state'])&&r.value.state==='not_found')return Object.freeze({state:'not_found' as const});
   return parseSupportTripHistory(r.value,query);
  }catch(error){failure(error,'unavailable');}
 },
 async saveSupportTrip(input:SupportTripSave,proof:Proof,signal:AbortSignal){
  let request:SupportTripSave;
  try{request=parseSupportTripSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {schemaVersion,operationId,recoveryEpoch,legId,expectedLegVersionId,body}=request;
   const r=await postScheduling('support-trip-save',{schemaVersion,operationId,recoveryEpoch,legId,expectedLegVersionId,body},proof,signal);
   const clash=conflict(r.value,r.status,supportTripConflicts);if(clash)return clash;
   check(r.status===200);
   return parseSupportTripCommitted(r.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async saveModes(input:FulfillmentModeSave,proof:Proof,signal:AbortSignal){let request:FulfillmentModeSave;try{request=parseFulfillmentModeSave(input);}catch{throw new SchedulingClientError('input');}try{
  const {businessId,...body}=request,r=await postScheduling('mode-save',body,proof,signal),clash=conflict(r.value,r.status,['operation','review']);if(clash)return clash;
  if(r.status===409&&exact(r.value,['state','reason','currentSequence'])&&r.value.state==='conflict'&&r.value.reason==='version'&&version(r.value.currentSequence,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:r.value.currentSequence});
  check(r.status===200);const result=parseFulfillmentModeCommitted(r.value,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return result;
 }catch(e){failure(e,'unknown');}}
});
