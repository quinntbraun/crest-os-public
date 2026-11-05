import {parseOriginalOperationReference} from '../security/original-operation-reference.ts';
import type {OriginalOperationReference} from '../security/original-operation-reference.ts';

export type QuoteAmendmentPendingKind='quote.amendment.create'|'quote.amendment.send'|'quote.amendment.accept';
export const pendingQuoteAmendmentKeys=Object.freeze({
 'quote.amendment.create':'crest.quote-amendment-draft.pending-reference.v1',
 'quote.amendment.send':'crest.quote-amendment-send.pending-reference.v1',
 'quote.amendment.accept':'crest.quote-amendment-accept.pending-reference.v1'
});
export type PendingQuoteAmendment<K extends QuoteAmendmentPendingKind>=Readonly<{
 schemaVersion:1;businessId:string;binding:string;
 reference:Extract<OriginalOperationReference,{commandType:K}>['reference'];
}>;
export class PendingQuoteAmendmentError extends Error{
 constructor(){super('QUOTE_AMENDMENT_REFERENCE_STORAGE_FAILED');this.name='PendingQuoteAmendmentError';}
}
export function pendingQuoteAmendment<K extends QuoteAmendmentPendingKind>(kind:K,value:unknown):PendingQuoteAmendment<K>{
 try{
  if(!Object.hasOwn(pendingQuoteAmendmentKeys,kind)||value===null||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw Error();
  const keys=['schemaVersion','businessId','binding','reference'],descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw Error();
  const row=Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
  if(row.schemaVersion!==1||typeof row.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(row.binding))throw Error();
  const original=parseOriginalOperationReference({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:row.reference});
  // The exact kind, descriptor-safe shape and domain identities were checked
  // above. Parsing retains the historical epoch; it cannot authorize a save.
  return Object.freeze({schemaVersion:1,businessId:original.businessId,binding:row.binding,reference:original.reference}) as PendingQuoteAmendment<K>;
 }catch{throw new PendingQuoteAmendmentError();}
}
/** Per-tab opaque original identities only. No draft body, contact, amount,
 * content hash, evidence, password or provider token is retained. A missing
 * lookup never permits clearing; the typed original or explicit retirement
 * must be verified by the existing save-review flow. */
export function createPendingQuoteAmendmentStore<K extends QuoteAmendmentPendingKind>(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,kind:K){
 if(!Object.hasOwn(pendingQuoteAmendmentKeys,kind))throw new PendingQuoteAmendmentError();
 const key=pendingQuoteAmendmentKeys[kind];
 function read():PendingQuoteAmendment<K>|null{
  try{const raw=storage.getItem(key);if(raw===null)return null;if(typeof raw!=='string'||raw.length>4096)throw Error();return pendingQuoteAmendment(kind,JSON.parse(raw));}catch{throw new PendingQuoteAmendmentError();}
 }
 function require(value:PendingQuoteAmendment<K>){
  try{const pinned=pendingQuoteAmendment(kind,value),current=read();if(current===null||JSON.stringify(current)!==JSON.stringify(pinned))throw Error();}catch{throw new PendingQuoteAmendmentError();}
 }
 return Object.freeze({read,require,
  write(value:PendingQuoteAmendment<K>){try{const pinned=pendingQuoteAmendment(kind,value);if(read()!==null)throw Error();storage.setItem(key,JSON.stringify(pinned));require(pinned);}catch{throw new PendingQuoteAmendmentError();}},
  clear(value:PendingQuoteAmendment<K>){try{require(value);storage.removeItem(key);if(read()!==null)throw Error();}catch{throw new PendingQuoteAmendmentError();}}
 });
}
