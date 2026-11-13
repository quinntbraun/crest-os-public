'use client';

import {useEffect,useRef,useState} from 'react';
import {expenseDollars} from '../../../bookkeeping/expenses/expense-contract';
import type {FictionalJournalV2,FictionalTrialBalanceV2} from '../../../bookkeeping/posted-report-v2-contract';
import type {FictionalJournalV3,FictionalTrialBalanceV3} from '../../../bookkeeping/posted-report-v3-contract';
import {downloadFinanceHistory,financeAccounts} from '../../../client/finance-accounts';

type Balance=Awaited<ReturnType<typeof financeAccounts.readTrialBalance>>|FictionalTrialBalanceV2|FictionalTrialBalanceV3;
type Journal=Awaited<ReturnType<typeof financeAccounts.readPostedJournal>>|FictionalJournalV2|FictionalJournalV3;
type CorrectionJournalRow=FictionalJournalV2['rows'][number]|FictionalJournalV3['rows'][number];
const usd=(cents:string)=>'$'+expenseDollars(cents);
function hasPaymentCorrections(report:Balance|Journal){
  return 'schemaVersion' in report&&(report.schemaVersion===2||report.schemaVersion===3);
}
function reportVersion(report:Balance|Journal){
  return 'schemaVersion' in report?report.schemaVersion:1;
}
function hasCorrectionFields(row:Journal['rows'][number]):row is CorrectionJournalRow{
  return 'unapplicationId' in row&&'fundLotId' in row;
}

