import {describe,expect,it} from 'vitest';
import {legacyApplicationOutcome,legacyApplicationPage,legacyIdentityResult,parseLegacyIdentityReference} from '../../src/customer/legacy-contact-application-contract';

const businessId='10000000-0000-4000-8000-000000000001';
const batchId='10000000-0000-4000-8000-000000000002';
const approvalId='10000000-0000-4000-8000-000000000003';
const operationId='10000000-0000-4000-8000-000000000004';
const recoveryEpoch='10000000-0000-4000-8000-000000000005';
const customerId='10000000-0000-4000-8000-000000000006';
const evidenceSha256='a'.repeat(64);
const request={batchId,operationId,recoveryEpoch,evidenceSha256};
const receipt={schemaVersion:1,businessId,batchId,approvalId,operationId,evidenceSha256,sourceNamespace:'previous-crm',
 rowCount:2,skippedRows:1,customersCreated:0,vehiclesCreated:0,rowsWithVehiclePair:0};
const pageRequest={batchId,afterRow:1};
const first={row:2,decisionRevision:1,customerAction:'link',customerId,customerVersion:'9007199254740993',
 vehicleAction:'none',vehicleId:null,vehicleVersion:null};
const second={...first,row:3,customerAction:'skip',customerId:null,customerVersion:null};
const page={state:'present',receipt,rows:[first,second],hasMore:false};

describe('contact application contracts',()=>{
 it('validates durable receipts and exact operation retries',()=>{
  expect(legacyApplicationOutcome({state:'committed',receipt},businessId,request).state).toBe('committed');
  expect(legacyApplicationOutcome({state:'already_applied',receipt},businessId,{...request,operationId:customerId}).state).toBe('already_applied');
  for(const invalid of [{...receipt,operationId:customerId},{...receipt,evidenceSha256:'b'.repeat(64)},{...receipt,customersCreated:2},
   {...receipt,rowsWithVehiclePair:2},{...receipt,businessId:customerId}]){
   expect(()=>legacyApplicationOutcome({state:'committed',receipt:invalid},businessId,request)).toThrow();
  }
 });
 it('keeps exact decimal versions and refuses partial, reordered and malformed results',()=>{
  expect(legacyApplicationPage(page,businessId,pageRequest)).toEqual(page);
  for(const invalid of [{...page,hasMore:true},{...page,rows:[first]},{...page,rows:[second,first]},
   {...page,rows:[{...first,customerVersion:9007199254740992},second]},{...page,rows:[first,{...second,vehicleAction:'skip'}]}]){
   expect(()=>legacyApplicationPage(invalid,businessId,pageRequest)).toThrow();
  }
 });
 it('binds a saved source match to the exact tenant, row, namespace and kind',()=>{
  const reference=parseLegacyIdentityReference({batchId,row:2,sourceNamespace:'previous-crm',kind:'customer'});
  const value={...reference,state:'present',schemaVersion:1,businessId,fingerprint:evidenceSha256,
   target:{id:customerId,version:'1',label:'Fictional saved contact',archived:false,recordType:'customer'}};
  expect(legacyIdentityResult(value,businessId,reference)).toEqual(value);
  expect(()=>legacyIdentityResult({...value,row:3},businessId,reference)).toThrow();
  expect(()=>legacyIdentityResult({...value,sourceNamespace:'other-crm'},businessId,reference)).toThrow();
  expect(()=>legacyIdentityResult({...value,target:{...value.target,recordType:'customer_vehicle'}},businessId,reference)).toThrow();
 });
});
