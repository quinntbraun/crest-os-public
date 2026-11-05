import {useId} from 'react';
import type {prepareVersionedQuoteContent as prepareQuoteContent} from '../../commercial/quote-review-content';
import {phonePresentation} from '../../client/phone-presentation';
import {quoteMoney} from '../../commercial/quote-pricing';
import type {QuoteDiscount} from '../../commercial/quote-pricing';
import type {prepareQuoteCancellationContent} from '../../commercial/quote-cancellation-content';

type Cancellation=ReturnType<typeof prepareQuoteCancellationContent>['customer'];
export type QuoteDocumentContent=ReturnType<typeof prepareQuoteContent>['customer']|Cancellation;
type Props=Readonly<{quote:QuoteDocumentContent;stage?:'draft'|'review'|'approved'|'sent'|'accepted'|'superseded'}>;
const invalid=():never=>{throw Error('QUOTE_DOCUMENT_CUSTOMER_PROJECTION_REQUIRED');};
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
const text=(value:unknown):string=>typeof value==='string'?value:invalid();
const rootKeys=['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents'] as const;
const lineKeys=['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'] as const;
function discountDescription(discount:QuoteDiscount):string{
 if(discount.kind==='fixed')return quoteMoney(discount.cents);
 const [whole,fraction='']=discount.rate.split('.'),units=BigInt(whole!)*100000000n+BigInt(fraction.padEnd(8,'0'));
 const decimals=(units%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
 return (units/1000000n).toString()+(decimals?'.'+decimals:'')+'%';
}

/** Only a prepared customer projection belongs here. This component grants no
 * access and performs no persistence, approval, delivery or financial action. */
export function QuoteDocument({quote,stage='draft'}:Props){
 const titleId=useId();
 if(quote.schemaVersion===3)return <CancellationDocument quote={quote} stage={stage} titleId={titleId}/>;
 // Fail closed on an accidentally supplied whole/private value. Rendering also
 // names every field explicitly rather than serializing unknown properties.
 const supplied:unknown=quote;
 if(!exact(supplied,rootKeys)||![1,2].includes(supplied.schemaVersion as number)||!exact(supplied.recipient,['displayName','phone','email'])||!Array.isArray(supplied.lines)||!supplied.lines.every(line=>exact(line,supplied.schemaVersion===1?lineKeys:[...lineKeys,'category'])))return invalid();
 const expiry=quote.expiryAt===null?null:new Intl.DateTimeFormat('en-US',{timeZone:quote.timezone,dateStyle:'medium',timeStyle:'long'}).format(new Date(quote.expiryAt));
 return <article className="quote-worksheet" aria-labelledby={titleId}>
  <header><p className="eyebrow">Crest Detailing</p><h2 id={titleId}>{quote.title}</h2><p className="notice"><strong>{stage==='accepted'?'Accepted':stage==='sent'?'Shared':stage==='superseded'?'Superseded':stage==='approved'?'Approved':stage==='review'?'Ready for review':'Draft'}</strong> · {stage==='accepted'?'Customer agreement recorded':stage==='sent'?'Awaiting customer acceptance':stage==='superseded'?'Retained earlier offer':'Not sent or accepted'}</p><p>USD · All-in quoted amounts</p></header>
  <section aria-label="Quote recipient"><h3>Prepared for</h3><p className="service-scope">{quote.recipient.displayName}</p>
   {(quote.recipient.phone!==null||quote.recipient.email!==null)&&<dl className="customer-values">
    {quote.recipient.phone!==null&&<><dt>Phone</dt><dd className="service-scope">{phonePresentation(quote.recipient.phone)}</dd></>}
    {quote.recipient.email!==null&&<><dt>Email</dt><dd className="service-scope">{quote.recipient.email}</dd></>}
   </dl>}
  </section>
  <section aria-label="Quoted work location"><h3>Work location</h3><p className="service-scope">{quote.workLocation}</p></section>
  <section aria-label="Quoted scope"><h3>Quoted work</h3><ol className="quote-preview-lines">{quote.lines.map((line,index)=><li key={index}>
   <h4 className="service-scope">{text(line.description)}</h4><p className="service-scope">{line.vehicle===null?'Job-wide scope':text(line.vehicle)}{'category' in line&&line.category!==null?' · '+text(line.category):''}{line.condition!==null?' · '+text(line.condition)+' condition':''}</p>
   {text(line.inclusions).length>0&&<><p><strong>Included work</strong></p><p className="service-scope">{text(line.inclusions)}</p></>}
   {text(line.exclusions).length>0&&<><p><strong>Exclusions</strong></p><p className="service-scope">{text(line.exclusions)}</p></>}
   <dl className="customer-values"><dt>All-in amount</dt><dd className="record-reference">{quoteMoney(line.grossCents)}</dd>
    {line.lineDiscount!==null&&<><dt>Line discount ({discountDescription(line.lineDiscount)})</dt><dd className="record-reference">{quoteMoney(line.lineDiscountCents)}</dd></>}
    {quote.documentDiscount!==null&&<><dt>Quote discount share</dt><dd className="record-reference">{quoteMoney(line.allocatedDiscountCents)}</dd></>}
    <dt>Line total</dt><dd className="record-reference"><strong>{quoteMoney(line.finalCents)}</strong></dd>
   </dl>
   {quote.documentDiscount!==null&&!line.documentDiscountEligible&&<p className="field-help">Excluded from the quote-wide discount.</p>}
   {line.complimentaryReason!==null&&<p className="service-scope">{line.finalCents==='0'?'Complimentary work: ':'Complimentary-work note: '}{line.complimentaryReason}</p>}
  </li>)}</ol></section>
  <section aria-label="Quote total"><h3>Quote total</h3><dl className="customer-values">
   <dt>Amount before discounts</dt><dd className="record-reference">{quoteMoney(quote.grossCents)}</dd>
   {(quote.lineDiscountCents!=='0'||quote.lines.some(line=>line.lineDiscount!==null))&&<><dt>Line discounts</dt><dd className="record-reference">{quoteMoney(quote.lineDiscountCents)}</dd></>}
   {quote.documentDiscount!==null&&<><dt>Quote-wide discount ({discountDescription(quote.documentDiscount)})</dt><dd className="record-reference">{quoteMoney(quote.documentDiscountCents)}</dd></>}
   <dt>Total (USD)</dt><dd className="record-reference"><strong>{quoteMoney(quote.totalCents)}</strong></dd>
  </dl></section>
  {quote.terms.length>0&&<section aria-label="Quote terms"><h3>Terms</h3><p className="service-scope">{quote.terms}</p></section>}
  {quote.proposedSchedule!==null&&<section aria-label="Tentative schedule proposal"><h3>Proposed timing · tentative</h3><p className="service-scope">{quote.proposedSchedule}</p><p className="field-help">This proposal is not a confirmed appointment.</p></section>}
  {expiry!==null&&<section aria-label="Quote expiry"><h3>Expires</h3><p><time dateTime={quote.expiryAt!}>{expiry}</time> · <span className="service-scope">{quote.timezone}</span></p><details><summary>Exact expiry time</summary><p className="service-scope"><time dateTime={quote.expiryAt!}>{quote.expiryAt}</time> (UTC)</p></details></section>}
 </article>;
}
function CancellationDocument({quote,stage,titleId}:{quote:Cancellation;stage:NonNullable<Props['stage']>;titleId:string}){
 const supplied:unknown=quote;
 if(!exact(supplied,[...rootKeys,'purpose','cancellationReason'])||supplied.schemaVersion!==3||supplied.currency!=='USD'||supplied.purpose!=='cancel_all_remaining_scope'||!exact(supplied.recipient,['displayName','phone','email'])||typeof supplied.recipient.displayName!=='string'||!(supplied.recipient.phone===null||typeof supplied.recipient.phone==='string')||!(supplied.recipient.email===null||typeof supplied.recipient.email==='string')||!['title','workLocation','terms','timezone'].every(k=>typeof supplied[k]==='string')||!(supplied.expiryAt===null||typeof supplied.expiryAt==='string')||!Array.isArray(supplied.lines)||supplied.lines.length!==0||supplied.documentDiscount!==null||supplied.proposedSchedule!==null||!['grossCents','lineDiscountCents','documentDiscountCents','totalCents'].every(k=>supplied[k]==='0')||typeof supplied.cancellationReason!=='string'||!supplied.cancellationReason.trim()||[...supplied.cancellationReason].length>2000)return invalid();
 const phone=quote.recipient.phone===null?null:phonePresentation(quote.recipient.phone);
 return <article className="quote-worksheet quote-cancellation" aria-labelledby={titleId}><header><p className="eyebrow">Crest Detailing</p><h2 id={titleId}>{stage==='accepted'?'Accepted cancellation of remaining work':'Cancellation proposal'}</h2><p>{text(quote.title)}</p><p className="notice"><strong>{stage==='accepted'?'Accepted cancellation':stage==='sent'?'Shared proposal':stage==='superseded'?'Superseded proposal':stage==='approved'?'Owner-approved proposal':stage==='review'?'For owner review':'Draft proposal'}</strong></p></header><section aria-label="Cancellation reason"><h3>Reason</h3><p className="service-scope">{quote.cancellationReason}</p></section><dl className="customer-values"><dt>Customer</dt><dd>{text(quote.recipient.displayName)}</dd>{quote.recipient.phone!==null&&<><dt>Phone</dt><dd>{phone}</dd></>}{quote.recipient.email!==null&&<><dt>Email</dt><dd className="service-scope">{text(quote.recipient.email)}</dd></>}<dt>{stage==='accepted'?'Accepted remaining total':'Proposed remaining total'}</dt><dd><strong>{quoteMoney(quote.totalCents)}</strong></dd></dl>{quote.terms!==''&&<details><summary>Terms</summary><p className="service-scope">{text(quote.terms)}</p></details>}<p className="field-help">{stage==='accepted'?'This accepted change withdraws the remaining authorized work. It records no fee, credit or refund. Visits retain their recorded history.':'The existing agreement remains in effect until this proposal is separately accepted. Booked visits retain their recorded status.'}</p></article>;
}
