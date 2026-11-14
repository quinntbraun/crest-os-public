import {expect,it} from 'vitest';
import {directReceiptMatchesInput,parseDirectReceiptInput,parseDirectReceiptOptions,
  parseDirectReceiptResult} from '../../src/bookkeeping/direct-receipt-contract';

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

it('preserves the original full-allocation input and parsed receipt shape exactly',()=>{
  expect(Object.hasOwn(parseDirectReceiptInput(form),'fundsMappingId')).toBe(false);
  const result=parseDirectReceiptResult({state:'committed',receipt:stored},business,reference);
  expect(result.state).toBe('committed');
  if(result.state==='committed'){
    expect(Object.hasOwn(result.receipt,'schemaVersion')).toBe(false);
    expect(Object.hasOwn(result.receipt,'heldFunds')).toBe(false);
  }
});

const heldFunds={lotId:id(19),fundingPartitionId:id(20),mappingId:id(21),cents:'1'};
const excess={...form,applications:{[id(7)]:'9007199254740992'},fundsMappingId:heldFunds.mappingId};
const storedExcess={...stored,schemaVersion:2,applications:stored.applications.slice(0,1),heldFunds};

it('binds an explicit remainder and holds exact cents even beyond JavaScript safe integers',()=>{
  const input=parseDirectReceiptInput(excess);
  expect(input.fundsMappingId).toBe(heldFunds.mappingId);
  const result=parseDirectReceiptResult({state:'committed',receipt:storedExcess},business,reference);
  expect(result).toMatchObject({state:'committed',receipt:{schemaVersion:2,heldFunds}});
  if(result.state==='committed'){
    expect(directReceiptMatchesInput(result,input)).toBe(true);
    expect(directReceiptMatchesInput(result,{...input,fundsMappingId:id(22)})).toBe(false);
  }
  const fullyHeld=parseDirectReceiptInput({...excess,applications:{}});
  const resultFullyHeld=parseDirectReceiptResult({state:'committed',receipt:{...storedExcess,applications:[],
    heldFunds:{...heldFunds,cents:form.grossCents}}},business,reference);
  if(resultFullyHeld.state==='committed')expect(directReceiptMatchesInput(resultFullyHeld,fullyHeld)).toBe(true);
  else expect.fail('Expected the committed held-only receipt');
});

it('rejects omitted, superfluous or malformed mappings and unreconciled or reused held partitions',()=>{
  for(const altered of [
    {...form,fundsMappingId:heldFunds.mappingId},
    {...excess,fundsMappingId:undefined},{...excess,fundsMappingId:null},{...excess,fundsMappingId:'guess'},
    {...excess,applications:{[id(7)]:'9007199254740994'}},{...excess,applications:{[id(7)]:'0'}},
    {...excess,grossCents:'0'},{...form,applications:{}},
  ])expect(()=>parseDirectReceiptInput(altered)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
  for(const altered of [
    {...storedExcess,schemaVersion:1},{...stored,schemaVersion:2},
    {...storedExcess,heldFunds:{...heldFunds,cents:'0'}},{...storedExcess,heldFunds:{...heldFunds,cents:'2'}},
    {...storedExcess,heldFunds:{...heldFunds,fundingPartitionId:id(16)}},
    {...storedExcess,heldFunds:{...heldFunds,lotId:'invalid'}},
    {...storedExcess,heldFunds:{...heldFunds,mappingId:'invalid'}},
    {...storedExcess,heldFunds:{...heldFunds,customerId:id(23)}},
  ])expect(()=>parseDirectReceiptResult({state:'committed',receipt:altered},business,reference)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
});

it('requires the date-bound mapping only for a workspace advertising excess receipts',()=>{
  const available={state:'ready',schemaVersion:1,businessId:business,customerId:form.customerId,
    actualOn:form.actualOn,channels:[],receivables:[]};
  const parse=(value:unknown,enabled=false)=>parseDirectReceiptOptions(value,business,form.customerId,form.actualOn,enabled);
  expect(parse(available)).toEqual({state:'ready',actualOn:form.actualOn,channels:[],receivables:[]});
  expect(parse({...available,fundsMappingId:heldFunds.mappingId},true)).toMatchObject({fundsMappingId:heldFunds.mappingId});
  expect(parse({...available,fundsMappingId:null},true)).toMatchObject({fundsMappingId:null});
  expect(()=>parse(available,true)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
  expect(()=>parse({...available,fundsMappingId:heldFunds.mappingId})).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
  expect(()=>parse({...available,fundsMappingId:'guess'},true)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
});

it('reserves one of 180 funding partitions for the held amount',()=>{
  const applications=Array.from({length:180},(_,index)=>({
    id:id(1000+index),receivableId:id(2000+index),fundingPartitionId:id(3000+index),cents:'1',
  }));
  const selected=(count:number)=>Object.fromEntries(applications.slice(0,count).map(row=>[row.receivableId,row.cents]));
  expect(parseDirectReceiptInput({...form,grossCents:'180',applications:selected(180)}).applications).toEqual(selected(180));
  expect(parseDirectReceiptInput({...excess,grossCents:'180',applications:selected(179)}).fundsMappingId).toBe(heldFunds.mappingId);
  expect(()=>parseDirectReceiptInput({...excess,grossCents:'181',applications:selected(180)})).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
  expect(parseDirectReceiptResult({state:'committed',receipt:{...storedExcess,grossCents:'180',applications:applications.slice(0,179)}},
    business,reference).state).toBe('committed');
  expect(()=>parseDirectReceiptResult({state:'committed',receipt:{...storedExcess,grossCents:'181',applications}},
    business,reference)).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
});
