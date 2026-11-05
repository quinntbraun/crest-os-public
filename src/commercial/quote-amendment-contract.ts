// Data boundary only. Current parent, scope, membership and epoch are checked
// again by the trusted transaction; parsing grants no authority or acceptance.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,quoteAmendmentInputFromSnapshots,parseQuoteCommitted} from './quote-storage-contract.ts';
import type {QuoteCommitted,QuoteReceipt} from './quote-storage-contract.ts';
import {prepareQuoteAmendmentContent} from './quote-review-content.ts';
import type {QuoteAmendmentContentInput} from './quote-review-content.ts';
import {quoteReviewHash} from './quote-review-contract.ts';

export class QuoteAmendmentContractError extends Error{constructor(){super('QUOTE_AMENDMENT_DATA_INVALID');this.name='QuoteAmendmentContractError';}}
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
export type QuoteAmendmentDraft=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedParentAgreementId:string;expectedParentAgreementVersion:string;expectedParentAcceptedHash:string;content:QuoteAmendmentContentInput}>;
// Opaque recovery identities only. No accepted/proposed content, contact data,
// hashes, amount, review observation or authentication credential is persisted.
export type QuoteAmendmentDraftReference=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:'0';expectedParentAgreementId:string;expectedParentAgreementVersion:string}>;
type Receipt=Omit<Extract<QuoteReceipt,{schemaVersion:2}>,'schemaVersion'>&Readonly<{schemaVersion:3;parentAgreementId:string;parentAgreementVersion:string;parentAcceptedHash:string}>;
export type QuoteAmendmentDraftCommitted=Omit<QuoteCommitted,'receipt'>&Readonly<{receipt:Receipt}>;
const requestKeys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash','content'];
const referenceKeys=['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedParentAgreementId','expectedParentAgreementVersion'];
const receiptKeys=['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds','assessmentAuditEventIds','parentAgreementId','parentAgreementVersion','parentAcceptedHash'];
function nextVersion(value:unknown):value is string{return quoteVersion(value)&&quoteVersion((BigInt(value)+1n).toString());}
function reference(value:unknown):QuoteAmendmentDraftReference{
 check(exact(value,referenceKeys)&&['operationId','recoveryEpoch','familyId','revisionId','expectedParentAgreementId'].every(key=>quoteId(value[key]))&&nextVersion(value.expectedFamilyVersion)&&nextVersion(value.expectedParentAgreementVersion)&&value.expectedRevisionVersion==='0');return Object.freeze({...value}) as QuoteAmendmentDraftReference;
}
export function parseQuoteAmendmentDraft(value:unknown):QuoteAmendmentDraft{
 try{
  check(exact(value,requestKeys)&&value.schemaVersion===1&&quoteId(value.businessId)&&quoteReviewHash(value.expectedParentAcceptedHash));
  reference({operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,familyId:value.familyId,revisionId:value.revisionId,expectedFamilyVersion:value.expectedFamilyVersion,expectedRevisionVersion:'0',expectedParentAgreementId:value.expectedParentAgreementId,expectedParentAgreementVersion:value.expectedParentAgreementVersion});
  const prepared=prepareQuoteAmendmentContent(value.content),content=quoteAmendmentInputFromSnapshots(prepared.customer,prepared.internal);return Object.freeze({...value,content}) as QuoteAmendmentDraft;
 }catch{throw new QuoteAmendmentContractError();}
}
export function parseQuoteAmendmentDraftReference(value:unknown):QuoteAmendmentDraftReference{return reference(value);}
export function quoteAmendmentDraftReference(value:QuoteAmendmentDraft):QuoteAmendmentDraftReference{
 const r=parseQuoteAmendmentDraft(value);return reference({operationId:r.operationId,recoveryEpoch:r.recoveryEpoch,familyId:r.familyId,revisionId:r.revisionId,expectedFamilyVersion:r.expectedFamilyVersion,expectedRevisionVersion:'0',expectedParentAgreementId:r.expectedParentAgreementId,expectedParentAgreementVersion:r.expectedParentAgreementVersion});
}
/** A confirmed original creation is not a claim that the current Draft is still
 * version1. Reload its current private state before editing/reviewing it. On
 * recovery, the opaque reference binds IDs/versions; the SQL result verifier
 * independently binds the original hash. A still-live request also pins it here. */
export function bindQuoteAmendmentDraftReceipt(value:unknown,businessId:string,pending:QuoteAmendmentDraftReference,expectedParentAcceptedHash?:string):QuoteAmendmentDraftCommitted{
 try{
  const ref=reference(pending);check(exact(value,['state','operationId','recoveryEpoch','receipt'])&&exact(value.receipt,receiptKeys)&&value.receipt.schemaVersion===3&&quoteReviewHash(value.receipt.parentAcceptedHash));
  const {parentAgreementId,parentAgreementVersion,parentAcceptedHash}=value.receipt;
  const base=parseQuoteCommitted(value,businessId,ref.operationId,'amendment_creation');
  check(base.recoveryEpoch===ref.recoveryEpoch&&base.receipt.familyId===ref.familyId&&base.receipt.revisionId===ref.revisionId&&base.receipt.familyVersion===(BigInt(ref.expectedFamilyVersion)+1n).toString()&&base.receipt.revisionVersion==='1'&&base.receipt.contentVersion==='1'&&parentAgreementId===ref.expectedParentAgreementId&&parentAgreementVersion===ref.expectedParentAgreementVersion);
  if(expectedParentAcceptedHash!==undefined)check(quoteReviewHash(expectedParentAcceptedHash)&&parentAcceptedHash===expectedParentAcceptedHash);
  return Object.freeze({...base,receipt:Object.freeze({...base.receipt,schemaVersion:3 as const,parentAgreementId,parentAgreementVersion,parentAcceptedHash})}) as QuoteAmendmentDraftCommitted;
 }catch{throw new QuoteAmendmentContractError();}
}
export function parseQuoteAmendmentDraftConflict(value:unknown){
 if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','family','revision','state','assessment','parent'].includes(value.reason as string))return Object.freeze({...value}) as Readonly<{state:'conflict';reason:'operation'|'family'|'revision'|'state'|'assessment'|'parent'}>;
 if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion)&&value.currentRevisionVersion==='0')return Object.freeze({...value}) as Readonly<{state:'conflict';reason:'version';currentFamilyVersion:string;currentRevisionVersion:'0'}>;
 throw new QuoteAmendmentContractError();
}
