'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {collectionFailureRecreditRefusal, parseCollectionFailureRecreditInput} from '../../bookkeeping/collection-failure-recredit-contract';
import {financeAccountReviewReason} from '../../bookkeeping/finance-account-contract';
import {quoteDollarsInput, quoteMoney} from '../../commercial/quote-pricing';
import {clearPendingCollectionFailureRecredit, downloadFinanceHistory, financeAccounts,
 readPendingCollectionFailureRecredit, retainPendingCollectionFailureRecredit} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';

type Failures = Extract<Awaited<ReturnType<typeof financeAccounts.collectionFailureRecredits>>, {state: 'ready'}>;
type Options = Extract<Awaited<ReturnType<typeof financeAccounts.collectionFailureRecreditOptions>>, {state: 'ready'}>;
type Receipt = Extract<Awaited<ReturnType<typeof financeAccounts.lookupCollectionFailureRecredit>>, {state: 'committed'}>['receipt'];
const title = 'Restore a failed payment';
const emptyDeposit = {section: '', amount: '', start: '', channelId: '', namespace: '', transaction: '',
  statement: '', confirmation: '', reason: ''};
const refusalText: Record<NonNullable<ReturnType<typeof collectionFailureRecreditRefusal>>, string> = {
  input_required: 'Check the amount and complete the deposit evidence.',
  source_unavailable: 'Crest could not verify the failed payment for this customer.',
  range_unavailable: 'This portion is no longer available. Check the failed payment again.',
  amount_required: 'The confirmed deposit must match the portion you selected.',
  invalid_date: 'Choose a deposit date on or after the failed payment, through today.',
  channel_review_required: 'Choose a bank or wallet verified for the deposit date.',
  mapping_required: 'Review the customer funds account in Accounting before recording this deposit.',
  evidence_required: 'Check the transaction ID and statement reference.',
  external_id_already_recorded: 'This bank or wallet transaction has already been recorded.',
  id_conflict: 'The recovery reference is already in use. Check the original outcome.',
  options_limit: 'Crest could not load all available portions for this payment. Its saved history needs review.',
};

function depositCents(value: string) {
  try { return BigInt(quoteDollarsInput(value)); } catch { return 0n; }
}

