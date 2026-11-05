// Forward commercial construction. No route, authority or financial posting.
import {customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import {parseQuoteReviewSubmit,quoteReviewHash} from './quote-review-contract.ts';
import type {QuoteReviewSubmit} from './quote-review-contract.ts';

export type QuoteConfirmationChannel='text'|'phone'|'email'|'in_person';
export type QuoteCounterparty=Readonly<{displayName:string;phone:string|null;email:string|null}>;
export type QuoteManualSendBody=Readonly<{channel:QuoteConfirmationChannel;recipientSnapshot:QuoteCounterparty;evidenceNote:string|null;confirmedActualSharing:true;presentationHash:string;replacesRevisionId:string|null}>;
export type QuoteAcceptanceBody=Readonly<{sendId:string;customerId:string;conversionId:string|null;channel:QuoteConfirmationChannel;counterpartySnapshot:QuoteCounterparty;confirmationEffectiveAt:string;evidenceNote:string;confirmedExactTerms:true}>;
export type QuoteManualSend=QuoteReviewSubmit&Readonly<{sendId:string;approvalId:string;body:QuoteManualSendBody}>;
export type QuoteConfirmationAccept=QuoteReviewSubmit&Readonly<{acceptanceId:string;agreementId:string;body:QuoteAcceptanceBody}>;
export class QuoteCommercialContractError extends Error{constructor(){super('QUOTE_COMMERCIAL_DATA_INVALID');this.name='QuoteCommercialContractError';}}
export function requireQuoteCommercial(value:unknown):asserts value{if(!value)throw new QuoteCommercialContractError();}
const check:(value:unknown)=>asserts value=requireQuoteCommercial;
const commonKeys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash'] as const;
const channels=['text','phone','email','in_person'] as const;
function text(value:unknown,limit:number,multiline=false):value is string{return typeof value==='string'&&value.trim().length>0&&[...value].length<=limit&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||multiline&&(n===9||n===10||n===13));});}
function contact(value:unknown):QuoteCounterparty{
 check(exact(value,['displayName','phone','email'])&&text(value.displayName,200)&&(value.phone===null||text(value.phone,512))&&(value.email===null||text(value.email,512)));
 return Object.freeze({displayName:value.displayName,phone:value.phone,email:value.email});
}
function common(value:Record<string,unknown>):QuoteReviewSubmit{
 try{return parseQuoteReviewSubmit(Object.fromEntries(commonKeys.map(key=>[key,value[key]])));}catch{throw new QuoteCommercialContractError();}
}
export function parseQuoteManualSend(value:unknown):QuoteManualSend{
 check(exact(value,[...commonKeys,'sendId','approvalId','body'])&&quoteId(value.sendId)&&quoteId(value.approvalId));const pinned=common(value),body=value.body;
 check(exact(body,['channel','recipientSnapshot','evidenceNote','confirmedActualSharing','presentationHash','replacesRevisionId'])&&channels.includes(body.channel as QuoteConfirmationChannel)&&(body.evidenceNote===null||text(body.evidenceNote,8000,true))&&body.confirmedActualSharing===true&&quoteReviewHash(body.presentationHash)&&(body.replacesRevisionId===null||quoteId(body.replacesRevisionId)&&body.replacesRevisionId!==pinned.revisionId));
 return Object.freeze({...pinned,sendId:value.sendId,approvalId:value.approvalId,body:Object.freeze({channel:body.channel as QuoteConfirmationChannel,recipientSnapshot:contact(body.recipientSnapshot),evidenceNote:body.evidenceNote,confirmedActualSharing:true,presentationHash:body.presentationHash,replacesRevisionId:body.replacesRevisionId})});
}
export function parseQuoteConfirmationAccept(value:unknown):QuoteConfirmationAccept{
 check(exact(value,[...commonKeys,'acceptanceId','agreementId','body'])&&quoteId(value.acceptanceId)&&quoteId(value.agreementId));const pinned=common(value),body=value.body;
 check(exact(body,['sendId','customerId','conversionId','channel','counterpartySnapshot','confirmationEffectiveAt','evidenceNote','confirmedExactTerms'])&&quoteId(body.sendId)&&quoteId(body.customerId)&&(body.conversionId===null||quoteId(body.conversionId))&&channels.includes(body.channel as QuoteConfirmationChannel)&&typeof body.confirmationEffectiveAt==='string'&&body.confirmationEffectiveAt.length===27&&customerInstant(body.confirmationEffectiveAt)&&text(body.evidenceNote,8000,true)&&body.confirmedExactTerms===true);
 return Object.freeze({...pinned,acceptanceId:value.acceptanceId,agreementId:value.agreementId,body:Object.freeze({sendId:body.sendId,customerId:body.customerId,conversionId:body.conversionId,channel:body.channel as QuoteConfirmationChannel,counterpartySnapshot:contact(body.counterpartySnapshot),confirmationEffectiveAt:body.confirmationEffectiveAt,evidenceNote:body.evidenceNote,confirmedExactTerms:true})});
}

