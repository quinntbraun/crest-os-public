'use client';

import { useEffect, useRef, useState } from 'react';
import { financeAccounts } from '../../../client/finance-accounts';
import type { FinanceAccountContext } from '../../../client/finance-accounts';

type Editor = Awaited<ReturnType<typeof financeAccounts.readInvoiceTaxMapping>>;
type MappingReference = Parameters<typeof financeAccounts.lookupInvoiceTaxMapping>[1];

export function InvoiceTaxPayableSetup({ businessId, jurisdiction, issueDate, onSaved }: {
  businessId: string;
  jurisdiction: string;
  issueDate: string;
  onSaved: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [date, setDate] = useState(issueDate);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const attempted = useRef<MappingReference | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  function clear() {
    active.current?.abort();
    active.current=null;
    setBusy(false);
    setEditor(null);
    setMessage('');
    setReason('');
  }

  async function run(action: (context: FinanceAccountContext, signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller=new AbortController();
    active.current=controller;
    const {signal}=controller;
    setBusy(true);
    setMessage('Checking tax payable settings…');
    try {
      const context=await financeAccounts.context(signal);
      if (signal.aborted) return;
      if (context.businessId!==businessId || !context.invoiceIssue) {
        setMessage('Tax payable settings are unavailable for this workspace.');
        return;
      }
      await action(context,signal);
    } catch {
      if (!signal.aborted) {
        setEditor(null);
        setMessage(attempted.current
          ? 'Crest could not confirm approval. Reload the saved mapping before making another change.'
          : 'Crest could not load the saved mapping. Try loading it again.');
      }
    } finally {
      if (active.current===controller) {
        active.current=null;
        setBusy(false);
      }
    }
  }

  function load() {
    return run(async (context,signal)=>{
      const original=attempted.current
        ? await financeAccounts.lookupInvoiceTaxMapping(context,attempted.current,signal)
        : null;
      if (signal.aborted) return;
      if (original?.state==='conflict') {
        setMessage('The original approval conflicts with a saved operation. Review it before making another change.');
        return;
      }
      const saved=await financeAccounts.readInvoiceTaxMapping(context,jurisdiction,signal);
      if (signal.aborted) return;
      const matches=original?.state==='committed';
      const absent=original?.state==='absent';
      attempted.current=null;
      setEditor(saved);
      setMessage(matches?'Original approval confirmed. Check invoice tax again.':
        absent?'The approval was not found. Review the current mapping before approving again.':
          saved.account?'Saved mapping loaded.':'Create or reopen account 2100 in Fictional account setup.');
      if (matches) onSaved();
    });
  }

  function approve() {
    if (!editor?.account || !reason.trim() || !date || attempted.current) return;
    const accountId=editor.account.id;
    return run(async (context,signal)=>{
      if (context.writeState!=='ready' || !context.recoveryEpoch) {
        setMessage('Mapping changes are paused.');
        return;
      }
      const operationId=crypto.randomUUID();
      const reference={operationId,recoveryEpoch:context.recoveryEpoch,jurisdiction,expectedVersion:editor.latest?.version??'0'};
      attempted.current=reference;
      const result=await financeAccounts.approveInvoiceTaxMapping(context,{
        ...reference,
        accountId,effectiveFrom:date,reason:reason.trim(),
      },signal);
      if (signal.aborted) return;
      attempted.current=null;
      setEditor(null);
      setReason('');
      setMessage(result.state==='committed'?'Mapping approved. Check invoice tax again.':
        result.state==='refused'&&result.reason==='INVOICE_TAX_MAPPING_EFFECTIVE_ORDER_REQUIRED'
          ? 'Choose an effective date after the latest saved version.'
          : 'Crest refused the approval. Reload the saved mapping before making another change.');
      if (result.state==='committed') onSaved();
    });
  }

  return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
    <summary>Tax payable for {jurisdiction}</summary>
    <section aria-label={'Tax payable mapping for '+jurisdiction} aria-busy={busy}>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Load saved mapping</button>
      <p role="status">{message}</p>
      {editor?.latest && <p>Version {editor.latest.version} · {editor.latest.accountId?'Approved':'Closed'} · Effective {editor.latest.effectiveFrom}</p>}
      {editor?.account && <>
        <p>{editor.account.code} · {editor.account.name}</p>
        <label>Effective date<input type="date" value={date} disabled={busy} onChange={event=>setDate(event.target.value)}/></label>
        <label>Reason for approval<input maxLength={1000} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
        <button type="button" className="secondary" disabled={busy||!date||!reason.trim()} onClick={()=>void approve()}>Approve mapping</button>
      </>}
    </section>
  </details>;
}
