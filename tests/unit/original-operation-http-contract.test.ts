import {expect,it} from 'vitest';
import {originalOperationKinds} from '../../src/security/original-operation-reference.ts';
import {originalOperationFixture,retirementFixture} from '../support/original-operation-fixture.ts';
import {originalOperationBodyLimit,originalOperationLookupToWire,originalOperationRetirementToWire,parseOriginalOperationLookupWire,parseOriginalOperationRetirementWire} from '../../src/security/original-operation-http-contract.ts';

it.each(originalOperationKinds)('round-trips complete %s original metadata with configured business binding',kind=>{
 const original=originalOperationFixture(kind),request=retirementFixture(original),wire=originalOperationRetirementToWire(request),lookup=originalOperationLookupToWire(original);
 expect(parseOriginalOperationRetirementWire(wire,original.businessId)).toEqual(request);expect(parseOriginalOperationLookupWire(lookup,original.businessId)).toEqual(original);
 expect(Object.isFrozen(wire)).toBe(true);expect(Object.isFrozen(lookup)).toBe(true);expect(Object.keys(wire)).toEqual(['schemaVersion','recoveryEpoch','originalJson','reason']);
});
it('retains the separate historical and fresh authority epochs plus exact bigint versions',()=>{
 const original=structuredClone(originalOperationFixture());Object.assign(original.reference,{expectedVersion:'9223372036854775807'});const request=retirementFixture(original),wire=originalOperationRetirementToWire(request);
 expect(parseOriginalOperationRetirementWire(wire,original.businessId)).toEqual(request);expect(wire.originalJson).toContain('9223372036854775807');expect(request.recoveryEpoch).not.toBe(request.original.reference.recoveryEpoch);
});
it.each(['root duplicate','escaped root duplicate','reference duplicate','escaped reference duplicate'])('rejects %s even when the surviving value is valid',issue=>{
 const original=originalOperationFixture(),body=JSON.stringify(original),ref=JSON.stringify(original.reference);let originalJson=body;
 if(issue==='root duplicate')originalJson=body.replace('{','{"schemaVersion":1,');
 if(issue==='escaped root duplicate')originalJson=body.replace('{','{"\\u0073chemaVersion":1,');
 if(issue==='reference duplicate')originalJson=body.replace(ref,ref.replace('{','{"operationId":"'+original.reference.operationId+'",'));
 if(issue==='escaped reference duplicate')originalJson=body.replace(ref,ref.replace('{','{"\\u006fperationId":"'+original.reference.operationId+'",'));
 expect(()=>parseOriginalOperationLookupWire({originalJson},original.businessId)).toThrow('ORIGINAL_OPERATION_REVIEW_REQUIRED');
});
it.each(['foreign business','extra field','draft','actor','nested reference','malformed JSON','oversized JSON','array','wrong schema','numeric version'])('rejects %s before transport authority is used',issue=>{
 const original=structuredClone(originalOperationFixture()),request=retirementFixture(original),wire={...originalOperationRetirementToWire(request)};
 if(issue==='foreign business')Object.assign(original,{businessId:original.reference.operationId});
 if(issue==='extra field'||issue==='draft'||issue==='actor')Object.assign(original,{[issue==='draft'?'draft':issue==='actor'?'actorId':'extra']:'Forbidden'});
 if(issue==='nested reference')Object.assign(original.reference,{draft:{private:'Forbidden'}});
 if(issue==='wrong schema')Object.assign(original,{schemaVersion:2});if(issue==='numeric version')Object.assign(original.reference,{expectedVersion:1});
 wire.originalJson=JSON.stringify(original);if(issue==='malformed JSON')wire.originalJson='{bad';if(issue==='oversized JSON')wire.originalJson=' '.repeat(2049)+wire.originalJson;if(issue==='array')wire.originalJson='[]';
 expect(()=>parseOriginalOperationRetirementWire(wire,request.original.businessId)).toThrow('ORIGINAL_OPERATION_REVIEW_REQUIRED');
});
it.each(['extra envelope','missing reason','wrong epoch','empty reason','nested outer value'])('rejects %s retirement input without silently normalizing it',issue=>{
 const request=retirementFixture(),wire:Record<string,unknown>={...originalOperationRetirementToWire(request)};
 if(issue==='extra envelope')wire.businessId=request.original.businessId;if(issue==='missing reason')delete wire.reason;if(issue==='wrong epoch')wire.recoveryEpoch='invalid';if(issue==='empty reason')wire.reason=' \t\n';if(issue==='nested outer value')wire.originalJson=request.original;
 expect(()=>parseOriginalOperationRetirementWire(wire,request.original.businessId)).toThrow('ORIGINAL_OPERATION_REVIEW_REQUIRED');
});
it('fits maximum accepted Unicode reasons in the explicit HTTP byte bound and preserves all whitespace',()=>{
 for(const reason of ['😀'.repeat(2000),'\t'.repeat(1999)+'x','  =Reviewed é 😀\r\n\\N  ']){
  const request={...retirementFixture(),reason},wire=originalOperationRetirementToWire(request);expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThanOrEqual(originalOperationBodyLimit);expect(parseOriginalOperationRetirementWire(wire,request.original.businessId).reason).toBe(reason);
 }
});
it('does not permit caller-selected scopes or credentials on an original lookup envelope',()=>{
 const original=originalOperationFixture(),wire=originalOperationLookupToWire(original);
 for(const key of ['businessId','actorId','credential','recoveryEpoch','reason'])expect(()=>parseOriginalOperationLookupWire({...wire,[key]:'Forbidden'},original.businessId)).toThrow('ORIGINAL_OPERATION_REVIEW_REQUIRED');
});
it('rejects accessor, inherited and hidden wire properties without invoking accessors',()=>{
 const original=originalOperationFixture(),wire=originalOperationLookupToWire(original);let invoked=false;
 const accessor={};Object.defineProperty(accessor,'originalJson',{enumerable:true,get(){invoked=true;return wire.originalJson;}});
 const hidden={...wire};Object.defineProperty(hidden,'private',{value:'Forbidden'});
 for(const value of [accessor,Object.create(wire),hidden,{...wire,[Symbol('private')]:'Forbidden'}])expect(()=>parseOriginalOperationLookupWire(value,original.businessId)).toThrow('ORIGINAL_OPERATION_REVIEW_REQUIRED');
 expect(invoked).toBe(false);
});
