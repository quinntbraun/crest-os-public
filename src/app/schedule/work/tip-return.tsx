'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {parseTipReturnInput} from '../../../bookkeeping/tip-return-contract';
import {quoteDollarsInput, quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingTipReturn, downloadFinanceHistory, financeAccounts, readPendingTipReturn, retainPendingTipReturn}
  from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Options = Awaited<ReturnType<typeof financeAccounts.tipReturnOptions>>;
type Receipt = Extract<Awaited<ReturnType<typeof financeAccounts.lookupTipReturn>>, {state: 'committed'}>['receipt'];
const empty = {tipId: '', channelId: '', amount: '', referenceType: '', transactionId: '', statementReference: '', verification: '', reason: ''};
const title = 'Record a settled tip return';

function centsFromInput(amount: string) {
  try { return BigInt(quoteDollarsInput(amount)); } catch { return 0n; }
}

export function TipReturn({businessId, customerId}: {businessId: string; customerId: string}) {
  const [date, setDate] = useState('');
  const [form, setForm] = useState(empty);
  const [options, setOptions] = useState<Options | null>(null);
  const [pending, setPending] = useState(false);
  const [closable, setClosable] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const active = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const cents = centsFromInput(form.amount);
  const tip = options?.tips.find(item => item.tipRealizationId === form.tipId);
  const channel = options?.channels.find(item => item.channelId === form.channelId);
  const allowedAmount = tip && cents > 0n && cents <= BigInt(tip.availableCents);

  const showOriginal = useCallback(() => {
    try { setPending(readPendingTipReturn() !== null); }
    catch { setPending(true); setMessage('Crest could not read the original return reference.'); }
  }, []);
  const suspend = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setDate(''); setForm(empty); setOptions(null); setPending(false); setClosable(false);
    setCloseReason(''); setReceipt(null); setMessage(''); setBusy(false);
  }, []);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); else showOriginal(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { suspend(); showOriginal(); } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', restored);
    return () => {
      active.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', restored);
    };
  }, [showOriginal, suspend]);

  function run(action: (context: FinanceAccountContext, signal: AbortSignal) => Promise<void>, working: string, failure: string) {
    if (active.current) return;
    const controller = new AbortController(), {signal} = controller;
    active.current = controller;
    setBusy(true); setMessage(working);
    void (async () => {
      try {
        const context = await financeAccounts.context(signal);
        if (signal.aborted) return;
        if (!context.tipReturns || context.businessId !== businessId) {
          setMessage('Return recording is unavailable for this workspace.');
          return;
        }
        await action(context, signal);
      } catch {
        if (!signal.aborted) setMessage(failure);
      } finally {
        if (active.current === controller) {
          active.current = null;
          setBusy(false);
          status.current?.focus();
        }
      }
    })();
  }

  function update(field: keyof typeof empty, value: string) {
    setForm(previous => ({...previous, [field]: value}));
  }

  function recover(reason?: string) {
    run(async (context, signal) => {
      const original = readPendingTipReturn();
      setClosable(false);
      if (!original) { setPending(false); setMessage('There is no interrupted return to check.'); return; }
      if (original.businessId !== businessId || original.binding !== context.binding || original.customerId !== customerId) {
        setMessage('Open the original customer’s invoice in the same sign-in to check this return.');
        return;
      }
      const result = reason
        ? await financeAccounts.retireTipReturn(context, original.reference, reason, signal)
        : await financeAccounts.lookupTipReturn(context, original.reference, signal);
      if (signal.aborted) return;
      if (result.state === 'committed' || result.state === 'retired') {
        if (result.state === 'committed' && result.receipt.customerId !== customerId) throw Error();
        clearPendingTipReturn(original);
        setPending(false); setCloseReason('');
        setReceipt(result.state === 'committed' ? result.receipt : null);
        setMessage(result.state === 'committed' ? 'The original return record was saved.' : 'The original attempt was closed.');
        return;
      }
      setClosable(result.state === 'absent' && context.writeState === 'ready');
      setMessage(result.state === 'absent' ? 'No saved return was found. Close the original attempt before trying again.'
        : 'Crest could not match the original attempt. Its reference was kept for review.');
    }, 'Checking the original return…', 'Crest could not verify the original return. Its reference was kept for review.');
  }

  function load() {
    setOptions(null); setForm(empty); setReceipt(null);
    run(async (context, signal) => {
      if (readPendingTipReturn()) { setPending(true); setMessage('Check the original return first.'); return; }
      const saved = await financeAccounts.tipReturnOptions(context, customerId, date, signal);
      if (signal.aborted) return;
      if (context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      if (!saved.openPeriod) { setMessage('The settlement date must be in an open accounting period.'); return; }
      if (!saved.tips.length) { setMessage('This customer has no recorded tips available to return for that date.'); return; }
      if (!saved.channels.length) { setMessage('No verified bank or wallet is available for that date.'); return; }
      setOptions(saved);
      setMessage('Choose the original tip and match the settled amount to your account record.');
    }, 'Checking eligible tips and accounts…', 'Crest could not verify tips for this settlement date. Check the date and try again.');
  }

  function save() {
    if (!options || !tip || !allowedAmount || !channel) return;
    run(async (context, signal) => {
      if (!context.recoveryEpoch || context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      if (readPendingTipReturn()) { setPending(true); setMessage('Check the original return first.'); return; }
      const reference = {operationId: crypto.randomUUID(), recoveryEpoch: context.recoveryEpoch, tipReturnId: crypto.randomUUID()};
      let input: ReturnType<typeof parseTipReturnInput>;
      try {
        input = parseTipReturnInput({reference, tipRealizationId: tip.tipRealizationId, customerId,
          channelId: channel.channelId, channelVersion: channel.version, actualOn: options.actualOn,
          verifiedCents: String(cents),
          confirmation: form.verification.trim(), reason: form.reason.trim(),
          externalIdentity: {namespace: form.referenceType.trim(), id: form.transactionId.trim(), rawReference: form.statementReference.trim()}});
      } catch { setMessage('Check the settled amount and complete the transaction evidence.'); return; }
      const original = retainPendingTipReturn(context, customerId, reference);
      setPending(true); setForm(empty); setOptions(null);
      const result = await financeAccounts.recordTipReturn(context, input, signal);
      if (signal.aborted) return;
      if (result.state === 'conflict') { setMessage('Check the original return before starting another.'); return; }
      clearPendingTipReturn(original); setPending(false);
      if (result.state === 'refused') {
        setMessage(result.reason === 'external_return_already_recorded' ? 'This transaction reference is already recorded.'
          : 'Crest refused the return. Reload available tips and review the settlement evidence.');
        return;
      }
      setReceipt(result.receipt);
      setMessage('Return record saved.');
    }, 'Saving the settled return…', 'Crest could not confirm the save. Check the original return before starting another.');
  }

  return <details className="direct-receipt invoice-credit service-refund" onToggle={event => {
    if (event.currentTarget.open) showOriginal(); else suspend();
  }}>
    <summary>{title}</summary>
    <section aria-label={title} aria-busy={busy}>
      <p className="field-help">Use this after a tip has been returned through a bank or wallet. Crest records the settled transaction against the original tip.</p>
      {!pending && <form onSubmit={event => { event.preventDefault(); load(); }}>
        <label>Settlement date<input type="date" required value={date} disabled={busy} onChange={event => {
          setDate(event.target.value); setOptions(null); setForm(empty); setReceipt(null); setMessage('');
        }}/></label>
        <button type="submit" className="secondary" disabled={busy}>Load eligible tips</button>
      </form>}
      {pending && <button type="button" className="secondary" disabled={busy} onClick={() => recover()}>Check original return</button>}
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending && closable && <form onSubmit={event => { event.preventDefault(); if (financeAccountReviewReason(closeReason.trim())) recover(closeReason.trim()); }}>
        <label>Reason for closing this attempt<textarea required maxLength={1000} rows={2} value={closeReason} disabled={busy}
          onChange={event => setCloseReason(event.target.value)}/></label>
        <button className="secondary" type="submit" disabled={busy || !financeAccountReviewReason(closeReason.trim())}>Close original attempt</button>
      </form>}
      {!pending && options && <form onSubmit={event => { event.preventDefault(); save(); }}>
        <fieldset disabled={busy}>
          <legend>Settled return</legend>
          <label>Original tip<select required value={form.tipId} onChange={event => update('tipId', event.target.value)}>
            <option value="">Choose the original tip</option>
            {options.tips.map(item => <option key={item.tipRealizationId} value={item.tipRealizationId}>
              {item.realizedOn} · {quoteMoney(item.availableCents)} available · Ref {item.tipRealizationId.slice(-8)}
            </option>)}
          </select></label>
          <label>Returned from<select required value={form.channelId} onChange={event => update('channelId', event.target.value)}>
            <option value="">Choose the bank or wallet</option>
            {options.channels.map(item => <option key={item.channelId} value={item.channelId}>{item.label}</option>)}
          </select></label>
          <label>Settled amount (USD)<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={form.amount}
            onChange={event => update('amount', event.target.value)}/></label>
          {tip && cents > 0n && !allowedAmount && <p className="field-help">The settled amount exceeds the remaining tip balance.</p>}
          <fieldset className="service-refund-evidence"><legend>Transaction evidence</legend>
            <label>Reference type<input required maxLength={80} value={form.referenceType} onChange={event => update('referenceType', event.target.value)}/></label>
            <label>Transaction ID<input required maxLength={200} value={form.transactionId} onChange={event => update('transactionId', event.target.value)}/></label>
            <label>Reference as shown on the account<textarea required maxLength={1000} rows={2} value={form.statementReference}
              onChange={event => update('statementReference', event.target.value)}/></label>
            <label>How you verified settlement<textarea required maxLength={1000} rows={2} value={form.verification}
              onChange={event => update('verification', event.target.value)}/></label>
            <label>Reason for the return<textarea required maxLength={1000} rows={2} value={form.reason} onChange={event => update('reason', event.target.value)}/></label>
          </fieldset>
          <button type="submit" className="primary-action" disabled={!allowedAmount || !channel}>Save tip return</button>
        </fieldset>
      </form>}
      {receipt && <>
        <p><strong>{quoteMoney(receipt.cents)}</strong> recorded for <time dateTime={receipt.actualOn}>{receipt.actualOn}</time>.</p>
        <button type="button" className="secondary" onClick={() => downloadFinanceHistory('crest-tip-return.csv', [
          ['Return ID', 'Original tip ID', 'Original tip event ID', 'Funding origin ID', 'Settlement date',
            'Return cents', 'Original net cents returned', 'Original tax cents returned', 'Confirmation', 'Reason'],
          [receipt.tipReturnId, receipt.tipRealizationId, receipt.originalTipEventId, receipt.fundingOriginId,
            receipt.actualOn, receipt.cents, receipt.netCents, receipt.taxCents, receipt.confirmation, receipt.reason],
        ])}>Download tip return (CSV)</button>
      </>}
    </section>
  </details>;
}
