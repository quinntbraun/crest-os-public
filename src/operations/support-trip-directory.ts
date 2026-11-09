import 'server-only';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {sessionDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {parseSupportTripMileage} from './mileage.ts';
import {parseSupportTripCommitted,parseSupportTripHistory,parseSupportTripHistoryQuery,parseSupportTripList,
 parseSupportTripListQuery,parseSupportTripSave,supportTripConflicts,supportTripOriginal} from './support-trip.ts';

export class SupportTripDirectoryError extends Error{
 constructor(code:string){super(code);this.name='SupportTripDirectoryError';}
}
class PrivateTrip<T>{
 #value:T;
 constructor(value:T){this.#value=value;}
 forServer(){return this.#value;}
 toJSON():never{throw new SupportTripDirectoryError('SUPPORT_TRIP_VALUE_PRIVATE');}
}
const authorization='$1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid';
const listSql='SELECT crest_commands.read_support_trips('+authorization+',$9::timestamptz,$10::uuid,$11::integer) AS result';
const historySql='SELECT crest_commands.read_support_trip_history('+authorization+',$9::uuid,$10::bigint,$11::bigint,$12::integer) AS result';
const mileageSql='SELECT crest_commands.read_support_trip_mileage('+authorization+',$9::uuid) AS result';
const saveSql='SELECT crest_commands.record_support_trip('+authorization+',$9::uuid,$10::uuid,1,$11::uuid,$12::uuid,$13::jsonb) AS result';
const originalSql='SELECT crest_commands.lookup_scheduling_original('+authorization+',$9::jsonb) AS result';

export function createSupportTripDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,
 tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 if(config.environment!=='test')throw new SupportTripDirectoryError('SUPPORT_TRIP_CONFIGURATION_REQUIRED');
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,
  work:(args:unknown[],actorId:string,bounded:AbortSignal)=>Promise<T>){
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);
  bounded.throwIfAborted();
  const hash=sessionCredentialHash(credential);
  try{
   const verified=await sessions.verify(credential,bounded,'background');
   bounded.throwIfAborted();
   return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,
    verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],verified.actorId,bounded);
  }finally{hash.fill(0);}
 }
 return Object.freeze({
  async list(credential:string,input:unknown,signal:AbortSignal){
   try{
    const request=parseSupportTripListQuery(input);
    return await authorized(credential,request.businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(listSql,[...args,request.after?.departedAt??null,request.after?.legId??null,request.pageSize],bounded);
     bounded.throwIfAborted();
     return new PrivateTrip(parseSupportTripList(result,request));
    });
   }catch{throw new SupportTripDirectoryError('SUPPORT_TRIPS_UNAVAILABLE');}
  },
  async history(credential:string,input:unknown,signal:AbortSignal){
   try{
    const request=parseSupportTripHistoryQuery(input);
    return await authorized(credential,request.businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(historySql,[...args,request.legId,request.afterVersion,request.throughVersion,request.pageSize],bounded);
     bounded.throwIfAborted();
     if(exact(result,['state'])&&result.state==='not_found')return new PrivateTrip(Object.freeze({state:'not_found' as const}));
     return new PrivateTrip(parseSupportTripHistory(result,request));
    });
   }catch{throw new SupportTripDirectoryError('SUPPORT_TRIP_HISTORY_UNAVAILABLE');}
  },
  async mileage(credential:string,businessId:string,legId:string,signal:AbortSignal){
   try{
    if(!customerUuid(businessId)||!customerUuid(legId))throw Error();
    return await authorized(credential,businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(mileageSql,[...args,legId],bounded);
     bounded.throwIfAborted();
     if(exact(result,['state'])&&result.state==='not_found')return new PrivateTrip(Object.freeze({state:'not_found' as const}));
     return new PrivateTrip(parseSupportTripMileage(result,businessId,legId));
    });
   }catch{throw new SupportTripDirectoryError('SUPPORT_TRIP_MILEAGE_UNAVAILABLE');}
  },
  async save(credential:string,input:unknown,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseSupportTripSave(input),original=supportTripOriginal(request);
    return await authorized(credential,request.businessId,signal,(args,actorId,bounded)=>
     database.commandTransaction(async(query,current)=>{
      current.throwIfAborted();
      submitted=true;
      const result=await query(saveSql,[...args,request.recoveryEpoch,request.operationId,request.legId,request.expectedLegVersionId,request.body]);
      current.throwIfAborted();
      if(exact(result,['state','reason'])&&result.state==='conflict'&&supportTripConflicts.includes(result.reason as typeof supportTripConflicts[number]))
       return new PrivateTrip(Object.freeze({state:'conflict' as const,reason:result.reason as typeof supportTripConflicts[number]}));
      if(!exact(result,['state','receipt'])||result.state!=='committed'
        ||!exact(result.receipt,['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch',
         'legId','legVersionId','legSequence','legState','leg','operatorControlId','mileageReviewRequired','sourceAuditIds']))throw Error();
      const observed=await query(originalSql,[...args,original]);
      current.throwIfAborted();
      const saved=parseSupportTripCommitted(observed,request),receipt=saved.result.receipt;
      if(receipt.actorId!==actorId||receipt.sourceRecordId!==result.receipt.legVersionId
        ||receipt.sourceVersion!==result.receipt.legSequence)throw Error();
      return new PrivateTrip(saved);
     },bounded));
   }catch(error){
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new SupportTripDirectoryError(error.message);
    throw new SupportTripDirectoryError(submitted?'SUPPORT_TRIP_SAVE_OUTCOME_UNKNOWN':'SUPPORT_TRIP_SAVE_NOT_SUBMITTED');
   }
  }
 });
}
