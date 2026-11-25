'use client';

import {useContext,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError} from '../../client/authentication';
import {createPendingSupplierPostingStore,PendingSupplierPostingError} from '../../client/pending-supplier-posting';
import {SupplierPostingReentry} from './supplier-posting-reentry';
import {financeAccounts} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {expenseDollars} from '../../bookkeeping/expenses/expense-contract';
import type {SupplierPayableReviewRequest} from '../../bookkeeping/expenses/supplier-payable-review-contract';
import {parseSupplierAccrualRequest,parseSupplierSettlementRequest,parseSupplierOperationReference} from '../../bookkeeping/expenses/supplier-payable-posting-contract';
import type {SupplierOperationReference} from '../../bookkeeping/expenses/supplier-payable-posting-contract';
import type {MoneyChannel} from '../../bookkeeping/finance-money-channel-contract';

type Review=Extract<Awaited<ReturnType<typeof financeAccounts.previewSupplierPayable>>,{state:'ready'}>;
type Payable=Awaited<ReturnType<typeof financeAccounts.supplierPayableRegister>>['rows'][number];
type WriteResult=Awaited<ReturnType<typeof financeAccounts.postSupplierAccrual>>;
const refusals={
 SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED:'Verify the original bill before posting.',
 SUPPLIER_PAYABLE_ALREADY_POSTED:'This bill is already posted. Reload Recorded supplier payables.',
 SUPPLIER_PAYABLE_REVIEW_CHANGED:'The entry changed. Prepare a fresh preview before posting.',
 SUPPLIER_PAYABLE_DUPLICATE_REVIEW_REQUIRED:'The possible duplicates changed. Prepare a fresh preview.',
 SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED:'The saved draft changed. Open the latest revision.',
 SUPPLIER_SETTLEMENT_PAYABLE_REQUIRED:'The supplier payable is unavailable. Reload the register.',
 SUPPLIER_SETTLEMENT_ACTUAL_DATE_REQUIRED:'Enter the actual payment date on or after the bill date.',
 SUPPLIER_SETTLEMENT_REMAINING_CHANGED:'The outstanding amount changed. Reload the register before recording payment.',
 SUPPLIER_SETTLEMENT_VERIFIED_CHANNEL_REQUIRED:'Choose a verified payment account for the actual payment date.',
 SUPPLIER_SETTLEMENT_EXTERNAL_ID_ALREADY_RECORDED:'This bank or wallet reference is already recorded.',
};

function useSupplierConfirmation<Input extends {reference:SupplierOperationReference}>(context:FinanceAccountContext,
 scope:{kind:SupplierOperationReference['kind'];id:string},
 send:(context:FinanceAccountContext,input:Input,signal:AbortSignal)=>Promise<WriteResult>,onPosted:()=>void,onRefused:()=>void){
 const active=useRef<AbortController|null>(null),recovery=useContext(SupplierPostingReentry);
 const store=useMemo(()=>createPendingSupplierPostingStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),[]);
 const resumption=recovery?.reentry;
 const [referenceFailed,setReferenceFailed]=useState(false);
 const blocked=referenceFailed||(!!resumption&&(resumption.businessId!==context.businessId||resumption.scopeId!==scope.id||resumption.reference.kind!==scope.kind));
 const [busy,setBusy]=useState(false),[pending,setPending]=useState<Input|null>(null),[status,setStatus]=useState('');
 useEffect(()=>()=>active.current?.abort(),[]);
 async function run(input:Input,checkOnly:boolean){
  if(active.current||blocked)return;
  const request=new AbortController();active.current=request;setBusy(true);setStatus('');
  try{
   if(input.reference.kind!==scope.kind)throw new PendingSupplierPostingError();
   let entry=store.read(),delivery=input;
   if(entry){
    if(entry.businessId!==context.businessId||entry.scopeId!==scope.id||entry.reference.kind!==scope.kind)throw new PendingSupplierPostingError();
    const same=JSON.stringify(parseSupplierOperationReference(input.reference))===JSON.stringify(entry.reference);
    const explicitReentry=resumption&&JSON.stringify(resumption)===JSON.stringify(entry);
    if(entry.binding!==context.binding&&!explicitReentry)throw new PendingSupplierPostingError();
    if(!same&&!explicitReentry)throw new PendingSupplierPostingError();
    store.require(entry);delivery={...input,reference:entry.reference};
   }else{
    if(checkOnly||resumption)throw new PendingSupplierPostingError();
    entry={schemaVersion:1,businessId:context.businessId,binding:context.binding,scopeId:scope.id,reference:parseSupplierOperationReference(input.reference)};
    store.write(entry);
   }
   setPending(delivery);
   const result=checkOnly?await financeAccounts.lookupSupplierPosting(context,entry.reference,request.signal)
    :await send(context,delivery,request.signal);
   if(request.signal.aborted)return;
   if(result.state==='committed'){store.clear(entry);setPending(null);recovery?.onResolved();onPosted();return;}
   if(result.state==='absent'){
    setStatus('No committed entry was found for this request. You can retry the same request.');return;
   }
   if(result.state==='conflict'){
    setStatus('This original posting reference is in use. Check its original result before creating another posting.');return;
   }
   store.clear(entry);setPending(null);recovery?.onResolved();
   setStatus(refusals[result.reason]);onRefused();
  }catch(error){if(!request.signal.aborted){
   if(error instanceof AuthenticationError&&error.kind==='denied'){recovery?.onAccessDenied();setStatus('Sign in again to check the original supplier posting. Its reference is retained.');}
   else {if(error instanceof PendingSupplierPostingError)setReferenceFailed(true);setStatus(error instanceof PendingSupplierPostingError?'The original supplier posting reference needs review. Another posting is blocked.':'The outcome is unconfirmed. Check this original request before creating another.');}
  }}finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 return {busy,pending,blocked,reentry:!!resumption&&!blocked,status:status||(blocked?'Resolve the interrupted supplier posting on its original record before posting here.':''),setStatus,submit:(input:Input)=>run(input,false),
  check:()=>{if(pending)void run(pending,true);},retry:()=>{if(pending)void run(pending,false);}};
}
function PendingControls({operation}:{operation:{pending:unknown;busy:boolean;check:()=>void;retry:()=>void}}){
 if(!operation.pending)return null;
 return <div>
  <button type="button" disabled={operation.busy} onClick={operation.check}>Check original posting request</button>
  <button type="button" className="secondary" disabled={operation.busy} onClick={operation.retry}>Retry original posting request</button>
 </div>;
}

