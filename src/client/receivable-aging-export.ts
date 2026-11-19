import {receivableAgingBuckets} from '../bookkeeping/receivable-aging-contract';
import type {parseReceivableAging} from '../bookkeeping/receivable-aging-contract';

type Report=ReturnType<typeof parseReceivableAging>;
const labels={current:'Current',days1To30:'1–30 days',days31To60:'31–60 days',days61To90:'61–90 days',days91Plus:'91+ days'};

export function receivableAgingCsvRows(report:Report):string[][]{
 return [
  ['As of','Time zone','Currency','Snapshot checked','Coverage'],
  [report.throughOn,report.timeZone,'USD',report.observedAt,'Posted invoices only; opening receivables and legacy balances excluded'],
  ['Total outstanding (cents)','Total invoices','Listed invoices','Detail coverage'],
  [report.totalCents,report.itemCount,String(report.rows.length),report.truncated?'First 100 by due date; totals include all outstanding posted invoices':'All outstanding posted invoices in this report'],
  [],['Age','Outstanding (cents)'],
  ...receivableAgingBuckets.map(key=>[labels[key],report.buckets[key]]),
  [],['Receivable ID','Invoice ID','Invoice','Customer ID','Customer','Issued','Due','Days overdue','Outstanding (cents)'],
  ...report.rows.map(row=>[row.receivableId,row.invoiceId,row.invoiceNumber,row.customerId,row.customerName,row.issuedOn,row.dueOn,String(row.daysOverdue),row.outstandingCents]),
 ];
}
