'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {parseExcessReturnInput} from '../../../bookkeeping/excess-return-contract';
import {quoteDollarsInput, quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingExcessReturn, downloadFinanceHistory, financeAccounts, readPendingExcessReturn, retainPendingExcessReturn}
  from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Options = Awaited<ReturnType<typeof financeAccounts.excessReturnOptions>>;
type Receipt = Extract<Awaited<ReturnType<typeof financeAccounts.lookupExcessReturn>>, {state: 'committed'}>['receipt'];
type Range = Options['lots'][number]['availableRanges'][number];
const empty = {lotId: '', channelId: '', amount: '', part: '', referenceType: '', transactionId: '', statementReference: '', verification: '', reason: ''};
const title = 'Record a return of unused payment funds';
const rangeSize = (range: Range) => BigInt(range.lastCent) - BigInt(range.firstCent) + 1n;

function centsFromInput(amount: string) {
  try { return BigInt(quoteDollarsInput(amount)); } catch { return 0n; }
}

export function ExcessReturn({businessId, customerId}: {businessId: string; customerId: string}) {
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
  const lot = options?.lots.find(item => item.fundLotId === form.lotId);
  const channel = options?.channels.find(item => item.channelId === form.channelId);
  const ranges = lot?.availableRanges.filter(range => cents > 0n && rangeSize(range) >= cents) ?? [];
  const range = ranges.length === 1 ? ranges[0] : ranges.find(item => item.firstCent === form.part);

  const showOriginal = useCallback(() => {
    try { setPending(readPendingExcessReturn() !== null); }
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
        if (!context.excessReturns || context.businessId !== businessId) {
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
    setForm(previous => ({...previous, [field]: value, ...(field === 'lotId' || field === 'amount' ? {part: ''} : {})}));
  }

  function recover(reason?: string) {
    run(async (context, signal) => {
      const original = readPendingExcessReturn();
      setClosable(false);
      if (!original) { setPending(false); setMessage('There is no interrupted return to check.'); return; }
      if (original.businessId !== businessId || original.binding !== context.binding || original.customerId !== customerId) {
        setMessage('Open the original customer’s invoice in the same sign-in to check this return.');
        return;
      }
      const result = reason
        ? await financeAccounts.retireExcessReturn(context, original.reference, reason, signal)
        : await financeAccounts.lookupExcessReturn(context, original.reference, signal);
      if (signal.aborted) return;
      if (result.state === 'committed' || result.state === 'retired') {
        if (result.state === 'committed' && result.receipt.customerId !== customerId) throw Error();
        clearPendingExcessReturn(original);
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
      if (readPendingExcessReturn()) { setPending(true); setMessage('Check the original return first.'); return; }
      const saved = await financeAccounts.excessReturnOptions(context, customerId, date, signal);
      if (signal.aborted) return;
      if (context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      if (!saved.openPeriod) { setMessage('The settlement date must be in an open accounting period.'); return; }
      if (!saved.lots.length) { setMessage('This customer has no unused original payment funds for that date.'); return; }
      if (!saved.channels.length) { setMessage('No verified bank or wallet is available for that date.'); return; }
      setOptions(saved);
      setMessage('Choose the original payment and match the settled amount to your account record.');
    }, 'Checking eligible payments and accounts…', 'Crest could not verify payments for this settlement date. Check the date and try again.');
  }

  function save() {
    if (!options || !lot || !range || !channel) return;
    run(async (context, signal) => {
      if (!context.recoveryEpoch || context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      if (readPendingExcessReturn()) { setPending(true); setMessage('Check the original return first.'); return; }
      const reference = {operationId: crypto.randomUUID(), recoveryEpoch: context.recoveryEpoch, excessReturnId: crypto.randomUUID()};
      let input: ReturnType<typeof parseExcessReturnInput>;
      try {
        input = parseExcessReturnInput({reference, originalPaymentId: lot.originalPaymentId, fundLotId: lot.fundLotId, customerId,
          channelId: channel.channelId, channelVersion: channel.version, actualOn: options.actualOn,
          firstCent: range.firstCent, lastCent: String(BigInt(range.firstCent) + cents - 1n), verifiedCents: String(cents),
          confirmation: form.verification.trim(), reason: form.reason.trim(),
          externalIdentity: {namespace: form.referenceType.trim(), id: form.transactionId.trim(), rawReference: form.statementReference.trim()}});
      } catch { setMessage('Check the settled amount and complete the transaction evidence.'); return; }
      const original = retainPendingExcessReturn(context, customerId, reference);
      setPending(true); setForm(empty); setOptions(null);
      const result = await financeAccounts.recordExcessReturn(context, input, signal);
      if (signal.aborted) return;
      if (result.state === 'conflict') { setMessage('Check the original return before starting another.'); return; }
      clearPendingExcessReturn(original); setPending(false);
      if (result.state === 'refused') {
        setMessage(result.reason === 'external_return_already_recorded' ? 'This transaction reference is already recorded.'
          : 'Crest refused the return. Reload available payments and review the settlement evidence.');
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
      <p className="field-help">Use this after unused funds from an original payment have been returned through a bank or wallet. Crest records the settled transaction.</p>
      {!pending && <form onSubmit={event => { event.preventDefault(); load(); }}>
        <label>Settlement date<input type="date" required value={date} disabled={busy} onChange={event => {
          setDate(event.target.value); setOptions(null); setForm(empty); setReceipt(null); setMessage('');
        }}/></label>
        <button type="submit" className="secondary" disabled={busy}>Load eligible payments</button>
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
          <label>Original payment<select required value={form.lotId} onChange={event => update('lotId', event.target.value)}>
            <option value="">Choose the original payment</option>
            {options.lots.map(item => <option key={item.fundLotId} value={item.fundLotId}>
              {item.receivedOn} · {quoteMoney(String(item.availableRanges.reduce((sum, part) => sum + rangeSize(part), 0n)))} available · Ref {item.originalPaymentId.slice(-8)}
            </option>)}
          </select></label>
          <label>Returned from<select required value={form.channelId} onChange={event => update('channelId', event.target.value)}>
            <option value="">Choose the bank or wallet</option>
            {options.channels.map(item => <option key={item.channelId} value={item.channelId}>{item.label}</option>)}
          </select></label>
          <label>Settled amount (USD)<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={form.amount}
            onChange={event => update('amount', event.target.value)}/></label>
          {lot && cents > 0n && !ranges.length && <p className="field-help">No available portion of this payment covers the settled amount.</p>}
          {ranges.length > 1 && <label>Available portion<select required value={form.part} onChange={event => update('part', event.target.value)}>
            <option value="">Choose a portion</option>
            {ranges.map((part, index) => <option key={part.firstCent} value={part.firstCent}>Portion {index + 1} · {quoteMoney(String(rangeSize(part)))} available</option>)}
          </select></label>}
          <fieldset className="service-refund-evidence"><legend>Transaction evidence</legend>
            <label>Reference type<input required maxLength={80} value={form.referenceType} onChange={event => update('referenceType', event.target.value)}/></label>
            <label>Transaction ID<input required maxLength={200} value={form.transactionId} onChange={event => update('transactionId', event.target.value)}/></label>
            <label>Reference as shown on the account<textarea required maxLength={1000} rows={2} value={form.statementReference}
              onChange={event => update('statementReference', event.target.value)}/></label>
            <label>How you verified settlement<textarea required maxLength={1000} rows={2} value={form.verification}
              onChange={event => update('verification', event.target.value)}/></label>
            <label>Reason for the return<textarea required maxLength={1000} rows={2} value={form.reason} onChange={event => update('reason', event.target.value)}/></label>
          </fieldset>
          <button type="submit" className="primary-action" disabled={!range || !channel}>Save return record</button>
        </fieldset>
      </form>}
      {receipt && <>
        <p><strong>{quoteMoney(receipt.cents)}</strong> recorded for <time dateTime={receipt.actualOn}>{receipt.actualOn}</time>.</p>
        <button type="button" className="secondary" onClick={() => downloadFinanceHistory('crest-unused-payment-return.csv', [
          ['Return ID', 'Original payment ID', 'Original payment event ID', 'Customer funds lot ID', 'Settlement date', 'Return cents', 'Confirmation', 'Reason'],
          [receipt.excessReturnId, receipt.originalPaymentId, receipt.originalReceiptEventId, receipt.fundLotId,
            receipt.actualOn, receipt.cents, receipt.confirmation, receipt.reason],
        ])}>Download return record (CSV)</button>
      </>}
    </section>
  </details>;
}
