import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {customerUuid as uuid,customerVersion as version,customerInstant as instant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {associationColumns,parseAssociation,associationClose} from './vehicle-association-contract.ts';
import {parseAssociationSave,parseAssociationCommitted} from './association-command-contract.ts';
import type {AssociationSave} from './association-command-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Code='ASSOCIATION_REQUEST_FAILED'|'ASSOCIATION_SAVE_NOT_SUBMITTED'|'ASSOCIATION_SAVE_DENIED'|'ASSOCIATION_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'ASSOCIATION_VALUE_PRIVATE';
export class AssociationDirectoryError extends Error{constructor(code:Code){super(code);this.name='AssociationDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new AssociationDirectoryError('ASSOCIATION_VALUE_PRIVATE');}}
const conflicts=['operation','parent','association','owner_period','billing_period'] as const;
export function createVehicleAssociationDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(uuid(businessId));const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:AssociationSave,signal:AbortSignal){
   let submitted=false;
   try{const request=parseAssociationSave(input);const result=await authorized(credential,request.businessId,signal,async(args,bounded)=>{submitted=true;
    return database.commandTransaction(async(query,currentSignal)=>{
     const value=await query('SELECT crest_commands.change_vehicle_association($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.expectedVersion,request.body]);if(currentSignal.aborted)throw new Error();
     if(exact(value,['state'])&&value.state==='denied')return null;
     if(exact(value,['state','reason'])&&value.state==='conflict'&&conflicts.includes(value.reason as typeof conflicts[number]))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as typeof conflicts[number]}));
     if(exact(value,['state','reason','currentVersion'])&&value.state==='conflict'&&value.reason==='version'&&version(value.currentVersion))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentVersion:value.currentVersion}));
     const committed=parseAssociationCommitted(value,request.businessId,request.operationId),r=committed.receipt;
     check(committed.recoveryEpoch===request.recoveryEpoch&&r.action===request.body.action&&r.vehicleId===request.body.vehicleId&&r.associationId===request.body.associationId&&(request.body.action!=='transfer'||r.openedAssociationId===request.body.nextAssociationId));
     return new PrivateValue(committed);
    },bounded);
   });if(result===null)throw new AssociationDirectoryError('ASSOCIATION_SAVE_DENIED');return result;
   }catch(error){if(error instanceof AssociationDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new AssociationDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new AssociationDirectoryError(submitted?'ASSOCIATION_SAVE_OUTCOME_UNKNOWN':'ASSOCIATION_SAVE_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&uuid(input.businessId)&&uuid(input.operationId));const {businessId,operationId}=input;
    return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_vehicle_association_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseAssociationCommitted(value,businessId,operationId));});
   }catch{throw new AssociationDirectoryError('ASSOCIATION_REQUEST_FAILED');}
  },
  async list(credential:string,input:{businessId:string;vehicleId:string;afterId:string|null;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','vehicleId','afterId','pageSize'])&&uuid(input.businessId)&&uuid(input.vehicleId)&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_vehicle_associations($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer) AS result',[...args,request.vehicleId,request.afterId,request.pageSize],bounded);
     check(!bounded.aborted&&exact(value,['schemaVersion','businessId','vehicleId','associations','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&value.vehicleId===request.vehicleId&&Array.isArray(value.associations)&&value.associations.length<=request.pageSize&&typeof value.hasMore==='boolean');
     const associations=Array.from(value.associations,row=>parseAssociation(row,request.businessId));let previous=request.afterId;for(const row of associations){check(row.vehicle_id===request.vehicleId&&(previous===null||row.id>previous));previous=row.id;}check(!value.hasMore||associations.length===request.pageSize);
     return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,vehicleId:request.vehicleId,associations:Object.freeze(associations),hasMore:value.hasMore}));});
   }catch{throw new AssociationDirectoryError('ASSOCIATION_REQUEST_FAILED');}
  },
  async history(credential:string,input:{businessId:string;associationId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','associationId','afterVersion','pageSize'])&&uuid(input.businessId)&&uuid(input.associationId)&&['0','1','2'].includes(input.afterVersion)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);const request=Object.freeze({...input});
    return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_vehicle_association_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::bigint,$11::integer) AS result',[...args,request.associationId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();
     if(exact(value,['state'])&&value.state==='absent')return new PrivateValue(Object.freeze({state:'absent' as const}));
     check(exact(value,['schemaVersion','businessId','association','history','hasMore'])&&value.schemaVersion===1&&value.businessId===request.businessId&&Array.isArray(value.history)&&value.history.length<=request.pageSize&&typeof value.hasMore==='boolean');const association=parseAssociation(value.association,request.businessId);check(association.id===request.associationId);let previous=BigInt(request.afterVersion);
     const history=Array.from(value.history,event=>{check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&version(event.version)&&uuid(event.eventId)&&uuid(event.actorId)&&uuid(event.operationId)&&instant(event.at));const after=parseAssociation(event.after,request.businessId),before=event.before===null?null:parseAssociation(event.before,request.businessId);
      check(after.id===association.id&&after.version===event.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&event.at>=after.updated_at&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(association.version));
      if(before===null)check(event.action==='open'&&after.version==='1');else{check(event.action==='close');associationClose(before,after,request.businessId);}previous=BigInt(event.version);return Object.freeze({...event,before,after});
     });const remaining=Math.max(0,Number(association.version)-Number(request.afterVersion));check(history.length===Math.min(request.pageSize,remaining)&&value.hasMore===(remaining>request.pageSize));if(history.length&&history.at(-1)!.after.version===association.version)check(associationColumns.every(k=>history.at(-1)!.after[k]===association[k]));
     return new PrivateValue(Object.freeze({schemaVersion:1 as const,businessId:request.businessId,association,history:Object.freeze(history),hasMore:value.hasMore}));});
   }catch{throw new AssociationDirectoryError('ASSOCIATION_REQUEST_FAILED');}
  }
 });
}
