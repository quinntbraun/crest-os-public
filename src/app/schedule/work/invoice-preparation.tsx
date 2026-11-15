'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthenticationError } from '../../../client/authentication';
import { downloadFinanceHistory, financeAccounts } from '../../../client/finance-accounts';
import { invoicePreparationExportColumns } from '../../../bookkeeping/invoice-preparation-contract';
import { quoteMoney } from '../../../commercial/quote-pricing';

type Preparation = Awaited<ReturnType<typeof financeAccounts.invoicePreparation>>;

export function InvoicePreparation({ businessId, jobId }: { businessId: string; jobId: string }) {
  const [result, setResult] = useState<Preparation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    function clear() {
      active.current?.abort();
      active.current = null;
      setResult(null);
      setMessage('');
      setBusy(false);
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') clear();
    }
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active.current?.abort();
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [businessId, jobId]);

  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setResult(null);
    setBusy(true);
    setMessage('Checking completed work…');
    try {
      const context = await financeAccounts.context(signal);
      if (signal.aborted) return;
      if (context.businessId !== businessId || !context.invoicePreparation) {
        setMessage('Invoice preparation is unavailable for this workspace.');
        return;
      }
      const saved = await financeAccounts.invoicePreparation(context, jobId, signal);
      if (signal.aborted) return;
      setResult(saved);
      setMessage(saved.state === 'ready' ? 'Completed work loaded.'
        : saved.state === 'work_not_completed' ? 'Finish the job before reviewing completed work.'
          : 'Crest could not find this job in your workspace.');
    } catch (error) {
      if (signal.aborted) return;
      setMessage(error instanceof AuthenticationError && error.kind === 'denied'
        ? 'Sign in again to review completed work.' : 'Crest could not verify the completed work. Try again.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        status.current?.focus();
      }
    }
  }

  return <section aria-label="Invoice preparation" aria-busy={busy}>
    <h3>Invoice preparation</h3>
    <p className="field-help">Review completed portions of the accepted work. Amounts are before invoice tax review. No invoice is issued here.</p>
    <button type="button" className="secondary" disabled={busy} onClick={() => void load()}>
      {result ? 'Reload completed work' : 'Load completed work'}
    </button>
    <p ref={status} role="status" tabIndex={-1}>{message}</p>
    {result?.state === 'ready' && <>
     <ul className="service-list" aria-label="Completed portions">
      {result.lines.map(line => <li key={line.outcomeId}>
        <strong className="completion-text">{line.description}</strong>
        <p>{quoteMoney(line.inclusiveCents)} agreed for this portion</p>
        {line.discountInclusiveCents !== '0' && <p className="field-help">{quoteMoney(line.discountInclusiveCents)} agreed discount included</p>}
      </li>)}
     </ul>
     <button type="button" className="secondary" onClick={() => downloadFinanceHistory('crest-completed-work.csv',[
       ['jobId','customerId','completedAt',...invoicePreparationExportColumns],
       ...result.lines.map(line=>[jobId,result.customerId,result.completedAt,...invoicePreparationExportColumns.map(key=>line[key]??'')]),
     ])}>Download completed work (CSV)</button>
    </>}
  </section>;
}
