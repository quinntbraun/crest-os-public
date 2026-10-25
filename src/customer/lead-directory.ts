import {isDeepStrictEqual} from 'node:util';
import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as leadUuid,customerVersion as leadVersion,customerInstant as leadInstant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLead} from './lead-contract.ts';
import {validateLeadHistoryChange} from './lead-history-contract.ts';
import {parseLeadDraft} from './lead-contract.ts';
import type {LeadDraft} from './lead-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Save=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;leadId:string;expectedVersion:string;draft:LeadDraft}>;
type Receipt=Readonly<{schemaVersion:1;businessId:string;leadId:string;leadVersion:string;auditEventId:string}>;
type Committed=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
type Code='LEAD_REQUEST_FAILED'|'LEAD_SAVE_NOT_SUBMITTED'|'LEAD_SAVE_DENIED'|'LEAD_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'LEAD_VALUE_PRIVATE';
export class LeadDirectoryError extends Error{constructor(readonlyCode:Code){super(readonlyCode);this.name='LeadDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new LeadDirectoryError('LEAD_VALUE_PRIVATE');}}
function committed(value:unknown,businessId:string,operationId:string):Committed{
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&leadUuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','leadId','leadVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&leadUuid(r.leadId)&&leadVersion(r.leadVersion)&&leadUuid(r.auditEventId));
  return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})}) as Committed;
}
export function createLeadDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
    check(leadUuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
    try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
  }
  return Object.freeze({
    async save(credential:string,input:Save,signal:AbortSignal){
      let submitted=false;
      try{
        check(exact(input,['schemaVersion','businessId','operationId','recoveryEpoch','leadId','expectedVersion','draft'])&&input.schemaVersion===1&&leadUuid(input.businessId)&&leadUuid(input.operationId)&&leadUuid(input.recoveryEpoch)&&leadUuid(input.leadId)&&leadVersion(input.expectedVersion,true));
        const request=Object.freeze({...input,draft:parseLeadDraft(input.draft)});
        const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
          submitted=true;
          return database.commandTransaction(async(query,currentSignal)=>{
            const value=await query('SELECT crest_commands.save_lead($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.leadId,request.expectedVersion,request.draft]);
            if(currentSignal.aborted)throw new Error();
            if(exact(value,['state'])&&value.state==='denied')return null;
            if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='lead'||value.reason==='parent'))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
            if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&leadVersion(value.currentVersion,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
            const result=committed(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.leadId===request.leadId&&BigInt(result.receipt.leadVersion)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
          },bounded);
        });
        if(outcome===null)throw new LeadDirectoryError('LEAD_SAVE_DENIED');return outcome;
      }catch(error){
        if(error instanceof LeadDirectoryError)throw error;
        if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new LeadDirectoryError('RECOVERY_REVIEW_REQUIRED');
        throw new LeadDirectoryError(submitted?'LEAD_SAVE_OUTCOME_UNKNOWN':'LEAD_SAVE_NOT_SUBMITTED');
      }
    },
    async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
      try{check(exact(input,['businessId','operationId'])&&leadUuid(input.businessId)&&leadUuid(input.operationId));const {businessId,operationId}=input;
        return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_lead_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):committed(value,businessId,operationId));});
      }catch{throw new LeadDirectoryError('LEAD_REQUEST_FAILED');}
    },
    async list(credential:string,input:{businessId:string;search:string;afterId:string|null;includeLost:boolean;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','search','afterId','includeLost','pageSize'])&&leadUuid(input.businessId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||leadUuid(input.afterId))&&typeof input.includeLost==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::boolean,$12::integer) AS result',[...args,request.search,request.afterId,request.includeLost,request.pageSize],bounded);
          check(!bounded.aborted&&exact(value,['schemaVersion','businessId','leads','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.leads)&&value.leads.length<=request.pageSize&&typeof value.hasMore==='boolean');
          const leads=Array.from(value.leads,c=>parseLead(c,request.businessId));let previous=request.afterId;for(const c of leads){check(previous===null||c.id>previous);check(request.includeLost||c.state!=='lost');previous=c.id;}check(!value.hasMore||leads.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,leads:Object.freeze(leads),hasMore:value.hasMore}));});
      }catch{throw new LeadDirectoryError('LEAD_REQUEST_FAILED');}
    },
    async history(credential:string,input:{businessId:string;leadId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','leadId','afterVersion','pageSize'])&&leadUuid(input.businessId)&&leadUuid(input.leadId)&&leadVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.leadId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();
          if(exact(value,['state'])&&value.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
          check(exact(value,['schemaVersion','businessId','lead','history','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.history)&&value.history.length<=request.pageSize&&typeof value.hasMore==='boolean');const lead=parseLead(value.lead,request.businessId);check(lead.id===request.leadId);let previous=BigInt(request.afterVersion),last:ReturnType<typeof parseLead>|null=null;
          const history=Array.from(value.history,event=>{
            check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&leadVersion(event.version)&&leadUuid(event.eventId)&&leadUuid(event.actorId)&&leadUuid(event.operationId)&&leadInstant(event.at)&&['create','edit','state_change'].includes(event.action as string));
            const after=parseLead(event.after,request.businessId),before=event.before===null?null:parseLead(event.before,request.businessId);check(after.id===lead.id&&event.version===after.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(lead.version)&&(before===null?event.version==='1'&&event.action==='create':before.id===lead.id&&BigInt(before.version)+1n===BigInt(event.version)));validateLeadHistoryChange(event.action,before,after);check(last===null||isDeepStrictEqual(last,before));last=after;previous=BigInt(event.version);return Object.freeze({...event,before,after});
          });const remaining=BigInt(lead.version)>BigInt(request.afterVersion)?BigInt(lead.version)-BigInt(request.afterVersion):0n;check(BigInt(history.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&value.hasMore===(remaining>BigInt(request.pageSize))&&(last===null||previous!==BigInt(lead.version)||isDeepStrictEqual(last,lead)));
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,lead,history:Object.freeze(history),hasMore:value.hasMore}));});
      }catch{throw new LeadDirectoryError('LEAD_REQUEST_FAILED');}
    }
  });
}
