import {invoiceSourceCoverage} from './invoice-source.ts';
import {receiptSourceAddedColumns,receiptSourceCoverage} from './receipt-source.ts';
import {postedExpenseSourceAddedColumns,postedExpenseSourceCoverage} from './posted-expense-source.ts';
import {unapplicationSourceAddedColumns,unapplicationSourceCoverage} from './unapplication-source.ts';
import {fundApplicationSourceAddedColumns,fundApplicationSourceCoverage} from './fund-application-source.ts';
import {heldTipSourceAddedColumns,heldTipSourceCoverage} from './held-tip-source.ts';
import {invoiceCreditSourceAddedColumns,invoiceCreditSourceCoverage} from './invoice-credit-source.ts';

const receiptColumns:Readonly<Record<string,readonly string[]>>=receiptSourceAddedColumns;
const expenseColumns:Readonly<Record<string,readonly string[]>>=postedExpenseSourceAddedColumns;
export const correctionSourceColumns:Readonly<Record<string,readonly string[]>>=unapplicationSourceAddedColumns;
export const fundApplicationSourceColumns:Readonly<Record<string,readonly string[]>>=fundApplicationSourceAddedColumns;
export const heldTipSourceColumns:Readonly<Record<string,readonly string[]>>=heldTipSourceAddedColumns;
export const invoiceCreditSourceColumns:Readonly<Record<string,readonly string[]>>=invoiceCreditSourceAddedColumns;
const originalTables=[...invoiceSourceCoverage,...receiptSourceCoverage,postedExpenseSourceCoverage].map(table=>({
  name:table.table.slice('crest.'.length),
  columns:[...table.required,...(receiptColumns[table.table]??[]),...(expenseColumns[table.table]??[])],
}));

export function financeSourceTables(version:1|2|3|4|5){
  if(version===1)return originalTables;
  const correctionTables=[
    ...originalTables.map(table=>({...table,columns:[...table.columns,...(correctionSourceColumns['crest.'+table.name]??[])]})),
    ...unapplicationSourceCoverage.map(table=>({name:table.table.slice('crest.'.length),columns:[...table.required]})),
  ];
  if(version===2)return correctionTables;
  const applicationTables=[
    ...correctionTables.map(table=>({...table,columns:[...table.columns,...(fundApplicationSourceColumns['crest.'+table.name]??[])]})),
    ...fundApplicationSourceCoverage.map(table=>({name:table.table.slice('crest.'.length),columns:[...table.required]})),
  ];
  if(version===3)return applicationTables;
  const tipTables=[
    ...applicationTables.map(table=>({...table,columns:[...table.columns,...(heldTipSourceColumns['crest.'+table.name]??[])]})),
    ...heldTipSourceCoverage.map(table=>({name:table.table.slice('crest.'.length),columns:[...table.required]})),
  ];
  return version===4?tipTables:[
    ...tipTables.map(table=>({...table,columns:[...table.columns,...(invoiceCreditSourceColumns['crest.'+table.name]??[])]})),
    ...invoiceCreditSourceCoverage.map(table=>({name:table.table.slice('crest.'.length),columns:[...table.required]})),
  ];
}
