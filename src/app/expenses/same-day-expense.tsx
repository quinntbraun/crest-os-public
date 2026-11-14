'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
import {parseSameDayExpenseInput} from '../../bookkeeping/expenses/same-day-expense-contract';
import {quoteDollarsInput} from '../../commercial/quote-pricing';
import {clearPendingSameDayExpense,downloadFinanceHistory,financeAccounts,readPendingSameDayExpense,
  retainPendingSameDayExpense} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';

type Options=Extract<Awaited<ReturnType<typeof financeAccounts.sameDayExpenseOptions>>,{state:'review'}>;
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupSameDayExpense>>,{state:'committed'}>['receipt'];
const empty={incurredOn:'',paidOn:'',channelId:'',purchaseTaxTreatment:'',tax:'',receiptId:'',missingReceiptReason:'',
  unknownVendorReason:'',namespace:'',externalId:'',rawReference:'',reviewReason:''};
const refusal:Readonly<Record<string,string>>={
  PAID_EXPENSE_CURRENT_REVISION_REQUIRED:'The saved expense changed. Load it again and review the current version.',
  PAID_EXPENSE_SAME_DATE_REQUIRED:'The incurred and paid dates must both match the saved payment date.',
  PAID_EXPENSE_ORDINARY_MAPPING_REQUIRED:'Approve the ordinary expense account for this category and date.',
  PAID_EXPENSE_VERIFIED_CHANNEL_REQUIRED:'The payment account changed. Reload the review and select a verified account.',
  PAID_EXPENSE_EXTERNAL_ID_ALREADY_RECORDED:'This transaction reference is already recorded. Review the original payment.',
  PAID_EXPENSE_EVIDENCE_REQUIRED:'Review the receipt and vendor evidence for the current expense.',
  PAID_EXPENSE_ALREADY_POSTED:'This expense is already posted. Load the review to see the original entry.',
  PAID_EXPENSE_PURCHASE_TAX_REVIEW_REQUIRED:'Review the purchase tax amount and confirm it is included in the total.',
  ACCOUNTING_OPEN_PERIOD_REQUIRED:'The payment date needs an open accounting period.',
};

