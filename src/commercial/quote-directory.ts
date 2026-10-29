import 'server-only';
import {createHash} from 'node:crypto';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {prepareVersionedQuoteContent as prepareQuoteContent} from './quote-review-content.ts';
import {quoteId,quoteVersion,quoteHistoryPageLimit,requireQuoteStorage as check,parseQuoteSave,parseQuoteCommitted,parseQuoteDirectoryPage,parseQuoteHistoryPage} from './quote-storage-contract.ts';
import type {QuoteSave} from './quote-storage-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Code='QUOTE_REQUEST_FAILED'|'QUOTE_SAVE_NOT_SUBMITTED'|'QUOTE_SAVE_DENIED'|'QUOTE_SAVE_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'QUOTE_VALUE_PRIVATE';
export class QuoteDirectoryError extends Error{constructor(code:Code){super(code);this.name='QuoteDirectoryError';}}
class PrivateQuoteValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new QuoteDirectoryError('QUOTE_VALUE_PRIVATE');}}
export function createQuoteDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,business:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(quoteId(business));if(signal.aborted)throw new Error();const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),business],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async save(credential:string,input:QuoteSave,signal:AbortSignal){
   let submitted=false;
   try{
    // Freeze and recalculate before provider I/O; no caller total/hash is trusted.
    const request=parseQuoteSave(input),payload=prepareQuoteContent(request.content),contentHash=createHash('sha256').update(payload.canonical).digest('hex');
    const outcome=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,currentSignal)=>{
     if(currentSignal.aborted)throw new Error();submitted=true;
     const value=await query('SELECT crest_commands.save_quote_draft($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,request.content.schemaVersion,request.familyId,request.revisionId,request.expectedFamilyVersion,request.expectedRevisionVersion,{customer:payload.customer,internal:payload.internal,canonical:payload.canonical}]);
     if(currentSignal.aborted)throw new Error();
     if(exact(value,['state'])&&value.state==='denied')return null;
     if(exact(value,['state','reason'])&&value.state==='conflict'&&(request.content.schemaVersion===2?['operation','family','revision','state','assessment']:['operation','family','revision','state']).includes(value.reason as string))return new PrivateQuoteValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'family'|'revision'|'state'|'assessment'}));
     if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion,true)&&quoteVersion(value.currentRevisionVersion,true))return new PrivateQuoteValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:value.currentFamilyVersion,currentRevisionVersion:value.currentRevisionVersion}));
     if(exact(value,['state','familyId','familyVersion','revisionId','revisionVersion','contentHash'])&&value.state==='unchanged'){
      check(request.expectedFamilyVersion!=='0'&&value.familyId===request.familyId&&value.revisionId===request.revisionId&&value.familyVersion===request.expectedFamilyVersion&&value.revisionVersion===request.expectedRevisionVersion&&value.contentHash===contentHash);
      return new PrivateQuoteValue(Object.freeze({state:'unchanged' as const,familyId:request.familyId,familyVersion:request.expectedFamilyVersion,revisionId:request.revisionId,revisionVersion:request.expectedRevisionVersion,contentHash}));
     }
     const result=parseQuoteCommitted(value,request.businessId,request.operationId),r=result.receipt;
     check(result.recoveryEpoch===request.recoveryEpoch&&r.familyId===request.familyId&&r.revisionId===request.revisionId&&r.familyVersion===(BigInt(request.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(request.expectedRevisionVersion)+1n).toString()&&r.contentHash===contentHash);
     return new PrivateQuoteValue(result);
    },bounded));
    // No success value escapes until commandTransaction acknowledges COMMIT.
    if(outcome===null)throw new QuoteDirectoryError('QUOTE_SAVE_DENIED');return outcome;
   }catch(error){if(error instanceof QuoteDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new QuoteDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new QuoteDirectoryError(submitted?'QUOTE_SAVE_OUTCOME_UNKNOWN':'QUOTE_SAVE_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:{businessId:string;operationId:string},signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&quoteId(input.businessId)&&quoteId(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_quote_draft_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateQuoteValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseQuoteCommitted(value,request.businessId,request.operationId));
   });}catch{throw new QuoteDirectoryError('QUOTE_REQUEST_FAILED');}
  },
  async list(credential:string,input:{businessId:string;search:string;afterId:string|null;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','search','afterId','pageSize'])&&quoteId(input.businessId)&&typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||quoteId(input.afterId))&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=50);const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.read_quote_draft_directory($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::text,$10::uuid,$11::integer) AS result',[...args,request.search,request.afterId,request.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateQuoteValue(parseQuoteDirectoryPage(value,request));
   });}catch{throw new QuoteDirectoryError('QUOTE_REQUEST_FAILED');}
  },
  async history(credential:string,input:{businessId:string;familyId:string;revisionId:string;afterVersion:string;pageSize:number},signal:AbortSignal){
   try{check(exact(input,['businessId','familyId','revisionId','afterVersion','pageSize'])&&quoteId(input.businessId)&&quoteId(input.familyId)&&quoteId(input.revisionId)&&quoteVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=quoteHistoryPageLimit);const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.read_quote_draft_history($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::integer) AS result',[...args,request.familyId,request.revisionId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw new Error();return new PrivateQuoteValue(parseQuoteHistoryPage(value,request));
   });}catch{throw new QuoteDirectoryError('QUOTE_REQUEST_FAILED');}
  }
 });
}
