import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId} from '../commercial/quote-storage-contract';
import {parseQuoteReviewReference} from './quote-review';
import type {QuoteReviewReference} from './quote-review';
export const pendingQuoteReviewKey='crest.quote-review.pending-reference.v1';
export type PendingQuoteReview=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:QuoteReviewReference}>;
export class PendingQuoteReviewError extends Error{constructor(){super('QUOTE_REVIEW_REFERENCE_STORAGE_FAILED');this.name='PendingQuoteReviewError';}}
function data(value:unknown,count:number){return !!value&&typeof value==='object'&&Reflect.ownKeys(value).length===count&&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')&&d.enumerable);}
export function pendingQuoteReview(value:unknown):PendingQuoteReview{
 try{
  if(!data(value,4)||!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!quoteId(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding)||!data(value.reference,9))throw Error();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:parseQuoteReviewReference(value.reference)});
 }catch{throw new PendingQuoteReviewError();}
}
/** Only opaque original-operation identities. No quote content, hashes,
 * amounts, observations, recipient information or credentials are persisted. */
export function createPendingQuoteReviewStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingQuoteReview|null{try{const raw=storage.getItem(pendingQuoteReviewKey);if(raw===null)return null;if(raw.length>2048)throw Error();return pendingQuoteReview(JSON.parse(raw));}catch{throw new PendingQuoteReviewError();}}
 const same=(a:PendingQuoteReview|null,b:PendingQuoteReview)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
 function require(value:PendingQuoteReview){try{if(!same(read(),pendingQuoteReview(value)))throw Error();}catch{throw new PendingQuoteReviewError();}}
 return Object.freeze({read,require,
  write(value:PendingQuoteReview){try{const pinned=pendingQuoteReview(value);if(read()!==null)throw Error();storage.setItem(pendingQuoteReviewKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingQuoteReviewError();}},
  clear(value:PendingQuoteReview){try{require(value);storage.removeItem(pendingQuoteReviewKey);if(read()!==null)throw Error();}catch{throw new PendingQuoteReviewError();}}
 });
}
export function quoteReviewOriginalReference(reference:QuoteReviewReference){
 const {action,approvalId,...common}=parseQuoteReviewReference(reference);return Object.freeze({...common,...action==='approve'?{approvalId}:{}});
}