export function SameDayExpense({businessId,expenseId,onPosted}:{businessId:string;expenseId:string;onPosted:(id:string)=>void}){
  const heading=useId();
  const [options,setOptions]=useState<Options|null>(null);
  const [draft,setDraft]=useState(empty);
  const [receipt,setReceipt]=useState<Receipt|null>(null);
  const [pending,setPending]=useState(false);
  const [retirable,setRetirable]=useState(false);
  const [retireReason,setRetireReason]=useState('');
  const [canWrite,setCanWrite]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const active=useRef<AbortController|null>(null);
  const status=useRef<HTMLParagraphElement|null>(null);

  useEffect(()=>{
    const clear=()=>{
      active.current?.abort();active.current=null;
      setOptions(null);setDraft(empty);setReceipt(null);setPending(false);setRetirable(false);
      setRetireReason('');setCanWrite(false);setBusy(false);setMessage('');
    };
    const hidden=()=>{if(document.visibilityState==='hidden')clear();};
    window.addEventListener('pagehide',clear);
    document.addEventListener('visibilitychange',hidden);
    return ()=>{
      active.current?.abort();
      window.removeEventListener('pagehide',clear);
      document.removeEventListener('visibilitychange',hidden);
    };
  },[]);

  const patch=(change:Partial<typeof empty>)=>setDraft(value=>({...value,...change}));
  function showReceipt(saved:Receipt){
    if(saved.expenseId!==expenseId)throw Error();
    setReceipt(saved);setOptions(null);setDraft(empty);onPosted(expenseId);
    setMessage('Posted to the ledger. The saved entry and its original evidence are available below.');
  }
  async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
    if(active.current)return;
    const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Checking the saved expense…');
    try{
      const context=await financeAccounts.context(controller.signal);
      if(controller.signal.aborted)return;
      if(!context.sameDayExpenses||context.businessId!==businessId){
        setMessage('Expense posting is unavailable in this workspace.');return;
      }
      setCanWrite(context.writeState==='ready');
      await action(context,controller.signal);
    }catch{if(!controller.signal.aborted)setMessage(failure);}
    finally{if(active.current===controller){active.current=null;setBusy(false);status.current?.focus();}}
  }
  function load(reason?:string){
    void run(async(context,signal)=>{
      const original=readPendingSameDayExpense();
      setPending(!!original);setRetirable(false);
      if(original){
        if(original.expenseId!==expenseId||original.businessId!==businessId||original.binding!==context.binding){
          setMessage('Open the original expense in the same sign-in to review the interrupted posting.');return;
        }
        const result=reason?await financeAccounts.retireSameDayExpense(context,original.reference,reason,signal):
          await financeAccounts.lookupSameDayExpense(context,original.reference,signal);
        if(signal.aborted)return;
        if(result.state==='committed'){
          showReceipt(result.receipt);clearPendingSameDayExpense(original);setPending(false);return;
        }
        if(result.state==='retired'){
          clearPendingSameDayExpense(original);setPending(false);setOptions(null);setDraft(empty);
          setMessage('The unrecorded attempt was closed. Load the expense again to start a new review.');return;
        }
        if(result.state==='absent')setRetirable(context.writeState==='ready');
        setMessage(result.state==='absent'?'The ledger has no entry for the original attempt. Close it explicitly before starting another.':
          'The original attempt conflicts with saved evidence. Its reference was kept for review.');
        return;
      }
      const result=await financeAccounts.sameDayExpenseOptions(context,expenseId,signal);
      if(signal.aborted)return;
      if(result.state==='posted'){showReceipt(result.receipt);return;}
      setDraft(empty);setOptions(result.state==='review'?result:null);
      setMessage(result.state==='review'?'Review the original purchase and how you paid.':
        result.state==='voided'?'A voided expense cannot be posted.':'The saved expense could not be found.');
    },'The expense review is unavailable. Check your connection and try again.');
  }
  function submit(){
    const channel=options?.channels.find(item=>item.channelId===draft.channelId);
    if(!options?.mapping||!channel||!options.openPeriod||pending||!canWrite)return;
    let cents:string;
    try{
      cents=draft.purchaseTaxTreatment==='none'?'0':quoteDollarsInput(draft.tax);
      if(BigInt(cents)>BigInt(options.grossCents))throw Error();
    }catch{setMessage('Enter purchase tax in USD up to the total amount paid.');return;}
    void run(async(context,signal)=>{
      let input:ReturnType<typeof parseSameDayExpenseInput>;
      try{
        input=parseSameDayExpenseInput({
          reference:{operationId:crypto.randomUUID(),postedExpenseId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch},
          expenseId,expenseRevision:options.expenseRevision,channelId:channel.channelId,channelVersion:channel.version,
          mappingId:options.mapping!.mappingId,incurredOn:draft.incurredOn,paidOn:draft.paidOn,
          purchaseTaxTreatment:draft.purchaseTaxTreatment,purchaseTaxCents:cents,receiptId:draft.receiptId||null,
          missingReceiptReason:draft.receiptId?null:draft.missingReceiptReason.trim(),
          unknownVendorReason:options.vendor?null:draft.unknownVendorReason.trim(),reviewReason:draft.reviewReason.trim(),
          externalIdentity:{namespace:draft.namespace.trim(),id:draft.externalId.trim(),rawReference:draft.rawReference.trim()},
        });
        if(input.paidOn!==options.retainedPaidOn)throw Error();
      }catch{setMessage('Check both dates, purchase tax, and the transaction and receipt evidence.');return;}
      if(context.writeState!=='ready'){setMessage('Posting is paused while workspace recovery is under review.');return;}
      const original=retainPendingSameDayExpense(context,expenseId,input.reference);setPending(true);
      const result=await financeAccounts.postSameDayExpense(context,input,signal);
      if(signal.aborted)return;
      if(result.state==='committed'){
        showReceipt(result.receipt);clearPendingSameDayExpense(original);setPending(false);return;
      }
      if(result.state==='refused'||result.state==='retired'){
        clearPendingSameDayExpense(original);setPending(false);
        setMessage(result.state==='refused'?refusal[result.reason]??'The entry was declined. Review the current expense before trying again.':
          'This attempt was already closed. Load the expense again.');
        return;
      }
      setMessage('The original attempt needs review before another expense can be posted.');
    },'Posting could not be confirmed. Check the original attempt before trying again.');
  }
  function download(){
    if(!receipt)return;
    downloadFinanceHistory('crest-posted-expense-'+receipt.postedExpenseId+'.csv',[
      ['Expense ID','Posted expense ID','Ledger event ID','Expense revision','Incurred on','Paid on','Gross USD cents',
        'Included purchase tax USD cents','Purchase tax treatment','Expense account ID','Money account ID',
        'Transaction evidence ID','Receipt ID','Missing receipt reason','Unknown vendor reason'],
      [receipt.expenseId,receipt.postedExpenseId,receipt.eventId,receipt.expenseRevision,receipt.incurredOn,receipt.paidOn,
        receipt.grossCents,receipt.purchaseTaxCents,receipt.purchaseTaxTreatment,receipt.expenseAccountId,receipt.moneyAccountId,
        receipt.externalEvidenceId,receipt.receiptId??'',receipt.missingReceiptReason??'',receipt.unknownVendorReason??''],
    ]);
  }

  return <section className="expense-posting" aria-labelledby={heading}>
    <div className="expense-posting-heading">
      <h4 id={heading}>Accounting entry</h4>
      {receipt&&<span className="expense-posting-state">Posted</span>}
    </div>
    <p className="expense-posting-status" ref={status} tabIndex={-1} role="status">{message}</p>
    {!receipt&&<button type="button" className="secondary" disabled={busy} onClick={()=>load()}>
      {pending?'Check original posting':options?'Reload review':'Load accounting review'}</button>}
    {pending&&retirable&&<form onSubmit={event=>{event.preventDefault();load(retireReason.trim());}}>
      <label>Why close this unrecorded attempt?<input required value={retireReason} maxLength={1000}
        onChange={event=>setRetireReason(event.target.value)}/></label>
      <button disabled={busy||!retireReason.trim()}>Close original attempt</button>
    </form>}
    {receipt&&<><p>${expenseDollars(receipt.grossCents)} posted for {receipt.paidOn}</p>
      <button type="button" className="secondary" onClick={download}>Download posted expense CSV</button></>}
    {options&&!pending&&<>
      <dl className="expense-posting-facts">
        <div><dt>Amount paid</dt><dd>${expenseDollars(options.grossCents)}</dd></div>
        <div><dt>Saved payment date</dt><dd><time dateTime={options.retainedPaidOn}>{options.retainedPaidOn}</time></dd></div>
        {options.vendor&&<div><dt>Vendor</dt><dd>{options.vendor}</dd></div>}
      </dl>
      {!options.mapping&&<p>Approve the expense account for this category in <a href="/settings/accounts">Accounting</a>.</p>}
      {!options.channels.length&&<p>Set up a verified business bank or wallet in <a href="/settings/accounts/channels">Money channels</a>.</p>}
      {!options.openPeriod&&<p>Open the accounting period that includes the saved payment date.</p>}
      {options.mapping&&options.channels.length>0&&options.openPeriod&&<form onSubmit={event=>{event.preventDefault();submit();}}>
        <fieldset className="expense-form" disabled={busy||!canWrite}>
          <legend>Post to account {options.mapping.accountCode}</legend>
          <div className="expense-posting-dates">
            <label>Incurred date<input type="date" required value={draft.incurredOn} onChange={event=>patch({incurredOn:event.target.value})}/></label>
            <label>Actual payment date<input type="date" required value={draft.paidOn} onChange={event=>patch({paidOn:event.target.value})}/></label>
          </div>
          <div><label htmlFor={heading+'-channel'}>Paid from</label><select id={heading+'-channel'} required value={draft.channelId} onChange={event=>patch({channelId:event.target.value})}>
            <option value="">Choose verified account</option>
            {options.channels.map(channel=><option key={channel.channelId} value={channel.channelId}>{channel.label}</option>)}
          </select></div>
          <div><label htmlFor={heading+'-tax'}>Purchase tax</label><select id={heading+'-tax'} required value={draft.purchaseTaxTreatment} onChange={event=>patch({purchaseTaxTreatment:event.target.value,tax:''})}>
            <option value="">Choose after checking the purchase</option><option value="none">No purchase tax</option>
            <option value="verified_nonrecoverable">Included and nonrecoverable</option>
          </select></div>
          {draft.purchaseTaxTreatment==='verified_nonrecoverable'&&<label>Included purchase tax (USD)<input required
            inputMode="decimal" value={draft.tax} onChange={event=>patch({tax:event.target.value})}/></label>}
          {options.validatedReceipts.length>0&&<div><label htmlFor={heading+'-receipt'}>Validated receipt</label><select id={heading+'-receipt'} value={draft.receiptId}
            onChange={event=>patch({receiptId:event.target.value})}><option value="">No receipt selected</option>
            {options.validatedReceipts.map((item,index)=><option key={item.receiptId} value={item.receiptId}>Receipt {index+1} · {item.receiptId.slice(-8)}</option>)}
          </select></div>}
          {!draft.receiptId&&<label>Why is the receipt unavailable?<input required maxLength={1000}
            value={draft.missingReceiptReason} onChange={event=>patch({missingReceiptReason:event.target.value})}/></label>}
          {!options.vendor&&<label>Why is the vendor unknown?<input required maxLength={1000} value={draft.unknownVendorReason}
            onChange={event=>patch({unknownVendorReason:event.target.value})}/></label>}
          <fieldset className="expense-posting-evidence"><legend>Transaction evidence</legend>
            <label>Reference source<input required maxLength={80} value={draft.namespace}
              onChange={event=>patch({namespace:event.target.value})}/></label>
            <label>Transaction ID<input required maxLength={200} value={draft.externalId}
              onChange={event=>patch({externalId:event.target.value})}/></label>
            <label>Statement reference<input required maxLength={1000} value={draft.rawReference}
              onChange={event=>patch({rawReference:event.target.value})}/></label>
          </fieldset>
          <label>What did you verify before posting?<input required maxLength={1000} value={draft.reviewReason}
            onChange={event=>patch({reviewReason:event.target.value})}/></label>
          <button type="submit">Post paid expense</button>
        </fieldset>
      </form>}
    </>}
  </section>;
}
