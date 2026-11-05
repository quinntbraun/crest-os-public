import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId} from '../commercial/quote-storage-contract';
import {parseQuoteReplacementReference} from '../commercial/quote-replacement-contract';
import type {QuoteReplacementReference} from '../commercial/quote-replacement-contract';
export const pendingQuoteReplacementKey='crest.quote-replacement.pending-reference.v1';
export type PendingQuoteReplacement=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:QuoteReplacementReference}>;
export class PendingQuoteReplacementError extends Error{constructor(){super('QUOTE_REPLACEMENT_REFERENCE_STORAGE_FAILED');this.name='PendingQuoteReplacementError';}}
function data(value:unknown,count:number){return !!value&&typeof value==='object'&&Reflect.ownKeys(value).length===count&&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')&&d.enumerable);}
export function pendingQuoteReplacement(value:unknown):PendingQuoteReplacement{
 try{
  if(!data(value,4)||!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!quoteId(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding)||!data(value.reference,6))throw Error();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:parseQuoteReplacementReference(value.reference)});
 }catch{throw new PendingQuoteReplacementError();}
}
/** Only opaque original-operation identities. No quote content, hashes,
 * amounts, observations, recipient information or credentials are persisted. */
export function createPendingQuoteReplacementStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingQuoteReplacement|null{try{const raw=storage.getItem(pendingQuoteReplacementKey);if(raw===null)return null;if(raw.length>2048)throw Error();return pendingQuoteReplacement(JSON.parse(raw));}catch{throw new PendingQuoteReplacementError();}}
 const same=(a:PendingQuoteReplacement|null,b:PendingQuoteReplacement)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
 function require(value:PendingQuoteReplacement){try{if(!same(read(),pendingQuoteReplacement(value)))throw Error();}catch{throw new PendingQuoteReplacementError();}}
 return Object.freeze({read,require,
  write(value:PendingQuoteReplacement){try{const pinned=pendingQuoteReplacement(value);if(read()!==null)throw Error();storage.setItem(pendingQuoteReplacementKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingQuoteReplacementError();}},
  clear(value:PendingQuoteReplacement){try{require(value);storage.removeItem(pendingQuoteReplacementKey);if(read()!==null)throw Error();}catch{throw new PendingQuoteReplacementError();}}
 });
}
