import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact,parseCustomer,parseCustomerDraft,requireCustomer as check} from './customer-contract.ts';
import type {CustomerDraft} from './customer-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Save=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;customerId:string;expectedVersion:string;draft:CustomerDraft}>;
type Receipt=Readonly<{schemaVersion:1;businessId:string;customerId:string;customerVersion:string;auditEventId:string}>;
type Committed=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
type Code='CUSTOMER_REQUEST_FAILED'|'CUSTOMER_SAVE_NOT_SUBMITTED'|'CUSTOMER_SAVE_DENIED'|'CUSTOMER_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'CUSTOMER_VALUE_PRIVATE';
export class CustomerDirectoryError extends Error{constructor(readonlyCode:Code){super(readonlyCode);this.name='CustomerDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new CustomerDirectoryError('CUSTOMER_VALUE_PRIVATE');}}
function committed(value:unknown,businessId:string,operationId:string):Committed{
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&customerUuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','customerId','customerVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&customerUuid(r.customerId)&&customerVersion(r.customerVersion)&&customerUuid(r.auditEventId));
  return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})}) as Committed;
}
export function createCustomerDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
    check(customerUuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
    try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
  }
  return Object.freeze({
    async save(credential:string,input:Save,signal:AbortSignal){
      let submitted=false;
      try{
        check(exact(input,['schemaVersion','businessId','operationId','recoveryEpoch','customerId','expectedVersion','draft'])&&input.schemaVersion===1&&customerUuid(input.businessId)&&customerUuid(input.operationId)&&customerUuid(input.recoveryEpoch)&&customerUuid(input.customerId)&&customerVersion(input.expectedVersion,true));
        const request=Object.freeze({...input,draft:parseCustomerDraft(input.draft)});
        const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
          submitted=true;
          return database.commandTransaction(async(query,currentSignal)=>{
            const value=await query('SELECT crest_commands.save_customer($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.customerId,request.expectedVersion,request.draft]);
            if(currentSignal.aborted)throw new Error();
            if(exact(value,['state'])&&value.state==='denied')return null;
            if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='customer'))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
            if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&customerVersion(value.currentVersion,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
            const result=committed(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.customerId===request.customerId&&BigInt(result.receipt.customerVersion)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
          },bounded);
        });
        if(outcome===null)throw new CustomerDirectoryError('CUSTOMER_SAVE_DENIED');return outcome;
      }catch(error){
        if(error instanceof CustomerDirectoryError)throw error;
        if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new CustomerDirectoryError('RECOVERY_REVIEW_REQUIRED');
        throw new CustomerDirectoryError(submitted?'CUSTOMER_SAVE_OUTCOME_UNKNOWN':'CUSTOMER_SAVE_NOT_SUBMITTED');
      }
    },
    async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
      try{check(exact(input,['businessId','operationId'])&&customerUuid(input.businessId)&&customerUuid(input.operationId));const {businessId,operationId}=input;
        return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_customer_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):committed(value,businessId,operationId));});
      }catch{throw new CustomerDirectoryError('CUSTOMER_REQUEST_FAILED');}
    },
    async list(credential:string,input:{businessId:string;search:string;afterId:string|null;includeArchived:boolean;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','search','afterId','includeArchived','pageSize'])&&customerUuid(input.businessId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||customerUuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_customer_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::boolean,$12::integer) AS result',[...args,request.search,request.afterId,request.includeArchived,request.pageSize],bounded);
          check(!bounded.aborted&&exact(value,['schemaVersion','businessId','customers','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.customers)&&value.customers.length<=request.pageSize&&typeof value.hasMore==='boolean');
          const customers=Array.from(value.customers,c=>parseCustomer(c,request.businessId));let previous=request.afterId;for(const c of customers){check(previous===null||c.id>previous);check(request.includeArchived||c.archived_at===null);previous=c.id;}check(!value.hasMore||customers.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,customers:Object.freeze(customers),hasMore:value.hasMore}));});
      }catch{throw new CustomerDirectoryError('CUSTOMER_REQUEST_FAILED');}
    },
    async history(credential:string,input:{businessId:string;customerId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','customerId','afterVersion','pageSize'])&&customerUuid(input.businessId)&&customerUuid(input.customerId)&&customerVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_customer_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.customerId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();
          if(exact(value,['state'])&&value.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
          check(exact(value,['schemaVersion','businessId','customer','history','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.history)&&value.history.length<=request.pageSize&&typeof value.hasMore==='boolean');const customer=parseCustomer(value.customer,request.businessId);check(customer.id===request.customerId);let previous=BigInt(request.afterVersion);
          const history=Array.from(value.history,event=>{
            check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&customerVersion(event.version)&&customerUuid(event.eventId)&&customerUuid(event.actorId)&&customerUuid(event.operationId)&&customerInstant(event.at)&&['create','edit','archive','reopen'].includes(event.action as string));
            const after=parseCustomer(event.after,request.businessId),before=event.before===null?null:parseCustomer(event.before,request.businessId);check(after.id===customer.id&&event.version===after.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(customer.version)&&(before===null?event.version==='1'&&event.action==='create':before.id===customer.id&&BigInt(before.version)+1n===BigInt(event.version)));previous=BigInt(event.version);return Object.freeze({...event,before,after});
          });check(!value.hasMore||history.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,customer,history:Object.freeze(history),hasMore:value.hasMore}));});
      }catch{throw new CustomerDirectoryError('CUSTOMER_REQUEST_FAILED');}
    }
  });
}
