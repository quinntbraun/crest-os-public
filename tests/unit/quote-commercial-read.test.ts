import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {parseQuoteCommercialRead} from '../../src/commercial/quote-commercial-read';
import {QuoteCommercialContractError} from '../../src/commercial/quote-commercial-contract';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
import {quoteFixture} from '../support/quote-fixture';
import type {StoredQuoteRevision} from '../../src/commercial/quote-storage-contract';
function fixture(state:StoredQuoteRevision['state']='Accepted'){
 const f=quoteFixture(),p=prepareQuoteReviewContent({...f.input,schemaVersion:2,lines:f.input.lines.map(line=>({...line,category:null,assessment:null,categoryOverrideNote:null}))}),contentHash=createHash('sha256').update(p.canonical).digest('hex'),presentationText='crest.quote.review.v2\n'+contentHash+'\n'+JSON.stringify(p.customer),approval={id:randomUUID(),contentVersion:'1',contentHash,actorId:f.actor,reviewedAt:'2026-10-28T12:00:00.123456Z',extremeAcknowledged:false,templateVersion:'crest.quote.review.v2',customerRepresentation:p.customer,presentationText,presentationHash:createHash('sha256').update(presentationText).digest('hex'),operationId:randomUUID(),auditEventId:randomUUID()},send={id:randomUUID(),approvalId:approval.id,channel:'email',recipientSnapshot:{displayName:'Synthetic recipient é 雪',phone:null,email:'synthetic@example.com'},confirmedAt:'2026-10-28T13:00:00.000001Z',evidenceNote:null,presentationHash:approval.presentationHash,operationId:randomUUID(),auditEventId:randomUUID(),replacesRevisionId:null},acceptance={id:randomUUID(),sendId:send.id,customerId:f.family.customer_id,conversionId:null,counterpartySnapshot:{displayName:'Synthetic Jordan Avery',phone:null,email:null},contentHash,channel:'phone',confirmationEffectiveAt:'2026-10-28T14:00:00.123456Z',recordedAt:'2026-10-28T15:00:00.123456Z',evidenceNote:'Owner recorded actual external confirmation — é 雪',operationId:randomUUID(),auditEventId:randomUUID()};
 const agreement={id:randomUUID(),acceptanceId:acceptance.id,customerId:f.family.customer_id,versionNo:'1',parentAgreementId:null,totalCents:p.customer.totalCents,signedDeltaCents:p.customer.totalCents,customerSnapshot:p.customer,effectiveAt:acceptance.confirmationEffectiveAt,operationId:acceptance.operationId,auditEventId:randomUUID()},scope=p.customer.lines.map((line,i)=>({entitlementId:randomUUID(),entitlementVersionId:randomUUID(),allocationId:randomUUID(),stableLineKey:p.internal.sources[i]!.stableLineKey,sourceQuoteItemId:f.items[i]!.id,vehicleId:null,jobWide:true,authorizedCents:line.finalCents,grossInclusiveCents:line.grossCents,discountInclusiveCents:(BigInt(line.lineDiscountCents)+BigInt(line.allocatedDiscountCents)).toString(),stablePartitionId:randomUUID(),scopeDescription:line.description,scopeSnapshot:line}));
 const packet={schemaVersion:1,businessId:f.business,familyId:f.family.id,revisionId:f.revision.id,familyVersion:'6',revisionVersion:'6',contentVersion:'1',contentHash,state,control:state==='Draft'||state==='Ready for Review'?null:{schemaVersion:1,version:'3',activeOfferId:state==='Accepted'?null:state==='Superseded'?randomUUID():f.revision.id,initialAcceptanceId:state==='Accepted'?acceptance.id:null,acceptedRevisionId:state==='Accepted'?f.revision.id:null,currentAgreementId:state==='Accepted'?agreement.id:null},approval:state==='Draft'?null:approval,latestSend:state==='Draft'||state==='Ready for Review'?null:send,acceptanceSend:state==='Accepted'?send:null,acceptance:state==='Accepted'?acceptance:null,agreement:state==='Accepted'?agreement:null,scope:state==='Accepted'?scope:[]};
 return {f,p,approval,send,acceptance,agreement,packet,scope:{businessId:f.business,familyId:f.family.id,revisionId:f.revision.id}};
}
const parsed=(f:ReturnType<typeof fixture>,value:unknown=f.packet)=>parseQuoteCommercialRead(value,f.scope);
it.each(['Draft','Ready for Review','Sent','Accepted','Superseded'] as const)('retains the exact actual %s state without fabricating a source action',state=>{
 const f=fixture(state),result=parsed(f);expect(result).toEqual(f.packet);expect(Object.isFrozen(result)).toBe(true);
});
it('seals nested retained public content, private confirmation evidence and exact microseconds',()=>{
 const f=fixture(),source=structuredClone(f.packet),result=parsed(f,source);expect(result).toMatchObject({state:'Accepted',acceptance:{confirmationEffectiveAt:'2026-10-28T14:00:00.123456Z'},agreement:{totalCents:'52500'},scope:[{authorizedCents:'23864'},{authorizedCents:'28636'}]});
 source.latestSend!.recipientSnapshot.displayName='Caller changed';source.acceptance!.evidenceNote='Caller changed';source.agreement!.customerSnapshot={...source.agreement!.customerSnapshot,lines:source.agreement!.customerSnapshot.lines.map(line=>({...line,description:'Caller changed'}))};
 expect(result).toMatchObject({latestSend:{recipientSnapshot:{displayName:'Synthetic recipient é 雪'}},acceptance:{evidenceNote:'Owner recorded actual external confirmation — é 雪'}});
 if('agreement'in result){expect(Object.isFrozen(result.agreement?.customerSnapshot.lines[0])).toBe(true);expect(Object.isFrozen(result.scope[0])).toBe(true);expect(result.scope[0]?.scopeDescription).not.toBe('Caller changed');}
});
it('distinguishes an earlier accepted send from the most recently recorded repeated sharing',()=>{
 const f=fixture(),older=structuredClone(f.send),latest={...f.send,id:randomUUID(),confirmedAt:'2026-10-28T13:30:00.000001Z',operationId:randomUUID(),auditEventId:randomUUID(),evidenceNote:'Second actual sharing'};
 const result=parsed(f,{...f.packet,latestSend:latest,acceptanceSend:older});expect(result).toMatchObject({latestSend:latest,acceptanceSend:older,acceptance:{sendId:older.id}});
 expect(()=>parsed(f,{...f.packet,latestSend:latest,acceptanceSend:null})).toThrow(QuoteCommercialContractError);
 expect(()=>parsed(f,{...f.packet,latestSend:latest,acceptanceSend:latest})).toThrow(QuoteCommercialContractError);
});
it('keeps absence distinct and rejects missing, extra, foreign and malformed outer facts',()=>{
 const f=fixture();expect(parsed(f,{state:'absent'})).toEqual({state:'absent'});for(const patch of [{businessId:randomUUID()},{familyId:randomUUID()},{revisionId:randomUUID()},{familyVersion:'0'},{contentVersion:'7'},{contentHash:'A'.repeat(64)},{state:'Declined'},{extra:true}])expect(()=>parsed(f,{...f.packet,...patch})).toThrow(QuoteCommercialContractError);
 for(const key of Object.keys(f.packet)){const wrong:Record<string,unknown>={...f.packet};delete wrong[key];expect(()=>parsed(f,wrong)).toThrow(QuoteCommercialContractError);}
});
it('refuses stale/private/incomplete retained approval and substituted presentation',()=>{
 const f=fixture();for(const patch of [{contentVersion:'2'},{contentHash:'b'.repeat(64)},{customerRepresentation:{...f.p.customer,internalNotes:'PRIVATE'}},{presentationText:f.approval.presentationText+' garbage'},{reviewedAt:'2026-10-28T12:00:00Z'}])expect(()=>parsed(f,{...f.packet,approval:{...f.approval,...patch}})).toThrow(QuoteCommercialContractError);
});
it('refuses unsupported agreement versions, changed customer scope/amount and detached acceptance',()=>{
 const f=fixture();for(const patch of [{versionNo:'2'},{parentAgreementId:randomUUID()},{signedDeltaCents:'0'},{totalCents:'52501'},{customerId:randomUUID()},{acceptanceId:randomUUID()},{operationId:randomUUID()},{customerSnapshot:{...f.p.customer,totalCents:'1'}}])expect(()=>parsed(f,{...f.packet,agreement:{...f.agreement,...patch}})).toThrow(QuoteCommercialContractError);
 for(const patch of [{sendId:randomUUID()},{confirmationEffectiveAt:'2026-10-28T11:59:59.999999Z'},{contentHash:'c'.repeat(64)},{recordedAt:'2026-10-28T13:59:59.999999Z'},{evidenceNote:''},{counterpartySnapshot:{displayName:'Synthetic',phone:'',email:null}}])expect(()=>parsed(f,{...f.packet,acceptance:{...f.acceptance,...patch}})).toThrow(QuoteCommercialContractError);
});
it('requires every exact ordered accepted line with unique typed source IDs and reversible exact amounts',()=>{
 const f=fixture();for(const wrong of [f.packet.scope.slice(1),[...f.packet.scope].reverse(),[f.packet.scope[0],f.packet.scope[0]]])expect(()=>parsed(f,{...f.packet,scope:wrong})).toThrow(QuoteCommercialContractError);
 const first=f.packet.scope[0]!;for(const patch of [{authorizedCents:'1'},{grossInclusiveCents:25000},{discountInclusiveCents:'-1'},{jobWide:false},{vehicleId:randomUUID()},{scopeDescription:'Changed'},{scopeSnapshot:{...first.scopeSnapshot,description:'Changed'}},{sourceQuoteItemId:'bad'}])expect(()=>parsed(f,{...f.packet,scope:[{...first,...patch},f.packet.scope[1]]})).toThrow(QuoteCommercialContractError);
});
it('refuses contradictory state/control/source combinations and reused unrelated audit proof',()=>{
 for(const state of ['Draft','Ready for Review','Sent','Superseded'] as const){const f=fixture(state),accepted=fixture();expect(()=>parsed(f,{...f.packet,acceptance:accepted.acceptance})).toThrow();}
 const f=fixture('Sent');for(const patch of [{approval:null},{latestSend:null},{control:null},{control:{...f.packet.control,activeOfferId:randomUUID()}},{latestSend:{...f.send,auditEventId:f.approval.auditEventId}}])expect(()=>parsed(f,{...f.packet,...patch})).toThrow(QuoteCommercialContractError);
 const accepted=fixture();expect(()=>parsed(accepted,{...accepted.packet,acceptanceSend:{...accepted.send,evidenceNote:'Different row under same ID'}})).toThrow(QuoteCommercialContractError);
});
