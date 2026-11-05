// Exact amendment-sharing boundary. Parsing does not authorize a write or
// establish customer acceptance. The transaction verifies parent/hash/audits.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
import {parseQuoteManualSend} from './quote-commercial-contract.ts';
import type {QuoteManualSend} from './quote-commercial-contract.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';

export type QuoteAmendmentSend=QuoteManualSend&Readonly<{expectedParentAgreementId:string;expectedParentAgreementVersion:string;expectedParentAcceptedHash:string}>;
// Per-tab recovery may retain only these opaque IDs and versions. Hashes,
// recipient snapshots and sharing evidence remain in memory/authorized storage.
export type QuoteAmendmentSendReference=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;sendId:string;approvalId:string;expectedParentAgreementId:string;expectedParentAgreementVersion:string;replacesRevisionId:string|null}>;
export type QuoteAmendmentSendReceipt=Readonly<{schemaVersion:1;action:'amendment_send';businessId:string;familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;familyAuditEventId:string;revisionAuditEventId:string;commercialStateVersion:string;commercialStateAuditEventId:string;approvalId:string;presentationHash:string;sendId:string;sendAuditEventId:string;parentAgreementId:string;parentAgreementVersion:string;parentAcceptedHash:string;supersededRevisionId:string|null;supersededRevisionVersion:string|null;supersededRevisionAuditEventId:string|null}>;
export type QuoteAmendmentSendCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:QuoteAmendmentSendReceipt}>;
const parentKeys=['expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash'] as const;
const requestKeys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','sendId','approvalId','body',...parentKeys];
const referenceKeys=['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId','expectedParentAgreementId','expectedParentAgreementVersion','replacesRevisionId'];
const receiptKeys=['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','commercialStateVersion','commercialStateAuditEventId','approvalId','presentationHash','sendId','sendAuditEventId','parentAgreementId','parentAgreementVersion','parentAcceptedHash','supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'];
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
function next(value:unknown):value is string{return quoteVersion(value)&&quoteVersion((BigInt(value)+1n).toString());}
export function parseQuoteAmendmentSendReference(value:unknown):QuoteAmendmentSendReference{
 check(exact(value,referenceKeys)&&['operationId','recoveryEpoch','familyId','revisionId','sendId','approvalId','expectedParentAgreementId'].every(key=>quoteId(value[key]))&&next(value.expectedFamilyVersion)&&next(value.expectedRevisionVersion)&&quoteVersion(value.expectedContentVersion)&&BigInt(value.expectedContentVersion)<=BigInt(value.expectedRevisionVersion)&&quoteVersion(value.expectedParentAgreementVersion)&&(value.replacesRevisionId===null||quoteId(value.replacesRevisionId)&&value.replacesRevisionId!==value.revisionId));return Object.freeze({...value}) as QuoteAmendmentSendReference;
}
export function parseQuoteAmendmentSend(value:unknown):QuoteAmendmentSend{
 try{
  check(exact(value,requestKeys)&&quoteId(value.expectedParentAgreementId)&&quoteVersion(value.expectedParentAgreementVersion)&&quoteReviewHash(value.expectedParentAcceptedHash));
  const {expectedParentAgreementId,expectedParentAgreementVersion,expectedParentAcceptedHash,...base}=value,parsed=parseQuoteManualSend(base);
  check(next(parsed.expectedFamilyVersion)&&next(parsed.expectedRevisionVersion));return Object.freeze({...parsed,expectedParentAgreementId,expectedParentAgreementVersion,expectedParentAcceptedHash});
 }catch{throw new QuoteAmendmentContractError();}
}
export function quoteAmendmentSendReference(value:QuoteAmendmentSend):QuoteAmendmentSendReference{
 const q=parseQuoteAmendmentSend(value);return parseQuoteAmendmentSendReference({operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,familyId:q.familyId,revisionId:q.revisionId,expectedFamilyVersion:q.expectedFamilyVersion,expectedRevisionVersion:q.expectedRevisionVersion,expectedContentVersion:q.expectedContentVersion,sendId:q.sendId,approvalId:q.approvalId,expectedParentAgreementId:q.expectedParentAgreementId,expectedParentAgreementVersion:q.expectedParentAgreementVersion,replacesRevisionId:q.body.replacesRevisionId});
}
/** Original sharing confirmation is historical. Reload current private state
 * before further actions; it may have been superseded since this operation. */
export function bindQuoteAmendmentSendReceipt(value:unknown,businessId:string,pending:QuoteAmendmentSendReference,liveHashes?:Readonly<{contentHash:string;presentationHash:string;parentAcceptedHash:string}>):QuoteAmendmentSendCommitted{
 try{
  const p=parseQuoteAmendmentSendReference(pending);check(quoteId(businessId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===p.operationId&&value.recoveryEpoch===p.recoveryEpoch&&exact(value.receipt,receiptKeys));const r=value.receipt;
  check(r.schemaVersion===1&&r.action==='amendment_send'&&r.businessId===businessId&&r.familyId===p.familyId&&r.revisionId===p.revisionId&&r.familyVersion===(BigInt(p.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(p.expectedRevisionVersion)+1n).toString()&&r.contentVersion===p.expectedContentVersion&&quoteVersion(r.commercialStateVersion)&&r.approvalId===p.approvalId&&r.sendId===p.sendId&&r.parentAgreementId===p.expectedParentAgreementId&&r.parentAgreementVersion===p.expectedParentAgreementVersion&&['contentHash','presentationHash','parentAcceptedHash'].every(key=>quoteReviewHash(r[key])));
  const audits=[r.familyAuditEventId,r.revisionAuditEventId,r.commercialStateAuditEventId,r.sendAuditEventId];
  if(p.replacesRevisionId===null)check(r.supersededRevisionId===null&&r.supersededRevisionVersion===null&&r.supersededRevisionAuditEventId===null);
  else{check(r.supersededRevisionId===p.replacesRevisionId&&quoteVersion(r.supersededRevisionVersion)&&quoteId(r.supersededRevisionAuditEventId));audits.push(r.supersededRevisionAuditEventId);}
  check(audits.every(quoteId)&&new Set(audits).size===audits.length);
  if(liveHashes!==undefined)check(exact(liveHashes,['contentHash','presentationHash','parentAcceptedHash'])&&(['contentHash','presentationHash','parentAcceptedHash'] as const).every(key=>quoteReviewHash(liveHashes[key])&&r[key]===liveHashes[key]));
  return Object.freeze({state:'committed',operationId:p.operationId,recoveryEpoch:p.recoveryEpoch,receipt:Object.freeze({...r}) as QuoteAmendmentSendReceipt});
 }catch{throw new QuoteAmendmentContractError();}
}
export function parseQuoteAmendmentSendConflict(value:unknown){
 if(exact(value,['state','reason'])&&value.state==='conflict'&&['operation','family','revision','state','parent','offer','approval','send'].includes(value.reason as string))return Object.freeze({...value}) as Readonly<{state:'conflict';reason:'operation'|'family'|'revision'|'state'|'parent'|'offer'|'approval'|'send'}>;
 if(exact(value,['state','reason','currentFamilyVersion','currentRevisionVersion'])&&value.state==='conflict'&&value.reason==='version'&&quoteVersion(value.currentFamilyVersion)&&quoteVersion(value.currentRevisionVersion))return Object.freeze({...value}) as Readonly<{state:'conflict';reason:'version';currentFamilyVersion:string;currentRevisionVersion:string}>;
 throw new QuoteAmendmentContractError();
}
