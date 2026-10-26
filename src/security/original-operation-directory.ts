import 'server-only';
import {sessionDatabase} from './session-database.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createSessionLifecycle} from './session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOriginalOperationReference,parseOriginalOperationRetirement,parseOriginalOperationOutcome,bindOriginalOperationRetirement} from './original-operation-reference.ts';
import type {OriginalOperationOutcome} from './original-operation-reference.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createProviderBoundary} from './provider-auth.ts';
import type {createProviderTokenStore} from './provider-token-store.ts';

type Conflict=Readonly<{state:'conflict';reason:'operation'}>;
type ReadResult=OriginalOperationOutcome|Conflict|Readonly<{state:'absent'}>;
type Code='ORIGINAL_OPERATION_NOT_SUBMITTED'|'ORIGINAL_OPERATION_OUTCOME_UNKNOWN'|'ORIGINAL_OPERATION_READ_FAILED'|'ORIGINAL_OPERATION_VALUE_PRIVATE'|'RECOVERY_REVIEW_REQUIRED';
export class OriginalOperationDirectoryError extends Error{constructor(code:Code){super(code);this.name='OriginalOperationDirectoryError';}}
class PrivateValue<T>{
 #value:T;
 constructor(value:T){this.#value=value;Object.freeze(this);}
 forServer(){return this.#value;}
 toJSON():never{throw new OriginalOperationDirectoryError('ORIGINAL_OPERATION_VALUE_PRIVATE');}
}
const conflict=(value:unknown):value is Conflict=>exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation';

// Fixed commands only. Construction remains unreachable until registered
// migration, private transport, explicit owner controls and release acceptance.
// Neither absence nor original_recorded releases a pending reference here.
export function createOriginalOperationDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,external:AbortSignal,work:(args:unknown[],signal:AbortSignal)=>Promise<T>){
  const signal=AbortSignal.any([external,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{
   if(signal.aborted)throw new Error();
   hash=sessionCredentialHash(credential);
   const verified=await sessions.verify(credential,signal,'background',true);
   if(signal.aborted)throw new Error();
   const result=await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],signal);
   if(signal.aborted)throw new Error();
   return result;
  }finally{hash?.fill(0);}
 }
 return Object.freeze({
  async retire(credential:string,input:unknown,signal:AbortSignal){
   let submitted=false;
   try{
    const request=parseOriginalOperationRetirement(input);
    return await authorized(credential,request.original.businessId,signal,async(args,bounded)=>{
     submitted=true;
     return database.commandTransaction(async(query,current)=>{
      const value=await query('SELECT crest_commands.retire_original_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::jsonb,$11::text) AS result',[...args,request.recoveryEpoch,request.original,request.reason]);
      if(current.aborted)throw new Error();
      return new PrivateValue<OriginalOperationOutcome|Conflict>(conflict(value)?Object.freeze({state:'conflict',reason:'operation'}):bindOriginalOperationRetirement(value,request));
     },bounded);
    });
   }catch(error){
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new OriginalOperationDirectoryError('RECOVERY_REVIEW_REQUIRED');
    throw new OriginalOperationDirectoryError(submitted?'ORIGINAL_OPERATION_OUTCOME_UNKNOWN':'ORIGINAL_OPERATION_NOT_SUBMITTED');
   }
  },
  async lookup(credential:string,input:unknown,signal:AbortSignal){
   try{
    const original=parseOriginalOperationReference(input);
    return await authorized(credential,original.businessId,signal,async(args,bounded)=>{
     const value=await database('SELECT crest_commands.lookup_original_operation_resolution($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result',[...args,original],bounded);
     if(bounded.aborted)throw new Error();
     const result:ReadResult=exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent'}):conflict(value)?Object.freeze({state:'conflict',reason:'operation'}):parseOriginalOperationOutcome(value,original);
     return new PrivateValue(result);
    });
   }catch{throw new OriginalOperationDirectoryError('ORIGINAL_OPERATION_READ_FAILED');}
  }
 });
}
