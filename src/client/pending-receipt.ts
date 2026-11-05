import {expenseId} from '../bookkeeping/expenses/expense-contract';
import {parseReceiptOriginal} from '../bookkeeping/expenses/receipt-contract';
import type {ReceiptOriginal} from '../bookkeeping/expenses/receipt-contract';

export const pendingReceiptKey='crest.receipt.pending-reference.v1';
export type PendingReceipt=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:ReceiptOriginal}>;
export class PendingReceiptError extends Error{constructor(){super('RECEIPT_REFERENCE_REVIEW_REQUIRED');this.name='PendingReceiptError';}}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new PendingReceiptError();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw new PendingReceiptError();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
/** Only original receipt identities/versions; never File, signed URLs or private metadata. */
export function pendingReceipt(value:unknown):PendingReceipt{
 try{
 const row=object(value,['schemaVersion','businessId','binding','reference']),reference=parseReceiptOriginal(row.reference);
 if(row.schemaVersion!==1||!expenseId(row.businessId)||typeof row.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(row.binding))throw new PendingReceiptError();
 return Object.freeze({...row,reference:Object.freeze(reference)}) as PendingReceipt;
 }catch{throw new PendingReceiptError();}
}
export function createPendingReceiptStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingReceipt|null{try{const raw=storage.getItem(pendingReceiptKey);if(raw===null)return null;if(raw.length>2048)throw Error();const parsed=pendingReceipt(JSON.parse(raw)),fields=10;if((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields)throw Error();return parsed;}catch{throw new PendingReceiptError();}}
 function require(value:PendingReceipt){try{if(JSON.stringify(read())!==JSON.stringify(pendingReceipt(value)))throw Error();}catch{throw new PendingReceiptError();}}
 return Object.freeze({read,require,
  write(value:PendingReceipt){try{const sealed=pendingReceipt(value);if(read()!==null)throw Error();storage.setItem(pendingReceiptKey,JSON.stringify(sealed));require(sealed);}catch{throw new PendingReceiptError();}},
  clear(value:PendingReceipt){try{require(value);storage.removeItem(pendingReceiptKey);if(read()!==null)throw Error();}catch{throw new PendingReceiptError();}}
 });
}
