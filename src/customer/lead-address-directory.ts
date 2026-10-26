import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadAddressSave,parseLeadAddressCommitted,parseLeadAddressPage,parseLeadAddressHistory} from './lead-address-command-contract.ts';
import type {LeadAddressSave} from './lead-address-command-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='LEAD_ADDRESS_REQUEST_FAILED'|'LEAD_ADDRESS_NOT_SUBMITTED'|'LEAD_ADDRESS_DENIED'|'LEAD_ADDRESS_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'LEAD_ADDRESS_VALUE_PRIVATE';
export class LeadAddressDirectoryError extends Error{constructor(code:Code){super(code);this.name='LeadAddressDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new LeadAddressDirectoryError('LEAD_ADDRESS_VALUE_PRIVATE');}}
export function createLeadAddressDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(uuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:LeadAddressSave,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseLeadAddressSave(input);
    const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     submitted=true;return database.commandTransaction(async(query,currentSignal)=>{
      const value=await query('SELECT crest_commands.save_lead_address($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.leadId,request.leadAddressId,request.expectedVersion,request.draft]);
      if(currentSignal.aborted)throw new Error();
      if(exact(value,['state'])&&value.state==='denied')return null;
      if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','parent','lead_address'].includes(value.reason as string))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'parent'|'lead_address'}));
      if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&version(value.currentVersion,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
      const result=parseLeadAddressCommitted(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.leadId===request.leadId&&result.receipt.leadAddressId===request.leadAddressId&&BigInt(result.receipt.leadAddressVersion as string)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
     },bounded);
    });if(outcome===null)throw new LeadAddressDirectoryError('LEAD_ADDRESS_DENIED');return outcome;
   }catch(error){if(error instanceof LeadAddressDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new LeadAddressDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new LeadAddressDirectoryError(submitted?'LEAD_ADDRESS_OUTCOME_UNKNOWN':'LEAD_ADDRESS_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&uuid(input.businessId)&&uuid(input.operationId));const {businessId,operationId}=input;return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_lead_address_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseLeadAddressCommitted(value,businessId,operationId));});}catch{throw new LeadAddressDirectoryError('LEAD_ADDRESS_REQUEST_FAILED');}
  },
  async list(credential:string,input:{businessId:string;leadId:string;afterId:string|null;includeArchived:boolean;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','leadId','afterId','includeArchived','pageSize'])&&uuid(input.businessId)&&uuid(input.leadId)&&(input.afterId===null||uuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const r=Object.freeze({...input});return await authorized(credential,r.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_addresses($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::boolean,$12::integer) AS result',[...args,r.leadId,r.afterId,r.includeArchived,r.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseLeadAddressPage(value,r.businessId,r.leadId,r.afterId,r.includeArchived,r.pageSize));});}catch{throw new LeadAddressDirectoryError('LEAD_ADDRESS_REQUEST_FAILED');}
  },
  async history(credential:string,input:{businessId:string;leadId:string;leadAddressId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','leadId','leadAddressId','afterVersion','pageSize'])&&uuid(input.businessId)&&uuid(input.leadId)&&uuid(input.leadAddressId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const r=Object.freeze({...input});return await authorized(credential,r.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_address_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::integer) AS result',[...args,r.leadId,r.leadAddressId,r.afterVersion,r.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseLeadAddressHistory(value,r.businessId,r.leadId,r.leadAddressId,r.afterVersion,r.pageSize));});}catch{throw new LeadAddressDirectoryError('LEAD_ADDRESS_REQUEST_FAILED');}
  }
 });
}
