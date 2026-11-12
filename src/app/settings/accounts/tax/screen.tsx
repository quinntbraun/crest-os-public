'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent,RefObject} from 'react';
import {AuthenticationError,authentication} from '../../../../client/authentication';
import {services} from '../../../../client/services';
import {downloadFinanceHistory,financeAccounts} from '../../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../../client/finance-accounts';
import {financeTaxTreatmentLabels,parseFinanceTaxScope} from '../../../../bookkeeping/finance-tax-contract';
import {quoteDollarsInput,quoteMoney} from '../../../../commercial/quote-pricing';
import {customerDate} from '../../../../customer/customer-contract';
import styles from '../screen.module.css';
import {TaxApprovalEditor} from './approval';

type History=Awaited<ReturnType<typeof financeAccounts.taxHistory>>;
type Preview=Awaited<ReturnType<typeof financeAccounts.taxPreview>>;
type ServicePage=Awaited<ReturnType<typeof services.list>>;
type Applicability=''|'service'|'tip';
const initialMessage='Choose a jurisdiction and what to check.';
const subscribeToHydration=()=>()=>undefined;
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(date:string)=>dateFormat.format(new Date(date+'T00:00:00Z'));

function amountInput(gross:string,discount:string) {
 try {
  const grossCents=quoteDollarsInput(gross);
  const discountCents=discount.trim()===''?'0':quoteDollarsInput(discount);
  return BigInt(discountCents)<=BigInt(grossCents)?{grossCents,discountCents}:null;
 } catch {return null;}
}