export type QuoteCommercialReceipt=Readonly<{schemaVersion:1;action:'send'|'accept';businessId:string;familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;familyAuditEventId:string;revisionAuditEventId:string;commercialStateVersion:string;commercialStateAuditEventId:string;approvalId:string;sendId:string;sendAuditEventId:string;acceptanceId:string|null;acceptanceAuditEventId:string|null;agreementId:string|null;agreementAuditEventId:string|null;customerId:string|null;entitlementIds:readonly string[];entitlementVersionIds:readonly string[];allocationIds:readonly string[];entitlementAuditEventIds:readonly string[];entitlementVersionAuditEventIds:readonly string[];allocationAuditEventIds:readonly string[];leadId:string|null;leadVersion:string|null;leadEventId:string|null;leadAuditEventId:string|null;leadEventAuditEventId:string|null;supersededRevisionId:string|null;supersededRevisionVersion:string|null;supersededRevisionAuditEventId:string|null}>;
export type QuoteCommercialCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:QuoteCommercialReceipt}>;
const receiptKeys=['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','commercialStateVersion','commercialStateAuditEventId','approvalId','sendId','sendAuditEventId','acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId','entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds','leadId','leadVersion','leadEventId','leadAuditEventId','leadEventAuditEventId','supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'] as const;
const collections=['entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] as const;
export function parseQuoteCommercialCommitted(value:unknown,businessId:string,operationId:string):QuoteCommercialCommitted{
 check(quoteId(businessId)&&quoteId(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&quoteId(value.recoveryEpoch));const r=value.receipt;
 check(exact(r,receiptKeys)&&r.schemaVersion===1&&(r.action==='send'||r.action==='accept')&&r.businessId===businessId&&quoteId(r.familyId)&&quoteId(r.revisionId)&&quoteVersion(r.familyVersion)&&quoteVersion(r.revisionVersion)&&quoteVersion(r.contentVersion)&&BigInt(r.contentVersion)<=BigInt(r.revisionVersion)&&quoteReviewHash(r.contentHash)&&quoteVersion(r.commercialStateVersion)&&quoteId(r.familyAuditEventId)&&quoteId(r.revisionAuditEventId)&&quoteId(r.commercialStateAuditEventId)&&quoteId(r.approvalId)&&quoteId(r.sendId)&&quoteId(r.sendAuditEventId));
 for(const key of collections)check(Array.isArray(r[key])&&r[key].length<=1000&&r[key].every(quoteId)&&new Set(r[key]).size===r[key].length);
 const length=(r.entitlementIds as string[]).length;check(collections.every(key=>(r[key] as string[]).length===length));
 if(r.action==='send')check(length===0&&r.acceptanceId===null&&r.acceptanceAuditEventId===null&&r.agreementId===null&&r.agreementAuditEventId===null&&r.customerId===null);
 else check(length>0&&quoteId(r.acceptanceId)&&quoteId(r.acceptanceAuditEventId)&&quoteId(r.agreementId)&&quoteId(r.agreementAuditEventId)&&quoteId(r.customerId)&&r.supersededRevisionId===null);
 if(r.leadId===null)check(r.leadVersion===null&&r.leadEventId===null&&r.leadAuditEventId===null&&r.leadEventAuditEventId===null);
 else check(quoteId(r.leadId)&&quoteVersion(r.leadVersion)&&(r.leadEventId===null&&r.leadAuditEventId===null&&r.leadEventAuditEventId===null||quoteId(r.leadEventId)&&quoteId(r.leadAuditEventId)&&quoteId(r.leadEventAuditEventId)));
 if(r.supersededRevisionId===null)check(r.supersededRevisionVersion===null&&r.supersededRevisionAuditEventId===null);
 else check(r.action==='send'&&quoteId(r.supersededRevisionId)&&r.supersededRevisionId!==r.revisionId&&quoteVersion(r.supersededRevisionVersion)&&quoteId(r.supersededRevisionAuditEventId));
 const audits=[r.familyAuditEventId,r.revisionAuditEventId,r.commercialStateAuditEventId,r.sendAuditEventId,r.acceptanceAuditEventId,r.agreementAuditEventId,r.leadAuditEventId,r.leadEventAuditEventId,r.supersededRevisionAuditEventId,...r.entitlementAuditEventIds as string[],...r.entitlementVersionAuditEventIds as string[],...r.allocationAuditEventIds as string[]].filter(id=>id!==null);check(new Set(audits).size===audits.length);
 const receipt={...r};for(const key of collections)receipt[key]=Object.freeze([...(r[key] as string[])]);
 return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze(receipt) as QuoteCommercialReceipt});
}
