'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent,ReactNode} from 'react';
import {openingControls,parseOpeningDraft,parseOpeningReference} from '../../../bookkeeping/opening-worksheet-contract';
import type {OpeningBank,OpeningBankOption,OpeningControl,OpeningDocument,OpeningDraft,OpeningProjection,OpeningReference,OpeningTiming} from '../../../bookkeeping/opening-worksheet-contract';
import {financeAccounts} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {financeAccountReviewReason} from '../../../bookkeeping/finance-account-contract';
import styles from './screen.module.css';

type ControlKey=keyof typeof openingControls;
const pendingKey=(businessId:string)=>'crest.opening-worksheet.original.v1.'+businessId;
const value=(form:FormData,name:string)=>String(form.get(name)??'').trim();

function amount(input:string){
 const parts=/^(-?)(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,2}))?$/.exec(input);
 if(!parts)throw Error('Enter dollar amounts with up to two decimal places.');
 const absolute=BigInt(parts[2]!)*100n+BigInt((parts[3]??'').padEnd(2,'0'));
 return (parts[1]?-absolute:absolute).toString();
}
function dollars(value:string|null){
 if(value===null)return '';
 const cents=BigInt(value),absolute=cents<0n?-cents:cents;
 return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
function readEvidence(form:FormData,name:string):OpeningDocument{
 return {reference:value(form,`${name}-reference`),sha256:value(form,`${name}-sha256`).toLowerCase()};
}
function EvidenceFields({name,initial}:{name:string;initial?:OpeningDocument|null|undefined}){
 return <>
  <label htmlFor={`${name}-reference`}>Document reference</label>
  <input id={`${name}-reference`} name={`${name}-reference`} required maxLength={200} defaultValue={initial?.reference}/>
  <label htmlFor={`${name}-sha256`}>Document SHA-256 checksum</label>
  <input id={`${name}-sha256`} name={`${name}-sha256`} required minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}"
   autoCapitalize="none" spellCheck={false} defaultValue={initial?.sha256}/>
 </>;
}
function Note({name,initial,label}:{name:string;initial:string|undefined;label:string}){
 return <>
  <label htmlFor={name}>{label}</label>
  <input id={name} name={name} required maxLength={1000} defaultValue={initial}/>
 </>;
}
function DollarField({name,label,initial}:{name:string;label:string;initial:string|null|undefined}){
 return <>
  <label htmlFor={name}>{label}</label>
  <input id={name} name={name} required inputMode="decimal" maxLength={20} defaultValue={dollars(initial??null)}/>
 </>;
}
function EvidenceGroup({label,initialState,states,id,children}:{label:string;initialState:string;states:Record<string,string>;
 id:string;children:(verified:boolean)=>ReactNode}){
 const [state,setState]=useState(initialState);
 return <fieldset className={styles.openingGroup}>
  <legend>{label}</legend>
  <label htmlFor={`${id}-state`}>Review status</label>
  <select id={`${id}-state`} name={`${id}-state`} value={state} onChange={event=>setState(event.target.value)}>
   {Object.entries(states).map(([key,text])=><option key={key} value={key}>{text}</option>)}
  </select>
  {children(state!=='unknown')}
 </fieldset>;
}
function BankFields({option,initial}:{option:OpeningBankOption;initial:OpeningBank|undefined}){
 const id=`bank-${option.channelId}`;
 const [rows,setRows]=useState<{id:string;item:OpeningTiming|undefined}[]>(()=>initial?.timing.map((item,index)=>({id:String(index),item}))??[]);
 return <EvidenceGroup id={id} label={`${option.label} (ending ${option.maskedSuffix})`} initialState={initial?.state??'unknown'}
  states={{unknown:'Unknown',verified:'Verified amount',verified_zero:'Verified zero'}}>
  {verified=><>
   <Note name={`${id}-note`} initial={initial?.note} label="Bank review note"/>
   {verified&&<>
    <DollarField name={`${id}-statement`} label="Statement balance (USD)" initial={initial?.statementCents}/>
    <DollarField name={`${id}-book`} label="Book balance (USD)" initial={initial?.bookCents}/>
    <EvidenceFields name={id} initial={initial?.evidence}/>
    <p>Record each outstanding item that explains the difference between the statement and book balances.</p>
    {rows.map((row,index)=><fieldset className={styles.openingGroup} key={row.id}>
     <legend>Outstanding item {index+1}</legend>
     <input type="hidden" name={`${id}-timing`} value={row.id}/>
     <DollarField name={`${id}-item-${row.id}-cents`} label="Adjustment to statement balance (USD)" initial={row.item?.cents}/>
     <EvidenceFields name={`${id}-item-${row.id}`} initial={row.item}/>
     <button type="button" className="secondary" onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}>Remove outstanding item {index+1}</button>
    </fieldset>)}
    <button type="button" className="secondary" disabled={rows.length>=40}
     onClick={()=>setRows(current=>[...current,{id:crypto.randomUUID(),item:undefined}])}>Add outstanding item</button>
   </>}
  </>}
 </EvidenceGroup>;
}
function readBank(form:FormData,option:OpeningBankOption):OpeningBank{
 const {channelId,channelVersion}=option,id=`bank-${channelId}`;
 const state=value(form,`${id}-state`) as OpeningBank['state'];
 const timing:OpeningTiming[]=form.getAll(`${id}-timing`).map(key=>{
  const name=`${id}-item-${String(key)}`;
  return {...readEvidence(form,name),cents:amount(value(form,`${name}-cents`))};
 });
 return {channelId,channelVersion,state,note:value(form,`${id}-note`),timing,
  statementCents:state==='unknown'?null:amount(value(form,`${id}-statement`)),
  bookCents:state==='unknown'?null:amount(value(form,`${id}-book`)),evidence:state==='unknown'?null:readEvidence(form,id)};
}
function readDraft(form:FormData,projection:OpeningProjection):OpeningDraft{
 const controls=Object.keys(openingControls).map(key=>{
  const state=value(form,`${key}-state`) as OpeningControl['state'];
  return [key,{state,note:value(form,`${key}-note`),evidence:state==='unknown'?null:readEvidence(form,key)}];
 });
 return parseOpeningDraft({cutoverOn:projection.cutoverOn,cutoverAt:projection.cutoverAt,source:readEvidence(form,'opening-source'),
  equityBasis:value(form,'opening-equity'),banks:projection.banks.map(option=>readBank(form,option)),controls:Object.fromEntries(controls)});
}

