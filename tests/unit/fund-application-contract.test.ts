import {expect,it} from 'vitest';
import {parseFundApplicationResult} from '../../src/bookkeeping/fund-application-contract';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const reference={operationId:id(1),fundApplicationId:id(2),recoveryEpoch:id(3)};
const receipt={schemaVersion:1,businessId:id(4),operationId:reference.operationId,fundApplicationId:reference.fundApplicationId,
  eventId:id(5),fundLotId:id(6),unapplicationId:id(7),fundingOriginId:id(8),parentPartitionId:id(9),customerId:id(10),
  receivableId:id(11),invoiceId:id(12),arAccountId:id(13),fundsAccountId:id(14),mappingId:id(15),effectiveOn:'2026-11-14',
  firstCent:'1201',lastCent:'1300',cents:'100',reason:'Fictional customer approved'};
const parse=(value:unknown)=>parseFundApplicationResult({state:'committed',receipt:value},receipt.businessId,reference);

it('keeps the legacy unapplication and recognizes a receipt-funded application',()=>{
  expect(parse(receipt)).toMatchObject({state:'committed',receipt:{unapplicationId:id(7),cents:'100'}});
  const funded={...receipt,schemaVersion:2,unapplicationId:null,receiptEventId:id(16)};
  expect(parse(funded)).toMatchObject({state:'committed',receipt:{unapplicationId:null,receiptEventId:id(16),cents:'100'}});
});

it('refuses mixed, missing and inconsistent source lineage',()=>{
  expect(()=>parse({...receipt,receiptEventId:id(16)})).toThrow();
  expect(()=>parse({...receipt,schemaVersion:2,receiptEventId:id(16)})).toThrow();
  expect(()=>parse({...receipt,schemaVersion:2,unapplicationId:null})).toThrow();
  expect(()=>parse({...receipt,schemaVersion:2,unapplicationId:null,receiptEventId:id(16),cents:'99'})).toThrow();
});
