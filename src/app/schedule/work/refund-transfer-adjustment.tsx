'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {parseRefundTransferInput} from '../../../bookkeeping/refund-transfer-adjustment-contract';
import type {RefundTransferKind} from '../../../bookkeeping/refund-transfer-adjustment-contract';
import {quoteDollarsInput,quoteMoney} from '../../../commercial/quote-pricing';
import {clearPendingRefundTransfer,downloadFinanceHistory,financeAccounts,readPendingRefundTransfer,retainPendingRefundTransfer}
  from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';

type Options=Extract<Awaited<ReturnType<typeof financeAccounts.refundTransferOptions>>,{state:'ready'}>['options'];
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupRefundTransfer>>,{state:'committed'}>['receipt'];
type FeeMapping=NonNullable<Extract<Awaited<ReturnType<typeof financeAccounts.refundTransferFeeOption>>,{state:'ready'}>['mapping']>;
type Range={firstCent:string;lastCent:string};
type Selection={start:string;amount:string};
const title='Review a returned refund';
const empty={channelId:'',actualAmount:'',namespace:'',transactionId:'',statementReference:'',confirmation:'',reason:'',
  feeAmount:'',feeConfirmation:'',feeNamespace:'',feeTransactionId:'',feeStatementReference:''};
const labels={service:'Service refund',excess:'Unused payment return',tip_return_due:'Tip return'} as const;
const span=(range:Range)=>BigInt(range.lastCent)-BigInt(range.firstCent)+1n;

function money(value:string){
  try{return BigInt(quoteDollarsInput(value));}catch{return 0n;}
}

function selectedRanges(available:readonly Range[],choices:Readonly<Record<string,Selection>>){
  const ranges:Range[]=[];
  let total=0n;
  for(const range of available){
    const choice=choices[range.firstCent];
    if(!choice?.amount.trim())continue;
    const amount=money(choice.amount);
    if(amount===span(range)){ranges.push(range);total+=amount;continue;}
    if(amount===0n||!/^[1-9][0-9]{0,18}$/.test(choice.start))return null;
    const start=BigInt(choice.start),end=start+amount-1n;
    if(start<BigInt(range.firstCent)||end>BigInt(range.lastCent))return null;
    ranges.push({firstCent:String(start),lastCent:String(end)});total+=amount;
  }
  return {ranges,total};
}

