import {describe,it,expect} from 'vitest';
import {validateScopeAllocationPlan} from '../../src/operations/scope-allocation-plan.ts';
const sourceId='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',one='33333333-3333-4333-8333-333333333333',two='44444444-4444-4444-8444-444444444444';
const source=()=>({id:sourceId,grossInclusiveCents:'10001',discountInclusiveCents:'1001',amountCents:'9000'});
const parts=()=>[{partitionId:one,jobId:job,state:'assigned',grossInclusiveCents:'6001',discountInclusiveCents:'601',amountCents:'5400',scopeDescription:'Owner allocated first-visit work'}, {partitionId:two,jobId:null,state:'unassigned',grossInclusiveCents:'4000',discountInclusiveCents:'400',amountCents:'3600',scopeDescription:'Remaining scope remains unassigned'}];
describe('explicit accepted-scope partition arithmetic',()=>{
 it('preserves exact gross, discount and final sums across assigned and unassigned work',()=>{expect(validateScopeAllocationPlan(source(),parts()).parts[1]!.jobId).toBeNull();});
 it('rejects over-allocation, under-allocation and offsetting invented discounts even when net totals match',()=>{
  for(const patch of [{grossInclusiveCents:'6002',amountCents:'5401'},{grossInclusiveCents:'6000',amountCents:'5399'},{grossInclusiveCents:'6002',discountInclusiveCents:'602'},{discountInclusiveCents:'600',amountCents:'5401'}])expect(()=>validateScopeAllocationPlan(source(),[{...parts()[0],...patch},parts()[1]])).toThrow();
 });
 it('rejects duplicate zero-dollar partition identity while preserving separate explicit zero-dollar scope',()=>{
  const zero={id:sourceId,grossInclusiveCents:'0',discountInclusiveCents:'0',amountCents:'0'},p={...parts()[0]!,grossInclusiveCents:'0',discountInclusiveCents:'0',amountCents:'0'};
  expect(validateScopeAllocationPlan(zero,[p]).parts).toHaveLength(1);expect(()=>validateScopeAllocationPlan(zero,[p,p])).toThrow();
  expect(validateScopeAllocationPlan(zero,[p,{...p,partitionId:two,scopeDescription:'Separate explicitly allocated complimentary work'}]).parts).toHaveLength(2);
 });
 it('never rounds amounts through floating point or coerces negative, decimal, exponent or malformed amounts',()=>{
  const large='9007199254740993',s={id:sourceId,grossInclusiveCents:large,discountInclusiveCents:'0',amountCents:large},p={...parts()[0]!,grossInclusiveCents:large,discountInclusiveCents:'0',amountCents:large};
  expect(validateScopeAllocationPlan(s,[p]).source.amountCents).toBe(large);
  for(const bad of [9000,'-1','1.0','1e3','01','9223372036854775808',null])expect(()=>validateScopeAllocationPlan(source(),[{...parts()[0],amountCents:bad},parts()[1]])).toThrow();
 });
 it('requires the full partition set, valid stable/job identities and explicit nonblank scope',()=>{
  expect(()=>validateScopeAllocationPlan(source(),[])).toThrow();expect(()=>validateScopeAllocationPlan(source(),[parts()[0]])).toThrow();
  for(const patch of [{partitionId:null},{jobId:'unknown'},{scopeDescription:' '},{scopeDescription:'bad\u0000scope'},{extra:true}])expect(()=>validateScopeAllocationPlan(source(),[{...parts()[0],...patch},parts()[1]])).toThrow();
  expect(()=>validateScopeAllocationPlan({...source(),amountCents:'8999'},parts())).toThrow();
 });
 it('retains explicit per-part completion/cancellation instead of inferring fulfillment from the whole job',()=>{
  for(const state of ['completed','cancelled'])expect(validateScopeAllocationPlan(source(),[{...parts()[0],state},parts()[1]]).parts[0]!.state).toBe(state);
  for(const patch of [{state:'unassigned'},{state:'invented'},{state:null},{state:'completed',jobId:null}])expect(()=>validateScopeAllocationPlan(source(),[{...parts()[0],...patch},parts()[1]])).toThrow();
 });
 it('seals source and each part independently of later form changes',()=>{const s=source(),p=parts(),saved=validateScopeAllocationPlan(s,p);s.amountCents='0';p[0]!.scopeDescription='Changed';expect(saved.source.amountCents).toBe('9000');expect(saved.parts[0]!.scopeDescription).toBe('Owner allocated first-visit work');expect(Object.isFrozen(saved.parts[0])).toBe(true);});
});
