'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {clearPendingFundApplication,downloadFinanceHistory,financeAccounts,readPendingFundApplication,
  retainPendingFundApplication} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {parseFundApplicationInput} from '../../../bookkeeping/fund-application-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.fundApplicationOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupFundApplication>>,{state:'committed'}>['receipt'];
const rangeSize=(range:{firstCent:string;lastCent:string})=>BigInt(range.lastCent)-BigInt(range.firstCent)+1n;

export function FundApplication({businessId,customerId,invoiceId}: {businessId:string;customerId:string;invoiceId:string}){
  const [date,setDate]=useState('');
  const [review,setReview]=useState<Review|null>(null);
  const [lotId,setLotId]=useState('');
  const [firstCent,setFirstCent]=useState('');
  const [amount,setAmount]=useState('');
  const [reason,setReason]=useState('');
  const [closeReason,setCloseReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [absent,setAbsent]=useState(false);
  const [canWrite,setCanWrite]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);
  const lot=review?.lots.find(item=>item.fundLotId===lotId);
  const range=lot?.availableRanges.find(item=>item.firstCent===firstCent);
  const balance=BigInt(review?.availableBalanceCents??'0');
  const portion=range?rangeSize(range):0n;
  const limit=portion<balance?portion:balance;

  const clearReview=useCallback(()=>{
    setReview(null);setLotId('');setFirstCent('');setAmount('');setReason('');
  },[]);
  const suspend=useCallback(()=>{
    request.current?.abort();request.current=null;
    setDate('');clearReview();setCloseReason('');setReceipt(null);
    setPending(false);setAbsent(false);setCanWrite(false);setBusy(false);setMessage('');
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
    request.current=controller;setBusy(true);setMessage('Checking saved customer funds…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.fundApplications||context.businessId!==businessId){
        setMessage('Applying customer funds is unavailable for this workspace.');return;
      }
      setCanWrite(context.writeState==='ready');
      await action(context,signal);
    }catch{if(!signal.aborted)setMessage(failure);}
    finally{if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}}
  }

  function load(retirementReason?:string){
    void run(async(context,signal)=>{
      const original=readPendingFundApplication();
      setPending(original!==null);setAbsent(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to check this application.');return;
        }
        const result=retirementReason?await financeAccounts.retireFundApplication(context,original.reference,retirementReason,signal)
          :await financeAccounts.lookupFundApplication(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&(result.receipt.customerId!==customerId||result.receipt.invoiceId!==invoiceId))throw Error();
          clearPendingFundApplication(original);setPending(false);setCloseReason('');clearReview();
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original funds application was saved.':'The original attempt was closed.');
          return;
        }
        setAbsent(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved application was found. Close this attempt before applying funds again.'
          :'Crest could not confirm the original application.');
        return;
      }
      clearReview();setReceipt(null);
      const result=await financeAccounts.fundApplicationOptions(context,customerId,invoiceId,date||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('The saved invoice is unavailable.');return;}
      setReview(result);setDate(result.effectiveOn);
      const onlyLot=result.lots.length===1?result.lots[0]:undefined;
      if(onlyLot){setLotId(onlyLot.fundLotId);setFirstCent(onlyLot.availableRanges[0]!.firstCent);}
      setMessage(result.availableBalanceCents==='0'?'This invoice has no balance available for an application.'
        :!result.lots.length?'No eligible funds are held for this customer on that date.'
        :!result.openPeriod?'The application date needs an open accounting period.'
        :context.writeState!=='ready'?'Saved funds loaded. Posting is paused.':'Review the amount before applying funds.');
    },'Crest could not check the original attempt or load available customer funds.');
  }

  function apply(){
    if(!review||!lot||!range||!review.openPeriod||!reason.trim())return;
    let lastCent:string;
    try{
      const cents=BigInt(quoteDollarsInput(amount));
      if(cents<=0n||cents>limit)throw Error();
      lastCent=String(BigInt(range.firstCent)+cents-1n);
    }catch{setMessage('Enter a positive amount up to the maximum shown.');status.current?.focus();return;}
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingFundApplication()){
        setMessage('Posting is paused or an original application needs review.');return;
      }
      const input=parseFundApplicationInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,fundApplicationId:crypto.randomUUID()},
        fundLotId:lot.fundLotId,receivableId:review.receivableId,customerId,effectiveOn:review.effectiveOn,
        firstCent:range.firstCent,lastCent,reason:reason.trim(),
      });
      const original=retainPendingFundApplication(context,invoiceId,input.reference);
      setPending(true);
      const result=await financeAccounts.submitFundApplication(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingFundApplication(original);setPending(false);clearReview();
        setMessage('The application was refused. Reload the invoice balance and held funds.');return;
      }
      if(result.state!=='committed'||result.receipt.invoiceId!==invoiceId)throw Error();
      clearPendingFundApplication(original);setPending(false);clearReview();setReceipt(result.receipt);
      setMessage('Funds applied. The invoice balance decreased by the amount shown.');
    },'The outcome could not be confirmed. Check the original application before trying again.');
  }

  return <details className="direct-receipt" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Apply customer funds</summary>
    <section aria-label="Apply customer funds" aria-busy={busy}>
      <p className="field-help">Use money already held for this customer to reduce this invoice balance.</p>
      {!pending&&<label>Application date (optional)<input type="date" value={date} disabled={busy}
        onChange={event=>{setDate(event.target.value);clearReview();}}/></label>}
      {!pending&&!date&&<p className="field-help">A blank date uses today.</p>}
      <button type="button" className="secondary" disabled={busy} onClick={()=>load()}>
        {pending?'Check original application':'Load available funds'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&absent&&<form onSubmit={event=>{event.preventDefault();if(closeReason.trim())load(closeReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={closeReason} disabled={busy}
          onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {!pending&&review&&<p className="field-help">Invoice balance available to pay · {quoteMoney(review.availableBalanceCents)}</p>}
      {!pending&&canWrite&&review?.openPeriod&&balance>0n&&review.lots.length>0&&<form onSubmit={event=>{event.preventDefault();apply();}}>
        <label>Held funds<select required value={lotId} disabled={busy} onChange={event=>{
          const selected=review.lots.find(item=>item.fundLotId===event.target.value);
          setLotId(event.target.value);setFirstCent(selected?.availableRanges[0]?.firstCent??'');setAmount('');
        }}>
          <option value="">Choose held funds</option>
          {review.lots.map((item,index)=><option value={item.fundLotId} key={item.fundLotId}>
            {index+1}. {item.heldOn} · {quoteMoney(String(item.availableRanges.reduce((sum,part)=>sum+rangeSize(part),0n)))}
          </option>)}
        </select></label>
        {lot&&lot.availableRanges.length>1&&<label>Available portion<select value={firstCent} disabled={busy}
          onChange={event=>{setFirstCent(event.target.value);setAmount('');}}>
          {lot.availableRanges.map((part,index)=><option key={part.firstCent} value={part.firstCent}>
            Portion {index+1} · {quoteMoney(String(rangeSize(part)))} available
          </option>)}
        </select></label>}
        {range&&<p className="field-help">Maximum to apply · {quoteMoney(String(limit))}</p>}
        <label>Amount to apply<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={amount}
          disabled={busy} onChange={event=>setAmount(event.target.value)}/></label>
        <label>Reason for applying funds<textarea required maxLength={1000} rows={2} value={reason} disabled={busy}
          onChange={event=>setReason(event.target.value)}/></label>
        <button type="submit" className="primary-action" disabled={busy||limit===0n||!amount.trim()||!reason.trim()}>
          Apply funds to invoice
        </button>
      </form>}
      {receipt&&<>
        <p><strong>{quoteMoney(receipt.cents)}</strong> applied on {receipt.effectiveOn}.</p>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-customer-funds-application.csv',receipt.collectionFailureRecreditEventId?[
          ['Application ID','Customer funds lot ID','Restored deposit event ID','Invoice ID','Date','Amount cents','Reason'],
          [receipt.fundApplicationId,receipt.fundLotId,receipt.collectionFailureRecreditEventId,receipt.invoiceId,
            receipt.effectiveOn,receipt.cents,receipt.reason],
        ]:receipt.receiptEventId?[
          ['Application ID','Customer funds lot ID','Original payment event ID','Invoice ID','Date','Amount cents','Reason'],
          [receipt.fundApplicationId,receipt.fundLotId,receipt.receiptEventId,receipt.invoiceId,receipt.effectiveOn,receipt.cents,receipt.reason],
        ]:[
          ['Application ID','Customer funds lot ID','Invoice ID','Date','Amount cents','Reason'],
          [receipt.fundApplicationId,receipt.fundLotId,receipt.invoiceId,receipt.effectiveOn,receipt.cents,receipt.reason],
        ])}>Download funds application (CSV)</button>
      </>}
    </section>
  </details>;
}
