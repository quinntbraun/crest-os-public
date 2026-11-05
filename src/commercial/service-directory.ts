import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {requireService as check,serviceId,serviceRevision,parseServiceSave,parseServiceCommitted,parseServiceDirectoryPage,parseServiceHistoryPage} from './service-storage-contract.ts';
import type {ServiceSave} from './service-storage-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='SERVICE_REQUEST_FAILED'|'SERVICE_SAVE_NOT_SUBMITTED'|'SERVICE_SAVE_DENIED'|'SERVICE_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'SERVICE_VALUE_PRIVATE';
export class ServiceDirectoryError extends Error{constructor(code:Code){super(code);this.name='ServiceDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new ServiceDirectoryError('SERVICE_VALUE_PRIVATE');}}
type DirectoryRequest=Readonly<{businessId:string;search:string;afterId:string|null;includeInactive:boolean;pageSize:number}>;
type HistoryRequest=Readonly<{businessId:string;serviceId:string;afterRevision:string;pageSize:number}>;
export function createServiceDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,business:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(serviceId(business));if(signal.aborted)throw new Error();
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),business],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:ServiceSave,signal:AbortSignal){
   let submitted=false;
   try{
    // Seal nested definition and identifiers before any provider I/O.
    const request=parseServiceSave(input);
    const outcome=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,currentSignal)=>{
     if(currentSignal.aborted)throw new Error();submitted=true;
     const value=await query('SELECT crest_commands.save_service($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.serviceId,request.expectedRevision,request.payload]);
     if(currentSignal.aborted)throw new Error();
     if(exact(value,['state'])&&value.state==='denied')return null;
     if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','service','code'].includes(value.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'service'|'code'}));
     if(exact(value,['state','reason','currentRevision'])&&value.state==='conflict'&&value.reason==='version'&&serviceRevision(value.currentRevision,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentRevision:value.currentRevision}));
     if(exact(value,['state','serviceId','currentRevision'])&&value.state==='unchanged'){
      check(request.expectedRevision!=='0'&&value.serviceId===request.serviceId&&value.currentRevision===request.expectedRevision);
      return new PrivateValue(Object.freeze({state:'unchanged' as const,serviceId:request.serviceId,currentRevision:request.expectedRevision}));
     }
     const result=parseServiceCommitted(value,request.businessId,request.operationId);
     check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.serviceId===request.serviceId&&BigInt(result.receipt.serviceRevision)===BigInt(request.expectedRevision)+1n);
     return new PrivateValue(result);
    },bounded));
    // commandTransaction releases this only after acknowledged COMMIT.
    if(outcome===null)throw new ServiceDirectoryError('SERVICE_SAVE_DENIED');return outcome;
   }catch(error){
    if(error instanceof ServiceDirectoryError)throw error;
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new ServiceDirectoryError('RECOVERY_REVIEW_REQUIRED');
    throw new ServiceDirectoryError(submitted?'SERVICE_SAVE_OUTCOME_UNKNOWN':'SERVICE_SAVE_NOT_SUBMITTED');
   }
  },
  async lookup(credential:string,input:Readonly<{businessId:string;operationId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&serviceId(input.businessId)&&serviceId(input.operationId));const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     const value=await database('SELECT crest_commands.lookup_service_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);if(bounded.aborted)throw new Error();
     return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseServiceCommitted(value,request.businessId,request.operationId));
    });
   }catch{throw new ServiceDirectoryError('SERVICE_REQUEST_FAILED');}
  },
  async list(credential:string,input:DirectoryRequest,signal:AbortSignal){
   try{check(exact(input,['businessId','search','afterId','includeInactive','pageSize'])&&serviceId(input.businessId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||serviceId(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     const value=await database('SELECT crest_commands.read_service_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::boolean,$12::integer) AS result',[...args,request.search,request.afterId,request.includeInactive,request.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseServiceDirectoryPage(value,request));
    });
   }catch{throw new ServiceDirectoryError('SERVICE_REQUEST_FAILED');}
  },
  async history(credential:string,input:HistoryRequest,signal:AbortSignal){
   try{check(exact(input,['businessId','serviceId','afterRevision','pageSize'])&&serviceId(input.businessId)&&serviceId(input.serviceId)&&serviceRevision(input.afterRevision,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     const value=await database('SELECT crest_commands.read_service_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.serviceId,request.afterRevision,request.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseServiceHistoryPage(value,request));
    });
   }catch{throw new ServiceDirectoryError('SERVICE_REQUEST_FAILED');}
  }
 });
}