export function SupplierAccrualConfirmation({context,review,result,onPosted,onRefresh,lockReview}:{
 context:FinanceAccountContext;review:SupplierPayableReviewRequest;result:Review;onPosted:()=>void;onRefresh:()=>void;
 lockReview:(locked:boolean)=>void;
}){
 const [duplicates,setDuplicates]=useState<string[]>([]),[reason,setReason]=useState('');
 const [confirmed,setConfirmed]=useState(false),[stale,setStale]=useState(false);
 const operation=useSupplierConfirmation<ReturnType<typeof parseSupplierAccrualRequest>>(context,{kind:'payable',id:review.billId},financeAccounts.postSupplierAccrual,onPosted,()=>{
  setStale(true);lockReview(false);
 });
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(operation.blocked||operation.pending||operation.busy||!context.recoveryEpoch||context.writeState!=='ready'||!confirmed
   ||duplicates.length!==result.candidates.length)return;
  try{
   const reference={kind:'payable',id:crypto.randomUUID(),operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   const input=parseSupplierAccrualRequest({reference,review:{...review,originalId:result.originalId},planSha256:result.plan.sha256,
    reviewedDuplicates:[...duplicates].sort(),distinctReason:duplicates.length?reason.trim():null});
   lockReview(true);
   await operation.submit(input);
  }catch{lockReview(false);operation.setStatus('Confirm the reviewed bill and explain why any similar records are separate.');}
 }
 return <>
  <form aria-label="Confirm supplier bill posting" onSubmit={submit}>
   <fieldset className="expense-form" disabled={operation.blocked||operation.busy||!!operation.pending||stale||context.writeState!=='ready'}>
    <legend>Confirm supplier bill posting</legend>
    {result.candidates.map(candidate=><label key={candidate.payableId}>
     <input type="checkbox" required checked={duplicates.includes(candidate.payableId)} onChange={event=>{
      const checked=event.target.checked;
      setDuplicates(previous=>checked?[...previous,candidate.payableId]:previous.filter(id=>id!==candidate.payableId));
     }}/>
     I reviewed the possible duplicate dated {candidate.incurredOn} for {'$'+expenseDollars(candidate.grossCents)}.
    </label>)}
    {result.candidates.length>0&&<label>Why these bills are separate <input required maxLength={1000}
     value={reason} onChange={event=>setReason(event.target.value)}/></label>}
    <label><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
     Record the expense and amount owed on {result.plan.incurredOn}.</label>
    <button type="submit" disabled={!confirmed||duplicates.length!==result.candidates.length}>{operation.reentry?'Retry original supplier bill posting':'Post supplier bill'}</button>
   </fieldset>
  </form>
  <p role="status">{operation.status}</p>
  <PendingControls operation={operation}/>
  {stale&&<button type="button" className="secondary" onClick={onRefresh}>Clear this preview</button>}
 </>;
}

