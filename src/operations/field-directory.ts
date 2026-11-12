import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {dropoffPolicyRevisionConflicts,dropoffPolicyRevisionOriginal,parseDropoffPolicyRevision,
 parseDropoffPolicyRevisionAcknowledgement,parseDropoffPolicyRevisionCommitted} from './dropoff-custody-contract.ts';
import {parseFieldSessionSave,fieldSessionOriginal,parseFieldSessionCommitted,fieldSessionConflicts} from './field-session-contract.ts';
import {parseTripInterruptionSave,tripInterruptionOriginal,parseTripInterruptionCommitted,tripInterruptionConflicts} from './trip-interruption-contract.ts';
import {parseUnfulfilledCancellationContext,parseUnfulfilledCancellationSave,unfulfilledCancellationOriginal,
 parseUnfulfilledCancellationCommitted,unfulfilledCancellationConflicts} from './unfulfilled-cancellation-contract.ts';
import {parseJobWorkTime} from './job-work-time-contract.ts';
import {parseWorkBoundarySave,workBoundaryOriginal,parseWorkBoundaryCommitted,workBoundaryConflicts} from './job-work-boundary-contract.ts';
import {parseWorkStartContext,parseWorkStartSave,workStartOriginal,parseWorkStartCommitted,workStartConflicts} from './job-work-start-contract.ts';
import {parseWorkEndContext,parseWorkEndSave,workEndOriginal,parseWorkEndCommitted,workEndConflicts} from './job-work-end-contract.ts';
import {parseMobileDepartureContext,parseMobileDepartureSave,mobileDepartureOriginal,parseMobileDepartureCommitted,mobileDepartureConflicts} from './mobile-departure-contract.ts';
import {parseReviewOutcomeContext,parseReviewOutcomeSave,reviewOutcomeOriginal,parseReviewOutcomeCommitted,reviewOutcomeConflicts} from './review-message-contract.ts';
import {parseReviewMessageHistory} from './review-message-history-contract.ts';
import type {ReviewHistoryQuery} from './review-message-history-contract.ts';
import {parseCollectionCursor,parseCollectionPage,parsePickupReturnPage} from './dropoff-collection-contract.ts';
import type {CollectionCursor} from './dropoff-collection-contract.ts';
import {parsePickupTripCommitted,parsePickupTripDatabasePage,parsePickupTripSave,pickupTripConflicts,pickupTripOriginal} from './pickup-trip-contract.ts';
import type {PickupTripCursor} from './pickup-trip-contract.ts';
import {parsePickupReturnFailureAcknowledgement,parsePickupReturnFailureSave,pickupReturnFailureConflicts,pickupReturnFailureOriginal,verifyPickupReturnFailureWrite,
 parsePickupReleaseAcknowledgement,parsePickupReleaseSave,pickupReleaseConflicts,pickupReleaseOriginal,verifyPickupReleaseWrite,
 parsePickupCollectionAcknowledgement,parsePickupCollectionContext,parsePickupCollectionSave,pickupCollectionConflicts,
 pickupCollectionOriginal,verifyPickupCollectionWrite,parsePickupPolicyAcknowledgement,parsePickupPolicyPage,
 parsePickupPolicySave,pickupPolicyConflicts,pickupPolicyOriginal,verifyPickupPolicyWrite} from './pickup-custody-contract.ts';
import {maintenanceFollowUpConflicts,maintenanceFollowUpOriginal,parseMaintenanceFollowUpAcknowledgement,parseMaintenanceFollowUpCommitted,parseMaintenanceFollowUpHistory,
 parseMaintenanceFollowUpList,parseMaintenanceFollowUpSave} from './maintenance-follow-up-contract.ts';
