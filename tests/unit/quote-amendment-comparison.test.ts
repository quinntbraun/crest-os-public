import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {prepareQuoteAmendmentComparison} from '../../src/commercial/quote-amendment-comparison';
import {prepareVersionedQuoteContent} from '../../src/commercial/quote-review-content';
function fixture(){
 const businessId=randomUUID(),familyId=randomUUID(),customerId=randomUUID(),vehicle=randomUUID();
 const content={schemaVersion:2,title:'Fictional accepted detail',recipient:{customerId,leadId:null as string|null,displayName:'Synthetic Avery',phone:null,email:null},workLocation:'Synthetic bay',terms:'Exact accepted terms',timezone:'UTC',expiryAt:null,proposedSchedule:null,internalNotes:'PRIVATE owner note never shown to the customer',documentDiscount:null,lines:[{id:randomUUID(),vehicleId:vehicle as string|null,jobWide:false,vehicleLabel:'Synthetic sedan' as string|null,serviceVersionId:null,description:'Interior',inclusions:'Leather care',exclusions:'Exterior',condition:'Moderate',grossCents:'25000',lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null as string|null,category:'Sedan',assessment:null,categoryOverrideNote:null},{id:randomUUID(),vehicleId:null as string|null,jobWide:true,vehicleLabel:null as string|null,serviceVersionId:null,description:'Complimentary work',inclusions:'Explicit free scope',exclusions:'',condition:null,grossCents:'0',lineDiscount:null,documentDiscountEligible:false,complimentaryReason:'Owner-approved complimentary work',category:null,assessment:null,categoryOverrideNote:null}]};
 const hash=(value:unknown)=>createHash('sha256').update(prepareVersionedQuoteContent(value).canonical).digest('hex');
 const parent={agreementId:randomUUID(),versionNo:'1',revisionId:randomUUID(),contentHash:hash(content),customerId,sourceLeadId:null as string|null,content};
 const input={schemaVersion:1,businessId,familyId,parent,proposedContent:structuredClone(content)};return {input,content,hash,vehicle};
}
it('binds unchanged terms to the exact accepted preimage without claiming a saved amendment',async()=>{
 const f=fixture(),r=await prepareQuoteAmendmentComparison(f.input);expect(r.hasCustomerChanges).toBe(false);expect(r.customer).toMatchObject({previousAgreementVersion:'1',proposedAgreementVersion:'2',previousTotalCents:'25000',revisedTotalCents:'25000',signedDeltaCents:'0',lineChanges:[],headerChanges:[]});expect(r.internal.expectedAcceptedHash).toBe(f.input.parent.contentHash);expect(r.internal.proposedContentHash).toBe(f.input.parent.contentHash);expect(r).not.toHaveProperty('state');
});
it('shows exact positive and negative price deltas on retained scope identities',async()=>{
 for(const [price,delta]of [['27001','2001'],['10000','-15000']]){const f=fixture();f.input.proposedContent.lines[0]!.grossCents=price!;const r=await prepareQuoteAmendmentComparison(f.input);expect(r.customer.signedDeltaCents).toBe(delta);expect(r.customer.lineChanges[0]).toMatchObject({kind:'changed',before:{finalCents:'25000'},after:{finalCents:price}});expect(r.internal.lineChanges[0]!.stableLineKey).toBe(f.content.lines[0]!.id);}
});
it('retains added and removed complimentary identities even when the dollar delta is zero',async()=>{
 const f=fixture(),oldId=f.content.lines[1]!.id,newId=randomUUID();f.input.proposedContent.lines[1]!.id=newId;const r=await prepareQuoteAmendmentComparison(f.input);expect(r.hasCustomerChanges).toBe(true);expect(r.customer.signedDeltaCents).toBe('0');expect(r.internal.lineChanges).toMatchObject([{stableLineKey:newId,kind:'added',signedDeltaCents:'0'},{stableLineKey:oldId,kind:'removed',signedDeltaCents:'0'}]);
});
it('requires a new scope identity when accepted work moves to another vehicle',async()=>{
 const f=fixture();f.input.proposedContent.lines[0]!.vehicleId=randomUUID();await expect(prepareQuoteAmendmentComparison(f.input)).rejects.toMatchObject({code:'scope_identity'});f.input.proposedContent.lines[0]!.id=randomUUID();const r=await prepareQuoteAmendmentComparison(f.input);expect(r.customer.lineChanges.map(line=>line.kind)).toEqual(['added','removed']);expect(r.customer.signedDeltaCents).toBe('0');
});
it('refuses forged accepted content hashes, parent versions and customers',async()=>{
 const f=fixture();await expect(prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,contentHash:'0'.repeat(64)}})).rejects.toMatchObject({code:'parent'});for(const versionNo of ['0','01','9223372036854775807'])await expect(prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,versionNo}})).rejects.toMatchObject({code:'parent'});
 await expect(prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,customerId:randomUUID()}})).rejects.toMatchObject({code:'customer'});f.input.proposedContent.recipient.customerId=randomUUID();await expect(prepareQuoteAmendmentComparison(f.input)).rejects.toMatchObject({code:'customer'});
});
it('handles a converted lead while retaining its original accepted source and customer binding',async()=>{
 const f=fixture(),leadId=randomUUID(),accepted={...f.content,recipient:{...f.content.recipient,customerId:null,leadId}};const input={...f.input,parent:{...f.input.parent,sourceLeadId:leadId,content:accepted,contentHash:f.hash(accepted)}};const r=await prepareQuoteAmendmentComparison(input);expect(r.hasCustomerChanges).toBe(false);expect(r.internal.customerId).toBe(f.input.parent.customerId);await expect(prepareQuoteAmendmentComparison({...input,parent:{...input.parent,sourceLeadId:randomUUID()}})).rejects.toMatchObject({code:'customer'});
});
it('seals comparison references and snapshots before asynchronous hashing',async()=>{
 const f=fixture(),business=f.input.businessId,parent=f.input.parent.agreementId,name=f.content.recipient.displayName;f.input.proposedContent.lines[0]!.grossCents='26000';const pending=prepareQuoteAmendmentComparison(f.input);f.input.businessId=randomUUID();f.input.parent.agreementId=randomUUID();f.input.parent.versionNo='9';f.input.proposedContent.recipient.displayName='Changed while hashing';f.input.proposedContent.lines[0]!.grossCents='99999';const r=await pending;expect(r.internal).toMatchObject({businessId:business,parentAgreementId:parent,parentAgreementVersion:'1'});expect(r.customer).toMatchObject({revisedTotalCents:'26000',signedDeltaCents:'1000'});expect(JSON.stringify(r.customer)).not.toContain('Changed while hashing');expect(f.content.recipient.displayName).toBe(name);
});
it('does not expose private notes, assessment provenance, source IDs or parent IDs in customer changes',async()=>{
 const f=fixture();f.input.proposedContent.lines[0]!.grossCents='26000';const r=await prepareQuoteAmendmentComparison(f.input),safe=JSON.stringify(r.customer);for(const privateValue of [f.content.internalNotes,f.input.businessId,f.input.familyId,f.input.parent.agreementId,f.input.parent.revisionId,f.vehicle,...f.content.lines.map(line=>line.id)])expect(safe).not.toContain(privateValue);expect(Object.isFrozen(r.customer.lineChanges)).toBe(true);expect(Object.isFrozen(r.customer.lineChanges[0]!.after)).toBe(true);
});
it('keeps private-only changes distinct from customer-facing amendments',async()=>{
 const f=fixture();f.input.proposedContent.internalNotes='Another private note';const r=await prepareQuoteAmendmentComparison(f.input);expect(r.hasCustomerChanges).toBe(false);expect(r.internal.proposedContentHash).not.toBe(r.internal.expectedAcceptedHash);expect(r.customer.signedDeltaCents).toBe('0');
});
it('retains term changes and line reordering with exact zero deltas',async()=>{
 const f=fixture();f.input.proposedContent.terms='Revised customer terms';f.input.proposedContent.lines.reverse();const r=await prepareQuoteAmendmentComparison(f.input);expect(r.hasCustomerChanges).toBe(true);expect(r.customer.headerChanges).toMatchObject([{field:'terms',before:'Exact accepted terms',after:'Revised customer terms'}]);expect(r.customer.lineChanges.map(line=>line.kind)).toEqual(['moved','moved']);expect(r.customer.signedDeltaCents).toBe('0');
});
it('keeps cent differences above JavaScript safe integers exact',async()=>{
 const f=fixture();f.content.lines[0]!.grossCents='9007199254740993';f.input.parent.contentHash=f.hash(f.content);f.input.proposedContent=structuredClone(f.content);f.input.proposedContent.lines[0]!.grossCents='9007199254740992';const r=await prepareQuoteAmendmentComparison(f.input);expect(r.customer.signedDeltaCents).toBe('-1');expect(r.internal.lineChanges[0]!.signedDeltaCents).toBe('-1');
});
it('compares v1 and v2 without rewriting the original canonical preimage',async()=>{
 const f=fixture(),old={...f.content,schemaVersion:1,lines:f.content.lines.map(({category: _category,assessment:_assessment,categoryOverrideNote:_override,...line})=>{void _category;void _assessment;void _override;return line;})};f.input.proposedContent.lines[0]!.category=null;const r=await prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,content:old,contentHash:f.hash(old)}});expect(r.hasCustomerChanges).toBe(false);expect(r.internal.expectedAcceptedHash).toBe(f.hash(old));
});
it('rejects extra envelope fields and malformed content rather than accepting supplied totals',async()=>{
 const f=fixture();await expect(prepareQuoteAmendmentComparison({...f.input,accepted:true})).rejects.toMatchObject({code:'input'});await expect(prepareQuoteAmendmentComparison({...f.input,proposedContent:{...f.input.proposedContent,totalCents:'1'}})).rejects.toMatchObject({code:'input'});await expect(prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,versionNo:'-1'}})).rejects.toMatchObject({code:'parent'});
});

