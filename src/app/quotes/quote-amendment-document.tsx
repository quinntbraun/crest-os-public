import {useId} from 'react';
import {exactCustomerObject as exact,customerInstant} from '../../customer/customer-contract';
import {quoteVersion} from '../../commercial/quote-storage-contract';
import {quoteMoney} from '../../commercial/quote-pricing';
import {phonePresentation} from '../../client/phone-presentation';
import type {QuoteAmendmentCustomerComparison} from '../../commercial/quote-amendment-comparison';
import type {prepareQuoteCancellationComparison} from '../../commercial/quote-cancellation-comparison';

type Comparison=QuoteAmendmentCustomerComparison|Awaited<ReturnType<typeof prepareQuoteCancellationComparison>>['customer'];
type Line=NonNullable<Comparison['lineChanges'][number]['before']>;
const rootKeys=['schemaVersion','currency','previousAgreementVersion','proposedAgreementVersion','previousTotalCents','revisedTotalCents','signedDeltaCents','headerChanges','lineChanges'];
const headerLabels={title:'Title',recipient:'Customer contact',workLocation:'Work location',terms:'Terms',timezone:'Business time zone',expiryAt:'Expiry',proposedSchedule:'Proposed timing',documentDiscount:'Quote-wide discount',cancellationReason:'Cancellation reason'} as const;
const lineKeys=['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'];
const invalid=():never=>{throw Error('QUOTE_AMENDMENT_CUSTOMER_PROJECTION_REQUIRED');};
function requireSafe(value:unknown):asserts value{if(!value)invalid();}
const optional=(value:unknown)=>value===null||typeof value==='string';
function discount(value:unknown){return value===null||exact(value,['kind','cents'])&&value.kind==='fixed'&&quoteVersion(value.cents,true)||exact(value,['kind','rate'])&&value.kind==='percent'&&typeof value.rate==='string'&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.rate);}
function line(value:unknown){
 requireSafe(exact(value,lineKeys)||exact(value,[...lineKeys,'category']));
 requireSafe(['description','inclusions','exclusions'].every(key=>typeof value[key]==='string')&&['vehicle','condition','complimentaryReason'].every(key=>optional(value[key]))&&(!('category'in value)||optional(value.category))&&typeof value.documentDiscountEligible==='boolean'&&discount(value.lineDiscount));
 for(const key of ['grossCents','lineDiscountCents','allocatedDiscountCents','finalCents'])requireSafe(quoteVersion(value[key],true));
 requireSafe(BigInt(value.grossCents as string)-BigInt(value.lineDiscountCents as string)-BigInt(value.allocatedDiscountCents as string)===BigInt(value.finalCents as string));
}
function headerValue(field:keyof typeof headerLabels,value:unknown){
 if(field==='recipient')requireSafe(exact(value,['displayName','phone','email'])&&typeof value.displayName==='string'&&optional(value.phone)&&optional(value.email));
 else if(field==='documentDiscount')requireSafe(discount(value));
 else if(field==='expiryAt')requireSafe(value===null||customerInstant(value));
 else if(field==='proposedSchedule'||field==='cancellationReason')requireSafe(optional(value));
 else requireSafe(typeof value==='string');
}
function validate(supplied:unknown):asserts supplied is Comparison{
 const cancellation=!!supplied&&typeof supplied==='object'&&'schemaVersion'in supplied&&(supplied.schemaVersion===2||supplied.schemaVersion===3);
 requireSafe(exact(supplied,cancellation?[...rootKeys,'purpose','cancellationReason']:rootKeys)&&(cancellation||supplied.schemaVersion===1)&&supplied.currency==='USD'&&quoteVersion(supplied.previousAgreementVersion)&&quoteVersion(supplied.proposedAgreementVersion)&&quoteVersion(supplied.previousTotalCents,true)&&quoteVersion(supplied.revisedTotalCents,true));
 requireSafe(BigInt(supplied.proposedAgreementVersion as string)===BigInt(supplied.previousAgreementVersion as string)+1n&&typeof supplied.signedDeltaCents==='string'&&/^(?:0|-?[1-9][0-9]*)$/.test(supplied.signedDeltaCents)&&BigInt(supplied.signedDeltaCents)===BigInt(supplied.revisedTotalCents as string)-BigInt(supplied.previousTotalCents as string));
 requireSafe(Array.isArray(supplied.headerChanges)&&supplied.headerChanges.length<=Object.keys(headerLabels).length&&Array.isArray(supplied.lineChanges)&&supplied.lineChanges.length<=2000);
 if(cancellation)requireSafe(supplied.purpose==='cancel_all_remaining_scope'&&typeof supplied.cancellationReason==='string'&&supplied.cancellationReason.trim().length>0&&[...supplied.cancellationReason].length<=2000&&supplied.revisedTotalCents==='0'&&(supplied.schemaVersion===2?supplied.lineChanges.length>0:supplied.previousTotalCents==='0'&&supplied.signedDeltaCents==='0'&&supplied.lineChanges.length===0)&&supplied.lineChanges.every(c=>!!c&&typeof c==='object'&&'kind'in c&&c.kind==='removed'));
 const fields=new Set<string>();for(const change of supplied.headerChanges){requireSafe(exact(change,['field','before','after'])&&typeof change.field==='string'&&Object.hasOwn(headerLabels,change.field)&&!fields.has(change.field));fields.add(change.field);headerValue(change.field as keyof typeof headerLabels,change.before);headerValue(change.field as keyof typeof headerLabels,change.after);}
 let delta=0n;const beforePositions=new Set<number>(),afterPositions=new Set<number>();
 for(const change of supplied.lineChanges){
  requireSafe(exact(change,['kind','beforePosition','afterPosition','before','after'])&&['added','removed','changed','moved'].includes(change.kind as string));
  for(const [side,positions]of [['before',beforePositions],['after',afterPositions]] as const){const position=change[side+'Position'];if(change[side]===null)requireSafe(position===null);else{requireSafe(typeof position==='number'&&Number.isInteger(position)&&position>=1&&position<=1000&&!positions.has(position));positions.add(position);line(change[side]);}}
  requireSafe(change.kind==='added'?change.before===null&&change.after!==null:change.kind==='removed'?change.before!==null&&change.after===null:change.before!==null&&change.after!==null);
  if(change.kind==='moved'){const before=change.before as Line,after=change.after as Line;requireSafe(change.beforePosition!==change.afterPosition&&JSON.stringify([...lineKeys.map(key=>(before as unknown as Record<string,unknown>)[key]),'category'in before?before.category:null])===JSON.stringify([...lineKeys.map(key=>(after as unknown as Record<string,unknown>)[key]),'category'in after?after.category:null]));}
  const before=change.before as Line|null,after=change.after as Line|null;delta+=BigInt(after?.finalCents??'0')-BigInt(before?.finalCents??'0');
 }
 requireSafe(delta===BigInt(supplied.signedDeltaCents));
}
function moneyChange(value:string){return value==='0'?'No price change':(value.startsWith('-')?'Decrease of ':'Increase of ')+quoteMoney(value.startsWith('-')?value.slice(1):value);}
function discountText(value:Line['lineDiscount']){return value===null?'No discount':value.kind==='fixed'?quoteMoney(value.cents):value.rate+'%';}
function HeaderValue({field,value}:{field:keyof typeof headerLabels;value:unknown}){
 if(field==='recipient'){const recipient=value as {displayName:string;phone:string|null;email:string|null};return <><p className="service-scope">{recipient.displayName}</p>{recipient.phone!==null&&<p>{phonePresentation(recipient.phone)}</p>}{recipient.email!==null&&<p className="service-scope">{recipient.email}</p>}</>;}
 if(field==='documentDiscount')return <p>{discountText(value as Line['lineDiscount'])}</p>;
 if(field==='expiryAt')return <p>{value===null?'No expiry':<><time dateTime={value as string}>{value as string}</time> · UTC</>}</p>;
 return <p className="service-scope">{value===null||value===''?'Not provided':value as string}</p>;
}
function Scope({value}:{value:Line|null}){return value===null?<p>Not included</p>:<>
 <p className="service-scope"><strong>{value.description}</strong></p><p className="service-scope">{value.vehicle??'Job-wide scope'}{'category'in value&&value.category!==null?' · '+value.category:''}{value.condition!==null?' · '+value.condition:''}</p>
 {value.inclusions!==''&&<><p><strong>Includes</strong></p><p className="service-scope">{value.inclusions}</p></>}{value.exclusions!==''&&<><p><strong>Excludes</strong></p><p className="service-scope">{value.exclusions}</p></>}
 <dl className="customer-values"><dt>Amount before discounts</dt><dd>{quoteMoney(value.grossCents)}</dd>{value.lineDiscount!==null&&<><dt>Line discount ({discountText(value.lineDiscount)})</dt><dd>{quoteMoney(value.lineDiscountCents)}</dd></>}{value.allocatedDiscountCents!=='0'&&<><dt>Quote discount share</dt><dd>{quoteMoney(value.allocatedDiscountCents)}</dd></>}<dt>Line total</dt><dd><strong>{quoteMoney(value.finalCents)}</strong></dd></dl>
 {value.complimentaryReason!==null&&<p className="service-scope">Complimentary-work note: {value.complimentaryReason}</p>}
 </>;}

