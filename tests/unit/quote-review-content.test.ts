import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {quoteFixture} from '../support/quote-fixture';
import {prepareQuoteContent} from '../../src/commercial/quote-content';
import {prepareQuoteReviewContent,prepareVersionedQuoteContent,quoteReviewReadiness} from '../../src/commercial/quote-review-content';
import type {QuoteReviewContentInput} from '../../src/commercial/quote-review-content';
function review():QuoteReviewContentInput{
 const f=quoteFixture();return {...f.input,schemaVersion:2,documentDiscount:null,lines:[{...f.input.lines[0]!,vehicleId:randomUUID(),jobWide:false,vehicleLabel:'Synthetic SUV',condition:'Moderate',category:'SUV',assessment:{id:randomUUID(),class:'Moderate',source:'reported',assessedAt:'2026-10-28T12:00:00.123456Z',notes:'PRIVATE_ASSESSMENT_NOTE'},categoryOverrideNote:'PRIVATE_OWNER_CLASSIFICATION'}]};
}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
it('keeps version1 bytes and hashes unchanged without manufacturing version2 provenance',()=>{
 const f=quoteFixture(),old=prepareQuoteContent(f.input),result=prepareVersionedQuoteContent(f.input);
 expect(result.canonical).toBe(old.canonical);expect(hash(result.canonical)).toBe(hash(old.canonical));expect(result.customer.schemaVersion).toBe(1);expect(result.internal.sources[0]).not.toHaveProperty('assessment');
 expect(()=>prepareQuoteReviewContent(f.input)).toThrow('content');
});
it('seals category and assessment facts while exposing only customer-safe category and condition',()=>{
 const input=review(),result=prepareQuoteReviewContent(input),line=input.lines[0]!;
 expect(result.customer.schemaVersion).toBe(2);expect(result.customer.lines[0]!.category).toBe('SUV');expect(result.customer.lines[0]!.condition).toBe('Moderate');
 const publicText=JSON.stringify(result.customer);for(const privateValue of [line.assessment!.id,line.assessment!.notes!,line.categoryOverrideNote!,line.assessment!.source,line.assessment!.assessedAt])expect(publicText).not.toContain(privateValue);
 expect(result.internal.sources[0]!.assessment).toEqual(line.assessment);expect(result.canonical).toContain(line.assessment!.assessedAt);expect(quoteReviewReadiness(input)).toBeNull();
 for(const changed of [{...input,lines:[{...line,category:'Truck' as const}]},{...input,lines:[{...line,assessment:{...line.assessment!,source:'photo' as const}}]},{...input,lines:[{...line,assessment:{...line.assessment!,notes:'Changed observation'}}]}])expect(hash(prepareQuoteReviewContent(changed).canonical)).not.toBe(hash(result.canonical));
 expect(Object.isFrozen(result.internal.sources[0]!.assessment)).toBe(true);
});
it('permits incomplete vehicle drafts but identifies the facts required before review',()=>{
 const input=review(),missing={...input,lines:[{...input.lines[0]!,category:null,assessment:null}]};
 expect(prepareQuoteReviewContent(missing).internal.sources[0]!.assessment).toBeNull();expect(quoteReviewReadiness(missing)).toContain('category, condition, observation source and assessment time');
 expect(quoteReviewReadiness({...input,lines:[{...input.lines[0]!,condition:null,assessment:null}]})).not.toBeNull();
});
it('refuses fabricated sources, imprecise time, mismatched condition and unexpected assessment fields',()=>{
 const input=review(),line=input.lines[0]!,assessment=line.assessment!;
 for(const invalid of [{...assessment,source:'AI'},{...assessment,assessedAt:'2026-10-28T12:00:00Z'},{...assessment,assessedAt:'2026-02-30T12:00:00.000000Z'},{...assessment,class:'Extreme'},{...assessment,customerId:randomUUID()},{...assessment,notes:''}])expect(()=>prepareQuoteReviewContent({...input,lines:[{...line,assessment:invalid}]})).toThrow();
 expect(()=>prepareQuoteReviewContent({...input,lines:[{...line,category:'Luxury'}]})).toThrow();
 expect(()=>prepareQuoteReviewContent({...input,lines:[{...line,categoryOverrideNote:'\u0000'}]})).toThrow();
});
it('does not create an assessment for job-wide work or silently retain a vehicle condition for review',()=>{
 const input=review(),line={...input.lines[0]!,vehicleId:null,vehicleLabel:null,jobWide:true,category:null,assessment:null,categoryOverrideNote:null};
 expect(quoteReviewReadiness({...input,lines:[line]})).toContain('Remove the vehicle condition');
 expect(quoteReviewReadiness({...input,lines:[{...line,condition:null}]})).toBeNull();
 expect(()=>prepareQuoteReviewContent({...input,lines:[{...line,assessment:input.lines[0]!.assessment}]})).toThrow('assessment');
});
it('permits one observation across the same vehicle lines but refuses one ID with contradictory evidence',()=>{
 const input=review(),first=input.lines[0]!,second={...first,id:randomUUID()};
 expect(prepareQuoteReviewContent({...input,lines:[first,second]}).customer.lines).toHaveLength(2);
 for(const changed of [{...second,vehicleId:randomUUID()},{...second,assessment:{...second.assessment!,source:'on_site' as const}}])expect(()=>prepareQuoteReviewContent({...input,lines:[first,changed]})).toThrow('assessment');
});
