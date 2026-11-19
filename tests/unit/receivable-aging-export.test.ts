import {describe,it,expect} from 'vitest';
import {parseReceivableAging} from '../../src/bookkeeping/receivable-aging-contract';
import {receivableAgingCsvRows} from '../../src/client/receivable-aging-export';

const uuid=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function report(count=1,cents='14900',totalCount=count){
 const total=(BigInt(cents)*BigInt(totalCount)).toString();
 return parseReceivableAging({schemaVersion:1,businessId:uuid(1),throughOn:'2026-11-19',observedAt:'2026-11-19T18:00:00.123456Z',timeZone:'America/Indiana/Indianapolis',currency:'USD',scope:'posted-invoices',itemCount:String(totalCount),totalCents:total,buckets:{current:'0',days1To30:total,days31To60:'0',days61To90:'0',days91Plus:'0'},rows:Array.from({length:count},(_,n)=>({receivableId:uuid(100+n),invoiceId:uuid(300+n),invoiceNumber:'TEST-'+(n+1),customerId:uuid(2),customerName:'Fictional customer',issuedOn:'2026-10-01',dueOn:'2026-11-01',outstandingCents:cents,daysOverdue:18}))},uuid(1),'2026-11-19');
}
describe('posted receivables CSV scope',()=>{
 it('retains checked date, zone, coverage, identities and exact cents',()=>{const source=report(),rows=receivableAgingCsvRows(source);expect(rows[1]).toEqual(['2026-11-19','America/Indiana/Indianapolis','USD',source.observedAt,'Posted invoices only; opening receivables and legacy balances excluded']);expect(rows[3]).toEqual(['14900','1','1','All outstanding posted invoices in this report']);expect(rows.at(-1)).toEqual([uuid(100),uuid(300),'TEST-1',uuid(2),'Fictional customer','2026-10-01','2026-11-01','18','14900']);});
 it('does not coerce large exact cents through Number',()=>{const amount='123456789012345678901234567890',rows=receivableAgingCsvRows(report(1,amount));expect(rows[3]?.[0]).toBe(amount);expect(rows.at(-1)?.at(-1)).toBe(amount);});
 it('distinguishes a bounded listed page from all-report totals',()=>{const source=report(100,'1',101),rows=receivableAgingCsvRows(source);expect(source.truncated).toBe(true);expect(rows[3]).toEqual(['101','101','100','First 100 by due date; totals include all outstanding posted invoices']);const heading=rows.findIndex(row=>row[0]==='Receivable ID');expect(rows.slice(heading+1)).toHaveLength(100);expect(rows.find(row=>row[0]==='1–30 days')).toEqual(['1–30 days','101']);});
});
