'use client';

import {Fragment,useEffect,useRef,useState} from 'react';
import {expenseDollars} from '../../../bookkeeping/expenses/expense-contract';
import {receivableAgingBuckets} from '../../../bookkeeping/receivable-aging-contract';
import type {parseReceivableAging} from '../../../bookkeeping/receivable-aging-contract';
import {financeAccounts} from '../../../client/finance-accounts';
import styles from './screen.module.css';

const labels={current:'Current',days1To30:'1–30 days',days31To60:'31–60 days',days61To90:'61–90 days',days91Plus:'91+ days'};
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const displayDate=(date:string)=>dateFormat.format(new Date(date+'T12:00:00Z'));
const usd=(cents:string)=>'$'+expenseDollars(cents);

export function ReceivableAging({businessId}:{businessId:string}){
  const [through,setThrough]=useState('');
  const [report,setReport]=useState<ReturnType<typeof parseReceivableAging>|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);

  function clear(){
    active.current?.abort();
    active.current=null;
    setThrough('');
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
    }catch{
      if(!signal.aborted)setMessage('Crest could not verify the report. Check the date and connection, then try again.');
    }finally{
      if(active.current===controller){active.current=null;setBusy(false);}
    }
  }

  return <details className="review-card" onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)clear();}}>
    <summary onClick={event=>{if(event.currentTarget.closest('details')?.open)clear();}}>Outstanding invoices by due date</summary>
    <section aria-label="Outstanding invoices by due date" aria-busy={busy}>
      <p className="field-help">Fictional posted invoices. Opening receivables and legacy balances are outside this report’s coverage.</p>
      <form onSubmit={event=>{event.preventDefault();void load();}}>
        <label>Through date (optional)<input type="date" min="1900-01-01" value={through} disabled={busy}
          onChange={event=>{setThrough(event.target.value);setReport(null);setMessage('');}}/></label>
        <p className="field-help">Leave blank for today in the workspace time zone.</p>
        <button className="secondary" type="submit" disabled={busy}>Load outstanding invoices</button>
      </form>
      <p role="status">{message}</p>
      {report&&<>
        <p>As of <time dateTime={report.throughOn}>{displayDate(report.throughOn)}</time></p>
        <dl className={styles.amountBreakdown}>
          <dt>Total outstanding</dt><dd>{usd(report.totalCents)}</dd>
          {receivableAgingBuckets.map(key=><Fragment key={key}>
            <dt>{labels[key]}</dt><dd>{usd(report.buckets[key])}</dd>
          </Fragment>)}
        </dl>
        {report.rows.length>0&&<details>
          <summary>Invoice details ({report.rows.length} of {report.itemCount})</summary>
          {report.truncated&&<p className="field-help">Showing the first 100 by due date. Totals include all outstanding posted invoices.</p>}
          <ul className={styles.agingInvoices}>
            {report.rows.map(row=><li key={row.receivableId}>
              <div><strong>{row.customerName}</strong><span>Invoice {row.invoiceNumber}</span>
                <span>Due <time dateTime={row.dueOn}>{displayDate(row.dueOn)}</time></span></div>
              <div><strong>{usd(row.outstandingCents)}</strong><span>{row.daysOverdue===0?'Current':row.daysOverdue+' days overdue'}</span></div>
            </li>)}
          </ul>
        </details>}
      </>}
    </section>
  </details>;
}
