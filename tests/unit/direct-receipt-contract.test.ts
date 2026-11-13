import {expect,it} from 'vitest';
import {directReceiptMatchesInput,parseDirectReceiptInput,parseDirectReceiptResult} from '../../src/bookkeeping/direct-receipt-contract';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const reference={operationId:id(1),recoveryEpoch:id(2),paymentId:id(3)};
const business=id(4);
const form={
  reference,customerId:id(5),channelId:id(6),channelVersion:'1',actualOn:'2026-11-13',grossCents:'9007199254740993',
  confirmation:'Fictional credited receipt',distinctReason:null,externalIdentity:{namespace:'transaction',id:'Case-Sensitive',rawReference:'Case-Sensitive'},
  applications:{[id(8)]:'1',[id(7)]:'9007199254740992'},
};
const stored={
  schemaVersion:1,businessId:business,paymentId:reference.paymentId,eventId:id(9),customerId:form.customerId,
  channelVersionId:id(10),accountId:id(11),actualOn:form.actualOn,grossCents:form.grossCents,
  fundingOriginId:id(12),moneyMovementId:id(13),externalEvidenceId:id(14),
  applications:[
    {id:id(15),receivableId:id(7),fundingPartitionId:id(16),cents:'9007199254740992'},
    {id:id(17),receivableId:id(8),fundingPartitionId:id(18),cents:'1'},
  ],
};

it('accepts exact large cents and preserves the reviewed external identity',()=>{
  const input=parseDirectReceiptInput(form);
  expect(Object.keys(input.applications)).toEqual([id(7),id(8)]);
  expect(input.externalIdentity).toEqual(form.externalIdentity);
  const receipt=parseDirectReceiptResult({state:'committed',receipt:stored},business,reference);
  expect(receipt.state).toBe('committed');
  if(receipt.state==='committed')expect(directReceiptMatchesInput(receipt,input)).toBe(true);
});

it('refuses incomplete allocation, rounded numbers, invalid identities and cross-tenant responses',()=>{
  for(const altered of [
    {...form,applications:{[id(7)]:'1'}},{...form,grossCents:Number(form.grossCents)},
    {...form,externalIdentity:{...form.externalIdentity,namespace:' transaction '}},
    {...form,externalIdentity:{...form.externalIdentity,id:' Case-Sensitive'}},
  ])expect(()=>parseDirectReceiptInput(altered)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
  for(const altered of [
    {...stored,businessId:id(99)},{...stored,paymentId:id(99)},{...stored,applications:[...stored.applications].reverse()},
    {...stored,applications:stored.applications.map(item=>({...item,fundingPartitionId:id(16)}))},
  ])expect(()=>parseDirectReceiptResult({state:'committed',receipt:altered},business,reference)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
});