export function SupplierSettlementConfirmation({context,row,throughOn,onPosted,onRefresh,lockRegister}:{
 context:FinanceAccountContext;row:Payable;throughOn:string;onPosted:()=>void;onRefresh:()=>void;lockRegister:(locked:boolean)=>void;
}){
 const accountLabel=useId();
 const [day,setDay]=useState(''),[amount,setAmount]=useState(''),[referenceId,setReferenceId]=useState('');
 const [evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[source,setSource]=useState('');
 const [confirmed,setConfirmed]=useState(false),[stale,setStale]=useState(false);
 const [channels,setChannels]=useState<MoneyChannel[]|null>(null),[loading,setLoading]=useState(false);
 const abortChannels=useRef<AbortController|null>(null);
 const operation=useSupplierConfirmation<ReturnType<typeof parseSupplierSettlementRequest>>(context,{kind:'settlement',id:row.payableId},financeAccounts.postSupplierSettlement,onPosted,()=>{setStale(true);lockRegister(false);});
 useEffect(()=>()=>abortChannels.current?.abort(),[]);
 async function loadChannels(){
  if(abortChannels.current||!day)return;
  const request=new AbortController();abortChannels.current=request;setLoading(true);operation.setStatus('');
  try{
   const available:MoneyChannel[]=[];
   let after:string|null=null;
   do{
    const page:Awaited<ReturnType<typeof financeAccounts.moneyChannels>>=await financeAccounts.moneyChannels(context,after,request.signal);
    if(request.signal.aborted)return;
    for(const channel of page.rows){
     if(channel.ownershipScope!=='dedicated_business'||(channel.kind!=='bank'&&channel.kind!=='wallet'))continue;
     let chosen:MoneyChannel|undefined=channel.effectiveFrom<=day?channel:undefined;
     let before:string|null=chosen?null:channel.version;
     while(before&&!chosen){
      const history:Awaited<ReturnType<typeof financeAccounts.moneyChannelHistory>>=
       await financeAccounts.moneyChannelHistory(context,channel.channelId,before,request.signal);
      if(request.signal.aborted)return;
      chosen=history.rows.find(row=>row.effectiveFrom<=day);
      before=history.hasMore?history.rows.at(-1)!.version:null;
     }
     if(chosen?.active&&chosen.openingState==='verified_zero'&&chosen.openingOn&&chosen.openingOn<=day)available.push(chosen);
    }
    after=page.hasMore?page.rows.at(-1)!.channelId:null;
   }while(after);
   if(request.signal.aborted)return;
   setSource('');setChannels(available);
   if(!available.length)operation.setStatus('Set up a verified bank account or wallet before recording payment.');
  }catch{if(!request.signal.aborted)operation.setStatus('Payment accounts could not be loaded.');}
  finally{if(abortChannels.current===request){abortChannels.current=null;setLoading(false);}}
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(operation.blocked||operation.pending||operation.busy||!context.recoveryEpoch||context.writeState!=='ready'||!confirmed)return;
  try{
   const channel=channels?.find(item=>item.channelId===source);
   if(!channel||!/^([1-9][0-9]{0,16}|0)(\.[0-9]{1,2})?$/.test(amount.trim()))throw Error();
   const [whole,fraction='']=amount.trim().split('.');
   const paidCents=(100n*BigInt(whole!)+BigInt(fraction.padEnd(2,'0'))).toString();
   const reference={kind:'settlement',id:crypto.randomUUID(),operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   const input=parseSupplierSettlementRequest({reference,payableId:row.payableId,channelId:channel.channelId,channelVersion:channel.version,
    actualOn:day,paidCents,remainingCents:row.remainingCents,
    evidence:{namespace:'statement',id:referenceId.trim(),reference:evidence.trim()},confirmation:reason.trim()});
   lockRegister(true);
   await operation.submit(input);
  }catch{lockRegister(false);operation.setStatus('Enter a verified payment and an amount no greater than the outstanding balance.');}
 }
 return <details>
  <summary>Record supplier payment</summary>
  <form aria-label="Confirm supplier payment" onSubmit={submit}>
   <fieldset className="expense-form" disabled={operation.blocked||operation.busy||!!operation.pending||stale||context.writeState!=='ready'}>
    <legend>Confirm an already completed payment</legend>
    <p>{'$'+expenseDollars(row.remainingCents)} outstanding through {throughOn}.</p>
    <label>Actual payment date <input type="date" min={row.incurredOn} max={throughOn} value={day} required onChange={event=>{
     abortChannels.current?.abort();abortChannels.current=null;setLoading(false);
     setDay(event.target.value);setChannels(null);setSource('');
    }}/></label>
    <button type="button" className="secondary" disabled={loading||!day} onClick={()=>void loadChannels()}>Load payment accounts</button>
    <label htmlFor={accountLabel}>Payment account</label><select id={accountLabel} required value={source} onChange={event=>setSource(event.target.value)}>
     <option value="">Choose the account used</option>
     {channels?.map(channel=><option key={channel.channelId} value={channel.channelId}>{channel.label} · {channel.maskedSuffix}</option>)}
    </select>
    <label>Paid amount (USD) <input required value={amount} inputMode="decimal" onChange={event=>setAmount(event.target.value)}/></label>
    <label>Statement transaction ID <input required value={referenceId} maxLength={200} onChange={event=>setReferenceId(event.target.value)}/></label>
    <label>Statement description <input required value={evidence} maxLength={1000} onChange={event=>setEvidence(event.target.value)}/></label>
    <label>Payment review note <input required value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/></label>
    <label><input type="checkbox" required checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
     I verified this debit on the account statement.</label>
    <button type="submit" disabled={!confirmed||loading}>{operation.reentry?'Retry original supplier payment':'Record verified payment'}</button>
   </fieldset>
  </form>
  <p role="status">{operation.status}</p>
  <PendingControls operation={operation}/>
  {stale&&<button type="button" className="secondary" onClick={onRefresh}>Reload supplier payables</button>}
 </details>;
}
