'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError} from '../../../../client/authentication';
import {downloadFinanceHistory,financeAccounts} from '../../../../client/finance-accounts';
import {customerDate} from '../../../../customer/customer-contract';
import {fixedFinanceMappingLabels,fixedFinanceMappingPurpose} from '../../../../bookkeeping/finance-mapping-contract';
import type {FixedFinanceMappingPurpose} from '../../../../bookkeeping/finance-mapping-contract';
import styles from '../screen.module.css';

type Result=Awaited<ReturnType<typeof financeAccounts.mappingAt>>;
type History=Awaited<ReturnType<typeof financeAccounts.mappingHistory>>;
const initialMessage='Choose a purpose to look up.';
const displayDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(value:string)=>displayDate.format(new Date(value+'T00:00:00Z'));

export function FinanceMappingsScreen(){
 const [purpose,setPurpose]=useState<FixedFinanceMappingPurpose|''>('');
 const [date,setDate]=useState(''),[message,setMessage]=useState(initialMessage);
 const [mapping,setMapping]=useState<Result>(null),[history,setHistory]=useState<History|null>(null);
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const clearPrivate=useCallback(()=>{
  active.current?.abort();active.current=null;
  setMapping(null);setHistory(null);setPurpose('');setDate('');setBusy(false);setSignedOut(false);setMessage(initialMessage);
 },[]);
 useEffect(()=>{
  const visibility=()=>{if(document.visibilityState==='hidden')clearPrivate();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clearPrivate();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',clearPrivate);
  window.addEventListener('pageshow',restored);
  return()=>{
   active.current?.abort();active.current=null;document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('pagehide',clearPrivate);window.removeEventListener('pageshow',restored);
  };
 },[clearPrivate]);
 function resetResults(){
  setMapping(null);setHistory(null);setMessage(initialMessage);
 }
 async function load(kind:'date'|'history'|'more'){
  if(!purpose||active.current||kind==='date'&&!customerDate(date))return;
  const previous=kind==='more'?history:null;
  const controller=new AbortController(),signal=controller.signal;
  active.current=controller;setBusy(true);setSignedOut(false);setMapping(null);
  if(!previous)setHistory(null);
  setMessage('Checking saved mappings…');
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(!context.fixedMappings){setMessage('Dated account mappings are unavailable in this workspace.');return;}
   if(kind==='date'){
    const result=await financeAccounts.mappingAt(context,purpose,date,signal);
    if(signal.aborted)return;
    setMapping(result);setMessage(result?'Approved mapping found.':'No usable account mapping applies on that date.');
   }else{
    const result=await financeAccounts.mappingHistory(context,purpose,previous?.rows.at(-1)?.version??null,signal);
    if(signal.aborted)return;
    setHistory({rows:[...(previous?.rows??[]),...result.rows],hasMore:result.hasMore});
    setMessage(result.rows.length?'Saved mapping history loaded.':'No approved versions for this purpose.');
   }
  }catch(error){
   if(signal.aborted)return;
   setHistory(null);
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   setSignedOut(denied);setMessage(denied?'Sign in to check account mappings.':'The mapping could not be verified. Try again.');
  }finally{
   if(active.current===controller){active.current=null;setBusy(false);status.current?.focus();}
  }
 }
 function submit(event:FormEvent){
  event.preventDefault();void load('date');
 }
 function download(){
  if(!history?.rows.length||active.current)return;
  downloadFinanceHistory('crest-mapping-approvals.csv',[
   ['Purpose','Version','Effective from','Status','Account code','Approval reason'],
   ...history.rows.map(row=>[fixedFinanceMappingLabels[row.purpose],row.version,row.effectiveFrom,
    row.accountId===null?'Closed':'Approved',row.accountCode??'',row.reason]),
  ]);
 }
 return <section className={styles.workspace} aria-label="Account mapping lookup" aria-busy={busy}>
  <p ref={status} tabIndex={-1} role="status">{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  <form onSubmit={submit}>
   <div className={styles.lookupFields}>
    <div>
     <label htmlFor="mapping-purpose">Purpose</label>
     <select id="mapping-purpose" required disabled={busy} value={purpose} onChange={event=>{
      const value=event.target.value;
      setPurpose(fixedFinanceMappingPurpose(value)?value:'');resetResults();
     }}>
      <option value="">Select a purpose</option>
      {Object.entries(fixedFinanceMappingLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
     </select>
    </div>
    <div>
     <label htmlFor="mapping-date">Effective date</label>
     <input id="mapping-date" type="date" required disabled={busy} value={date} onChange={event=>{
      setDate(event.target.value);resetResults();
     }}/>
    </div>
   </div>
   <div className={styles.actions}>
    <button type="submit" disabled={busy||!purpose||!customerDate(date)}>Check account</button>
    <button type="button" className="secondary" disabled={busy||!purpose} onClick={()=>void load('history')}>View approval history</button>
   </div>
  </form>
  {mapping&&<section aria-label="Approved account">
   <h2>Account on {dateLabel(date)}</h2>
   <p><strong>{mapping.accountCode} · {fixedFinanceMappingLabels[mapping.purpose]}</strong></p>
   <p>Version {mapping.version} · Effective {dateLabel(mapping.effectiveFrom)}.
    {mapping.effectiveUntil&&<> Next version starts {dateLabel(mapping.effectiveUntil)}.</>}</p>
   <p>{mapping.reason}</p>
  </section>}
  {history&&history.rows.length>0&&<section aria-label="Saved mapping history">
   <h2>Approval history</h2>
   <div className={styles.actions}>
    <button type="button" className="secondary" disabled={busy} onClick={download}>Download loaded approvals (CSV)</button>
   </div>
   <ul className="customer-list">{history.rows.map(row=><li key={row.id}>
    <p><strong>Version {row.version} · {row.accountCode===null?'Closed':`Account ${row.accountCode}`}</strong></p>
    <p className="field-help">Effective {dateLabel(row.effectiveFrom)}</p>
    <p>{row.reason}</p>
   </li>)}</ul>
   {history.hasMore&&<button type="button" className="secondary" disabled={busy} onClick={()=>void load('more')}>Load older approvals</button>}
  </section>}
 </section>;
}
