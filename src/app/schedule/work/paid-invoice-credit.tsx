'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {calculateInvoiceCreditReview} from '../../../bookkeeping/invoice-credit-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingPaidInvoiceCredit,downloadFinanceHistory,financeAccounts,readPendingPaidInvoiceCredit,
  retainPendingPaidInvoiceCredit} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.paidInvoiceCreditOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupPaidInvoiceCredit>>,{state:'committed'}>['receipt'];
type Payment=Extract<Awaited<ReturnType<typeof financeAccounts.invoicePaymentAllocations>>,{state:'ready'}>['allocations'][number];
const size=(part:{firstCent:string;lastCent:string})=>BigInt(part.lastCent)-BigInt(part.firstCent)+1n;

function amountCents(value:string){
  try{return BigInt(quoteDollarsInput(value));}catch{return 0n;}
}

export function PaidInvoiceCredit({businessId,customerId,invoiceId}:{businessId:string;customerId:string;invoiceId:string}){
  const [date,setDate]=useState('');
  const [payments,setPayments]=useState<Payment[]|null>(null);
  const [allocationId,setAllocationId]=useState('');
  const [review,setReview]=useState<Review|null>(null);
  const [lineId,setLineId]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [selectedRange,setSelectedRange]=useState('');
  const [closeReason,setCloseReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [closable,setClosable]=useState(false);
  const [writable,setWritable]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);
  const lines=review?.credit.lines.filter(item=>item.availableRange)??[];
  const line=lines.find(item=>item.invoiceItemId===lineId);
  const balance=BigInt(review?.reviewedArCents??'0');
  const cents=amountCents(amount),released=cents-balance;
  const ranges=review?.release.availableRanges.filter(part=>released>0n&&size(part)>=released)??[];
  const range=ranges.length===1?ranges[0]:ranges.find(part=>part.firstCent===selectedRange);
  const lineRange=line?.availableRange;
  const canReview=!!(review?.credit.openPeriod&&review.chronologySupported&&review.returnsMappingId&&review.release.fundsMappingId);
  const preview=line&&lineRange&&range&&cents<=size(lineRange)
    ?calculateInvoiceCreditReview(line,lineRange.firstCent,String(BigInt(lineRange.firstCent)+cents-1n)):null;
  const validReason=financeAccountReviewReason(reason.trim());

  const clearReview=useCallback(()=>{setReview(null);setLineId('');setAmount('');setReason('');setSelectedRange('');},[]);
  const clearScreen=useCallback(()=>{
    request.current?.abort();request.current=null;
    setDate('');setPayments(null);setAllocationId('');clearReview();setReceipt(null);setCloseReason('');
    setPending(false);setClosable(false);setWritable(false);setBusy(false);setMessage('');
  },[clearReview]);
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')clearScreen();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',clearScreen);
    return ()=>{
      request.current?.abort();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pagehide',clearScreen);
    };
  },[clearScreen]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(request.current)return;
    const controller=new AbortController(),signal=controller.signal;
    request.current=controller;setBusy(true);setMessage('Checking the invoice and payment…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.paidInvoiceCredits||context.businessId!==businessId){setMessage('Paid invoice credits are unavailable.');return;}
      setWritable(context.writeState==='ready');
      await action(context,signal);
    }catch{if(!signal.aborted)setMessage(failure);}
    finally{if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}}
  }

  function load(close?:string){
    void run(async(context,signal)=>{
      const original=readPendingPaidInvoiceCredit();
      setPending(original!==null);setClosable(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to check this credit.');return;
        }
        const result=close?await financeAccounts.retirePaidInvoiceCredit(context,original.reference,close,signal)
          :await financeAccounts.lookupPaidInvoiceCredit(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&(result.receipt.credit.invoiceId!==invoiceId||result.receipt.credit.customerId!==customerId))throw Error();
          clearPendingPaidInvoiceCredit(original);setPending(false);setCloseReason('');clearReview();setPayments(null);
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original credit and payment release were saved.':'The original attempt was closed.');
          return;
        }
        setClosable(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved credit was found. Close this attempt before starting again.'
          :'Crest could not match the original attempt.');
        return;
      }
      setPayments(null);setAllocationId('');clearReview();setReceipt(null);
      const result=await financeAccounts.invoicePaymentAllocations(context,customerId,invoiceId,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('The saved invoice is unavailable.');return;}
      const available=result.allocations.filter(item=>item.availableCents!=='0');
      setPayments(available);
      if(available.length===1)setAllocationId(available[0]!.allocationId);
      setMessage(available.length?'Choose the payment to use for the credit.':'There is no applied payment available for this credit.');
    },'Crest could not check the original credit or load saved payments.');
  }

  function reviewCredit(){
    void run(async(context,signal)=>{
      clearReview();
      if(readPendingPaidInvoiceCredit()){setPending(true);setMessage('Check the original credit first.');return;}
      const result=await financeAccounts.paidInvoiceCreditOptions(context,customerId,invoiceId,allocationId,date||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('This payment is unavailable for that credit date.');return;}
      setReview(result);
      const eligible=result.credit.lines.filter(item=>item.availableRange);
      if(eligible.length===1)setLineId(eligible[0]!.invoiceItemId);
      setMessage(!result.credit.openPeriod?'Choose a date in an open accounting period.'
        :!result.chronologySupported?'A later posting affects this balance. Review the invoice before continuing.'
        :!result.returnsMappingId||!result.release.fundsMappingId?'Review the sales returns and customer funds accounts in Accounting.'
        :!eligible.length?'No original invoice line has an amount available to credit.'
        :context.writeState!=='ready'?'Saved payment loaded. Posting is paused.':'Review the credit and the amount to move to held funds.');
    },'Crest could not load the credit options. Check the selected payment and date.');
  }

  function submit(){
    if(!canReview||!review||!line||!lineRange||!range||!preview||!validReason)return;
    const returnsMappingId=review.returnsMappingId,fundsMappingId=review.release.fundsMappingId;
    if(!returnsMappingId||!fundsMappingId)return;
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingPaidInvoiceCredit()){
        setMessage('Posting is paused or an original credit needs review.');return;
      }
      const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,
        invoiceCreditId:crypto.randomUUID(),unapplicationId:crypto.randomUUID()};
      const {operationId,recoveryEpoch,invoiceCreditId,unapplicationId}=reference;
      const effectiveOn=review.credit.effectiveOn;
      const credit={reference:{operationId,recoveryEpoch,invoiceCreditId},invoiceItemId:line.invoiceItemId,
        customerId,effectiveOn,firstCent:lineRange.firstCent,lastCent:String(BigInt(lineRange.firstCent)+cents-1n),returnsMappingId,reason:reason.trim()};
      const release={reference:{operationId,recoveryEpoch,unapplicationId},allocationId,customerId,fundsMappingId,
        effectiveOn,firstCent:range.firstCent,lastCent:String(BigInt(range.firstCent)+released-1n),reason:reason.trim()};
      const original=retainPendingPaidInvoiceCredit(context,invoiceId,reference);
      setPending(true);
      const result=await financeAccounts.submitPaidInvoiceCredit(context,{credit,release,reviewedArCents:review.reviewedArCents},signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingPaidInvoiceCredit(original);setPending(false);clearReview();
        setMessage('The credit was refused. Reload the saved payment and available amounts.');return;
      }
      if(result.state!=='committed'||result.receipt.credit.invoiceId!==invoiceId)throw Error();
      clearPendingPaidInvoiceCredit(original);setPending(false);clearReview();setPayments(null);setReceipt(result.receipt);
      setMessage('Credit saved. The released payment amount is now held for this customer.');
    },'The outcome could not be confirmed. Check the original credit before trying again.');
  }

  return <details className="direct-receipt invoice-credit" onToggle={event=>{if(!event.currentTarget.open)clearScreen();}}>
    <summary>Credit a paid or partly paid invoice</summary>
    <section aria-label="Credit a paid or partly paid invoice" aria-busy={busy}>
      <p className="field-help">Use this when the credit exceeds the unpaid balance. Crest moves the needed amount from one payment to held funds. No refund is sent.</p>
      <button type="button" className="secondary" disabled={busy} onClick={()=>load()}>
        {pending?'Check original paid invoice credit':'Load applied payments'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&closable&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))load(closeReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={closeReason} disabled={busy}
          onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy||!financeAccountReviewReason(closeReason.trim())}>Close original attempt</button>
      </form>}
      {!pending&&!!payments?.length&&<form onSubmit={event=>{event.preventDefault();reviewCredit();}}>
        {payments.length===1?<p>Payment on {payments[0]!.paidOn} · {quoteMoney(payments[0]!.availableCents)} applied and available</p>:
          <label>Payment<select required value={allocationId} disabled={busy} onChange={event=>{setAllocationId(event.target.value);clearReview();}}>
            <option value="">Choose an applied payment</option>
            {payments.map((item,index)=><option key={item.allocationId} value={item.allocationId}>
              {index+1}. {item.paidOn} · {quoteMoney(item.availableCents)} available
            </option>)}
          </select></label>}
        <label>Credit date (optional)<input type="date" value={date} disabled={busy}
          onChange={event=>{setDate(event.target.value);clearReview();}}/></label>
        {!date&&<p className="field-help">Leave blank to use today in the workspace time zone.</p>}
        <button type="submit" className="secondary" disabled={busy||!allocationId}>Review credit and payment</button>
      </form>}
      {!pending&&review&&<p className="field-help">Unpaid balance on {review.credit.effectiveOn} · {quoteMoney(review.reviewedArCents)}</p>}
      {!pending&&writable&&canReview&&lines.length>0&&<form onSubmit={event=>{event.preventDefault();submit();}}>
        <fieldset disabled={busy}>
          <legend>Credit and payment release</legend>
          {lines.length>1&&<label>Invoice line<select required value={lineId} onChange={event=>{setLineId(event.target.value);setAmount('');setSelectedRange('');}}>
            <option value="">Choose a line</option>
            {lines.map(item=><option key={item.invoiceItemId} value={item.invoiceItemId}>{item.description}</option>)}
          </select></label>}
          {line&&lineRange&&<>
            <p className="invoice-credit-line">{line.description}</p>
            <label>Credit amount (USD)<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={amount}
              onChange={event=>{setAmount(event.target.value);setSelectedRange('');}}/></label>
            <p className="field-help">Available on this line · {quoteMoney(String(size(lineRange)))}</p>
            {!!amount&&cents<=balance&&<p className="field-help">Use Credit an invoice line for amounts within the unpaid balance.</p>}
            {!!amount&&cents>size(lineRange)&&<p className="field-help">Enter an amount within the available amount on this line.</p>}
            {!!amount&&released>0n&&!ranges.length&&<p className="field-help">The selected payment has no available portion large enough for this credit.</p>}
            {ranges.length>1&&<label>Portion of the payment<select required value={selectedRange} onChange={event=>setSelectedRange(event.target.value)}>
              <option value="">Choose a payment portion</option>
              {ranges.map((part,index)=><option key={part.firstCent} value={part.firstCent}>Portion {index+1} · {quoteMoney(String(size(part)))} available</option>)}
            </select></label>}
            {preview&&<dl className="customer-values" aria-label="Paid invoice credit preview">
              <dt>Credit to invoice</dt><dd>{quoteMoney(preview.inclusiveCents)}</dd>
              <dt>Included tax</dt><dd>{quoteMoney(preview.taxCents)}</dd>
              <dt>Move to held funds</dt><dd>{quoteMoney(String(released))}</dd>
              <dt>Invoice balance after credit</dt><dd>{quoteMoney('0')}</dd>
            </dl>}
            <label>Reason for the credit<textarea required rows={2} maxLength={1000} value={reason} aria-invalid={!!reason&&!validReason}
              onChange={event=>setReason(event.target.value)}/></label>
            <button type="submit" className="primary-action" disabled={!preview||!validReason}>Save credit and release</button>
          </>}
        </fieldset>
      </form>}
      {receipt&&<>
        <p><strong>{quoteMoney(receipt.credit.inclusiveCents)}</strong> credited. <strong>{quoteMoney(receipt.release.cents)}</strong> moved to held funds.</p>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-paid-invoice-credit.csv',[
          ['Credit ID','Payment release ID','Invoice ID','Payment allocation ID','Held funds ID','Date','Credit cents','Tax cents','Held funds cents','Reason'],
          [receipt.credit.invoiceCreditId,receipt.release.unapplicationId,receipt.credit.invoiceId,receipt.release.allocationId,
            receipt.release.fundLotId,receipt.credit.effectiveOn,receipt.credit.inclusiveCents,receipt.credit.taxCents,receipt.release.cents,receipt.credit.reason],
        ])}>Download credit and payment release (CSV)</button>
      </>}
    </section>
  </details>;
}
