import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {quoteFixture} from '../support/quote-fixture';
import {prepareVersionedQuoteContent} from '../../src/commercial/quote-review-content';
import {prepareQuoteAmendmentComparison} from '../../src/commercial/quote-amendment-comparison';
import {prepareQuoteCancellationComparison} from '../../src/commercial/quote-cancellation-comparison';
import {prepareQuoteCancellationContent} from '../../src/commercial/quote-cancellation-content';
import {AmendmentScopeOverview} from '../../src/app/quotes/amendments/scope-overview';

function fixture(){
 const f=quoteFixture(),content={...f.input,documentDiscount:null,lines:['Retained wash','Changed polish','Removed coating','Moved seats','Moved mats'].map((description,index)=>({...f.input.lines[0]!,id:randomUUID(),description,grossCents:String(10000+index)}))};
 const before=prepareVersionedQuoteContent(content),parent={agreementId:randomUUID(),versionNo:'7',revisionId:randomUUID(),contentHash:createHash('sha256').update(before.canonical).digest('hex'),customerId:content.recipient.customerId!,sourceLeadId:null,content};
 const proposedContent={...content,lines:[content.lines[0]!,{...content.lines[1]!,grossCents:'25001'},content.lines[3]!,content.lines[4]!,{...content.lines[0]!,id:randomUUID(),description:'Added inspection',grossCents:'3550'}]};
 return {f,before,input:{schemaVersion:1,businessId:f.business,familyId:f.family.id,parent,proposedContent}};
}
it('labels actual retained, changed, added, removed and reordered work from stable source identities',async()=>{
 const {input,before}=fixture(),comparison=await prepareQuoteAmendmentComparison(input),after=prepareVersionedQuoteContent(input.proposedContent);
 const html=renderToStaticMarkup(createElement(AmendmentScopeOverview,{comparison:comparison.customer,original:before.customer,after:after.customer.lines,accepted:false}));
 for(const [label,count]of [['Retained',1],['Changed',1],['Added',1],['Removed',1],['Reordered',2]])expect(html).toContain('<dt>'+label+'</dt><dd>'+count+'</dd>');
 const [original,proposed]=html.split('aria-label="Proposed scope"');
 if(proposed===undefined)throw Error('PROPOSED_SCOPE_REQUIRED');
 expect(original).toContain('Removed coating');expect(original).not.toContain('Added inspection');expect(proposed).toContain('Added inspection');expect(proposed.split('</ul>')[0]).not.toContain('Removed coating');
 expect(original).toContain('$100.01');expect(proposed).toContain('$250.01');expect(proposed).toContain('$35.50');
 expect(html).toContain('Agreement 7');expect(html).toContain('Agreement 8');expect(html).toContain('original agreement remains in effect');
});
it('keeps duplicate descriptions distinct and excludes private source fields without changing input snapshots',async()=>{
 const {input,before,f}=fixture();input.proposedContent.lines=input.parent.content.lines.map(line=>({...line}));input.proposedContent.lines[1]!.description=input.proposedContent.lines[0]!.description;const snapshot=structuredClone(input),comparison=await prepareQuoteAmendmentComparison(input),after=prepareVersionedQuoteContent(input.proposedContent);
 const html=renderToStaticMarkup(createElement(AmendmentScopeOverview,{comparison:comparison.customer,original:before.customer,after:after.customer.lines,accepted:false}));
 expect(html).toContain('<dt>Retained</dt><dd>4</dd>');expect(html).toContain('<dt>Changed</dt><dd>1</dd>');
 for(const secret of [f.business,f.family.id,f.input.internalNotes!,input.parent.agreementId,input.parent.revisionId,...input.parent.content.lines.map(line=>line.id)])expect(html).not.toContain(secret);
 expect(html).not.toMatch(/<(button|input|form|script)\b/);expect(input).toEqual(snapshot);
});
it('describes an accepted change using its own original agreement without proposing another change',async()=>{
 const {input,before}=fixture(),comparison=await prepareQuoteAmendmentComparison(input),after=prepareVersionedQuoteContent(input.proposedContent);
 const html=renderToStaticMarkup(createElement(AmendmentScopeOverview,{comparison:comparison.customer,original:before.customer,after:after.customer.lines,accepted:true}));
 expect(html).toContain('Accepted change');expect(html).toContain('Original');expect(html).toContain('Agreement 7');expect(html).toContain('earlier agreement stays in history');expect(html).not.toContain('Proposed scope');expect(html).not.toContain('until this proposal');
});
it('retains the complete original accepted document with a version-specific accessible identity',async()=>{
 const {input,before}=fixture();input.proposedContent.title='Synthetic separately proposed title';const comparison=await prepareQuoteAmendmentComparison(input),after=prepareVersionedQuoteContent(input.proposedContent);
 const html=renderToStaticMarkup(createElement(AmendmentScopeOverview,{comparison:comparison.customer,original:before.customer,after:after.customer.lines,accepted:true}));
 for(const value of ['Read original agreement · version 7','Original agreement 7 · Quote recipient','Original agreement 7 · Quoted scope',before.customer.title,before.customer.recipient.displayName,before.customer.workLocation,before.customer.lines[0]!.inclusions,before.customer.lines[0]!.exclusions])expect(html).toContain(value);
 expect(html).not.toContain(input.proposedContent.title);expect(html).not.toContain('Original agreement 8');
});
it('distinguishes proposed and accepted cancellation with explicitly empty resulting work',async()=>{
 const {input,before}=fixture(),cancel={...input.proposedContent,schemaVersion:3,purpose:'cancel_all_remaining_scope',cancellationReason:'Synthetic customer cancels remaining work.',lines:[],proposedSchedule:null,documentDiscount:null},comparison=await prepareQuoteCancellationComparison({...input,proposedContent:cancel}),after=prepareQuoteCancellationContent(cancel);
 for(const accepted of [false,true]){const html=renderToStaticMarkup(createElement(AmendmentScopeOverview,{comparison:comparison.customer,original:before.customer,after:after.customer.lines,accepted}));expect(html).toContain(accepted?'Authorization withdrawn':'Proposed withdrawal');expect(html).toContain(accepted?'No work remains in this accepted change.':'No work remains in this proposal.');expect(html).toContain('<dt>Retained</dt><dd>0</dd>');expect(html.split('class="amendment-original-document"')[0]).not.toMatch(/refund|paid|invoice/i);}
});
