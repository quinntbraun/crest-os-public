'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent} from 'react';
import {authentication,AuthenticationError} from '../../../../client/authentication';
import {downloadFinanceHistory,financeAccounts,readPendingFinanceMapping} from '../../../../client/finance-accounts';
import {customerDate} from '../../../../customer/customer-contract';
import {expenseCategoryMappingLabels,expenseCategoryMappingPurpose,financeMappingLabels,fixedFinanceMappingLabels,fixedFinanceMappingPurpose} from '../../../../bookkeeping/finance-mapping-contract';
import type {ExpenseCategoryMappingPurpose,FinanceMappingPurpose} from '../../../../bookkeeping/finance-mapping-contract';
import styles from '../screen.module.css';
import {MappingApprovalHistory} from './history';

type Result=Awaited<ReturnType<typeof financeAccounts.mappingAt>>;
type History=Awaited<ReturnType<typeof financeAccounts.mappingHistory>>;
const categoryEntries=Object.entries(expenseCategoryMappingLabels) as [ExpenseCategoryMappingPurpose,string][];
const subscribeToHydration=()=>()=>undefined;
const displayDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(value:string)=>displayDate.format(new Date(value+'T00:00:00Z'));

export function FinanceMappingsScreen({categories=false}:{categories?:boolean}){
 const initialMessage=categories?'Choose an expense category to look up.':'Choose a purpose to look up.';
 const labels=categories?expenseCategoryMappingLabels:fixedFinanceMappingLabels;
 const acceptsPurpose=categories?expenseCategoryMappingPurpose:fixedFinanceMappingPurpose;
 const [purpose,setPurpose]=useState<FinanceMappingPurpose|''>('');
 const [date,setDate]=useState(''),[message,setMessage]=useState(initialMessage);
 const [mapping,setMapping]=useState<Result>(null),[history,setHistory]=useState<History|null>(null);
 const [checked,setChecked]=useState(false),[query,setQuery]=useState(''),[exceptions,setExceptions]=useState(false);
 const [directory,setDirectory]=useState<{rows:Record<string,Result>;pending:FinanceMappingPurpose|null}|null>(null);
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const mounted=useSyncExternalStore(subscribeToHydration,()=>true,()=>false);
 const controlsDisabled=!mounted||busy;
 const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const historyHeading=useRef<HTMLHeadingElement>(null),accountHeading=useRef<HTMLHeadingElement>(null);
 const resultFocus=useRef<'history'|'account'|null>(null);
 useEffect(()=>{
  if(busy||!resultFocus.current)return;
  const heading=resultFocus.current==='history'?historyHeading:accountHeading;
  heading.current?.focus({preventScroll:true});
  heading.current?.scrollIntoView({block:'start'});
  resultFocus.current=null;
 },[busy]);
 const clearPrivate=useCallback(()=>{
  active.current?.abort();active.current=null;resultFocus.current=null;
  setMapping(null);setHistory(null);setPurpose('');setDate('');setChecked(false);setDirectory(null);setQuery('');setExceptions(false);setBusy(false);setSignedOut(false);setMessage(initialMessage);
 },[initialMessage]);
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
  setMapping(null);setHistory(null);setChecked(false);setMessage(initialMessage);
 }
 async function load(kind:'date'|'history'|'more'|'directory',selected=purpose){
  const needsDate=kind==='date'||kind==='directory';
  if(active.current||kind!=='directory'&&!selected||needsDate&&!customerDate(date))return;
  if(kind==='directory')setDirectory(null);
  const previous=kind==='more'?history:null;
  const controller=new AbortController(),signal=controller.signal;
  active.current=controller;setBusy(true);setSignedOut(false);
  if(kind==='date'){setMapping(null);setChecked(false);}
  if(kind==='history')setHistory(null);
  setMessage('Checking saved mappings…');
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(!context.fixedMappings||categories&&!context.categoryMappings){setMessage('Dated account mappings are unavailable in this workspace.');return;}
   if(kind==='directory'){
    const proof=await authentication.session(signal);
    const rows:Record<string,Result>={};
    for(let start=0;start<categoryEntries.length;start+=3){
     const batch=categoryEntries.slice(start,start+3);
     const results=await Promise.all(batch.map(([key])=>financeAccounts.mappingAt(context,key,date,signal,proof)));
     if(signal.aborted)return;
     batch.forEach(([key],index)=>{rows[key]=results[index]!;});
    }
    let pending:ReturnType<typeof readPendingFinanceMapping>=null;
    try{pending=readPendingFinanceMapping();}catch{/* The verified directory can still be displayed. */}
    setDirectory({rows,pending:pending?.businessId===context.businessId?pending.reference.purpose:null});
    setMessage('Category mappings checked for '+dateLabel(date)+'.');
   }else if(kind==='date'&&selected){
    const result=await financeAccounts.mappingAt(context,selected,date,signal);
    if(signal.aborted)return;
    if(result)resultFocus.current='account';
    setMapping(result);setChecked(true);setMessage(result?'Approved mapping found.':'No usable account mapping applies on that date.');
   }else if(selected){
    const result=await financeAccounts.mappingHistory(context,selected,previous?.rows.at(-1)?.version??null,signal);
    if(signal.aborted)return;
    setHistory({rows:[...(previous?.rows??[]),...result.rows],hasMore:result.hasMore});
    if(kind==='history'&&(result.rows.length||categories))resultFocus.current='history';
    setMessage(result.rows.length?'Saved mapping history loaded.':'No approved versions for this purpose.');
   }
  }catch(error){
   if(signal.aborted)return;
   controller.abort();setHistory(null);
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   setSignedOut(denied);setMessage(denied?'Sign in to check account mappings.':'The mapping could not be verified. Try again.');
  }finally{
   if(active.current===controller){active.current=null;setBusy(false);if(!resultFocus.current)status.current?.focus();}
  }
 }
 function submit(event:FormEvent){
  event.preventDefault();void load('date');
 }
 function download(){
  if(!history?.rows.length||active.current)return;
  downloadFinanceHistory('crest-mapping-approvals.csv',[
   ['Purpose','Version','Effective from','Status','Account code','Approval reason'],
   ...history.rows.map(row=>[financeMappingLabels[row.purpose],row.version,row.effectiveFrom,
    row.accountId===null?'Closed':'Approved',row.accountCode??'',row.reason]),
  ]);
 }
 const matchingCategories=categoryEntries.filter(([key,label])=>
  label.toLowerCase().includes(query.trim().toLowerCase())&&(!exceptions||!directory?.rows[key]||directory.pending===key));
 return <section className={styles.workspace} aria-label="Account mapping lookup" aria-busy={busy}>
  <p ref={status} tabIndex={-1} role="status">{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  <div className="mapping-workbench"><div className="mapping-lookup-pane">
  <form className="mapping-lookup-form" onSubmit={submit}>
   <div className={styles.lookupFields}>
    <div>
     <label htmlFor="mapping-purpose">{categories?'Expense category':'Purpose'}</label>
     <select id="mapping-purpose" required disabled={controlsDisabled} value={purpose} onChange={event=>{
      const value=event.target.value;
      setPurpose(acceptsPurpose(value)?value:'');resetResults();
     }}>
      <option value="">{categories?'Choose a category':'Select a purpose'}</option>
      {Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
     </select>
    </div>
    <div>
     <label htmlFor="mapping-date">Effective date</label>
     <input id="mapping-date" type="date" required disabled={controlsDisabled} value={date} onChange={event=>{
      setDate(event.target.value);setDirectory(null);setExceptions(false);resetResults();
     }}/>
    </div>
   </div>
   <div className={styles.actions}>
    <button type="submit" disabled={controlsDisabled||!purpose||!customerDate(date)}>Check account</button>
    <button type="button" className="secondary" disabled={controlsDisabled||!purpose} onClick={()=>void load('history')}>View approval history</button>
   </div>
  </form>
  {mapping&&<section className="mapping-summary-card" aria-label="Approved account">
   <h2 ref={accountHeading} className="editor-heading" tabIndex={-1}>Account on {dateLabel(date)}</h2>
   <p className="mapping-tag">Approved for this date</p>
   <dl className="mapping-rule-lookup">
    <div><dt>{categories?'Expense category':'Business event'}</dt><dd>{financeMappingLabels[mapping.purpose]}</dd></div>
    <div><dt>Posting account</dt><dd>{mapping.accountCode}</dd></div>
    <div><dt>Effective period</dt><dd>Version {mapping.version} · Effective {dateLabel(mapping.effectiveFrom)}.
     {mapping.effectiveUntil&&<> Next version starts {dateLabel(mapping.effectiveUntil)}.</>}</dd></div>
   </dl>
   <p>{mapping.reason}</p>
  </section>}
  {checked&&!mapping&&<section className="mapping-summary-card" aria-label="No mapping on this date">
   <h2>{purpose&&financeMappingLabels[purpose]}</h2>
   <p>No usable approved account covers <strong>{dateLabel(date)}</strong>. Check the approval history for the saved effective dates.</p>
  </section>}
  </div>
  {history?<MappingApprovalHistory history={history} purpose={purpose} categories={categories} heading={historyHeading} disabled={controlsDisabled} download={download} more={()=>void load('more')}/>:<section className="mapping-history-introduction" aria-label="Approval history introduction"><h2>Review approved changes</h2><p>Choose a {categories?'category':'purpose'}, then view its approval history to compare accounts and effective periods.</p><p>The date lookup checks which approved account is usable on a specific date.</p></section>}
  </div>
  {categories&&<section className="mapping-summary-card" aria-labelledby="category-directory-title">
   <h2 id="category-directory-title">Expense category directory</h2>
   <p className="field-help">{directory?'Posting accounts on '+dateLabel(date):'Select an effective date to check posting accounts.'}</p>
   <div className="mapping-directory-controls">
    <div><label htmlFor="category-directory-search">Find a category</label>
     <input id="category-directory-search" type="search" value={query} disabled={controlsDisabled} onChange={event=>setQuery(event.target.value)}/></div>
    <button type="button" className="secondary" disabled={controlsDisabled||!customerDate(date)} onClick={()=>void load('directory')}>Check categories for selected date</button>
   </div>
   {directory&&<label className="checkbox"><input type="checkbox" checked={exceptions} disabled={controlsDisabled} onChange={event=>setExceptions(event.target.checked)}/>Show categories needing attention</label>}
   {matchingCategories.length===0&&<p>No categories match these filters.</p>}
   <ul className="mapping-category-list">
    {matchingCategories.map(([key,label])=>{
     const row=directory?.rows[key];
     return <li key={key}>
      <div><strong>{label}</strong>{directory&&<p>{row?'Account '+row.accountCode:'No usable mapping'}</p>}
       {directory?.pending===key&&<span className="mapping-tag">Interrupted approval in this tab</span>}</div>
      <button className="secondary" type="button" disabled={controlsDisabled} onClick={()=>{
       if(purpose!==key){setPurpose(key);resetResults();}
       void load('history',key);
      }}>History for {label}</button>
     </li>;
    })}
   </ul>
  </section>}
 </section>;
}
