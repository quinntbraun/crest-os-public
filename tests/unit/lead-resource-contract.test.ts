import {it,expect} from 'vitest';
import {CustomerDataError} from '../../src/customer/customer-contract.ts';
import {parseLeadVehicleDraft,parseLeadAddressDraft,parseReportedLeadVehicle,parseLeadRequestedServices} from '../../src/customer/lead-resource-contract.ts';

const uuid='11111111-1111-4111-8111-111111111111';
const report=()=>({schemaVersion:1 as const,label:'Unknown make / blue vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,notes:null});
const vehicle=()=>({vehicleId:null,reportedVehicle:report(),requestedServices:{schemaVersion:1 as const,text:null},conditionNotes:null,archived:false,archiveReason:null});
const address=()=>({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null});

it('supports incomplete vehicle/address intake without inventing a customer, match, service, price or location',()=>{
  expect(parseLeadVehicleDraft(vehicle())).toEqual(vehicle());
  expect(parseLeadAddressDraft(address())).toEqual(address());
});
it('preserves the original report and request when explicitly selecting a directory vehicle',()=>{
  const draft={...vehicle(),vehicleId:uuid,reportedVehicle:{...report(),label:'  É 😀  ',year:-2,vin:' Shared / unconfirmed ',plate:'00001',notes:'\tOriginal\n=SUM(A1)\r\n'},requestedServices:{schemaVersion:1 as const,text:'  Interior\nExterior?  '},conditionNotes:'Reported only; inspect on site'};
  expect(parseLeadVehicleDraft(draft)).toEqual(draft);
  expect(parseLeadVehicleDraft({...draft,vehicleId:null}).reportedVehicle).toEqual(draft.reportedVehicle);
});
it('takes independently frozen nested copies before an asynchronous command can observe caller changes',()=>{
  const draft={...vehicle(),reportedVehicle:{...report(),label:'First report'},requestedServices:{schemaVersion:1 as const,text:'First request'}};
  const frozen=parseLeadVehicleDraft(draft);
  draft.reportedVehicle.label='Mutated';draft.requestedServices.text='Mutated';
  expect(frozen.reportedVehicle.label).toBe('First report');expect(frozen.requestedServices.text).toBe('First request');
  expect(Object.isFrozen(frozen)&&Object.isFrozen(frozen.reportedVehicle)&&Object.isFrozen(frozen.requestedServices)).toBe(true);
});
it('retains null and explicit empty optional intake independently',()=>{
  expect(parseLeadVehicleDraft({...vehicle(),reportedVehicle:{...report(),notes:''},requestedServices:{schemaVersion:1,text:''},conditionNotes:''})).toMatchObject({reportedVehicle:{notes:''},requestedServices:{text:''},conditionNotes:''});
  expect(parseLeadAddressDraft({...address(),line1:'',instructions:''})).toMatchObject({line1:'',instructions:''});
});
it('archives reported intake only with its own original reason',()=>{
  expect(parseLeadVehicleDraft({...vehicle(),archived:true,archiveReason:'  Duplicate inquiry\nreviewed  '})).toMatchObject({archived:true,archiveReason:'  Duplicate inquiry\nreviewed  '});
  for(const change of [{archived:true,archiveReason:null},{archived:true,archiveReason:' \t '},{archived:false,archiveReason:'stale reason'},{archived:1,archiveReason:'invalid'}])expect(()=>parseLeadVehicleDraft({...vehicle(),...change})).toThrow(CustomerDataError);
});
it('keeps exact coordinate decimal strings, paired unknowns and independent geocode/verification facts',()=>{
  const draft={...address(),exactLocationText:'  North gate\nask owner  ',latitude:'39.12345678901234567890123456789',longitude:'-86.00000000000000000000000000001',verifiedAt:'2026-10-25T00:00:00.123456Z'};
  expect(parseLeadAddressDraft(draft)).toEqual(draft);
  expect(parseLeadAddressDraft(draft).geocodeSource).toBeNull();
  expect(parseLeadAddressDraft({...address(),latitude:'-0.000',longitude:'-0'})).toMatchObject({latitude:'0.000',longitude:'0'});
});
it('rejects identity, commercial and authority fields rather than silently dropping them',()=>{
  for(const key of ['businessId','customerId','leadId','operationId','state','conversionId','priceCents','quoteId','acceptanceId']){
    expect(()=>parseLeadVehicleDraft({...vehicle(),[key]:uuid})).toThrow(CustomerDataError);
    expect(()=>parseLeadAddressDraft({...address(),[key]:uuid})).toThrow(CustomerDataError);
  }
  for(const value of [{...report(),id:uuid},{...report(),kind:'business_rig'},{...report(),categoryId:uuid},{...report(),condition:'Light'},{...report(),schemaVersion:2}])expect(()=>parseReportedLeadVehicle(value)).toThrow(CustomerDataError);
  for(const value of [{schemaVersion:1,text:null,serviceId:uuid},{schemaVersion:1,text:null,priceCents:'0'},{schemaVersion:2,text:null},{schemaVersion:'1',text:null}])expect(()=>parseLeadRequestedServices(value)).toThrow(CustomerDataError);
});
it('requires every key at each level so omitted data cannot clear prior intake silently',()=>{
  for(const [parse,draft] of [[parseLeadVehicleDraft,vehicle()],[parseLeadAddressDraft,address()],[parseReportedLeadVehicle,report()],[parseLeadRequestedServices,{schemaVersion:1,text:null}]] as const){
    for(const key of Object.keys(draft)){const value:Record<string,unknown>={...draft};delete value[key];expect(()=>parse(value)).toThrow(CustomerDataError);}
  }
});
it('bounds original multiline reports by Unicode code points without truncation or control injection',()=>{
  for(const key of ['conditionNotes','archiveReason'] as const){
    const limit=key==='archiveReason'?1000:4000,extra=key==='archiveReason'?{archived:true}:{};
    expect(parseLeadVehicleDraft({...vehicle(),...extra,[key]:'😀'.repeat(limit)})[key]).toBe('😀'.repeat(limit));
    expect(()=>parseLeadVehicleDraft({...vehicle(),...extra,[key]:'😀'.repeat(limit+1)})).toThrow(CustomerDataError);
    for(const invalid of ['\u0000','\u0001','\u007f','\ud800','\udfff'])expect(()=>parseLeadVehicleDraft({...vehicle(),...extra,[key]:invalid})).toThrow(CustomerDataError);
  }
  expect(parseLeadRequestedServices({schemaVersion:1,text:'😀'.repeat(4000)}).text).toHaveLength(8000);
  for(const text of ['😀'.repeat(4001),'\u0000','\ud800','\u007f'])expect(()=>parseLeadRequestedServices({schemaVersion:1,text})).toThrow(CustomerDataError);
});
it('rejects malformed source reports, references and addresses with a fixed private-safe error',()=>{
  for(const value of [null,[],{},vehicleIdError(''),vehicleIdError(1),{...vehicle(),reportedVehicle:null},{...vehicle(),requestedServices:[]},{...vehicle(),reportedVehicle:{...report(),label:' \t '}},{...vehicle(),reportedVehicle:{...report(),year:2026.5}},{...vehicle(),reportedVehicle:{...report(),vin:''}}]){
    expect(()=>parseLeadVehicleDraft(value)).toThrowError('CUSTOMER_DATA_INVALID');
  }
  for(const change of [{latitude:'1',longitude:null},{latitude:'90.00000000000000001',longitude:'0'},{latitude:'0',longitude:'-180.00000000000000001'},{latitude:0,longitude:0},{latitude:'1e1',longitude:'0'},{verifiedAt:'2026-10-25T00:00:00.123Z'}])expect(()=>parseLeadAddressDraft({...address(),...change})).toThrow(CustomerDataError);
});
function vehicleIdError(vehicleId:unknown){return {...vehicle(),vehicleId};}
