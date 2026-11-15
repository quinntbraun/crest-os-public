import 'server-only';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {sessionDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {mileageOriginal,mileageSaveConflicts,parseMileageCommitted,parseMileageSave,parseMileageTripPage,parseMileageTripQuery} from './mileage.ts';
import {parseMileageHistoryPage,parseMileageHistoryQuery} from './mileage-history.ts';

export class MileageDirectoryError extends Error{
 constructor(code:string){super(code);this.name='MileageDirectoryError';}
}
class PrivateMileage<T>{
 #value:T;
 constructor(value:T){this.#value=value;}
 forServer(){return this.#value;}
 toJSON():never{throw new MileageDirectoryError('MILEAGE_VALUE_PRIVATE');}
}
const saveSql='SELECT crest_commands.record_mileage($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::uuid,$13::bigint,$14::jsonb) AS result';
const originalSql='SELECT crest_commands.lookup_scheduling_original($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result';
const historySql='SELECT crest_commands.read_mileage_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::bigint,$12::integer) AS result';
const tripsSql='SELECT crest_commands.read_job_mileage_trips($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::timestamptz,$11::uuid,$12::integer) AS result';

export function createMileageDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,
 tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 if(config.environment!=='test')throw new MileageDirectoryError('MILEAGE_CONFIGURATION_REQUIRED');
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
  async trips(credential:string,input:unknown,signal:AbortSignal){
   try{
    const request=parseMileageTripQuery(input);
    return await authorized(credential,request.businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(tripsSql,[...args,request.jobId,request.after?.departedAt??null,
      request.after?.legId??null,request.pageSize],bounded);
     bounded.throwIfAborted();
     if(exact(result,['state'])&&result.state==='not_found')return new PrivateMileage(Object.freeze({state:'not_found' as const}));
     return new PrivateMileage(parseMileageTripPage(result,request));
    });
   }catch{throw new MileageDirectoryError('MILEAGE_TRIPS_UNAVAILABLE');}
  },
  async history(credential:string,input:unknown,signal:AbortSignal){
   try{
    const {businessId,legId,afterVersion,throughVersion,pageSize}=parseMileageHistoryQuery(input);
    return await authorized(credential,businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(historySql,[...args,legId,afterVersion,throughVersion,pageSize],bounded);
     bounded.throwIfAborted();
     if(exact(result,['state'])&&result.state==='not_found')return new PrivateMileage(Object.freeze({state:'not_found' as const}));
     if(exact(result,['state','reason'])&&result.state==='conflict'&&result.reason==='history_boundary')
      return new PrivateMileage(Object.freeze({state:'conflict' as const,reason:'history_boundary' as const}));
     return new PrivateMileage(parseMileageHistoryPage(result,{businessId,legId,afterVersion,throughVersion}));
    });
   }catch{throw new MileageDirectoryError('MILEAGE_HISTORY_UNAVAILABLE');}
  },
  async save(credential:string,input:unknown,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseMileageSave(input),original=mileageOriginal(request);
    return await authorized(credential,request.businessId,signal,(args,actorId,bounded)=>
     database.commandTransaction(async(query,current)=>{
      current.throwIfAborted();
      submitted=true;
      const result=await query(saveSql,[...args,request.recoveryEpoch,request.operationId,request.legId,
       request.expectedLegVersionId,request.expectedEvidenceVersion,request.body]);
      current.throwIfAborted();
      if(exact(result,['state','reason'])&&result.state==='conflict'&&mileageSaveConflicts.includes(result.reason as typeof mileageSaveConflicts[number]))
       return new PrivateMileage(Object.freeze({state:'conflict' as const,reason:result.reason as typeof mileageSaveConflicts[number]}));
      if(!exact(result,['state','receipt'])||result.state!=='committed')throw Error();
      const observed=await query(originalSql,[...args,original]);
      current.throwIfAborted();
      const committed=parseMileageCommitted(observed,request);
      if(committed.result.receipt.actorId!==actorId)throw Error();
      return new PrivateMileage(committed);
     },bounded));
   }catch(error){
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new MileageDirectoryError(error.message);
    throw new MileageDirectoryError(submitted?'MILEAGE_SAVE_OUTCOME_UNKNOWN':'MILEAGE_SAVE_NOT_SUBMITTED');
   }
  }
 });
}
