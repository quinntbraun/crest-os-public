import {expenseId,expenseRevision} from '../bookkeeping/expenses/expense-contract';

export const pendingExpenseKey='crest.expense.pending-reference.v1';
export type PendingExpense=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:Readonly<{operationId:string;recoveryEpoch:string;expenseId:string;expectedRevision:string}>}>;
export class PendingExpenseError extends Error{constructor(){super('EXPENSE_REFERENCE_REVIEW_REQUIRED');this.name='PendingExpenseError';}}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new PendingExpenseError();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw new PendingExpenseError();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
/** Only original identities and versions; never financial facts or credentials. */
export function pendingExpense(value:unknown):PendingExpense{
 const row=object(value,['schemaVersion','businessId','binding','reference']),reference=object(row.reference,['operationId','recoveryEpoch','expenseId','expectedRevision']);
 if(row.schemaVersion!==1||!expenseId(row.businessId)||typeof row.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(row.binding)||!expenseId(reference.operationId)||!expenseId(reference.recoveryEpoch)||!expenseId(reference.expenseId)||!expenseRevision(reference.expectedRevision,true))throw new PendingExpenseError();
 return Object.freeze({...row,reference:Object.freeze(reference)}) as PendingExpense;
}
export function createPendingExpenseStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingExpense|null{try{const raw=storage.getItem(pendingExpenseKey);if(raw===null)return null;if(raw.length>2048)throw Error();const parsed=pendingExpense(JSON.parse(raw)),fields=8;if((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields)throw Error();return parsed;}catch{throw new PendingExpenseError();}}
 function require(value:PendingExpense){try{if(JSON.stringify(read())!==JSON.stringify(pendingExpense(value)))throw Error();}catch{throw new PendingExpenseError();}}
 return Object.freeze({read,require,
  write(value:PendingExpense){try{const sealed=pendingExpense(value);if(read()!==null)throw Error();storage.setItem(pendingExpenseKey,JSON.stringify(sealed));require(sealed);}catch{throw new PendingExpenseError();}},
  clear(value:PendingExpense){try{require(value);storage.removeItem(pendingExpenseKey);if(read()!==null)throw Error();}catch{throw new PendingExpenseError();}}
 });
}
