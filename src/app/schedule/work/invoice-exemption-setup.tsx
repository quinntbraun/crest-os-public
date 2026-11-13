'use client';

import { useEffect, useRef, useState } from 'react';
import { financeAccounts } from '../../../client/finance-accounts';
import type { FinanceAccountContext } from '../../../client/finance-accounts';

type Target=Parameters<typeof financeAccounts.readInvoiceExemption>[1];
type Evidence=Awaited<ReturnType<typeof financeAccounts.readInvoiceExemption>>;

export function InvoiceExemptionSetup({ businessId, target, issueDate, onSaved }: {
  businessId:string; target:Target; issueDate:string; onSaved:()=>void;
}) {
  const [loaded,setLoaded]=useState(false);
  const [evidence,setEvidence]=useState<Evidence>(null);
  const [validFrom,setValidFrom]=useState(issueDate);
  const [validThrough,setValidThrough]=useState(issueDate);
  const [reference,setReference]=useState('');
  const [reason,setReason]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef<AbortController|null>(null);
  const attempted=useRef<string|null>(null);
  useEffect(()=>()=>active.current?.abort(),[]);

  function close() {
    active.current?.abort();
    active.current=null;
    setBusy(false); setLoaded(false); setEvidence(null); setMessage('');
    setReference(''); setReason(''); setValidFrom(issueDate); setValidThrough(issueDate);
  }

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>) {
    if(active.current)return;
    const controller=new AbortController();
    active.current=controller;
    setBusy(true); setMessage('Checking exemption evidence…');
    try {
      const context=await financeAccounts.context(controller.signal);
      if(controller.signal.aborted)return;
      if(context.businessId!==businessId||!context.invoiceIssue){
        setMessage('Exemption review is unavailable.');return;
      }
      await action(context,controller.signal);
    } catch {
      if(!controller.signal.aborted){
        setLoaded(false); setEvidence(null);
        setMessage(attempted.current?'Crest could not verify the approval. Reload saved evidence.':'Crest could not load saved evidence.');
      }
    } finally {
      if(active.current===controller){active.current=null;setBusy(false);}
    }
  }

  function load() {
    return run(async(context,signal)=>{
      const saved=await financeAccounts.readInvoiceExemption(context,target,signal);
      if(signal.aborted)return;
      const confirmed=attempted.current!==null&&saved?.operationId===attempted.current;
      attempted.current=null;
      setEvidence(saved); setLoaded(true);
      setMessage(confirmed?'Original approval confirmed. Check invoice tax again.':saved?'Saved evidence loaded.':'No evidence saved for this portion.');
      if(confirmed)onSaved();
    });
  }

  function approve() {
    if(!loaded||attempted.current||!reference.trim()||!reason.trim()||!validFrom||!validThrough||validThrough<validFrom)return;
    return run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch){setMessage('Evidence changes are paused.');return;}
      const operationId=crypto.randomUUID();
      attempted.current=operationId;
      const result=await financeAccounts.approveInvoiceExemption(context,{
        target,operationId,recoveryEpoch:context.recoveryEpoch,expectedVersion:evidence?.version??'0',
        validFrom,validThrough,evidenceReference:reference.trim(),reason:reason.trim(),
      },signal);
      if(signal.aborted)return;
      attempted.current=null;
      setLoaded(false); setReference(''); setReason('');
      setMessage(result.state==='committed'?'Evidence approved. Check invoice tax again.':'The evidence changed. Reload before approving.');
      if(result.state==='committed')onSaved();
    });
  }

  return <details onToggle={event=>{if(!event.currentTarget.open)close();}}>
    <summary>Review exemption evidence</summary>
    <section aria-label="Exemption evidence" aria-busy={busy}>
      <p className="field-help">Approve evidence for this customer, portion and jurisdiction. Enter a reference to the source document.</p>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Load saved evidence</button>
      <p role="status">{message}</p>
      {evidence && <p>Version {evidence.version} · {evidence.validFrom} to {evidence.validThrough}</p>}
      {loaded && <>
        <label>Valid from<input type="date" value={validFrom} disabled={busy} onChange={event=>setValidFrom(event.target.value)}/></label>
        <label>Valid through<input type="date" value={validThrough} min={validFrom} disabled={busy} onChange={event=>setValidThrough(event.target.value)}/></label>
        <label>Evidence reference<input maxLength={1000} value={reference} disabled={busy} onChange={event=>setReference(event.target.value)}/></label>
        <label>Reason for approval<input maxLength={1000} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
        <button type="button" className="secondary" onClick={()=>void approve()}
          disabled={busy||!reference.trim()||!reason.trim()||!validFrom||!validThrough||validThrough<validFrom}>Approve evidence</button>
      </>}
    </section>
  </details>;
}
