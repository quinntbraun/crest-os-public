'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {authentication} from '../../../client/authentication';
import {customers} from '../../../client/customers';
import {financeAccounts} from '../../../client/finance-accounts';
import {parseOpeningArInput} from '../../../bookkeeping/opening-receivables-preview';
import type {OpeningArLine,OpeningArReduction} from '../../../bookkeeping/opening-receivables-preview';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import {parseOpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import type {OpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import {DollarField,EvidenceFields,Note,amount,dollars,readEvidence,value} from './opening-worksheet-fields';
import styles from './screen.module.css';

type Choice={id:string;label:string};
type Preview=NonNullable<Awaited<ReturnType<typeof financeAccounts.reviewOpeningReceivables>>>;
type Saved=Awaited<ReturnType<typeof financeAccounts.readOpeningArSchedule>>;
const pendingKey=(businessId:string)=>'crest.opening-ar.pending.v1.'+businessId;

export function OpeningReceivables({businessId,revision,worksheetRevisionId,cutoverOn}:{
 businessId:string;revision:string;worksheetRevisionId:string;cutoverOn:string;
}){
 const [selected,setSelected]=useState<Choice|null>(null),[options,setOptions]=useState<Choice[]>([]);
 const [lines,setLines]=useState<{item:OpeningArLine;label:string}[]>([]),[reductions,setReductions]=useState<string[]>([]);
 const [tax,setTax]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [saved,setSaved]=useState<Saved|undefined>(undefined),[saveReason,setSaveReason]=useState('');
 const [pending,setPending]=useState<OpeningReference|null>(null),[mayClose,setMayClose]=useState(false),[closeReason,setCloseReason]=useState('');
 const request=useRef<AbortController|null>(null),form=useRef<HTMLFormElement>(null),search=useRef<HTMLFormElement>(null);
 function clear(){
  request.current?.abort();request.current=null;
  form.current?.reset();search.current?.reset();
  setSelected(null);setOptions([]);setLines([]);setReductions([]);setTax(false);setMessage('');setBusy(false);setPreview(null);
  setSaved(undefined);setSaveReason('');setPending(null);setMayClose(false);setCloseReason('');
 }
 useEffect(()=>()=>{request.current?.abort();},[]);
 async function run(action:(signal:AbortSignal)=>Promise<void>,failure:string){
  if(request.current)return;
  const controller=new AbortController(),{signal}=controller;request.current=controller;setBusy(true);setMessage('');
  try{await action(signal);}catch{if(!signal.aborted)setMessage(failure);}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function pendingReference(){
  const raw=sessionStorage.getItem(pendingKey(businessId));
  return raw===null?null:parseOpeningReference(JSON.parse(raw));
 }
 function clearPending(){
  sessionStorage.removeItem(pendingKey(businessId));
  setPending(null);setMayClose(false);setCloseReason('');
 }
 async function currentContext(signal:AbortSignal){
  const context=await financeAccounts.context(signal);
  if(context.businessId!==businessId||!context.openingArPreview||!context.recoveryEpoch||signal.aborted)throw Error();
  return context;
 }
 function loadSaved(){
  void run(async signal=>{
   const original=pendingReference();
   if(original){setPending(original);setMessage('Review the interrupted schedule save before editing.');return;}
   const context=await currentContext(signal);
   const result=await financeAccounts.readOpeningArSchedule(context,revision,worksheetRevisionId,signal);
   if(!signal.aborted){setSaved(result);setMessage(result?'Saved receivables loaded.':'No receivables schedule saved for this worksheet.');}
  },'Crest could not load saved receivables. Check your sign-in.');
 }
 function downloadSaved(){
  if(!saved)return;
  void run(async signal=>{
   const context=await currentContext(signal);
   const verified=await financeAccounts.readOpeningArSchedule(context,revision,worksheetRevisionId,signal);
   if(signal.aborted)return;
   if(!verified||verified.scheduleRevisionId!==saved.scheduleRevisionId){
    setSaved(verified);setMessage('The schedule changed. Review its latest saved revision before downloading.');return;
   }
   const url=URL.createObjectURL(new Blob([JSON.stringify(verified,null,2)+'\n'],{type:'application/json'}));
   const link=document.createElement('a');
   link.href=url;link.download=`crest-opening-receivables-worksheet-${revision}-revision-${verified.revision}.json`;
   link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage('Download requested. Check your browser’s downloads.');
  },'Crest could not verify the saved schedule for download. Check your sign-in.');
 }
 function store(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!preview||saved===undefined||!financeAccountReviewReason(saveReason.trim()))return;
  const input={preview:parseOpeningArInput({revision,lines:lines.map(line=>line.item)}),
   expectedRevision:saved?.revision??'0',reason:saveReason.trim()};
  void run(async signal=>{
   const original=pendingReference();
   if(original){setPending(original);setMessage('Review the interrupted schedule save before editing.');return;}
   const context=await currentContext(signal);
   if(!context.recoveryEpoch)return;
   const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   sessionStorage.setItem(pendingKey(businessId),JSON.stringify(reference));setPending(reference);
   const result=await financeAccounts.saveOpeningArSchedule(context,reference,worksheetRevisionId,input,signal);
   if(signal.aborted)return;
   if(result.state==='committed'){
    clearPending();setSaved(result.receipt);setPreview(null);setLines([]);setSaveReason('');
    setMessage(`Receivables schedule revision ${result.receipt.revision} saved.`);
   }else if(result.state==='revision_conflict'||result.state==='invalid'){
    clearPending();
    if(result.state==='revision_conflict'){
     setSaved(undefined);setMessage('The worksheet or schedule changed. Load its latest saved revision before saving.');
    }else setMessage('Crest could not verify the receivables evidence. Review the amounts, dates, and customers before saving.');
   }else setMessage('Review the original schedule save before continuing.');
  },'Crest could not confirm the schedule save. Check the original save before editing again.');
 }
 function inspect(reason:string|null){
  if(!pending)return;
  void run(async signal=>{
   const context=await currentContext(signal);
   const result=await financeAccounts.resolveOpeningArSchedule(context,pending,reason,signal);
   if(signal.aborted)return;
   if(result.state==='committed'||result.state==='retired'){
    clearPending();
    if(result.state==='committed'){setPreview(null);setLines([]);setSaveReason('');}
    const current=await financeAccounts.readOpeningArSchedule(context,revision,worksheetRevisionId,signal);
    if(!signal.aborted){
     setSaved(current);
     setMessage(result.state==='committed'?'The original receivables save was confirmed.':'The interrupted receivables save was closed.');
    }
   }else if(result.state==='absent'||result.state==='review_required'){
    setMayClose(true);setMessage('Crest found no committed receivables schedule for this attempt. Review and close it before starting another save.');
   }else setMessage('Crest could not match the original save. Keep the reference for review.');
  },'Crest could not check the original save. Keep its reference and try again.');
 }
 function find(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const query=value(new FormData(event.currentTarget),'ar-customer');
  void run(async signal=>{
   const proof=await authentication.session(signal);
   const matches=await customers.list(businessId,{search:query,afterId:null,includeArchived:true,pageSize:25},proof,signal);
   if(signal.aborted)return;
   setOptions(matches.customers.map(row=>({id:row.id,label:row.display_name+(row.archived_at?' (archived)':'')})));
   setMessage(matches.hasMore?'Refine your search to locate the exact customer.':matches.customers.length?'Choose the existing customer.':'No matching customers.');
  },'Crest could not search customers. Check your sign-in.');
 }
 function add(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!selected||lines.length>=20)return;
  try{
   const contents=new FormData(event.currentTarget);
   const row:OpeningArLine={
    customerId:selected.id,legacyReference:value(contents,'ar-legacy'),scope:value(contents,'ar-scope'),
    chargedOn:value(contents,'ar-charged'),originalDueOn:value(contents,'ar-due'),
    originalCents:amount(value(contents,'ar-original')),remainingCents:amount(value(contents,'ar-remaining')),
    chargeEvidence:readEvidence(contents,'ar-charge'),taxEvidence:tax?readEvidence(contents,'ar-tax'):null,
    reductions:reductions.map(id=>({
     kind:value(contents,id+'-kind') as OpeningArReduction['kind'],appliedOn:value(contents,id+'-date'),
     amountCents:amount(value(contents,id+'-amount')),evidence:readEvidence(contents,id),
    })),
   };
   parseOpeningArInput({revision,lines:[...lines.map(line=>line.item),row]});
   setLines([...lines,{item:row,label:selected.label}]);setPreview(null);setMessage('Receivable added to this preview.');
   event.currentTarget.reset();setSelected(null);setTax(false);setReductions([]);
  }catch{setMessage('Review the evidence and amounts. Original charge less the listed payments and credits must equal the remaining amount.');}
 }
 function review(){
  const inputs=parseOpeningArInput({revision,lines:lines.map(line=>line.item)});
  void run(async signal=>{
   const context=await currentContext(signal);
   const result=await financeAccounts.reviewOpeningReceivables(context,inputs,signal);
   if(signal.aborted)return;
   if(!result||result.cutoverOn!==cutoverOn){setPreview(null);setMessage('The opening worksheet changed. Open its latest revision.');return;}
   setPreview(result);setMessage('Receivables preview ready.');
  },'Crest could not review this evidence. Check that charges, payments, and credits predate cutover and the customers remain available.');
 }

 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Preview customer balances owed</summary>
  <section aria-label="Opening receivables preview" aria-busy={busy}>
   <p>Review amounts customers still owed just before the {cutoverOn} cutover. Saving this schedule creates no invoices or ledger entries.</p>
   <p role="status">{message}</p>
   <button type="button" className="secondary" disabled={busy||!!pending} onClick={loadSaved}>Load saved receivables</button>
   {pending&&<div className={styles.openingGroup}>
    <button type="button" className="secondary" disabled={busy} onClick={()=>inspect(null)}>Check original receivables save</button>
    {mayClose&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(closeReason.trim()))inspect(closeReason.trim());}}>
     <label htmlFor="ar-close-reason">Reason for closing this receivables save</label>
     <input id="ar-close-reason" required maxLength={1000} value={closeReason} onChange={event=>setCloseReason(event.target.value)}/>
     <button type="submit" className="secondary" disabled={busy}>Close interrupted receivables save</button>
    </form>}
   </div>}
   <div hidden={!!pending}>
   {saved&&<details>
    <summary>Saved receivables revision {saved.revision} · ${dollars(saved.evidence.totals.remainingCents)} USD</summary>
    <p>{saved.evidence.reason}</p>
    <ul>{saved.evidence.lines.map(item=><li key={item.chargeEvidence.sha256+item.legacyReference}>
     <strong>{item.legacyReference}</strong> · ${dollars(item.remainingCents)} · Due {item.originalDueOn}
     <div>{item.scope}</div><div>{item.chargeEvidence.reference}</div>
     <div>{item.taxReview==='unknown'?'Original tax evidence unknown':'Original tax evidence recorded'}</div>
    </li>)}</ul>
    <button type="button" className="secondary" disabled={busy} onClick={downloadSaved}>Download saved receivables (JSON)</button>
   </details>}
   <form ref={search} onSubmit={find}>
    <label htmlFor="ar-customer">Customer name, phone or email</label>
    <input id="ar-customer" name="ar-customer" type="search" required maxLength={200} autoComplete="off"/>
    <button type="submit" className="secondary" disabled={busy}>Find customers</button>
   </form>
   <ul>{options.map(option=><li key={option.id}><button type="button" className="secondary" disabled={busy} onClick={()=>{
    setSelected(option);setOptions([]);setMessage('');
   }}>Use {option.label}</button></li>)}</ul>
   {selected&&<form ref={form} onSubmit={add}>
    <fieldset className={styles.openingGroup} disabled={busy}>
     <legend>Receivable for {selected.label}</legend>
     <Note name="ar-legacy" initial={undefined} label="Legacy invoice or charge reference"/>
     <Note name="ar-scope" initial={undefined} label="Original services covered"/>
     <label htmlFor="ar-charged">Original charge date</label><input id="ar-charged" name="ar-charged" type="date" required/>
     <label htmlFor="ar-due">Original due date</label><input id="ar-due" name="ar-due" type="date" required/>
     <DollarField name="ar-original" initial={undefined} label="Original charge (USD)"/>
     <DollarField name="ar-remaining" initial={undefined} label="Amount still owed at cutover (USD)"/>
     <fieldset className={styles.openingGroup}><legend>Original charge evidence</legend><EvidenceFields name="ar-charge"/></fieldset>
     <label htmlFor="ar-tax-status">Original tax evidence</label>
     <select id="ar-tax-status" value={tax?'documented':'unknown'} onChange={event=>setTax(event.target.value==='documented')}>
      <option value="unknown">Unknown</option><option value="documented">Document available</option>
     </select>
     {tax&&<fieldset className={styles.openingGroup}><legend>Tax evidence document</legend><EvidenceFields name="ar-tax"/></fieldset>}
     {reductions.map((id,index)=><fieldset className={styles.openingGroup} key={id}>
      <legend>Prior payment or credit {index+1}</legend>
      <label htmlFor={id+'-kind'}>Adjustment type</label><select id={id+'-kind'} name={id+'-kind'}><option value="payment">Payment</option><option value="credit">Credit</option></select>
      <label htmlFor={id+'-date'}>Date applied</label><input id={id+'-date'} name={id+'-date'} type="date" required/>
      <DollarField name={id+'-amount'} initial={undefined} label="Amount applied (USD)"/>
      <EvidenceFields name={id}/>
      <button type="button" className="secondary" onClick={()=>setReductions(reductions.filter(key=>key!==id))}>Remove adjustment {index+1}</button>
     </fieldset>)}
     <button type="button" className="secondary" disabled={reductions.length>=20}
      onClick={()=>setReductions([...reductions,'ar-adjustment-'+crypto.randomUUID()])}>Add prior payment or credit</button>
     <button type="submit" disabled={lines.length>=20}>Add receivable to preview</button>
    </fieldset>
   </form>}
   {lines.length>0&&<>
    <ul>{lines.map(({item,label},index)=><li key={item.chargeEvidence.sha256+item.legacyReference}>
     {label} · {item.legacyReference} · ${dollars(item.remainingCents)} · Due {item.originalDueOn}
     <button type="button" className="secondary" disabled={busy} onClick={()=>{
      setLines(lines.filter((_,position)=>position!==index));setPreview(null);
     }}>Remove receivable {index+1}</button>
    </li>)}</ul>
    <button type="button" disabled={busy} onClick={review}>Review opening receivables</button>
   </>}
   {preview&&<div><h3>Opening receivables preview</h3>
    <p>Total remaining · ${dollars(preview.totals.remainingCents)} USD</p>
    {preview.lines.some(row=>row.taxReview==='unknown')&&<p>Some original tax details are unknown.</p>}
    {saved===undefined?<p>Load saved receivables before saving this schedule.</p>:<form onSubmit={store}>
     {saved&&<p>Saving creates a complete replacement revision for this worksheet. Include every receivable that still belongs on the schedule.</p>}
     <label htmlFor="ar-save-reason">Reason for saving this schedule</label>
     <input id="ar-save-reason" required maxLength={1000} value={saveReason} onChange={event=>setSaveReason(event.target.value)}/>
     <button type="submit" disabled={busy}>Save receivables schedule</button>
    </form>}
   </div>}
   </div>
  </section>
 </details>;
}
