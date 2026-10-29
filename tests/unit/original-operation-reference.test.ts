import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {originalOperationKinds,parseOriginalOperationReference,parseOriginalOperationRetirement,parseOriginalOperationOutcome,bindOriginalOperationRetirement,OriginalOperationReferenceError} from '../../src/security/original-operation-reference';
import type {OriginalOperationKind} from '../../src/security/original-operation-reference';

const businessId=randomUUID(),operationId=randomUUID(),originalEpoch=randomUUID(),authorityEpoch=randomUUID();
const targets:Record<OriginalOperationKind,Record<string,unknown>>={
 'business.rename':{expectedVersion:'1'},
 'crm.customer.save':{customerId:randomUUID(),expectedVersion:'0'},
 'crm.address.save':{customerId:randomUUID(),addressId:randomUUID(),expectedVersion:'0'},
 'crm.vehicle.save':{vehicleId:randomUUID(),expectedVersion:'0'},
 'crm.vehicle.association':{action:'transfer',associationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'1',nextAssociationId:randomUUID()},
 'crm.lead.source.save':{leadSourceId:randomUUID(),expectedVersion:'0'},
 'crm.lead.save':{leadId:randomUUID(),expectedVersion:'0'},
 'crm.lead.state':{leadId:randomUUID(),expectedVersion:'1'},
 'crm.lead.vehicle.save':{leadId:randomUUID(),leadVehicleId:randomUUID(),expectedVersion:'0'},
 'crm.lead.address.save':{leadId:randomUUID(),leadAddressId:randomUUID(),expectedVersion:'0'},
 'crm.lead.convert':{conversionId:randomUUID(),leadId:randomUUID(),expectedLeadVersion:'1',customerId:randomUUID()},
 'catalog.service.save':{serviceId:randomUUID(),expectedRevision:'0'},
 'operations.appointment_hold.save':{holdId:randomUUID(),expectedSequence:'0'},
 'quote.draft.save':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'0',expectedRevisionVersion:'0'},
 'quote.review.submit':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'2',expectedRevisionVersion:'2',expectedContentVersion:'1'},
 'quote.review.approve':{familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'3',expectedRevisionVersion:'3',expectedContentVersion:'1',approvalId:randomUUID()}
};
function sample(kind:OriginalOperationKind='crm.customer.save'){
 return {schemaVersion:1,businessId,commandType:kind,reference:{operationId,recoveryEpoch:originalEpoch,...targets[kind]} as Record<string,unknown>};
}
const original=()=>parseOriginalOperationReference(sample());
const intent=()=>({schemaVersion:1,recoveryEpoch:authorityEpoch,original:original(),reason:' Owner reviewed the lost original draft é 😀\nDo not replay it. '});
const retired=()=>({schemaVersion:1,state:'retired',original:original(),retirement:{operationRowId:randomUUID(),auditEventId:randomUUID(),recoveryEpoch:authorityEpoch,reason:intent().reason,recordedAt:'2026-10-25T01:02:03.123456Z'}});
const rejects=(work:()=>unknown)=>expect(work).toThrow(OriginalOperationReferenceError);

