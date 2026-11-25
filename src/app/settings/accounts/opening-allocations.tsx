'use client';
import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {financeAccounts} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {prepareOpeningPayablesAllocations} from '../../../bookkeeping/opening-payables-allocation';
import type {OpeningPayablesAllocationInput} from '../../../bookkeeping/opening-payables-allocation';
import {openingPayablesDraftFromEvidence} from '../../../bookkeeping/opening-payables-schedule-contract';
import type {OpeningPayablesReceipt} from '../../../bookkeeping/opening-payables-schedule-contract';
import {openingAllocationsDraftFromEvidence} from '../../../bookkeeping/opening-allocations-schedule-contract';
import type {OpeningAllocationsReceipt} from '../../../bookkeeping/opening-allocations-schedule-contract';
import {parseOpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import type {OpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import {DollarField,dollars,readEvidence,value} from './opening-worksheet-fields';
import {OpeningEvidencePicker} from './opening-evidence-picker';
import styles from './screen.module.css';
import {OpeningSourceHistory} from './opening-source-history';
import type {OpeningHistoryPage} from './opening-source-history';
import type {OpeningSourceCursor} from '../../../bookkeeping/opening-source-history-contract';
type Root=OpeningPayablesAllocationInput['roots'][number];
type Saved={receipt:OpeningAllocationsReceipt;supplierSchedule:OpeningPayablesReceipt};
type Row={root:Root;selectedCents:string;locked:boolean};
const pendingKey=(business:string)=>'crest.opening-allocations.pending.v1.'+business;
const binding=(vendor:string,kind:string,reference:string)=>JSON.stringify([vendor,kind,reference]);
const amount=(input:string)=>{const parts=/^(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(input);if(!parts)throw Error('AMOUNT_REQUIRED');return(BigInt(parts[1]!)*100n+BigInt((parts[2]??'').padEnd(2,'0'))).toString();};
function rowsFor(parent:OpeningPayablesReceipt,saved:Saved|null):Row[]{
 const previous=saved?openingAllocationsDraftFromEvidence(saved.receipt.evidence,saved.supplierSchedule).roots:[];
 const grouped=new Map<string,Row>();
 for(const bill of parent.evidence.bills)for(const reduction of bill.reductions){
  const key=binding(bill.vendor,reduction.kind,reduction.reference),existing=grouped.get(key);
  if(existing){existing.selectedCents=(BigInt(existing.selectedCents)+BigInt(reduction.amountCents)).toString();continue;}
  const retained=previous.find(root=>binding(root.vendor,root.kind,root.reference)===key);
  grouped.set(key,{root:{rootId:retained?.rootId??crypto.randomUUID(),sourceNamespace:retained?.sourceNamespace??'',externalId:retained?.externalId??reduction.reference,vendor:bill.vendor,kind:reduction.kind,reference:reduction.reference,appliedOn:reduction.appliedOn,originalCents:retained?.originalCents??'',evidence:reduction.evidence,otherAllocatedCents:retained?.otherAllocatedCents??'0',otherAllocationEvidence:retained?.otherAllocationEvidence??null},selectedCents:reduction.amountCents,locked:!!retained});
 }
 return [...grouped.values()];
}
function RootFields({row,index}:{row:Row;index:number}){
 const {root}=row,prefix=root.rootId,[outside,setOutside]=useState(BigInt(root.otherAllocatedCents)>0n);
 return <fieldset className={styles.openingGroup}><legend>{root.kind==='payment'?'Original payment':'Original supplier credit'} {index+1}</legend>
  <h5>{root.vendor} · {root.reference}</h5><p>{root.appliedOn} · ${dollars(row.selectedCents)} USD applied across these bills.</p>
  <label htmlFor={prefix+'-source'}>Original records label</label><input id={prefix+'-source'} name={prefix+'-source'} required pattern="[a-z][a-z0-9_.-]{0,99}" maxLength={100} defaultValue={root.sourceNamespace} readOnly={row.locked}/>
  <label htmlFor={prefix+'-external'}>Original transaction reference</label><input id={prefix+'-external'} name={prefix+'-external'} required maxLength={200} defaultValue={root.externalId} readOnly={row.locked}/>
  <DollarField name={prefix+'-original'} label="Original total amount (USD)" initial={root.originalCents||null}/>
  <p>Supporting document: {root.evidence.reference}. This uses the document identified with the saved supplier bills.</p>
  <label className={styles.openingChoice}><input type="checkbox" checked={outside} onChange={event=>setOutside(event.target.checked)}/><span>Some of this payment or credit was used outside these bills</span></label>
  {outside?<><DollarField name={prefix+'-outside'} label="Amount used outside these bills (USD)" initial={root.otherAllocatedCents==='0'?null:root.otherAllocatedCents}/><OpeningEvidencePicker name={prefix+'-outside-evidence'} label="Outside allocation" initial={root.otherAllocationEvidence}/></>:<input type="hidden" name={prefix+'-outside'} value="0"/>}
  <label className={styles.openingChoice}><input name={prefix+'-reviewed'} type="checkbox" required/><span>I checked the original total and any uses outside these bills.</span></label>
 </fieldset>;
}
export function OpeningAllocations({parent,worksheetRevision}:{parent:OpeningPayablesReceipt;worksheetRevision:string}){
 const {businessId,worksheetRevisionId}=parent;
 const [saved,setSaved]=useState<Saved|null|undefined>(),[rows,setRows]=useState<Row[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [pending,setPending]=useState<OpeningReference|null>(null),[mayClose,setMayClose]=useState(false),[closeReason,setCloseReason]=useState('');
 const request=useRef<AbortController|null>(null);
 const [history,setHistory]=useState<OpeningHistoryPage|null>(null),[editKey,setEditKey]=useState('new');
 function clear(){request.current?.abort();request.current=null;setSaved(undefined);setRows([]);setMessage('');setBusy(false);setPending(null);setMayClose(false);setCloseReason('');setHistory(null);setEditKey('new');}
 useEffect(()=>{const hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);return()=>{request.current?.abort();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};},[]);
 async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
  if(request.current)return;const controller=new AbortController();request.current=controller;setBusy(true);setMessage('');
  try{const context=await financeAccounts.context(controller.signal);if(controller.signal.aborted)return;if(context.businessId!==businessId||!context.openingPayables||!context.recoveryEpoch)throw Error('ACCESS_REQUIRED');await action(context,controller.signal);}catch{if(!controller.signal.aborted)setMessage(failure);}finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function readPending(){const stored=sessionStorage.getItem(pendingKey(businessId));return stored===null?null:parseOpeningReference(JSON.parse(stored));}
 function clearPending(){sessionStorage.removeItem(pendingKey(businessId));setPending(null);setMayClose(false);setCloseReason('');}
 function adopt(value:Saved|null){setSaved(value);setRows(rowsFor(parent,value));setEditKey(crypto.randomUUID());}
 function loadHistory(cursor:OpeningSourceCursor|null){void run(async(context,signal)=>{const result=await financeAccounts.readOpeningSourceHistory(context,'allocations',cursor,signal);if(signal.aborted)return;setHistory(result);},'Crest could not load prior allocation reviews.');}
 function reuseSources(id:string){void run(async(context,signal)=>{const result=await financeAccounts.readOpeningAllocationsHistorical(context,id,signal);if(signal.aborted)return;if(!result){setMessage('The selected saved allocation review is unavailable.');return;}setRows(rowsFor(parent,result));setEditKey(crypto.randomUUID());setMessage('Prior original sources loaded for review. Check their totals and uses outside the current bills before saving.');},'Crest could not verify the selected original payment sources.');}
 function load(){void run(async(context,signal)=>{const original=readPending();if(original){setPending(original);setMessage('Check the original reconciliation save before editing.');return;}const result=await financeAccounts.readOpeningAllocationsSchedule(context,worksheetRevision,worksheetRevisionId,signal);if(signal.aborted)return;adopt(result.schedule);setMessage(result.schedule?(result.schedule.receipt.payablesRevision===parent.revision?'Saved payment allocation review loaded.':'Supplier bills changed after this review. Check the current bills and save a new review.'):'Review the original totals for earlier payments and supplier credits.');},'Crest could not load the allocation review. Check your sign-in.');}
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(saved===undefined)return;let input:OpeningPayablesAllocationInput;
  try{const data=new FormData(event.currentTarget);input={schemaVersion:1,reason:value(data,'allocation-reason'),roots:rows.map(({root})=>{if(data.get(root.rootId+'-reviewed')!=='on')throw Error('REVIEW_REQUIRED');const otherAllocatedCents=amount(value(data,root.rootId+'-outside'));return {...root,sourceNamespace:value(data,root.rootId+'-source'),externalId:value(data,root.rootId+'-external'),originalCents:amount(value(data,root.rootId+'-original')),otherAllocatedCents,otherAllocationEvidence:otherAllocatedCents==='0'?null:readEvidence(data,root.rootId+'-outside-evidence')};})};prepareOpeningPayablesAllocations(openingPayablesDraftFromEvidence(parent.evidence),parent.evidence.cutoverOn,input);}catch{setMessage('Check the original amounts, supporting documents and uses outside these bills. Combined allocations cannot exceed an original payment or credit.');return;}
  void run(async(context,signal)=>{const original=readPending();if(original){setPending(original);setMessage('Check the original reconciliation save first.');return;}if(!context.recoveryEpoch)return;const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};sessionStorage.setItem(pendingKey(businessId),JSON.stringify(reference));const retained=readPending();if(retained?.operationId!==reference.operationId||retained.recoveryEpoch!==reference.recoveryEpoch)throw Error('ORIGINAL_REFERENCE_REQUIRED');setPending(reference);
   const result=await financeAccounts.saveOpeningAllocationsSchedule(context,reference,parent,{worksheetRevision,payablesRevision:parent.revision,expectedRevision:saved?.receipt.revision??'0',input},signal);if(signal.aborted)return;
   if(result.state==='committed'){clearPending();adopt({receipt:result.receipt,supplierSchedule:result.supplierSchedule});setMessage(`Payment allocation review revision ${result.receipt.revision} saved. No payment or expense was posted.`);}else if(result.state==='revision_conflict'){clearPending();setSaved(undefined);setRows([]);setMessage('The worksheet, supplier bills or allocation review changed. Reload the current supplier balances and review.');}else if(result.state==='invalid'){clearPending();setMessage('The allocation review was refused. Check original references, totals and evidence.');}else setMessage('Check the original reconciliation save before continuing.');
  },'Crest could not confirm this save. Check the original reconciliation save before starting another.');
 }
 function inspect(reason:string|null){if(!pending)return;void run(async(context,signal)=>{const result=await financeAccounts.resolveOpeningAllocationsSchedule(context,pending,reason,signal);if(signal.aborted)return;if(result.state==='committed'||result.state==='retired'){clearPending();const latest=await financeAccounts.readOpeningAllocationsSchedule(context,worksheetRevision,worksheetRevisionId,signal);if(signal.aborted)return;adopt(latest.schedule);setMessage(result.state==='committed'?'The original reconciliation save was confirmed.':'The interrupted reconciliation save was closed.');}else if(result.state==='absent'||result.state==='review_required'){setMayClose(true);setMessage('No committed review was found. Review and explicitly close this attempt before starting another.');}else setMessage('Crest could not match the original save. Keep the reference for review.');},'Crest could not check the original save. Its reference is retained.');}
 function download(){if(!saved)return;void run(async(context,signal)=>{const latest=await financeAccounts.readOpeningAllocationsSchedule(context,worksheetRevision,worksheetRevisionId,signal);if(signal.aborted)return;if(latest.schedule?.receipt.allocationRevisionId!==saved.receipt.allocationRevisionId){setMessage('The saved review changed. Reload it before downloading.');return;}const url=URL.createObjectURL(new Blob([JSON.stringify(latest.schedule,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='crest-opening-supplier-allocations-revision-'+saved.receipt.revision+'.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Saved allocation review download requested.');},'Crest could not verify this review for download.');}
 return <section className={styles.allocationReview} aria-label="Historical supplier payment allocations"><details className={styles.allocationDetails}><summary>Check earlier payment and credit totals</summary>
  <p>One historical payment can cover several bills. Check its original total and any uses elsewhere before carrying the remaining supplier balances forward.</p>
  <button type="button" className="secondary" disabled={busy} onClick={load}>Load payment allocation review</button>{message&&<p role="status">{message}</p>}
  {pending&&<div className={styles.openingGroup}><button type="button" disabled={busy} onClick={()=>inspect(null)}>Check original reconciliation save</button>{mayClose&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))inspect(closeReason.trim());}}><label htmlFor="allocation-close-reason">Reason for closing the interrupted attempt</label><input id="allocation-close-reason" required maxLength={1000} value={closeReason} onChange={event=>setCloseReason(event.target.value)}/><button type="submit" disabled={busy}>Close interrupted reconciliation save</button></form>}</div>}
  {saved!==undefined&&!pending&&<div>{saved&&<details><summary>Saved allocation review {saved.receipt.revision}</summary><p>{saved.receipt.evidence.reason}</p><p>Applies to supplier-bill revision {saved.receipt.payablesRevision}. {saved.receipt.payablesRevision===parent.revision?'Matches the loaded bills.':'A new review is required for the loaded bills.'}</p><button type="button" className="secondary" disabled={busy} onClick={download}>Download saved allocation evidence (JSON)</button></details>}
   <details><summary>Reuse original sources from an earlier review</summary><OpeningSourceHistory page={history} busy={busy} label="allocation sources" onLoad={loadHistory} onSelect={reuseSources}/></details>
   <form className={styles.allocationForm} key={editKey} onSubmit={save}><fieldset disabled={busy} className={styles.openingGroup}><legend>Original payment and credit review</legend>
    {rows.map((row,index)=><RootFields key={row.root.rootId} row={row} index={index}/>)}{rows.length===0&&<p>The loaded bills contain no earlier payments or credits. Saving this review does not verify a zero supplier balance.</p>}
    <label htmlFor="allocation-reason">What did you review or change?</label><input id="allocation-reason" name="allocation-reason" required maxLength={1000}/><p>Unused original amounts remain unallocated. This review does not approve opening balances or move money.</p><button type="submit">Save payment allocation review</button>
   </fieldset></form>
  </div>}
 </details></section>;
}
