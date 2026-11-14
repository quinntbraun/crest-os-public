'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {clearPendingDirectReceipt,downloadFinanceHistory,financeAccounts,readPendingDirectReceipt,
  retainPendingDirectReceipt} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {parseDirectReceiptInput} from '../../../bookkeeping/direct-receipt-contract';
import {calculateInclusiveFinanceCharge,isFinanceCents} from '../../../bookkeeping/finance-inclusive-charge';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';

type Options=Extract<Awaited<ReturnType<typeof financeAccounts.directReceiptOptions>>,{state:'ready'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupDirectReceipt>>,{state:'committed'}>['receipt'];
type TipOptions=Extract<Awaited<ReturnType<typeof financeAccounts.directReceiptTipOptions>>,{state:'ready'}>;
const failureText:Readonly<Record<string,string>>={
  DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED:'A similar payment is already saved. Review it before recording a distinct receipt.',
  DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED:'This provider reference is already recorded.',
  DIRECT_RECEIPT_ALREADY_RECORDED:'This payment is already recorded.',
  DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE:'The invoice balance changed. Reload balances and review the payment.',
  DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED:'The destination account changed. Reload and select a verified account.',
  DIRECT_RECEIPT_DATE_REQUIRED:'Enter the date the money was received.',
  DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED:'The customer funds account for this date changed. Reload payment details and review the remainder.',
  DIRECT_RECEIPT_TIP_BASIS_REQUIRED:'The approved tip tax or accounts changed. Review the tip before saving again.',
  DIRECT_RECEIPT_TIP_AMOUNT_REQUIRED:'The tip and invoice amounts must fit within the total received.',
  MAPPING_NOT_READY:'The customer funds account needs review. Reload payment details before recording the remainder.',
  ACCOUNTING_OPEN_PERIOD_REQUIRED:'Open the accounting period for the receipt date before posting.',
};

function amounts(options:Options|null, allocations:Readonly<Record<string,string>>, received:string,tipAmount:string){
  if(!options)return null;
  const applications:Record<string,string>={};
  let applied=0n;
  try{
    for(const [id,amount] of Object.entries(allocations)){
      if(!amount.trim())continue;
      const cents=quoteDollarsInput(amount),balance=options.receivables.find(row=>row.receivableId===id)?.remainingCents;
      if(!balance||cents==='0'||BigInt(cents)>BigInt(balance))return null;
      applications[id]=cents;
      applied+=BigInt(cents);
    }
    const tip=tipAmount.trim()?BigInt(quoteDollarsInput(tipAmount)):0n;
    const assigned=applied+tip;
    const grossCents=received.trim()?quoteDollarsInput(received):String(assigned);
    if(!isFinanceCents(grossCents)||BigInt(grossCents)<assigned)return null;
    return {applications,grossCents,appliedCents:String(applied),tipCents:String(tip),heldCents:String(BigInt(grossCents)-assigned)};
  }catch{return null;}
}

export function DirectReceipt({businessId,customerId,invoiceId}: {businessId:string;customerId:string;invoiceId?:string}){
  const [date,setDate]=useState('');
  const [options,setOptions]=useState<Options|null>(null);
  const [channel,setChannel]=useState('');
  const [allocations,setAllocations]=useState<Readonly<Record<string,string>>>({});
  const [received,setReceived]=useState('');
  const [fundsMapping,setFundsMapping]=useState('');
  const [allowTips,setAllowTips]=useState(false);
  const [tipAmount,setTipAmount]=useState('');
  const [tipJurisdiction,setTipJurisdiction]=useState('');
  const [tipConfirmation,setTipConfirmation]=useState('');
  const [tipOptions,setTipOptions]=useState<TipOptions|null>(null);
  const tipStatus=useRef<HTMLParagraphElement>(null);
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
  const [tipMessage,setTipMessage]=useState('');
  const request=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement>(null);
  const distribution=amounts(options,allocations,received,tipAmount);
  const remainder=!!distribution&&distribution.heldCents!=='0';
  const excessAvailable=options?.fundsMappingId!==undefined;
  const heldFunds=receipt&&'heldFunds' in receipt?receipt.heldFunds:null;
  const savedTip=receipt&&'tip' in receipt?receipt.tip:null;
  const tipRequested=tipAmount.trim()!=='';
  const tipBasis=tipOptions?.selected;
  const tipReady=!!tipBasis&&tipOptions.openPeriod&&tipOptions.fundsMappingId!==null
    &&tipOptions.fundsMappingId===options?.fundsMappingId
    &&tipBasis.jurisdiction===tipJurisdiction&&!!tipConfirmation.trim()&&!!distribution&&distribution.tipCents!=='0';
  const tipTax=tipBasis&&distribution&&distribution.tipCents!=='0'
    ?calculateInclusiveFinanceCharge(distribution.tipCents,'0',tipBasis.rate??'0'):null;

  const resetTip=useCallback(()=>{
    setTipAmount('');setTipJurisdiction('');setTipConfirmation('');setTipOptions(null);setTipMessage('');
  },[]);

  const suspend=useCallback(()=>{
    request.current?.abort();request.current=null;
    setDate('');setOptions(null);setChannel('');setAllocations({});setConfirmation('');
    setReceived('');setFundsMapping('');
    setAllowTips(false);resetTip();
    setReferenceId('');setNamespace('');setDistinctReason('');setRetireReason('');setReceipt(null);
    setPending(false);setAbsent(false);setBusy(false);setCanWrite(false);setMessage('');
  },[resetTip]);
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

  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string,reviewingTip=false){
    if(request.current)return;
    const controller=new AbortController();
    const announce=reviewingTip?setTipMessage:setMessage;
    request.current=controller;setBusy(true);announce(reviewingTip?'Checking saved tip settings…':'Checking saved payment details…');
    try{
      const context=await financeAccounts.context(controller.signal);
      if(controller.signal.aborted)return;
      if(!context.directReceipts||context.businessId!==businessId){announce('Payments are unavailable for this workspace.');return;}
      setCanWrite(context.writeState==='ready');
      await action(context,controller.signal);
    }catch{if(!controller.signal.aborted)announce(failure);}
    finally{
      if(request.current===controller){
        request.current=null;setBusy(false);(reviewingTip?tipStatus:status).current?.focus();
      }
    }
  }

  function resolve(reason?:string){
    void run(async(context,signal)=>{
      const original=readPendingDirectReceipt();
      setPending(original!==null);setAbsent(false);
      if(original){
        const matchesLocation='invoiceId' in original?original.invoiceId===invoiceId
          :invoiceId===undefined&&original.customerId===customerId;
        if(original.businessId!==businessId||original.binding!==context.binding||!matchesLocation){
          setMessage(('invoiceId' in original?'Open the original invoice':'Open the original customer')
            +' in the same sign-in to review the interrupted payment.');return;
        }
        const result=reason?await financeAccounts.retireDirectReceipt(context,original.reference,reason,signal)
          :await financeAccounts.lookupDirectReceipt(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'||result.state==='retired'){
          if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error();
          clearPendingDirectReceipt(original);setPending(false);setOptions(null);
          if(result.state==='committed'){
            setReceipt(result.receipt);setAllocations({});setConfirmation('');
            setReceived('');setFundsMapping('');
            resetTip();
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
      setAllocations({});setReceived('');setFundsMapping('');
      setAllowTips(context.directReceiptTips===true);resetTip();
      setMessage(!available.channels.length?'Set up a verified business money account to record payment.'
        :context.writeState!=='ready'?'Saved balances loaded. Payment posting is paused.'
        :!available.receivables.length?'This customer has no outstanding invoices for that date.':'Saved balances loaded.');
    },'Crest could not verify the payment details. Try loading them again.');
  }

  function reviewTip(){
    if(!options)return;
    void run(async(context,signal)=>{
      const result=await financeAccounts.directReceiptTipOptions(context,customerId,options.actualOn,tipJurisdiction||null,signal);
      if(signal.aborted)return;
      if(result.state==='absent'){setTipOptions(null);setTipMessage('The saved customer is unavailable.');return;}
      setTipOptions(result);
      setTipMessage(!result.openPeriod?'Open the accounting period for the receipt date before recording a tip.'
        :!result.fundsMappingId?'Set up customer funds before recording a tip.'
        :result.fundsMappingId!==options.fundsMappingId?'The customer funds account changed. Reload saved balances before recording a tip.'
        :result.selected?'Approved tip tax loaded. Review the amount and customer confirmation.'
        :!result.jurisdictions.length?'No approved tip tax is available for this date.'
        :tipJurisdiction?'The saved tip settings for this jurisdiction need review.'
        :'Choose an approved tip jurisdiction and review its tax.');
    },'Crest could not verify tip tax. Review the saved payment details and try again.',true);
  }

  function record(){
    const selected=options?.channels.find(row=>row.channelId===channel);
    if(!selected||!options||!confirmation.trim()){setMessage('Choose a destination and describe how you verified the receipt.');return;}
    if(!distribution||distribution.grossCents==='0'){
      setMessage(excessAvailable?'Enter a positive receipt total and keep each application within its saved balance and the amount received.'
        :'Enter a positive dollar amount within the saved balance for each invoice you are paying.');return;
    }
    const maxInvoices=180-Number(tipRequested)-Number(remainder);
    if(Object.keys(distribution.applications).length>maxInvoices){
      setMessage('Apply this payment to at most '+maxInvoices+' invoices.');return;
    }
    if(tipRequested&&!tipReady){setMessage('Review tip tax and confirm that the customer designated the tip.');return;}
    if(remainder&&(!options.fundsMappingId||fundsMapping!==options.fundsMappingId)){
      setMessage('Choose how to hold the remaining amount before recording the payment.');return;
    }
    if(!!referenceId.trim()!==!!namespace.trim()){setMessage('Enter both the provider ID and its namespace, or leave both blank.');return;}
    void run(async(context,signal)=>{
      if(context.writeState!=='ready'||!context.recoveryEpoch||readPendingDirectReceipt()){
        setMessage('Payments are paused or an original payment needs review.');return;
      }
      if(remainder&&!context.excessReceipts){setMessage('Customer funds posting is unavailable. Reload payment details.');return;}
      if(tipRequested&&(!context.directReceiptTips||!tipReady)){setMessage('Tip posting is unavailable. Reload payment details.');return;}
      const input=parseDirectReceiptInput({
        reference:{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,paymentId:crypto.randomUUID()},
        customerId,channelId:selected.channelId,channelVersion:selected.version,actualOn:options.actualOn,grossCents:distribution.grossCents,
        confirmation:confirmation.trim(),distinctReason:distinctReason.trim()||null,
        externalIdentity:referenceId.trim()?{namespace:namespace.trim(),id:referenceId.trim(),rawReference:referenceId.trim()}:null,
        applications:distribution.applications,
        ...(tipRequested&&tipBasis?{fundsMappingId:tipOptions.fundsMappingId,tip:{
          tipRealizationId:crypto.randomUUID(),cents:distribution.tipCents,jurisdiction:tipBasis.jurisdiction,taxProfileId:tipBasis.taxProfileId,
          revenueMappingId:tipBasis.revenueMappingId,taxMappingId:tipBasis.taxMappingId,confirmation:tipConfirmation.trim(),
        }}:remainder?{fundsMappingId:fundsMapping}:{}),
      });
      const original=retainPendingDirectReceipt(context,invoiceId?{invoiceId}:{customerId},input.reference);
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
      setReceived('');setFundsMapping('');
      resetTip();
      setMessage('Payment recorded.');
    },'The payment outcome could not be confirmed. Check the original attempt before recording another.');
  }

  return <details className="direct-receipt" onToggle={event=>{if(!event.currentTarget.open)suspend();}}>
    <summary>Record a fictional payment</summary>
    <section aria-label="Record a fictional payment" aria-busy={busy}>
      <p className="field-help">Record money already received into a verified business account.</p>
      <label>Date received<input type="date" value={date} disabled={busy||pending}
        onChange={event=>{setDate(event.target.value);setOptions(null);setReceipt(null);setReceived('');setFundsMapping('');resetTip();}}/></label>
      <button type="button" className="secondary" disabled={busy} onClick={()=>resolve()}>
        {pending?'Check original payment':'Load saved balances'}
      </button>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending&&absent&&<form onSubmit={event=>{event.preventDefault();if(retireReason.trim())resolve(retireReason.trim());}}>
        <label>Reason for closing the attempt<input required maxLength={1000} value={retireReason}
          onChange={event=>setRetireReason(event.target.value)} disabled={busy}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {canWrite&&options&&options.channels.length>0&&(options.receivables.length>0||!!options.fundsMappingId)&&!pending&&<form onSubmit={event=>{event.preventDefault();record();}}>
        <label>Money received in<select required value={channel} onChange={event=>setChannel(event.target.value)} disabled={busy}>
          <option value="">Choose an account</option>
          {options.channels.map(row=><option key={row.channelId} value={row.channelId}>{row.label}</option>)}
        </select></label>
        {excessAvailable&&<div>
          <label>Total received {options.receivables.length>0&&'(optional)'}<input inputMode="decimal" maxLength={22} value={received}
            required={options.receivables.length===0} disabled={busy} onChange={event=>setReceived(event.target.value)} placeholder="0.00"/></label>
          {options.receivables.length>0&&<p className="field-help">{allowTips?'Leave blank to use the invoice and tip amounts entered below.'
            :'Leave blank to use the total applied to invoices.'}</p>}
        </div>}
        {options.receivables.length>0&&<fieldset><legend>Apply the payment</legend>
          <p className="field-help">Leave an invoice blank to skip it.</p>
          {[...options.receivables].sort((a,b)=>Number(b.invoiceId===invoiceId)-Number(a.invoiceId===invoiceId)).map(row=>
            <label key={row.receivableId}>Invoice {row.invoiceNumber} · {quoteMoney(row.remainingCents)} due
              <input inputMode="decimal" maxLength={22} value={allocations[row.receivableId]??''} disabled={busy}
                onChange={event=>setAllocations({...allocations,[row.receivableId]:event.target.value})} placeholder="0.00"/>
            </label>)}
        </fieldset>}
        {allowTips&&<details className="direct-receipt-options">
          <summary>Include a customer tip</summary>
          <p className="field-help">Leave the tip amount blank if the customer did not designate a tip.</p>
          <label>Tip amount (USD, optional)<input inputMode="decimal" maxLength={22} value={tipAmount}
            disabled={busy} onChange={event=>setTipAmount(event.target.value)} placeholder="0.00"/></label>
          {tipRequested&&<>
            {tipOptions&&tipOptions.jurisdictions.length>0&&<label>Tip tax jurisdiction<select value={tipJurisdiction} disabled={busy}
              onChange={event=>{setTipJurisdiction(event.target.value);setTipMessage('');}}>
              <option value="">Choose an approved jurisdiction</option>
              {tipOptions.jurisdictions.map(item=><option key={item}>{item}</option>)}
            </select></label>}
            <button type="button" className="secondary" disabled={busy||!!tipOptions?.jurisdictions.length&&!tipJurisdiction}
              onClick={reviewTip}>{tipOptions?.jurisdictions.length?'Review tip tax':'Load tip jurisdictions'}</button>
            <p ref={tipStatus} role="status" tabIndex={-1}>{tipMessage}</p>
            {tipTax&&tipBasis?.jurisdiction===tipJurisdiction&&<p className="field-help">{quoteMoney(tipTax.netCents)} tip
              {' · '}{quoteMoney(tipTax.taxCents)} included tax</p>}
            <label>How the customer confirmed the tip<textarea rows={2} maxLength={1000} value={tipConfirmation}
              disabled={busy} onChange={event=>setTipConfirmation(event.target.value)}/></label>
          </>}
        </details>}
        {remainder&&distribution&&<div>
          <p className="field-help">{quoteMoney(distribution.appliedCents)} applied to invoices.
            {distribution.tipCents!=='0'&&' '+quoteMoney(distribution.tipCents)+' designated as a tip.'}
            {' '}{quoteMoney(distribution.heldCents)} remaining.</p>
          {options.fundsMappingId?<label>Remaining amount<select required value={fundsMapping} disabled={busy}
            onChange={event=>setFundsMapping(event.target.value)}>
            <option value="">Choose how to record the remainder</option>
            <option value={options.fundsMappingId}>Hold as customer funds</option>
          </select></label>:<p className="field-help">Set up the customer funds account before recording a remainder.</p>}
        </div>}
        <label className="receipt-confirmation">How you verified the payment<textarea required rows={2} maxLength={1000} value={confirmation}
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
        <button type="submit" className="primary-action" disabled={busy||remainder&&!options.fundsMappingId||tipRequested&&!tipReady||
          !received.trim()&&!tipRequested&&!Object.values(allocations).some(amount=>amount.trim())}>Record payment</button>
      </form>}
      {receipt&&<div>
        <p><strong>{quoteMoney(receipt.grossCents)}</strong> received on {receipt.actualOn}.</p>
        {heldFunds&&<p><strong>{quoteMoney(heldFunds.cents)}</strong> held as customer funds.</p>}
        {savedTip&&<p><strong>{quoteMoney(savedTip.inclusiveCents)}</strong> recorded as a confirmed tip
          {' · '}{quoteMoney(savedTip.taxCents)} included tax.</p>}
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-payment.csv',savedTip?[
          ['Payment ID','Received on','Total cents','Component','Source ID','Component cents','Tip net cents','Tip tax cents','Tip jurisdiction'],
          ...receipt.applications.map(row=>[receipt.paymentId,receipt.actualOn,receipt.grossCents,'Invoice',row.receivableId,row.cents,'','','']),
          ...(heldFunds?[[receipt.paymentId,receipt.actualOn,receipt.grossCents,'Customer funds',heldFunds.lotId,heldFunds.cents,'','','']]:[]),
          [receipt.paymentId,receipt.actualOn,receipt.grossCents,'Tip',savedTip.tipRealizationId,savedTip.inclusiveCents,
            savedTip.netCents,savedTip.taxCents,savedTip.jurisdiction],
        ]:heldFunds?[
          ['Payment ID','Received on','Total cents','Receivable ID','Applied cents','Held funds lot ID','Held funding partition ID','Held funds mapping ID','Held cents'],
          ...receipt.applications.map(row=>[receipt.paymentId,receipt.actualOn,receipt.grossCents,row.receivableId,row.cents,'','','','']),
          [receipt.paymentId,receipt.actualOn,receipt.grossCents,'','',heldFunds.lotId,heldFunds.fundingPartitionId,
            heldFunds.mappingId,heldFunds.cents],
        ]:[
          ['Payment ID','Received on','Total cents','Receivable ID','Applied cents'],
          ...receipt.applications.map(row=>[receipt.paymentId,receipt.actualOn,receipt.grossCents,row.receivableId,row.cents]),
        ])}>Download payment (CSV)</button>
      </div>}
    </section>
  </details>;
}
