'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {financeAccounts} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {normalizeOpeningPayablesEvidence} from '../../../bookkeeping/opening-payables-contract';
import {openingPayablesDraftFromEvidence} from '../../../bookkeeping/opening-payables-schedule-contract';
import type {OpeningPayablesReceipt} from '../../../bookkeeping/opening-payables-schedule-contract';
import {parseOpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import type {OpeningReceipt,OpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import {OpeningPayablesSourceForm} from './opening-payables-source-form';
import {OpeningAllocations} from './opening-allocations';
import {OpeningSourceHistory} from './opening-source-history';
import type {OpeningHistoryPage} from './opening-source-history';
import type {OpeningSourceCursor} from '../../../bookkeeping/opening-source-history-contract';
import type {PayableBill} from './opening-payables-source-form';
import {dollars} from './opening-worksheet-fields';
import styles from './screen.module.css';

const pendingKey=(businessId:string)=>'crest.opening-payables.pending.v1.'+businessId;
export function OpeningPayables({worksheet}:{worksheet:OpeningReceipt}){
 const {businessId,revision,worksheetRevisionId,cutoverOn}=worksheet;
 const [saved,setSaved]=useState<OpeningPayablesReceipt|null|undefined>(undefined),[bills,setBills]=useState<readonly PayableBill[]>([]);
 const [dirty,setDirty]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [editing,setEditing]=useState<{key:string;bill:PayableBill|null}|null>(null);
 const [pending,setPending]=useState<OpeningReference|null>(null);
 const [mayClose,setMayClose]=useState(false),[closeReason,setCloseReason]=useState('');
 const [history,setHistory]=useState<OpeningHistoryPage|null>(null),[source,setSource]=useState<OpeningPayablesReceipt|null>(null),[historicalIds,setHistoricalIds]=useState<ReadonlySet<string>>(new Set());
 const request=useRef<AbortController|null>(null);
 function clear(){
  request.current?.abort();request.current=null;setSaved(undefined);setBills([]);setDirty(false);setReason('');setBusy(false);setMessage('');
  setEditing(null);setPending(null);setMayClose(false);setCloseReason('');setHistory(null);setSource(null);setHistoricalIds(new Set());
 }
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{request.current?.abort();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[]);
 async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
  if(request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
  try{
   const context=await financeAccounts.context(controller.signal);
   if(controller.signal.aborted)return;
   if(context.businessId!==businessId||!context.openingPayables||!context.recoveryEpoch)throw Error('OPENING_FUNDS_ACCESS_REQUIRED');
   await action(context,controller.signal);
  }catch{if(!controller.signal.aborted)setMessage(failure);}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function readPending(){const stored=sessionStorage.getItem(pendingKey(businessId));return stored===null?null:parseOpeningReference(JSON.parse(stored));}
 function clearPending(){sessionStorage.removeItem(pendingKey(businessId));setPending(null);setMayClose(false);setCloseReason('');}
 function adopt(schedule:OpeningPayablesReceipt|null){
  if(schedule&&schedule.evidence.cutoverOn!==cutoverOn)throw Error('OPENING_FUNDS_CUTOVER_REQUIRED');
  setSaved(schedule);setBills(schedule?openingPayablesDraftFromEvidence(schedule.evidence).bills:[]);setDirty(false);setReason('');setEditing(null);
 }
 function load(){
  void run(async(context,signal)=>{
   const original=readPending();if(original){setPending(original);setMessage('Check the interrupted supplier balance save before editing.');return;}
   const result=await financeAccounts.readOpeningPayablesSchedule(context,revision,worksheetRevisionId,signal);
   if(signal.aborted)return;adopt(result.schedule);
   setMessage(result.schedule?'Saved supplier balances loaded.':'No supplier balance schedule has been saved for this worksheet.');
  },'Crest could not load saved supplier balances. Check your sign-in and try again.');
 }
 function keep(bill:PayableBill){
  try{
   const next=bills.some(item=>item.billId===bill.billId)?bills.map(item=>item.billId===bill.billId?bill:item):[...bills,bill];
   normalizeOpeningPayablesEvidence({schemaVersion:1,bills:next,reason:'Review retained supplier balances'},cutoverOn);
   setBills(next);setDirty(true);setEditing(null);setMessage('Supplier-balance added to your review. Save the schedule below to keep it.');
  }catch{setMessage('This supplier bill reference is already included. Review its original identity and amounts.');}
 }
 function loadHistory(cursor:OpeningSourceCursor|null){void run(async(context,signal)=>{const result=await financeAccounts.readOpeningSourceHistory(context,'payables',cursor,signal);if(signal.aborted)return;setHistory(result);},'Crest could not load prior supplier reviews. Check your sign-in.');}
 function inspectSource(id:string){void run(async(context,signal)=>{const result=await financeAccounts.readOpeningPayablesHistorical(context,id,signal);if(signal.aborted)return;setSource(result);setMessage(result?'Choose a saved bill to review for the current cutover. Its original identity will be kept.':'This saved supplier review is unavailable.');},'Crest could not read the selected supplier review.');}
 function reuseBill(bill:PayableBill){setHistoricalIds(previous=>new Set([...previous,bill.billId]));setEditing({key:crypto.randomUUID(),bill});setMessage('Review the saved bill and its payments against the current cutover before keeping it.');}
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(saved===undefined||editing||!financeAccountReviewReason(reason.trim()))return;
  const input={schemaVersion:1 as const,bills,reason:reason.trim()};
  try{normalizeOpeningPayablesEvidence(input,cutoverOn);}catch{setMessage('Review the supplier balance evidence before saving.');return;}
  void run(async(context,signal)=>{
   const original=readPending();if(original){setPending(original);setMessage('Check the interrupted supplier balance save first.');return;}
   if(!context.recoveryEpoch)return;
   const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   sessionStorage.setItem(pendingKey(businessId),JSON.stringify(reference));
   const retained=readPending();if(retained?.operationId!==reference.operationId||retained.recoveryEpoch!==reference.recoveryEpoch)throw Error('ORIGINAL_REFERENCE_REQUIRED');
   setPending(reference);
   const result=await financeAccounts.saveOpeningPayablesSchedule(context,reference,worksheetRevisionId,cutoverOn,{worksheetRevision:revision,expectedRevision:saved?.revision??'0',input},signal);
   if(signal.aborted)return;
   if(result.state==='committed'){clearPending();adopt(result.receipt);setMessage(`Supplier balance schedule revision ${result.receipt.revision} saved. No money was moved or posted.`);}
   else if(result.state==='revision_conflict'){clearPending();setSaved(undefined);setMessage('The worksheet or supplier balances changed. Reload the current worksheet before continuing.');}
   else if(result.state==='invalid'){clearPending();setMessage('Crest could not verify these supplier balances. Review the supplier bills, references, dates and amounts.');}
   else setMessage('Check the original supplier balance save before continuing.');
  },'Crest could not confirm this save. Check the original supplier balance save before trying another.');
 }
 function inspect(reason:string|null){
  if(!pending)return;
  void run(async(context,signal)=>{
   const result=await financeAccounts.resolveOpeningPayablesSchedule(context,pending,reason,signal);if(signal.aborted)return;
   if(result.state==='committed'||result.state==='retired'){
    clearPending();const current=await financeAccounts.readOpeningPayablesSchedule(context,revision,worksheetRevisionId,signal);
    if(signal.aborted)return;adopt(current.schedule);
    setMessage(result.state==='committed'?'The original supplier balance save was confirmed.':'The interrupted attempt was closed. No supplier balance was created by closing it.');
   }else if(result.state==='absent'||result.state==='review_required'){setMayClose(true);setMessage('No committed supplier balance schedule was found for this attempt. Review and explicitly close it before starting another save.');}
   else setMessage('Crest could not match the original save. Keep the reference for review.');
  },'Crest could not check the original save. Its reference is retained so you can try again.');
 }
 function download(){
  if(!saved)return;
  void run(async(context,signal)=>{
   const result=await financeAccounts.readOpeningPayablesSchedule(context,revision,worksheetRevisionId,signal);if(signal.aborted)return;
   if(result.schedule?.scheduleRevisionId!==saved.scheduleRevisionId){setMessage('The saved supplier balances changed. Reload them before downloading.');return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify(result.schedule,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download=`crest-opening-supplier-balances-worksheet-${revision}-revision-${saved.revision}.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage('Saved supplier balance evidence download requested.');
  },'Crest could not verify the saved supplier balances for download. Check your sign-in.');
 }
 const totals=normalizeOpeningPayablesEvidence({schemaVersion:1,bills,reason:'Review retained supplier balances'},cutoverOn).totals;
 return <section aria-label="Opening supplier balances"><details>
  <summary>Supplier bills still owed at cutover</summary>
  <p>Carry forward only unpaid balances from before {cutoverOn}. Saving this evidence creates no new expense or payment.</p>
  <button type="button" className="secondary" disabled={busy} onClick={load}>Load supplier balances</button>
  {message&&<p role="status">{message}</p>}
  {pending&&<div className={styles.openingGroup}>
   <h4>Check the interrupted save</h4><p>Review the original attempt before saving another version.</p>
   <button type="button" disabled={busy} onClick={()=>inspect(null)}>Check original supplier balance save</button>
   {mayClose&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))inspect(closeReason.trim());}}>
    <label htmlFor="payables-close-reason">Reason for closing the interrupted attempt</label><input id="payables-close-reason" required maxLength={1000} value={closeReason} onChange={event=>setCloseReason(event.target.value)}/>
    <button type="submit" className="secondary" disabled={busy}>Close interrupted supplier balance save</button>
   </form>}
  </div>}
  {saved!==undefined&&!pending&&<div>
   <dl className={styles.openingGroup}><div><dt>{dirty?'Supplier balances under review':'Saved supplier balances'}</dt><dd>${dollars(totals.remainingCents)} USD · {totals.billCount} bills</dd></div><div><dt>Evidence still to review</dt><dd>{totals.unknownDueCount} unknown due dates · {totals.unknownTaxCount} unknown tax references</dd></div></dl>
   {saved&&<details><summary>Saved revision {saved.revision}</summary><p>{saved.evidence.reason}</p><p>Saved {saved.recordedAt.slice(0,10)}. Opening balances still need separate approval.</p><button type="button" className="secondary" disabled={busy} onClick={download}>Download saved supplier-bill evidence (JSON)</button></details>}
   {bills.length===0&&<p>No unpaid supplier bills are entered in this review. This does not verify a zero balance.</p>}
   {!editing&&<details><summary>Reuse a bill from a saved review</summary><OpeningSourceHistory page={history} busy={busy} label="supplier bills" onLoad={loadHistory} onSelect={inspectSource}/>
    {source&&<div><p>Source cutover {source.evidence.cutoverOn} · saved review {source.revision}. Check every amount and date for the current cutover.</p>{openingPayablesDraftFromEvidence(source.evidence).bills.map(bill=><button key={bill.billId} type="button" className="secondary" disabled={busy||bills.some(current=>current.billId===bill.billId)} onClick={()=>reuseBill(bill)}>Review saved bill {bill.externalId} · {bill.vendor}{bills.some(current=>current.billId===bill.billId)?' · already included':''}</button>)}</div>}
   </details>}
   {bills.map((bill,index)=><div className={styles.openingGroup} key={bill.billId}>
    <h4>{bill.vendor}</h4><p>{bill.externalId} · ${dollars(bill.remainingCents)} USD still owed</p><p>{bill.purpose}</p><p>Original bill {bill.incurredOn} · ${dollars(bill.originalCents)} USD originally · {bill.reductions.length} earlier payments or credits</p>
    <p>{bill.originalDueOn?'Due '+bill.originalDueOn:'Original due date needs review'}{bill.taxEvidence?' · Original tax reference recorded':' · Original tax information unknown'}</p>
    <button type="button" className="secondary" disabled={busy||!!editing} onClick={()=>setEditing({key:crypto.randomUUID(),bill})}>Edit supplier bill {index+1}</button>
    <button type="button" className="secondary" disabled={busy||!!editing} onClick={()=>{setBills(current=>current.filter(item=>item.billId!==bill.billId));setDirty(true);setMessage('Bill removed from this review. Earlier saved versions are retained. Save the schedule to record this change.');}}>Remove supplier bill {index+1} from this review</button>
   </div>)}
   {editing?<OpeningPayablesSourceForm key={editing.key} initial={editing.bill} identityLocked={!!saved?.evidence.bills.some(bill=>bill.billId===editing.bill?.billId)||!!editing.bill&&historicalIds.has(editing.bill.billId)} cutoverOn={cutoverOn} busy={busy} onSave={keep} onCancel={()=>setEditing(null)} onError={setMessage}/>:<button type="button" className="secondary" disabled={busy||bills.length>=200} onClick={()=>setEditing({key:crypto.randomUUID(),bill:null})}>Add unpaid supplier bill</button>}
   {!editing&&<form onSubmit={save}>
    <fieldset className={styles.openingGroup} disabled={busy}><legend>Save supplier balance evidence</legend>
     {bills.length===0&&<label><input type="checkbox" required/> I intend to save this review with no unpaid supplier bills entered.</label>}
     <label htmlFor="payables-save-reason">What did you review or change?</label><input id="payables-save-reason" required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
     <p>{dirty?'Your edits have not been saved.':'Saving creates a retained revision.'} No bill is paid and no expense is posted.</p><button type="submit">Save supplier balance evidence</button>
    </fieldset>
   </form>}
  </div>}
  {saved&&!dirty&&!editing&&!pending&&<OpeningAllocations key={saved.scheduleRevisionId} parent={saved} worksheetRevision={revision}/>}
 </details></section>;
}
