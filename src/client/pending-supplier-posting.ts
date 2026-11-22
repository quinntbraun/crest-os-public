import {expenseId} from '../bookkeeping/expenses/expense-contract';
import {parseSupplierOperationReference} from '../bookkeeping/expenses/supplier-payable-posting-contract';
import type {SupplierOperationReference} from '../bookkeeping/expenses/supplier-payable-posting-contract';

export const pendingSupplierPostingKey='crest.supplier-posting.pending-reference.v1';
export type PendingSupplierPosting=Readonly<{schemaVersion:1;businessId:string;binding:string;scopeId:string;reference:SupplierOperationReference}>;
export class PendingSupplierPostingError extends Error{constructor(){super('SUPPLIER_POSTING_REFERENCE_REVIEW_REQUIRED');this.name='PendingSupplierPostingError';}}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new PendingSupplierPostingError();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw new PendingSupplierPostingError();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
/** Only original identities and versions; never financial facts or credentials. */
export function pendingSupplierPosting(value:unknown):PendingSupplierPosting{
 const row=object(value,['schemaVersion','businessId','binding','scopeId','reference']),reference=object(row.reference,['kind','operationId','recoveryEpoch','id']);
 if(row.schemaVersion!==1||!expenseId(row.businessId)||typeof row.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(row.binding)||!expenseId(row.scopeId))throw new PendingSupplierPostingError();
 const parsed=parseSupplierOperationReference(reference);
 return Object.freeze({...row,reference:Object.freeze(parsed)}) as PendingSupplierPosting;
}
export function createPendingSupplierPostingStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingSupplierPosting|null{try{const raw=storage.getItem(pendingSupplierPostingKey);if(raw===null)return null;if(raw.length>2048)throw Error();const parsed=pendingSupplierPosting(JSON.parse(raw)),fields=9;if((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields)throw Error();return parsed;}catch{throw new PendingSupplierPostingError();}}
 function require(value:PendingSupplierPosting){try{if(JSON.stringify(read())!==JSON.stringify(pendingSupplierPosting(value)))throw Error();}catch{throw new PendingSupplierPostingError();}}
 return Object.freeze({read,require,
  write(value:PendingSupplierPosting){try{const sealed=pendingSupplierPosting(value);if(read()!==null)throw Error();storage.setItem(pendingSupplierPostingKey,JSON.stringify(sealed));require(sealed);}catch{throw new PendingSupplierPostingError();}},
  clear(value:PendingSupplierPosting){try{require(value);storage.removeItem(pendingSupplierPostingKey);if(read()!==null)throw Error();}catch{throw new PendingSupplierPostingError();}}
 });
}
