// BR05: bind a separately recorded customer confirmation to the exact sent
// amendment and its accepted parent. Parsing grants no command authority.
// The future transaction must recheck live parent, allocations and finance
// under the existing family locks; this module enables no route or posting.
import {quoteId,quoteVersion,quoteBodyLimit} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
import {parseQuoteConfirmationAccept} from './quote-commercial-contract.ts';
import type {QuoteConfirmationAccept} from './quote-commercial-contract.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';
import {parseQuoteAmendmentScopePlans} from './quote-amendment-scope-plan.ts';
import type {QuoteAmendmentScopePlan} from './quote-amendment-scope-plan.ts';

export type QuoteAmendmentAccept=QuoteConfirmationAccept&Readonly<{
 expectedParentAgreementId:string;expectedParentAgreementVersion:string;expectedParentAcceptedHash:string;
 scopePlans:readonly QuoteAmendmentScopePlan[];
 body:QuoteConfirmationAccept['body']&Readonly<{conversionId:null}>;
}>;
export type QuoteAmendmentAcceptReference=Readonly<{
 operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;
 expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;
 acceptanceId:string;agreementId:string;sendId:string;customerId:string;
 expectedParentAgreementId:string;expectedParentAgreementVersion:string;
}>;
const parentKeys=['expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash'] as const;
const requestKeys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','acceptanceId','agreementId','body','scopePlans',...parentKeys];
const referenceKeys=['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId','sendId','customerId','expectedParentAgreementId','expectedParentAgreementVersion'] as const;
const bodyKeys=['sendId','customerId','conversionId','channel','counterpartySnapshot','confirmationEffectiveAt','evidenceNote','confirmedExactTerms'];
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
function next(value:unknown):value is string{return quoteVersion(value)&&quoteVersion((BigInt(value)+1n).toString());}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);
 check(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
export function parseQuoteAmendmentAccept(value:unknown):QuoteAmendmentAccept{
 try{
  const row=record(value,requestKeys);
  check(quoteId(row.expectedParentAgreementId)&&next(row.expectedParentAgreementVersion)&&quoteReviewHash(row.expectedParentAcceptedHash));
  const body=record(row.body,bodyKeys),counterparty=record(body.counterpartySnapshot,['displayName','phone','email']);
  const {expectedParentAgreementId,expectedParentAgreementVersion,expectedParentAcceptedHash,scopePlans,...base}=row;
  const parsed=parseQuoteConfirmationAccept({...base,body:{...body,counterpartySnapshot:counterparty}});
  // A parent agreement already has a customer; acceptance cannot perform a
  // second lead conversion or reuse the immutable parent's agreement ID.
  check(parsed.body.conversionId===null&&parsed.agreementId!==expectedParentAgreementId&&next(parsed.expectedFamilyVersion)&&next(parsed.expectedRevisionVersion));
  const result=Object.freeze({...parsed,expectedParentAgreementId,expectedParentAgreementVersion,expectedParentAcceptedHash,scopePlans:parseQuoteAmendmentScopePlans(scopePlans),body:Object.freeze({...parsed.body,conversionId:null})});
  check(new TextEncoder().encode(JSON.stringify(result)).length<=quoteBodyLimit);
  return result;
 }catch{throw new QuoteAmendmentContractError();}
}
/** Opaque metadata only. Content, hashes, contact details, evidence and times
 * must never be persisted in interrupted-save storage through this reference. */
export function parseQuoteAmendmentAcceptReference(value:unknown):QuoteAmendmentAcceptReference{
 try{
  const row=record(value,referenceKeys);
  check(['operationId','recoveryEpoch','familyId','revisionId','acceptanceId','agreementId','sendId','customerId','expectedParentAgreementId'].every(key=>quoteId(row[key]))&&next(row.expectedFamilyVersion)&&next(row.expectedRevisionVersion)&&quoteVersion(row.expectedContentVersion)&&BigInt(row.expectedContentVersion)<=BigInt(row.expectedRevisionVersion)&&next(row.expectedParentAgreementVersion)&&row.agreementId!==row.expectedParentAgreementId);
  return Object.freeze(row) as QuoteAmendmentAcceptReference;
 }catch{throw new QuoteAmendmentContractError();}
}
export function quoteAmendmentAcceptReference(value:QuoteAmendmentAccept):QuoteAmendmentAcceptReference{
 const q=parseQuoteAmendmentAccept(value);
 return parseQuoteAmendmentAcceptReference({operationId:q.operationId,recoveryEpoch:q.recoveryEpoch,familyId:q.familyId,revisionId:q.revisionId,expectedFamilyVersion:q.expectedFamilyVersion,expectedRevisionVersion:q.expectedRevisionVersion,expectedContentVersion:q.expectedContentVersion,acceptanceId:q.acceptanceId,agreementId:q.agreementId,sendId:q.body.sendId,customerId:q.body.customerId,expectedParentAgreementId:q.expectedParentAgreementId,expectedParentAgreementVersion:q.expectedParentAgreementVersion});
}