export function RefundTransferAdjustment({businessId,customerId}:{businessId:string;customerId:string}){
  const [date,setDate]=useState('');
  const [kind,setKind]=useState<RefundTransferKind|''>('');
  const [options,setOptions]=useState<Options|null>(null);
  const [priorId,setPriorId]=useState('');
  const [choices,setChoices]=useState<Readonly<Record<string,Selection>>>({});
  const [form,setForm]=useState(empty);
  const [allowFees,setAllowFees]=useState(false);
  const [feeMapping,setFeeMapping]=useState<FeeMapping|null>(null);
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [canClose,setCanClose]=useState(false);
  const [closeReason,setCloseReason]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
  const feeStatus=useRef<HTMLParagraphElement>(null);
  const [feeMessage,setFeeMessage]=useState('');
  const prior=options?.refunds.find(refund=>refund.priorEventId===priorId);
  const selected=selectedRanges(prior?.availableRanges??[],choices);
  const channel=options?.channels.find(row=>row.channelId===form.channelId);
  const settled=money(form.actualAmount);
  const withFee=form.feeAmount.trim()!=='';
  const fee=withFee?money(form.feeAmount):0n;
  const verified=settled+fee;
  const feeReady=!!feeMapping&&fee>0n&&financeAccountReviewReason(form.feeConfirmation.trim());
  const ready=settled>0n&&selected?.total===verified&&!!channel&&(!withFee||allowFees&&feeReady);

  const checkPending=useCallback(()=>{
    try{setPending(readPendingRefundTransfer()!==null);}
    catch{setPending(true);setMessage('Crest could not read the original refund transfer reference.');}
  },[]);
  const resetDraft=useCallback(()=>{
    setOptions(null);setPriorId('');setChoices({});setForm(empty);setFeeMapping(null);setFeeMessage('');setAllowFees(false);setReceipt(null);
  },[]);
  const suspend=useCallback(()=>{
    active.current?.abort();active.current=null;
    setDate('');setKind('');resetDraft();setPending(false);setCanClose(false);setCloseReason('');setBusy(false);setMessage('');
  },[resetDraft]);
  useEffect(()=>{
    const visibility=()=>{if(document.visibilityState==='hidden')suspend();else checkPending();};
    const restored=(event:PageTransitionEvent)=>{if(event.persisted){suspend();checkPending();}};
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',suspend);window.addEventListener('pageshow',restored);
    return ()=>{
      active.current?.abort();
      document.removeEventListener('visibilitychange',visibility);
      window.removeEventListener('pagehide',suspend);window.removeEventListener('pageshow',restored);
    };
  },[checkPending,suspend]);

  async function run(work:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,working:string,failure:string,feeReview=false){
    if(active.current)return;
    const current=new AbortController(),{signal}=current;
    const announce=feeReview?setFeeMessage:setMessage;
    active.current=current;setBusy(true);announce(working);
    try{
      const context=await financeAccounts.context(signal);
      if(signal.aborted)return;
      if(!context.refundTransfers||context.businessId!==businessId){announce('Refund transfer review is unavailable.');return;}
      await work(context,signal);
    }catch{if(!signal.aborted)announce(failure);}
    finally{if(active.current===current){active.current=null;setBusy(false);(feeReview?feeStatus:status).current?.focus();}}
  }
  function load(){
    if(!kind)return;
    resetDraft();
    void run(async(context,signal)=>{
      if(readPendingRefundTransfer()){setPending(true);setMessage('Check the original refund transfer first.');return;}
      if(context.writeState!=='ready'){setMessage('Posting is paused.');return;}
      const next=await financeAccounts.refundTransferOptions(context,customerId,kind,date,signal);
      if(signal.aborted)return;
      if(next.state==='refused'){setMessage('Check the settlement date and original transfer.');return;}
      if(!next.options.openPeriod){setMessage('Open the accounting period for the settlement date.');return;}
      setOptions(next.options);
      setAllowFees(kind==='recredit'&&context.refundTransferFees===true);
      setMessage(next.options.refunds.length
        ? next.options.channels.length?'Choose the prior transfer and confirm the affected amount.':'There is no verified bank or wallet for this date.'
        : 'There are no eligible prior transfers for this customer and date.');
    },'Checking prior transfers…','Crest could not verify the prior transfers.');
  }
  function loadFeeMapping(){
    if(!prior||!options||options.kind!=='recredit')return;
    void run(async(context,signal)=>{
      const result=await financeAccounts.refundTransferFeeOption(context,customerId,prior.priorEventId,options.actualOn,signal);
      if(signal.aborted)return;
      const mapping=result.state==='ready'?result.mapping:null;
      setFeeMapping(mapping);
      setFeeMessage(mapping?'Approved fee account loaded. Check the amount deposited and the fee withheld.'
        :'The approved fee account or original refund is unavailable for this date.');
    },'Checking the approved fee account…','Crest could not verify the fee account. Check the date and try again.',true);
  }
  function recover(reason?:string){
    void run(async(context,signal)=>{
      setCanClose(false);
      const original=readPendingRefundTransfer();
      if(!original){setPending(false);setMessage('There is no interrupted refund transfer.');return;}
      if(original.businessId!==businessId||original.binding!==context.binding||original.customerId!==customerId){
        setMessage('Open an invoice for the original customer in the same sign-in.');return;
      }
      const result=reason?await financeAccounts.retireRefundTransfer(context,original.reference,reason,signal)
        :await financeAccounts.lookupRefundTransfer(context,original.reference,signal);
      if(signal.aborted)return;
      if(result.state==='committed'||result.state==='retired'){
        if(result.state==='committed'&&result.receipt.customerId!==customerId)throw Error();
        clearPendingRefundTransfer(original);setPending(false);setCloseReason('');
        setReceipt(result.state==='committed'?result.receipt:null);
        setMessage(result.state==='committed'?'The original refund transfer was recorded.':'The original attempt was closed.');
        return;
      }
      setCanClose(result.state==='absent'&&context.writeState==='ready');
      setMessage(result.state==='absent'?'No record was found. Close the original attempt before starting another.'
        :'Crest could not match the original transfer. Keep its reference for review.');
    },'Checking the original refund transfer…','Crest could not verify the original transfer. Keep its reference for review.');
  }
  function save(){
    if(!options||!prior||!selected||!channel||!ready)return;
    void run(async(context,signal)=>{
      if(!context.recoveryEpoch||context.writeState!=='ready'){setMessage('Posting is paused.');return;}
      if(withFee&&!context.refundTransferFees){setMessage('Fee recording is unavailable. Reload the prior transfer.');return;}
      if(readPendingRefundTransfer()){setPending(true);setMessage('Check the original refund transfer first.');return;}
      const reference={operationId:crypto.randomUUID(),refundTransferAdjustmentId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
      let input;
      try{
        const feeReference=[form.feeNamespace,form.feeTransactionId,form.feeStatementReference].map(value=>value.trim());
        if(withFee&&feeReference.some(Boolean)&&!feeReference.every(Boolean)){
          setMessage('Enter all optional fee reference details or leave them blank.');return;
        }
        input=parseRefundTransferInput({reference,priorEventId:prior.priorEventId,customerId,kind:options.kind,
          actualOn:options.actualOn,channelId:channel.channelId,channelVersion:channel.version,verifiedCents:String(verified),
          ranges:selected.ranges,confirmation:form.confirmation.trim(),reason:form.reason.trim(),
          externalIdentity:{namespace:form.namespace.trim(),id:form.transactionId.trim(),rawReference:form.statementReference.trim()},
          ...(withFee&&feeMapping?{embeddedFee:{cents:String(fee),netCents:String(settled),mappingId:feeMapping.mappingId,
            confirmation:form.feeConfirmation.trim(),externalIdentity:feeReference.every(Boolean)
              ?{namespace:feeReference[0],id:feeReference[1],rawReference:feeReference[2]}:null}}:{})});
      }catch{setMessage('Check the selected amount and complete the transaction evidence.');return;}
      const original=retainPendingRefundTransfer(context,customerId,reference);
      setPending(true);resetDraft();
      const result=await financeAccounts.recordRefundTransfer(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='conflict'){setMessage('Check the original transfer before starting another.');return;}
      clearPendingRefundTransfer(original);setPending(false);
      if(result.state==='refused'){
        setMessage(result.reason==='external_id_already_recorded'?'This bank or wallet transaction is already recorded.'
          :result.reason==='fee_review_required'?'The fee account or evidence needs review. Reload the prior refund.'
          :'Crest refused this transfer. Reload the available amounts and review the settlement evidence.');
        return;
      }
      setReceipt(result.receipt);setMessage('Refund transfer record saved.');
    },'Saving the refund transfer…','Crest could not confirm the save. Check the original transfer before starting another.');
  }

  const field=(name:keyof typeof empty,value:string)=>setForm(previous=>({...previous,[name]:value}));
  return <details className="direct-receipt invoice-credit service-refund" onToggle={event=>{
    if(event.target!==event.currentTarget)return;
    if(event.currentTarget.open)checkPending();else suspend();
  }}>
    <summary>{title}</summary>
    <section aria-label={title} aria-busy={busy}>
      <p className="field-help">Use this when your bank or wallet returns a refund to you, or when a second refund attempt settles.</p>
      <p ref={status} role="status" tabIndex={-1}>{message}</p>
      {pending?<button type="button" className="secondary" disabled={busy} onClick={()=>recover()}>Check original refund transfer</button>
        :<form onSubmit={event=>{event.preventDefault();load();}}>
          <label>What happened?<select required disabled={busy} value={kind} onChange={event=>{
            setKind(event.target.value as RefundTransferKind|'');resetDraft();
          }}>
            <option value="">Choose a transfer type</option>
            <option value="recredit">Bank or wallet returned the refund</option>
            <option value="retry">Retried refund settled</option>
          </select></label>
          <label>Settlement date<input required type="date" disabled={busy} value={date} onChange={event=>{setDate(event.target.value);resetDraft();}}/></label>
          <button type="submit" className="secondary" disabled={busy}>Load prior transfers</button>
        </form>}
      {pending&&canClose&&<form onSubmit={event=>{
        event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))recover(closeReason.trim());
      }}>
        <label>Reason for closing the attempt<input maxLength={1000} required value={closeReason} onChange={event=>setCloseReason(event.target.value)}/></label>
        <button type="submit" className="secondary" disabled={busy}>Close original attempt</button>
      </form>}
      {options&&options.refunds.length>0&&options.channels.length>0&&!pending&&<form onSubmit={event=>{event.preventDefault();save();}}>
        <label>Prior transfer<select required disabled={busy} value={priorId} onChange={event=>{
          setPriorId(event.target.value);setChoices({});setForm(empty);setFeeMapping(null);setFeeMessage('');
        }}>
          <option value="">Choose the original transfer</option>
          {options.refunds.map(refund=><option key={refund.priorEventId} value={refund.priorEventId}>
            {labels[refund.obligationType]} · {refund.priorOn} · {quoteMoney(String(refund.availableRanges.reduce((sum,range)=>sum+span(range),0n)))} · {refund.priorAccountLabel} · {refund.priorEventId.slice(-8)}
          </option>)}
        </select></label>
        {options.hasMore&&<p className="field-help">Showing the 50 most recent eligible transfers.</p>}
        {prior&&<>
          <fieldset disabled={busy}><legend>Confirmed amount</legend>
            <p className="field-help">Enter the amount in each affected portion. Leave unused portions blank.</p>
            {prior.availableRanges.map(range=>{
              const choice=choices[range.firstCent]??{amount:'',start:''};
              const amount=money(choice.amount),total=span(range);
              const update=(next:Selection)=>setChoices(previous=>({...previous,[range.firstCent]:next}));
              return <details key={range.firstCent}>
                <summary>{quoteMoney(String(total))} available</summary>
                <label>Amount to record (USD)<input inputMode="decimal" value={choice.amount} maxLength={22}
                  onChange={event=>update({...choice,amount:event.target.value})}/></label>
                {amount>0n&&amount<total&&<>
                  <label>Start at cent position ({range.firstCent}–{range.lastCent})<input inputMode="numeric" required maxLength={19}
                    value={choice.start} onChange={event=>update({...choice,start:event.target.value})}/></label>
                  <button type="button" className="secondary" onClick={()=>update({...choice,start:range.firstCent})}>Start at cent {range.firstCent}</button>
                </>}
              </details>;
            })}
            <p>{selected?quoteMoney(String(selected.total))+' selected':'Check the selected amounts and starting positions.'}</p>
          </fieldset>
          <fieldset className="service-refund-evidence" disabled={busy}><legend>Bank or wallet evidence</legend>
            <label>{allowFees?'Amount deposited (USD)':'Settled amount (USD)'}<input required inputMode="decimal" maxLength={22} value={form.actualAmount}
              onChange={event=>field('actualAmount',event.target.value)}/></label>
            <label>{options.kind==='recredit'?'Account recredited':'Account debited'}<select required value={form.channelId}
              onChange={event=>field('channelId',event.target.value)}>
              <option value="">Choose a verified account</option>
              {options.channels.map(item=><option key={item.channelId} value={item.channelId}>{item.label}</option>)}
            </select></label>
            <label>Reference type<input required maxLength={80} value={form.namespace} onChange={event=>field('namespace',event.target.value)}/></label>
            <label>Transaction ID<input required maxLength={200} value={form.transactionId} onChange={event=>field('transactionId',event.target.value)}/></label>
            <label>Statement reference<input required maxLength={1000} value={form.statementReference} onChange={event=>field('statementReference',event.target.value)}/></label>
            <label>How you verified settlement<textarea required rows={2} maxLength={1000} value={form.confirmation}
              onChange={event=>field('confirmation',event.target.value)}/></label>
            <label>Reason for the transfer<textarea required rows={2} maxLength={1000} value={form.reason} onChange={event=>field('reason',event.target.value)}/></label>
          </fieldset>
          {allowFees&&<details className="direct-receipt-options">
            <summary>Fee withheld from the return</summary>
            <fieldset disabled={busy}>
              <legend className="visually-hidden">Fee withheld from the return</legend>
              <p className="field-help">Enter a fee only when the provider withheld it from the refund it returned to you. Use the deposited amount above.</p>
              <label>Fee withheld (USD, optional)<input inputMode="decimal" maxLength={22} value={form.feeAmount}
                onChange={event=>field('feeAmount',event.target.value)} placeholder="0.00"/></label>
              {withFee&&<>
                <button type="button" className="secondary" disabled={busy} onClick={loadFeeMapping}>Check fee account</button>
                <p ref={feeStatus} role="status" tabIndex={-1}>{feeMessage}</p>
                {feeMapping&&<p className="field-help">Fee account · {feeMapping.label}</p>}
                <label>How you verified the withheld fee<textarea rows={2} maxLength={1000} value={form.feeConfirmation}
                  onChange={event=>field('feeConfirmation',event.target.value)}/></label>
                <details className="direct-receipt-options">
                  <summary>Separate provider reference, if supplied</summary>
                  <label>Fee reference type<input maxLength={80} value={form.feeNamespace} onChange={event=>field('feeNamespace',event.target.value)}/></label>
                  <label>Fee reference ID<input maxLength={200} value={form.feeTransactionId} onChange={event=>field('feeTransactionId',event.target.value)}/></label>
                  <label>Fee statement reference<input maxLength={1000} value={form.feeStatementReference} onChange={event=>field('feeStatementReference',event.target.value)}/></label>
                </details>
                {fee>0n&&settled>0n&&<p className="field-help">{quoteMoney(String(settled))} deposited
                  {' · '}{quoteMoney(String(fee))} fee withheld · {quoteMoney(String(verified))} still owed to the customer.</p>}
              </>}
            </fieldset>
          </details>}
          <button type="submit" className="primary-action" disabled={busy||!ready}>Save refund transfer</button>
        </>}
      </form>}
      {receipt&&<>
        <p><strong>{quoteMoney(receipt.cents)}</strong> {receipt.kind==='recredit'?'recredited and held for refund':'settled as a retried refund'}.</p>
        {receipt.embeddedFee&&<p>{quoteMoney(receipt.embeddedFee.netCents)} deposited
          {' · '}{quoteMoney(receipt.embeddedFee.cents)} withheld as a fee.</p>}
        <button type="button" className="secondary" onClick={()=>downloadFinanceHistory('crest-refund-transfer.csv',[
          ['Adjustment ID','Original refund event','Prior transfer event','Date','Type','Obligation','Total cents','First cent','Last cent','Reason',
            ...(receipt.embeddedFee?['Net deposit cents','Withheld fee cents','Fee evidence ID']:[])],
          ...receipt.ranges.map(range=>[receipt.refundTransferAdjustmentId,receipt.originalEventId,receipt.priorEventId,receipt.actualOn,
            receipt.kind,receipt.obligationType,receipt.cents,range.firstCent,range.lastCent,receipt.reason,
            ...(receipt.embeddedFee?[receipt.embeddedFee.netCents,receipt.embeddedFee.cents,receipt.embeddedFee.evidenceId]:[])]),
        ])}>Download refund transfer (CSV)</button>
      </>}
    </section>
  </details>;
}
