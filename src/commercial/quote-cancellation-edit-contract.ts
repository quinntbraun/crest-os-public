// Explicit edit of an existing cancellation amendment. Ordinary quote input,
// initial receipts and amendment creation are never relabelled as this format.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion,parseQuoteCommitted} from './quote-storage-contract.ts';
import {prepareQuoteCancellationContent} from './quote-cancellation-content.ts';
import type {QuoteCancellationContentInput} from './quote-cancellation-content.ts';
export class QuoteCancellationEditError extends Error{constructor(){super('QUOTE_CANCELLATION_EDIT_INVALID');this.name='QuoteCancellationEditError';}}
function check(value:unknown):asserts value{if(!value)throw new QuoteCancellationEditError();}
type Identity=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string}>;
export type QuoteCancellationEdit=Identity&Readonly<{schemaVersion:2;businessId:string;content:QuoteCancellationContentInput}>;
type Receipt=Readonly<{schemaVersion:4;businessId:string;familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;familyAuditEventId:string;revisionAuditEventId:string;itemAuditEventIds:readonly [];assessmentAuditEventIds:readonly []}>;
export type QuoteCancellationEditCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:Receipt}>;
const keys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','content'],receiptKeys=['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds','assessmentAuditEventIds'];
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function identity(v:Identity){check(['operationId','recoveryEpoch','familyId','revisionId'].every(k=>quoteId(v[k as keyof Identity]))&&quoteVersion(v.expectedFamilyVersion)&&quoteVersion(v.expectedRevisionVersion)&&quoteVersion((BigInt(v.expectedFamilyVersion)+1n).toString())&&quoteVersion((BigInt(v.expectedRevisionVersion)+1n).toString()));}
export function parseQuoteCancellationEdit(v:unknown):QuoteCancellationEdit{
 try{check(exact(v,keys)&&v.schemaVersion===2&&quoteId(v.businessId));const r={operationId:v.operationId,recoveryEpoch:v.recoveryEpoch,familyId:v.familyId,revisionId:v.revisionId,expectedFamilyVersion:v.expectedFamilyVersion,expectedRevisionVersion:v.expectedRevisionVersion} as Identity;identity(r);const content=prepareQuoteCancellationContent(v.content).input;return Object.freeze({...r,schemaVersion:2,businessId:v.businessId,content});}catch{throw new QuoteCancellationEditError();}
}
export function parseQuoteCancellationEditCommitted(v:unknown,businessId:string,operationId:string):QuoteCancellationEditCommitted{
 try{
  check(quoteId(businessId)&&quoteId(operationId)&&exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operationId&&quoteId(v.recoveryEpoch)&&exact(v.receipt,receiptKeys));const r=v.receipt;
  check(r.schemaVersion===4&&r.businessId===businessId&&['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId'].every(k=>quoteId(r[k]))&&['familyVersion','revisionVersion','contentVersion'].every(k=>quoteVersion(r[k])&&BigInt(r[k] as string)>1n)&&hash(r.contentHash)&&r.familyAuditEventId!==r.revisionAuditEventId&&Array.isArray(r.itemAuditEventIds)&&r.itemAuditEventIds.length===0&&Array.isArray(r.assessmentAuditEventIds)&&r.assessmentAuditEventIds.length===0);
  return Object.freeze({state:'committed',operationId,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r,itemAuditEventIds:Object.freeze([] as const),assessmentAuditEventIds:Object.freeze([] as const)})}) as QuoteCancellationEditCommitted;
 }catch{throw new QuoteCancellationEditError();}
}
export function bindQuoteCancellationEditReceipt(v:unknown,businessId:string,reference:Identity,expectedHash?:string):QuoteCancellationEditCommitted{
 identity(reference);const result=parseQuoteCancellationEditCommitted(v,businessId,reference.operationId),r=result.receipt;check(result.recoveryEpoch===reference.recoveryEpoch&&r.familyId===reference.familyId&&r.revisionId===reference.revisionId&&r.familyVersion===(BigInt(reference.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(reference.expectedRevisionVersion)+1n).toString()&&(expectedHash===undefined||hash(expectedHash)&&r.contentHash===expectedHash));return result;
}
/** Independently verified originals may now include receipt4. This dispatcher
 * is for lookup only; ordinary new saves continue using their strict parser. */
export function parseQuoteDraftOperationResult(v:unknown,businessId:string,operationId:string){return exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.receipt&&typeof v.receipt==='object'&&'schemaVersion'in v.receipt&&v.receipt.schemaVersion===4?parseQuoteCancellationEditCommitted(v,businessId,operationId):parseQuoteCommitted(v,businessId,operationId);}
