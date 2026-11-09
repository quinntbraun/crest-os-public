import 'server-only';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {sessionDatabase} from '../security/session-database.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
import {completionConflicts,completionOriginal,parseCompletionCommitted,parseCompletionContext,parseCompletionSave} from './work-completion-contract.ts';

export class CompletionDirectoryError extends Error {
 constructor(code:string){super(code);this.name='CompletionDirectoryError';}
}
class PrivateCompletion<T> {
 #value:T;
 constructor(value:T){this.#value=value;}
 forServer(){return this.#value;}
 toJSON():never{throw new CompletionDirectoryError('COMPLETION_VALUE_PRIVATE');}
}
const readSql='SELECT crest_commands.read_job_completion_context($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result';
const completeSql='SELECT crest_commands.complete_job($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,1,$11::uuid,$12::bigint,$13::jsonb) AS result';
const originalSql='SELECT crest_commands.lookup_scheduling_original($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::jsonb) AS result';

export function createCompletionDirectory(
 config:SessionDatabaseConfiguration,
 provider:ReturnType<typeof createProviderBoundary>,
 tokens:Awaited<ReturnType<typeof createProviderTokenStore>>
) {
 if(config.environment!=='test')throw new CompletionDirectoryError('COMPLETION_CONFIGURATION_REQUIRED');
 const database=sessionDatabase(config);
 const sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(
  credential:string,businessId:string,signal:AbortSignal,
  work:(args:unknown[],actorId:string,bounded:AbortSignal)=>Promise<T>
 ) {
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);
  bounded.throwIfAborted();
  const hash=sessionCredentialHash(credential);
  try {
   const verified=await sessions.verify(credential,bounded,'background');
   bounded.throwIfAborted();
   return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,
    verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],verified.actorId,bounded);
  } finally {
   hash.fill(0);
  }
 }
 return Object.freeze({
  async context(credential:string,businessId:string,jobId:string,signal:AbortSignal) {
   try {
    if(!customerUuid(businessId)||!customerUuid(jobId))throw Error();
    return await authorized(credential,businessId,signal,async(args,_actorId,bounded)=>{
     const result=await database(readSql,[...args,jobId],bounded);
     bounded.throwIfAborted();
     return new PrivateCompletion(parseCompletionContext(result,businessId,jobId));
    });
   } catch {
    throw new CompletionDirectoryError('COMPLETION_CONTEXT_UNAVAILABLE');
   }
  },
  async complete(credential:string,input:unknown,signal:AbortSignal) {
   let submitted=false;
   try {
    const request=parseCompletionSave(input);
    const original=completionOriginal(request);
    return await authorized(credential,request.businessId,signal,(args,actorId,bounded)=>
     database.commandTransaction(async(query,current)=>{
      current.throwIfAborted();
      submitted=true;
      const result=await query(completeSql,[...args,request.recoveryEpoch,request.operationId,
       request.jobId,request.expectedJobVersion,request.body]);
      current.throwIfAborted();
      if(exact(result,['state','reason'])&&result.state==='conflict'
       &&completionConflicts.includes(result.reason as typeof completionConflicts[number])) {
       return new PrivateCompletion(Object.freeze({state:'conflict' as const,reason:result.reason as typeof completionConflicts[number]}));
      }
      if(!exact(result,['state','receipt'])||result.state!=='committed')throw Error();
      // Validate the persisted typed receipt before returning through acknowledged COMMIT.
      const observed=await query(originalSql,[...args,original]);
      current.throwIfAborted();
      const committed=parseCompletionCommitted(observed,request);
      if(committed.result.receipt.actorId!==actorId)throw Error();
      return new PrivateCompletion(committed);
     },bounded));
   } catch(error) {
    if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new CompletionDirectoryError('RECOVERY_REVIEW_REQUIRED');
    throw new CompletionDirectoryError(submitted?'COMPLETION_SAVE_OUTCOME_UNKNOWN':'COMPLETION_SAVE_NOT_SUBMITTED');
   }
  }
 });
}
