'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { clearPendingInvoiceIssue, downloadFinanceHistory, financeAccounts, readPendingInvoiceIssue,
  retainPendingInvoiceIssue } from '../../../client/finance-accounts';
import type { FinanceAccountContext } from '../../../client/finance-accounts';
import { quoteMoney } from '../../../commercial/quote-pricing';
import { InvoiceTaxPayableSetup } from './invoice-tax-payable-setup';
import { InvoiceExemptionSetup } from './invoice-exemption-setup';
import { DirectReceipt } from './direct-receipt';
import { PaymentCorrection } from './payment-correction';
import { FundApplication } from './fund-application';
import { HeldTip } from './held-tip';
import { InvoiceCredit } from './invoice-credit';
import { PaidInvoiceCredit } from './paid-invoice-credit';
import { ServiceRefund } from './service-refund';
import { ExcessReturn } from './excess-return';
import { TipReturn } from './tip-return';
import { CollectionFailure } from './collection-failure';

type Readiness = Awaited<ReturnType<typeof financeAccounts.reviewInvoiceIssueTax>>;
type Review = Readiness['tax'];
type Line = Extract<Review, { state: 'review' }>['lines'][number];
export type IssuedInvoice = Extract<Awaited<ReturnType<typeof financeAccounts.readIssuedInvoice>>, { state: 'issued' }>;
type IssueInput = Parameters<typeof financeAccounts.submitInvoiceIssue>[1];

const lineMessages = {
  complimentary_review_required: 'Review the original complimentary approval.',
  service_classification_required: 'The accepted quote portion needs a service classification.',
  jurisdiction_required: 'Enter the reviewed jurisdiction.',
  tax_profile_required: 'No approved tax profile covers this service, jurisdiction and date.',
  exemption_review_required: 'This exemption requires evidence for this invoice.',
} as const;

const accountNames = { ar: 'Accounts receivable', discount: 'Discounts', service_revenue: 'Service revenue' } as const;
const issueMessages: Record<string,string> = {
  INVOICE_ISSUE_REVIEW_REQUIRED: 'The reviewed details changed. Check the saved invoice again.',
  INVOICE_ISSUE_DRAFT_REQUIRED: 'This draft is no longer available to issue. Check the saved invoice.',
  INVOICE_SCOPE_ALREADY_CONSUMED: 'Some of this work has already been invoiced.',
  ACCOUNTING_OPEN_PERIOD_REQUIRED: 'The issue date needs an open accounting period.',
  APPROVED_INVOICE_SERIES_REQUIRED: 'An approved invoice numbering series is required.',
  RECOVERY_REVIEW_REQUIRED: 'Invoice posting is paused for recovery review.',
  FINANCE_ACCOUNT_SIGN_IN_REQUIRED: 'Sign in again before issuing.',
};

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const formatDate = (date: string) => dateFormat.format(new Date(date + 'T12:00:00Z'));

const stopMessages = {
  absent: 'The draft is unavailable.',
  stale: 'This draft changed. Open its current revision before reviewing tax.',
  cancelled: 'This draft was cancelled.',
  completed_scope_required: 'Save completed portions in the draft before reviewing tax.',
  due_date_review_required: 'Update the due date or leave it blank to use the issue date.',
} as const;

function IssueLineStatus({ line }: { line: Line }) {
  if (line.state === 'ready') return <p>{line.exemptionEvidenceId?'Exemption reviewed · ':''}Reviewed tax {quoteMoney(line.components!.taxCents)}</p>;
  return <p>{lineMessages[line.state]}</p>;
}

