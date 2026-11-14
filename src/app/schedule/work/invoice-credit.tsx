'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {calculateInvoiceCreditReview,parseInvoiceCreditInput} from '../../../bookkeeping/invoice-credit-contract';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingInvoiceCredit,downloadFinanceHistory,financeAccounts,readPendingInvoiceCredit,
  retainPendingInvoiceCredit} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.invoiceCreditOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupInvoiceCredit>>,{state:'committed'}>['receipt'];

export function InvoiceCredit({businessId,customerId,invoiceId}:{businessId:string;customerId:string;invoiceId:string}){
  const [date,setDate]=useState('');
  const [review,setReview]=useState<Review|null>(null);
  const [itemId,setItemId]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [closeReason,setCloseReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [closable,setClosable]=useState(false);
  const [canPost,setCanPost]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);
  const line=review?.lines.find(item=>item.invoiceItemId===itemId);
  const eligibleLines=review?.lines.filter(item=>item.returnsMappingId)??[];
  const range=line?.availableRange;
  let lastCent:string|undefined;
  if(line&&range&&amount){
    try{
      const cents=BigInt(quoteDollarsInput(amount));
      if(cents>0n&&cents<=BigInt(line.maximumStandaloneCents))lastCent=String(BigInt(range.firstCent)+cents-1n);
    }catch{/* The amount remains editable. */}
  }
  const preview=line&&range&&lastCent?calculateInvoiceCreditReview(line,range.firstCent,lastCent):null;
  const validReason=financeAccountReviewReason(reason.trim());

  const clearReview=useCallback(()=>{
    setReview(null);setItemId('');setAmount('');setReason('');
  },[]);
  const suspend=useCallback(()=>{
    request.current?.abort();request.current=null;
    setDate('');clearReview();setCloseReason('');setReceipt(null);
    setPending(false);setClosable(false);setCanPost(false);setBusy(false);setMessage('');
  },[clearReview]);
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')suspend();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',suspend);
    return ()=>{
      request.current?.abort();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pagehide',suspend);
    };
  },[suspend]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(request.current)return;
    const controller=new AbortController(),signal=controller.signal;
    request.current=controller;setBusy(true);setMessage('Checking this invoice…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.invoiceCredits||context.businessId!==businessId){
        setMessage('Invoice credits are unavailable in this workspace.');return;
      }
      setCanPost(context.writeState==='ready');
      await action(context,signal);
    }catch{if(!signal.aborted)setMessage(failure);}
    finally{if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}}
  }

  function load(retirementReason?:string){
    void run(async(context,signal)=>{
      const original=readPendingInvoiceCredit();
      setPending(original!==null);setClosable(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to check this credit.');return;
        }
        const result=retirementReason
          ?await financeAccounts.retireInvoiceCredit(context,original.reference,retirementReason,signal)
          :await financeAccounts.lookupInvoiceCredit(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&(result.receipt.customerId!==customerId||result.receipt.invoiceId!==invoiceId))throw Error('INVOICE_CREDIT_SCOPE_CHANGED');
          clearPendingInvoiceCredit(original);setPending(false);setCloseReason('');clearReview();
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original credit was saved.':'The original attempt was closed.');
          return;
        }
        setClosable(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved credit was found. Close the original attempt before starting again.'
          :'Crest could not match the original attempt.');
        return;
      }
      clearReview();setReceipt(null);
      const result=await financeAccounts.invoiceCreditOptions(context,customerId,invoiceId,date||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('A saved invoice review is unavailable for this date.');return;}
      setReview(result);
      const eligible=result.lines.filter(item=>item.returnsMappingId);
      if(eligible.length===1)setItemId(eligible[0]!.invoiceItemId);
      setMessage(!result.openPeriod?'Choose a date in an open accounting period.'
        :context.writeState!=='ready'?'Saved invoice loaded. Posting is paused.'
        :result.availableBalanceCents==='0'?'This invoice has no outstanding balance to credit.'
        :!eligible.length?'No invoice line is eligible for a credit on this date. Review the returns account in Accounting.'
        :'Review the credit before saving it.');
    },'Crest could not check the original credit or load the saved invoice.');
  }

  function submit(){
    if(!review?.openPeriod||!line?.returnsMappingId||!range||!lastCent||!preview||!validReason)return;
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingInvoiceCredit()){
        setMessage('Posting is paused or an original credit needs review.');return;
      }
      const input=parseInvoiceCreditInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,invoiceCreditId:crypto.randomUUID()},
        invoiceItemId:line.invoiceItemId,customerId,effectiveOn:review.effectiveOn,
        firstCent:range.firstCent,lastCent,returnsMappingId:line.returnsMappingId,reason:reason.trim(),
      });
      const original=retainPendingInvoiceCredit(context,invoiceId,input.reference);
      setPending(true);
      const result=await financeAccounts.submitInvoiceCredit(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingInvoiceCredit(original);setPending(false);clearReview();
        setMessage(result.reason==='paired_unapplication_required'?'The credit exceeds the remaining invoice balance. Reload the saved invoice.'
          :'The credit was refused. Reload the invoice and review the available amount.');return;
      }
      if(result.state!=='committed'||result.receipt.invoiceId!==invoiceId)throw Error('INVOICE_CREDIT_OUTCOME_UNKNOWN');
      clearPendingInvoiceCredit(original);setPending(false);clearReview();setReceipt(result.receipt);
      setMessage('Credit saved. The invoice balance decreased by the amount shown.');
    },'The outcome could not be confirmed. Check the original credit before trying again.');
  }

  return <details className="direct-receipt invoice-credit" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Credit an invoice line</summary>
    <section aria-label="Credit an invoice line" aria-busy={busy}>
      <p className="field-help">Reduce the unpaid balance on one line. This does not send a refund.</p>
      {!pending&&<label>Credit date (optional)<input type="date" value={date} disabled={busy}
        onChange={event=>{setDate(event.target.value);clearReview();setReceipt(null);setMessage('');}}/></label>}
      {!pending&&!date&&<p className="field-help">Leave blank to use today in the workspace time zone.</p>}
      <button type="button" className="secondary" disabled={busy} onClick={()=>load()}>
        {pending?'Check original credit':'Load credit options'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&closable&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))load(closeReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={closeReason} disabled={busy}
          onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy||!financeAccountReviewReason(closeReason.trim())}>Close original attempt</button>
      </form>}
      {!pending&&review&&<p className="field-help">Unpaid balance on {review.effectiveOn} · {quoteMoney(review.availableBalanceCents)}</p>}
      {!pending&&canPost&&review?.openPeriod&&eligibleLines.length>0&&
        <form onSubmit={event=>{event.preventDefault();submit();}}>
          <fieldset disabled={busy}>
            <legend>Invoice credit</legend>
            {eligibleLines.length>1&&<label>Invoice line<select required value={itemId} onChange={event=>{setItemId(event.target.value);setAmount('');}}>
              <option value="">Choose a line</option>
              {eligibleLines.map((item,index)=><option key={item.invoiceItemId} value={item.invoiceItemId}>
                {index+1}. {item.description}
              </option>)}
            </select></label>}
            {line?.returnsMappingId&&<>
              <p className="invoice-credit-line">{line.description}</p>
              <label>Credit amount (USD)<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={amount}
                aria-invalid={!!amount&&!preview} onChange={event=>setAmount(event.target.value)}/></label>
              <p className="field-help">Maximum credit · {quoteMoney(line.maximumStandaloneCents)}</p>
              {preview&&<dl className="customer-values" aria-label="Credit preview">
                <dt>Credit to invoice</dt><dd>{quoteMoney(preview.inclusiveCents)}</dd>
                <dt>Included tax</dt><dd>{quoteMoney(preview.taxCents)}</dd>
              </dl>}
              <label>Reason for the credit<textarea required rows={2} maxLength={1000} value={reason}
                aria-invalid={!!reason&&!validReason} onChange={event=>setReason(event.target.value)}/></label>
              <button type="submit" className="primary-action" disabled={!preview||!validReason}>Save invoice credit</button>
            </>}
          </fieldset>
        </form>}
      {receipt&&<>
        <p><strong>{quoteMoney(receipt.inclusiveCents)}</strong> credited on {receipt.effectiveOn}.</p>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-invoice-credit.csv',[
          ['Credit ID','Invoice ID','Invoice line ID','Date','Credit cents','Tax cents','Reason'],
          [receipt.invoiceCreditId,receipt.invoiceId,receipt.invoiceItemId,receipt.effectiveOn,receipt.inclusiveCents,receipt.taxCents,receipt.reason],
        ])}>Download invoice credit (CSV)</button>
      </>}
    </section>
  </details>;
}
