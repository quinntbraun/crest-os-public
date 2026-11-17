'use client';

import {useEffect,useRef,useState} from 'react';
import {expenseDollars} from '../../../bookkeeping/expenses/expense-contract';
import {incomeSections} from '../../../bookkeeping/recorded-income-statement';
import {downloadFinanceHistory,financeAccounts} from '../../../client/finance-accounts';
import styles from './screen.module.css';

type Report=Awaited<ReturnType<typeof financeAccounts.readRecordedIncomeStatement>>;
const coverage='Fictional posted records only. Opening balances, reconciliations and some costs are incomplete.';
const basis='Operational books · invoice-issued recognition';
const supplierBasis='Operational books · revenue at invoice issue and supplier costs when incurred';
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const displayDate=(date:string)=>dateFormat.format(new Date(date+'T12:00:00Z'));
const usd=(cents:bigint)=>cents<0n?'-$'+expenseDollars(String(-cents)):'$'+expenseDollars(String(cents));

export function RecordedIncomeStatement({businessId}:{businessId:string}){
 const [from,setFrom]=useState('');
 const [through,setThrough]=useState('');
 const [report,setReport]=useState<Report|null>(null);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const active=useRef<AbortController|null>(null);
 function clear(){
  active.current?.abort();active.current=null;
  setFrom('');setThrough('');setReport(null);setMessage('');setBusy(false);
 }
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  window.addEventListener('pagehide',clear);
  document.addEventListener('visibilitychange',hidden);
  return ()=>{
   active.current?.abort();
   window.removeEventListener('pagehide',clear);
   document.removeEventListener('visibilitychange',hidden);
  };
 },[]);
 async function load(){
  if(active.current)return;
  const controller=new AbortController();active.current=controller;
  const {signal}=controller;
  setReport(null);setBusy(true);setMessage('Checking the posted ledger…');
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(context.businessId!==businessId||!context.recordedIncomeStatement)throw Error();
   const result=await financeAccounts.readRecordedIncomeStatement(context,from,through,signal);
   if(signal.aborted)return;
   setReport(result);
   setMessage(result.rows.length?'Recorded income loaded.':'No income or expense was posted for these dates.');
  }catch{if(!signal.aborted)setMessage('Crest could not verify the income statement. Check the dates and try again.');}
  finally{if(active.current===controller){active.current=null;setBusy(false);}}
 }
 const sections=Object.entries(incomeSections).map(([key,label])=>{
  const rows=report?.rows.filter(row=>row.section===key)??[];
  return {label,rows,total:rows.reduce((sum,row)=>sum+BigInt(row.incomeCents),0n)};
 });
 function download(){
  if(!report)return;
  downloadFinanceHistory('crest-fictional-income-'+report.fromOn+'-to-'+report.throughOn+'.csv',[
   ['From','Through','Currency','Timezone','Observed UTC','Report version','Coverage start','Basis','Coverage'],
   [report.fromOn,report.throughOn,report.currency,report.timeZone,report.observedAt,String(report.schemaVersion),
    report.coverageStart??'',report.schemaVersion===2?supplierBasis:basis,coverage],
   [],
   ['Section','Account code','Account','Status','Posted debit cents','Posted credit cents','Net income contribution cents'],
   ...sections.flatMap(({label,rows,total})=>[
    ...rows.map(row=>[label,row.code,row.name,row.active?'Active':'Archived',BigInt(row.debitCents),BigInt(row.creditCents),BigInt(row.incomeCents)]),
    [label,'','Subtotal','','','',total],
   ]),
   ['','','Recorded-book net income','','','',BigInt(report.netIncomeCents)],
  ]);
 }
 return <details className="review-card" open onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)clear();}}>
  <summary>Income statement</summary>
  <section aria-label="Recorded income statement" className="trial-balance">
   <p>{report?.schemaVersion===2?supplierBasis:basis}. {coverage}</p>
   <form className={styles.incomeForm} onSubmit={event=>{event.preventDefault();void load();}}>
    <label>From date<input type="date" required value={from} disabled={busy}
     onChange={event=>{setFrom(event.target.value);setReport(null);setMessage('');}}/></label>
    <label>Through date<input type="date" required value={through} min={from||undefined} disabled={busy}
     onChange={event=>{setThrough(event.target.value);setReport(null);setMessage('');}}/></label>
    <button type="submit" className="secondary" disabled={busy}>Load income statement</button>
   </form>
   <p role="status">{message}</p>
   {report&&<>
    <p className={styles.reportPeriod}>Income statement · <time dateTime={report.fromOn}>{displayDate(report.fromOn)}</time>
     {report.fromOn!==report.throughOn&&<> to <time dateTime={report.throughOn}>{displayDate(report.throughOn)}</time></>}
    </p>
    <div className={styles.reportSnapshot}>
     <div><p>USD · {report.timeZone}</p>
      {report.coverageStart&&<p className="field-help">First recorded posting {report.coverageStart}.</p>}
     </div>
     <button type="button" className="secondary" onClick={download}>Download income statement CSV</button>
    </div>
    <div className={styles.balanceScroll} tabIndex={0} role="region" aria-label="Income and expense totals">
     <table className={styles.balanceTable}>
      <thead><tr><th scope="col">Category</th><th scope="col">Amount</th></tr></thead>
      <tbody>{sections.map(({label,total})=><tr key={label}><th scope="row">{label}</th><td>{usd(total)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Recorded-book net income</th><td>{usd(BigInt(report.netIncomeCents))}</td></tr></tfoot>
     </table>
    </div>
    <p className="field-help">Account detail is in the CSV. Open Journal entries in the trial balance to review postings.</p>
   </>}
  </section>
 </details>;
}
