'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {collectionFailureRefusal, parseCollectionFailureInput} from '../../../bookkeeping/collection-failure-contract';
import type {CollectionFailureMode} from '../../../bookkeeping/collection-failure-contract';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {quoteDollarsInput, quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingCollectionFailure, downloadFinanceHistory, financeAccounts, readPendingCollectionFailure,
  retainPendingCollectionFailure} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Payments = Awaited<ReturnType<typeof financeAccounts.collectionFailurePayments>>;
type Options = Extract<Awaited<ReturnType<typeof financeAccounts.collectionFailureOptions>>, {state: 'ready'}>['options'];
type Receipt = Extract<Awaited<ReturnType<typeof financeAccounts.lookupCollectionFailure>>, {state: 'committed'}>['receipt'];
type Range = {firstCent: string; lastCent: string};
type Choice = {amount: string; start: string};
const title = 'Correct a customer payment';
const emptyEvidence = {amount: '', account: '', confirmation: '', reason: '', namespace: '', transactionId: '', rawReference: ''};
const names = {allocation: 'Original invoice', application: 'Reapplied funds', funds: 'Held funds', tip: 'Recorded tip'};
const refusalMessage: Record<NonNullable<ReturnType<typeof collectionFailureRefusal>>, string> = {
  original_account_unavailable: 'The original payment account needs review.',
  evidence_required: 'Check the transaction reference and verification.',
  source_unavailable: 'Crest could not verify that payment for this customer.',
  invalid_date: 'Choose a date on or after the original payment, through today.',
  amount_unavailable: 'The verified amount must equal the selected payment components.',
  id_conflict: 'This adjustment reference is already in use. Check the saved outcome.',
  channel_review_required: 'The account is no longer verified for this date. Load the components again.',
  external_id_already_recorded: 'This bank or wallet transaction has already been recorded.',
  range_unavailable: 'Some selected amounts are no longer available. Load the components again.',
};

function chosenRange(range: Range, choice: Choice): Range | null {
  const cents = centsFromDollars(choice.amount);
  const capacity = BigInt(range.lastCent) - BigInt(range.firstCent) + 1n;
  if (cents === capacity) return range;
  if (!/^[1-9][0-9]{0,18}$/.test(choice.start)) return null;
  const start = BigInt(choice.start);
  const end = start + cents - 1n;
  return cents > 0n && start >= BigInt(range.firstCent) && end <= BigInt(range.lastCent)
    ? {firstCent: String(start), lastCent: String(end)} : null;
}

function selectedComponents(options: Options | null, entries: Readonly<Record<string, Choice>>) {
  if (!options) return null;
  const result = [];
  let total = 0n;
  for (const source of options.components) {
    for (const range of source.availableRanges) {
      const choice = entries[source.kind + ':' + source.sourceId + ':' + range.firstCent];
      if (!choice?.amount.trim()) continue;
      const rangeToPost = chosenRange(range, choice);
      if (!rangeToPost) return null;
      result.push({kind: source.kind, sourceId: source.sourceId, ...rangeToPost});
      total += centsFromDollars(choice.amount);
    }
  }
  return {rows: result, total};
}

function centsFromDollars(value: string) {
  try { return BigInt(quoteDollarsInput(value)); } catch { return 0n; }
}

