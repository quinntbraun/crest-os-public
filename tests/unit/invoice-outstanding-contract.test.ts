import {describe,expect,it} from 'vitest';
import {parseInvoiceOutstanding} from '../../src/bookkeeping/invoice-outstanding-contract';

const business='00000000-0000-4000-8000-000000000001',customer='00000000-0000-4000-8000-000000000002',invoice='00000000-0000-4000-8000-000000000003';
const read=(value:unknown)=>parseInvoiceOutstanding(value,business,customer,invoice);
const snapshot={state:'ready',schemaVersion:1,businessId:business,customerId:customer,invoiceId:invoice,
 invoiceNumber:'CREST-1',currency:'USD',issuedOn:'2026-11-18',dueOn:'2026-11-25',throughOn:'2026-11-19',
 observedAt:'2026-11-19T15:00:00.123456Z',timeZone:'America/Indiana/Indianapolis',originalCents:'10000',outstandingCents:'7500'};
describe('invoice-scoped outstanding snapshots',()=>{
 it.each(['10000','7500','0','9223372036854775807'])('preserves exact checked balance %s without Number coercion',cents=>{
  const originalCents=cents==='9223372036854775807'?cents:'10000',result=read({...snapshot,originalCents,outstandingCents:cents});
  expect(result).toEqual({...snapshot,originalCents,outstandingCents:cents});
 });
 it('keeps absent and not-yet-effective invoices distinct from a verified zero',()=>{
  expect(read({state:'absent'})).toEqual({state:'absent'});
  const future:Record<string,unknown>={...snapshot,state:'not_effective',issuedOn:'2026-11-20'};delete future.outstandingCents;
  expect(read(future)).toEqual(future);expect(read(future)).not.toHaveProperty('outstandingCents');
  expect(()=>read({...future,outstandingCents:'0'})).toThrow();expect(()=>read({...future,issuedOn:'2026-11-18'})).toThrow();
 });
 it.each([
  ['businessId',customer],['customerId',invoice],['invoiceId',business],['currency','EUR'],['schemaVersion',2],
  ['invoiceNumber','CREST'],['issuedOn','2026-11-20'],['dueOn','2026-11-17'],['throughOn','2026-02-30'],
  ['observedAt','not-a-time'],['originalCents','9223372036854775808'],['outstandingCents','10001'],
  ['outstandingCents','-1'],['outstandingCents','01'],['outstandingCents',0],['timeZone','PRIVATE\nZONE'],['state','paid'],
 ])('refuses inconsistent %s', (field,value)=>expect(()=>read({...snapshot,[field]:value})).toThrow());
 it('rejects extra or missing fields and never decorates an unavailable result with money',()=>{
  expect(()=>read({...snapshot,extra:'not part of the contract'})).toThrow();
  for(const field of Object.keys(snapshot)){const value:Record<string,unknown>={...snapshot};delete value[field];expect(()=>read(value)).toThrow();}
  expect(()=>read({state:'absent',outstandingCents:'0'})).toThrow();
 });
});
