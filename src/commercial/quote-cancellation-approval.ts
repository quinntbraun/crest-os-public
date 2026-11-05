// Cancellation approval is a separately versioned customer representation.
// This binds saved data, not permission to approve or customer acceptance.
import {customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import type {StoredQuoteAmendmentRevision} from './quote-storage-contract.ts';
import {quoteReviewHash,QuoteReviewContractError} from './quote-review-contract.ts';
import {prepareQuoteCancellationContent,quoteCancellationInputFromSnapshots} from './quote-cancellation-content.ts';
export type QuoteCancellationApproval=Readonly<{id:string;contentVersion:string;contentHash:string;actorId:string;reviewedAt:string;extremeAcknowledged:boolean;templateVersion:'crest.quote.cancellation.v3';customerRepresentation:ReturnType<typeof prepareQuoteCancellationContent>['customer'];presentationText:string;presentationHash:string;operationId:string;auditEventId:string}>;
function check(v:unknown):asserts v{if(!v)throw new QuoteReviewContractError();}
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));}
export function parseQuoteCancellationApproval(value:unknown,revision:StoredQuoteAmendmentRevision):QuoteCancellationApproval{
 check(revision.kind==='amendment'&&revision.customer_safe_snapshot.schemaVersion===3&&quoteVersion(revision.content_version)&&quoteReviewHash(revision.content_hash));
 const content=prepareQuoteCancellationContent(quoteCancellationInputFromSnapshots(revision.customer_safe_snapshot,revision.internal_snapshot)),a=value;
 check(exact(a,['id','contentVersion','contentHash','actorId','reviewedAt','extremeAcknowledged','templateVersion','customerRepresentation','presentationText','presentationHash','operationId','auditEventId'])&&quoteId(a.id)&&a.contentVersion===revision.content_version&&a.contentHash===revision.content_hash&&quoteId(a.actorId)&&customerInstant(a.reviewedAt)&&typeof a.extremeAcknowledged==='boolean'&&a.templateVersion==='crest.quote.cancellation.v3'&&typeof a.presentationText==='string'&&quoteReviewHash(a.presentationHash)&&quoteId(a.operationId)&&quoteId(a.auditEventId)&&same(a.customerRepresentation,content.customer));
 const prefix='crest.quote.cancellation.v3\n'+revision.content_hash+'\n';check(a.presentationText.startsWith(prefix));const text=a.presentationText.slice(prefix.length);let embedded:unknown;try{embedded=JSON.parse(text);}catch{throw new QuoteReviewContractError();}const nodes:unknown[]=[embedded];let fields=0;while(nodes.length){const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields&&same(content.customer,embedded));
 return Object.freeze({...a,customerRepresentation:content.customer}) as QuoteCancellationApproval;
}