export function OpeningWorksheet({businessId}:{businessId:string}){
 const [projection,setProjection]=useState<OpeningProjection|null>(null),[date,setDate]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<OpeningReference|null>(null);
 const [mayClose,setMayClose]=useState(false),[reason,setReason]=useState('');
 const request=useRef<AbortController|null>(null);

 function clear(){
  request.current?.abort();request.current=null;
  setProjection(null);setDate('');setBusy(false);setMessage('');setPending(null);setMayClose(false);setReason('');
 }
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return ()=>{
   request.current?.abort();
   document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);
  };
 },[]);

 async function run(action:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
  if(request.current)return;
  const controller=new AbortController(),{signal}=controller;
  request.current=controller;setBusy(true);setMessage('');
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(context.businessId!==businessId||!context.openingWorksheet||!context.recoveryEpoch){
    setProjection(null);setMessage('Opening worksheet access is paused.');return;
   }
   await action(context,signal);
  }catch{if(!signal.aborted)setMessage(failure);}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 }
 function setView(view:OpeningProjection){setProjection(view);setDate(view.cutoverOn??'');}
 function readPending(){
  const stored=sessionStorage.getItem(pendingKey(businessId));
  return stored===null?null:parseOpeningReference(JSON.parse(stored));
 }
 function clearPending(){sessionStorage.removeItem(pendingKey(businessId));setPending(null);setMayClose(false);setReason('');}
 function load(requestedOn:string|null){
  void run(async(context,signal)=>{
   const original=readPending();
   if(original){setPending(original);setMessage('Check the interrupted save before editing this worksheet.');return;}
   const next=await financeAccounts.readOpeningWorksheet(context,requestedOn,signal);
   if(!signal.aborted)setView(next);
  },'Crest could not load the opening worksheet. Check your sign-in and try again.');
 }
 function inspect(closeReason:string|null){
  if(!pending)return;
  void run(async(context,signal)=>{
   const result=await financeAccounts.resolveOpeningWorksheet(context,pending,closeReason,signal);
   if(signal.aborted)return;
   if(result.state==='committed'||result.state==='retired'){
    clearPending();
    const saved=await financeAccounts.readOpeningWorksheet(context,null,signal);
    if(!signal.aborted){setView(saved);setMessage(result.state==='committed'?'The original worksheet save was confirmed.':'The interrupted save was closed.');}
   }else if(result.state==='absent'||result.state==='review_required'){
    setMayClose(true);setMessage('Crest found no saved worksheet for this attempt. Review and close it before starting a new edit.');
   }else setMessage('Crest could not match this save. Keep the original reference for review.');
  },'Crest could not check the original save. Keep its reference and try again.');
 }
 function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!projection||pending)return;
  let draft:OpeningDraft;
  try{draft=readDraft(new FormData(event.currentTarget),projection);}
  catch{setMessage('Review each evidence field and make sure the statement balance plus outstanding items equals the book balance.');return;}
  void run(async(context,signal)=>{
   const original=readPending();
   if(original){setPending(original);setMessage('Check the interrupted save before editing this worksheet.');return;}
   if(!context.recoveryEpoch)return;
   const reference={operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch};
   sessionStorage.setItem(pendingKey(businessId),JSON.stringify(reference));setPending(reference);
   const result=await financeAccounts.saveOpeningWorksheet(context,reference,projection.worksheet?.revision??'0',draft,signal);
   if(signal.aborted)return;
   if(result.state==='committed'){
    clearPending();
    const saved=await financeAccounts.readOpeningWorksheet(context,null,signal);
    if(!signal.aborted){setView(saved);setMessage(`Opening worksheet revision ${result.receipt.revision} saved.`);}
   }else if(result.state==='revision_conflict'||result.state==='invalid'){
    clearPending();
    if(result.state==='revision_conflict'){setProjection(null);setMessage('Someone saved a newer revision. Load it before editing.');}
    else setMessage('Crest could not verify this evidence against the cutover date and saved money channels.');
   }else setMessage('Inspect the original save before continuing.');
  },'Crest could not confirm the save. Check the original save before editing again.');
 }

 function download(){
  void run(async(context,signal)=>{
   const saved=await financeAccounts.readOpeningWorksheet(context,null,signal);
   if(signal.aborted)return;
   if(!saved.worksheet){setMessage('Save an opening worksheet before downloading it.');return;}
   const contents=JSON.stringify({scope:'saved_opening_worksheet_revision',worksheet:saved.worksheet},null,2)+'\n';
   const url=URL.createObjectURL(new Blob([contents],{type:'application/json;charset=utf-8'}));
   const link=document.createElement('a');
   link.href=url;link.download=`crest-opening-worksheet-revision-${saved.worksheet.revision}.json`;
   try{document.body.append(link);link.click();}
   finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   setMessage('Download requested. Check your browser’s downloads.');
  },'Crest could not verify access to the saved worksheet.');
 }

 const latest=projection?.worksheet;
 const sameBoundary=latest?.cutoverOn===projection?.cutoverOn&&latest?.cutoverAt===projection?.cutoverAt?latest:null;
 return <details onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Opening worksheet</summary>
  <section aria-label="Fictional opening worksheet" aria-busy={busy}>
   <p>Record the fictional balances and evidence for a proposed cutover. Saving this worksheet has no effect on the ledger.</p>
   <button type="button" className="secondary" disabled={busy||!!pending} onClick={()=>load(null)}>Load opening worksheet</button>
   <p role="status">{message}</p>
   {pending&&<div className={styles.openingGroup}>
    <button type="button" className="secondary" disabled={busy} onClick={()=>inspect(null)}>Check original worksheet save</button>
    {mayClose&&<form onSubmit={event=>{event.preventDefault();if(financeAccountReviewReason(reason.trim()))inspect(reason.trim());}}>
     <label htmlFor="opening-close-reason">Reason for closing this save</label>
     <input id="opening-close-reason" required maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/>
     <button type="submit" className="secondary" disabled={busy}>Close interrupted save</button>
    </form>}
   </div>}
   {projection&&<div hidden={!!pending}>
    {latest&&<div className={styles.openingGroup}>
     <h3>Saved revision {latest.revision}</h3>
     <p>{latest.state==='incomplete'?'Some opening balances are still unknown.':'The supported worksheet balances have evidence.'}</p>
     <dl>
      <dt>Verified bank amount</dt><dd>{dollars(latest.bankNetCents)} USD</dd>
      <dt>Provisional opening equity</dt><dd>{dollars(latest.provisionalEquityCents)} USD</dd>
     </dl>
     <button type="button" className="secondary" disabled={busy} onClick={download}>Download saved worksheet (JSON)</button>
    </div>}
    <form onSubmit={event=>{event.preventDefault();load(date);}}>
     <label htmlFor="opening-cutover">Proposed local cutover date ({projection.timeZone})</label>
     <input id="opening-cutover" required type="date" value={date} onChange={event=>setDate(event.target.value)}/>
     <button type="submit" className="secondary" disabled={busy}>Check cutover date and bank accounts</button>
    </form>
    {projection.cutoverOn&&projection.cutoverOn===date&&<form key={`${latest?.revision??'0'}:${projection.cutoverOn}`} onSubmit={save}>
     <fieldset className={styles.openingGroup} disabled={busy}>
      <legend>Opening evidence</legend>
      <p>Cutover at local midnight, {projection.cutoverAt}.</p>
      <EvidenceFields name="opening-source" initial={sameBoundary?.source}/>
      <Note name="opening-equity" initial={sameBoundary?.equityBasis} label="Basis for provisional opening equity"/>
      <h3>Business bank accounts</h3>
      {projection.banks.length===0&&<p>No dedicated bank channels are set up for this date.</p>}
      {projection.banks.map(option=><BankFields key={`${option.channelId}:${option.channelVersion}`} option={option}
       initial={sameBoundary?.banks.find(row=>row.channelId===option.channelId&&row.channelVersion===option.channelVersion)}/>) }
      <h3>Other balances</h3>
      <p>Record unknown balances or document where a balance is zero or does not apply. Itemized amounts for these balances need a separate review.</p>
      {(Object.keys(openingControls) as ControlKey[]).map(key=>{
       const initial=sameBoundary?.controls[key];
       return <EvidenceGroup key={key} id={key} label={openingControls[key]} initialState={initial?.state??'unknown'}
        states={{unknown:'Unknown',verified_zero:'Verified zero',not_applicable:'Does not apply'}}>
        {verified=><>
         <Note name={`${key}-note`} initial={initial?.note} label="Review note"/>
         {verified&&<EvidenceFields name={key} initial={initial?.evidence}/>}
        </>}
       </EvidenceGroup>;
      })}
      <button type="submit">Save opening worksheet</button>
     </fieldset>
    </form>}
   </div>}
  </section>
 </details>;
}
