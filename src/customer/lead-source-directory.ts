import {isDeepStrictEqual} from 'node:util';
import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as leadSourceUuid,customerVersion as leadSourceVersion,customerInstant as leadSourceInstant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadSource} from './lead-contract.ts';
import {parseLeadSourceDraft} from './lead-contract.ts';
import type {LeadSourceDraft} from './lead-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Save=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;leadSourceId:string;expectedVersion:string;draft:LeadSourceDraft}>;
type Receipt=Readonly<{schemaVersion:1;businessId:string;leadSourceId:string;leadSourceVersion:string;auditEventId:string}>;
type Committed=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
type Code='LEAD_SOURCE_REQUEST_FAILED'|'LEAD_SOURCE_SAVE_NOT_SUBMITTED'|'LEAD_SOURCE_SAVE_DENIED'|'LEAD_SOURCE_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'LEAD_SOURCE_VALUE_PRIVATE';
export class LeadSourceDirectoryError extends Error{constructor(readonlyCode:Code){super(readonlyCode);this.name='LeadSourceDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new LeadSourceDirectoryError('LEAD_SOURCE_VALUE_PRIVATE');}}
function committed(value:unknown,businessId:string,operationId:string):Committed{
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&leadSourceUuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','leadSourceId','leadSourceVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&leadSourceUuid(r.leadSourceId)&&leadSourceVersion(r.leadSourceVersion)&&leadSourceUuid(r.auditEventId));
  return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})}) as Committed;
}
export function createLeadSourceDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
    check(leadSourceUuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
    try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
  }
  return Object.freeze({
    async save(credential:string,input:Save,signal:AbortSignal){
      let submitted=false;
      try{
        check(exact(input,['schemaVersion','businessId','operationId','recoveryEpoch','leadSourceId','expectedVersion','draft'])&&input.schemaVersion===1&&leadSourceUuid(input.businessId)&&leadSourceUuid(input.operationId)&&leadSourceUuid(input.recoveryEpoch)&&leadSourceUuid(input.leadSourceId)&&leadSourceVersion(input.expectedVersion,true));
        const request=Object.freeze({...input,draft:parseLeadSourceDraft(input.draft)});
        const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
          submitted=true;
          return database.commandTransaction(async(query,currentSignal)=>{
            const value=await query('SELECT crest_commands.save_lead_source($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.leadSourceId,request.expectedVersion,request.draft]);
            if(currentSignal.aborted)throw new Error();
            if(exact(value,['state'])&&value.state==='denied')return null;
            if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='lead_source'||value.reason==='parent'||value.reason==='label'))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
            if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&leadSourceVersion(value.currentVersion,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
            const result=committed(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.leadSourceId===request.leadSourceId&&BigInt(result.receipt.leadSourceVersion)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
          },bounded);
        });
        if(outcome===null)throw new LeadSourceDirectoryError('LEAD_SOURCE_SAVE_DENIED');return outcome;
      }catch(error){
        if(error instanceof LeadSourceDirectoryError)throw error;
        if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new LeadSourceDirectoryError('RECOVERY_REVIEW_REQUIRED');
        throw new LeadSourceDirectoryError(submitted?'LEAD_SOURCE_SAVE_OUTCOME_UNKNOWN':'LEAD_SOURCE_SAVE_NOT_SUBMITTED');
      }
    },
    async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
      try{check(exact(input,['businessId','operationId'])&&leadSourceUuid(input.businessId)&&leadSourceUuid(input.operationId));const {businessId,operationId}=input;
        return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_lead_source_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):committed(value,businessId,operationId));});
      }catch{throw new LeadSourceDirectoryError('LEAD_SOURCE_REQUEST_FAILED');}
    },
    async list(credential:string,input:{businessId:string;search:string;afterId:string|null;includeInactive:boolean;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','search','afterId','includeInactive','pageSize'])&&leadSourceUuid(input.businessId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||leadSourceUuid(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_source_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::boolean,$12::integer) AS result',[...args,request.search,request.afterId,request.includeInactive,request.pageSize],bounded);
          check(!bounded.aborted&&exact(value,['schemaVersion','businessId','lead_sources','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.lead_sources)&&value.lead_sources.length<=request.pageSize&&typeof value.hasMore==='boolean');
          const leadSources=Array.from(value.lead_sources,c=>parseLeadSource(c,request.businessId));let previous=request.afterId;for(const c of leadSources){check(previous===null||c.id>previous);check(request.includeInactive||c.active);previous=c.id;}check(!value.hasMore||leadSources.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,leadSources:Object.freeze(leadSources),hasMore:value.hasMore}));});
      }catch{throw new LeadSourceDirectoryError('LEAD_SOURCE_REQUEST_FAILED');}
    },
    async history(credential:string,input:{businessId:string;leadSourceId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','leadSourceId','afterVersion','pageSize'])&&leadSourceUuid(input.businessId)&&leadSourceUuid(input.leadSourceId)&&leadSourceVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_lead_source_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.leadSourceId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();
          if(exact(value,['state'])&&value.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
          check(exact(value,['schemaVersion','businessId','lead_source','history','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.history)&&value.history.length<=request.pageSize&&typeof value.hasMore==='boolean');const leadSource=parseLeadSource(value.lead_source,request.businessId);check(leadSource.id===request.leadSourceId);let previous=BigInt(request.afterVersion),last:ReturnType<typeof parseLeadSource>|null=null;
          const history=Array.from(value.history,event=>{
            check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&leadSourceVersion(event.version)&&leadSourceUuid(event.eventId)&&leadSourceUuid(event.actorId)&&leadSourceUuid(event.operationId)&&leadSourceInstant(event.at)&&['create','edit','activate','deactivate'].includes(event.action as string));
            const after=parseLeadSource(event.after,request.businessId),before=event.before===null?null:parseLeadSource(event.before,request.businessId);check(after.id===leadSource.id&&event.version===after.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(leadSource.version)&&(before===null?event.version==='1'&&event.action==='create':before.id===leadSource.id&&BigInt(before.version)+1n===BigInt(event.version)));check(last===null||isDeepStrictEqual(last,before));last=after;previous=BigInt(event.version);return Object.freeze({...event,before,after});
          });const remaining=BigInt(leadSource.version)>BigInt(request.afterVersion)?BigInt(leadSource.version)-BigInt(request.afterVersion):0n;check(BigInt(history.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&value.hasMore===(remaining>BigInt(request.pageSize))&&(last===null||previous!==BigInt(leadSource.version)||isDeepStrictEqual(last,leadSource)));
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,leadSource,history:Object.freeze(history),hasMore:value.hasMore}));});
      }catch{throw new LeadSourceDirectoryError('LEAD_SOURCE_REQUEST_FAILED');}
    }
  });
}
