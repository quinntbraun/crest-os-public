import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseFulfillmentModeSave,parseFulfillmentModeCommitted,parseFulfillmentModeHistory,FulfillmentModeDataError} from './fulfillment-mode-contract.ts';
import type {FulfillmentModeSave} from './fulfillment-mode-contract.ts';
export class FulfillmentModeDirectoryError extends Error{constructor(code:string){super(code);this.name='FulfillmentModeDirectoryError';}}
function check(value:unknown):asserts value{if(!value)throw new FulfillmentModeDataError();}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;}forServer(){return this.#value;}toJSON():never{throw new FulfillmentModeDirectoryError('FULFILLMENT_MODE_VALUE_PRIVATE');}}
export function createFulfillmentModeDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,business:string,signal:AbortSignal,work:(args:unknown[],signal:AbortSignal)=>Promise<T>){
  check(customerUuid(business));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);if(bounded.aborted)throw Error();let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),business],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:FulfillmentModeSave,signal:AbortSignal){let submitted=false;
   try{const request=parseFulfillmentModeSave(input);return await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;const value=await query('SELECT crest_commands.save_fulfillment_modes($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::bigint,$12::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.expectedSequence,request.payload]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','review'].includes(value.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'review'}));
    if(exact(value,['state','reason','currentSequence'])&&value.state==='conflict'&&value.reason==='version'&&customerVersion(value.currentSequence,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentSequence:value.currentSequence}));
    const result=parseFulfillmentModeCommitted(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&BigInt(result.receipt.sequence)===BigInt(request.expectedSequence)+1n);return new PrivateValue(result);
   },bounded));}catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new FulfillmentModeDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new FulfillmentModeDirectoryError(submitted?'FULFILLMENT_MODE_SAVE_OUTCOME_UNKNOWN':'FULFILLMENT_MODE_SAVE_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_fulfillment_mode_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);check(!bounded.aborted);return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseFulfillmentModeCommitted(value,request.businessId,request.operationId));});}catch{throw new FulfillmentModeDirectoryError('FULFILLMENT_MODE_REQUEST_FAILED');}
  },
  async history(credential:string,input:{businessId:string;afterSequence:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','afterSequence','pageSize'])&&customerVersion(input.afterSequence,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_fulfillment_mode_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::bigint,$10::integer) AS result',[...args,request.afterSequence,request.pageSize],bounded);check(!bounded.aborted);return new PrivateValue(parseFulfillmentModeHistory(value,request.businessId,request.afterSequence,request.pageSize));});}catch{throw new FulfillmentModeDirectoryError('FULFILLMENT_MODE_REQUEST_FAILED');}
  }
 });
}
