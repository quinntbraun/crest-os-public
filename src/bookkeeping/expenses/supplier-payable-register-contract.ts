import {customerDate} from '../../customer/customer-contract.ts';
import {expenseCheck as check,expenseDate,expenseExact as exact,expenseId} from './expense-contract.ts';

const reportFields=['schemaVersion','scope','businessId','throughOn','openCount','rowCount','outstandingCents','ledgerPayableCents',
 'ledgerAgrees','sourceSha256','hasMore','rows'] as const;
export const supplierPayableRegisterColumns=['payableId','billId','vendor','incurredOn','dueOn','overdueDays','grossCents','paidCents','remainingCents'] as const;
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const cents=(value:unknown):value is string=>typeof value==='string'&&/^(0|-?[1-9][0-9]{0,23})$/.test(value);
const amount=(value:unknown):value is string=>cents(value)&&!value.startsWith('-');
const hasControl=(value:string)=>[...value].some(character=>{
 const code=character.charCodeAt(0);
 return code<32||code===127;
});

function parsePayable(value:unknown,throughOn:string){
 check(exact(value,supplierPayableRegisterColumns)&&expenseId(value.payableId)&&expenseId(value.billId)&&typeof value.vendor==='string'
  &&value.vendor.length>0&&[...value.vendor].length<=200&&value.vendor===value.vendor.trim()&&!hasControl(value.vendor)
  &&expenseDate(value.incurredOn)&&value.incurredOn<=throughOn&&customerDate(value.dueOn)&&count(value.overdueDays)
  &&amount(value.grossCents)&&value.grossCents!=='0'&&amount(value.paidCents)&&amount(value.remainingCents)
  &&BigInt(value.paidCents)+BigInt(value.remainingCents)===BigInt(value.grossCents));
 const overdueDays=value.remainingCents==='0'?0:Math.max(0,(Date.parse(throughOn)-Date.parse(value.dueOn))/86400000);
 check(value.overdueDays===overdueDays);
 return {payableId:value.payableId,billId:value.billId,vendor:value.vendor,incurredOn:value.incurredOn,dueOn:value.dueOn,
  overdueDays,grossCents:value.grossCents,paidCents:value.paidCents,remainingCents:value.remainingCents};
}

export function parseSupplierPayableRegister(value:unknown,businessId:string,requestedOn:string|null,afterPayable:string|null){
 check(expenseId(businessId)&&(afterPayable===null||expenseId(afterPayable))&&exact(value,reportFields)
  &&value.schemaVersion===1&&value.scope==='recorded_supplier_payables'&&value.businessId===businessId&&expenseDate(value.throughOn)&&(requestedOn===null||value.throughOn===requestedOn)
  &&count(value.openCount)&&count(value.rowCount)&&value.openCount<=value.rowCount&&amount(value.outstandingCents)
  &&cents(value.ledgerPayableCents)&&value.ledgerAgrees===(value.outstandingCents===value.ledgerPayableCents)
  &&typeof value.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.sourceSha256)&&typeof value.hasMore==='boolean'
  &&Array.isArray(value.rows)&&value.rows.length<=50&&value.rows.length<=value.rowCount&&(!value.hasMore||value.rows.length===50));
 const throughOn=value.throughOn;
 let cursor=afterPayable;
 const rows=value.rows.map((item:unknown)=>{
  const row=parsePayable(item,throughOn);
  check(cursor===null||cursor<row.payableId);
  cursor=row.payableId;
  return row;
 });
 const {scope,openCount,rowCount,outstandingCents,ledgerPayableCents,ledgerAgrees,sourceSha256,hasMore}=value;
 return {schemaVersion:1 as const,scope,businessId,throughOn,openCount,rowCount,outstandingCents,ledgerPayableCents,ledgerAgrees,sourceSha256,hasMore,rows};
}
