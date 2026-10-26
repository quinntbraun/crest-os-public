import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as uuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadConversion} from './lead-conversion-contract.ts';
import type {LeadConversion} from './lead-conversion-contract.ts';
import {bindLeadConversionCommitted,parseLeadConversionCommitted,parseLeadConversionConflict,parseLeadConversionRead,parseLeadConversionLinkPage} from './lead-conversion-command-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='LEAD_CONVERSION_REQUEST_FAILED'|'LEAD_CONVERSION_NOT_SUBMITTED'|'LEAD_CONVERSION_DENIED'|'LEAD_CONVERSION_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'LEAD_CONVERSION_VALUE_PRIVATE';
export class LeadConversionDirectoryError extends Error{constructor(code:Code){super(code);this.name='LeadConversionDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new LeadConversionDirectoryError('LEAD_CONVERSION_VALUE_PRIVATE');}}
export function createLeadConversionDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(uuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async convert(credential:string,input:LeadConversion,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseLeadConversion(input);
    const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     submitted=true;return database.commandTransaction(async(query,currentSignal)=>{
      const value=await query('SELECT crest_commands.convert_lead($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.conversionId,request.leadId,request.expectedLeadVersion,{customer:request.customer,vehicles:request.vehicles,addresses:request.addresses}]);
      if(currentSignal.aborted)throw new Error();
      if(exact(value,['state'])&&value.state==='denied')return null;
      if(exact(value,['state','reason'])&&value.state==='conflict')return new PrivateValue(parseLeadConversionConflict(value));
      return new PrivateValue(bindLeadConversionCommitted(value,request));
     },bounded);
    });if(outcome===null)throw new LeadConversionDirectoryError('LEAD_CONVERSION_DENIED');return outcome;
   }catch(error){if(error instanceof LeadConversionDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new LeadConversionDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new LeadConversionDirectoryError(submitted?'LEAD_CONVERSION_OUTCOME_UNKNOWN':'LEAD_CONVERSION_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&uuid(input.businessId)&&uuid(input.operationId));const {businessId,operationId}=input;return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_lead_conversion_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseLeadConversionCommitted(value,businessId,operationId));});}catch{throw new LeadConversionDirectoryError('LEAD_CONVERSION_REQUEST_FAILED');}
  },
  async read(credential:string,input:{businessId:string;leadId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','leadId'])&&uuid(input.businessId)&&uuid(input.leadId));const {businessId,leadId}=input;return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_conversion($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,leadId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseLeadConversionRead(value,businessId,leadId));});}catch{throw new LeadConversionDirectoryError('LEAD_CONVERSION_REQUEST_FAILED');}
  },
  async links(credential:string,input:{businessId:string;leadId:string;conversionId:string;afterId:string|null;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','leadId','conversionId','afterId','pageSize'])&&uuid(input.businessId)&&uuid(input.leadId)&&uuid(input.conversionId)&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const r=Object.freeze({...input});return await authorized(credential,r.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_conversion_links($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::uuid,$12::integer) AS result',[...args,r.leadId,r.conversionId,r.afterId,r.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseLeadConversionLinkPage(value,r.businessId,r.leadId,r.conversionId,r.afterId,r.pageSize));});}catch{throw new LeadConversionDirectoryError('LEAD_CONVERSION_REQUEST_FAILED');}
  }
 });
}
