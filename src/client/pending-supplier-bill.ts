import {expenseId,expenseRevision} from '../bookkeeping/expenses/expense-contract';
import {parseSupplierBillDraftReference} from '../bookkeeping/expenses/supplier-bill-draft-contract';

export const pendingSupplierBillKey='crest.supplier-bill-draft.pending-reference.v1';
export type PendingSupplierBill=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:Readonly<{operationId:string;recoveryEpoch:string;billId:string;expectedRevision:string}>}>;
export class PendingSupplierBillError extends Error{constructor(){super('SUPPLIER_BILL_REFERENCE_REVIEW_REQUIRED');this.name='PendingSupplierBillError';}}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new PendingSupplierBillError();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw new PendingSupplierBillError();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
/** Only original identities and versions; never financial facts or credentials. */
export function pendingSupplierBill(value:unknown):PendingSupplierBill{
 const row=object(value,['schemaVersion','businessId','binding','reference']),reference=object(row.reference,['operationId','recoveryEpoch','billId','expectedRevision']);
 if(row.schemaVersion!==1||!expenseId(row.businessId)||typeof row.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(row.binding)||!expenseId(reference.operationId)||!expenseId(reference.recoveryEpoch)||!expenseId(reference.billId)||!expenseRevision(reference.expectedRevision,true))throw new PendingSupplierBillError();
 parseSupplierBillDraftReference(reference);
 return Object.freeze({...row,reference:Object.freeze(reference)}) as PendingSupplierBill;
}
export function createPendingSupplierBillStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingSupplierBill|null{try{const raw=storage.getItem(pendingSupplierBillKey);if(raw===null)return null;if(raw.length>2048)throw Error();const parsed=pendingSupplierBill(JSON.parse(raw)),fields=8;if((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields)throw Error();return parsed;}catch{throw new PendingSupplierBillError();}}
 function require(value:PendingSupplierBill){try{if(JSON.stringify(read())!==JSON.stringify(pendingSupplierBill(value)))throw Error();}catch{throw new PendingSupplierBillError();}}
 return Object.freeze({read,require,
  write(value:PendingSupplierBill){try{const sealed=pendingSupplierBill(value);if(read()!==null)throw Error();storage.setItem(pendingSupplierBillKey,JSON.stringify(sealed));require(sealed);}catch{throw new PendingSupplierBillError();}},
  clear(value:PendingSupplierBill){try{require(value);storage.removeItem(pendingSupplierBillKey);if(read()!==null)throw Error();}catch{throw new PendingSupplierBillError();}}
 });
}
