'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {clearPendingPaymentCorrection,downloadFinanceHistory,financeAccounts,readPendingPaymentCorrection,
  retainPendingPaymentCorrection} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {parseAllocationUnapplicationInput} from '../../../bookkeeping/allocation-unapplication-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';

type Allocations=Extract<Awaited<ReturnType<typeof financeAccounts.invoicePaymentAllocations>>,{state:'ready'}>['allocations'];
type Options=Extract<Awaited<ReturnType<typeof financeAccounts.paymentCorrectionOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupPaymentCorrection>>,{state:'committed'}>['receipt'];

export function PaymentCorrection({businessId,customerId,invoiceId}: {businessId:string;customerId:string;invoiceId:string}){
  const [allocations,setAllocations]=useState<Allocations|null>(null);
  const [allocationId,setAllocationId]=useState('');
  const [date,setDate]=useState('');
  const [options,setOptions]=useState<Options|null>(null);
  const [firstCent,setFirstCent]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [retirementReason,setRetirementReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [absent,setAbsent]=useState(false);
  const [canWrite,setCanWrite]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);

  const clearReview=useCallback(()=>{
    setOptions(null);setFirstCent('');setAmount('');setReason('');
  },[]);
  const suspend=useCallback(()=>{
    request.current?.abort();request.current=null;
    setAllocations(null);setAllocationId('');setDate('');clearReview();setRetirementReason('');
    setReceipt(null);setPending(false);setAbsent(false);setCanWrite(false);setBusy(false);setMessage('');
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
  },[businessId,customerId,invoiceId,suspend]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(request.current)return;
    const controller=new AbortController(),signal=controller.signal;
    request.current=controller;setBusy(true);setMessage('Checking saved payment details…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.paymentCorrections||context.businessId!==businessId){
        setMessage('Payment corrections are unavailable for this workspace.');return;
      }
      setCanWrite(context.writeState==='ready');
      await action(context,signal);
    }catch{if(!signal.aborted)setMessage(failure);}
    finally{
      if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}
    }
  }

  function resolve(closeReason?:string){
    void run(async(context,signal)=>{
      const original=readPendingPaymentCorrection();
      setPending(original!==null);setAbsent(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to check this correction.');return;
        }
        const result=closeReason?await financeAccounts.retirePaymentCorrection(context,original.reference,closeReason,signal)
          :await financeAccounts.lookupPaymentCorrection(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error();
          clearPendingPaymentCorrection(original);
          setPending(false);setRetirementReason('');setAllocations(null);setAllocationId('');clearReview();
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original correction was saved.':'The original attempt was closed.');
          return;
        }
        setAbsent(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved correction was found. Close this attempt before posting another.'
          :'Crest could not confirm the original correction.');
        return;
      }
      setAllocations(null);setAllocationId('');clearReview();setReceipt(null);
      const result=await financeAccounts.invoicePaymentAllocations(context,customerId,invoiceId,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('The saved invoice is unavailable.');return;}
      setAllocations(result.allocations);
      const available=result.allocations.filter(row=>row.availableCents!=='0');
      if(available.length===1)setAllocationId(available[0]!.allocationId);
      setMessage(!result.allocations.length?'No payments have been applied to this invoice.'
        :!available.length?'All applied amounts were already moved to customer funds.'
        :context.writeState!=='ready'?'Saved payments loaded. Posting is paused.':'Saved payments loaded.');
    },'Crest could not verify the original correction or load saved payments.');
  }

  function review(){
    clearReview();
    void run(async(context,signal)=>{
      if(readPendingPaymentCorrection()){setPending(true);setMessage('Check the original correction first.');return;}
      const result=await financeAccounts.paymentCorrectionOptions(context,customerId,allocationId,date||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('This payment application is unavailable. Load saved payments again.');return;}
      setOptions(result);setDate(result.effectiveOn);setFirstCent(result.availableRanges[0]?.firstCent??'');
      setMessage(!result.availableRanges.length?'No amount is available to move from this payment.'
        :!result.fundsMappingId?'Approve the customer-funds account mapping before posting.'
        :!result.openPeriod?'The correction date needs an open accounting period.':'Review the amount and reason before posting.');
    },'Crest could not verify this correction. Check the date and load the payment again.');
  }

  function submit(){
    const range=options?.availableRanges.find(item=>item.firstCent===firstCent);
    if(!options||!range||!options.fundsMappingId||!options.openPeriod||!reason.trim())return;
    const fundsMappingId=options.fundsMappingId;
    let lastCent:string;
    try{
      const cents=BigInt(quoteDollarsInput(amount)),last=BigInt(range.firstCent)+cents-1n;
      if(cents<=0n||last>BigInt(range.lastCent))throw Error();
      lastCent=String(last);
    }catch{setMessage('Enter a positive amount within the available amount shown.');status.current?.focus();return;}
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingPaymentCorrection()){
        setMessage('Posting is paused or an original correction needs review.');return;
      }
      const input=parseAllocationUnapplicationInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,unapplicationId:crypto.randomUUID()},
        allocationId,customerId,fundsMappingId,effectiveOn:options.effectiveOn,firstCent:range.firstCent,lastCent,reason:reason.trim(),
      });
      const original=retainPendingPaymentCorrection(context,invoiceId,input.reference);
      setPending(true);
      const result=await financeAccounts.submitPaymentCorrection(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingPaymentCorrection(original);setPending(false);clearReview();
        setMessage('The correction was refused. Review the current payment and accounting period.');return;
      }
      if(result.state!=='committed')throw Error();
      clearPendingPaymentCorrection(original);setPending(false);clearReview();
      setAllocations(null);setAllocationId('');setReceipt(result.receipt);
      setMessage('Correction saved. The invoice balance reopened by the amount moved.');
    },'The correction outcome could not be confirmed. Check the original attempt before posting again.');
  }

  const selectedPayment=allocations?.find(row=>row.allocationId===allocationId);
  const first=options?.availableRanges.find(item=>item.firstCent===firstCent);
  const maximum=first?String(BigInt(first.lastCent)-BigInt(first.firstCent)+1n):null;
  return <details className="direct-receipt" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Correct an applied payment</summary>
    <section aria-label="Correct an applied payment" aria-busy={busy}>
      <p className="field-help">Move an amount from this invoice into customer funds. This reopens the invoice balance by the same amount. No cash is moved.</p>
      <button type="button" className="secondary" disabled={busy} onClick={()=>resolve()}>
        {pending?'Check original correction':'Load applied payments'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&absent&&<form onSubmit={event=>{event.preventDefault();if(retirementReason.trim())resolve(retirementReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={retirementReason} disabled={busy}
          onChange={event=>setRetirementReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {!pending&&allocations?.some(row=>row.availableCents!=='0')&&<form onSubmit={event=>{event.preventDefault();review();}}>
        <label>Applied payment<select required value={allocationId} disabled={busy}
          onChange={event=>{setAllocationId(event.target.value);clearReview();}}>
          <option value="">Choose a payment</option>
          {allocations.map((row,index)=><option value={row.allocationId} key={row.allocationId} disabled={row.availableCents==='0'}>
            {index+1}. {row.paidOn} · {quoteMoney(row.appliedCents)}
          </option>)}
        </select></label>
        {selectedPayment&&<p className="field-help">{quoteMoney(selectedPayment.availableCents)} remains applied and available to move.</p>}
        <label>Correction date (optional)<input type="date" value={date} disabled={busy}
          onChange={event=>{setDate(event.target.value);clearReview();}}/></label>
        <p className="field-help">A blank date uses today.</p>
        <button type="submit" className="secondary" disabled={busy||!allocationId}>Review correction</button>
      </form>}
      {!pending&&canWrite&&options?.fundsMappingId&&options.openPeriod&&maximum&&<form onSubmit={event=>{event.preventDefault();submit();}}>
        {options.availableRanges.length>1&&<label>Available portion<select value={firstCent} disabled={busy}
          onChange={event=>{setFirstCent(event.target.value);setAmount('');}}>
          {options.availableRanges.map((range,index)=><option key={range.firstCent} value={range.firstCent}>
            Portion {index+1} · {quoteMoney(String(BigInt(range.lastCent)-BigInt(range.firstCent)+1n))} available
          </option>)}
        </select></label>}
        <p className="field-help">Available to move · {quoteMoney(maximum)}</p>
        <label>Amount to move<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={amount}
          disabled={busy} onChange={event=>setAmount(event.target.value)}/></label>
        <label>Reason for correcting payment<textarea required maxLength={1000} rows={2} value={reason}
          disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
        <button type="submit" className="primary-action" disabled={busy||!amount.trim()||!reason.trim()}>Move to customer funds</button>
      </form>}
      {receipt&&<>
        <p><strong>{quoteMoney(receipt.cents)}</strong> moved to customer funds on {receipt.effectiveOn}.</p>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-payment-correction.csv',[
          ['Correction ID','Payment application ID','Invoice receivable ID','Customer fund lot ID','Date','Amount cents','Reason'],
          [receipt.unapplicationId,receipt.allocationId,receipt.receivableId,receipt.fundLotId,receipt.effectiveOn,receipt.cents,receipt.reason],
        ])}>Download correction (CSV)</button>
      </>}
    </section>
  </details>;
}