export function IssuedInvoiceDetails({ invoice,receiptBusinessId,paymentCorrections,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds,excessReturns,tipReturns,collectionFailures }: {
  invoice:IssuedInvoice;receiptBusinessId:string|undefined;paymentCorrections?:boolean;fundApplications?:boolean;heldTips?:boolean;
  invoiceCredits?:boolean;paidInvoiceCredits?:boolean;serviceRefunds?:boolean;excessReturns?:boolean;tipReturns?:boolean;collectionFailures?:boolean;
}) {
  const tax = invoice.lines.reduce((sum,line)=>sum+BigInt(line.taxCents),0n);
  return <div className="issued-invoice-details">
    <header className="issued-invoice-heading">
      <h4>Invoice {invoice.invoiceNumber}</h4>
      <p><span>Total</span> <strong>{quoteMoney(invoice.totalCents)}</strong></p>
    </header>
    <dl className="customer-values">
      <dt>Customer</dt><dd>{invoice.customer.displayName}</dd>
      <dt>Issued</dt><dd>{formatDate(invoice.issuedOn)}</dd>
      <dt>Due</dt><dd>{formatDate(invoice.dueOn)}</dd>
      {tax>0n && <><dt>Included tax</dt><dd>{quoteMoney(String(tax))}</dd></>}
    </dl>
    <ul className="issued-invoice-items" aria-label="Invoice items">{invoice.lines.map((line,index)=>
      <li key={index}><span>{line.description}</span><strong>{quoteMoney(line.inclusiveCents)}</strong></li>)}</ul>
    <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-invoice-'+invoice.invoiceNumber+'.csv',[
      ['Invoice number','Customer','Issue date','Due date','Currency','Description','Gross inclusive cents','Discount inclusive cents','Net cents','Tax cents','Line total cents'],
      ...invoice.lines.map(line=>[invoice.invoiceNumber,invoice.customer.displayName,invoice.issuedOn,invoice.dueOn,invoice.currency,
        line.description,line.grossInclusiveCents,line.discountInclusiveCents,line.netCents,line.taxCents,line.inclusiveCents]),
    ])}>Download invoice (CSV)</button>
    {receiptBusinessId&&<DirectReceipt key={invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&paymentCorrections&&<PaymentCorrection businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&collectionFailures&&<CollectionFailure key={'collection-failure:'+invoice.invoiceId}
      businessId={receiptBusinessId} customerId={invoice.customer.id}/>}
    {receiptBusinessId&&fundApplications&&<FundApplication businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&invoiceCredits&&<InvoiceCredit key={'invoice-credit:'+invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&paidInvoiceCredits&&<PaidInvoiceCredit key={'paid-invoice-credit:'+invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&serviceRefunds&&<ServiceRefund key={'service-refund:'+invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id} invoiceId={invoice.invoiceId}/>}
    {receiptBusinessId&&excessReturns&&<ExcessReturn key={'excess-return:'+invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id}/>}
    {receiptBusinessId&&heldTips&&<HeldTip key={invoice.customer.id} businessId={receiptBusinessId} customerId={invoice.customer.id}/>}
    {receiptBusinessId&&tipReturns&&<TipReturn key={'tip-return:'+invoice.invoiceId} businessId={receiptBusinessId}
      customerId={invoice.customer.id}/>}
  </div>;
}

export function InvoiceIssueTaxReview({ businessId, jobId, draftId, revision, lines, onIssued, directReceipts, paymentCorrections, fundApplications, heldTips, invoiceCredits, paidInvoiceCredits, serviceRefunds, excessReturns, tipReturns, collectionFailures }: {
  businessId: string;
  jobId: string;
  draftId: string;
  revision: string;
  lines: readonly Pick<Line, 'outcomeId' | 'description' | 'serviceId' | 'inclusiveCents'>[];
  onIssued?: () => void;
  directReceipts?: boolean;
  paymentCorrections?: boolean;
  fundApplications?: boolean;
  heldTips?: boolean;
  invoiceCredits?: boolean;
  paidInvoiceCredits?: boolean;
  serviceRefunds?: boolean;
  excessReturns?: boolean;
  tipReturns?: boolean;
  collectionFailures?: boolean;
}) {
  const [jurisdictions, setJurisdictions] = useState<Readonly<Record<string, string>>>({});
  const choicesId = useId();
  const [choices, setChoices] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [result, setResult] = useState<Extract<Review, { state: 'review' }> | null>(null);
  const [accounts, setAccounts] = useState<Readiness['accounts']>(null);
  const [canSetupTax, setCanSetupTax] = useState(false);
  const [prepared, setPrepared] = useState<Omit<IssueInput,'reference'> | null>(null);
  const [issued, setIssued] = useState<IssuedInvoice | null>(null);
  const [pendingIssue, setPendingIssue] = useState(false);
  const [absentIssue, setAbsentIssue] = useState(false);
  const [closeReason, setCloseReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  function clear() {
    active.current?.abort();
    active.current = null;
    setJurisdictions({});
    setChoices({});
    setResult(null);
    setAccounts(null);
    setCanSetupTax(false);
    setPrepared(null);
    setIssued(null);
    setPendingIssue(false);
    setAbsentIssue(false);
    setCloseReason('');
    setMessage('');
    setBusy(false);
  }

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', clear);
    return () => {
      active.current?.abort();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', clear);
    };
  }, []);

  async function run(action: (context: FinanceAccountContext, signal: AbortSignal) => Promise<void>,
    workingMessage: string, failureMessage: string) {
    if (active.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setBusy(true);
    setMessage(workingMessage);
    try {
      const context = await financeAccounts.context(signal);
      if (signal.aborted) return;
      if (context.businessId !== businessId || !context.invoiceIssueTaxReview) {
        setMessage('Invoice tax review is unavailable for this workspace.');
        return;
      }
      await action(context, signal);
    } catch {
      if (!signal.aborted) setMessage(failureMessage);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
        status.current?.focus();
      }
    }
  }

  async function readSaved(context: FinanceAccountContext, signal: AbortSignal) {
    const saved = await financeAccounts.readIssuedInvoice(context, draftId, signal);
    if (signal.aborted || saved.state !== 'issued') return false;
    setIssued(saved);
    onIssued?.();
    setPrepared(null);
    setMessage('Issued invoice loaded.');
    return true;
  }

  async function checkSaved(context: FinanceAccountContext, signal: AbortSignal, reason?:string) {
    if (!context.invoiceIssue) return false;
    const pending = readPendingInvoiceIssue();
    if (pending && (pending.businessId !== context.businessId || pending.binding !== context.binding || pending.reference.draftId !== draftId)) {
      setPendingIssue(true);
      setMessage('An interrupted issue belongs to a different draft or sign-in. Check it in the original session.');
      return true;
    }
    if (pending) {
      setPendingIssue(true);
      const original = reason
        ? await financeAccounts.retireInvoiceIssue(context, pending.reference, reason, signal)
        : await financeAccounts.lookupInvoiceIssue(context, pending.reference, signal);
      if (signal.aborted) return true;
      setAbsentIssue(original.state==='absent'&&context.writeState==='ready');
      if (original.state==='retired') {
        clearPendingInvoiceIssue(pending);
        setPendingIssue(false);
        setCloseReason('');
        setMessage('Original attempt closed. Review the saved draft again to issue it.');
        return true;
      }
      if (original.state !== 'committed') {
        setMessage(original.state==='absent'
          ? 'No invoice was saved for the original attempt. Close it before issuing again.'
          : 'The original issue could not be confirmed. Check again before attempting another issue.');
        return true;
      }
      if (!await readSaved(context, signal)) throw Error('ISSUED_INVOICE_READ_REQUIRED');
      clearPendingInvoiceIssue(pending);
      setPendingIssue(false);
      return true;
    }
    return false;
  }

  function review() {
    setResult(null);
    setAccounts(null);
    setPrepared(null);
    return run(async (context, signal) => {
      if (await checkSaved(context, signal) || signal.aborted) return;
      const selection = Object.fromEntries(Object.entries(jurisdictions)
        .map(([id, value]) => [id, value.trim()]).filter(([, value]) => value));
      const readiness = context.invoiceIssue
        ? await financeAccounts.prepareInvoiceIssue(context, draftId, revision, selection, signal)
        : await financeAccounts.reviewInvoiceIssueTax(context, draftId, revision, selection, signal);
      const { tax: saved, accounts: reviewedAccounts } = readiness;
      if (signal.aborted) return;
      if (saved.state !== 'review') {
        setMessage(stopMessages[saved.state]);
        return;
      }
      if (saved.jobId !== jobId || saved.lines.length !== lines.length || saved.lines.some((line, index) => {
        const expected = lines[index];
        return !expected || line.outcomeId !== expected.outcomeId || line.serviceId !== expected.serviceId
          || line.inclusiveCents !== expected.inclusiveCents || line.description !== expected.description;
      })) throw Error('INVOICE_ISSUE_SCOPE_REVIEW_REQUIRED');
      setChoices(Object.fromEntries(saved.lines.map(line => [line.outcomeId, line.availableJurisdictions])));
      setResult(saved);
      setAccounts(reviewedAccounts);
      setCanSetupTax(context.invoiceIssue===true && context.writeState==='ready');
      if ('reviewDigest' in readiness && typeof readiness.reviewDigest === 'string' && context.writeState === 'ready'
        && reviewedAccounts && !reviewedAccounts.missing.length && !reviewedAccounts.jurisdictions.length
        && saved.lines.every(line => line.state === 'ready')) {
        setPrepared({jurisdictions:selection,reviewDigest:readiness.reviewDigest});
      }
      setMessage(saved.lines.every(line => line.state === 'ready')
        ? 'Tax reviewed for all completed portions.' : 'Some completed portions need tax information.');
    }, 'Checking saved work and approved tax…', 'Crest could not verify the tax review. Check the saved draft and try again.');
  }

  function issue() {
    if (!prepared) return;
    return run(async (context, signal) => {
      if (await checkSaved(context, signal) || signal.aborted) return;
      if (!context.invoiceIssue || context.writeState !== 'ready' || !context.recoveryEpoch) {
        setMessage('Invoice posting is unavailable for this workspace.');
        return;
      }
      const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,draftId,revision};
      const pending=retainPendingInvoiceIssue(context,reference);
      setPendingIssue(true);
      setPrepared(null);
      const outcome=await financeAccounts.submitInvoiceIssue(context,{reference,...prepared},signal);
      if (signal.aborted) return;
      if (outcome.state==='refused') {
        clearPendingInvoiceIssue(pending);
        setPendingIssue(false);
        if(outcome.reason==='INVOICE_ISSUE_DRAFT_REQUIRED'&&await readSaved(context,signal))return;
        setMessage(issueMessages[outcome.reason]??'Crest refused this issue. Check the saved draft.');
        return;
      }
      if (outcome.state!=='committed'||!await readSaved(context,signal)) throw Error('INVOICE_ISSUE_OUTCOME_UNKNOWN');
      clearPendingInvoiceIssue(pending);
      setPendingIssue(false);
    }, 'Issuing invoice…', 'The issue outcome is uncertain. Check the original before attempting another issue.');
  }

  function closeOriginal() {
    const reason=closeReason.trim();
    if(!reason||!absentIssue)return;
    return run(async (context,signal)=>{
      await checkSaved(context,signal,reason);
    },'Closing the original attempt…','Crest could not verify closure. Check the original attempt again.');
  }

  return <details onToggle={event => { if (!event.currentTarget.open) clear(); }}>
    <summary>Review invoice tax</summary>
    {issued ? <section aria-label="Issued invoice">
      <IssuedInvoiceDetails invoice={issued} receiptBusinessId={directReceipts?businessId:undefined}
        paymentCorrections={paymentCorrections===true} fundApplications={fundApplications===true} heldTips={heldTips===true}
        invoiceCredits={invoiceCredits===true} paidInvoiceCredits={paidInvoiceCredits===true} serviceRefunds={serviceRefunds===true}
        excessReturns={excessReturns===true} tipReturns={tipReturns===true} collectionFailures={collectionFailures===true}/>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
    </section> : <form aria-label="Invoice tax review" aria-busy={busy} onSubmit={event => { event.preventDefault(); void review(); }}>
      <p className="field-help">Check for saved jurisdiction suggestions. Then choose the approved jurisdiction for each completed portion.</p>
      {lines.map((line, index) => <fieldset key={line.outcomeId}>
        <legend>{line.description} · {quoteMoney(line.inclusiveCents)}</legend>
        {line.serviceId !== null && <>
          <label>Jurisdiction for portion {index + 1}
          <input list={choices[line.outcomeId]?.length ? choicesId+index : undefined}
            maxLength={200} value={jurisdictions[line.outcomeId] ?? ''} disabled={busy} onChange={event => {
            setJurisdictions({ ...jurisdictions, [line.outcomeId]: event.target.value });
            setResult(null);
            setAccounts(null);
            setPrepared(null);
            setMessage('');
          }} />
          </label>
          {!!choices[line.outcomeId]?.length && <datalist id={choicesId+index}>
            {choices[line.outcomeId]!.map(jurisdiction => <option key={jurisdiction} value={jurisdiction}/>)}
          </datalist>}
        </>}
        {result && <IssueLineStatus line={result.lines[index]!}/>}
        {result && canSetupTax && result.lines[index]?.state==='exemption_review_required'
          && result.lines[index]?.profileId && result.lines[index]?.jurisdiction &&
          <InvoiceExemptionSetup businessId={businessId} issueDate={result.issueDate}
            target={{draftId,draftRevision:revision,outcomeId:line.outcomeId,profileId:result.lines[index]!.profileId!,
              jurisdiction:result.lines[index]!.jurisdiction!}} onSaved={()=>setPrepared(null)}/>}
      </fieldset>)}
      <button type="submit" className="secondary" disabled={busy}>{pendingIssue?'Check original issue':'Check invoice tax'}</button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {absentIssue && <details>
        <summary>Close the original attempt</summary>
        <label>Reason for closing<input maxLength={1000} value={closeReason} disabled={busy}
          onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="button" className="secondary" disabled={busy||!closeReason.trim()} onClick={()=>void closeOriginal()}>
          Confirm closure
        </button>
      </details>}
      {result && <dl className="customer-values">
        <dt>Issue date</dt><dd>{formatDate(result.issueDate)}</dd>
        <dt>Due date</dt><dd>{formatDate(result.dueOn)}</dd>
      </dl>}
      {!!accounts?.missing.length && <>
        <p>Account mappings needed</p>
        <ul>{accounts.missing.map(purpose => <li key={purpose}>{accountNames[purpose]}</li>)}</ul>
        <a href="/settings/accounts/mappings/manage">Manage dated account mappings</a>
      </>}
      {!!accounts?.jurisdictions.length && <>
        <p>Tax payable mappings to review</p>
        <ul>{accounts.jurisdictions.map(jurisdiction => <li key={jurisdiction}>
          {canSetupTax&&result ? <InvoiceTaxPayableSetup businessId={businessId} jurisdiction={jurisdiction}
            issueDate={result.issueDate} onSaved={()=>setPrepared(null)}/> : jurisdiction}
        </li>)}</ul>
      </>}
      {prepared && result && <details>
        <summary>Confirm and issue invoice</summary>
        <dl className="customer-values">
          <dt>Invoice total</dt><dd>{quoteMoney(String(result.lines.reduce((sum,line)=>sum+BigInt(line.inclusiveCents),0n)))}</dd>
          <dt>Included tax</dt><dd>{quoteMoney(String(result.lines.reduce((sum,line)=>sum+BigInt(line.components?.taxCents??'0'),0n)))}</dd>
        </dl>
        <button type="button" className="primary" disabled={busy} onClick={()=>void issue()}>Issue invoice</button>
      </details>}
    </form>}
  </details>;
}
