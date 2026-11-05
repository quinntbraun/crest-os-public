import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {prepareQuoteContent,QuoteContentError} from '../../src/commercial/quote-content';
import type {QuoteContentInput,QuoteContentLine} from '../../src/commercial/quote-content';
const line=(amount:string):QuoteContentLine=>({id:randomUUID(),vehicleId:randomUUID(),jobWide:false,vehicleLabel:'Synthetic SUV',serviceVersionId:randomUUID(),description:'Interior detail',inclusions:'Vacuum and interior cleaning',exclusions:'Exterior protection',condition:'Moderate',grossCents:amount,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null});
const draft=():QuoteContentInput=>({schemaVersion:1,title:'Synthetic quote',recipient:{customerId:randomUUID(),leadId:null,displayName:'Synthetic Jordan Avery',phone:null,email:null},workLocation:'Synthetic workshop',terms:'',timezone:'America/Indianapolis',expiryAt:null,proposedSchedule:null,internalNotes:'PRIVATE synthetic cost assumption',documentDiscount:{kind:'fixed',cents:'2500'},lines:[line('25000'),line('30000')]});
it('prepares the canonical52500-cent offer from owner inputs using the existing exact calculator',()=>{
 const content=prepareQuoteContent(draft());expect(content.customer.totalCents).toBe('52500');expect(content.customer.lines.map(row=>row.allocatedDiscountCents)).toEqual(['1136','1364']);expect(content.customer.lines.map(row=>row.finalCents)).toEqual(['23864','28636']);
 expect(content.customer.expiryAt).toBeNull();expect(content.customer.proposedSchedule).toBeNull();expect(content.internal.extremeReviewRequired).toBe(false);
 expect(content).not.toHaveProperty('state');expect(content).not.toHaveProperty('approved');expect(content).not.toHaveProperty('sent');
});
it('excludes private notes and all source identifiers from the customer projection',()=>{
 const input=draft(),content=prepareQuoteContent(input),publicText=JSON.stringify(content.customer);
 expect(publicText).not.toContain(input.internalNotes);for(const id of [input.recipient.customerId,...input.lines.flatMap(row=>[row.id,row.vehicleId,row.serviceVersionId])])expect(publicText).not.toContain(id);
 expect(content.internal.notes).toBe(input.internalNotes);expect(content.internal.sources[0]!.serviceVersionId).toBe(input.lines[0]!.serviceVersionId);
 expect(()=>prepareQuoteContent({...input,unexpectedInternalValue:'do not spread'})).toThrow(QuoteContentError);
});
it('copies immutable values so later form, catalog or recipient changes cannot rewrite review content',()=>{
 const input=structuredClone(draft()),content=prepareQuoteContent(input),canonical=content.canonical;
 (input.recipient as {displayName:string}).displayName='Changed recipient';(input.lines[0] as {inclusions:string}).inclusions='Changed scope';(input.documentDiscount as {cents:string}).cents='1';
 expect(content.customer.recipient.displayName).toBe('Synthetic Jordan Avery');expect(content.customer.lines[0]!.inclusions).toBe('Vacuum and interior cleaning');expect(content.customer.documentDiscount).toEqual({kind:'fixed',cents:'2500'});expect(content.canonical).toBe(canonical);
 for(const value of [content,content.customer,content.customer.recipient,content.customer.lines,content.customer.lines[0],content.customer.documentDiscount,content.internal,content.internal.sources,content.internal.sources[0]])expect(Object.isFrozen(value)).toBe(true);
});
it('uses fixed schema ordering while preserving exact Unicode, whitespace, microseconds and optional absence',()=>{
 const input={...draft(),expiryAt:'2026-10-29T20:00:00.123456Z',terms:'Synthetic é terms\nSecond line',proposedSchedule:'Tentative Thursday afternoon',internalNotes:null};
 const reversed=Object.fromEntries(Object.entries(input).reverse());expect(prepareQuoteContent(reversed).canonical).toBe(prepareQuoteContent(input).canonical);
 const content=prepareQuoteContent(input);expect(content.customer.expiryAt).toBe(input.expiryAt);expect(content.customer.terms).toBe(input.terms);expect(content.internal.notes).toBeNull();
 expect(prepareQuoteContent({...input,terms:input.terms+' '}).canonical).not.toBe(content.canonical);
 expect(prepareQuoteContent({...input,internalNotes:'Changed internal assumption'}).canonical).not.toBe(content.canonical);
});
it('requires a real recipient reference and explicit vehicle or job-wide scope without inferring ownership',()=>{
 const input=draft();expect(()=>prepareQuoteContent({...input,recipient:{...input.recipient,customerId:null}})).toThrow('recipient');
 const lead=prepareQuoteContent({...input,recipient:{...input.recipient,customerId:null,leadId:randomUUID()}});expect(lead.internal.leadId).not.toBeNull();
 const jobWide={...input.lines[0]!,vehicleId:null,vehicleLabel:null,jobWide:true};expect(prepareQuoteContent({...input,documentDiscount:null,lines:[jobWide]}).internal.sources[0]!.jobWide).toBe(true);
 for(const patch of [{vehicleId:null},{jobWide:true},{vehicleLabel:null},{vehicleId:null,jobWide:true}])expect(()=>prepareQuoteContent({...input,lines:[{...input.lines[0],...patch}]})).toThrow('scope');
});
it('retains Extreme as a review requirement without approving it or charging a surcharge',()=>{
 const input=draft(),normal=prepareQuoteContent(input),extreme=prepareQuoteContent({...input,lines:input.lines.map(row=>({...row,condition:'Extreme'}))});
 expect(extreme.internal.extremeReviewRequired).toBe(true);expect(extreme.customer.totalCents).toBe(normal.customer.totalCents);expect(extreme.canonical).not.toBe(normal.canonical);
});
it('recalculates discounts and requires complimentary reasons rather than accepting browser totals or tax additions',()=>{
 const input={...draft(),documentDiscount:null,lines:[{...line('10000'),lineDiscount:{kind:'percent' as const,rate:'0.1'}}]};
 expect(prepareQuoteContent({...input,documentDiscount:{kind:'percent',rate:'0.1'}}).customer.totalCents).toBe('8100');
 for(const patch of [{totalCents:'1'},{taxCents:'1'}])expect(()=>prepareQuoteContent({...input,...patch})).toThrow('content');
 expect(()=>prepareQuoteContent({...input,lines:[line('0')]})).toThrow('complimentary_reason');
 expect(prepareQuoteContent({...input,lines:[{...line('0'),complimentaryReason:'Synthetic goodwill'}]}).customer.totalCents).toBe('0');
 expect(()=>prepareQuoteContent({...input,documentDiscount:{kind:'fixed',cents:'10001'}})).toThrow('discount_exceeds_amount');
});
it('refuses impossible expiry dates, invalid timezones, untyped source links and malformed scope',()=>{
 const input=draft();for(const patch of [{expiryAt:'2026-02-30T12:00:00.000000Z'},{expiryAt:'2026-10-29T12:00:00Z'},{timezone:'Not/A_Timezone'},{title:' '},{workLocation:''}])expect(()=>prepareQuoteContent({...input,...patch})).toThrow(QuoteContentError);
 for(const patch of [{condition:'Severe'},{serviceVersionId:'not-a-version'},{vehicleId:'not-a-vehicle'},{description:''},{inclusions:'\u0000'},{quantity:2}])expect(()=>prepareQuoteContent({...input,lines:[{...input.lines[0],...patch}]})).toThrow(QuoteContentError);
 expect(()=>prepareQuoteContent({...input,lines:[input.lines[0],input.lines[0]]})).toThrow('line');
});