export function CollectionFailureRecredit({businessId, customerId}: {businessId: string; customerId: string}) {
  const [failures, setFailures] = useState<Failures | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [date, setDate] = useState('');
  const [options, setOptions] = useState<Options | null>(null);
  const [deposit, setDeposit] = useState(emptyDeposit);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState(false);
  const [canClose, setCanClose] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const portions = options?.components.flatMap(component => component.availableRanges.map(range =>
    ({...range, componentId: component.failureComponentId, id: component.failureComponentId + ':' + range.firstCent}))) ?? [];
  const portion = portions.find(item => item.id === deposit.section);
  const account = options?.channels.find(channel => channel.channelId === deposit.channelId);
  const amount = depositCents(deposit.amount);
  const position = deposit.start.trim() || portion?.firstCent || '';
  const first = /^[1-9][0-9]{0,18}$/.test(position) ? BigInt(position) : 0n;
  const last = first + amount - 1n;
  const exactAmount = !!portion && amount > 0n && first >= BigInt(portion.firstCent) && last <= BigInt(portion.lastCent);
  const selected = failures?.failures.find(failure => failure.failureId === selectedId);

  const refreshPending = useCallback(() => {
    try { setPending(readPendingCollectionFailureRecredit() !== null); }
    catch { setPending(true); setMessage('Crest could not read the original save reference.'); }
  }, []);
  const suspend = useCallback(() => {
    active.current?.abort(); active.current = null;
    setFailures(null); setSelectedId(''); setDate(''); setOptions(null); setDeposit(emptyDeposit);
    setReceipt(null); setPending(false); setCanClose(false); setCloseReason(''); setBusy(false); setMessage('');
  }, []);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === 'hidden') suspend(); else refreshPending(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { suspend(); refreshPending(); } };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('pageshow', restored);
    return () => {
      active.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('pageshow', restored);
    };
  }, [refreshPending, suspend]);

  async function run(work: (context: FinanceAccountContext, signal: AbortSignal) => Promise<void>,
    working: string, failure: string) {
    if (active.current) return;
    const current = new AbortController();
    active.current = current;
    setBusy(true); setMessage(working);
    try {
      const context = await financeAccounts.context(current.signal);
      if (current.signal.aborted) return;
      if (context.businessId !== businessId || !context.collectionFailureRecredits) {
        setMessage('Failed payment recovery is unavailable.'); return;
      }
      await work(context, current.signal);
    } catch {
      if (!current.signal.aborted) setMessage(failure);
    } finally {
      if (active.current === current) { active.current = null; setBusy(false); status.current?.focus(); }
    }
  }

  function load() {
    setReceipt(null); setOptions(null); setDeposit(emptyDeposit);
    void run(async (context, signal) => {
      const original = readPendingCollectionFailureRecredit();
      if (original) { setPending(true); setMessage('Check the original save first.'); return; }
      const result = await financeAccounts.collectionFailureRecredits(context, customerId, signal);
      if (signal.aborted) return;
      if (result.state === 'refused') { setMessage(refusalText[result.reason]); return; }
      if (result.state === 'absent') { setMessage('Crest could not open the saved customer.'); return; }
      setFailures(result); setSelectedId(''); setDate('');
      setMessage(result.failures.length ? 'Choose the failed payment that the provider credited back.'
        : 'No failed held payments are available to restore for this customer.');
    }, 'Loading failed payments…', 'Crest could not load failed payments. Check your sign-in and connection.');
  }

  function review() {
    if (!selected || !date) return;
    setReceipt(null); setOptions(null); setDeposit(emptyDeposit);
    void run(async (context, signal) => {
      if (context.writeState !== 'ready') { setMessage('Accounting changes are paused.'); return; }
      const result = await financeAccounts.collectionFailureRecreditOptions(context, customerId, selected.failureId, date, signal);
      if (signal.aborted) return;
      if (result.state === 'refused') { setMessage(refusalText[result.reason]); return; }
      if (result.state === 'absent') { setMessage('The selected failed payment is unavailable.'); return; }
      if (!result.openPeriod) { setMessage('The accounting period for the deposit date is closed.'); return; }
      if (!result.fundsMapping) { setMessage(refusalText.mapping_required); return; }
      if (!result.components.length || !result.channels.length) {
        setMessage(result.components.length ? refusalText.channel_review_required : refusalText.range_unavailable); return;
      }
      setOptions(result);
      if (result.components.length === 1 && result.components[0]!.availableRanges.length === 1) {
        const component = result.components[0]!;
        setDeposit({...emptyDeposit, section: component.failureComponentId + ':' + component.availableRanges[0]!.firstCent});
      }
      setMessage('Enter the verified deposit and select the saved funds it restores.');
    }, 'Checking the original failed payment…', 'Crest could not verify this payment and deposit date.');
  }

  function save() {
    if (!options || !portion || !account || !exactAmount) return;
    void run(async (context, signal) => {
      if (!context.recoveryEpoch || context.writeState !== 'ready') { setMessage('Accounting changes are paused.'); return; }
      if (readPendingCollectionFailureRecredit()) { setPending(true); setMessage('Check the original save first.'); return; }
      const reference = {operationId: crypto.randomUUID(), recoveryEpoch: context.recoveryEpoch, recreditId: crypto.randomUUID()};
      let input;
      try {
        input = parseCollectionFailureRecreditInput({reference, customerId, failureId: options.failureId,
          failureComponentId: portion.componentId, channelId: account.channelId, channelVersion: account.version,
          actualOn: options.actualOn, firstCent: String(first), lastCent: String(last), verifiedCents: String(amount),
          confirmation: deposit.confirmation.trim(), reason: deposit.reason.trim(), externalIdentity: {
            namespace: deposit.namespace.trim(), id: deposit.transaction.trim(), rawReference: deposit.statement.trim(),
          }});
      } catch { setMessage(refusalText.input_required); return; }
      const saved = retainPendingCollectionFailureRecredit(context, customerId, reference);
      setPending(true); setOptions(null); setDeposit(emptyDeposit); setReceipt(null);
      const result = await financeAccounts.recordCollectionFailureRecredit(context, input, signal);
      if (signal.aborted) return;
      if (result.state === 'conflict') { setMessage('Check the original save before starting another.'); return; }
      clearPendingCollectionFailureRecredit(saved); setPending(false);
      if (result.state === 'refused') { setMessage(refusalText[result.reason]); return; }
      setFailures(null); setReceipt(result.receipt); setMessage('The deposit and restored customer funds were saved.');
    }, 'Saving the verified deposit…', 'Crest could not confirm the save. Check the original save before starting another.');
  }

  function recover(reason?: string) {
    void run(async (context, signal) => {
      setCanClose(false);
      const saved = readPendingCollectionFailureRecredit();
      if (!saved) { setPending(false); setMessage('There is no interrupted save to check.'); return; }
      if (saved.businessId !== businessId || saved.customerId !== customerId || saved.binding !== context.binding) {
        setMessage('Open the original customer in the same sign-in to check this save.'); return;
      }
      const result = reason
        ? await financeAccounts.retireCollectionFailureRecredit(context, saved.reference, reason, signal)
        : await financeAccounts.lookupCollectionFailureRecredit(context, saved.reference, signal);
      if (signal.aborted) return;
      if (result.state === 'committed' || result.state === 'retired') {
        if (result.state === 'committed' && result.receipt.customerId !== customerId) {
          setMessage('Crest could not match this save to the open customer.'); return;
        }
        clearPendingCollectionFailureRecredit(saved);
        setPending(false); setCloseReason('');
        setReceipt(result.state === 'committed' ? result.receipt : null);
        setMessage(result.state === 'committed' ? 'Crest found the saved deposit and restored funds.' : 'The original attempt was closed.');
        return;
      }
      setCanClose(result.state === 'absent' && context.writeState === 'ready');
      setMessage(result.state === 'absent' ? 'No saved deposit was found. Close the original attempt before recording it again.'
        : 'Crest could not match the original reference. Keep it for review.');
    }, 'Checking the original save…', 'Crest could not verify the original save. Keep its reference for review.');
  }

  const change = (key: keyof typeof emptyDeposit, value: string) => setDeposit(current => ({...current, [key]: value}));
  return <details className="direct-receipt" onToggle={event => {
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.open) refreshPending(); else suspend();
  }}>
    <summary>{title}</summary>
    <section aria-label={title} aria-busy={busy}>
      <p className="field-help">Record money the bank or wallet credited back after a failed incoming payment. This restores customer funds that were held before the failure. Choose a verified deposit with no fee.</p>
      <p role="status" tabIndex={-1} ref={status}>{message}</p>
      {pending ? <>
        <button type="button" className="secondary" disabled={busy} onClick={() => recover()}>Check original save</button>
        {canClose && <form onSubmit={event => {event.preventDefault(); recover(closeReason.trim());}}>
          <label>Reason for closing the attempt<textarea required rows={2} maxLength={1000} value={closeReason}
            onChange={event => setCloseReason(event.target.value)}/></label>
          <button className="secondary" disabled={busy || !financeAccountReviewReason(closeReason.trim())}>Close original attempt</button>
        </form>}
      </> : <>
        <button type="button" className="secondary" disabled={busy} onClick={load}>Load failed payments</button>
        {!!failures?.failures.length && <form onSubmit={event => {event.preventDefault(); review();}}>
          <label>Failed payment<select required disabled={busy} value={selectedId} onChange={event => {
            setSelectedId(event.target.value); setOptions(null); setDeposit(emptyDeposit);
          }}>
            <option value="">Choose a failed payment</option>
            {failures.failures.map(failure => <option key={failure.failureId} value={failure.failureId}>
              {failure.failedOn} · {quoteMoney(failure.availableCents)} available · {failure.originalPaymentId.slice(0, 8)}
            </option>)}
          </select></label>
          {failures.hasMore && <p className="field-help">Showing the 50 most recent failed payments with funds available to restore.</p>}
          <label>Date the deposit cleared<input type="date" required disabled={busy} min={selected?.failedOn} value={date}
            onChange={event => {setDate(event.target.value); setOptions(null); setDeposit(emptyDeposit);}}/></label>
          <button className="secondary" disabled={busy || !selected || !date}>Check available funds</button>
        </form>}
        {options && <form onSubmit={event => {event.preventDefault(); save();}}>
          <fieldset disabled={busy}><legend>Verified deposit</legend>
            <label>Held funds to restore<select required value={deposit.section}
              onChange={event => setDeposit(current => ({...current, section: event.target.value, start: ''}))}>
              <option value="">Choose a portion</option>
              {portions.map(item => <option key={item.id} value={item.id}>
                {quoteMoney(String(BigInt(item.lastCent) - BigInt(item.firstCent) + 1n))} available · cents {item.firstCent}–{item.lastCent}
              </option>)}
            </select></label>
            <label>Amount deposited (USD)<input required inputMode="decimal" maxLength={22} value={deposit.amount}
              onChange={event => change('amount', event.target.value)}/></label>
            {portion && <details className="direct-receipt-options"><summary>Choose a different starting position</summary>
              <label>First cent to restore (optional)<input inputMode="numeric" maxLength={19} placeholder={portion.firstCent}
                value={deposit.start} onChange={event => change('start', event.target.value)}/></label>
              <p className="field-help">Leave blank to start at the first available cent in this portion.</p>
            </details>}
            <label>Bank or wallet credited<select required value={deposit.channelId}
              onChange={event => change('channelId', event.target.value)}>
              <option value="">Choose a verified account</option>
              {options.channels.map(item => <option key={item.channelId} value={item.channelId}>{item.label}</option>)}
            </select></label>
            <label>Reference type<input required maxLength={80} value={deposit.namespace}
              onChange={event => change('namespace', event.target.value)}/></label>
            <label>Transaction ID<input required maxLength={200} value={deposit.transaction}
              onChange={event => change('transaction', event.target.value)}/></label>
            <label>Statement reference<input required maxLength={1000} value={deposit.statement}
              onChange={event => change('statement', event.target.value)}/></label>
            <label>How you verified the deposit<textarea required rows={2} maxLength={1000} value={deposit.confirmation}
              onChange={event => change('confirmation', event.target.value)}/></label>
            <label>Reason for this recovery<textarea required rows={2} maxLength={1000} value={deposit.reason}
              onChange={event => change('reason', event.target.value)}/></label>
            {exactAmount && <p>{quoteMoney(String(amount))} will become available for this customer after the save is confirmed.</p>}
            <button className="primary-action" disabled={!exactAmount || !account}>Record restored payment</button>
          </fieldset>
        </form>}
      </>}
      {receipt && <>
        <p><strong>{quoteMoney(receipt.cents)}</strong> restored to available customer funds.</p>
        <button type="button" className="secondary" onClick={() => downloadFinanceHistory('crest-restored-payment.csv', [
          ['Recovery ID', 'Payment ID', 'Failed payment record', 'Deposit date', 'Cents restored', 'First cent', 'Last cent', 'Verification', 'Reason'],
          [receipt.recreditId, receipt.originalPaymentId, receipt.failureId, receipt.actualOn,
            receipt.cents, receipt.firstCent, receipt.lastCent, receipt.confirmation, receipt.reason],
        ])}>Download restored payment (CSV)</button>
      </>}
    </section>
  </details>;
}
