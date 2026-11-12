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
import {parseWorkBoundarySave,parseWorkBoundaryCommitted,workBoundaryConflicts} from '../operations/job-work-boundary-contract.ts';
import type {WorkBoundarySave} from '../operations/job-work-boundary-contract.ts';
import {parseWorkStartContext,parseWorkStartSave,parseWorkStartCommitted,workStartConflicts} from '../operations/job-work-start-contract.ts';
import type {WorkStartSave} from '../operations/job-work-start-contract.ts';
import {parseWorkEndContext,parseWorkEndSave,parseWorkEndCommitted,workEndConflicts} from '../operations/job-work-end-contract.ts';
import type {WorkEndSave} from '../operations/job-work-end-contract.ts';
import {parseMobileDepartureContext,parseMobileDepartureSave,parseMobileDepartureCommitted,mobileDepartureConflicts} from '../operations/mobile-departure-contract.ts';
import {parseReviewOutcomeContext,parseReviewOutcomeSave,parseReviewOutcomeCommitted,reviewOutcomeConflicts} from '../operations/review-message-contract.ts';
import type {ReviewOutcomeSave} from '../operations/review-message-contract.ts';
import type {MobileDepartureSave} from '../operations/mobile-departure-contract.ts';
import {maintenanceFollowUpConflicts,parseMaintenanceFollowUpAcknowledgement,parseMaintenanceFollowUpHistory,
 parseMaintenanceFollowUpHistoryQuery,parseMaintenanceFollowUpList,parseMaintenanceFollowUpListQuery,parseMaintenanceFollowUpSave} from '../operations/maintenance-follow-up-contract.ts';
import type {MaintenanceFollowUpSave} from '../operations/maintenance-follow-up-contract.ts';
import {parsePickupTripCommitted,parsePickupTripCursor,parsePickupTripPage,parsePickupTripSave,pickupTripConflicts} from '../operations/pickup-trip-contract.ts';
import {parsePickupCollectionAcknowledgement,parsePickupCollectionContext,parsePickupCollectionSave,pickupCollectionConflicts,
 parsePickupPolicyAcknowledgement,parsePickupPolicyPage,parsePickupPolicySave,pickupPolicyConflicts} from '../operations/pickup-custody-contract.ts';