export function FinanceTaxProfilesScreen(){
 const [jurisdiction,setJurisdiction]=useState(''),[applicability,setApplicability]=useState<Applicability>('');
 const [serviceId,setServiceId]=useState(''),[search,setSearch]=useState('');
 const [servicePage,setServicePage]=useState<ServicePage|null>(null);
 const [date,setDate]=useState(''),[gross,setGross]=useState(''),[discount,setDiscount]=useState('');
 const [history,setHistory]=useState<History|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [message,setMessage]=useState(initialMessage),[busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const mounted=useSyncExternalStore(subscribeToHydration,()=>true,()=>false);
 const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const serviceSelect=useRef<HTMLSelectElement>(null),historyHeading=useRef<HTMLHeadingElement>(null),resultHeading=useRef<HTMLHeadingElement>(null);
 const nextFocus=useRef<RefObject<HTMLElement|null>|null>(null);
 const controlsDisabled=!mounted||busy;

 const clearPrivate=useCallback(()=>{
  active.current?.abort();active.current=null;nextFocus.current=null;
  setJurisdiction('');setApplicability('');setServiceId('');setSearch('');setServicePage(null);
  setDate('');setGross('');setDiscount('');setHistory(null);setPreview(null);setSignedOut(false);setBusy(false);setMessage(initialMessage);
 },[]);
 useEffect(()=>{
  const visibility=()=>{if(document.visibilityState==='hidden')clearPrivate();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clearPrivate();};
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',clearPrivate);
  window.addEventListener('pageshow',restored);
  return()=>{
   active.current?.abort();active.current=null;
   document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('pagehide',clearPrivate);
   window.removeEventListener('pageshow',restored);
  };
 },[clearPrivate]);
 useEffect(()=>{
  if(!busy&&nextFocus.current){
   (nextFocus.current.current??status.current)?.focus();
   nextFocus.current=null;
  }
 },[busy]);

 async function run(work:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>){
  if(active.current)return;
  const controller=new AbortController(),signal=controller.signal;
  active.current=controller;nextFocus.current=status;setBusy(true);setSignedOut(false);setMessage('Checking saved tax profiles…');
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(!context.taxProfiles){setHistory(null);setPreview(null);setMessage('Tax profiles are unavailable in this workspace.');return;}
   await work(context,signal);
  }catch(error){
   if(signal.aborted)return;
   setHistory(null);setPreview(null);
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   if(denied)clearPrivate();
   setSignedOut(denied);setMessage(denied?'Sign in to check tax profiles.':'Crest could not verify this request. Try again.');
  }finally{
   if(active.current===controller){active.current=null;setBusy(false);}
  }
 }

 function resetResults(){
  setHistory(null);setPreview(null);setMessage(initialMessage);
 }
 function readScope(){
  try{return parseFinanceTaxScope({jurisdiction:jurisdiction.trim(),applicability,serviceId:applicability==='tip'?null:serviceId});}
  catch{return null;}
 }
 const scope=readScope(),amount=amountInput(gross,discount);

 function loadServices(more=false){
  if(applicability!=='service'||active.current)return;
  const previous=more?servicePage:null;
  const afterId=previous?.services.at(-1)?.service.id??null;
  void run(async(context,signal)=>{
   const proof=await authentication.session(signal);
   const result=await services.list(context.businessId,{search:search.trim(),afterId,includeInactive:true,pageSize:25},proof,signal);
   if(signal.aborted)return;
   setServicePage({...result,services:[...(previous?.services??[]),...result.services]});
   if(!previous){setServiceId('');setHistory(null);setPreview(null);}
   if(result.services.length&&!more)nextFocus.current=serviceSelect;
   setMessage(result.services.length?'Choose a saved service.':'No services matched.');
  });
 }
 function readHistory(more=false){
  if(!scope||active.current)return;
  const previous=more?history:null;
  setPreview(null);
  if(!previous)setHistory(null);
  void run(async(context,signal)=>{
   const result=await financeAccounts.taxHistory(context,scope,previous?.rows.at(-1)?.version??null,signal);
   if(signal.aborted)return;
   if(previous?.rows.length&&result.rows[0]&&result.rows[0].effectiveFrom>=previous.rows.at(-1)!.effectiveFrom)
    throw Error('TAX_HISTORY_REVIEW_REQUIRED');
   setHistory({rows:[...(previous?.rows??[]),...result.rows],hasMore:result.hasMore});
   if(result.rows.length&&!more)nextFocus.current=historyHeading;
   setMessage(result.rows.length?'Saved tax profile history loaded.':'No tax profiles have been saved for this selection.');
  });
 }
 function checkAmount(event:FormEvent){
  event.preventDefault();
  if(!scope||!amount||!customerDate(date)||active.current)return;
  setHistory(null);setPreview(null);
  void run(async(context,signal)=>{
   const result=await financeAccounts.taxPreview(context,scope,date,amount.grossCents,amount.discountCents,signal);
   if(signal.aborted)return;
   setPreview(result);
   if(result.profile)nextFocus.current=resultHeading;
   setMessage(result.state==='ready'?'Fictional tax calculation loaded.':result.state==='exemption_review_required'
    ?'An exemption policy applies. This transaction needs its own evidence.':'No verified tax treatment applies on that date.');
  });
 }
 function download(){
  if(!history?.rows.length||active.current)return;
  downloadFinanceHistory('crest-tax-profile-history.csv',[
   ['Jurisdiction','Applies to','Service ID','Version','Effective from','Treatment','Rate (decimal)',
    'Verification evidence','Approval reason','Reviewer ID','Audit event ID'],
   ...history.rows.map(row=>[row.jurisdiction,row.applicability,row.serviceId??'',row.version,row.effectiveFrom,
    financeTaxTreatmentLabels[row.treatment],row.rate??'',row.verificationEvidence??'',row.reason,row.reviewedBy,row.auditEventId])
  ]);
 }

 return <section className={styles.workspace} aria-label="Tax profile review" aria-busy={busy}>
  <p role="status" ref={status} tabIndex={-1}>{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  <div className={styles.lookupFields}>
   <div>
    <label htmlFor="tax-jurisdiction">Jurisdiction</label>
    <input id="tax-jurisdiction" value={jurisdiction} maxLength={200} disabled={controlsDisabled}
     onChange={event=>{setJurisdiction(event.target.value);resetResults();}}/>
   </div>
   <div>
    <label htmlFor="tax-applicability">Applies to</label>
    <select id="tax-applicability" value={applicability} disabled={controlsDisabled}
     onChange={event=>{
      const value=event.target.value;
      if(value===''||value==='tip'||value==='service'){
       setApplicability(value);setServiceId('');setSearch('');setServicePage(null);resetResults();
      }
     }}>
     <option value="">Choose one</option>
     <option value="service">Service</option>
     <option value="tip">Tip</option>
    </select>
   </div>
  </div>
  {applicability==='service'&&<section aria-label="Find a service">
   <label htmlFor="tax-service-search">Service name or code</label>
   <input id="tax-service-search" type="search" value={search} maxLength={200} disabled={controlsDisabled}
    onChange={event=>{setSearch(event.target.value);setServicePage(null);setServiceId('');resetResults();}}/>
   <div className={styles.actions}>
    <button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>loadServices()}>Find services</button>
    {servicePage?.hasMore&&<button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>loadServices(true)}>More services</button>}
   </div>
   {!!servicePage?.services.length&&<>
    <label htmlFor="tax-service">Service</label>
    <select id="tax-service" ref={serviceSelect} value={serviceId} disabled={controlsDisabled}
     onChange={event=>{setServiceId(event.target.value);resetResults();}}>
     <option value="">Choose a service</option>
     {servicePage.services.map(({service,content})=><option key={service.id} value={service.id}>
      {content.name} · {service.code}{service.active?'':' · Archived'}
     </option>)}
    </select>
   </>}
  </section>}
  <div className={styles.actions}>
   <button type="button" className="secondary" disabled={controlsDisabled||!scope} onClick={()=>readHistory()}>View approval history</button>
  </div>
  <details>
   <summary>Manage fictional approvals</summary>
   <TaxApprovalEditor key={JSON.stringify(scope)} scope={scope} disabled={controlsDisabled} onSaved={resetResults}/>
  </details>
  <details>
   <summary>Check an amount</summary>
   <form onSubmit={checkAmount}>
    <label htmlFor="tax-date">Effective date</label>
    <input id="tax-date" type="date" value={date} disabled={controlsDisabled}
     onChange={event=>{setDate(event.target.value);setPreview(null);}}/>
    <label htmlFor="tax-gross">Amount before discount ($)</label>
    <input id="tax-gross" inputMode="decimal" value={gross} disabled={controlsDisabled}
     onChange={event=>{setGross(event.target.value);setPreview(null);}}/>
    <label htmlFor="tax-discount">Discount ($, optional)</label>
    <input id="tax-discount" inputMode="decimal" value={discount} disabled={controlsDisabled}
     onChange={event=>{setDiscount(event.target.value);setPreview(null);}}/>
    <div className={styles.actions}>
     <button type="submit" disabled={controlsDisabled||!scope||!customerDate(date)||!amount}>Check tax</button>
    </div>
   </form>
  </details>
  {preview?.profile&&<section aria-label="Tax calculation result">
   <h2 ref={resultHeading} className="editor-heading" tabIndex={-1}>{financeTaxTreatmentLabels[preview.profile.treatment]}</h2>
   <p>Version {preview.profile.version} · Effective {dateLabel(preview.profile.effectiveFrom)}</p>
   {preview.state==='ready'&&<dl className={styles.amountBreakdown}>
    <dt>Total after discount</dt><dd>{quoteMoney(preview.components.inclusiveCents)}</dd>
    <dt>Net amount</dt><dd>{quoteMoney(preview.components.netCents)}</dd>
    <dt>Tax included</dt><dd>{quoteMoney(preview.components.taxCents)}</dd>
   </dl>}
  </section>}
  {!!history?.rows.length&&<section aria-label="Saved tax profile history">
   <h2 ref={historyHeading} className="editor-heading" tabIndex={-1}>Approval history</h2>
   <div className={styles.actions}>
    <button type="button" className="secondary" disabled={controlsDisabled} onClick={download}>Download loaded history (CSV)</button>
   </div>
   <ol className="service-list">
    {history.rows.map(row=><li key={row.id}>
     <strong>Version {row.version} · {financeTaxTreatmentLabels[row.treatment]}</strong>
     <p>Effective {dateLabel(row.effectiveFrom)}{row.rate===null?'':' · Decimal rate '+row.rate}</p>
     <p>{row.reason}</p>
     {row.verificationEvidence&&<details><summary>Verification evidence</summary><p>{row.verificationEvidence}</p></details>}
    </li>)}
   </ol>
   {history.hasMore&&<button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>readHistory(true)}>Load earlier approvals</button>}
  </section>}
 </section>;
}
