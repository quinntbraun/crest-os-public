import {describe,expect,it} from 'vitest';
import {parseCustomerFundsReport} from '../../src/bookkeeping/customer-funds-report-contract';

const business='10000000-0000-0000-0000-000000000001';
const date='2026-11-14';
const lot={lotId:'10000000-0000-0000-0000-000000000002',originId:'10000000-0000-0000-0000-000000000003',
  customerId:'10000000-0000-0000-0000-000000000004',customerName:'Fictional customer',heldOn:'2026-11-13',heldCents:'2500'};
const report={schemaVersion:1,businessId:business,throughOn:date,observedAt:'2026-11-14T10:00:00.000001Z',
  timeZone:'America/Indiana/Indianapolis',currency:'USD',lotCount:'1',totalCents:'2500',rows:[lot]};

describe('customer funds report',()=>{
  it('retains held cents and funding lineage',()=>{
    expect(parseCustomerFundsReport(report,business,date)).toMatchObject({totalCents:'2500',rows:[lot],truncated:false});
    expect(parseCustomerFundsReport({...report,lotCount:'0',totalCents:'0',rows:[]},business,null).rows).toEqual([]);
  });

  it('rejects invalid totals, date, tenant, repeated lot and future rows',()=>{
    expect(()=>parseCustomerFundsReport({...report,totalCents:'2499'},business,date)).toThrow();
    expect(()=>parseCustomerFundsReport(report,business,'2026-11-13')).toThrow();
    expect(()=>parseCustomerFundsReport(report,lot.customerId,date)).toThrow();
    expect(()=>parseCustomerFundsReport({...report,lotCount:'2',totalCents:'5000',rows:[lot,lot]},business,date)).toThrow();
    expect(()=>parseCustomerFundsReport({...report,rows:[{...lot,heldOn:'2026-11-15'}]},business,date)).toThrow();
  });

  it('requires a positive unlisted balance for each omitted lot',()=>{
    const rows=Array.from({length:100},(_,i)=>({...lot,heldCents:'1',lotId:'10000000-0000-0000-0000-'+String(i).padStart(12,'0')}));
    const page={...report,rows,lotCount:'102',totalCents:'102'};
    expect(parseCustomerFundsReport(page,business,date).truncated).toBe(true);
    expect(()=>parseCustomerFundsReport({...page,totalCents:'101'},business,date)).toThrow();
  });
});
