import 'server-only';
import {sessionDatabase} from '../security/session-database.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseFieldSessionSave,fieldSessionOriginal,parseFieldSessionCommitted,fieldSessionConflicts} from './field-session-contract.ts';
export class FieldDirectoryError extends Error{constructor(code:string){super(code);this.name='FieldDirectoryError';}}
class PrivateValue<T>{#value:T;constructor(value:T){this.#value=value;}forServer(){return this.#value;}toJSON():never{throw new FieldDirectoryError('FIELD_VALUE_PRIVATE');}}
export function createFieldDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 if(config.environment!=='test')throw new FieldDirectoryError('FIELD_CONFIGURATION_REQUIRED');
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 return Object.freeze({async saveSession(credential:string,input:unknown,signal:AbortSignal){
  let submitted=false,hash:Buffer|undefined;
  try{
   const request=parseFieldSessionSave(input),original=fieldSessionOriginal(request),bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);
   if(bounded.aborted)throw Error();hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();
   const args=[hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),request.businessId];
   return await database.commandTransaction(async(query,current)=>{
    if(current.aborted)throw Error();submitted=true;
    const value=await query('SELECT crest_commands.change_field_session($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.jobId,request.expectedJobVersion,request.body]);if(current.aborted)throw Error();
    if(exact(value,['state','reason'])&&value.state==='conflict'&&fieldSessionConflicts.includes(value.reason as typeof fieldSessionConflicts[number]))return new PrivateValue(Object.freeze({state:'conflict' as const,reason:value.reason as typeof fieldSessionConflicts[number]}));
    if(!exact(value,['state','receipt'])||value.state!=='committed')throw Error();
    // The existing typed-original function verifies the complete immutable
    // source/audit graph. Its minimized result remains private until COMMIT.
    const observed=await query('SELECT crest_commands.lookup_scheduling_original($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result',[...args,original]);if(current.aborted)throw Error();
    const committed=parseFieldSessionCommitted(observed,request);if(committed.result.receipt.actorId!==verified.actorId)throw Error();return new PrivateValue(committed);
   },bounded);
  }catch(error){if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new FieldDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new FieldDirectoryError(submitted?'FIELD_SAVE_OUTCOME_UNKNOWN':'FIELD_SAVE_NOT_SUBMITTED');}
  finally{hash?.fill(0);}
 }});
}
