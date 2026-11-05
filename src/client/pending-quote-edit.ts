import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract';
export const pendingQuoteKey='crest.quote.pending-reference.v1';
export type QuoteReference=Readonly<{operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string}>;
export type PendingQuote=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:QuoteReference}>;
export class PendingQuoteError extends Error{constructor(){super('QUOTE_REFERENCE_STORAGE_FAILED');this.name='PendingQuoteError';}}
const identifier=(value:unknown):value is string=>customerUuid(value)&&value===value.trim();
export function quoteReference(value:unknown):QuoteReference{
 if(!exact(value,['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'])||Reflect.ownKeys(value).length!==6||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))throw new PendingQuoteError();
 if(!identifier(value.operationId)||!identifier(value.recoveryEpoch)||!identifier(value.familyId)||!identifier(value.revisionId)||!customerVersion(value.expectedFamilyVersion,true)||!customerVersion(value.expectedRevisionVersion,true)||(value.expectedFamilyVersion==='0')!==(value.expectedRevisionVersion==='0'))throw new PendingQuoteError();
 return Object.freeze({...value}) as QuoteReference;
}
export function pendingQuote(value:unknown):PendingQuote{
 try{
  if(!exact(value,['schemaVersion','businessId','binding','reference'])||Reflect.ownKeys(value).length!==4||Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,'value')||!d.enumerable)||value.schemaVersion!==1||!identifier(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding))throw Error();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:quoteReference(value.reference)});
 }catch{throw new PendingQuoteError();}
}
// Opaque original-operation metadata only. Never store quote content, hashes,
// contact details, amounts, credentials or a draft in browser persistence.
export function createPendingQuoteStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingQuote|null{try{const raw=storage.getItem(pendingQuoteKey);if(raw===null)return null;if(raw.length>1536)throw Error();return pendingQuote(JSON.parse(raw));}catch{throw new PendingQuoteError();}}
 const same=(a:PendingQuote|null,b:PendingQuote)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
 function require(value:PendingQuote){try{if(!same(read(),pendingQuote(value)))throw Error();}catch{throw new PendingQuoteError();}}
 return Object.freeze({read,require,
  write(value:PendingQuote){try{const pinned=pendingQuote(value);if(read()!==null)throw Error();storage.setItem(pendingQuoteKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingQuoteError();}},
  clear(value:PendingQuote){try{require(value);storage.removeItem(pendingQuoteKey);if(read()!==null)throw Error();}catch{throw new PendingQuoteError();}}
 });
}
