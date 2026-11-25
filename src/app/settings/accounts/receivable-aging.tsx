'use client';

import {useEffect,useRef,useState} from 'react';
import {AuthenticationError} from '../../../client/authentication';
import {expenseDollars} from '../../../bookkeeping/expenses/expense-contract';
import {receivableAgingBuckets} from '../../../bookkeeping/receivable-aging-contract';
import type {parseReceivableAging} from '../../../bookkeeping/receivable-aging-contract';
import {downloadFinanceHistory,financeAccounts} from '../../../client/finance-accounts';
import {receivableAgingCsvRows} from '../../../client/receivable-aging-export';
import styles from './screen.module.css';
import {FinancialReportHeader} from './financial-report-header';
import {ReportReadingSummary} from './report-reading-summary';

const labels={current:'Current',days1To30:'1–30 days',days31To60:'31–60 days',days61To90:'61–90 days',days91Plus:'91+ days'};
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const displayDate=(date:string)=>dateFormat.format(new Date(date+'T12:00:00Z'));
const usd=(cents:string)=>'$'+expenseDollars(cents);

export function ReceivableAging({businessId,initialThrough='',onThroughChange,onAccessDenied}:{businessId:string;
  initialThrough?:string;onThroughChange?:(value:string)=>void;onAccessDenied?:()=>void}){
  const [through,setThrough]=useState(initialThrough);
  const [report,setReport]=useState<ReturnType<typeof parseReceivableAging>|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);

  function clear(){
    active.current?.abort();
    active.current=null;
    setReport(null);
    setMessage('');
    setBusy(false);
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
    const controller=new AbortController();
    active.current=controller;
    const {signal}=controller;
    setReport(null);
    setBusy(true);
    setMessage('Checking outstanding invoices…');
    try{
      const context=await financeAccounts.context(signal);
      if(!context.receivableAging||context.businessId!==businessId)throw Error();
      const result=await financeAccounts.readReceivableAging(context,through||null,signal);
      if(signal.aborted)return;
      setReport(result);
      setMessage(result.itemCount==='0'?'No posted invoices had an outstanding balance on that date.':'Outstanding invoices loaded.');
    }catch(error){
      if(!signal.aborted){
        const denied=error instanceof AuthenticationError&&error.kind==='denied';
        if(denied)onAccessDenied?.();
        setMessage(denied?'Sign in again to review outstanding invoices.':'Crest could not verify the report. Check the date and connection, then try again.');
      }
    }finally{
      if(active.current===controller){active.current=null;setBusy(false);}
    }
  }

  return <details className="review-card" open onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)clear();}}>
    <summary onClick={event=>{if(event.currentTarget.closest('details')?.open)clear();}}>Outstanding invoices by due date</summary>
    <section aria-label="Outstanding invoices by due date" aria-busy={busy}>
      {!report&&<p className="field-help">Fictional posted invoices. Opening receivables and legacy balances are outside this report’s coverage.</p>}
      <ReportReadingSummary snapshot={report} loading={busy&&!report}>{report&&<FinancialReportHeader period={<>Receivables · As of <time dateTime={report.throughOn}>{displayDate(report.throughOn)}</time></>}
          timeZone={report.timeZone} observedAt={report.observedAt} scopeLabel="Posted invoices"
          coverage="Fictional posted invoices. Opening receivables and legacy balances are outside this report’s coverage."
          details={<><p className={styles.reportAmount}><span>Total outstanding</span> <strong>{usd(report.totalCents)}</strong></p>{report.truncated&&<p className="field-help">Showing the first 100 by due date. Totals include all outstanding posted invoices.</p>}</>}
          action={<button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-posted-receivables-'+report.throughOn+'.csv',receivableAgingCsvRows(report))}>Download listed invoices (CSV)</button>}/>}</ReportReadingSummary>
      <form className={styles.agingDateForm} onSubmit={event=>{event.preventDefault();void load();}}>
        <label>Through date (optional)<input type="date" min="1900-01-01" value={through} disabled={busy}
          onChange={event=>{setThrough(event.target.value);onThroughChange?.(event.target.value);setReport(null);setMessage('');}}/></label>
        <p className="field-help">Leave blank for today in the workspace time zone.</p>
        <button className="secondary" type="submit" disabled={busy}>Load outstanding invoices</button>
      </form>
      <p role="status">{message}</p>
      {report&&<>

        <dl className={styles.agingBuckets} aria-label="Outstanding by age">
          {receivableAgingBuckets.map(key=><div key={key}>
            <dt>{labels[key]}</dt><dd>{usd(report.buckets[key])}</dd>
          </div>)}
        </dl>
        {report.rows.length>0&&<details>
          <summary>Invoice details ({report.rows.length} of {report.itemCount})</summary>
          {report.truncated&&<p className="field-help">Showing the first 100 by due date. Totals include all outstanding posted invoices.</p>}
          <ul className={styles.agingInvoices}>
            {report.rows.map(row=><li key={row.receivableId}>
              <div className={styles.agingIdentity}><strong>{row.customerName}</strong><span>Invoice {row.invoiceNumber}</span></div>
              <div className={styles.agingDue}><span>Due</span><time dateTime={row.dueOn}>{displayDate(row.dueOn)}</time></div>
              <div className={styles.agingBalance}><strong>{usd(row.outstandingCents)}</strong><span>{row.daysOverdue===0?'Current':row.daysOverdue+' days overdue'}</span></div>
            </li>)}
          </ul>
        </details>}
      </>}
    </section>
  </details>;
}
