import {describe,it,expect} from 'vitest';
import {enabledFulfillmentModes,initialFulfillmentModes,parseFulfillmentModePayload,parseFulfillmentModeSave,parseFulfillmentModeVersion,parseFulfillmentModeCommitted,parseFulfillmentModeHistory} from '../../src/operations/fulfillment-mode-contract.ts';
const businessId='11111111-1111-1111-1111-111111111111',operationId='22222222-2222-2222-2222-222222222222',epoch='33333333-3333-3333-3333-333333333333',actor='44444444-4444-4444-4444-444444444444';
const command=()=>({schemaVersion:1,businessId,operationId,recoveryEpoch:epoch,expectedSequence:'0',payload:{...initialFulfillmentModes}});
const version=()=>({id:operationId,business_id:businessId,sequence:'1',replaces_sequence:null,mobile_enabled:true,dropoff_enabled:true,pickup_return_enabled:false,reason:null,created_at:'2026-10-30T01:02:03.123456Z',created_by:actor,operation_id:operationId,origin:'manual'});
describe('fulfillment policy boundary for confirmed jobs',()=>{
 it('preserves the owner-authorized initial modes and never enables pickup by fallback',()=>{
  expect(enabledFulfillmentModes(initialFulfillmentModes)).toEqual(['mobile','dropoff']);
  const saved=parseFulfillmentModeSave(command());expect(saved.payload.pickupReturnEnabled).toBe(false);
  for(const change of [{pickupReturnEnabled:true},{mobileEnabled:false},{dropoffEnabled:false},{reason:'Changed initial policy'}])expect(()=>parseFulfillmentModeSave({...command(),payload:{...initialFulfillmentModes,...change}})).toThrow();
 });
 it('requires an explicit reason and a retained prior version for later mode changes',()=>{
  const p={...initialFulfillmentModes,mobileEnabled:false,dropoffEnabled:false,reason:'Owner paused new bookings'};
  expect(enabledFulfillmentModes(parseFulfillmentModeSave({...command(),expectedSequence:'1',payload:p}).payload)).toEqual([]);
  expect(enabledFulfillmentModes({...p,pickupReturnEnabled:true})).toEqual(['pickup_return']);
  for(const value of [null,'','   ','\u0000','\ud800','x'.repeat(1001)])expect(()=>parseFulfillmentModeSave({...command(),expectedSequence:'1',payload:{...p,reason:value}})).toThrow();
 });
 it('rejects coerced permissions, unknown keys and invalid command identities before dispatch',()=>{
  for(const value of [null,0,1,'false',undefined])expect(()=>parseFulfillmentModePayload({...initialFulfillmentModes,pickupReturnEnabled:value})).toThrow();
  expect(()=>parseFulfillmentModePayload({...initialFulfillmentModes,override:true})).toThrow();
  for(const change of [{businessId:actor+'x'},{operationId:null},{recoveryEpoch:''},{expectedSequence:1},{expectedSequence:'01'},{expectedSequence:'9223372036854775807'},{schemaVersion:2},{force:true}])expect(()=>parseFulfillmentModeSave({...command(),...change})).toThrow();
 });
 it('retains exact large revisions and rejects foreign, skipped or malformed stored history',()=>{
  expect(parseFulfillmentModeVersion(version(),businessId).sequence).toBe('1');
  const later={...version(),sequence:'9007199254740993',replaces_sequence:'9007199254740992',pickup_return_enabled:true,reason:'Owner enabled pickup and return'};
  expect(parseFulfillmentModeVersion(later,businessId).sequence).toBe('9007199254740993');
  for(const change of [{business_id:actor},{sequence:'0'},{sequence:2},{replaces_sequence:'1'},{created_at:'2026-02-30T01:02:03.123456Z'},{pickup_return_enabled:true},{origin:'import'}])expect(()=>parseFulfillmentModeVersion({...version(),...change},businessId)).toThrow();
  expect(()=>parseFulfillmentModeVersion({...later,replaces_sequence:'9007199254740991'},businessId)).toThrow();
 });
 it('seals a snapshot so later form edits cannot silently change a pending request',()=>{
  const input=command(),saved=parseFulfillmentModeSave(input);input.payload.mobileEnabled=false;
  expect(saved.payload.mobileEnabled).toBe(true);expect(Object.isFrozen(saved.payload)).toBe(true);expect(Object.isFrozen(saved)).toBe(true);
 });
 it('rejects foreign, invented or malformed committed save receipts',()=>{
  const receipt={schemaVersion:1,businessId,sequence:'1',versionId:actor,auditEventId:epoch},result={state:'committed',operationId,recoveryEpoch:epoch,receipt};
  expect(parseFulfillmentModeCommitted(result,businessId,operationId).receipt).toEqual(receipt);
  for(const change of [{businessId:actor},{sequence:1},{versionId:null},{auditEventId:'missing'},{schemaVersion:2},{extra:true}])expect(()=>parseFulfillmentModeCommitted({...result,receipt:{...receipt,...change}},businessId,operationId)).toThrow();
  expect(()=>parseFulfillmentModeCommitted({...result,operationId:actor},businessId,operationId)).toThrow();expect(()=>parseFulfillmentModeCommitted({...result,recoveryEpoch:null},businessId,operationId)).toThrow();
 });
 it('requires complete consecutive bounded history and accurate continuation state',()=>{
  const first=version(),second={...first,id:epoch,sequence:'2',replaces_sequence:'1',pickup_return_enabled:true,reason:'Enabled by owner'},page={schemaVersion:1,businessId,currentSequence:'2',versions:[first],hasMore:true};
  expect(parseFulfillmentModeHistory(page,businessId,'0',1)).toEqual(page);
  expect(parseFulfillmentModeHistory({...page,versions:[second],hasMore:false},businessId,'1',1)).toHaveProperty('currentSequence','2');
  for(const change of [{versions:[]},{versions:[second]},{versions:[first,second]},{hasMore:false},{currentSequence:'1'},{businessId:actor},{extra:true}])expect(()=>parseFulfillmentModeHistory({...page,...change},businessId,'0',1)).toThrow();
  expect(parseFulfillmentModeHistory({state:'absent'},businessId,'0',20)).toEqual({state:'absent'});
 });
});