it('reconciles stable-cent discount reallocations independently of the document total',async()=>{
 const f=fixture(),first={...f.content.lines[0]!,grossCents:'1',complimentaryReason:'Explicit one-cent offer'},second={...first,id:randomUUID(),description:'Second item'},content={...f.content,documentDiscount:{kind:'fixed',cents:'1'},lines:[first,second]},input={...f.input,parent:{...f.input.parent,content,contentHash:f.hash(content)},proposedContent:{...content,lines:[second,first]}};const r=await prepareQuoteAmendmentComparison(input);expect(r.customer.signedDeltaCents).toBe('0');expect(r.internal.lineChanges.map(line=>line.signedDeltaCents).sort()).toEqual(['-1','1']);expect(r.internal.lineChanges.every(line=>line.kind==='changed')).toBe(true);
});
it('rejects oversized prepared comparisons before treating them as a bounded response',async()=>{
 const f=fixture(),lines=Array.from({length:600},(_,index)=>({...f.content.lines[0]!,id:randomUUID(),description:'Item '+index,inclusions:'x'.repeat(8000)})),content={...f.content,lines};await expect(prepareQuoteAmendmentComparison({...f.input,parent:{...f.input.parent,content,contentHash:f.hash(content)}})).rejects.toMatchObject({code:'budget'});
});
