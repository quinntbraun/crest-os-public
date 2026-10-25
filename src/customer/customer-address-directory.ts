import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as addressUuid,customerVersion as addressVersion,customerInstant as addressInstant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseCustomerAddress as parseAddress} from './customer-address-contract.ts';
import {parseAddressDraft} from './customer-resource-contract.ts';
import type {AddressDraft} from './customer-resource-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Save=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;addressId:string;customerId:string;expectedVersion:string;draft:AddressDraft}>;
type Receipt=Readonly<{schemaVersion:1;businessId:string;addressId:string;customerId:string;addressVersion:string;auditEventId:string}>;
type Committed=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
type Code='ADDRESS_REQUEST_FAILED'|'ADDRESS_SAVE_NOT_SUBMITTED'|'ADDRESS_SAVE_DENIED'|'ADDRESS_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'ADDRESS_VALUE_PRIVATE';
export class CustomerAddressDirectoryError extends Error{constructor(readonlyCode:Code){super(readonlyCode);this.name='CustomerAddressDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new CustomerAddressDirectoryError('ADDRESS_VALUE_PRIVATE');}}
function committed(value:unknown,businessId:string,operationId:string):Committed{
  check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&addressUuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','addressId','customerId','addressVersion','auditEventId']));
  const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&addressUuid(r.addressId)&&addressUuid(r.customerId)&&addressVersion(r.addressVersion)&&addressUuid(r.auditEventId));
  return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})}) as Committed;
}
export function createCustomerAddressDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
  const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
  async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
    check(addressUuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
    try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
  }
  return Object.freeze({
    async save(credential:string,input:Save,signal:AbortSignal){
      let submitted=false;
      try{
        check(exact(input,['schemaVersion','businessId','operationId','recoveryEpoch','addressId','customerId','expectedVersion','draft'])&&input.schemaVersion===1&&addressUuid(input.businessId)&&addressUuid(input.operationId)&&addressUuid(input.recoveryEpoch)&&addressUuid(input.addressId)&&addressUuid(input.customerId)&&addressVersion(input.expectedVersion,true));
        const request=Object.freeze({...input,draft:parseAddressDraft(input.draft)});
        const outcome=await authorized(credential,request.businessId,signal,async(args,bounded)=>{
          submitted=true;
          return database.commandTransaction(async(query,currentSignal)=>{
            const value=await query('SELECT crest_commands.save_address($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.addressId,request.customerId,request.expectedVersion,request.draft]);
            if(currentSignal.aborted)throw new Error();
            if(exact(value,['state'])&&value.state==='denied')return null;
            if(exact(value,['state','reason'])&&value.state==='conflict'&&(value.reason==='operation'||value.reason==='address'||value.reason==='parent'))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason}));
            if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&addressVersion(value.currentVersion,true))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
            const result=committed(value,request.businessId,request.operationId);check(result.recoveryEpoch===request.recoveryEpoch&&result.receipt.addressId===request.addressId&&result.receipt.customerId===request.customerId&&BigInt(result.receipt.addressVersion)===BigInt(request.expectedVersion)+1n);return new PrivateValue(result);
          },bounded);
        });
        if(outcome===null)throw new CustomerAddressDirectoryError('ADDRESS_SAVE_DENIED');return outcome;
      }catch(error){
        if(error instanceof CustomerAddressDirectoryError)throw error;
        if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new CustomerAddressDirectoryError('RECOVERY_REVIEW_REQUIRED');
        throw new CustomerAddressDirectoryError(submitted?'ADDRESS_SAVE_OUTCOME_UNKNOWN':'ADDRESS_SAVE_NOT_SUBMITTED');
      }
    },
    async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
      try{check(exact(input,['businessId','operationId'])&&addressUuid(input.businessId)&&addressUuid(input.operationId));const {businessId,operationId}=input;
        return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_address_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):committed(value,businessId,operationId));});
      }catch{throw new CustomerAddressDirectoryError('ADDRESS_REQUEST_FAILED');}
    },
    async list(credential:string,input:{businessId:string;customerId:string;search:string;afterId:string|null;includeArchived:boolean;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','customerId','search','afterId','includeArchived','pageSize'])&&addressUuid(input.businessId)&&addressUuid(input.customerId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||addressUuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_address_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::uuid,$12::boolean,$13::integer) AS result',[...args,request.customerId,request.search,request.afterId,request.includeArchived,request.pageSize],bounded);
          check(!bounded.aborted&&exact(value,['schemaVersion','businessId','customerId','addresses','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&value.customerId===request.customerId&&Array.isArray(value.addresses)&&value.addresses.length<=request.pageSize&&typeof value.hasMore==='boolean');
          const addresses=Array.from(value.addresses,c=>parseAddress(c,request.businessId,request.customerId));let previous=request.afterId;for(const c of addresses){check(previous===null||c.id>previous);check(request.includeArchived||c.archived_at===null);previous=c.id;}check(!value.hasMore||addresses.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,customerId:request.customerId,addresses:Object.freeze(addresses),hasMore:value.hasMore}));});
      }catch{throw new CustomerAddressDirectoryError('ADDRESS_REQUEST_FAILED');}
    },
    async history(credential:string,input:{businessId:string;addressId:string;customerId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
      try{check(exact(input,['businessId','addressId','customerId','afterVersion','pageSize'])&&addressUuid(input.businessId)&&addressUuid(input.addressId)&&addressUuid(input.customerId)&&addressVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
        return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_address_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::integer) AS result',[...args,request.customerId,request.addressId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();
          if(exact(value,['state'])&&value.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
          check(exact(value,['schemaVersion','businessId','customerId','address','history','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&value.customerId===request.customerId&&Array.isArray(value.history)&&value.history.length<=request.pageSize&&typeof value.hasMore==='boolean');const address=parseAddress(value.address,request.businessId,request.customerId);check(address.id===request.addressId);let previous=BigInt(request.afterVersion);
          const history=Array.from(value.history,event=>{
            check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&addressVersion(event.version)&&addressUuid(event.eventId)&&addressUuid(event.actorId)&&addressUuid(event.operationId)&&addressInstant(event.at)&&['create','edit','archive','reopen'].includes(event.action as string));
            const after=parseAddress(event.after,request.businessId,request.customerId),before=event.before===null?null:parseAddress(event.before,request.businessId,request.customerId);check(after.id===address.id&&event.version===after.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(address.version)&&(before===null?event.version==='1'&&event.action==='create':before.id===address.id&&BigInt(before.version)+1n===BigInt(event.version)));previous=BigInt(event.version);return Object.freeze({...event,before,after});
          });check(!value.hasMore||history.length===request.pageSize);
          return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,customerId:request.customerId,address,history:Object.freeze(history),hasMore:value.hasMore}));});
      }catch{throw new CustomerAddressDirectoryError('ADDRESS_REQUEST_FAILED');}
    }
  });
}