export function TrialBalance({businessId}:{businessId:string}){
  const [through,setThrough]=useState('');
  const [balance,setBalance]=useState<Balance|null>(null);
  const [journal,setJournal]=useState<Journal|null>(null);
  const [account,setAccount]=useState('');
  const [journalMessage,setJournalMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null);
  function clear(){
    active.current?.abort();active.current=null;
    setThrough('');setBalance(null);setJournal(null);setAccount('');setJournalMessage('');setBusy(false);setMessage('');
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
    setBalance(null);setJournal(null);setAccount('');setJournalMessage('');setBusy(true);setMessage('Checking the posted ledger…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.trialBalance||context.businessId!==businessId){setMessage('The trial balance is unavailable.');return;}
      const result=await financeAccounts.readTrialBalance(context,through||null,signal);
      if(signal.aborted)return;
      setBalance(result);
      setMessage(result.postedEventCount==='0'?'No supported entries have been posted through this date.':'Posted balances loaded.');
    }catch{if(!signal.aborted)setMessage('Crest could not load a verified trial balance. Check the date and connection, then try again.');}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  async function loadJournal(next=false){
    if(active.current||!balance||next&&!journal?.nextAfterLineId)return;
    const controller=new AbortController();active.current=controller;
    const {signal}=controller;
    setJournal(null);setBusy(true);setJournalMessage('Checking journal entries…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(context.businessId!==businessId)throw Error();
      const result=await financeAccounts.readPostedJournal(context,balance.throughOn,account||null,next?journal!.nextAfterLineId:null,signal);
      if(signal.aborted)return;
      if(reportVersion(result)!==reportVersion(balance)){
        setJournalMessage('Report coverage changed. Reload the trial balance before opening the journal.');
        return;
      }
      setJournal(result);
      setJournalMessage(result.rows.length?'Journal page loaded.':'No posted lines for this account and date.');
    }catch{if(!signal.aborted)setJournalMessage('Crest could not load the journal page. Check your connection and load it again.');}
    finally{if(active.current===controller){active.current=null;setBusy(false);}}
  }
  function download(){
    if(!balance)return;
    downloadFinanceHistory('crest-fictional-trial-balance-'+balance.throughOn+'.csv',[
      ['Through date','Timezone','Currency','Observed UTC','Posted events','Coverage'],
      [balance.throughOn,balance.timeZone,balance.currency,balance.observedAt,balance.postedEventCount,
        reportVersion(balance)===3
          ?'Fictional partial ledger. Supported invoices, direct payments, customer funds applications, payment corrections and same-day expenses. Opening balances and reconciliation pending.'
          :hasPaymentCorrections(balance)
          ?'Fictional partial ledger. Supported invoices, direct payments, payment corrections and same-day expenses. Opening balances and reconciliation pending.'
          :'Fictional partial ledger. Supported invoices, direct payments and same-day expenses. Opening balances and reconciliation pending.'],
      [],
      ['Account code','Account name','Status','Posted debit cents','Posted credit cents','Net debit cents','Net credit cents'],
      ...balance.rows.map(row=>{
        const net=BigInt(row.balanceCents);
        return [row.code,row.name,row.active?'Active':'Archived',row.debitCents,row.creditCents,
          net>0n?net.toString():'0',net<0n?(-net).toString():'0'];
      }),
      ['', 'Total','',balance.totals.debitCents,balance.totals.creditCents,balance.totals.debitBalanceCents,balance.totals.creditBalanceCents],
    ]);
  }
  function downloadJournal(){
    if(!journal?.rows.length)return;
    const includesCorrections=hasPaymentCorrections(journal);
    const includesFundsApplications=reportVersion(journal)===3;
    downloadFinanceHistory('crest-fictional-journal-page-'+journal.throughOn+'.csv',[
      ['Through date','Timezone','Currency','Observed UTC','Coverage'],
      [journal.throughOn,journal.timeZone,journal.currency,journal.observedAt,'Current page of the fictional partial ledger.'],
      [],
      ['Date','Account code','Account','Purpose','Debit cents','Credit cents','Entry ID','Event ID','Source operation ID',
        ...(includesCorrections?['Posting template','Payment correction ID','Customer funds lot ID']:[]),
        ...(includesFundsApplications?['Customer funds application ID']:[])],
      ...journal.rows.map(row=>[row.effectiveOn,row.code,row.name,row.purpose,row.debitCents,row.creditCents,row.entryId,row.eventId,row.operationId,
        ...(hasCorrectionFields(row)?[row.template,row.unapplicationId??'',row.fundLotId??'']:[]),
        ...(includesFundsApplications?['fundApplicationId' in row?row.fundApplicationId??'':'']:[])]),
    ]);
  }
  return <details className="review-card" onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)clear();}}>
    <summary>Fictional trial balance</summary>
    <section className="trial-balance" aria-label="Fictional trial balance">
      <p>Review posted invoices, direct payments and same-day expenses. Opening balances and bank reconciliation are still pending.</p>
      <form onSubmit={event=>{event.preventDefault();void load();}}>
        <label>Through date (optional)<input type="date" value={through} disabled={busy}
          onChange={event=>{setThrough(event.target.value);setBalance(null);setJournal(null);setJournalMessage('');setMessage('');}}/></label>
        <p className="field-help">Leave blank for today in the workspace time zone.</p>
        <button type="submit" className="secondary" disabled={busy}>Load trial balance</button>
      </form>
      <p role="status">{message}</p>
      {balance&&<>
        <p>Through <time dateTime={balance.throughOn}>{balance.throughOn}</time> · USD · {balance.timeZone}</p>
        {balance.coverageStart&&<p className="field-help">First included posting {balance.coverageStart} · {balance.postedEventCount} posted {balance.postedEventCount==='1'?'event':'events'}</p>}
        {hasPaymentCorrections(balance)&&<p className="field-help">{reportVersion(balance)===3
          ?'Includes payment corrections and customer funds applications. Customer funds held match the ledger through this date.'
          :'Includes payment corrections. Customer funds held match the ledger through this date.'}</p>}
        {balance.rows.length>0&&<table>
          <caption>Net balance by account</caption>
          <thead><tr><th scope="col">Account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
          <tbody>{balance.rows.map(row=>{
            const net=BigInt(row.balanceCents);
            return <tr key={row.accountId}>
              <th scope="row"><span>{row.code}</span> {row.name}{!row.active&&<small>Archived</small>}</th>
              <td>{net>0n?usd(net.toString()):'—'}</td><td>{net<0n?usd((-net).toString()):'—'}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr><th scope="row">Total</th><td>{usd(balance.totals.debitBalanceCents)}</td>
            <td>{usd(balance.totals.creditBalanceCents)}</td></tr></tfoot>
        </table>}
        <button type="button" className="secondary" onClick={download}>Download trial balance CSV</button>
        {balance.rows.length>0&&<details className="review-card" onToggle={event=>{
          if(!event.currentTarget.open&&event.target===event.currentTarget){
            if(active.current){active.current.abort();active.current=null;setBusy(false);}
            setJournal(null);setAccount('');setJournalMessage('');
          }
        }}>
          <summary>Journal entries</summary>
          <label htmlFor="trial-balance-journal-account">Account (optional)</label>
          <select id="trial-balance-journal-account" value={account} disabled={busy}
            onChange={event=>{setAccount(event.target.value);setJournal(null);setJournalMessage('');}}>
            <option value="">All posted accounts</option>
            {balance.rows.map(row=><option key={row.accountId} value={row.accountId}>{row.code} · {row.name}</option>)}
          </select>
          <button type="button" className="secondary" disabled={busy} onClick={()=>void loadJournal()}>Load journal entries</button>
          <p role="status">{journalMessage}</p>
          {!!journal?.rows.length&&<>
            <p className="field-help">Each page reflects a fresh read of posted records.</p>
            <table>
              <caption>Posted journal page</caption>
              <thead><tr><th scope="col">Date and account</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
              <tbody>{journal.rows.map(row=>{
                const correction=hasCorrectionFields(row)&&row.template==='P05'?row:null;
                const application='fundApplicationId' in row&&row.template==='P04'?row:null;
                return <tr key={row.lineId}>
                  <th scope="row">
                    <time dateTime={row.effectiveOn}>{row.effectiveOn}</time><small>{row.code} · {row.name}</small>
                    {correction&&<>
                      <small>{correction.purpose==='unapply_ar'?'Payment correction · Invoice reopened':'Payment correction · Customer funds held'}</small>
                      <details>
                        <summary>Source references</summary>
                        <small>Correction {correction.unapplicationId}</small>
                        {correction.fundLotId&&<small>Customer funds lot {correction.fundLotId}</small>}
                      </details>
                    </>}
                    {application&&<>
                      <small>{application.purpose==='apply_ar'?'Customer funds · Invoice balance reduced':'Customer funds · Held balance reduced'}</small>
                      <details>
                        <summary>Source references</summary>
                        <small>Application {application.fundApplicationId}</small>
                        {application.fundLotId&&<small>Customer funds lot {application.fundLotId}</small>}
                      </details>
                    </>}
                  </th>
                  <td>{row.debitCents==='0'?'—':usd(row.debitCents)}</td>
                  <td>{row.creditCents==='0'?'—':usd(row.creditCents)}</td>
                </tr>;
              })}</tbody>
            </table>
            {journal.nextAfterLineId&&<button type="button" className="secondary" disabled={busy} onClick={()=>void loadJournal(true)}>Next journal page</button>}
            <button type="button" className="secondary" onClick={downloadJournal}>Download journal page CSV</button>
          </>}
        </details>}
      </>}
    </section>
  </details>;
}
