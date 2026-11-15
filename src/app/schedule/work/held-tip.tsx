'use client';

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {calculateHeldTipReview,parseHeldTipInput} from '../../../bookkeeping/held-tip-contract';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import {
  clearPendingHeldTip,downloadFinanceHistory,financeAccounts,readPendingHeldTip,retainPendingHeldTip,
} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.heldTipOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupHeldTip>>,{state:'committed'}>['receipt'];

export function HeldTip({businessId,customerId}:{businessId:string;customerId:string}){
  const [date,setDate]=useState('');
  const [jurisdiction,setJurisdiction]=useState('');
  const [review,setReview]=useState<Review|null>(null);
  const [lotId,setLotId]=useState('');
  const [rangeStart,setRangeStart]=useState('');
  const [amount,setAmount]=useState('');
  const [intent,setIntent]=useState('');
  const [reason,setReason]=useState('');
  const [closeReason,setCloseReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [closable,setClosable]=useState(false);
  const [canPost,setCanPost]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const fieldId=useId();
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);
  const lot=review?.lots.find(item=>item.fundLotId===lotId);
  const range=lot?.availableRanges.find(item=>item.firstCent===rangeStart);
  const matchingReview=review?.jurisdiction===jurisdiction;
  const basis=matchingReview?lot?.basis:null;
  const available=range?BigInt(range.lastCent)-BigInt(range.firstCent)+1n:0n;
  let lastCent:string|null=null;
  if(range&&amount){
    try{
      const cents=BigInt(quoteDollarsInput(amount));
      if(cents>0n&&cents<=available)lastCent=String(BigInt(range.firstCent)+cents-1n);
    }catch{/* The amount field remains editable. */}
  }
  const charge=basis&&range&&lastCent?calculateHeldTipReview(range.firstCent,lastCent,basis.rate):null;
  const validIntent=financeAccountReviewReason(intent.trim());
  const validReason=financeAccountReviewReason(reason.trim());

  const clearAmounts=useCallback(()=>{
    setLotId('');setRangeStart('');setAmount('');setIntent('');setReason('');
  },[]);
  const suspend=useCallback(()=>{
    request.current?.abort();request.current=null;
    setDate('');setJurisdiction('');setReview(null);clearAmounts();setCloseReason('');
    setReceipt(null);setPending(false);setClosable(false);setCanPost(false);setBusy(false);setMessage('');
  },[clearAmounts]);
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')suspend();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',suspend);
    return ()=>{
      request.current?.abort();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pagehide',suspend);
    };
  },[businessId,customerId,suspend]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(request.current)return;
    const controller=new AbortController(),signal=controller.signal;
    request.current=controller;setBusy(true);setMessage('Checking the saved customer funds…');
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.heldTips||context.businessId!==businessId){
        setMessage('Recording held tips is unavailable for this workspace.');return;
      }
      setCanPost(context.writeState==='ready');
      await action(context,signal);
    }catch{if(!signal.aborted)setMessage(failure);}
    finally{if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}}
  }

  function load(retirementReason?:string){
    void run(async(context,signal)=>{
      const original=readPendingHeldTip();
      setPending(original!==null);setClosable(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.customerId!==customerId){
          setMessage('Open this customer’s original invoice in the same sign-in to check the attempt.');return;
        }
        const result=retirementReason
          ?await financeAccounts.retireHeldTip(context,original.reference,retirementReason,signal)
          :await financeAccounts.lookupHeldTip(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error('HELD_TIP_CUSTOMER_CHANGED');
          clearPendingHeldTip(original);setPending(false);setCloseReason('');setReview(null);clearAmounts();
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original tip was recorded.':'The original attempt was closed.');
          return;
        }
        setClosable(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved tip was found. Close the original attempt before recording it again.'
          :'Crest could not match the original attempt.');
        return;
      }
      setReceipt(null);clearAmounts();
      if(matchingReview)setReview(null);
      const result=await financeAccounts.heldTipOptions(context,customerId,jurisdiction||null,date||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setReview(null);setMessage('The saved customer is unavailable.');return;}
      setReview(result);
      if(result.lots.length===1){
        const only=result.lots[0]!;
        setLotId(only.fundLotId);setRangeStart(only.availableRanges[0]!.firstCent);
      }
      setMessage(!result.lots.length?'No eligible funds are held for this customer on that date.'
        :!result.openPeriod?'The selected date needs an open accounting period.'
        :context.writeState!=='ready'?'Saved funds loaded. Posting is paused.'
        :!result.jurisdictions.length?'Approve a dated tip tax profile in Accounting before recording a tip.'
        :!result.jurisdiction?'Choose the jurisdiction for this tip, then load the reviewed tax treatment.'
        :!result.lots.some(item=>item.basis)?'No approved tax treatment and account mapping cover this date and jurisdiction.'
        :'Enter the amount and how the customer confirmed it.');
    },'Crest could not load held funds or check the original tip. Try checking again.');
  }

  function submit(){
    if(!review||!lot||!basis||!range||!lastCent||!charge||!review.openPeriod||!validIntent||!validReason)return;
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingHeldTip()){
        setMessage('Posting is paused or an original tip needs review.');return;
      }
      const input=parseHeldTipInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,tipRealizationId:crypto.randomUUID()},
        customerId,fundLotId:lot.fundLotId,effectiveOn:review.effectiveOn,firstCent:range.firstCent,lastCent,
        jurisdiction,taxProfileId:basis.taxProfileId,revenueMappingId:basis.revenueMappingId,taxMappingId:basis.taxMappingId,
        customerIntentEvidence:intent.trim(),reason:reason.trim(),
      });
      const original=retainPendingHeldTip(context,customerId,input.reference);
      setPending(true);
      const result=await financeAccounts.submitHeldTip(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingHeldTip(original);setPending(false);setReview(null);clearAmounts();
        setMessage('The tip was refused. Reload the held funds and tax treatment before trying again.');return;
      }
      if(result.state!=='committed')throw Error('HELD_TIP_OUTCOME_UNKNOWN');
      clearPendingHeldTip(original);setPending(false);setReview(null);clearAmounts();setReceipt(result.receipt);
      setMessage('Tip recorded. The saved entry shows the amount moved out of held funds.');
    },'The outcome could not be confirmed. Check the original tip before trying again.');
  }

  return <details className="direct-receipt held-tip" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Record a tip from held funds</summary>
    <section aria-label="Record a tip from held funds" aria-busy={busy}>
      <p className="field-help">Use this when the customer confirms how much of their held funds is a tip. No new money is received.</p>
      {!pending&&<label>Tip date (optional)<input type="date" value={date} disabled={busy}
        onChange={event=>{setDate(event.target.value);setJurisdiction('');setReview(null);clearAmounts();}}/></label>}
      {!pending&&!date&&<p className="field-help">Leave blank to use today in the workspace time zone.</p>}
      {!pending&&!!review?.jurisdictions.length&&<>
        <label htmlFor={fieldId+'-jurisdiction'}>Tip jurisdiction</label>
        <select id={fieldId+'-jurisdiction'} value={jurisdiction} disabled={busy} onChange={event=>{setJurisdiction(event.target.value);clearAmounts();}}>
          <option value="">Choose a jurisdiction</option>
          {review.jurisdictions.map(item=><option key={item} value={item}>{item}</option>)}
        </select>
      </>}
      <button type="button" className="secondary" disabled={busy} onClick={()=>load()}>
        {pending?'Check original tip':jurisdiction?'Load reviewed tax treatment':'Load held funds'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&closable&&<form onSubmit={event=>{event.preventDefault();if(closeReason.trim())load(closeReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={closeReason} disabled={busy}
          onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {!pending&&review&&matchingReview&&review.lots.length>0&&<form onSubmit={event=>{event.preventDefault();submit();}}>
        <fieldset disabled={busy||!canPost||!review.openPeriod}>
          <legend>Customer-confirmed tip</legend>
          {review.lots.length===1&&lot?<p className="field-help">Funds held on <time dateTime={lot.heldOn}>{lot.heldOn}</time></p>:<>
          <label htmlFor={fieldId+'-funds'}>Held funds</label>
          <select id={fieldId+'-funds'} value={lotId} onChange={event=>{
            const id=event.target.value;
            setLotId(id);setRangeStart(review.lots.find(item=>item.fundLotId===id)?.availableRanges[0]?.firstCent??'');setAmount('');
          }}>
            <option value="">Choose held funds</option>
            {review.lots.map((item,index)=><option key={item.fundLotId} value={item.fundLotId} disabled={!item.basis}>
              {index+1} · {item.heldOn}
            </option>)}
          </select></>}
          {lot&&lot.availableRanges.length>1&&<>
            <label htmlFor={fieldId+'-portion'}>Available portion</label>
            <select id={fieldId+'-portion'} value={rangeStart} onChange={event=>{
            setRangeStart(event.target.value);setAmount('');
          }}>
            {lot.availableRanges.map((item,index)=><option key={item.firstCent} value={item.firstCent}>
              Portion {index+1} · {quoteMoney(String(BigInt(item.lastCent)-BigInt(item.firstCent)+1n))} available
            </option>)}
            </select>
          </>}
          {basis&&range&&<>
            <p className="field-help">{quoteMoney(String(available))} available in this portion.</p>
            <label>Tip amount (USD)<input inputMode="decimal" required maxLength={22} value={amount}
              onChange={event=>setAmount(event.target.value)}/></label>
            {charge&&<dl className="customer-values" aria-label="Tip posting preview">
              <dt>Held funds used</dt><dd>{quoteMoney(charge.inclusiveCents)}</dd>
              <dt>Tip revenue</dt><dd>{quoteMoney(charge.netCents)}</dd>
              <dt>Included tax</dt><dd>{quoteMoney(charge.taxCents)}</dd>
            </dl>}
            <label>How did the customer confirm the tip?<textarea required maxLength={1000} rows={2} value={intent}
              aria-invalid={!!intent&&!validIntent}
              onChange={event=>setIntent(event.target.value)}/></label>
            <label>What did you review?<textarea required maxLength={1000} rows={2} value={reason}
              aria-invalid={!!reason&&!validReason}
              onChange={event=>setReason(event.target.value)}/></label>
            {(!!intent&&!validIntent||!!reason&&!validReason)&&<p className="field-help">Enter a short note in each field without line breaks.</p>}
            <button type="submit" disabled={!charge||!validIntent||!validReason}>Record tip</button>
          </>}
        </fieldset>
      </form>}
      {receipt&&<section aria-label="Saved tip receipt">
        <h4>Saved tip</h4>
        <dl className="customer-values">
          <dt>Date</dt><dd>{receipt.effectiveOn}</dd>
          <dt>Held funds used</dt><dd>{quoteMoney(receipt.inclusiveCents)}</dd>
          <dt>Tip revenue</dt><dd>{quoteMoney(receipt.netCents)}</dd>
          <dt>Included tax</dt><dd>{quoteMoney(receipt.taxCents)}</dd>
        </dl>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-held-tip-'+receipt.tipRealizationId+'.csv',[
          ['Tip ID','Event ID','Held funds ID','Date','Jurisdiction','Held cents','Tip revenue cents','Tax cents','Customer confirmation','Review reason'],
          [receipt.tipRealizationId,receipt.eventId,receipt.fundLotId,receipt.effectiveOn,receipt.jurisdiction,receipt.inclusiveCents,
            receipt.netCents,receipt.taxCents,receipt.customerIntentEvidence,receipt.reason],
        ])}>Download saved tip CSV</button>
      </section>}
    </section>
  </details>;
}
