'use client';

import { useEffect, useRef, useState } from 'react';
import { financeAccounts } from '../../../client/finance-accounts';
import type { FinanceAccountContext } from '../../../client/finance-accounts';
import type { parseInvoiceSetupRequest } from '../../../bookkeeping/invoice-setup-contract';

type Setup=Awaited<ReturnType<typeof financeAccounts.readInvoiceSetup>>;
type SetupRequest=ReturnType<typeof parseInvoiceSetupRequest>;

export function InvoiceSetup({businessId}:{businessId:string}){
  const [setup,setSetup]=useState<Setup|null>(null);
  const [label,setLabel]=useState('');
  const [seriesReason,setSeriesReason]=useState('');
  const [date,setDate]=useState('');
  const [periodReason,setPeriodReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null);
  const attempted=useRef<{operationId:string;kind:SetupRequest['kind'];startsOn?:string}|null>(null);

  function clear(){
    active.current?.abort(); active.current=null;
    setSetup(null); setLabel(''); setSeriesReason(''); setDate(''); setPeriodReason(''); setBusy(false); setMessage('');
  }
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')clear();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',clear);
    return ()=>{
      active.current?.abort();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pagehide',clear);
    };
  },[]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>){
    if(active.current)return;
    const controller=new AbortController();
    active.current=controller;
    const {signal}=controller;
    setBusy(true); setMessage('Checking invoice setup…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(context.businessId!==businessId||!context.invoiceIssue){setMessage('Invoice setup is unavailable.');return;}
      await action(context,signal);
    }catch{
      if(!signal.aborted){
        setSetup(null);
        setMessage(attempted.current?'Crest could not confirm the save. Load saved setup before trying again.':'Crest could not load invoice setup.');
      }
    }finally{
      if(active.current===controller){active.current=null;setBusy(false);}
    }
  }

  function load(){
    return run(async(context,signal)=>{
      const attemptedWrite=attempted.current;
      const saved=await financeAccounts.readInvoiceSetup(context,attemptedWrite?.startsOn??null,signal);
      if(signal.aborted)return;
      const matched=attemptedWrite?.operationId===(attemptedWrite?.kind==='accounting_period'?saved.period?.operationId:saved.series?.operationId);
      attempted.current=null;
      setSetup(saved); setDate(saved.period?.startsOn??saved.requestedOn);
      setMessage(attemptedWrite?(matched?'Original setup save confirmed.':'The original setup save was not found. Review the saved state.'):
        'Saved invoice setup loaded.');
    });
  }

  function save(request:SetupRequest){
    return run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch){setMessage('Invoice setup changes are paused.');return;}
      const operationId=crypto.randomUUID();
      attempted.current={operationId,kind:request.kind,...(request.kind==='accounting_period'?{startsOn:request.startsOn}:{})};
      const result=await financeAccounts.saveInvoiceSetup(context,{operationId,recoveryEpoch:context.recoveryEpoch,request},signal);
      if(signal.aborted)return;
      const saved=await financeAccounts.readInvoiceSetup(context,request.kind==='accounting_period'?request.startsOn:null,signal);
      if(signal.aborted)return;
      attempted.current=null;
      setSetup(saved); setDate(saved.period?.startsOn??saved.requestedOn); setLabel(''); setSeriesReason(''); setPeriodReason('');
      setMessage(result.state==='committed'?'Invoice setup saved.':'The setup changed. Review the saved values.');
    });
  }

  return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
    <summary>Invoice numbering and periods</summary>
    <section aria-label="Fictional invoice setup" aria-busy={busy}>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Load invoice setup</button>
      <p role="status">{message}</p>
      {setup && <>
        <h3>Numbering</h3>
        {setup.series ? <p>Series {setup.series.label} is approved.</p> : <form onSubmit={event=>{
          event.preventDefault(); void save({kind:'invoice_series',label:label.trim(),reason:seriesReason.trim()});
        }}>
          <label>Series label<input required maxLength={80} pattern="[A-Za-z0-9][A-Za-z0-9-]{0,79}" value={label} disabled={busy}
            onChange={event=>setLabel(event.target.value)}/></label>
          <p className="field-help">Use letters, numbers and hyphens. For example, a CREST series starts with CREST-1.</p>
          <label>Reason for approval<input required maxLength={1000} value={seriesReason} disabled={busy}
            onChange={event=>setSeriesReason(event.target.value)}/></label>
          <button className="secondary" disabled={busy||!seriesReason.trim()} type="submit">Approve invoice series</button>
        </form>}
        <h3>Accounting period</h3>
        {setup.period ? <p>{setup.period.startsOn} to {setup.period.throughOn} · {setup.period.state==='open'?'Open':'Locked'} · {setup.timeZone}</p> :
          <form onSubmit={event=>{event.preventDefault(); void save({kind:'accounting_period',startsOn:date,reason:periodReason.trim()});}}>
            <label>Period start date<input required type="date" value={date} disabled={busy} onChange={event=>setDate(event.target.value)}/></label>
            <label>Reason to open period<input required maxLength={1000} value={periodReason} disabled={busy}
              onChange={event=>setPeriodReason(event.target.value)}/></label>
            <button className="secondary" disabled={busy||!periodReason.trim()} type="submit">Open accounting period</button>
          </form>}
      </>}
    </section>
  </details>;
}
