import 'server-only';
import {parseQuoteAmendmentTargetsRequest,parseQuoteAmendmentTargets} from './quote-amendment-targets.ts';
import {createHash} from 'node:crypto';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId} from './quote-storage-contract.ts';
import {prepareQuoteReviewContent} from './quote-review-content.ts';
import {parseQuoteAmendmentDraft,quoteAmendmentDraftReference,parseQuoteAmendmentDraftReference,bindQuoteAmendmentDraftReceipt,parseQuoteAmendmentDraftConflict} from './quote-amendment-contract.ts';
import {parseQuoteAmendmentSend,quoteAmendmentSendReference,parseQuoteAmendmentSendReference,bindQuoteAmendmentSendReceipt,parseQuoteAmendmentSendConflict} from './quote-amendment-sharing-contract.ts';
import {parseQuoteAmendmentReadRequest,parseQuoteAmendmentRead} from './quote-amendment-read.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='QUOTE_AMENDMENT_NOT_SUBMITTED'|'QUOTE_AMENDMENT_DENIED'|'QUOTE_AMENDMENT_OUTCOME_UNKNOWN'|'QUOTE_AMENDMENT_REQUEST_FAILED'|'QUOTE_AMENDMENT_VALUE_PRIVATE'|'RECOVERY_REVIEW_REQUIRED';
export class QuoteAmendmentDirectoryError extends Error{constructor(code:Code){super(code);this.name='QuoteAmendmentDirectoryError';}}
class PrivateAmendment<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_VALUE_PRIVATE');}}
function check(value:unknown):asserts value{if(!value)throw Error();}
const absent=(value:unknown)=>exact(value,['state'])&&value.state==='absent';
const conflict=(value:unknown)=>value!==null&&typeof value==='object'&&'state'in value&&value.state==='conflict';
export function createQuoteAmendmentDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(quoteId(businessId));if(signal.aborted)throw Error();const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 function changeFailure(error:unknown,submitted:boolean):never{if(error instanceof QuoteAmendmentDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new QuoteAmendmentDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new QuoteAmendmentDirectoryError(submitted?'QUOTE_AMENDMENT_OUTCOME_UNKNOWN':'QUOTE_AMENDMENT_NOT_SUBMITTED');}
 return Object.freeze({
  async targets(credential:string,input:unknown,signal:AbortSignal){
   try{const request=parseQuoteAmendmentTargetsRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_quote_amendment_targets($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::text,$11::uuid,$12::integer) AS result',[...args,request.familyId,request.search,request.afterId,request.pageSize],bounded);if(bounded.aborted)throw Error();const parsed=await parseQuoteAmendmentTargets(value,request);if(bounded.aborted)throw Error();return new PrivateAmendment(parsed);});}catch{throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_REQUEST_FAILED');}
  },
  async create(credential:string,input:unknown,signal:AbortSignal){
   let submitted=false;try{
    const request=parseQuoteAmendmentDraft(input),pending=quoteAmendmentDraftReference(request),p=prepareQuoteReviewContent(request.content),contentHash=createHash('sha256').update(p.canonical).digest('hex');
    const result=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
     if(current.aborted)throw Error();submitted=true;
     const value=await query('SELECT crest_commands.create_quote_amendment_draft($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::uuid,$16::bigint,$17::text,$18::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,3,request.familyId,request.revisionId,request.expectedFamilyVersion,request.expectedParentAgreementId,request.expectedParentAgreementVersion,request.expectedParentAcceptedHash,{customer:p.customer,internal:p.internal,canonical:p.canonical}]);
     if(current.aborted)throw Error();if(exact(value,['state'])&&value.state==='denied')return null;if(conflict(value))return new PrivateAmendment(parseQuoteAmendmentDraftConflict(value));
     const committed=bindQuoteAmendmentDraftReceipt(value,request.businessId,pending,request.expectedParentAcceptedHash);check(committed.receipt.contentHash===contentHash&&committed.receipt.itemAuditEventIds.length===request.content.lines.length);return new PrivateAmendment(committed);
    },bounded));
    if(result===null)throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_DENIED');return result;
   }catch(error){return changeFailure(error,submitted);}
  },
  async send(credential:string,input:unknown,signal:AbortSignal){
   let submitted=false;try{
    const request=parseQuoteAmendmentSend(input),pending=quoteAmendmentSendReference(request);
    const result=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,current)=>{
     if(current.aborted)throw Error();submitted=true;
     const value=await query('SELECT crest_commands.confirm_quote_amendment_send($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::bigint,$17::text,$18::uuid,$19::uuid,$20::uuid,$21::bigint,$22::text,$23::jsonb) AS result',[...args,request.recoveryEpoch,request.operationId,1,request.familyId,request.revisionId,request.expectedFamilyVersion,request.expectedRevisionVersion,request.expectedContentVersion,request.expectedHash,request.sendId,request.approvalId,request.expectedParentAgreementId,request.expectedParentAgreementVersion,request.expectedParentAcceptedHash,request.body]);
     if(current.aborted)throw Error();if(exact(value,['state'])&&value.state==='denied')return null;if(conflict(value))return new PrivateAmendment(parseQuoteAmendmentSendConflict(value));return new PrivateAmendment(bindQuoteAmendmentSendReceipt(value,request.businessId,pending,{contentHash:request.expectedHash,presentationHash:request.body.presentationHash,parentAcceptedHash:request.expectedParentAcceptedHash}));
    },bounded));
    if(result===null)throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_DENIED');return result;
   }catch(error){return changeFailure(error,submitted);}
  },
  async lookupDraft(credential:string,input:unknown,signal:AbortSignal){
   try{check(exact(input,['businessId','reference'])&&quoteId(input.businessId));const businessId=input.businessId,reference=parseQuoteAmendmentDraftReference(input.reference);return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_quote_draft_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,reference.operationId],bounded);if(bounded.aborted)throw Error();return new PrivateAmendment(absent(value)?Object.freeze({state:'absent' as const}):bindQuoteAmendmentDraftReceipt(value,businessId,reference));});}catch{throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_REQUEST_FAILED');}
  },
  async lookupSend(credential:string,input:unknown,signal:AbortSignal){
   try{check(exact(input,['businessId','reference'])&&quoteId(input.businessId));const businessId=input.businessId,reference=parseQuoteAmendmentSendReference(input.reference);return await authorized(credential,businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.lookup_quote_amendment_send($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,reference.operationId],bounded);if(bounded.aborted)throw Error();return new PrivateAmendment(absent(value)?Object.freeze({state:'absent' as const}):bindQuoteAmendmentSendReceipt(value,businessId,reference));});}catch{throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_REQUEST_FAILED');}
  },
  async read(credential:string,input:unknown,signal:AbortSignal){
   try{const request=parseQuoteAmendmentReadRequest(input);return await authorized(credential,request.businessId,signal,async(args,bounded)=>{const value=await database('SELECT crest_commands.read_quote_amendment_workspace($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::bigint,$12::integer) AS result',[...args,request.familyId,request.revisionId,request.afterVersion,request.pageSize],bounded);if(bounded.aborted)throw Error();const parsed=await parseQuoteAmendmentRead(value,request);if(bounded.aborted)throw Error();return new PrivateAmendment(parsed);});}catch{throw new QuoteAmendmentDirectoryError('QUOTE_AMENDMENT_REQUEST_FAILED');}
  }
 });
}
