'use client';

import {useEffect,useRef,useState} from 'react';
import type {parseCustomerFundsReport} from '../../../bookkeeping/customer-funds-report-contract';
import {expenseDollars} from '../../../bookkeeping/expenses/expense-contract';
import {downloadFinanceHistory,financeAccounts} from '../../../client/finance-accounts';
import styles from './screen.module.css';

const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const displayDate=(date:string)=>dateFormat.format(new Date(date+'T12:00:00Z'));
const usd=(cents:string)=>'$'+expenseDollars(cents);

export function CustomerFundsReport({businessId,includesExcess=false,includesRefundTransfers=false}:{businessId:string;includesExcess?:boolean;includesRefundTransfers?:boolean}){
  const [through,setThrough]=useState('');
  const [report,setReport]=useState<ReturnType<typeof parseCustomerFundsReport>|null>(null);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);

  function clear(){
    active.current?.abort();
    active.current=null;
    setThrough('');
    setReport(null);
    setStatus('');
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
    setStatus('Checking customer funds…');
    try{
      const context=await financeAccounts.context(signal);
      if(!context.customerFundsReport||context.businessId!==businessId)throw Error();
      const result=await financeAccounts.readCustomerFundsReport(context,through||null,signal);
      if(signal.aborted)return;
      setReport(result);
      setStatus(result.lotCount==='0'?'No posted customer funds were held on this date.':'Customer funds matched the ledger.');
    }catch{
      if(!signal.aborted)setStatus('Crest could not verify customer funds. Check the date and connection, then try again.');
    }finally{
      if(active.current===controller){active.current=null;setBusy(false);}
    }
  }

  function download(){
    if(!report)return;
    downloadFinanceHistory('crest-fictional-customer-funds-'+report.throughOn+'.csv',[
      ['As of','Total held (cents)','Total entries','Entries included'],
      [report.throughOn,report.totalCents,report.lotCount,String(report.rows.length)],
      [],['Lot ID','Funding origin ID','Customer ID','Customer','Held since','Held (cents)'],
      ...report.rows.map(row=>[row.lotId,row.originId,row.customerId,row.customerName,row.heldOn,row.heldCents]),
    ]);
  }

  return <details className="review-card" onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)clear();}}>
    <summary onClick={event=>{if(event.currentTarget.closest('details')?.open)clear();}}>{includesRefundTransfers?'Available customer funds':'Customer funds held'}</summary>
    <section aria-label="Customer funds held" aria-busy={busy}>
      <p className="field-help">Fictional funds held from {includesExcess?'payments and payment corrections':'payment corrections'}, checked against account 2000.
       {includesRefundTransfers&&' Funds set aside for returned refunds appear in the trial balance under Refunds still due.'}</p>
      <form onSubmit={event=>{event.preventDefault();void load();}}>
        <label>Through date (optional)<input type="date" min="1900-01-01" value={through} disabled={busy}
          onChange={event=>{setThrough(event.target.value);setReport(null);setStatus('');}}/></label>
        <p className="field-help">Leave blank for today in the workspace time zone.</p>
        <button className="secondary" type="submit" disabled={busy}>Load customer funds</button>
      </form>
      <p role="status">{status}</p>
      {report&&<>
        <p>As of <time dateTime={report.throughOn}>{displayDate(report.throughOn)}</time></p>
        <dl className={styles.amountBreakdown}><dt>Total held</dt><dd>{usd(report.totalCents)}</dd></dl>
        {report.rows.length>0&&<details>
          <summary>Held funds by customer ({report.rows.length} of {report.lotCount} entries)</summary>
          {report.truncated&&<p className="field-help">Showing the first 100 entries by date. The total includes all posted customer funds.</p>}
          <ul className={styles.agingInvoices}>
            {report.rows.map(row=><li key={row.lotId}>
              <div><strong>{row.customerName}</strong><span>Held since <time dateTime={row.heldOn}>{displayDate(row.heldOn)}</time></span></div>
              <strong>{usd(row.heldCents)}</strong>
            </li>)}
          </ul>
          <button className="secondary" type="button" onClick={download}>Download listed funds (CSV)</button>
        </details>}
      </>}
    </section>
  </details>;
}