import type {PickupCollectionSave,PickupPolicySave} from '../operations/pickup-custody-contract.ts';
import type {PickupTripCursor,PickupTripSave} from '../operations/pickup-trip-contract.ts';
export {SchedulingClientError};
function failure(error:unknown,kind:'input'|'unknown'|'unavailable'):never{throw error instanceof SchedulingClientError?error:new SchedulingClientError(kind);}
function conflict(v:unknown,status:number,reasons:readonly string[]){if(status===409&&exact(v,['state','reason'])&&v.state==='conflict'&&typeof v.reason==='string'&&reasons.includes(v.reason))return Object.freeze({state:'conflict' as const,reason:v.reason});return null;}
export const scheduling=Object.freeze({
 async workspace(proof:Proof,signal:AbortSignal){try{
  const r=await postScheduling('workspace',{},proof,signal),v=r.value;check(r.status===200&&exact(v,['schemaVersion','businessId','operatorId','timezone','modeVersion','writeState','recoveryEpoch'])&&typeof r.binding==='string'&&/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(r.binding));
  const workspace=parseBookingWorkspace({schemaVersion:v.schemaVersion,businessId:v.businessId,operatorId:v.operatorId,timezone:v.timezone,modeVersion:v.modeVersion},v.businessId as string);check(v.writeState==='ready'&&uuid(v.recoveryEpoch)||v.writeState==='paused'&&v.recoveryEpoch===null);
  return Object.freeze({...r.amendedSchedulingAvailable===true?{amendedSchedulingAvailable:true as const}:{},...r.fieldSessionAvailable===true?{fieldSessionAvailable:true as const}:{},...r.jobCompletionAvailable===true?{jobCompletionAvailable:true as const}:{},...r.jobMileageAvailable===true?{jobMileageAvailable:true as const}:{},...r.pickupPhotosAvailable===true?{pickupPhotosAvailable:true as const}:{},...r.pickupPolicyAvailable===true?{pickupPolicyAvailable:true as const}:{},...r.pickupCollectionAvailable===true?{pickupCollectionAvailable:true as const}:{},...r.pickupTripsAvailable===true?{pickupTripsAvailable:true as const}:{},...r.supportTripsAvailable===true?{supportTripsAvailable:true as const}:{},...r.unfulfilledCancellationAvailable===true?{unfulfilledCancellationAvailable:true as const}:{},...r.workTimeAvailable===true?{workTimeAvailable:true as const}:{},...r.workBoundaryAvailable===true?{workBoundaryAvailable:true as const}:{},...r.workStartAvailable===true?{workStartAvailable:true as const}:{},...r.workEndAvailable===true?{workEndAvailable:true as const}:{},...r.mobileDepartureAvailable===true?{mobileDepartureAvailable:true as const}:{},...r.reviewOutcomeAvailable===true?{reviewOutcomeAvailable:true as const}:{},...r.reviewHistoryAvailable===true?{reviewHistoryAvailable:true as const}:{},...r.maintenanceFollowUpAvailable===true?{maintenanceFollowUpAvailable:true as const}:{},...r.dropoffCustodyAvailable===true?{dropoffCustodyAvailable:true as const}:{},...r.dropoffPolicyRevisionAvailable===true?{dropoffPolicyRevisionAvailable:true as const}:{},context:Object.freeze({...workspace,...v.writeState==='ready'?{writeState:'ready' as const,recoveryEpoch:v.recoveryEpoch as string}:{writeState:'paused' as const,recoveryEpoch:null}}),binding:r.binding});
 }catch(e){failure(e,'unavailable');}},
 async reviewSlot(input:BookingConflictRequest,proof:Proof,signal:AbortSignal){let request:BookingConflictRequest;try{request=parseBookingConflictRequest(input);}catch{throw new SchedulingClientError('input');}try{const {businessId,...body}=request,r=await postScheduling('slot-review',body,proof,signal);check(r.status===200&&businessId===request.businessId);return parseBookingConflictReview(r.value,request);}catch(e){failure(e,'unavailable');}},
 async agreement(businessId:string,familyId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(familyId));const r=await postScheduling('agreement',{familyId},proof,signal);check(r.status===200);return parseBookingAgreement(r.value,businessId,familyId);}catch(e){failure(e,'unavailable');}},
 async resources(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){try{check(uuid(businessId)&&uuid(jobId));const r=await postScheduling('resources',{jobId},proof,signal);check(r.status===200);return parseJobResources(r.value,businessId,jobId);}catch(e){failure(e,'unavailable');}},
 async pickupPolicy(businessId:string,beforeSequence:string|null,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&(beforeSequence===null||version(beforeSequence)));
   const response=await postScheduling('pickup-policy',{beforeSequence},proof,signal);
   check(response.status===200);return parsePickupPolicyPage(response.value,businessId,beforeSequence);
  }catch(error){failure(error,'unavailable');}
 },
 async savePickupPolicy(input:PickupPolicySave,proof:Proof,signal:AbortSignal){
  let request:PickupPolicySave;
  try{request=parsePickupPolicySave(input);}catch{throw new SchedulingClientError('input');}
  try{const {businessId,...body}=request,response=await postScheduling('pickup-policy-save',body,proof,signal);
   const clash=conflict(response.value,response.status,pickupPolicyConflicts);if(clash)return clash;
   check(response.status===200&&businessId===request.businessId);return parsePickupPolicyAcknowledgement(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async pickupCollection(businessId:string,jobId:string,jobVehicleId:string,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&uuid(jobId)&&uuid(jobVehicleId));
   const response=await postScheduling('pickup-collection',{jobId,jobVehicleId},proof,signal);
   check(response.status===200);return parsePickupCollectionContext(response.value,{businessId,jobId,jobVehicleId});
  }catch(error){failure(error,'unavailable');}
 },
 async savePickupCollection(input:PickupCollectionSave,proof:Proof,signal:AbortSignal){
  let request:PickupCollectionSave;
  try{request=parsePickupCollectionSave(input);}catch{throw new SchedulingClientError('input');}
  try{const {businessId,...body}=request,response=await postScheduling('pickup-collection-save',body,proof,signal);
   const clash=conflict(response.value,response.status,pickupCollectionConflicts);if(clash)return clash;
   check(response.status===200&&businessId===request.businessId);return parsePickupCollectionAcknowledgement(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async pickupTrips(businessId:string,jobId:string,cursor:PickupTripCursor,proof:Proof,signal:AbortSignal){
  try{check(uuid(businessId)&&uuid(jobId));const query=parsePickupTripCursor(cursor);
   const r=await postScheduling('pickup-trips',{jobId,...query},proof,signal);
   check(r.status===200);return parsePickupTripPage(r.value,{businessId,jobId},query);
  }catch(e){failure(e,'unavailable');}
 },
 async savePickupTrip(input:PickupTripSave,proof:Proof,signal:AbortSignal){
  let request:PickupTripSave;
  try{request=parsePickupTripSave(input);}catch{throw new SchedulingClientError('input');}
  try{const {businessId,...body}=request,r=await postScheduling('pickup-trip-save',body,proof,signal);
   const clash=conflict(r.value,r.status,pickupTripConflicts);if(clash)return clash;
   check(r.status===200&&businessId===request.businessId);return parsePickupTripCommitted(r.value,request);
  }catch(e){failure(e,'unknown');}
 },
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
 async correctWorkBoundary(input:WorkBoundarySave,proof:Proof,signal:AbortSignal){
  let request:WorkBoundarySave;
  try{request=parseWorkBoundarySave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {businessId,...body}=request;
   check(uuid(businessId));
   const response=await postScheduling('work-boundary-save',body,proof,signal);
   const clash=conflict(response.value,response.status,workBoundaryConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseWorkBoundaryCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async jobWorkStart(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('work-start',{jobId},proof,signal);
   check(response.status===200);
   return parseWorkStartContext(response.value,businessId,jobId);
  }catch(error){failure(error,'unavailable');}
 },
 async correctWorkStart(input:WorkStartSave,proof:Proof,signal:AbortSignal){
  let request:WorkStartSave;
  try{request=parseWorkStartSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {businessId,...body}=request;
   check(uuid(businessId));
   const response=await postScheduling('work-start-save',body,proof,signal);
   const clash=conflict(response.value,response.status,workStartConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseWorkStartCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async jobWorkEnd(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('work-end',{jobId},proof,signal);
   check(response.status===200);
   return parseWorkEndContext(response.value,businessId,jobId);
  }catch(error){failure(error,'unavailable');}
 },
 async correctWorkEnd(input:WorkEndSave,proof:Proof,signal:AbortSignal){
  let request:WorkEndSave;
  try{request=parseWorkEndSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {businessId,...body}=request;
   check(uuid(businessId));
   const response=await postScheduling('work-end-save',body,proof,signal);
   const clash=conflict(response.value,response.status,workEndConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseWorkEndCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async mobileDeparture(businessId:string,jobId:string,legId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId)&&uuid(legId));
   const response=await postScheduling('mobile-departure',{jobId,legId},proof,signal);
   check(response.status===200);
   return parseMobileDepartureContext(response.value,businessId,jobId,legId);
  }catch(error){failure(error,'unavailable');}
 },
 async correctMobileDeparture(input:MobileDepartureSave,proof:Proof,signal:AbortSignal){
  let request:MobileDepartureSave;
  try{request=parseMobileDepartureSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {businessId,...body}=request;
   check(uuid(businessId));
   const response=await postScheduling('mobile-departure-save',body,proof,signal);
   const clash=conflict(response.value,response.status,mobileDepartureConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseMobileDepartureCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async maintenanceList(businessId:string,input:unknown,proof:Proof,signal:AbortSignal){
  try {
   check(uuid(businessId));
   const {scope,after}=parseMaintenanceFollowUpListQuery(input);
   const response=await postScheduling('maintenance-list',{...scope,afterDueAt:after?.effectiveDueAt??null,afterTaskId:after?.taskId??null},proof,signal);
   check(response.status===200);
   return parseMaintenanceFollowUpList(response.value,businessId,scope,after);
  }catch(error){failure(error,'unavailable');}
 },
 async maintenanceHistory(businessId:string,input:unknown,proof:Proof,signal:AbortSignal){
  try {
   check(uuid(businessId));
   const query=parseMaintenanceFollowUpHistoryQuery(input);
   const response=await postScheduling('maintenance-history',query,proof,signal);
   check(response.status===200);
   return parseMaintenanceFollowUpHistory(response.value,businessId,query.taskId,query.afterVersion);
  }catch(error){failure(error,'unavailable');}
 },
 async saveMaintenance(input:MaintenanceFollowUpSave,proof:Proof,signal:AbortSignal){
  let request:MaintenanceFollowUpSave;
  try{request=parseMaintenanceFollowUpSave(input);}catch{throw new SchedulingClientError('input');}
  try {
   const {schemaVersion,operationId,recoveryEpoch,taskId,expectedVersion,body}=request;
   const response=await postScheduling('maintenance-save',{schemaVersion,operationId,recoveryEpoch,taskId,expectedVersion,body},proof,signal);
   const clash=conflict(response.value,response.status,maintenanceFollowUpConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseMaintenanceFollowUpAcknowledgement(response.value,request);
  }catch(error){failure(error,'unknown');}
 },
 async reviewOutcome(businessId:string,jobId:string,proof:Proof,signal:AbortSignal){
  try{
   check(uuid(businessId)&&uuid(jobId));
   const response=await postScheduling('review-outcome',{jobId},proof,signal);
   check(response.status===200);
   return parseReviewOutcomeContext(response.value,businessId,jobId);
  }catch(error){failure(error,'unavailable');}
 },
 async recordReviewOutcome(input:ReviewOutcomeSave,proof:Proof,signal:AbortSignal){
  let request:ReviewOutcomeSave;
  try{request=parseReviewOutcomeSave(input);}catch{throw new SchedulingClientError('input');}
  try{
   const {businessId,...body}=request;
   check(uuid(businessId));
   const response=await postScheduling('review-outcome-save',body,proof,signal);
   const clash=conflict(response.value,response.status,reviewOutcomeConflicts);
   if(clash)return clash;
   check(response.status===200);
   return parseReviewOutcomeCommitted(response.value,request);
  }catch(error){failure(error,'unknown');}
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
  const {businessId,...body}=request,r=await postScheduling('mode-save',body,proof,signal),clash=conflict(r.value,r.status,['operation','review','pickup_policy']);if(clash)return clash;
  if(r.status===409&&exact(r.value,['state','reason','currentSequence'])&&r.value.state==='conflict'&&r.value.reason==='version'&&version(r.value.currentSequence,true))return Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:r.value.currentSequence});
  check(r.status===200);const result=parseFulfillmentModeCommitted(r.value,businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return result;
 }catch(e){failure(e,'unknown');}}
});
