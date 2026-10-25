import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadStateSave,parseLeadStateCommitted,parseLeadStatePage} from './lead-state-command-contract.ts';
import type {LeadStateSave} from './lead-state-command-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Code='LEAD_STATE_REQUEST_FAILED'|'LEAD_STATE_NOT_SUBMITTED'|'LEAD_STATE_DENIED'|'LEAD_STATE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'LEAD_STATE_VALUE_PRIVATE';
export class LeadStateDirectoryError extends Error{constructor(code:Code){super(code);this.name='LeadStateDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new LeadStateDirectoryError('LEAD_STATE_VALUE_PRIVATE');}}
export function createLeadStateDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(uuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async change(credential:string,input:LeadStateSave,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseLeadStateSave(input);
    const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
     submitted=true;
     return database.commandTransaction(async(query,currentSignal)=>{
      const value=await query('SELECT crest_commands.change_lead_state($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.leadId,request.expectedVersion,request.draft]);
      if(currentSignal.aborted)throw new Error();
      if(exact(value,['state'])&&value.state==='denied')return null;
      if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='lead'||value.reason==='state'))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
      if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&version(value.currentVersion))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
      const result=parseLeadStateCommitted(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.leadId===request.leadId&&BigInt(result.receipt.leadVersion as string)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
     },bounded);
    });
    if(outcome===null)throw new LeadStateDirectoryError('LEAD_STATE_DENIED');return outcome;
   }catch(error){
    if(error instanceof LeadStateDirectoryError)throw error;
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new LeadStateDirectoryError('RECOVERY_REVIEW_REQUIRED');
    throw new LeadStateDirectoryError(submitted?'LEAD_STATE_OUTCOME_UNKNOWN':'LEAD_STATE_NOT_SUBMITTED');
   }
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&uuid(input.businessId)&&uuid(input.operationId));const {businessId,operationId}=input;
    return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_lead_state_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseLeadStateCommitted(value,businessId,operationId));});
   }catch{throw new LeadStateDirectoryError('LEAD_STATE_REQUEST_FAILED');}
  },
  async events(credential:string,input:{businessId:string;leadId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','leadId','afterVersion','pageSize'])&&uuid(input.businessId)&&uuid(input.leadId)&&version(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_state_events($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.leadId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(parseLeadStatePage(value,request.businessId,request.leadId,request.afterVersion,request.pageSize));});
   }catch{throw new LeadStateDirectoryError('LEAD_STATE_REQUEST_FAILED');}
  }
 });
}
