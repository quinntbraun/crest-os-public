import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {quoteFixture} from '../support/quote-fixture';
import type {QuoteContentInput} from '../../src/commercial/quote-content';
import {prepareQuoteAmendmentComparison} from '../../src/commercial/quote-amendment-comparison';
import type {QuoteAmendmentCustomerComparison} from '../../src/commercial/quote-amendment-comparison';
import {prepareVersionedQuoteContent} from '../../src/commercial/quote-review-content';
import {QuoteAmendmentDocument} from '../../src/app/quotes/quote-amendment-document';
function fixture(){const f=quoteFixture(),content={...f.input,documentDiscount:null as QuoteContentInput['documentDiscount']},parent={agreementId:randomUUID(),versionNo:'1',revisionId:f.revision.id,customerId:content.recipient.customerId!,sourceLeadId:null,content,contentHash:createHash('sha256').update(prepareVersionedQuoteContent(content).canonical).digest('hex')};return {f,input:{schemaVersion:1,businessId:f.business,familyId:f.family.id,parent,proposedContent:structuredClone(content)}};}
const render=(comparison:QuoteAmendmentCustomerComparison)=>renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison}));
it('shows an accepted comparison as accepted while preserving earlier values and private-data boundaries',async()=>{
 const {input,f}=fixture();input.proposedContent.lines=[{...input.proposedContent.lines[0]!,grossCents:'27001'},input.proposedContent.lines[1]!];const prepared=await prepareQuoteAmendmentComparison(input),html=renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison:prepared.customer,accepted:true}));
 for(const text of ['Accepted change to work','This change is accepted.','Earlier accepted total','Accepted total','Increase of $20.01','$550.00','$570.01','records no invoice, payment or refund'])expect(html).toContain(text);
 for(const text of ['Proposed total','Proposed work','remains in effect until this change is separately accepted',f.input.internalNotes!,f.business,f.family.id,input.parent.agreementId])expect(html).not.toContain(text);
});
it('shows exact accepted/proposed amounts and honest unaccepted status without exposing actions or private source identities',async()=>{
 const {input,f}=fixture();input.proposedContent.lines=[{...input.proposedContent.lines[0]!,grossCents:'27001'},input.proposedContent.lines[1]!];const result=await prepareQuoteAmendmentComparison(input),html=render(result.customer);
 for(const label of ['Increase of $20.01','$550.00','$570.01','version 1','version 2','remains in effect until this change is separately accepted','records no invoice, payment or refund','<details','<summary','Accepted work','Proposed work'])expect(html).toContain(label);
 for(const privateValue of [f.input.internalNotes!,f.business,f.family.id,input.parent.agreementId,input.parent.revisionId,...f.input.lines.map(row=>row.id)])expect(html).not.toContain(privateValue);
 expect(html).not.toMatch(/<(button|input|form|script)\b/);
 expect(()=>{
  // @ts-expect-error a full internal comparison is not a customer document
  return renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison:result}));
 }).toThrow('QUOTE_AMENDMENT_CUSTOMER_PROJECTION_REQUIRED');
});
it('formats negative and unchanged dollar changes without creating a refund or billing outcome',async()=>{
 const {input}=fixture();input.proposedContent.lines=[{...input.proposedContent.lines[0]!,grossCents:'10000'},input.proposedContent.lines[1]!];const decrease=render((await prepareQuoteAmendmentComparison(input)).customer);expect(decrease).toContain('Decrease of $150.00');expect(decrease).toContain('$400.00');expect(decrease).not.toContain('$-');input.proposedContent=structuredClone(input.parent.content);const same=render((await prepareQuoteAmendmentComparison(input)).customer);expect(same).toContain('No price change');expect(same).toContain('No customer-facing scope, terms or price changes.');
});
it('keeps distinct complimentary additions/removals and explicit scope text when the total is unchanged',async()=>{
 const {input}=fixture();input.parent.content.lines=[{...input.parent.content.lines[0]!,grossCents:'0',complimentaryReason:'Explicit complimentary old scope'}];input.parent.contentHash=createHash('sha256').update(prepareVersionedQuoteContent(input.parent.content).canonical).digest('hex');input.proposedContent={...structuredClone(input.parent.content),lines:[{...input.parent.content.lines[0]!,id:randomUUID(),description:'Replacement complimentary work',complimentaryReason:'Explicit complimentary replacement'}]};const html=render((await prepareQuoteAmendmentComparison(input)).customer);for(const text of ['No price change','Added','Removed','Not included','Replacement complimentary work','Explicit complimentary old scope','Explicit complimentary replacement','$0.00'])expect(html).toContain(text);
});
it('shows before and after customer details, terms and long literal Unicode content without unsafe markup',async()=>{
 const {input}=fixture(),long='é 雪 😀 scope\n'.repeat(100),literal='<script>not executable</script>';input.proposedContent={...input.proposedContent,title:'Updated detail',recipient:{...input.proposedContent.recipient,phone:'3175550100',email:'synthetic@example.com'},terms:long+literal,workLocation:'Fictional second bay',timezone:'UTC',expiryAt:'2026-11-04T10:00:00.000001Z',proposedSchedule:'Tentative only',documentDiscount:{kind:'fixed',cents:'1000'}};const html=render((await prepareQuoteAmendmentComparison(input)).customer);for(const text of ['Title changed','Customer contact changed','Work location changed','Terms changed','Business time zone changed','Expiry changed','Proposed timing changed','Quote-wide discount changed',long,'&lt;script&gt;not executable&lt;/script&gt;','synthetic@example.com','No expiry','UTC','Not provided'])expect(html).toContain(text);expect(html).not.toContain('<script>');
});
it('retains same-price reorder information and reveals full before/after inclusions and exclusions',async()=>{
 const {input}=fixture();input.proposedContent.lines=[input.proposedContent.lines[1]!,input.proposedContent.lines[0]!];const html=render((await prepareQuoteAmendmentComparison(input)).customer);for(const text of ['Reordered','Line 2 → 1','Price and scope stay the same.','Includes','Excludes','Vacuum and interior care','Exterior protection'])expect(html).toContain(text);
});
it('refuses private properties at root, header and either line boundary',async()=>{
 const {input}=fixture();input.proposedContent.terms='Changed terms';input.proposedContent.recipient={...input.proposedContent.recipient,displayName:'Updated synthetic recipient'};input.proposedContent.lines=[{...input.proposedContent.lines[0]!,grossCents:'27000'},input.proposedContent.lines[1]!];const c=(await prepareQuoteAmendmentComparison(input)).customer;
 for(const unsafe of [{...c,internal:{notes:'PRIVATE'}},{...c,headerChanges:c.headerChanges.map(row=>row.field==='recipient'?{...row,after:{...row.after as object,customerId:randomUUID()}}:row)},{...c,lineChanges:c.lineChanges.map(row=>({...row,before:{...row.before,privateNotes:'PRIVATE'}}))},{...c,lineChanges:c.lineChanges.map(row=>({...row,after:{...row.after,sourceVehicleId:randomUUID()}}))}])expect(()=>render(unsafe as QuoteAmendmentCustomerComparison)).toThrow('QUOTE_AMENDMENT_CUSTOMER_PROJECTION_REQUIRED');
});
it('refuses inconsistent totals, negative zero, duplicate changes and incomplete before/after scope',async()=>{
 const {input}=fixture();input.proposedContent.lines=[{...input.proposedContent.lines[0]!,grossCents:'27000'},input.proposedContent.lines[1]!];const c=(await prepareQuoteAmendmentComparison(input)).customer;
 for(const unsafe of [{...c,signedDeltaCents:'-0'},{...c,revisedTotalCents:'99999'},{...c,proposedAgreementVersion:'3'},{...c,lineChanges:[...c.lineChanges,...c.lineChanges]},{...c,lineChanges:c.lineChanges.map(row=>({...row,before:null,beforePosition:null}))},{...c,lineChanges:c.lineChanges.map(row=>({...row,after:{...row.after,finalCents:'1'}}))},{...c,lineChanges:c.lineChanges.map(row=>({...row,kind:'moved',afterPosition:2}))}])expect(()=>render(unsafe as QuoteAmendmentCustomerComparison)).toThrow('QUOTE_AMENDMENT_CUSTOMER_PROJECTION_REQUIRED');
});
