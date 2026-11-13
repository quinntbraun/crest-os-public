'use client';

import {useEffect,useRef,useState} from 'react';
import {clearPendingDirectReceipt,downloadFinanceHistory,financeAccounts,readPendingDirectReceipt,
  retainPendingDirectReceipt} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {parseDirectReceiptInput} from '../../../bookkeeping/direct-receipt-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';

type Options=Extract<Awaited<ReturnType<typeof financeAccounts.directReceiptOptions>>,{state:'ready'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupDirectReceipt>>,{state:'committed'}>['receipt'];
const failureText:Readonly<Record<string,string>>={
  DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED:'A similar payment is already saved. Review it before recording a distinct receipt.',
  DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED:'This provider reference is already recorded.',
  DIRECT_RECEIPT_ALREADY_RECORDED:'This payment is already recorded.',
  DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE:'The invoice balance changed. Reload balances and review the payment.',
  DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED:'The destination account changed. Reload and select a verified account.',
  DIRECT_RECEIPT_DATE_REQUIRED:'Enter the date the money was received.',
  ACCOUNTING_OPEN_PERIOD_REQUIRED:'Open the accounting period for the receipt date before posting.',
};

export function DirectReceipt({businessId,customerId,invoiceId}: {businessId:string;customerId:string;invoiceId:string}){
  const [date,setDate]=useState('');
  const [options,setOptions]=useState<Options|null>(null);
  const [channel,setChannel]=useState('');
  const [allocations,setAllocations]=useState<Readonly<Record<string,string>>>({});
  const [confirmation,setConfirmation]=useState('');
  const [referenceId,setReferenceId]=useState('');
  const [namespace,setNamespace]=useState('');
  const [distinctReason,setDistinctReason]=useState('');
  const [retireReason,setRetireReason]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [absent,setAbsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [canWrite,setCanWrite]=useState(false);
  const [message,setMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);

  function suspend(){
    request.current?.abort();request.current=null;
    setDate('');setOptions(null);setChannel('');setAllocations({});setConfirmation('');
    setReferenceId('');setNamespace('');setDistinctReason('');setRetireReason('');setReceipt(null);
    setPending(false);setAbsent(false);setBusy(false);setCanWrite(false);setMessage('');
  }
  useEffect(()=>{
    const hidden=()=>{if(document.visibilityState==='hidden')suspend();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',suspend);
    return ()=>{
      request.current?.abort();
      document.removeEventListener('visibilitychange',hidden);
      window.removeEventListener('pagehide',suspend);
    };
  },[businessId,customerId,invoiceId]);

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(request.current)return;
    const controller=new AbortController();
    request.current=controller;setBusy(true);setMessage('Checking saved payment details…');
    try{
      const context=await financeAccounts.context(controller.signal);
      if(controller.signal.aborted)return;
      if(!context.directReceipts||context.businessId!==businessId){setMessage('Payments are unavailable for this workspace.');return;}
      setCanWrite(context.writeState==='ready');
      await action(context,controller.signal);
    }catch{if(!controller.signal.aborted)setMessage(failure);}
    finally{
      if(request.current===controller){
        request.current=null;setBusy(false);status.current?.focus();
      }
    }
  }

  function resolve(reason?:string){
    void run(async(context,signal)=>{
      const original=readPendingDirectReceipt();
      setPending(original!==null);setAbsent(false);
      if(original){
        if(original.businessId!==businessId||original.binding!==context.binding||original.invoiceId!==invoiceId){
          setMessage('Open the original invoice in the same sign-in to review the interrupted payment.');return;
        }
        const result=reason?await financeAccounts.retireDirectReceipt(context,original.reference,reason,signal)
          :await financeAccounts.lookupDirectReceipt(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error();
          clearPendingDirectReceipt(original);setPending(false);setOptions(null);
          if(result.state==='committed'){
            setReceipt(result.receipt);setAllocations({});setConfirmation('');
            setReferenceId('');setNamespace('');setDistinctReason('');
          }
          setMessage(result.state==='committed'?'The original payment was saved.':'The original attempt was closed.');
          setRetireReason('');
          return;
        }
        setAbsent(result.state==='absent'&&context.writeState==='ready');
        setMessage(result.state==='absent'?'No saved payment was found. Close this attempt before recording another.'
          :'Crest could not confirm the original payment.');
        return;
      }
      setOptions(null);setReceipt(null);
      const available=await financeAccounts.directReceiptOptions(context,customerId,date||null,signal);
      if(signal.aborted)return;
      if(available.state==='absent'){setMessage('The saved customer is unavailable.');return;}
      setOptions(available);setDate(available.actualOn);setChannel(available.channels.length===1?available.channels[0]!.channelId:'');
      setAllocations({});
      setMessage(!available.channels.length?'Set up a verified business money account to record payment.'
        :!available.receivables.length?'This customer has no outstanding invoices for that date.'
        :context.writeState!=='ready'?'Saved balances loaded. Payment posting is paused.':'Saved balances loaded.');
    },'Crest could not verify the payment details. Try loading them again.');
  }

  function record(){
    const selected=options?.channels.find(row=>row.channelId===channel);
    if(!selected||!options||!confirmation.trim()){setMessage('Choose a destination and describe how you verified the receipt.');return;}
    let distribution:Record<string,string>,grossCents:string;
    try{
      distribution=Object.fromEntries(Object.entries(allocations).filter(([,amount])=>amount.trim()).map(([id,amount])=>{
        const cents=quoteDollarsInput(amount.trim()),balance=options.receivables.find(item=>item.receivableId===id)?.remainingCents;
        if(!balance||cents==='0'||BigInt(cents)>BigInt(balance))throw Error();
        return [id,cents];
      }));
      grossCents=String(Object.values(distribution).reduce((sum,cents)=>sum+BigInt(cents),0n));
      if(grossCents==='0')throw Error();
    }catch{setMessage('Enter a positive dollar amount within the saved balance for each invoice you are paying.');return;}
    if(!!referenceId.trim()!==!!namespace.trim()){setMessage('Enter both the provider ID and its namespace, or leave both blank.');return;}
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingDirectReceipt()){
        setMessage('Payments are paused or an original payment needs review.');return;
      }
      const input=parseDirectReceiptInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,paymentId:crypto.randomUUID()},
        customerId,channelId:selected.channelId,channelVersion:selected.version,actualOn:options.actualOn,grossCents,
        confirmation:confirmation.trim(),distinctReason:distinctReason.trim()||null,
        externalIdentity:referenceId.trim()?{namespace:namespace.trim(),id:referenceId.trim(),rawReference:referenceId.trim()}:null,
        applications:distribution,
      });
      const original=retainPendingDirectReceipt(context,invoiceId,input.reference);
      setPending(true);
      const result=await financeAccounts.recordDirectReceipt(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='refused'){
        clearPendingDirectReceipt(original);setPending(false);
        setMessage(failureText[result.reason]??'The payment was refused. Review the saved details.');
        return;
      }
      if(result.state!=='committed')throw Error();
      clearPendingDirectReceipt(original);setPending(false);setOptions(null);setReceipt(result.receipt);
      setAllocations({});setConfirmation('');setReferenceId('');setNamespace('');setDistinctReason('');
      setMessage('Payment recorded.');
    },'The payment outcome could not be confirmed. Check the original attempt before recording another.');
  }

  return <details className="direct-receipt" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Record a fictional payment</summary>
    <section aria-label="Record a fictional payment" aria-busy={busy}>
      <p className="field-help">Record money already received into a verified business account.</p>
      <label>Date received<input type="date" value={date} disabled={busy||pending}
        onChange={event=>{setDate(event.target.value);setOptions(null);setReceipt(null);}}/></label>
      <button type="button" className="secondary" disabled={busy} onClick={()=>resolve()}>
        {pending?'Check original payment':'Load saved balances'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&absent&&<form onSubmit={event=>{event.preventDefault();if(retireReason.trim())resolve(retireReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={retireReason}
          onChange={event=>setRetireReason(event.target.value)} disabled={busy}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {canWrite&&options&&options.channels.length>0&&options.receivables.length>0&&!pending&&<form onSubmit={event=>{event.preventDefault();record();}}>
        <label>Money received in<select required value={channel} onChange={event=>setChannel(event.target.value)} disabled={busy}>
          <option value="">Choose an account</option>
          {options.channels.map(row=><option key={row.channelId} value={row.channelId}>{row.label}</option>)}
        </select></label>
        <fieldset><legend>Apply the payment</legend>
          <p className="field-help">Leave an invoice blank to skip it.</p>
          {[...options.receivables].sort((a,b)=>Number(b.invoiceId===invoiceId)-Number(a.invoiceId===invoiceId)).map(row=>
            <label key={row.receivableId}>Invoice {row.invoiceNumber} · {quoteMoney(row.remainingCents)} due
              <input inputMode="decimal" maxLength={22} value={allocations[row.receivableId]??''} disabled={busy}
                onChange={event=>setAllocations({...allocations,[row.receivableId]:event.target.value})} placeholder="0.00"/>
            </label>)}
        </fieldset>
        <label>How you verified the payment<input required maxLength={1000} value={confirmation}
          onChange={event=>setConfirmation(event.target.value)} disabled={busy}/></label>
        <details className="direct-receipt-options">
          <summary>Provider reference and duplicate review</summary>
          <p className="field-help">Use the ID and namespace shown in the provider record.</p>
          <label>Provider transaction ID (optional)<input maxLength={200} value={referenceId}
            onChange={event=>setReferenceId(event.target.value)} disabled={busy}/></label>
          <label>Provider ID namespace (optional)<input maxLength={80} value={namespace}
            onChange={event=>setNamespace(event.target.value)} disabled={busy}/></label>
          <label>Why this is a distinct payment (optional)<input maxLength={1000} value={distinctReason}
            onChange={event=>setDistinctReason(event.target.value)} disabled={busy}/></label>
        </details>
        <button type="submit" className="primary-action" disabled={busy||!Object.values(allocations).some(amount=>amount.trim())}>Record payment</button>
      </form>}
      {receipt&&<div>
        <p><strong>{quoteMoney(receipt.grossCents)}</strong> received on {receipt.actualOn}.</p>
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-payment.csv',[
          ['Payment ID','Received on','Total cents','Receivable ID','Applied cents'],
          ...receipt.applications.map(row=>[receipt.paymentId,receipt.actualOn,receipt.grossCents,row.receivableId,row.cents]),
        ])}>Download payment (CSV)</button>
      </div>}
    </section>
  </details>;
}
