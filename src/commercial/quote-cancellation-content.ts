// BR05/06: explicit empty resulting scope, not a complimentary service, job
// cancellation, charge reduction or refund. Construction Draft creation and
// owner review use v3; editing, sharing and acceptance adoption is unfinished.
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseQuoteContentHeader,QuoteContentError} from './quote-content.ts';
import type {QuoteReviewContentInput} from './quote-review-content.ts';
import {quoteBodyLimit} from './quote-limits.ts';
export type QuoteCancellationContentInput=Omit<QuoteReviewContentInput,'schemaVersion'|'lines'|'documentDiscount'|'proposedSchedule'>&Readonly<{schemaVersion:3;purpose:'cancel_all_remaining_scope';cancellationReason:string;lines:readonly [];documentDiscount:null;proposedSchedule:null}>;
const keys=['schemaVersion','purpose','cancellationReason','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','internalNotes','documentDiscount','lines'] as const;
const fail=():never=>{throw new QuoteContentError('cancellation');};
function reason(value:unknown):value is string{return typeof value==='string'&&value.trim().length>0&&[...value].length<=2000&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
export function prepareQuoteCancellationContent(value:unknown){
 if(!exact(value,keys)||value.schemaVersion!==3||value.purpose!=='cancel_all_remaining_scope'||!reason(value.cancellationReason)||!Array.isArray(value.lines)||value.lines.length!==0||value.documentDiscount!==null||value.proposedSchedule!==null)return fail();
 const h=parseQuoteContentHeader({title:value.title,recipient:value.recipient,workLocation:value.workLocation,terms:value.terms,timezone:value.timezone,expiryAt:value.expiryAt,proposedSchedule:value.proposedSchedule,internalNotes:value.internalNotes});
 // An accepted agreement has a known customer; a lead alone cannot authorize
 // the cancellation of an agreement it has not actually acquired.
 if(h.recipient.customerId===null)return fail();
 const input=Object.freeze({...h,schemaVersion:3 as const,purpose:'cancel_all_remaining_scope' as const,cancellationReason:value.cancellationReason,documentDiscount:null,lines:Object.freeze([] as const),proposedSchedule:null});
 const customer=Object.freeze({schemaVersion:3 as const,currency:'USD' as const,title:h.title,recipient:Object.freeze({displayName:h.recipient.displayName,phone:h.recipient.phone,email:h.recipient.email}),workLocation:h.workLocation,terms:h.terms,timezone:h.timezone,expiryAt:h.expiryAt,proposedSchedule:null,lines:Object.freeze([] as const),documentDiscount:null,grossCents:'0',lineDiscountCents:'0',documentDiscountCents:'0',totalCents:'0',purpose:input.purpose,cancellationReason:input.cancellationReason});
 const internal=Object.freeze({customerId:h.recipient.customerId,leadId:h.recipient.leadId,notes:h.internalNotes,sources:Object.freeze([] as const),extremeReviewRequired:false});
 const canonical=JSON.stringify({schemaVersion:3,customer,internal});if(new TextEncoder().encode(JSON.stringify(input)).byteLength>quoteBodyLimit)return fail();
 return Object.freeze({input,customer,internal,canonical});
}
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));}
/** Rebuild every saved cancellation field. Unknown fields and totals are never
 * trusted, and a normal quote snapshot cannot enter through this boundary. */
export function quoteCancellationInputFromSnapshots(customer:unknown,internal:unknown):QuoteCancellationContentInput{
 if(!exact(customer,['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents','purpose','cancellationReason'])||!exact(customer.recipient,['displayName','phone','email'])||!exact(internal,['customerId','leadId','notes','sources','extremeReviewRequired']))return fail();
 const p=prepareQuoteCancellationContent({schemaVersion:customer.schemaVersion,purpose:customer.purpose,cancellationReason:customer.cancellationReason,title:customer.title,recipient:{customerId:internal.customerId,leadId:internal.leadId,...customer.recipient},workLocation:customer.workLocation,terms:customer.terms,timezone:customer.timezone,expiryAt:customer.expiryAt,proposedSchedule:customer.proposedSchedule,internalNotes:internal.notes,documentDiscount:customer.documentDiscount,lines:customer.lines});
 if(!same(p.customer,customer)||!same(p.internal,internal))return fail();return p.input;
}
