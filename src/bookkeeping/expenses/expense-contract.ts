// Owner-recorded cash expenses, not a tax ledger or bank reconciliation.
export const expenseCategories = ['supplies','equipment','vehicle','fuel','insurance','marketing','software','fees','rent','utilities','professional','other'] as const;
export type ExpenseCategory = typeof expenseCategories[number];
export type ExpensePayload = Readonly<{paidOn:string;amountCents:string;currency:'USD';category:ExpenseCategory;description:string;vendor:string|null;paymentMethod:'cash'|'card'|'bank'|'other';reference:string|null;notes:string|null;voided:boolean;changeReason:string|null}>;
export type ExpenseRevision = Readonly<{businessId:string;expenseId:string;revision:string;operationId:string;actorId:string;recordedAt:string;payload:ExpensePayload}>;
export type ExpenseSave=Readonly<{businessId:string;recoveryEpoch:string;operationId:string;expenseId:string;expectedRevision:string;payload:ExpensePayload}>;
export function parseExpenseSave(value:unknown):ExpenseSave{expenseCheck(expenseExact(value,['businessId','recoveryEpoch','operationId','expenseId','expectedRevision','payload'])&&expenseId(value.businessId)&&expenseId(value.recoveryEpoch)&&expenseId(value.operationId)&&expenseId(value.expenseId)&&expenseRevision(value.expectedRevision,true));const payload=parseExpensePayload(value.payload);expenseCheck(value.expectedRevision==='0'?!payload.voided&&payload.changeReason===null:payload.changeReason!==null);return Object.freeze({...value,payload}) as ExpenseSave;}
export class ExpenseError extends Error {constructor(){super('EXPENSE_REVIEW_REQUIRED');this.name='ExpenseError';}}
export function expenseCheck(value:unknown):asserts value {if(!value)throw new ExpenseError();}
export function expenseExact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
export function expenseId(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);}
export function expenseRevision(value:unknown,zero=false):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n&&(zero||value!=='0');}
export function expenseDate(value:unknown):value is string {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'9999-12-31')return false;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function text(value:unknown,limit:number,nullable=false):value is string|null{return nullable&&value===null||typeof value==='string'&&value.trim().length>0&&[...value].length<=limit&&![...value].some(c=>{const n=c.charCodeAt(0);return n<32&&![9,10,13].includes(n)||n===127;});}
export function parseExpensePayload(value:unknown):ExpensePayload {
 expenseCheck(expenseExact(value,['paidOn','amountCents','currency','category','description','vendor','paymentMethod','reference','notes','voided','changeReason']));
 expenseCheck(expenseDate(value.paidOn)&&typeof value.amountCents==='string'&&/^[1-9][0-9]{0,11}$/.test(value.amountCents)&&value.currency==='USD'&&expenseCategories.includes(value.category as ExpenseCategory)&&text(value.description,500)&&text(value.vendor,200,true)&&['cash','card','bank','other'].includes(value.paymentMethod as string)&&text(value.reference,200,true)&&text(value.notes,2000,true)&&typeof value.voided==='boolean'&&text(value.changeReason,500,true));
 return Object.freeze({...value}) as ExpensePayload;
}
export function parseExpenseRevision(value:unknown,businessId?:string):ExpenseRevision {
 expenseCheck(expenseExact(value,['businessId','expenseId','revision','operationId','actorId','recordedAt','payload'])&&expenseId(value.businessId)&&(!businessId||value.businessId===businessId)&&expenseId(value.expenseId)&&expenseRevision(value.revision)&&expenseId(value.operationId)&&expenseId(value.actorId)&&typeof value.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.recordedAt));
 const instant=new Date(value.recordedAt);expenseCheck(Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,19)===value.recordedAt.slice(0,19));
 const payload=parseExpensePayload(value.payload);expenseCheck(value.revision==='1'?!payload.voided&&payload.changeReason===null:payload.changeReason!==null);
 return Object.freeze({...value,payload}) as ExpenseRevision;
}
export function expenseCentsFromDollars(value:string){expenseCheck(/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(value));const [whole,fraction='']=value.split('.');const cents=(BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'))).toString();expenseCheck(cents!=='0'&&cents.length<=12);return cents;}
export function expenseDollars(cents:string){expenseCheck(/^(0|[1-9][0-9]*)$/.test(cents));return (BigInt(cents)/100n).toString()+'.'+(BigInt(cents)%100n).toString().padStart(2,'0');}
export function expenseHistory(input:unknown,businessId:string){
 expenseCheck(expenseId(businessId)&&Array.isArray(input)&&input.length<=10000);
 const rows=input.map(row=>parseExpenseRevision(row,businessId)).sort((a,b)=>a.expenseId.localeCompare(b.expenseId)||(BigInt(a.revision)<BigInt(b.revision)?-1:1));
 const latest=new Map<string,ExpenseRevision>(),operations=new Set<string>();
 for(const row of rows){const prior=latest.get(row.expenseId);expenseCheck(!operations.has(row.operationId)&&BigInt(row.revision)===BigInt(prior?.revision??'0')+1n&&(!prior||!prior.payload.voided));if(row.payload.voided)expenseCheck(prior&&Object.keys(row.payload).every(key=>key==='voided'||key==='changeReason'||row.payload[key as keyof ExpensePayload]===prior.payload[key as keyof ExpensePayload]));operations.add(row.operationId);latest.set(row.expenseId,row);}
 return Object.freeze({rows:Object.freeze(rows),latest:Object.freeze([...latest.values()])});
}
