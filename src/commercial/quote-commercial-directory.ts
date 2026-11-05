import 'server-only';
import {createHash} from 'node:crypto';
import {sessionDatabase} from '../security/session-database.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import {parseQuoteManualSend,parseQuoteConfirmationAccept,parseQuoteCommercialCommitted,requireQuoteCommercial as check} from './quote-commercial-contract.ts';
import type {QuoteManualSend,QuoteConfirmationAccept} from './quote-commercial-contract.ts';
import {parseQuoteCommercialRead} from './quote-commercial-read.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import type {createProviderBoundary} from '../security/provider-auth.ts';
import type {createProviderTokenStore} from '../security/provider-token-store.ts';

type Code='QUOTE_COMMERCIAL_REQUEST_FAILED'|'QUOTE_COMMERCIAL_NOT_SUBMITTED'|'QUOTE_COMMERCIAL_DENIED'|'QUOTE_COMMERCIAL_OUTCOME_UNKNOWN'|'RECOVERY_REVIEW_REQUIRED'|'QUOTE_COMMERCIAL_VALUE_PRIVATE';
export class QuoteCommercialDirectoryError extends Error{constructor(code:Code){super(code);this.name='QuoteCommercialDirectoryError';}}
class PrivateQuoteCommercialValue<T>{#value:T;constructor(value:T){this.#value=value;Object.freeze(this);}forServer(){return this.#value;}toJSON():never{throw new QuoteCommercialDirectoryError('QUOTE_COMMERCIAL_VALUE_PRIVATE');}}
const reasons=['operation','family','revision','state','accepted','approval','offer','send','expired','confirmation','conversion','identity'] as const;
export function createQuoteCommercialDirectory(config:SessionDatabaseConfiguration,provider:ReturnType<typeof createProviderBoundary>,tokens:Awaited<ReturnType<typeof createProviderTokenStore>>){
 const database=sessionDatabase(config),sessions=createSessionLifecycle(config,provider,tokens);
 async function authorized<T>(credential:string,businessId:string,signal:AbortSignal,work:(args:unknown[],bounded:AbortSignal)=>Promise<T>){
  check(quoteId(businessId));if(signal.aborted)throw Error();const bounded=AbortSignal.any([signal,AbortSignal.timeout(35000)]);let hash:Buffer|undefined;
  try{hash=sessionCredentialHash(credential);const verified=await sessions.verify(credential,bounded,'background');if(bounded.aborted)throw Error();return await work([hash,verified.sessionId,verified.actorId,verified.provider.issuer,verified.provider.subject,verified.provider.sessionId,new Date(verified.provider.expiresAt),businessId],bounded);}finally{hash?.fill(0);}
 }
 async function change(credential:string,input:QuoteManualSend|QuoteConfirmationAccept,action:'send'|'accept',signal:AbortSignal){
  let submitted=false;
  try{
   // Seal all facts before provider I/O. Sharing and customer confirmation are
   // separately recorded facts, never outbound provider actions or payment.
   const send=action==='send'?parseQuoteManualSend(input):null,accept=send===null?parseQuoteConfirmationAccept(input):null,request=send??accept!;
   const outcome=await authorized(credential,request.businessId,signal,(args,bounded)=>database.commandTransaction(async(query,currentSignal)=>{
    if(currentSignal.aborted)throw Error();submitted=true;
    const parameters=[...args,request.recoveryEpoch,request.operationId,1,request.familyId,request.revisionId,request.expectedFamilyVersion,request.expectedRevisionVersion,request.expectedContentVersion,request.expectedHash];
    const value=send?await query('SELECT crest_commands.confirm_quote_manual_send($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::bigint,$17::text,$18::uuid,$19::uuid,$20::jsonb) AS result',[...parameters,send.sendId,send.approvalId,send.body])
     :await query('SELECT crest_commands.accept_quote_confirmation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::uuid,$14::bigint,$15::bigint,$16::bigint,$17::text,$18::uuid,$19::uuid,$20::jsonb) AS result',[...parameters,accept!.acceptanceId,accept!.agreementId,accept!.body]);
    if(currentSignal.aborted)throw Error();
    if(exact(value,['state'])&&value.state==='denied')return null;
    if(exact(value,['state','reason'])&&value.state==='conflict'&&reasons.includes(value.reason as typeof reasons[number]))return new PrivateQuoteCommercialValue(Object.freeze({state:'conflict' as const,reason:value.reason as typeof reasons[number]}));
    if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion,true)&&quoteVersion(value.currentRevisionVersion,true))return new PrivateQuoteCommercialValue(Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:value.currentFamilyVersion,currentRevisionVersion:value.currentRevisionVersion}));
    const result=parseQuoteCommercialCommitted(value,request.businessId,request.operationId),r=result.receipt;
    check(result.recoveryEpoch===request.recoveryEpoch&&r.action===action&&r.familyId===request.familyId&&r.revisionId===request.revisionId&&r.familyVersion===(BigInt(request.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(request.expectedRevisionVersion)+1n).toString()&&r.contentVersion===request.expectedContentVersion&&r.contentHash===request.expectedHash);
    check(send?r.sendId===send.sendId&&r.approvalId===send.approvalId&&r.supersededRevisionId===send.body.replacesRevisionId:r.acceptanceId===accept!.acceptanceId&&r.agreementId===accept!.agreementId&&r.sendId===accept!.body.sendId&&r.customerId===accept!.body.customerId);
    return new PrivateQuoteCommercialValue(result);
   },bounded));
   // No receipt, conflict or denial is released before acknowledged COMMIT.
   if(outcome===null)throw new QuoteCommercialDirectoryError('QUOTE_COMMERCIAL_DENIED');return outcome;
  }catch(error){if(error instanceof QuoteCommercialDirectoryError)throw error;if(error instanceof Error&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new QuoteCommercialDirectoryError('RECOVERY_REVIEW_REQUIRED');throw new QuoteCommercialDirectoryError(submitted?'QUOTE_COMMERCIAL_OUTCOME_UNKNOWN':'QUOTE_COMMERCIAL_NOT_SUBMITTED');}
 }
 return Object.freeze({
  send:(credential:string,input:QuoteManualSend,signal:AbortSignal)=>change(credential,input,'send',signal),
  accept:(credential:string,input:QuoteConfirmationAccept,signal:AbortSignal)=>change(credential,input,'accept',signal),
  async lookup(credential:string,input:Readonly<{businessId:string;operationId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','operationId'])&&quoteId(input.businessId)&&quoteId(input.operationId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.lookup_quote_commercial_operation($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid) AS result',[...args,request.operationId],bounded);if(bounded.aborted)throw Error();return new PrivateQuoteCommercialValue(exact(value,['state'])&&value.state==='absent'?Object.freeze({state:'absent' as const}):parseQuoteCommercialCommitted(value,request.businessId,request.operationId));
   });}catch{throw new QuoteCommercialDirectoryError('QUOTE_COMMERCIAL_REQUEST_FAILED');}
  },
  async read(credential:string,input:Readonly<{businessId:string;familyId:string;revisionId:string}>,signal:AbortSignal){
   try{check(exact(input,['businessId','familyId','revisionId'])&&quoteId(input.businessId)&&quoteId(input.familyId)&&quoteId(input.revisionId));const request=Object.freeze({...input});return await authorized(credential,request.businessId,signal,async(args,bounded)=>{
    const value=await database('SELECT crest_commands.read_quote_commercial_state($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid) AS result',[...args,request.familyId,request.revisionId],bounded);if(bounded.aborted)throw Error();const result=parseQuoteCommercialRead(value,request);if('approval'in result&&result.approval)check(createHash('sha256').update(result.approval.presentationText,'utf8').digest('hex')===result.approval.presentationHash);return new PrivateQuoteCommercialValue(result);
   });}catch{throw new QuoteCommercialDirectoryError('QUOTE_COMMERCIAL_REQUEST_FAILED');}
  }
 });
}
