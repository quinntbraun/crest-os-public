import 'server-only';
import {createHash} from 'node:crypto';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import {parseQuoteReviewSubmit,parseQuoteReviewApprove,parseQuoteReviewCommitted,parseQuoteReviewRead,requireQuoteReview as check} from './quote-review-contract.ts';
import type {QuoteReviewSubmit,QuoteReviewApprove,QuoteReviewAction} from './quote-review-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='QUOTE_REVIEW_REQUEST_FAILED'|'QUOTE_REVIEW_NOT_SUBMITTED'|'QUOTE_REVIEW_DENIED'|'QUOTE_REVIEW_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'QUOTE_REVIEW_VALUE_PRIVATE';
export class QuoteReviewDirectoryError extends Error{constructor(code:Code){super(code);this.name='QuoteReviewDirectoryError';}}
class PrivateQuoteReviewValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new QuoteReviewDirectoryError('QUOTE_REVIEW_VALUE_PRIVATE');}}
export function createQuoteReviewDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(quoteId(businessId));if(signal.aborted)throw new Error();const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw new Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 async function change(credential:string,input:QuoteReviewSubmit|QuoteReviewApprove,action:QuoteReviewAction,signal:AbortSignal){
  let submitted=false;
  try{
   // Seal all expected identities and acknowledgment before provider/database I/O.
   const approval=action==='approve'?parseQuoteReviewApprove(input):null,request=approval??parseQuoteReviewSubmit(input);
   const outcome=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,currentSignal)=>{
    if(currentSignal.aborted)throw new Error();submitted=true;
    const parameters=[...args,request.recoveryEpoch,request.operationId,1,request.familyId,request.revisionId,request.expectedFamilyVersion,request.expectedRevisionVersion,request.expectedContentVersion,request.expectedHash];
    const value=approval?await query('SELECT crest_commands.approve_quote_revision($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::bigint,$17::text,$18::uuid,$19::boolean) AS result',[...parameters,approval.approvalId,approval.extremeAcknowledged])
     :await query('SELECT crest_commands.submit_quote_review($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::bigint,$17::text) AS result',parameters);
    if(currentSignal.aborted)throw new Error();
    if(exact(value,['state'])&&value.state==='denied')return null;
    if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','family','revision','state','approval','readiness','extreme'].includes(value.reason as string))return new PrivateQuoteReviewValue(Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'family'|'revision'|'state'|'approval'|'readiness'|'extreme'}));
    if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion,true)&&quoteVersion(value.currentRevisionVersion,true))return new PrivateQuoteReviewValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:value.currentFamilyVersion,currentRevisionVersion:value.currentRevisionVersion}));
    const result=parseQuoteReviewCommitted(value,request.businessId,request.operationId),r=result.receipt;
    check(result.recoveryEpoch===request.recoveryEpoch&&r.action===action&&r.familyId===request.familyId&&r.revisionId===request.revisionId&&r.familyVersion===(BigInt(request.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(request.expectedRevisionVersion)+1n).toString()&&r.contentVersion===request.expectedContentVersion&&r.contentHash===request.expectedHash&&(!approval||r.approvalId===approval.approvalId));return new PrivateQuoteReviewValue(result);
   },bounded));
   // Receipt/denial/conflict escapes only after COMMIT acknowledgment.
   if(outcome===null)throw new QuoteReviewDirectoryError('QUOTE_REVIEW_DENIED');return outcome;
  }catch(error){if(error instanceof QuoteReviewDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new QuoteReviewDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new QuoteReviewDirectoryError(submitted?'QUOTE_REVIEW_OUTCOME_UNKNOWN':'QUOTE_REVIEW_NOT_SUBMITTED');}
 }
 return Object.freeze({
  submit:(credential:string,input:QuoteReviewSubmit,signal:AbortSignal)=>change(credential,input,'submit',signal),
  approve:(credential:string,input:QuoteReviewApprove,signal:AbortSignal)=>change(credential,input,'approve',signal),
  async lookup(credential:string,input:Readonly<{businessId:string;operationId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&quoteId(input.businessId)&&quoteId(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_quote_review_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);if(bounded.aborted)throw new Error();return new PrivateQuoteReviewValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseQuoteReviewCommitted(value,request.businessId,request.operationId));
   });}catch{throw new QuoteReviewDirectoryError('QUOTE_REVIEW_REQUEST_FAILED');}
  },
  async read(credential:string,input:Readonly<{businessId:string;familyId:string;revisionId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','familyId','revisionId'])&&quoteId(input.businessId)&&quoteId(input.familyId)&&quoteId(input.revisionId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.read_quote_review_state($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid) AS result',[...args,request.familyId,request.revisionId],bounded);if(bounded.aborted)throw new Error();const result=parseQuoteReviewRead(value,request);if('approval'in result&&result.approval)check(createHash('sha256').update(result.approval.presentationText,'utf8').digest('hex')===result.approval.presentationHash);return new PrivateQuoteReviewValue(result);
   });}catch{throw new QuoteReviewDirectoryError('QUOTE_REVIEW_REQUEST_FAILED');}
  }
 });
}
