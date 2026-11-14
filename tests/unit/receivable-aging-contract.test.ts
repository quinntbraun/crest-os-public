import {describe,expect,it} from 'vitest';
import {parseReceivableAging} from '../../src/bookkeeping/receivable-aging-contract';

const uuid=(value:number)=>'00000000-0000-4000-8000-'+String(value).padStart(12,'0');
const businessId=uuid(1), throughOn='2026-11-13';
const day=86400000;
const date=(days:number)=>new Date(Date.parse(throughOn)-day*days).toISOString().slice(0,10);
const cases=[91,90,61,60,31,30,1,0,-1];
const rows=cases.map((days,index)=>({
  receivableId:uuid(index+10),invoiceId:uuid(index+20),invoiceNumber:'TEST-'+(index+1),
  customerId:uuid(2),customerName:'Fictional customer',issuedOn:'2026-01-01',dueOn:date(days),
  outstandingCents:'100',daysOverdue:Math.max(days,0),
}));
const report={
  schemaVersion:1,businessId,throughOn,observedAt:'2026-11-13T18:00:00.123456Z',timeZone:'America/Indiana/Indianapolis',
  currency:'USD',scope:'posted-invoices',itemCount:'9',totalCents:'900',rows,
  buckets:{current:'200',days1To30:'200',days31To60:'200',days61To90:'200',days91Plus:'100'},
};

describe('receivable aging',()=>{
  it('checks exact aging bucket boundaries and keeps future due dates current',()=>{
    expect(parseReceivableAging(report,businessId,throughOn)).toMatchObject({
      buckets:report.buckets,totalCents:'900',truncated:false,rows,
    });
    expect(()=>parseReceivableAging({...report,buckets:{...report.buckets,days1To30:'100',days31To60:'300'}},businessId,throughOn)).toThrow();
  });

  it('rejects a duplicate identity and an incorrect number of overdue days',()=>{
    for(const replacement of [{receivableId:rows[0]!.receivableId},{daysOverdue:89}]){
      const invalid=[rows[0],{...rows[1],...replacement},...rows.slice(2)];
      expect(()=>parseReceivableAging({...report,rows:invalid},businessId,throughOn)).toThrow();
    }
  });
});
