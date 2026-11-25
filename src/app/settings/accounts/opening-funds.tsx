'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication} from '../../../client/authentication';
import {customers} from '../../../client/customers';
import {financeAccounts} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {normalizeOpeningFundsEvidence} from '../../../bookkeeping/opening-funds-contract';
import {openingFundsDraftFromEvidence} from '../../../bookkeeping/opening-funds-schedule-contract';
import type {OpeningFundsReceipt} from '../../../bookkeeping/opening-funds-schedule-contract';
import {parseOpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import type {OpeningReceipt,OpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import {OpeningFundsSourceForm} from './opening-funds-source-form';
import type {FundCustomer,FundOrigin} from './opening-funds-source-form';
import {dollars,value} from './opening-worksheet-fields';
import styles from './screen.module.css';

const pendingKey=(businessId:string)=>'crest.opening-funds.pending.v1.'+businessId;
export function OpeningFunds({worksheet}:{worksheet:OpeningReceipt}){
 const {businessId,revision,worksheetRevisionId,cutoverOn}=worksheet;
 const [saved,setSaved]=useState<OpeningFundsReceipt|null|undefined>(undefined),[roots,setRoots]=useState<readonly FundOrigin[]>([]);
 const [dirty,setDirty]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [editing,setEditing]=useState<{key:string;root:FundOrigin|null}|null>(null),[choices,setChoices]=useState<FundCustomer[]>([]);
 const [labels,setLabels]=useState<ReadonlyMap<string,string>>(new Map()),[pending,setPending]=useState<OpeningReference|null>(null);
 const [mayClose,setMayClose]=useState(false),[closeReason,setCloseReason]=useState('');
 const request=useRef<AbortController|null>(null),search=useRef<HTMLFormElement|null>(null);
 function clear(){
  request.current?.abort();request.current=null;setSaved(undefined);setRoots([]);setDirty(false);setReason('');setBusy(false);setMessage('');
  setEditing(null);setChoices([]);setLabels(new Map());setPending(null);setMayClose(false);setCloseReason('');search.current?.reset();
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
   if(context.businessId!==businessId||!context.openingFunds||!context.recoveryEpoch)throw Error('OPENING_FUNDS_ACCESS_REQUIRED');
   await action(context,controller.signal);
  }catch{if(!controller.signal.aborted)setMessage(failure);}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function readPending(){const stored=sessionStorage.getItem(pendingKey(businessId));return stored===null?null:parseOpeningReference(JSON.parse(stored));}
 function clearPending(){sessionStorage.removeItem(pendingKey(businessId));setPending(null);setMayClose(false);setCloseReason('');}
 function adopt(schedule:OpeningFundsReceipt|null){
  if(schedule&&schedule.evidence.cutoverOn!==cutoverOn)throw Error('OPENING_FUNDS_CUTOVER_REQUIRED');
  setSaved(schedule);setRoots(schedule?openingFundsDraftFromEvidence(schedule.evidence).roots:[]);setDirty(false);setReason('');setEditing(null);setChoices([]);
 }
 function load(){
  void run(async(context,signal)=>{
   const original=readPending();if(original){setPending(original);setMessage('Check the interrupted deposit save before editing.');return;}
   const result=await financeAccounts.readOpeningFundsSchedule(context,revision,worksheetRevisionId,signal);
   if(signal.aborted)return;adopt(result.schedule);
   setMessage(result.schedule?'Saved deposits loaded.':'No deposit schedule has been saved for this worksheet.');
  },'Crest could not load saved deposits. Check your sign-in and try again.');
 }
 function find(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const query=value(new FormData(event.currentTarget),'funds-customer');
  void run(async(_context,signal)=>{
   const proof=await authentication.session(signal),result=await customers.list(businessId,{search:query,afterId:null,includeArchived:true,pageSize:25},proof,signal);
   if(signal.aborted)return;
   const matches=result.customers.map(customer=>({id:customer.id,label:customer.display_name+(customer.archived_at?' (archived)':'')}));
   setChoices(matches);setLabels(current=>new Map([...current,...matches.map(customer=>[customer.id,customer.label] as const)]));
   setMessage(result.hasMore?'Refine the search to find the exact customer.':matches.length?'Choose a customer in the deposit form below.':'No matching customers.');
  },'Crest could not search customers. Check your sign-in.');
 }
 function keep(root:FundOrigin){
  try{
   const next=roots.some(item=>item.rootId===root.rootId)?roots.map(item=>item.rootId===root.rootId?root:item):[...roots,root];
   normalizeOpeningFundsEvidence({schemaVersion:1,roots:next,reason:'Review retained customer deposits'},cutoverOn);
   setRoots(next);setDirty(true);setEditing(null);setChoices([]);setMessage('Deposit added to your review. Save the schedule below to keep it.');
  }catch{setMessage('This receipt or allocation is already included. Review the original reference and amounts.');}
 }
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(saved===undefined||editing||!financeAccountReviewReason(reason.trim()))return;
  const input={schemaVersion:1 as const,roots,reason:reason.trim()};
  try{normalizeOpeningFundsEvidence(input,cutoverOn);}catch{setMessage('Review the deposit evidence before saving.');return;}
  void run(async(context,signal)=>{
   const original=readPending();if(original){setPending(original);setMessage('Check the interrupted deposit save first.');return;}
   if(!context.recoveryEpoch)return;
   const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   sessionStorage.setItem(pendingKey(businessId),JSON.stringify(reference));
   const retained=readPending();if(retained?.operationId!==reference.operationId||retained.recoveryEpoch!==reference.recoveryEpoch)throw Error('ORIGINAL_REFERENCE_REQUIRED');
   setPending(reference);
   const result=await financeAccounts.saveOpeningFundsSchedule(context,reference,worksheetRevisionId,cutoverOn,{worksheetRevision:revision,expectedRevision:saved?.revision??'0',input},signal);
   if(signal.aborted)return;
   if(result.state==='committed'){clearPending();adopt(result.receipt);setMessage(`Deposit schedule revision ${result.receipt.revision} saved. No money was moved or posted.`);}
   else if(result.state==='revision_conflict'){clearPending();setSaved(undefined);setMessage('The worksheet or deposits changed. Reload the current worksheet before continuing.');}
   else if(result.state==='invalid'){clearPending();setMessage('Crest could not verify these deposits. Review the customers, receipt references, dates and amounts.');}
   else setMessage('Check the original deposit save before continuing.');
  },'Crest could not confirm this save. Check the original deposit save before trying another.');
 }
 function inspect(reason:string|null){
  if(!pending)return;
  void run(async(context,signal)=>{
   const result=await financeAccounts.resolveOpeningFundsSchedule(context,pending,reason,signal);if(signal.aborted)return;
   if(result.state==='committed'||result.state==='retired'){
    clearPending();const current=await financeAccounts.readOpeningFundsSchedule(context,revision,worksheetRevisionId,signal);
    if(signal.aborted)return;adopt(current.schedule);
    setMessage(result.state==='committed'?'The original deposit save was confirmed.':'The interrupted attempt was closed. No deposit was created by closing it.');
   }else if(result.state==='absent'||result.state==='review_required'){setMayClose(true);setMessage('No committed deposit schedule was found for this attempt. Review and explicitly close it before starting another save.');}
   else setMessage('Crest could not match the original save. Keep the reference for review.');
  },'Crest could not check the original save. Its reference is retained so you can try again.');
 }
 function download(){
  if(!saved)return;
  void run(async(context,signal)=>{
   const result=await financeAccounts.readOpeningFundsSchedule(context,revision,worksheetRevisionId,signal);if(signal.aborted)return;
   if(result.schedule?.scheduleRevisionId!==saved.scheduleRevisionId){setMessage('The saved deposits changed. Reload them before downloading.');return;}
   const url=URL.createObjectURL(new Blob([JSON.stringify(result.schedule,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');
   link.href=url;link.download=`crest-opening-deposits-worksheet-${revision}-revision-${saved.revision}.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage('Saved deposit evidence download requested.');
  },'Crest could not verify the saved deposits for download. Check your sign-in.');
 }
 const totals=normalizeOpeningFundsEvidence({schemaVersion:1,roots,reason:'Review retained customer deposits'},cutoverOn).totals;
 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Customer deposits held at cutover</summary>
  <section aria-label="Opening customer deposits" aria-busy={busy}>
   <p>Review customer money you still held just before {cutoverOn}. Saving this evidence creates no new receipt, refund or accounting entry.</p>
   <p role="status" aria-live="polite">{message}</p>
   <button type="button" className="secondary" disabled={busy||!!pending||!!editing} onClick={load}>{dirty?'Discard schedule edits and reload':saved===undefined?'Load saved deposits':'Reload saved deposits'}</button>
   {pending&&<div className={styles.openingGroup}>
    <p>An earlier save needs review. Check it before editing or saving again.</p>
    <button type="button" disabled={busy} onClick={()=>inspect(null)}>Check original deposit save</button>
    {mayClose&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))inspect(closeReason.trim());}}>
     <label htmlFor="funds-close-reason">Reason for closing the interrupted attempt</label>
     <input id="funds-close-reason" required maxLength={1000} value={closeReason} onChange={event=>setCloseReason(event.target.value)}/>
     <button type="submit" className="secondary" disabled={busy}>Close interrupted deposit save</button>
    </form>}
   </div>}
   {saved!==undefined&&!pending&&<div>
    <dl className={styles.openingGroup}>
     <div><dt>{dirty?'Deposits under review':'Saved customer deposits'}</dt><dd>${dollars(totals.heldCents)} USD · {totals.rootCount} receipts · {totals.itemCount} allocations</dd></div>
     <div><dt>Documented refundable ceiling</dt><dd>{totals.refundableCeilingCents===null?'Needs review':`$${dollars(totals.refundableCeilingCents)} USD`}</dd></div>
    </dl>
    {saved&&<details><summary>Saved revision {saved.revision}</summary><p>{saved.evidence.reason}</p><p>Saved {saved.recordedAt.slice(0,10)}. This schedule does not authorize refunds or approve the opening balances.</p><button type="button" className="secondary" disabled={busy} onClick={download}>Download saved deposit evidence (JSON)</button></details>}
    {roots.map((root,index)=><div className={styles.openingGroup} key={root.rootId}>
     <h4>{root.externalId}</h4><p>Received {root.receivedOn} · ${dollars(root.receivedCents)} USD originally</p>
     <p>{root.receiptEvidence.reference}</p>
     <ul>{root.items.map((item,itemIndex)=><li key={item.itemId}>{labels.get(item.customerId)??`Saved customer allocation ${itemIndex+1}`} · ${dollars(item.heldCents)} USD held · {item.refundableCeilingCents===null?'Refundability needs review':`Refundable ceiling $${dollars(item.refundableCeilingCents)} USD`}<div>{item.obligationEvidence.reference}</div></li>)}</ul>
     <button type="button" className="secondary" disabled={busy||!!editing} onClick={()=>setEditing({key:crypto.randomUUID(),root})}>Edit deposit {index+1}</button>
     <button type="button" className="secondary" disabled={busy||!!editing} onClick={()=>{setRoots(current=>current.filter(item=>item.rootId!==root.rootId));setDirty(true);setMessage('Deposit removed from this review. Earlier saved revisions are retained. Save the schedule to record this change.');}}>Remove deposit {index+1} from this review</button>
    </div>)}
    {editing?<>
     <form ref={search} onSubmit={find}><label htmlFor="funds-customer">Find a customer by name, phone or email</label><input id="funds-customer" name="funds-customer" type="search" required maxLength={200} autoComplete="off"/><button type="submit" className="secondary" disabled={busy}>Find deposit customers</button></form>
     <OpeningFundsSourceForm key={editing.key} initial={editing.root} identityLocked={!!saved?.evidence.roots.some(root=>root.rootId===editing.root?.rootId)} choices={choices} labels={labels} cutoverOn={cutoverOn} busy={busy} onSave={keep} onCancel={()=>{setEditing(null);setChoices([]);}} onError={setMessage}/>
    </>:<button type="button" className="secondary" disabled={busy||roots.length>=200} onClick={()=>{setChoices([]);setEditing({key:crypto.randomUUID(),root:null});}}>Add original deposit</button>}
    {!editing&&<form onSubmit={save}>
     <fieldset className={styles.openingGroup} disabled={busy}>
      <legend>Save deposit evidence</legend>
      {roots.length===0&&<label><input type="checkbox" required/> I reviewed this schedule and intend to save it with no customer deposits entered.</label>}
      <label htmlFor="funds-save-reason">What did you review or change?</label><input id="funds-save-reason" required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
      <p>{dirty?'Your edits have not been saved.':'Saving creates a new retained revision.'} Opening balances still require separate review and approval.</p>
      <button type="submit">Save deposit evidence</button>
     </fieldset>
    </form>}
   </div>}
  </section>
 </details>;
}
