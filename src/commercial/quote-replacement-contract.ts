// Replacement preparation is a new Draft, never an accepted amendment or a send.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,quoteInputFromSnapshots,parseQuoteCommitted,requireQuoteStorage as check} from './quote-storage-contract.ts';
import {prepareQuoteReviewContent} from './quote-review-content.ts';
import type {QuoteReviewContentInput} from './quote-review-content.ts';
export type QuoteReplacement=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;content:QuoteReviewContentInput}>;
export type QuoteReplacementReference=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:'0'}>;
export function parseQuoteReplacement(value:unknown):QuoteReplacement{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','content'])&&value.schemaVersion===1&&quoteId(value.businessId)&&quoteId(value.operationId)&&quoteId(value.recoveryEpoch)&&quoteId(value.familyId)&&quoteId(value.revisionId)&&quoteVersion(value.expectedFamilyVersion));
 const p=prepareQuoteReviewContent(value.content),content=quoteInputFromSnapshots(p.customer,p.internal);check(content.schemaVersion===2);return Object.freeze({...value,content}) as QuoteReplacement;
}
export function parseQuoteReplacementReference(value:unknown):QuoteReplacementReference{
 check(exact(value,['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'])&&quoteId(value.operationId)&&quoteId(value.recoveryEpoch)&&quoteId(value.familyId)&&quoteId(value.revisionId)&&quoteVersion(value.expectedFamilyVersion)&&value.expectedRevisionVersion==='0');return Object.freeze({...value}) as QuoteReplacementReference;
}
export function replacementReference(input:QuoteReplacement):QuoteReplacementReference{
 const r=parseQuoteReplacement(input);return parseQuoteReplacementReference({operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,familyId:r.familyId,revisionId:r.revisionId,expectedFamilyVersion:r.expectedFamilyVersion,expectedRevisionVersion:'0'});
}
export function bindQuoteReplacementReceipt(value:unknown,businessId:string,reference:QuoteReplacementReference){
 const r=parseQuoteReplacementReference(reference),result=parseQuoteCommitted(value,businessId,r.operationId),receipt=result.receipt;
 check(result.recoveryEpoch===r.recoveryEpoch&&receipt.schemaVersion===2&&receipt.familyId===r.familyId&&receipt.revisionId===r.revisionId&&receipt.familyVersion===(BigInt(r.expectedFamilyVersion)+1n).toString()&&receipt.revisionVersion==='1'&&receipt.contentVersion==='1');return result;
}
export function parseQuoteReplacementConflict(value:unknown){
 if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','family','revision','state','assessment'].includes(value.reason as string))return Object.freeze({state:'conflict' as const,reason:value.reason as 'operation'|'family'|'revision'|'state'|'assessment'});
 if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion)&&value.currentRevisionVersion==='0')return Object.freeze({state:'conflict' as const,reason:'version' as const,currentFamilyVersion:value.currentFamilyVersion,currentRevisionVersion:'0' as const});
 throw Error('QUOTE_REPLACEMENT_DATA_INVALID');
}
