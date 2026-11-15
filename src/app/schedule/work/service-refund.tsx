'use client';

import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {parseServiceRefundInput} from '../../../bookkeeping/service-refund-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingServiceRefund,downloadFinanceHistory,financeAccounts,readPendingServiceRefund,retainPendingServiceRefund}
  from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.serviceRefundOptions>>,{state:'review'}>;
type Credits=Awaited<ReturnType<typeof financeAccounts.serviceRefundCredits>>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupServiceRefund>>,{state:'committed'}>['receipt'];
const empty={credit:'',date:'',amount:'',channel:'',part:'',namespace:'',externalId:'',rawReference:'',confirmation:'',reason:''};
const rangeSize=(part:{firstCent:string;lastCent:string})=>BigInt(part.lastCent)-BigInt(part.firstCent)+1n;
function readCents(amount:string){try{return BigInt(quoteDollarsInput(amount));}catch{return 0n;}}

export function ServiceRefund({businessId,customerId,invoiceId}:{businessId:string;customerId:string;invoiceId:string}){
  const [form,setForm]=useState(empty),[credits,setCredits]=useState<Credits>([]),[review,setReview]=useState<Review|null>(null);
  const [pending,setPending]=useState(false),[closable,setClosable]=useState(false),[closeReason,setCloseReason]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[receipt,setReceipt]=useState<Receipt|null>(null);
  const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
  const channelField=useId();
  const cents=readCents(form.amount),ranges=review?.availableRanges.filter(part=>cents>0n&&rangeSize(part)>=cents)??[];
  const range=ranges.length===1?ranges[0]:ranges.find(part=>part.firstCent===form.part);
  const channel=review?.channels.find(item=>item.channelId===form.channel);
  const suspend=useCallback(()=>{
    active.current?.abort();active.current=null;setForm(empty);setCredits([]);setReview(null);
    setPending(false);setClosable(false);setCloseReason('');setReceipt(null);setMessage('');setBusy(false);
  },[]);
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')suspend();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',suspend);
    return ()=>{active.current?.abort();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',suspend);};
  },[suspend]);

  function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(active.current)return;
    const controller=new AbortController(),{signal}=controller;active.current=controller;setBusy(true);
    setMessage('Checking refund records…');
    void (async()=>{
      try{
        const context=await financeAccounts.context(signal);
        if(signal.aborted)return;
        if(!context.serviceRefunds||context.businessId!==businessId){setMessage('Refund recording is unavailable.');return;}
        await action(context,signal);
      }catch{if(!signal.aborted)setMessage(failure);}
      finally{if(active.current===controller){active.current=null;setBusy(false);status.current?.focus();}}
    })();
  }
  function update(field:keyof typeof empty,value:string){
    setForm(previous=>({...previous,[field]:value,...field==='amount'?{part:''}:{}}));
    if(field==='date'||field==='credit')setReview(null);
  }
  function load(reason?:string){
    run(async(context,signal)=>{
      const original=readPendingServiceRefund();
      setPending(original!==null);setClosable(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to check this refund.');return;
        }
        const result=reason?await financeAccounts.retireServiceRefund(context,original.reference,reason,signal)
          :await financeAccounts.lookupServiceRefund(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error();
          clearPendingServiceRefund(original);setPending(false);setForm(empty);setReview(null);setCredits([]);setCloseReason('');
          setReceipt(result.state==='committed'?result.receipt:null);
          setMessage(result.state==='committed'?'The original refund record was saved.':'The original attempt was closed.');
        }else{
          setClosable(result.state==='absent'&&context.writeState==='ready');
          setMessage(result.state==='absent'?'No saved refund record was found. Close this attempt before starting again.'
            :'Crest could not match the original attempt.');
        }
        return;
      }
      const saved=await financeAccounts.serviceRefundCredits(context,customerId,invoiceId,signal);
      if(signal.aborted)return;
      const available=saved.filter(credit=>credit.availableCents!=='0');
      setCredits(available);setReview(null);setReceipt(null);setForm({...empty,credit:available.length===1?available[0]!.pairedCreditId:''});
      setMessage(available.length?'Enter the date the refund settled.':'No credit on this invoice has funds available to refund.');
    },'Crest could not verify the original attempt or load available credits.');
  }
  function reviewRefund(){
    run(async(context,signal)=>{
      if(readPendingServiceRefund()){setPending(true);setMessage('Check the original refund record first.');return;}
      setReview(null);
      const result=await financeAccounts.serviceRefundOptions(context,customerId,form.credit,form.date,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setMessage('That credit is unavailable. Reload available credits.');return;}
      if(context.writeState!=='ready'){setMessage('Posting is paused.');return;}
      if(!result.openPeriod){setMessage('The settlement date must be in an open accounting period.');return;}
      if(!result.channels.length||!result.availableRanges.length){setMessage('No eligible account or available funds were found for this refund.');return;}
      setReview(result);
      setForm(previous=>({...empty,credit:previous.credit,date:previous.date,channel:result.channels.length===1?result.channels[0]!.channelId:''}));
      setMessage('Match the settled amount and transaction reference to your account record.');
    },'Crest could not verify the credit for that settlement date.');
  }
  function save(){
    if(!review||!range||!channel)return;
    run(async(context,signal)=>{
      if(!context.recoveryEpoch||context.writeState!=='ready'||readPendingServiceRefund()){
        setMessage('Posting is paused or an original refund needs review.');return;
      }
      const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,serviceRefundId:crypto.randomUUID()};
      let input:ReturnType<typeof parseServiceRefundInput>;
      try{
        input=parseServiceRefundInput({reference,pairedCreditId:form.credit,fundLotId:review.fundLotId,customerId,
          channelId:channel.channelId,channelVersion:channel.version,actualOn:review.actualOn,firstCent:range.firstCent,
          lastCent:String(BigInt(range.firstCent)+cents-1n),confirmation:form.confirmation.trim(),reason:form.reason.trim(),
          externalIdentity:{namespace:form.namespace.trim(),id:form.externalId.trim(),rawReference:form.rawReference.trim()}});
      }catch{setMessage('Check the amount and complete the transaction evidence.');return;}
      const original=retainPendingServiceRefund(context,invoiceId,reference);
      setPending(true);setForm(empty);setReview(null);setCredits([]);
      const result=await financeAccounts.recordServiceRefund(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='committed'){
        clearPendingServiceRefund(original);setPending(false);setReceipt(result.receipt);
        setMessage('Refund record saved.');
      }else if(result.state==='refused'){
        clearPendingServiceRefund(original);setPending(false);
        setMessage(result.reason==='external_refund_already_recorded'?'A refund with this transaction reference is already recorded.'
          :'The refund was refused. Load available credits and check the settlement evidence.');
      }else setMessage('Check the original attempt before starting another refund.');
    },'Crest could not confirm the save. Check the original refund before starting another.');
  }
  return <details className="direct-receipt invoice-credit service-refund" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Record a settled refund</summary>
    <section aria-label="Record a settled refund" aria-busy={busy}>
    <p className="field-help">Use this after the refund has settled in the bank or wallet. Crest records the outflow against the original credit.</p>
    <button className="secondary" type="button" disabled={busy} onClick={()=>load()}>{pending?'Check original refund':'Load available credits'}</button>
    <p ref={status} role="status" tabIndex={-1}>{message}</p>
    {pending&&closable&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))load(closeReason.trim());}}>
      <label>Reason for closing this attempt<textarea required maxLength={1000} rows={2} value={closeReason} onChange={event=>setCloseReason(event.target.value)}/></label>
      <button className="secondary" type="submit" disabled={busy||!financeAccountReviewReason(closeReason.trim())}>Close original attempt</button>
    </form>}
    {!pending&&credits.length>0&&!review&&<form onSubmit={event=>{event.preventDefault();reviewRefund();}}>
      {credits.length>1?<label>Credit<select required value={form.credit} disabled={busy} onChange={event=>update('credit',event.target.value)}>
        <option value="">Choose a credit</option>
        {credits.map(credit=><option key={credit.pairedCreditId} value={credit.pairedCreditId}>{credit.creditedOn} · {quoteMoney(credit.availableCents)} available</option>)}
      </select></label>:<p>Credit on {credits[0]!.creditedOn} · {quoteMoney(credits[0]!.availableCents)} available</p>}
      <label>Settlement date<input type="date" required value={form.date} disabled={busy} onChange={event=>update('date',event.target.value)}/></label>
      <button type="submit" className="secondary" disabled={busy||!form.credit}>Review refund</button>
    </form>}
    {!pending&&review&&<form onSubmit={event=>{event.preventDefault();save();}}>
      <fieldset disabled={busy}>
        <legend>Settled on {review.actualOn}</legend>
        <label htmlFor={channelField}>Refunded from</label>
        <select id={channelField} required value={form.channel} onChange={event=>update('channel',event.target.value)}>
          <option value="">Choose the bank or wallet</option>
          {review.channels.map(item=><option key={item.channelId} value={item.channelId}>{item.label}</option>)}
        </select>
        <label>Settled amount (USD)<input required inputMode="decimal" maxLength={22} placeholder="0.00" value={form.amount} onChange={event=>update('amount',event.target.value)}/></label>
        {cents>0n&&!ranges.length&&<p className="field-help">The available funds have no single portion large enough for this amount.</p>}
        {ranges.length>1&&<label>Available portion<select required value={form.part} onChange={event=>update('part',event.target.value)}>
          <option value="">Choose a portion</option>
          {ranges.map((part,index)=><option key={part.firstCent} value={part.firstCent}>Portion {index+1} · {quoteMoney(String(rangeSize(part)))} available</option>)}
        </select></label>}
        <fieldset className="service-refund-evidence"><legend>Transaction evidence</legend>
          <label>Reference type<input required maxLength={80} value={form.namespace} onChange={event=>update('namespace',event.target.value)}/></label>
          <label>Transaction ID<input required maxLength={200} value={form.externalId} onChange={event=>update('externalId',event.target.value)}/></label>
          <label>Reference as shown on the account<textarea required maxLength={1000} rows={2} value={form.rawReference} onChange={event=>update('rawReference',event.target.value)}/></label>
          <label>How you verified settlement<textarea required maxLength={1000} rows={2} value={form.confirmation} onChange={event=>update('confirmation',event.target.value)}/></label>
          <label>Reason for the refund<textarea required maxLength={1000} rows={2} value={form.reason} onChange={event=>update('reason',event.target.value)}/></label>
        </fieldset>
        <button className="primary-action" type="submit" disabled={!channel||!range}>Save refund record</button>
      </fieldset>
    </form>}
    {receipt&&<><p><strong>{quoteMoney(receipt.cents)}</strong> recorded for {receipt.actualOn}.</p>
      <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-service-refund.csv',[
        ['Refund ID','Credit ID','Released funds ID','Date','Refund cents','Confirmation','Reason'],
        [receipt.serviceRefundId,receipt.pairedCreditId,receipt.fundLotId,receipt.actualOn,receipt.cents,receipt.confirmation,receipt.reason],
      ])}>Download refund record (CSV)</button></>}
    </section>
  </details>;
}
