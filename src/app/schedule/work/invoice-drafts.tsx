'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthenticationError } from '../../../client/authentication';
import {
  clearPendingInvoiceDraft, downloadFinanceHistory, financeAccounts, readPendingInvoiceDraft, readPendingInvoiceIssue, retainPendingInvoiceDraft,
} from '../../../client/finance-accounts';
import type { FinanceAccountContext } from '../../../client/finance-accounts';
import type { InvoiceDraftInput, InvoiceDraftReference } from '../../../bookkeeping/invoice-draft-contract';
import { invoicePreparationExportColumns } from '../../../bookkeeping/invoice-preparation-contract';
import { quoteMoney } from '../../../commercial/quote-pricing';

import { InvoiceIssueTaxReview, IssuedInvoiceDetails } from './invoice-issue-tax-review';
import type { IssuedInvoice } from './invoice-issue-tax-review';

type DraftPage = Awaited<ReturnType<typeof financeAccounts.invoiceDrafts>>;
type SavedDraft = Extract<Awaited<ReturnType<typeof financeAccounts.readInvoiceDraft>>, {state:'found'}>;
type Preparation = Awaited<ReturnType<typeof financeAccounts.invoicePreparation>>;
const dueDateFormat = new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const formatDue = (date:string) => dueDateFormat.format(new Date(date+'T12:00:00Z'));