/** Prepared customer comparison only; no authority, persistence or acceptance.
 * Deliberately refuse a whole comparison or extra private recipient/line data. */
export function QuoteAmendmentDocument({comparison,accepted=false}:{comparison:Comparison;accepted?:boolean}){
 const title=useId();validate(comparison);requireSafe(typeof accepted==='boolean');
 return <article className="quote-worksheet quote-amendment" aria-labelledby={title}>
  <header><p className="eyebrow">Crest Detailing</p><h2 id={title}>{accepted?(comparison.schemaVersion!==1?'Accepted cancellation of remaining work':'Accepted change to work'):comparison.schemaVersion!==1?'Proposed cancellation of remaining work':'Proposed change to accepted work'}</h2><p>{accepted?'This change is accepted. The earlier agreement and its recorded history remain available.':'Your accepted agreement remains in effect until this change is separately accepted.'}</p></header>
  {comparison.schemaVersion!==1&&<section aria-label="Cancellation reason"><h3>Reason</h3><p className="service-scope">{comparison.cancellationReason}</p></section>}
  <section aria-label={accepted?'Accepted price change':'Proposed price change'}><h3>{moneyChange(comparison.signedDeltaCents)}</h3><dl className="customer-values"><dt>{accepted?'Earlier accepted total · version ':'Accepted total · version '}{comparison.previousAgreementVersion}</dt><dd>{quoteMoney(comparison.previousTotalCents)}</dd><dt>{accepted?(comparison.schemaVersion!==1?'Accepted remaining total · version ':'Accepted total · version '):'Proposed total · version '}{comparison.proposedAgreementVersion}</dt><dd><strong>{quoteMoney(comparison.revisedTotalCents)}</strong></dd></dl><p className="field-help">USD · All-in quoted amounts. This comparison records no invoice, payment or refund.</p></section>
  {comparison.lineChanges.length===0&&comparison.headerChanges.length===0?<p>No customer-facing scope, terms or price changes.</p>:<>
   {comparison.headerChanges.length>0&&<section aria-label="Changed quote details"><h3>Details and terms</h3>{comparison.headerChanges.map(change=><details key={change.field}><summary>{headerLabels[change.field]} changed</summary><div className="amendment-comparison"><section aria-label={(accepted?'Earlier accepted ':'Accepted ')+headerLabels[change.field]}><h4>{accepted?'Earlier accepted':'Accepted'}</h4><HeaderValue field={change.field} value={change.before}/></section><section aria-label={(accepted?'Accepted ':'Proposed ')+headerLabels[change.field]}><h4>{accepted?'Accepted':'Proposed'}</h4><HeaderValue field={change.field} value={change.after}/></section></div></details>)}</section>}
   {comparison.lineChanges.length>0&&<section aria-label="Changed work"><h3>Work changes</h3><ol className="quote-preview-lines">{comparison.lineChanges.map((change,index)=><li key={index}><details><summary>{change.kind==='added'?'Added':change.kind==='removed'?'Removed':change.kind==='moved'?'Reordered':'Changed'} · {change.after?.description??change.before!.description}</summary>{change.kind==='moved'&&<p>Line {change.beforePosition} → {change.afterPosition}. Price and scope stay the same.</p>}<div className="amendment-comparison"><section aria-label={accepted?'Earlier accepted work':'Accepted work'}><h4>{accepted?'Earlier accepted':'Accepted'}</h4><Scope value={change.before}/></section><section aria-label={accepted?'Accepted work':'Proposed work'}><h4>{accepted?'Accepted':'Proposed'}</h4><Scope value={change.after}/></section></div></details></li>)}</ol></section>}
  </>}
 </article>;
}
