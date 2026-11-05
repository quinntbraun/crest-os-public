'use client';
import {useEffect,useState} from 'react';
import {calculateQuote,quoteDollarsInput,quotePercentInput,quoteMoney,QuotePricingError} from '../../commercial/quote-pricing';
import type {QuoteDiscount} from '../../commercial/quote-pricing';
import {initialVehicleCategories,initialConditionClasses} from '../../commercial/catalog-options';
import {ServiceEditor} from './service-editor';
import {snapshotServiceForQuote} from '../../commercial/service-catalog';
import type {CatalogService,ServiceQuoteSnapshot} from '../../commercial/service-catalog';
type DiscountKind='none'|'fixed'|'percent';
type DraftLine={id:string;description:string;exclusions:string;amount:string;kind:DiscountKind;discount:string;eligible:boolean;reason:string;category:string;condition:string;service:ServiceQuoteSnapshot|null};
const emptyLine=():DraftLine=>({id:crypto.randomUUID(),description:'',exclusions:'',amount:'',kind:'none',discount:'',eligible:true,reason:'',category:'',condition:'',service:null});
function enteredDiscount(kind:DiscountKind,value:string):QuoteDiscount|null{return kind==='none'?null:kind==='fixed'?{kind:'fixed',cents:quoteDollarsInput(value)}:{kind:'percent',rate:quotePercentInput(value)};}
function DiscountFields({label,kind,value,change}:{label:string;kind:DiscountKind;value:string;change:(kind:DiscountKind,value:string)=>void}){
 return <><label>{label}<select aria-label={label} value={kind} onChange={e=>change(e.target.value as DiscountKind,'')}><option value="none">No discount</option><option value="fixed">Fixed amount (USD)</option><option value="percent">Percentage</option></select></label>{kind!=='none'&&<label>{label} value<input aria-label={label+' value'} inputMode="decimal" maxLength={24} placeholder={kind==='fixed'?'25.00':'10'} value={value} onChange={e=>change(kind,e.target.value)}/></label>}</>;
}
const errors:Record<string,string>={lines:'Add at least one line.',scope:'Describe the included work for every line.',amount:'Enter a valid dollar amount with at most two decimal places.',percentage:'Enter a percentage from 0 to 100, with at most six decimal places.',discount_exceeds_amount:'A discount exceeds its line amount or the eligible subtotal.',complimentary_reason:'Add a complimentary-work reason for each line reduced to $0.00.',total_overflow:'This amount exceeds the supported storage range.'};
export function QuoteWorksheet(){
 const [title,setTitle]=useState(''),[lines,setLines]=useState<DraftLine[]>([]),[kind,setKind]=useState<DiscountKind>('none'),[discount,setDiscount]=useState('');
 const [services,setServices]=useState<readonly CatalogService[]>([]),[serviceDirty,setServiceDirty]=useState(false),[libraryIssue,setLibraryIssue]=useState('');
 useEffect(()=>{if(!lines.length&&!title&&kind==='none'&&!discount&&!services.length&&!serviceDirty)return;const leave=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[lines.length,title,kind,discount,services.length,serviceDirty]);
 let result:ReturnType<typeof calculateQuote>|null=null,issue:QuotePricingError|null=null;
 try{result=calculateQuote(lines.map(row=>{if(!row.description.trim())throw new QuotePricingError('scope',row.id);return{id:row.id,grossCents:quoteDollarsInput(row.amount),lineDiscount:enteredDiscount(row.kind,row.discount),documentDiscountEligible:row.eligible,complimentaryReason:row.reason.trim()?row.reason:null};}),enteredDiscount(kind,discount));}catch(error){issue=error instanceof QuotePricingError?error:new QuotePricingError('amount');}
 const edit=(id:string,patch:Partial<DraftLine>)=>setLines(rows=>rows.map(row=>row.id===id?{...row,...patch}:row));
 function applyService(service:CatalogService){
  if(lines.length>=100){setLibraryIssue('This worksheet has reached its 100-line limit. No line was added.');return;}
  const snapshot=snapshotServiceForQuote(service,service.revision);
  setLines(rows=>[...rows,{...emptyLine(),description:snapshot.inclusions,exclusions:snapshot.exclusions,service:snapshot}]);setLibraryIssue('');
 }
 function sample(){
  if(lines.length&&!confirm('Replace this unsaved worksheet with fictional example amounts?'))return;
  setTitle('Fictional two-vehicle example');setLines([{...emptyLine(),description:'Interior detail — sample sedan; applicable leather care included',exclusions:'No exterior protection included.',category:'Sedan',condition:'Moderate',amount:'250.00'},{...emptyLine(),description:'Interior detail — sample SUV; applicable leather care included',exclusions:'No exterior protection included.',category:'SUV',condition:'Heavy',amount:'300.00'}]);setKind('fixed');setDiscount('25.00');
 }
 return <section aria-label="Quote worksheet" className="quote-worksheet">
  <p className="notice"><strong>Unsaved draft.</strong> This worksheet does not save, approve, send or accept a quote. Use fictional details in this review.</p>
  <p>Enter the all-in amount you want to offer for each scoped line. Catalog guidance and condition never add a charge automatically.</p>
  <button type="button" className="secondary" onClick={sample}>Load fictional pricing example</button>
  <ServiceEditor services={services} change={setServices} onApply={applyService} markDirty={()=>setServiceDirty(true)}/>
  {libraryIssue&&<p role="alert">{libraryIssue}</p>}
  {result&&<p><strong>Draft total: {quoteMoney(result.totalCents)}</strong> · <a href="#quote-preview">Review draft preview</a></p>}
  <form aria-label="Draft quote worksheet" onSubmit={e=>e.preventDefault()}>
   <label>Draft title<input aria-label="Draft title" maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   {lines.map((row,index)=><fieldset key={row.id}><legend>Line {index+1}</legend>
    {row.service&&<p className="field-help">Copied from {row.service.name} · {row.service.serviceCode} · Version {row.service.serviceVersion}. Changes to this service never replace this line. You can adapt the included work below.</p>}
    <label>Included work<textarea aria-label={'Line '+(index+1)+' included work'} rows={3} maxLength={4000} value={row.description} onChange={e=>edit(row.id,{description:e.target.value})}/></label>
    <label>Exclusions<textarea aria-label={'Line '+(index+1)+' exclusions'} rows={2} maxLength={4000} value={row.exclusions} onChange={e=>edit(row.id,{exclusions:e.target.value})}/></label>
    <label>Draft vehicle category<select aria-label={'Line '+(index+1)+' category'} value={row.category} onChange={e=>edit(row.id,{category:e.target.value})}><option value="">Not selected</option>{initialVehicleCategories.map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Draft condition<select aria-label={'Line '+(index+1)+' condition'} value={row.condition} onChange={e=>edit(row.id,{condition:e.target.value})}><option value="">Not assessed</option>{initialConditionClasses.map(value=><option key={value}>{value}</option>)}</select></label>
    {row.condition==='Extreme'&&<p className="notice">Extreme condition requires an owner review before an offer can be approved. It does not set a price or authorize hazardous work.</p>}
    <label>Owner's all-in amount (USD)<input aria-label={'Line '+(index+1)+' amount (USD)'} inputMode="decimal" maxLength={24} placeholder="Enter your amount" value={row.amount} onChange={e=>edit(row.id,{amount:e.target.value})}/></label>
    <DiscountFields label={'Line '+(index+1)+' discount'} kind={row.kind} value={row.discount} change={(kind,discount)=>edit(row.id,{kind,discount})}/>
    <label className="trust"><input type="checkbox" aria-label={'Line '+(index+1)+' eligible for quote discount'} checked={row.eligible} onChange={e=>edit(row.id,{eligible:e.target.checked})}/>Include this line in the quote-wide discount</label>
    {(issue?.lineId===row.id&&issue.code==='complimentary_reason'||row.reason||/^0(?:\.00?)?$/.test(row.amount.trim()))&&<label>Reason for complimentary work<textarea aria-label={'Line '+(index+1)+' complimentary reason'} rows={2} maxLength={1000} value={row.reason} onChange={e=>edit(row.id,{reason:e.target.value})}/></label>}
    <button type="button" className="secondary" onClick={()=>setLines(rows=>rows.filter(line=>line.id!==row.id))}>Remove line {index+1}</button>
   </fieldset>)}
   <button type="button" disabled={lines.length>=100} onClick={()=>setLines(rows=>[...rows,emptyLine()])}>Add quote line</button>
   {lines.length>=100&&<p className="field-help">This worksheet has reached its 100-line limit. No lines were dropped.</p>}
   <fieldset><legend>Quote-wide discount</legend><DiscountFields label="Quote discount" kind={kind} value={discount} change={(kind,value)=>{setKind(kind);setDiscount(value);}}/></fieldset>
  </form>
  {issue&&lines.length>0&&<p role="alert">{errors[issue.code]??'Review the line amounts and discounts.'}</p>}
  {result&&<section id="quote-preview" tabIndex={-1} aria-label="Draft quote preview"><h2>{title||'Draft quote'}</h2><p><strong>Draft total: {quoteMoney(result.totalCents)}</strong></p><p>Draft preview · USD · Not sent or accepted</p>
   <ol className="quote-preview-lines">{result.lines.map((price,i)=>{const row=lines[i]!;return <li key={price.id}><h3>{row.service?.name??row.description}</h3>{row.service&&<p className="service-text">{row.description}</p>}{(row.category||row.condition)&&<p>{[row.category,row.condition].filter(Boolean).join(' · ')}</p>}{row.exclusions&&<p className="service-text">Exclusions: {row.exclusions}</p>}<p>All-in amount: {quoteMoney(price.grossCents)} · Line discount: {quoteMoney(price.lineDiscountCents)} · Quote discount share: {quoteMoney(price.allocatedDiscountCents)}</p><strong>Line total: {quoteMoney(price.finalCents)}</strong>{price.complimentaryReason&&<p>Complimentary work: {price.complimentaryReason}</p>}</li>;})}</ol>
   <dl className="customer-values"><dt>Amount before discounts</dt><dd>{quoteMoney(result.grossCents)}</dd><dt>Line discounts</dt><dd>{quoteMoney(result.lineDiscountCents)}</dd><dt>Quote-wide discount</dt><dd>{quoteMoney(result.documentDiscountCents)}</dd><dt>Draft total</dt><dd><strong>{quoteMoney(result.totalCents)}</strong></dd></dl>
   <p>All-in draft amounts. Tax treatment is not configured here; this cannot issue an invoice.</p>
  </section>}
  <p className="field-help">This draft and service library stay in this page's memory. Leaving or refreshing clears them, and the sample download does not include them. Database catalog storage, exact-revision approval and acceptance are the next steps.</p>
 </section>;
}