export function InvoiceDrafts({ businessId, jobId, canPrepare }: { businessId:string; jobId:string; canPrepare:boolean }) {
  const [page, setPage] = useState<DraftPage | null>(null);
  const [draft, setDraft] = useState<SavedDraft | null>(null);
  const [scope, setScope] = useState<Preparation | null>(null);
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(false);
  const [issueTaxAvailable, setIssueTaxAvailable] = useState(false);
  const [issuedDraft, setIssuedDraft] = useState<string | null>(null);
  const [openedInvoice, setOpenedInvoice] = useState<IssuedInvoice | null>(null);
  const [canChange, setCanChange] = useState(false);
  const [directReceipts, setDirectReceipts] = useState(false);
  const [paymentCorrections, setPaymentCorrections] = useState(false);
  const [fundApplications, setFundApplications] = useState(false);
  const [heldTips, setHeldTips] = useState(false);
  const [invoiceCredits, setInvoiceCredits] = useState(false);
  const [paidInvoiceCredits, setPaidInvoiceCredits] = useState(false);
  const [serviceRefunds, setServiceRefunds] = useState(false);
  const [due, setDue] = useState('');
  const [outcomes, setOutcomes] = useState<readonly string[]>([]);
  const [cancelReason, setCancelReason] = useState('');
  const [pending, setPending] = useState(false);
  const [reviewable, setReviewable] = useState(false);
  const [retirementReason, setRetirementReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  function suspend() {
    request.current?.abort();
    request.current = null;
    setPage(null); setDraft(null); setScope(null); setDue(''); setOutcomes([]); setCancelReason('');
    setEditing(false); setCurrent(false); setCanChange(false); setIssueTaxAvailable(false); setBusy(false); setMessage('');
    setIssuedDraft(null);
    setOpenedInvoice(null);
    setDirectReceipts(false);
    setPaymentCorrections(false);
    setFundApplications(false);
    setHeldTips(false);
    setInvoiceCredits(false);
    setPaidInvoiceCredits(false);
    setServiceRefunds(false);
    setReviewable(false); setRetirementReason('');
  }

  useEffect(() => {
    function hidden() { if (document.visibilityState === 'hidden') suspend(); }
    window.addEventListener('pagehide', suspend);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      request.current?.abort();
      window.removeEventListener('pagehide', suspend);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [jobId, businessId]);

  async function run(action: (context:FinanceAccountContext, signal:AbortSignal) => Promise<void>, closeReason?:string) {
    if (request.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    setBusy(true);
    setMessage('Checking saved drafts…');
    try {
      const context = await financeAccounts.context(signal);
      if (signal.aborted) return;
      if (context.businessId !== businessId || !context.invoiceDrafts) {
        setMessage('Invoice drafts are unavailable for this workspace.');
        return;
      }
      setCanChange(context.writeState === 'ready');
      setIssueTaxAvailable(context.invoiceIssueTaxReview);
      setDirectReceipts(context.directReceipts===true);
      setPaymentCorrections(context.paymentCorrections===true);
      setFundApplications(context.fundApplications===true);
      setHeldTips(context.heldTips===true);
      setInvoiceCredits(context.invoiceCredits===true);
      setPaidInvoiceCredits(context.paidInvoiceCredits===true);
      setServiceRefunds(context.serviceRefunds===true);
      const stored = readPendingInvoiceDraft();
      setPending(stored !== null);
      setReviewable(false);
      if (stored) {
        if (stored.businessId !== businessId || stored.binding !== context.binding || stored.reference.jobId !== jobId) {
          setMessage('An interrupted invoice draft belongs to a different signed-in job. Open that job in its original session to review it.');
          return;
        }
        const saved = closeReason
          ? await financeAccounts.retireInvoiceDraft(context, stored.reference,closeReason,signal)
          : await financeAccounts.invoiceDraftOperation(context, stored.reference,signal);
        if (signal.aborted) return;
        if (saved.state === 'absent' || saved.state === 'conflict') {
          setReviewable(saved.state === 'absent' && context.writeState === 'ready');
          setMessage(saved.state === 'absent' ? 'No completed draft save was found. You can close the interrupted attempt before saving again.'
            : 'The interrupted draft reference conflicts with a saved operation. Keep it for review.');
          return;
        }
        clearPendingInvoiceDraft(stored);
        setPending(false);
        setRetirementReason('');
        if(saved.state==='retired'){
          setDraft(null); setEditing(false); setScope(null); setPage(null);
          setMessage('The interrupted draft attempt was closed. You can load saved drafts again.');
          return;
        }
        const found = await financeAccounts.readInvoiceDraft(context,saved.receipt.draftId,saved.receipt.revision,signal);
        if (signal.aborted) return;
        if (found.state !== 'found') throw Error();
        setDraft(found); setEditing(false); setCurrent(false); setScope(null);
        setMessage('The original invoice draft save was confirmed.');
        return;
      }
      await action(context, signal);
    } catch (error) {
      if (signal.aborted) return;
      setCanChange(false); setIssueTaxAvailable(false);
      setPage(null); setDraft(null); setScope(null); setDue(''); setOutcomes([]); setCancelReason('');
      setEditing(false); setCurrent(false);
      try { setPending(readPendingInvoiceDraft() !== null); } catch { setPending(true); }
      setMessage(error instanceof AuthenticationError && error.kind === 'denied'
        ? 'Sign in again to review invoice drafts.'
        : 'Crest could not verify this request. Check saved drafts before trying again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        status.current?.focus();
      }
    }
  }

  function closeInterruptedDraft() {
    const reason=retirementReason.trim();
    if(reason)void run(async()=>{setMessage('There is no interrupted draft to close.');},reason);
  }

  function load(after: string | null = null) {
    void run(async (context,signal) => {
      const loaded = await financeAccounts.invoiceDrafts(context,jobId,after,signal);
      if (signal.aborted) return;
      setPage(after && page ? {hasMore:loaded.hasMore,rows:[...page.rows,...loaded.rows]} : loaded);
      setMessage(loaded.rows.length ? 'Saved invoice drafts loaded.' : 'No saved invoice drafts found.');
    });
  }

  function open(draftId: string, revision: string | null = null) {
    void run(async (context,signal) => {
      setOpenedInvoice(null);
      const loaded = await financeAccounts.readInvoiceDraft(context,draftId,revision,signal);
      if (signal.aborted) return;
      if (loaded.state !== 'found' || loaded.receipt.jobId !== jobId) throw Error();
      let openedIssuedInvoice=false;
      if (revision===null && context.invoiceIssue && !readPendingInvoiceIssue()) {
        const invoice = await financeAccounts.readIssuedInvoice(context,draftId,signal);
        if (signal.aborted) return;
        if (invoice.state==='issued') {
          setOpenedInvoice(invoice); setIssuedDraft(draftId);
          openedIssuedInvoice=true;
        }
      }
      setDraft(loaded); setCurrent(revision === null); setEditing(false); setScope(null); setCancelReason('');
      setMessage(openedIssuedInvoice?'Issued invoice loaded.':
        revision === null ? 'Saved invoice draft loaded.' : 'Earlier draft revision loaded.');
    });
  }

  function edit(saved: SavedDraft | null) {
    void run(async (context,signal) => {
      if (signal.aborted) return;
      if(context.writeState!=='ready'){setMessage('Draft changes are paused.');return;}
      setDraft(saved); setDue(saved?.receipt.dueOn ?? ''); setOutcomes(saved?.lines.map(line=>line.outcomeId) ?? []);
      setScope(null); setCancelReason(''); setEditing(true); setMessage('');
    });
  }

  function loadScope() {
    void run(async (context,signal) => {
      const loaded = await financeAccounts.invoicePreparation(context,jobId,signal);
      if (signal.aborted) return;
      setScope(loaded);
      setMessage(loaded.state === 'ready' ? 'Choose the completed portions for this draft.'
        : 'You can save a draft now and add the completed work later.');
    });
  }

  function save(input: InvoiceDraftInput) {
    void run(async (context,signal) => {
      if (!context.recoveryEpoch || context.writeState !== 'ready') {
        setMessage('Draft changes are paused. Saved drafts remain available.'); return;
      }
      const reference:InvoiceDraftReference = {
        operationId:crypto.randomUUID(), recoveryEpoch:context.recoveryEpoch, draftId:draft?.receipt.draftId ?? crypto.randomUUID(),
        jobId, expectedRevision:draft?.receipt.revision ?? '0',
      };
      const stored = retainPendingInvoiceDraft(context,reference);
      setPending(true);
      const saved = await financeAccounts.saveInvoiceDraft(context,reference,input,signal);
      if (signal.aborted) return;
      clearPendingInvoiceDraft(stored);
      setPending(false);
      if (saved.state !== 'committed') {
        setEditing(false); setCurrent(false);
        setMessage('The draft change was declined. Reload the current draft and review the saved work.');
        return;
      }
      setEditing(false); setCurrent(false); setScope(null); setPage(null);
      setMessage(saved.receipt.state === 'cancelled' ? 'Draft cancelled. Its history is retained.' : 'Invoice draft saved.');
      const loaded = await financeAccounts.readInvoiceDraft(context,reference.draftId,null,signal);
      if (signal.aborted) return;
      if (loaded.state !== 'found') throw Error();
      setDraft(loaded); setCurrent(true);
    });
  }

  function download(saved: SavedDraft) {
    const receipt = saved.receipt;
    const prefix = [receipt.draftId, receipt.revision, receipt.state, receipt.dueOn ?? '', receipt.jobId, receipt.customerId];
    downloadFinanceHistory('crest-invoice-draft.csv',[
      ['draftId','revision','state','dueOn','jobId','customerId',...invoicePreparationExportColumns],
      ...(saved.lines.length ? saved.lines.map(line=>[...prefix,...invoicePreparationExportColumns.map(key=>line[key] ?? '')])
        : [[...prefix,...invoicePreparationExportColumns.map(()=> '')]]),
    ]);
  }

  return <details onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Invoice drafts</summary>
    <section aria-label="Invoice drafts" aria-busy={busy}>
      <p className="field-help">Save work for invoice review. Drafts have no invoice number and make no accounting entries.</p>
      <button type="button" className="secondary" onClick={()=>load()} disabled={busy}>
        {pending ? 'Check interrupted draft save' : 'Load saved drafts'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending && reviewable && <form onSubmit={event=>{event.preventDefault();closeInterruptedDraft();}}>
        <label>Reason for closing the interrupted attempt
          <input required maxLength={1000} value={retirementReason} onChange={event=>setRetirementReason(event.target.value)} disabled={busy}/>
        </label>
        <button type="submit" className="secondary" disabled={busy}>Close interrupted draft attempt</button>
      </form>}
      {page && <>
        {page.rows.length>0 && <ul className="invoice-draft-list" aria-label="Saved drafts">
          {page.rows.map(row=><li key={row.draftId}>
            <button type="button" className="secondary" disabled={busy} onClick={()=>open(row.draftId)}>
              {row.state === 'cancelled' ? 'Open cancelled draft' : 'Open invoice draft'}
            </button>
            <p>Revision {row.revision} · {row.lineCount} completed portions{row.dueOn ? ' · Due '+formatDue(row.dueOn) : ''}</p>
          </li>)}
        </ul>}
        {page.hasMore && <button type="button" className="secondary" disabled={busy} onClick={()=>load(page.rows.at(-1)?.draftId)}>
          Load more drafts
        </button>}
        {canPrepare && canChange && !editing && !pending && <button type="button" className="primary-action" disabled={busy} onClick={()=>edit(null)}>New invoice draft</button>}
      </>}
      {editing && !pending && <form onSubmit={event=>{
        event.preventDefault();save({dueOn:due || null,outcomes,cancelReason:null});
      }}>
        <label>Due date (optional)<input type="date" value={due} onChange={event=>setDue(event.target.value)} disabled={busy}/></label>
        <p className="field-help">Leave blank to use the day the invoice is issued.</p>
        <button type="button" className="secondary" disabled={busy} onClick={loadScope}>Load completed portions</button>
        {scope?.state === 'ready' && <fieldset>
          <legend>Completed portions to include</legend>
          {scope.lines.length>180 && <p className="field-help">Choose up to 180 portions for this draft.</p>}
          {scope.lines.map(line=><label key={line.outcomeId} className="checkbox">
            <input type="checkbox" checked={outcomes.includes(line.outcomeId)} disabled={busy || (!outcomes.includes(line.outcomeId) && outcomes.length>=180)}
              onChange={event=>setOutcomes(event.target.checked ? [...outcomes,line.outcomeId] : outcomes.filter(id=>id!==line.outcomeId))}/>
            {line.description} · {quoteMoney(line.inclusiveCents)}
          </label>)}
        </fieldset>}
        <button type="submit" className="primary-action" disabled={busy}>Save invoice draft</button>
        <button type="button" className="secondary" disabled={busy} onClick={()=>{setEditing(false);setScope(null);}}>Close editor</button>
      </form>}
      {!editing && draft && <section aria-label="Saved draft">
        {openedInvoice && <section aria-label="Issued invoice"><IssuedInvoiceDetails invoice={openedInvoice}
          receiptBusinessId={directReceipts?businessId:undefined} paymentCorrections={paymentCorrections}
          fundApplications={fundApplications} heldTips={heldTips} invoiceCredits={invoiceCredits} paidInvoiceCredits={paidInvoiceCredits} serviceRefunds={serviceRefunds}/></section>}
        <h4>{issuedDraft===draft.receipt.draftId ? 'Draft history' : draft.receipt.state === 'cancelled' ? 'Cancelled draft' : 'Saved draft'}</h4>
        <p>Revision {draft.receipt.revision}{draft.receipt.dueOn ? ' · Due '+formatDue(draft.receipt.dueOn) : ''}</p>
        {draft.receipt.reason && <p>{draft.receipt.reason}</p>}
        {draft.lines.length === 0 && <p className="field-help">No completed portions saved yet.</p>}
        {draft.lines.length > 0 && <ul className="service-list">{draft.lines.map(line=><li key={line.outcomeId}>
          {line.description} · {quoteMoney(line.inclusiveCents)}
        </li>)}</ul>}
        <button type="button" className="secondary" onClick={()=>download(draft)}>Download draft (CSV)</button>
        {BigInt(draft.receipt.revision)>1n && <button type="button" className="secondary" disabled={busy}
          onClick={()=>open(draft.receipt.draftId,String(BigInt(draft.receipt.revision)-1n))}>Previous revision</button>}
        {!current && <button type="button" className="secondary" disabled={busy} onClick={()=>open(draft.receipt.draftId)}>Open current revision</button>}
        {current && issueTaxAvailable && !pending && !openedInvoice && draft.receipt.state === 'draft' && draft.lines.length > 0 &&
          <InvoiceIssueTaxReview key={draft.receipt.draftId+':'+draft.receipt.revision} businessId={businessId} jobId={jobId}
            draftId={draft.receipt.draftId} revision={draft.receipt.revision} lines={draft.lines}
            directReceipts={directReceipts} paymentCorrections={paymentCorrections} fundApplications={fundApplications} heldTips={heldTips}
            invoiceCredits={invoiceCredits} paidInvoiceCredits={paidInvoiceCredits} serviceRefunds={serviceRefunds}
            onIssued={()=>setIssuedDraft(draft.receipt.draftId)}/>}
        {current && canChange && !pending && issuedDraft!==draft.receipt.draftId && draft.receipt.state === 'draft' && <>
          {canPrepare && <button type="button" className="secondary" disabled={busy} onClick={()=>edit(draft)}>Edit draft</button>}
          <details>
            <summary>Cancel this draft</summary>
            <form onSubmit={event=>{
              event.preventDefault();
              const reason=cancelReason.trim();
              if(reason)save({dueOn:null,outcomes:[],cancelReason:reason});
            }}>
              <label>Reason for cancellation<input required maxLength={1000} value={cancelReason} onChange={event=>setCancelReason(event.target.value)} disabled={busy}/></label>
              <button type="submit" className="secondary" disabled={busy}>Confirm draft cancellation</button>
            </form>
          </details>
        </>}
      </section>}
    </section>
  </details>;
}