export function CollectionFailure({businessId, customerId}: {businessId: string; customerId: string}) {
  const [payments, setPayments] = useState<Payments | null>(null);
  const [paymentId, setPaymentId] = useState('');
  const [date, setDate] = useState('');
  const [mode, setMode] = useState<CollectionFailureMode | ''>('');
  const [options, setOptions] = useState<Options | null>(null);
  const [ranges, setRanges] = useState<Readonly<Record<string, Choice>>>({});
  const [olderPaymentId, setOlderPaymentId] = useState('');
  const [evidence, setEvidence] = useState(emptyEvidence);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const selected = selectedComponents(options, ranges);
  const amount = centsFromDollars(evidence.amount);
  const account = options?.channels.find(channel => channel.channelId === evidence.account);
  const originalPaymentId = paymentId === 'older' ? olderPaymentId.trim() : paymentId;
  const validTotal = !!selected && selected.total === amount && amount > 0n && selected.rows.length <= 180;

  const readOriginal = useCallback(() => {
    try { setPending(readPendingCollectionFailure() !== null); }
    catch { setPending(true); setMessage('Crest could not read the interrupted adjustment reference.'); }
  }, []);
  const suspend = useCallback(() => {
    request.current?.abort(); request.current = null;
    setPayments(null); setPaymentId(''); setOlderPaymentId(''); setDate(''); setMode(''); setOptions(null); setRanges({});
    setEvidence(emptyEvidence); setReceipt(null); setPending(false); setCanClose(false);
    setCloseReason(''); setBusy(false); setMessage('');
  }, []);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); else readOriginal(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { suspend(); readOriginal(); } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', restored);
    return () => {
      request.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', restored);
    };
  }, [readOriginal, suspend]);

  async function run(work: (context: FinanceAccountContext, signal: AbortSignal) => Promise<void>, working: string, failure: string) {
    if (request.current) return;
    const current = new AbortController();
    request.current = current;
    setBusy(true); setMessage(working);
    try {
      const context = await financeAccounts.context(current.signal);
      if (current.signal.aborted) return;
      if (!context.collectionFailures || context.businessId !== businessId) { setMessage('Payment adjustments are unavailable.'); return; }
      await work(context, current.signal);
    } catch {
      if (!current.signal.aborted) setMessage(failure);
    } finally {
      if (request.current === current) { request.current = null; setBusy(false); status.current?.focus(); }
    }
  }

  function resetReview() {
    setOptions(null); setRanges({}); setEvidence(emptyEvidence); setReceipt(null);
  }

  function recover(reason?: string) {
    void run(async (context, signal) => {
      const original = readPendingCollectionFailure();
      setCanClose(false);
      if (!original) { setPending(false); setMessage('There is no interrupted payment adjustment.'); return; }
      if (original.businessId !== businessId || original.binding !== context.binding || original.customerId !== customerId) {
        setMessage('Open an invoice for the original customer in the same sign-in.'); return;
      }
      const result = reason ? await financeAccounts.retireCollectionFailure(context, original.reference, reason, signal)
        : await financeAccounts.lookupCollectionFailure(context, original.reference, signal);
      if (signal.aborted) return;
      if (result.state === 'committed' || result.state === 'retired') {
        if (result.state === 'committed' && (result.receipt.customerId !== customerId || result.receipt.originalPaymentId !== original.paymentId)) {
          setMessage('Open an invoice for the original customer to see this adjustment.'); return;
        }
        clearPendingCollectionFailure(original);
        setPending(false); setCloseReason('');
        setReceipt(result.state === 'committed' ? result.receipt : null);
        setMessage(result.state === 'committed' ? 'The original payment adjustment was saved.' : 'The original attempt was closed.');
        return;
      }
      setCanClose(result.state === 'absent' && context.writeState === 'ready');
      setMessage(result.state === 'absent' ? 'No saved adjustment was found. Close the original attempt before starting another.'
        : 'Crest could not match this adjustment. Keep its reference for review.');
    }, 'Checking the original adjustment…', 'Crest could not verify the original adjustment. Keep its reference for review.');
  }

  function loadPayments() {
    resetReview(); setPayments(null); setPaymentId(''); setOlderPaymentId(''); setDate(''); setMode('');
    void run(async (context, signal) => {
      const found = await financeAccounts.collectionFailurePayments(context, customerId, signal);
      if (signal.aborted) return;
      setPayments(found);
      setMessage(found.payments.length ? 'Choose the original payment.' : 'This customer has no recorded payments.');
    }, 'Loading saved payments…', 'Crest could not load saved payments. Check your sign-in and connection.');
  }

  function loadOptions() {
    resetReview();
    void run(async (context, signal) => {
      if (readPendingCollectionFailure()) { setPending(true); setMessage('Check the original adjustment first.'); return; }
      if (context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      const result = await financeAccounts.collectionFailureOptions(context, customerId, originalPaymentId, date, signal);
      if (signal.aborted) return;
      if (result.state === 'refused') { setMessage(refusalMessage[result.reason]); return; }
      const saved = result.options;
      if (!saved.openPeriod) { setMessage('Open the accounting period for this date before posting.'); return; }
      if (!saved.components.length) { setMessage('This payment has no remaining components available to adjust.'); return; }
      if (mode === 'settled_failure' && !saved.channels.length) { setMessage('No verified bank or wallet is available for this date.'); return; }
      setOptions(saved);
      setMessage('Select the affected amounts and confirm the total.');
    }, 'Checking the payment and its remaining components…', 'Crest could not verify the selected payment and date.');
  }

  function save() {
    if (!options || !mode || !selected || !validTotal || (mode === 'settled_failure' && !account)) return;
    void run(async (context, signal) => {
      if (!context.recoveryEpoch || context.writeState !== 'ready') { setMessage('Posting is paused.'); return; }
      if (readPendingCollectionFailure()) { setPending(true); setMessage('Check the original adjustment first.'); return; }
      const reference = {operationId: crypto.randomUUID(), recoveryEpoch: context.recoveryEpoch, collectionFailureId: crypto.randomUUID()};
      let input;
      try {
        input = parseCollectionFailureInput({reference, originalPaymentId, customerId,
          kind: mode, effectiveOn: options.effectiveOn, verifiedCents: String(amount), components: selected.rows,
          confirmation: evidence.confirmation.trim(), reason: evidence.reason.trim(),
          channelId: mode === 'settled_failure' ? account?.channelId : null,
          channelVersion: mode === 'settled_failure' ? account?.version : null,
          externalIdentity: mode === 'settled_failure'
            ? {namespace: evidence.namespace.trim(), id: evidence.transactionId.trim(), rawReference: evidence.rawReference.trim()} : null});
      } catch { setMessage('Check the selected amounts and complete the required evidence.'); return; }
      const original = retainPendingCollectionFailure(context, customerId, input.originalPaymentId, reference);
      setPending(true);
      resetReview();
      const result = await financeAccounts.recordCollectionFailure(context, input, signal);
      if (signal.aborted) return;
      if (result.state === 'conflict') { setMessage('Check the original adjustment before starting another.'); return; }
      clearPendingCollectionFailure(original); setPending(false);
      if (result.state === 'refused') { setMessage(refusalMessage[result.reason]); return; }
      setReceipt(result.receipt);
      setMessage('Payment adjustment saved.');
    }, 'Saving the payment adjustment…', 'Crest could not confirm the save. Check the original adjustment before starting another.');
  }

  const updateEvidence = (field: keyof typeof emptyEvidence, value: string) => setEvidence(current => ({...current, [field]: value}));
  return <details className="direct-receipt invoice-credit service-refund" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.open) readOriginal(); else suspend();
  }}>
    <summary>{title}</summary>
    <section aria-label={title} aria-busy={busy}>
      <p className="field-help">Correct a payment entered in error or record a bank or wallet debit for a failed incoming payment.</p>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      <button type="button" className="secondary" disabled={busy} onClick={loadPayments}>Load customer payments</button>
      {pending && <button type="button" className="secondary" disabled={busy} onClick={() => recover()}>Check original adjustment</button>}
      {pending && canClose && <form onSubmit={event => { event.preventDefault(); if (financeAccountReviewReason(closeReason.trim())) recover(closeReason.trim()); }}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={closeReason}
          onChange={event => setCloseReason(event.target.value)} disabled={busy}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {payments && payments.payments.length > 0 && !pending && <form onSubmit={event => { event.preventDefault(); loadOptions(); }}>
        <label>Original payment<select required value={paymentId} disabled={busy} onChange={event => { setPaymentId(event.target.value); resetReview(); }}>
          <option value="">Choose a payment</option>
          {payments.payments.map(row => <option key={row.paymentId} value={row.paymentId}>
            {row.receivedOn} · {quoteMoney(row.cents)} · {row.channelLabel} · {row.paymentId.slice(-8)}
          </option>)}
          {payments.hasMore && <option value="older">Enter an older payment reference</option>}
        </select></label>
        {paymentId === 'older' && <label>Payment ID from the original CSV<input required maxLength={36} value={olderPaymentId}
          autoCapitalize="none" spellCheck={false} onChange={event => { setOlderPaymentId(event.target.value); resetReview(); }}/></label>}
        <label>Adjustment date<input required type="date" value={date} disabled={busy}
          onChange={event => { setDate(event.target.value); resetReview(); }}/></label>
        <label>What happened?<select required value={mode} disabled={busy}
          onChange={event => { setMode(event.target.value as CollectionFailureMode | ''); resetReview(); }}>
          <option value="">Choose what happened</option>
          <option value="recording_error">Payment entered in error</option>
          <option value="settled_failure">Bank or wallet debited the payment</option>
        </select></label>
        <button type="submit" className="secondary" disabled={busy}>Review remaining amounts</button>
      </form>}
      {options && !pending && <form onSubmit={event => { event.preventDefault(); save(); }}>
        <p>{quoteMoney(options.originalCents)} received on {options.receivedOn} in {options.originalAccountLabel}.</p>
        <fieldset disabled={busy}><legend>Affected amounts</legend>
          <p className="field-help">Enter an amount for each affected portion. Leave the others blank.</p>
          {options.components.map(source => <section key={source.kind+':'+source.sourceId} aria-label={names[source.kind] + ' · ' + source.label}>
            <h4>{source.label}</h4>
            {source.availableRanges.map(range => {
              const key = source.kind + ':' + source.sourceId + ':' + range.firstCent;
              const value = ranges[key] ?? {amount: '', start: ''};
              const capacity = BigInt(range.lastCent) - BigInt(range.firstCent) + 1n;
              const label = quoteMoney(String(capacity));
              const entered = centsFromDollars(value.amount);
              const verified = value.amount.trim() ? chosenRange(range, value) : null;
              const update = (next: Choice) => setRanges(current => ({...current, [key]: next}));
              return <details key={key}>
                <summary>{label} available{verified ? ' · '+quoteMoney(String(entered))+' selected' : ''}</summary>
                <label>Amount to adjust (USD)<input inputMode="decimal" maxLength={22} value={value.amount}
                  onChange={event => update({...value, amount: event.target.value})}/></label>
                {entered > 0n && entered < capacity && <>
                  <label>Start at cent position<input required inputMode="numeric" maxLength={19} value={value.start}
                    onChange={event => update({...value, start: event.target.value})}/></label>
                  <button type="button" className="secondary" onClick={() => update({...value, start: range.firstCent})}>
                    Start at cent {range.firstCent}
                  </button>
                </>}
                {value.amount.trim() && <p className="field-help">{verified
                  ? 'Applies to cent positions '+verified.firstCent+'–'+verified.lastCent+'.'
                  : entered > 0n && entered < capacity
                    ? 'Choose which cents are affected within positions '+range.firstCent+'–'+range.lastCent+'.'
                    : 'Enter an amount within the available portion.'}</p>}
                {value.amount && <button type="button" className="secondary"
                  onClick={() => update({amount: '', start: ''})}>Clear this amount</button>}
              </details>;
            })}
          </section>)}
          <p>{selected ? <><strong>{quoteMoney(String(selected.total))}</strong> selected</> : 'Check the selected amounts.'}</p>
        </fieldset>
        <fieldset disabled={busy}><legend>{mode === 'settled_failure' ? 'Debit evidence' : 'Recording error evidence'}</legend>
          <label>{mode === 'settled_failure' ? 'Amount debited (USD)' : 'Amount entered in error (USD)'}<input required inputMode="decimal"
            value={evidence.amount} maxLength={22} onChange={event => updateEvidence('amount', event.target.value)}/></label>
          {mode === 'settled_failure' && <>
            <label>Account debited<select required value={evidence.account} onChange={event => updateEvidence('account', event.target.value)}>
              <option value="">Choose a verified bank or wallet</option>
              {options.channels.map(channel => <option key={channel.channelId} value={channel.channelId}>{channel.label}</option>)}
            </select></label>
            <label>Reference type<input required maxLength={80} value={evidence.namespace} onChange={event => updateEvidence('namespace', event.target.value)}/></label>
            <label>Transaction ID<input required maxLength={200} value={evidence.transactionId} onChange={event => updateEvidence('transactionId', event.target.value)}/></label>
            <label>Statement reference<input required maxLength={1000} value={evidence.rawReference} onChange={event => updateEvidence('rawReference', event.target.value)}/></label>
          </>}
          <label>{mode === 'settled_failure' ? 'How you verified the debit' : 'How you verified no money moved'}
            <input required maxLength={1000} value={evidence.confirmation} onChange={event => updateEvidence('confirmation', event.target.value)}/></label>
          <label>Reason for the adjustment<textarea required rows={2} maxLength={1000} value={evidence.reason}
            onChange={event => updateEvidence('reason', event.target.value)}/></label>
        </fieldset>
        {amount > 0n && !validTotal && <p className="field-help">The entered amount must equal the total selected above.</p>}
        <button type="submit" className="primary-action" disabled={busy || !validTotal || mode === 'settled_failure' && !account}>Save payment adjustment</button>
      </form>}
      {receipt && <div>
        <p><strong>{quoteMoney(receipt.cents)}</strong> adjusted on {receipt.effectiveOn}.</p>
        <button type="button" className="secondary" onClick={() => downloadFinanceHistory('crest-payment-adjustment.csv', [
          ['Adjustment ID','Payment ID','Date','Type','Event ID','Component','Source ID','First cent','Last cent','Tip net cents','Tip tax cents','Reason'],
          ...receipt.components.map(row => [receipt.collectionFailureId,receipt.originalPaymentId,receipt.effectiveOn,receipt.kind,receipt.eventId,
            row.kind,row.sourceId,row.firstCent,row.lastCent,row.netCents,row.taxCents,receipt.reason]),
        ])}>Download adjustment (CSV)</button>
      </div>}
    </section>
  </details>;
}
