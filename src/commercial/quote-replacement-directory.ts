import 'server-only';
import {createHash} from 'node:crypto';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,parseQuoteCommitted,requireQuoteStorage as check} from './quote-storage-contract.ts';
import {prepareQuoteReviewContent} from './quote-review-content.ts';
import {parseQuoteReplacement,replacementReference,bindQuoteReplacementReceipt,parseQuoteReplacementConflict} from './quote-replacement-contract.ts';
import type {QuoteReplacement} from './quote-replacement-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';
type Code='QUOTE_REPLACEMENT_NOT_SUBMITTED'|'QUOTE_REPLACEMENT_DENIED'|'QUOTE_REPLACEMENT_OUTCOME_UNKNOWN'|'QUOTE_REPLACEMENT_REQUEST_FAILED'|'RECOVERY_REVIEW_REQUIRED'|'QUOTE_REPLACEMENT_VALUE_PRIVATE';
export class QuoteReplacementDirectoryError extends Error{constructor(code:Code){super(code);this.name='QuoteReplacementDirectoryError';}}
class PrivateReplacement<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new QuoteReplacementDirectoryError('QUOTE_REPLACEMENT_VALUE_PRIVATE');}}
export function createQuoteReplacementDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(quoteId(businessId));if(signal.aborted)throw Error();const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 return Object.freeze({
  async create(credential:string,input:QuoteReplacement,signal:AbortSignal){
   let submitted=false;try{
    const request=parseQuoteReplacement(input),p=prepareQuoteReviewContent(request.content),contentHash=createHash('sha256').update(p.canonical).digest('hex');
    const result=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,currentSignal)=>{
     if(currentSignal.aborted)throw Error();submitted=true;
     const value=await query('SELECT crest_commands.create_quote_replacement_draft($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,2,request.familyId,request.revisionId,request.expectedFamilyVersion,{customer:p.customer,internal:p.internal,canonical:p.canonical}]);
     if(currentSignal.aborted)throw Error();if(exact(value,['state'])&&value.state==='denied')return null;
     if(value&&typeof value==='object'&&'state'in value&&value.state==='conflict')return new PrivateReplacement(parseQuoteReplacementConflict(value));
     const committed=bindQuoteReplacementReceipt(value,request.businessId,replacementReference(request));check(committed.receipt.contentHash===contentHash&&committed.receipt.itemAuditEventIds.length===request.content.lines.length);return new PrivateReplacement(committed);
    },bounded));
    // Both success and definite refusal wait for transaction acknowledgment.
    if(result===null)throw new QuoteReplacementDirectoryError('QUOTE_REPLACEMENT_DENIED');return result;
   }catch(error){if(error instanceof QuoteReplacementDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new QuoteReplacementDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new QuoteReplacementDirectoryError(submitted?'QUOTE_REPLACEMENT_OUTCOME_UNKNOWN':'QUOTE_REPLACEMENT_NOT_SUBMITTED');}
  },
  async lookup(credential:string,input:Readonly<{businessId:string;operationId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&quoteId(input.businessId)&&quoteId(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_quote_draft_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);if(bounded.aborted)throw Error();return new PrivateReplacement(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseQuoteCommitted(value,request.businessId,request.operationId));});}catch{throw new QuoteReplacementDirectoryError('QUOTE_REPLACEMENT_REQUEST_FAILED');}
  }
 });
}
