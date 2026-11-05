import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {parseQuoteManualSend,parseQuoteConfirmationAccept,parseQuoteCommercialCommitted} from '../../src/commercial/quote-commercial-contract';
function common(){return {schemaVersion:1,businessId:randomUUID(),operationId:randomUUID(),recoveryEpoch:randomUUID(),familyId:randomUUID(),revisionId:randomUUID(),expectedFamilyVersion:'3',expectedRevisionVersion:'3',expectedContentVersion:'1',expectedHash:'a'.repeat(64)};}
const party=()=>({displayName:'Synthetic customer',phone:null,email:null});
function send(){return {...common(),sendId:randomUUID(),approvalId:randomUUID(),body:{channel:'in_person',recipientSnapshot:party(),evidenceNote:null,confirmedActualSharing:true,presentationHash:'b'.repeat(64),replacesRevisionId:null}};}
function accept(){return {...common(),acceptanceId:randomUUID(),agreementId:randomUUID(),body:{sendId:randomUUID(),customerId:randomUUID(),conversionId:null,channel:'phone',counterpartySnapshot:party(),confirmationEffectiveAt:'2026-10-28T12:00:00.123456Z',evidenceNote:'Synthetic customer confirmed this exact quoted scope by phone.',confirmedExactTerms:true}};}
function receipt(action:'send'|'accept'='send'){
 const request=common(),accepted=action==='accept',ids=()=>accepted?[randomUUID()]:[];
 return {request,value:{state:'committed',operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,receipt:{schemaVersion:1,action,businessId:request.businessId,familyId:request.familyId,familyVersion:'4',revisionId:request.revisionId,revisionVersion:'4',contentVersion:'1',contentHash:request.expectedHash,familyAuditEventId:randomUUID(),revisionAuditEventId:randomUUID(),commercialStateVersion:'1',commercialStateAuditEventId:randomUUID(),approvalId:randomUUID(),sendId:randomUUID(),sendAuditEventId:randomUUID(),acceptanceId:accepted?randomUUID():null,acceptanceAuditEventId:accepted?randomUUID():null,agreementId:accepted?randomUUID():null,agreementAuditEventId:accepted?randomUUID():null,customerId:accepted?randomUUID():null,entitlementIds:ids(),entitlementVersionIds:ids(),allocationIds:ids(),entitlementAuditEventIds:ids(),entitlementVersionAuditEventIds:ids(),allocationAuditEventIds:ids(),leadId:null,leadVersion:null,leadEventId:null,leadAuditEventId:null,leadEventAuditEventId:null,supersededRevisionId:null,supersededRevisionVersion:null,supersededRevisionAuditEventId:null}}};
}
it('seals explicit manual sharing without inventing a delivery timestamp or requiring absent optional contacts',()=>{
 const raw=send(),pinned=parseQuoteManualSend(raw);raw.body.recipientSnapshot.displayName='Changed caller';expect(pinned.body.recipientSnapshot.displayName).toBe('Synthetic customer');expect(pinned.body.evidenceNote).toBeNull();expect(Object.isFrozen(pinned.body.recipientSnapshot)).toBe(true);expect(pinned.body).not.toHaveProperty('deliveredAt');
 for(const patch of [{confirmedActualSharing:false},{presentationHash:'bad'},{evidenceNote:''},{recipientSnapshot:{...party(),internalNotes:'private'}},{replacesRevisionId:raw.revisionId}])expect(()=>parseQuoteManualSend({...raw,body:{...raw.body,...patch}})).toThrow();
});
it('requires actual acceptance evidence and precise confirmation time and refuses partial-scope or actor overrides',()=>{
 const raw=accept(),pinned=parseQuoteConfirmationAccept(raw);expect(pinned.body.confirmationEffectiveAt).toBe(raw.body.confirmationEffectiveAt);expect(Object.isFrozen(pinned.body)).toBe(true);
 for(const patch of [{confirmedExactTerms:false},{evidenceNote:' '},{confirmationEffectiveAt:'2026-10-28T12:00:00Z'},{confirmationEffectiveAt:'2026-02-30T12:00:00.000000Z'},{lineIds:[randomUUID()]},{confirmedActualSharing:true}])expect(()=>parseQuoteConfirmationAccept({...raw,body:{...raw.body,...patch}})).toThrow();
 expect(()=>parseQuoteConfirmationAccept({...raw,actorId:randomUUID()})).toThrow();expect(()=>parseQuoteConfirmationAccept({...raw,expectedContentVersion:'4'})).toThrow();
});
it.each(['send','accept'] as const)('binds the exact %s receipt and freezes typed source and audit identity arrays',action=>{
 const f=receipt(action),parsed=parseQuoteCommercialCommitted(f.value,f.request.businessId,f.request.operationId);expect(parsed.receipt.action).toBe(action);expect(Object.isFrozen(parsed.receipt.entitlementIds)).toBe(true);
 expect(()=>parseQuoteCommercialCommitted(f.value,randomUUID(),f.request.operationId)).toThrow();expect(()=>parseQuoteCommercialCommitted(f.value,f.request.businessId,randomUUID())).toThrow();
 expect(()=>parseQuoteCommercialCommitted({...f.value,receipt:{...f.value.receipt,commercialStateAuditEventId:f.value.receipt.familyAuditEventId}},f.request.businessId,f.request.operationId)).toThrow();
});
it('requires complete acceptance scope and source/audit counts rather than accepting a partial agreement',()=>{
 const f=receipt('accept');for(const patch of [{allocationIds:[]},{customerId:null},{agreementId:null},{entitlementAuditEventIds:[]},{contentVersion:'5'},{leadId:randomUUID()}])expect(()=>parseQuoteCommercialCommitted({...f.value,receipt:{...f.value.receipt,...patch}},f.request.businessId,f.request.operationId)).toThrow();
});
it('requires the complete superseded revision evidence and never treats acceptance as a replacement send',()=>{
 const f=receipt(),replacement={...f.value.receipt,supersededRevisionId:randomUUID(),supersededRevisionVersion:'5',supersededRevisionAuditEventId:randomUUID()};expect(parseQuoteCommercialCommitted({...f.value,receipt:replacement},f.request.businessId,f.request.operationId).receipt.supersededRevisionId).toBe(replacement.supersededRevisionId);
 expect(()=>parseQuoteCommercialCommitted({...f.value,receipt:{...replacement,supersededRevisionAuditEventId:null}},f.request.businessId,f.request.operationId)).toThrow();
 const a=receipt('accept');expect(()=>parseQuoteCommercialCommitted({...a.value,receipt:{...a.value.receipt,supersededRevisionId:randomUUID()}},a.request.businessId,a.request.operationId)).toThrow();
});