describe('original nonfinancial operation identity',()=>{
 it.each(originalOperationKinds)('preserves complete %s reference without inventing an identity or retaining a mutable input',kind=>{
  const raw=sample(kind),pinned=parseOriginalOperationReference(raw);expect(pinned).toEqual(raw);raw.reference.operationId=randomUUID();expect(pinned.reference.operationId).toBe(operationId);expect(Object.isFrozen(pinned)).toBe(true);expect(Object.isFrozen(pinned.reference)).toBe(true);
 });
 it.each(originalOperationKinds)('rejects a draft hidden in the %s reference',kind=>{const raw=sample(kind);raw.reference.notes='Private lost draft';rejects(()=>parseOriginalOperationReference(raw));});
 it.each(['actorId','binding','password','csrfToken','replacementOperationId','draft'])('rejects caller supplied %s at the envelope',key=>rejects(()=>parseOriginalOperationReference({...sample(),[key]:'Forbidden value'})));
 it.each(['finance.post','invoice.issue','payment.record','operation.retire','crm.generic.write','__proto__','constructor','CRM.customer.save',''])('rejects unsupported command %s',kind=>rejects(()=>parseOriginalOperationReference({...sample(),commandType:kind})));
 it.each(['operationId','recoveryEpoch'])('rejects a malformed original %s',key=>{const raw=sample();raw.reference[key]='not-a-uuid';rejects(()=>parseOriginalOperationReference(raw));});
 it('rejects a malformed business, missing fields and extra schema versions',()=>{rejects(()=>parseOriginalOperationReference({...sample(),businessId:'other'}));rejects(()=>parseOriginalOperationReference({...sample(),schemaVersion:2}));const raw=sample();delete raw.reference.expectedVersion;rejects(()=>parseOriginalOperationReference(raw));});
 it.each([0,1,-1,1.5,'-1','01','1.0','1e3','9223372036854775808','9'.repeat(100),null])('rejects noncanonical or out of range version %s',value=>{const raw=sample();raw.reference.expectedVersion=value;rejects(()=>parseOriginalOperationReference(raw));});
 it('retains the complete bigint maximum as opaque original evidence',()=>{const raw=sample();raw.reference.expectedVersion='9223372036854775807';expect(parseOriginalOperationReference(raw).reference).toMatchObject({expectedVersion:'9223372036854775807'});});
 it.each(['business.rename','crm.lead.state','crm.lead.convert'] as const)('%s cannot invent a version-zero original',kind=>{const raw=sample(kind);raw.reference[kind==='crm.lead.convert'?'expectedLeadVersion':'expectedVersion']='0';rejects(()=>parseOriginalOperationReference(raw));});
 it.each(['open','close','transfer'] as const)('keeps the original association %s identity',action=>{const raw=sample('crm.vehicle.association');raw.reference.action=action;raw.reference.expectedVersion=action==='open'?'0':'1';raw.reference.nextAssociationId=action==='transfer'?randomUUID():null;expect(parseOriginalOperationReference(raw).reference).toEqual(raw.reference);});
 it.each(['invalid action','wrong version','missing successor','same successor','unexpected successor'])('rejects association %s',issue=>{
  const raw=sample('crm.vehicle.association');if(issue==='invalid action')raw.reference.action='merge';if(issue==='wrong version')raw.reference.expectedVersion='2';if(issue==='missing successor')raw.reference.nextAssociationId=null;if(issue==='same successor')raw.reference.nextAssociationId=raw.reference.associationId;if(issue==='unexpected successor')raw.reference.action='close';rejects(()=>parseOriginalOperationReference(raw));
 });
 it('normalizes property order without changing reference meaning',()=>{const raw=sample(),shuffled={reference:Object.fromEntries(Object.entries(raw.reference).reverse()),commandType:raw.commandType,businessId,schemaVersion:1};expect(JSON.stringify(parseOriginalOperationReference(shuffled))).toBe(JSON.stringify(parseOriginalOperationReference(raw)));});
 it('rejects inherited properties, accessors, symbols and nonenumerable metadata',()=>{
  const inherited=Object.create(sample());rejects(()=>parseOriginalOperationReference(inherited));const accessor={...sample()};Object.defineProperty(accessor,'reference',{enumerable:true,get(){throw new Error('Must not be invoked');}});rejects(()=>parseOriginalOperationReference(accessor));const symbol={...sample(),[Symbol('private')]:true};rejects(()=>parseOriginalOperationReference(symbol));const hidden={...sample()};Object.defineProperty(hidden,'draft',{value:'Hidden private detail'});rejects(()=>parseOriginalOperationReference(hidden));
 });
});
describe('explicit retirement review contract',()=>{
 it('preserves a distinct current authority epoch and original historical epoch without rebasing either',()=>{const parsed=parseOriginalOperationRetirement(intent());expect(parsed.recoveryEpoch).toBe(authorityEpoch);expect(parsed.original.reference.recoveryEpoch).toBe(originalEpoch);expect(parsed.reason).toBe(intent().reason);expect(Object.isFrozen(parsed)).toBe(true);});
 it.each(['','   ','\t\r\n','\0','bad\ud800','bad\udfff','bad\u0001','bad\u007f','😀'.repeat(2001)])('rejects an empty, invalid or oversized reason %#',reason=>rejects(()=>parseOriginalOperationRetirement({...intent(),reason})));
 it('retains the full 2000-codepoint Unicode reason instead of truncating or trimming it',()=>{const reason='😀'.repeat(2000);expect(parseOriginalOperationRetirement({...intent(),reason}).reason).toBe(reason);});
 it('rejects a stale-shaped authority or added replacement instead of manufacturing a new command',()=>{rejects(()=>parseOriginalOperationRetirement({...intent(),recoveryEpoch:null}));rejects(()=>parseOriginalOperationRetirement({...intent(),replacementOperationId:randomUUID()}));});
});
describe('bound original resolution evidence',()=>{
 it('preserves the distinct retirement decision and exact microseconds',()=>{const value=retired(),parsed=parseOriginalOperationOutcome(value,original());expect(parsed).toEqual(value);expect(parsed.state).toBe('retired');if(parsed.state==='retired'){expect(parsed.retirement.recordedAt).toBe(value.retirement.recordedAt);expect(Object.isFrozen(parsed.retirement)).toBe(true);value.retirement.reason='Changed after verification';expect(parsed.retirement.reason).toBe(intent().reason);}});
 it('keeps original-recorded as an observation without a fabricated original receipt',()=>{const observation={schemaVersion:1,state:'original_recorded',original:original()};expect(bindOriginalOperationRetirement(observation,parseOriginalOperationRetirement(intent()))).toEqual(observation);rejects(()=>parseOriginalOperationOutcome({...observation,receipt:{state:'committed'}},original()));});
 it.each(originalOperationKinds)('rejects changed complete %s identities in returned evidence',kind=>{
  const expected=parseOriginalOperationReference(sample(kind)),value={...retired(),original:sample(kind)};value.original.reference.operationId=randomUUID();rejects(()=>parseOriginalOperationOutcome(value,expected));
  for(const key of Object.keys(targets[kind]).filter(key=>key.endsWith('Id'))){const changed={...retired(),original:sample(kind)};changed.original.reference[key]=randomUUID();rejects(()=>parseOriginalOperationOutcome(changed,expected));}
 });
 it('rejects a foreign business or original epoch even with otherwise valid receipt metadata',()=>{rejects(()=>parseOriginalOperationOutcome({...retired(),original:{...original(),businessId:randomUUID()}},original()));const raw=sample();raw.reference.recoveryEpoch=randomUUID();rejects(()=>parseOriginalOperationOutcome({...retired(),original:raw},original()));});
 it.each(['originalKind','reason','recoveryEpoch','recordedAt','auditEventId','operationRowId'])('rejects malformed or unbound retirement %s',key=>{const value=retired();if(key==='originalKind')rejects(()=>parseOriginalOperationOutcome({...value,original:{...sample(),commandType:'finance.post'}},original()));else{const receipt={...value.retirement,[key]:key==='recordedAt'?'2026-02-30T01:02:03.123456Z':key==='reason'?'':null};rejects(()=>parseOriginalOperationOutcome({...value,retirement:receipt},original()));}});
 it('requires the exact initial reason and authority on a submission response, while historical lookup preserves prior authority',()=>{
  const old={...retired(),retirement:{...retired().retirement,recoveryEpoch:randomUUID(),reason:'Original retirement by another device'}};expect(parseOriginalOperationOutcome(old,original())).toEqual(old);rejects(()=>bindOriginalOperationRetirement(old,parseOriginalOperationRetirement(intent())));const changedReason={...retired(),retirement:{...retired().retirement,reason:'Different decision'}};rejects(()=>bindOriginalOperationRetirement(changedReason,parseOriginalOperationRetirement(intent())));expect(bindOriginalOperationRetirement(retired(),parseOriginalOperationRetirement(intent())).state).toBe('retired');
 });
 it.each(['absent','committed','cancelled','resolved','failed',''])('does not promote %s to a terminal retirement',state=>rejects(()=>parseOriginalOperationOutcome({...retired(),state},original())));
});
