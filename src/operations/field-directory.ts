import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseFieldSessionSave,fieldSessionOriginal,parseFieldSessionCommitted,fieldSessionConflicts} from './field-session-contract.ts';
import {parseTripInterruptionSave,tripInterruptionOriginal,parseTripInterruptionCommitted,tripInterruptionConflicts} from './trip-interruption-contract.ts';
import {parseUnfulfilledCancellationContext,parseUnfulfilledCancellationSave,unfulfilledCancellationOriginal,
 parseUnfulfilledCancellationCommitted,unfulfilledCancellationConflicts} from './unfulfilled-cancellation-contract.ts';
import {parseJobWorkTime} from './job-work-time-contract.ts';
import {parseWorkBoundarySave,workBoundaryOriginal,parseWorkBoundaryCommitted,workBoundaryConflicts} from './job-work-boundary-contract.ts';
import {parseWorkStartContext,parseWorkStartSave,workStartOriginal,parseWorkStartCommitted,workStartConflicts} from './job-work-start-contract.ts';
export class FieldDirectoryError extends Error{constructor(code:string){super(code);this.name='FieldDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;}forServer(){return this.#value;}toJSON():never{throw new FieldDirectoryError('FIELD_VALUE_PRIVATE');}}
export function createFieldDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 if(config.environment!=='test')throw new FieldDirectoryError('FIELD_CONFIGURATION_REQUIRED');
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function read(credential:string,businessId:string,jobId:string,signal:AbortSignal,kind:'cancellation'|'time'|'work-start'){
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);
  const hash=sessionCredentialHash(credential);
  try{
   const verified=await sessions.verify(credential,bounded,'background');
   bounded.throwIfAborted();
   const command=kind==='work-start'?'read_job_work_start':kind==='time'?'read_job_work_time':'read_unfulfilled_cancellation_context';
   const value=await database('SELECT crest_commands.'+command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',
    [hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,
     new Date(verified.provider.expiresAt),businessId,jobId],bounded);
   bounded.throwIfAborted();
   if(kind==='cancellation')return new PrivateValue(parseUnfulfilledCancellationContext(value,businessId,jobId));
   if(kind==='work-start')return new PrivateValue(parseWorkStartContext(value,businessId,jobId));
   const loaded=parseJobWorkTime(value,businessId,jobId);
   return new PrivateValue('state'in loaded?loaded:loaded.record);
  }finally{hash.fill(0);}
 }
 async function save(credential:string,input:unknown,signal:AbortSignal,action:'session'|'interruption'|'cancellation'|'work-boundary'|'work-start'){
  let submitted=false,hash:Buffer|undefined;
  try{
   const prepared=action==='work-start'?(()=>{
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
    const common=[...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion];
    const versions='leftVersionId'in request?[request.leftVersionId,request.rightVersionId]:
     'workVersionId'in request?[request.workVersionId,request.arrivalVersionId]:[];
    const parameters=versions.length?'$13::uuid,$14::uuid,$15::jsonb':'$13::jsonb';
    const values=[...versions,request.body];
    const value=await query('SELECT crest_commands.'+prepared.command+'($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,'+parameters+') AS result',[...common,...values]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&typeof value.reason==='string'&&prepared.conflicts.some(reason=>reason===value.reason))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
    if(!exact(value,['state','receipt'])||value.state!=='committed')throw Error();
    // Reservation release is checked at COMMIT using the command's operation
    // identity. Original lookup clears that identity in its own transaction.
    return action==='session'?readOriginal(query,current):null;
   },bounded);
   return result??await database.transaction(readOriginal,bounded);
  }catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new FieldDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new FieldDirectoryError(submitted?'FIELD_SAVE_OUTCOME_UNKNOWN':'FIELD_SAVE_NOT_SUBMITTED');}
  finally{hash?.fill(0);}
 }
 return Object.freeze({
  cancellationContext:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'cancellation'),
  jobWorkTime:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'time'),
  jobWorkStart:(credential:string,businessId:string,jobId:string,signal:AbortSignal)=>read(credential,businessId,jobId,signal,'work-start'),
  correctWorkStart:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'work-start'),
  correctWorkBoundary:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'work-boundary'),
  saveSession:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'session'),
  interrupt:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'interruption'),
  cancelUnfulfilled:(credential:string,input:unknown,signal:AbortSignal)=>save(credential,input,signal,'cancellation')
 });
}
