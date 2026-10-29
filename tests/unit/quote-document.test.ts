import {randomUUID} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {prepareQuoteContent} from '../../src/commercial/quote-content';
import type {QuoteContentInput,QuoteContentLine} from '../../src/commercial/quote-content';
import {QuoteDocument} from '../../src/app/quotes/quote-document';
import type {QuoteDocumentContent} from '../../src/app/quotes/quote-document';
const line=(grossCents:string):QuoteContentLine=>({id:randomUUID(),vehicleId:randomUUID(),jobWide:false,vehicleLabel:'Synthetic SUV',serviceVersionId:randomUUID(),description:'Interior detail',inclusions:'Vacuum and applicable leather care',exclusions:'Exterior protection',condition:'Moderate',grossCents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null});
const draft=():QuoteContentInput=>({schemaVersion:1,title:'Synthetic quote',recipient:{customerId:randomUUID(),leadId:null,displayName:'Synthetic Jordan Avery',phone:'(317) 555-0100',email:'synthetic@example.com'},workLocation:'Synthetic workshop\nUse the side entrance',terms:'Synthetic scope terms',timezone:'America/Indianapolis',expiryAt:null,proposedSchedule:null,internalNotes:'PRIVATE_SYNTHETIC_COST_ASSUMPTION',documentDiscount:{kind:'fixed',cents:'2500'},lines:[line('25000'),line('30000')]});
const render=(quote:QuoteDocumentContent)=>renderToStaticMarkup(createElement(QuoteDocument,{quote}));
it('renders only prepared customer content, labels the draft honestly and exposes no actions or source IDs',()=>{
 const input=draft(),prepared=prepareQuoteContent(input),html=render(prepared.customer);
 for(const text of ['Synthetic Jordan Avery','(317) 555-0100','synthetic@example.com','Use the side entrance','Draft','Not sent or accepted','$525.00','$11.36','$13.64','$238.64','$286.36'])expect(html).toContain(text);
 for(const privateValue of [input.internalNotes!,input.recipient.customerId!,...input.lines.flatMap(row=>[row.id,row.vehicleId!,row.serviceVersionId!])])expect(html).not.toContain(privateValue);
 expect(html).not.toMatch(/<(button|input|form)\b|<script\b|https?:\/\//);expect(html).toContain('<article');expect(html).toContain('<ol');expect(html).toContain('<dl');
 // Compile-time boundary: a whole prepared value has no public document shape.
 const privateDocument=()=>{
  // @ts-expect-error only the customer projection may be supplied
  return createElement(QuoteDocument,{quote:prepared});
 };
 expect(()=>renderToStaticMarkup(privateDocument())).toThrow('QUOTE_DOCUMENT_CUSTOMER_PROJECTION_REQUIRED');
});
it('refuses accidental private properties at document, recipient or line boundaries',()=>{
 const prepared=prepareQuoteContent(draft()),publicQuote=prepared.customer;
 for(const mixed of [{...publicQuote,internal:prepared.internal},{...publicQuote,recipient:{...publicQuote.recipient,customerId:prepared.internal.customerId}},{...publicQuote,lines:publicQuote.lines.map((row,index)=>index===0?{...row,serviceVersionId:prepared.internal.sources[0]!.serviceVersionId}:row)}]){
  expect(()=>render(mixed as QuoteDocumentContent)).toThrow('QUOTE_DOCUMENT_CUSTOMER_PROJECTION_REQUIRED');
 }
});
it('retains long Unicode scope, explicit job-wide work, exclusions and safe literal markup without truncation',()=>{
 const input=draft(),long='Synthetic é 😀 scope\n'.repeat(100),literal='<script>synthetic()</script> & exact';
 const quote=prepareQuoteContent({...input,terms:long,lines:[{...input.lines[0]!,vehicleId:null,jobWide:true,vehicleLabel:null,description:'Synthetic job-wide scope',inclusions:long,exclusions:literal},input.lines[1]!]}).customer,html=render(quote);
 expect(html).toContain(long);expect(html).toContain('Job-wide scope');expect(html).toContain('Synthetic SUV');expect(html).toContain('Moderate condition');expect(html).toContain('&lt;script&gt;synthetic()&lt;/script&gt; &amp; exact');expect(html).not.toContain('<script>');
});
it('omits absent contact, terms, discount and timing sections rather than inventing values',()=>{
 const input=draft(),html=render(prepareQuoteContent({...input,recipient:{...input.recipient,phone:null,email:null},terms:'',documentDiscount:null,lines:[input.lines[0]!]}).customer);
 for(const absent of ['<dt>Phone</dt>','<dt>Email</dt>','aria-label="Quote terms"','aria-label="Quote expiry"','Tentative schedule proposal','Quote-wide discount','<time'])expect(html).not.toContain(absent);
 expect(html).toContain('$250.00');expect(html).not.toContain('Paid');expect(html).not.toContain('confirmed appointment');
});
it('shows exact percentage discounts and complimentary reasons without inferring payment',()=>{
 const input=draft(),percent=render(prepareQuoteContent({...input,documentDiscount:{kind:'percent',rate:'0.12345678'},lines:[{...input.lines[0]!,grossCents:'10000',lineDiscount:{kind:'percent',rate:'0.1'}}]}).customer);
 expect(percent).toContain('Line discount (10%)');expect(percent).toContain('Quote-wide discount (12.345678%)');expect(percent).toContain('$10.00');expect(percent).toContain('$11.11');expect(percent).toContain('$78.89');
 const free=render(prepareQuoteContent({...input,documentDiscount:null,lines:[{...input.lines[0]!,grossCents:'0',complimentaryReason:'Synthetic goodwill é'}]}).customer);
 expect(free).toContain('Complimentary work: Synthetic goodwill é');expect(free).toContain('$0.00');expect(free).not.toContain('Paid');expect(free).not.toContain('Payment received');
 const large=render(prepareQuoteContent({...input,documentDiscount:null,lines:[{...input.lines[0]!,grossCents:'9223372036854775807'}]}).customer);expect(large).toContain('$92,233,720,368,547,758.07');
});
it('labels proposed scheduling as tentative and preserves precise expiry alongside its named timezone',()=>{
 const expiryAt='2026-10-29T01:02:03.123456Z',html=render(prepareQuoteContent({...draft(),expiryAt,proposedSchedule:'Thursday afternoon <tentative>'}).customer);
 expect(html).toContain('Proposed timing · tentative');expect(html).toContain('not a confirmed appointment');expect(html).toContain('Thursday afternoon &lt;tentative&gt;');expect(html).toContain('Oct 28, 2026');expect(html).toContain('America/Indianapolis');expect(html).toContain('Exact expiry time');expect(html).toContain('dateTime="'+expiryAt+'"');expect(html).toContain(expiryAt+'</time> (UTC)');
});

it.each([['sent','Shared','Awaiting customer acceptance'],['accepted','Accepted','Customer agreement recorded'],['superseded','Superseded','Retained earlier offer']] as const)('labels retained %s customer content without inferring payment or exposing private sources',(stage,label,detail)=>{
 const input=draft(),prepared=prepareQuoteContent(input),html=renderToStaticMarkup(createElement(QuoteDocument,{quote:prepared.customer,stage}));
 expect(html).toContain(label);expect(html).toContain(detail);expect(html).not.toContain('Not sent or accepted');expect(html).not.toContain(input.internalNotes!);expect(html).not.toContain(input.recipient.customerId!);expect(html).not.toMatch(/<(button|input|form)\b|Payment received|Paid in full/);
});
