import {exactCustomerObject as exact} from '../customer/customer-contract';
import {quoteId} from '../commercial/quote-storage-contract';
import {parseQuoteCommercialReference} from './quote-commercial';
import type {QuoteCommercialReference} from './quote-commercial';
export const pendingQuoteCommercialKey='crest.quote-commercial.pending-reference.v1';
export type PendingQuoteCommercial=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:QuoteCommercialReference}>;
export class PendingQuoteCommercialError extends Error{constructor(){super('QUOTE_COMMERCIAL_REFERENCE_STORAGE_FAILED');this.name='PendingQuoteCommercialError';}}
function data(value:unknown,count:number){return !!value&&typeof value==='object'&&Reflect.ownKeys(value).length===count&&Object.values(Object.getOwnPropertyDescriptors(value)).every(d=>Object.hasOwn(d,'value')&&d.enumerable);}
export function pendingQuoteCommercial(value:unknown):PendingQuoteCommercial{
 try{
  if(!data(value,4)||!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!quoteId(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding)||!data(value.reference,10))throw Error();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:parseQuoteCommercialReference(value.reference)});
 }catch{throw new PendingQuoteCommercialError();}
}
/** Only opaque original-operation identities. No quote content, hashes,
 * amounts, observations, recipient information or credentials are persisted. */
export function createPendingQuoteCommercialStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingQuoteCommercial|null{try{const raw=storage.getItem(pendingQuoteCommercialKey);if(raw===null)return null;if(raw.length>2048)throw Error();return pendingQuoteCommercial(JSON.parse(raw));}catch{throw new PendingQuoteCommercialError();}}
 const same=(a:PendingQuoteCommercial|null,b:PendingQuoteCommercial)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
 function require(value:PendingQuoteCommercial){try{if(!same(read(),pendingQuoteCommercial(value)))throw Error();}catch{throw new PendingQuoteCommercialError();}}
 return Object.freeze({read,require,
  write(value:PendingQuoteCommercial){try{const pinned=pendingQuoteCommercial(value);if(read()!==null)throw Error();storage.setItem(pendingQuoteCommercialKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingQuoteCommercialError();}},
  clear(value:PendingQuoteCommercial){try{require(value);storage.removeItem(pendingQuoteCommercialKey);if(read()!==null)throw Error();}catch{throw new PendingQuoteCommercialError();}}
 });
}

export function quoteCommercialOriginalReference(reference:QuoteCommercialReference){
 const {action,...original}=parseQuoteCommercialReference(reference);void action;return Object.freeze(original);
}
