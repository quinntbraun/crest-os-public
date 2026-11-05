// Exact cancellation comparison; no command or eligibility authority.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {prepareVersionedQuoteContent,prepareQuoteAmendmentContent} from './quote-review-content.ts';
import {prepareQuoteCancellationContent} from './quote-cancellation-content.ts';
import {quoteId,quoteVersion,quoteResponseLimit} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
import {QuoteAmendmentComparisonError} from './quote-amendment-comparison.ts';
const parentKeys=['agreementId','versionNo','revisionId','contentHash','customerId','sourceLeadId','content'] as const;
const headerFields=['title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','documentDiscount'] as const;
async function fingerprint(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
/** Exact customer-safe proposal for a full withdrawal from a normal accepted
 * scope. Live assigned/completed/billed/custody bounds are NOT checked here.
 * The future transaction must refuse unresolved consumption, not erase it. */
export async function prepareQuoteCancellationComparison(value:unknown){
 const refuse=(code:QuoteAmendmentComparisonError['code']):never=>{throw new QuoteAmendmentComparisonError(code);};
 if(!exact(value,['schemaVersion','businessId','familyId','parent','proposedContent'])||value.schemaVersion!==1||!quoteId(value.businessId)||!quoteId(value.familyId)||!exact(value.parent,parentKeys))return refuse('input');
 const parent=Object.freeze({...value.parent}),businessId=value.businessId,familyId=value.familyId;
 if(!quoteId(parent.agreementId)||!quoteVersion(parent.versionNo)||!quoteVersion((BigInt(parent.versionNo)+1n).toString())||!quoteId(parent.revisionId)||!quoteId(parent.customerId)||!quoteReviewHash(parent.contentHash)||(parent.sourceLeadId!==null&&!quoteId(parent.sourceLeadId)))return refuse('parent');
 // Copy and seal both representations before the first asynchronous digest.
 let before:ReturnType<typeof prepareVersionedQuoteContent>|ReturnType<typeof prepareQuoteAmendmentContent>,after:ReturnType<typeof prepareQuoteCancellationContent>;
 try{before=parent.content&&typeof parent.content==='object'&&'schemaVersion'in parent.content&&parent.content.schemaVersion===3?prepareQuoteAmendmentContent(parent.content):prepareVersionedQuoteContent(parent.content);after=prepareQuoteCancellationContent(value.proposedContent);}catch{return refuse('input');}
 if(new TextEncoder().encode(before.canonical).byteLength>quoteResponseLimit)return refuse('budget');
 if(before.internal.leadId!==parent.sourceLeadId||(before.internal.customerId!==null?before.internal.customerId!==parent.customerId:before.internal.leadId===null)||after.internal.customerId!==parent.customerId||(after.internal.leadId!==null&&after.internal.leadId!==parent.sourceLeadId))return refuse('customer');
 if(await fingerprint(before.canonical)!==parent.contentHash)return refuse('parent');
 const lineChanges=Object.freeze(before.customer.lines.map((line,index)=>Object.freeze({kind:'removed' as const,beforePosition:index+1,afterPosition:null,before:line,after:null}))),sourceChanges=Object.freeze(before.internal.sources.map((source,index)=>Object.freeze({stableLineKey:source.stableLineKey,kind:'removed' as const,beforePosition:index+1,afterPosition:null,previousCents:before.customer.lines[index]!.finalCents,revisedCents:'0',signedDeltaCents:(-BigInt(before.customer.lines[index]!.finalCents)).toString()})));
 const delta=(-BigInt(before.customer.totalCents)).toString();if(sourceChanges.reduce((n,s)=>n+BigInt(s.signedDeltaCents),0n)!==BigInt(delta))return refuse('reconciliation');
 const headerChanges=Object.freeze([...headerFields.filter(k=>JSON.stringify(before.customer[k])!==JSON.stringify(after.customer[k])).map(field=>Object.freeze({field,before:before.customer[field],after:after.customer[field]})),...(before.customer.schemaVersion===3&&before.customer.cancellationReason!==after.customer.cancellationReason?[Object.freeze({field:'cancellationReason' as const,before:before.customer.cancellationReason,after:after.customer.cancellationReason})]:[])]);
 const customer=Object.freeze({schemaVersion:before.customer.schemaVersion===3?3 as const:2 as const,currency:'USD' as const,purpose:after.customer.purpose,cancellationReason:after.customer.cancellationReason,previousAgreementVersion:parent.versionNo,proposedAgreementVersion:(BigInt(parent.versionNo)+1n).toString(),previousTotalCents:before.customer.totalCents,revisedTotalCents:'0',signedDeltaCents:delta,headerChanges,lineChanges});
 const internal=Object.freeze({businessId,familyId,parentAgreementId:parent.agreementId,parentAgreementVersion:parent.versionNo,parentRevisionId:parent.revisionId,expectedAcceptedHash:parent.contentHash,customerId:parent.customerId,proposedContentHash:await fingerprint(after.canonical),lineChanges:sourceChanges});
 const result=Object.freeze({customer,internal,hasCustomerChanges:true});if(new TextEncoder().encode(JSON.stringify(result)).byteLength>quoteResponseLimit)return refuse('budget');return result;
}
