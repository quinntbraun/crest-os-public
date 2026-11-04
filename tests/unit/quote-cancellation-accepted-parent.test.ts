import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {cancellationAppFixture} from './quote-cancellation-app-fixture';
import {prepareQuoteAmendmentComparison} from '../../src/commercial/quote-amendment-comparison';
import {prepareQuoteCancellationComparison} from '../../src/commercial/quote-cancellation-comparison';
import {quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract';
import {QuoteAmendmentDocument} from '../../src/app/quotes/quote-amendment-document';
function fixture(){const f=cancellationAppFixture(),parent={agreementId:randomUUID(),versionNo:'2',revisionId:f.packet.revision.id,contentHash:createHash('sha256').update(f.p.canonical).digest('hex'),customerId:f.target.parent.customerId,sourceLeadId:f.target.parent.sourceLeadId,content:f.p.input},normal=quoteInputFromSnapshots(f.target.parent.revision.customer_safe_snapshot,f.target.parent.revision.internal_snapshot);return {f,parent,normal,input:{schemaVersion:1,businessId:f.request.businessId,familyId:f.request.familyId,parent,proposedContent:normal}};}
it('compares new paid and complimentary work against an exact accepted cancellation without inventing a zero-price service',async()=>{
 const x=fixture(),r=await prepareQuoteAmendmentComparison(x.input);expect(r.customer.previousTotalCents).toBe('0');expect(r.customer.revisedTotalCents).toBe(x.f.target.parent.revision.total_cents);expect(r.customer.signedDeltaCents).toBe(r.customer.revisedTotalCents);expect(r.customer.lineChanges.every(c=>c.kind==='added'&&c.before===null)).toBe(true);expect(r.customer.lineChanges).toHaveLength(x.normal.lines.length);expect(r.customer.headerChanges).toContainEqual({field:'cancellationReason',before:x.f.p.customer.cancellationReason,after:null});expect(r.internal.expectedAcceptedHash).toBe(x.parent.contentHash);expect(JSON.stringify(r.customer)).not.toContain(x.f.p.internal.notes!);const html=renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison:r.customer}));expect(html).toContain('Cancellation reason');expect(html).toContain(x.f.p.customer.cancellationReason);
});
it('compares a separately proposed reason change against accepted zero scope and preserves both reasons',async()=>{
 const x=fixture(),r=await prepareQuoteCancellationComparison({...x.input,proposedContent:{...x.f.p.input,cancellationReason:'Separately confirmed revised synthetic wording.'}});expect(r.customer.schemaVersion).toBe(3);expect(()=>renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison:{...r.customer,schemaVersion:2}}))).toThrow('QUOTE_AMENDMENT_CUSTOMER_PROJECTION_REQUIRED');expect(r.customer.signedDeltaCents).toBe('0');expect(r.customer.lineChanges).toEqual([]);expect(r.customer.headerChanges).toContainEqual({field:'cancellationReason',before:x.f.p.customer.cancellationReason,after:'Separately confirmed revised synthetic wording.'});expect(r.hasCustomerChanges).toBe(true);expect(renderToStaticMarkup(createElement(QuoteAmendmentDocument,{comparison:r.customer}))).toContain('Separately confirmed revised synthetic wording.');
});
it('refuses a substituted cancellation parent or an ordinary empty quote',async()=>{
 const x=fixture();await expect(prepareQuoteAmendmentComparison({...x.input,parent:{...x.parent,contentHash:'0'.repeat(64)}})).rejects.toThrow();await expect(prepareQuoteAmendmentComparison({...x.input,proposedContent:{...x.normal,lines:[]}})).rejects.toThrow();expect(()=>quoteInputFromSnapshots(x.f.p.customer,x.f.p.internal)).toThrow();
});
it('seals the accepted cancellation and proposed work before hashing yields',async()=>{
 const x=fixture(),input=structuredClone(x.input),pending=prepareQuoteAmendmentComparison(input);Object.assign(input.parent.content,{cancellationReason:'PRIVATE_CHANGED_AFTER_HASH'});Object.assign(input.proposedContent.recipient,{displayName:'PRIVATE_CHANGED_RECIPIENT'});const r=await pending;expect(JSON.stringify(r)).not.toMatch(/PRIVATE_CHANGED/);expect(r.internal.expectedAcceptedHash).toBe(x.parent.contentHash);
});