import type {parseMaintenanceFollowUpHistoryQuery,parseMaintenanceFollowUpListQuery} from './maintenance-follow-up-contract.ts';
import {dropoffCustodyConflicts,dropoffCustodyOriginal,parseDropoffCustody,parseDropoffCustodyAcknowledgement,
 parseDropoffCustodyCommitted,parseDropoffCustodySave,dropoffPolicyConflicts,dropoffPolicyOriginal,parseDropoffPolicy,
 parseDropoffPolicySave,parseDropoffPolicyCommitted,parseDropoffPolicyAcknowledgement} from './dropoff-custody-contract.ts';
export class FieldDirectoryError extends Error{constructor(code:string){super(code);this.name='FieldDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;}forServer(){return this.#value;}toJSON():never{throw new FieldDirectoryError('FIELD_VALUE_PRIVATE');}}
export function createFieldDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 if(config.environment!=='test')throw new FieldDirectoryError('FIELD_CONFIGURATION_REQUIRED');
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function readResult(credential:string,businessId:string,signal:AbortSignal,sql:string,keys:readonly (string|null)[]){
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]),hash=sessionCredentialHash(credential);
  try{
   const verified=await sessions.verify(credential,bounded,'background');
   bounded.throwIfAborted();
   const value=await database(sql,[hash,verified.sessionId,verified.actorId,verified.provider.issuer,
    verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId,...keys],bounded);
   bounded.throwIfAborted();
   return value;
  }finally{hash.fill(0);}
 }
 async function read(credential:string,businessId:string,jobId:string,signal:AbortSignal,kind:'cancellation'|'time'|'work-start'|'work-end'|'review-outcome'|{legId:string}){
  const departure=typeof kind==='object';
  const command=departure?'read_mobile_departure':kind==='review-outcome'?'read_review_message_outcome':kind==='work-end'?'read_job_work_end':kind==='work-start'?'read_job_work_start':kind==='time'?'read_job_work_time':'read_unfulfilled_cancellation_context';
  const value=await readResult(credential,businessId,signal,
   'SELECT crest_commands.'+command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid'+(departure?',$10::uuid':'')+') AS result',
   departure?[jobId,kind.legId]:[jobId]);
  if(departure)return new PrivateValue(parseMobileDepartureContext(value,businessId,jobId,kind.legId));
  if(kind==='cancellation')return new PrivateValue(parseUnfulfilledCancellationContext(value,businessId,jobId));
  if(kind==='work-start')return new PrivateValue(parseWorkStartContext(value,businessId,jobId));
  if(kind==='work-end')return new PrivateValue(parseWorkEndContext(value,businessId,jobId));
  if(kind==='review-outcome')return new PrivateValue(parseReviewOutcomeContext(value,businessId,jobId));
  const loaded=parseJobWorkTime(value,businessId,jobId);
  return new PrivateValue('state'in loaded?loaded:loaded.record);
 }
 async function reviewHistory(credential:string,businessId:string,{scope,cursor}:ReviewHistoryQuery,signal:AbortSignal){
  const value=await readResult(credential,businessId,signal,
   'SELECT crest_commands.read_review_message_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::text,$12::uuid) AS result',
   [scope.kind,scope.id,cursor?.source??null,cursor?.id??null]);
  return new PrivateValue(parseReviewMessageHistory(value,businessId,scope));
 }
 async function maintenanceList(credential:string,businessId:string,{scope,after}:ReturnType<typeof parseMaintenanceFollowUpListQuery>,signal:AbortSignal){
  const value=await readResult(credential,businessId,signal,
   'SELECT crest_commands.list_maintenance_follow_ups($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::timestamptz,$12::timestamptz,$13::uuid) AS result',
   [scope.scopeKind,scope.scopeId,scope.throughAt,after?.effectiveDueAt??null,after?.taskId??null]);
  return new PrivateValue(parseMaintenanceFollowUpList(value,businessId,scope,after));
 }
 async function maintenanceHistory(credential:string,businessId:string,{taskId,afterVersion}:ReturnType<typeof parseMaintenanceFollowUpHistoryQuery>,signal:AbortSignal){
  const value=await readResult(credential,businessId,signal,
   'SELECT crest_commands.read_maintenance_follow_up($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint) AS result',
   [taskId,afterVersion]);
  const history=parseMaintenanceFollowUpHistory(value,businessId,taskId,afterVersion);
  if(history.state==='absent')return new PrivateValue(history);
  const {current,entries,hasMore}=history;
  return new PrivateValue({schemaVersion:1,businessId,taskId,current,entries,hasMore});
 }
 async function save(credential:string,input:unknown,signal:AbortSignal,action:'session'|'interruption'|'cancellation'|'work-boundary'|'work-start'|'work-end'|'mobile-departure'|'review-outcome'|'maintenance'|'custody'|'custody-policy'|'custody-policy-revision'|'pickup-trip'|'pickup-collection'|'pickup-policy'|'pickup-release'|'pickup-return-failure'){
  let submitted=false,hash:Buffer|undefined;
  try{
   const prepared=action==='pickup-policy'?(()=>{
    const request=parsePickupPolicySave(input);
    return {request,original:pickupPolicyOriginal(request),conflicts:pickupPolicyConflicts,
     command:'save_pickup_policy',committed:(observed:unknown)=>parsePickupPolicyAcknowledgement(observed,request)};
   })():action==='pickup-return-failure'?(()=>{
    const request=parsePickupReturnFailureSave(input);
    return {request,original:pickupReturnFailureOriginal(request),conflicts:pickupReturnFailureConflicts,
     command:'fail_pickup_return',committed:(observed:unknown)=>parsePickupReturnFailureAcknowledgement(observed,request)};
   })():action==='pickup-release'?(()=>{
    const request=parsePickupReleaseSave(input);
    return {request,original:pickupReleaseOriginal(request),conflicts:pickupReleaseConflicts,
     command:'release_pickup_vehicle',committed:(observed:unknown)=>parsePickupReleaseAcknowledgement(observed,request)};
   })():action==='pickup-collection'?(()=>{
    const request=parsePickupCollectionSave(input);
    return {request,original:pickupCollectionOriginal(request),conflicts:pickupCollectionConflicts,
     command:'collect_pickup_vehicle',committed:(observed:unknown)=>parsePickupCollectionAcknowledgement(observed,request)};
   })():action==='custody-policy-revision'?(()=>{
    const request=parseDropoffPolicyRevision(input);
    return {request,original:dropoffPolicyRevisionOriginal(request),conflicts:dropoffPolicyRevisionConflicts,
     command:'revise_dropoff_policy',committed:(observed:unknown)=>parseDropoffPolicyRevisionAcknowledgement(observed,request)};
   })():action==='custody-policy'?(()=>{
    const request=parseDropoffPolicySave(input),original=dropoffPolicyOriginal(request);
    return {request,original,conflicts:dropoffPolicyConflicts,command:'save_dropoff_policy',
     committed:(observed:unknown)=>parseDropoffPolicyAcknowledgement(observed,request)};
   })():action==='custody'?(()=>{
    const request=parseDropoffCustodySave(input),original=dropoffCustodyOriginal(request);
    return {request,original,conflicts:dropoffCustodyConflicts,command:'save_dropoff_handoff',
     committed:(observed:unknown)=>parseDropoffCustodyAcknowledgement(observed,request)};
   })():action==='maintenance'?(()=>{
    const request=parseMaintenanceFollowUpSave(input),original=maintenanceFollowUpOriginal(request);
    return {request,original,conflicts:maintenanceFollowUpConflicts,command:'save_maintenance_follow_up',
     committed:(observed:unknown)=>parseMaintenanceFollowUpAcknowledgement(observed,request)};
   })():action==='review-outcome'?(()=>{
    const request=parseReviewOutcomeSave(input);
    return {request,original:reviewOutcomeOriginal(request),conflicts:reviewOutcomeConflicts,
     command:'record_review_message_outcome',committed:(observed:unknown)=>parseReviewOutcomeCommitted(observed,request)};
   })():action==='mobile-departure'?(()=>{
    const request=parseMobileDepartureSave(input);
    return {request,original:mobileDepartureOriginal(request),conflicts:mobileDepartureConflicts,
     command:'correct_mobile_departure',committed:(observed:unknown)=>parseMobileDepartureCommitted(observed,request)};
   })():action==='pickup-trip'?(()=>{
    const request=parsePickupTripSave(input);
    return {request,original:pickupTripOriginal(request),conflicts:pickupTripConflicts,
     command:'record_pickup_trip',committed:(observed:unknown)=>parsePickupTripCommitted(observed,request)};
   })():action==='work-end'?(()=>{
    const request=parseWorkEndSave(input);
    return {request,original:workEndOriginal(request),conflicts:workEndConflicts,
     command:'correct_job_work_end',committed:(observed:unknown)=>parseWorkEndCommitted(observed,request)};
   })():action==='work-start'?(()=>{
    const request=parseWorkStartSave(input);
    return {request,original:workStartOriginal(request),conflicts:workStartConflicts,
     command:'correct_job_work_start',committed:(observed:unknown)=>parseWorkStartCommitted(observed,request)};
   })():action==='work-boundary'?(()=>{
    const request=parseWorkBoundarySave(input);
    return {request,original:workBoundaryOriginal(request),conflicts:workBoundaryConflicts,
     command:'correct_job_work_boundary',committed:(observed:unknown)=>parseWorkBoundaryCommitted(observed,request)};
   })():action==='cancellation'?(()=>{
    const request=parseUnfulfilledCancellationSave(input);
    return {request,original:unfulfilledCancellationOriginal(request),conflicts:unfulfilledCancellationConflicts,
     command:'cancel_unfulfilled_job',committed:(observed:unknown)=>parseUnfulfilledCancellationCommitted(observed,request)};
   })():action==='interruption'?(()=>{
    const request=parseTripInterruptionSave(input);
    return {request,original:tripInterruptionOriginal(request),conflicts:tripInterruptionConflicts,
     command:'interrupt_mobile_job',committed:(observed:unknown)=>parseTripInterruptionCommitted(observed,request)};
   })():(()=>{
    const request=parseFieldSessionSave(input);
    return {request,original:fieldSessionOriginal(request),conflicts:fieldSessionConflicts,
     command:'change_field_session',committed:(observed:unknown)=>parseFieldSessionCommitted(observed,request)};
   })();
   const {request,original}=prepared,bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);
   if(bounded.aborted)throw Error();hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();
   const args=[hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),request.businessId];
   const readOriginal=async(...[query,current]:Parameters<Parameters<typeof database.transaction>[0]>)=>{
    const observed=await query('SELECT crest_commands.lookup_scheduling_original($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result',[...args,original]);
    current.throwIfAborted();
    const committed=prepared.committed(observed);if(committed.result.receipt.actorId!==verified.actorId)throw Error();
    return new PrivateValue(committed);
   };
   const result=await database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;
    if('expectedSequence'in request){
     const value=await query('SELECT crest_commands.save_pickup_policy($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::jsonb) AS result',
      [...args,request.recoveryEpoch,request.operationId,request.expectedSequence,request.body]);
     current.throwIfAborted();
     if(exact(value,['state','reason'])&&value.state==='conflict'&&pickupPolicyConflicts.some(reason=>reason===value.reason))
      return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as string}));
     verifyPickupPolicyWrite(value,request);
     return null;
    }
    if('returnLegVersionId'in request){
     const failing='reason'in request.body;
     const command=failing?'fail_pickup_return':'release_pickup_vehicle';
     const value=await query('SELECT crest_commands.'+command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::uuid,$14::uuid,$15::jsonb) AS result',
      [...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion,
       request.collectionId,request.returnLegVersionId,request.body]);
     current.throwIfAborted();
     if(exact(value,['state','reason'])&&value.state==='conflict'&&(failing?pickupReturnFailureConflicts:pickupReleaseConflicts).some(reason=>reason===value.reason))
      return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as string}));
     if(failing)verifyPickupReturnFailureWrite(value,parsePickupReturnFailureSave(request));
     else verifyPickupReleaseWrite(value,parsePickupReleaseSave(request));
     return null;
    }
    if('pickupLegVersionId'in request){
     const value=await query('SELECT crest_commands.collect_pickup_vehicle($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::uuid,$14::uuid,$15::uuid,$16::jsonb) AS result',
      [...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion,request.jobVehicleId,
       request.pickupLegVersionId,request.policyId,request.body]);
     current.throwIfAborted();
     if(exact(value,['state','reason'])&&value.state==='conflict'&&pickupCollectionConflicts.some(reason=>reason===value.reason))
      return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as string}));
     verifyPickupCollectionWrite(value,request);
     return null;
    }
    if('policyId'in request){
     const value=await query('SELECT crest_commands.revise_dropoff_policy($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::uuid,$13::jsonb) AS result',
      [...args,request.recoveryEpoch,request.operationId,request.modeVersionId,request.policyId,request.body]);
     current.throwIfAborted();
     if(exact(value,['state','reason'])&&value.state==='conflict'&&dropoffPolicyRevisionConflicts.some(reason=>reason===value.reason))
      return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as string}));
     parseDropoffPolicyRevisionCommitted(value,request);
     return null;
    }
    if('modeVersionId'in request){
     const value=await query('SELECT crest_commands.save_dropoff_policy($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::jsonb) AS result',
      [...args,request.recoveryEpoch,request.operationId,request.modeVersionId,request.body]);
     current.throwIfAborted();
     if(exact(value,['state','reason'])&&value.state==='conflict'&&dropoffPolicyConflicts.some(reason=>reason===value.reason))
      return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as string}));
     parseDropoffPolicyCommitted(value,request);
     return null;
    }
    const review='messageId'in request,custody='jobVehicleId'in request;
    const common=[...args,request.recoveryEpoch,request.operationId,
     custody?request.jobVehicleId:'taskId'in request?request.taskId:request.jobId,
     custody?request.caseId:'expectedVersion'in request?request.expectedVersion:review?request.messageId:request.expectedJobVersion];
    const versions=custody?[request.expectedVersion]:review?[request.priorEventId]:
     'expectedLegVersionId'in request?[request.legId,request.expectedLegVersionId]:
     'departureEventId'in request?[request.legId,request.legVersionId,request.departureEventId]:
     'leftVersionId'in request?[request.leftVersionId,request.rightVersionId]:
     'completionEventId'in request?[request.workVersionId,request.completionEventId]:
     'workVersionId'in request?[request.workVersionId,request.arrivalVersionId]:[];
    const parameters=versions.map((_,index)=>'$'+(13+index)+(custody?'::integer':'::uuid')).concat('$'+(13+versions.length)+'::jsonb').join(',');
    const values=[...versions,request.body];
    const value=await query('SELECT crest_commands.'+prepared.command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::'+(review||custody?'uuid':'bigint')+','+parameters+') AS result',[...common,...values]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&typeof value.reason==='string'&&prepared.conflicts.some(reason=>reason===value.reason))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
    if(!exact(value,['state','receipt'])||value.state!=='committed')throw Error();
    if('taskId'in request)parseMaintenanceFollowUpCommitted(value,request);
    if(custody)parseDropoffCustodyCommitted(value,request);
    // Reservation release is checked at COMMIT using the command's operation
    // identity. Original lookup clears that identity in its own transaction.
    return action==='session'?readOriginal(query,current):null;
   },bounded);
   return result??await database.transaction(readOriginal,bounded);
  }catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new FieldDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new FieldDirectoryError(submitted?'FIELD_SAVE_OUTCOME_UNKNOWN':'FIELD_SAVE_NOT_SUBMITTED');}
  finally{hash?.fill(0);}
 }
 return Object.freeze({
  async pickupPolicy(credential:string,businessId:string,beforeSequence:string|null,signal:AbortSignal){
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.read_pickup_policy($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::bigint) AS result',[beforeSequence]);
   return new PrivateValue(parsePickupPolicyPage(value,businessId,beforeSequence));
  },
  savePickupPolicy:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'pickup-policy'),
  async pickupCollection(credential:string,businessId:string,jobId:string,jobVehicleId:string,signal:AbortSignal){
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.read_pickup_collection($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid) AS result',
    [jobId,jobVehicleId]);
   if(value===null||typeof value!=='object')throw new FieldDirectoryError('PICKUP_COLLECTION_DATA_REQUIRED');
   parsePickupCollectionContext(value,{businessId,jobId,jobVehicleId});
   return new PrivateValue(value);
  },
  savePickupCollection:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'pickup-collection'),
  savePickupRelease:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'pickup-release'),
  savePickupReturnFailure:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'pickup-return-failure'),
  async pickupTrips(credential:string,businessId:string,jobId:string,cursor:PickupTripCursor,signal:AbortSignal){
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.read_pickup_trips($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::timestamptz,$11::uuid) AS result',
    [jobId,cursor.beforeDepartedAt,cursor.beforeLegId]);
   return new PrivateValue(parsePickupTripDatabasePage(value,{businessId,jobId},cursor));
  },
  savePickupTrip:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'pickup-trip'),
  cancellationContext:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'cancellation'),
  jobWorkTime:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'time'),
  jobWorkStart:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'work-start'),
  correctWorkStart:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'work-start'),
  jobWorkEnd:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'work-end'),
  correctWorkEnd:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'work-end'),
  mobileDeparture:(credential:string,businessId:string,jobId:string,legId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,{legId}),
  correctMobileDeparture:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'mobile-departure'),
  reviewHistory,

  async vehicleCustodyQueue(credential:string,businessId:string,input:CollectionCursor,signal:AbortSignal,kind:'dropoff'|'pickup'){
   const cursor=parseCollectionCursor(input),command=kind==='pickup'?'list_pickup_returns':'list_dropoff_collections';
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.'+command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::timestamptz,$10::uuid) AS result',
    [cursor.afterReceivedAt,cursor.afterCaseId]);
   const parse=kind==='pickup'?parsePickupReturnPage:parseCollectionPage;
   return new PrivateValue(parse(value,businessId,cursor));
  },
  async dropoffCustody(credential:string,businessId:string,jobId:string,jobVehicleId:string,signal:AbortSignal){
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.read_dropoff_job_custody($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid) AS result',
    [jobId,jobVehicleId]);
   return new PrivateValue(parseDropoffCustody(value,{businessId,jobId,jobVehicleId}));
  },
  async dropoffPolicy(credential:string,businessId:string,modeVersionId:string,signal:AbortSignal){
   const value=await readResult(credential,businessId,signal,
    'SELECT crest_commands.read_dropoff_policy($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[modeVersionId]);
   return new PrivateValue(parseDropoffPolicy(value,modeVersionId));
  },
  saveCustodyPolicy:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'custody-policy'),
  reviseCustodyPolicy:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'custody-policy-revision'),
  saveCustody:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'custody'),
  maintenanceList,
  maintenanceHistory,
  saveMaintenance:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'maintenance'),
  reviewOutcome:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'review-outcome'),
  recordReviewOutcome:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'review-outcome'),
  correctWorkBoundary:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'work-boundary'),
  saveSession:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'session'),
  interrupt:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'interruption'),
  cancelUnfulfilled:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'cancellation')
 });
}
