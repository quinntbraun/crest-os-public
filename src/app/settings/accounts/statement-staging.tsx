'use client';

import {useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {parseStatementDraft,parseStatementReference,statementDraftRowLimit} from '../../../bookkeeping/statement-staging-contract';
import type {StatementDraft,StatementReference} from '../../../bookkeeping/statement-staging-contract';
import {assessStatementRows} from '../../../bookkeeping/statement-reconciliation';
import type {MoneyChannel} from '../../../bookkeeping/finance-money-channel-contract';
import {financeAccounts} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {StatementMatchReview} from './statement-match-review';
import styles from './screen.module.css';

type Preview={reference:StatementReference;draft:StatementDraft};
type Receipt=Extract<Awaited<ReturnType<typeof financeAccounts.lookupStagedStatement>>,{state:'committed'}>['receipt'];
const storageKey=(id:string)=>'crest.statement-stage.original.v1.'+id;
const field=(form:FormData,name:string)=>String(form.get(name)??'').trim();
const sourceByteLimit=10_485_760;
const displayReference=(value:StatementReference)=>[value.operationId,value.recoveryEpoch,value.statementId].join('.');
const statementRows=(text:string)=>text===''?[]:text.split(/\r?\n/).map(line=>{
 const items=line.split(',');
 if(items.length!==2)throw Error('Enter each row as date, signed amount.');
 return {id:crypto.randomUUID(),statementOn:items[0]!.trim(),signedCents:cents(items[1]!.trim())};
});
function cents(input:string){
 const parts=/^(-?)(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(input);
 if(!parts)throw Error('Enter signed dollar amounts with up to two decimal places.');
 const amount=BigInt(parts[2]!)*100n+BigInt((parts[3]??'').padEnd(2,'0'));
 return String(parts[1]?-amount:amount);
}
function dollars(value:string){
 const amount=BigInt(value),absolute=amount<0n?-amount:amount;
 return (amount<0n?'−':'')+'$'+String(absolute/100n)+'.'+String(absolute%100n).padStart(2,'0');
}
async function eligibleChannels(context:FinanceAccountContext,signal:AbortSignal){
 const channels:MoneyChannel[]=[];
 let after:string|null=null;
 for(let pageNumber=0;pageNumber<20;pageNumber++){
  const page=await financeAccounts.moneyChannels(context,after,signal);
  channels.push(...page.rows.filter(row=>row.active&&row.ownershipScope==='dedicated_business'
   &&(row.kind==='bank'||row.kind==='wallet')&&row.ownershipEvidence!==null));
  if(!page.hasMore)return channels;
  after=page.rows.at(-1)!.channelId;
 }
 throw Error('STATEMENT_CHANNELS_LIMIT');
}

export function StatementStaging({context}:{context:FinanceAccountContext}){
 const [channels,setChannels]=useState<MoneyChannel[]|null>(null);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [saved,setSaved]=useState<{receipt:Receipt;reference:StatementReference}|null>(null);
 const [pending,setPending]=useState<StatementReference|null>(null);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [channelError,setChannelError]=useState(false);
 const request=useRef<AbortController|null>(null);
 const key=storageKey(context.businessId);
 useEffect(()=>{
  const controller=new AbortController();
  void eligibleChannels(context,controller.signal).then(value=>{
   if(!controller.signal.aborted){setChannels(value);setChannelError(false);}
  },()=>{
   if(!controller.signal.aborted)setChannelError(true);
  });
  queueMicrotask(()=>{
   if(controller.signal.aborted)return;
   try{
    const original=sessionStorage.getItem(key);
    if(original)setPending(parseStatementReference(JSON.parse(original)));
   }catch{setNotice('The original save reference could not be loaded.');}
  });
  return ()=>{controller.abort();request.current?.abort();};
 },[context,key]);

 async function review(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(request.current||pending||!context.recoveryEpoch||context.writeState!=='ready')return;
  const controller=new AbortController();request.current=controller;setBusy(true);
  setNotice('');setSaved(null);setPreview(null);
  const form=new FormData(event.currentTarget);
  try{
   const channel=channels?.find(row=>row.channelId===field(form,'channel'));
   const file=form.get('source');
   if(!channel||!(file instanceof File)||!file.size||file.size>sourceByteLimit){
    setNotice('Choose a dedicated account and a fictional source file of up to 10 MB.');return;
   }
   const fileSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),
    byte=>byte.toString(16).padStart(2,'0')).join('');
   const draft=parseStatementDraft({channelId:channel.channelId,channelVersion:channel.version,
    startsOn:field(form,'start'),endsOn:field(form,'end'),openingCents:cents(field(form,'opening')),
    closingCents:cents(field(form,'closing')),fileSha256,dateConvention:field(form,'convention'),
    completenessEvidence:field(form,'completeness'),rows:statementRows(field(form,'rows'))});
   if(controller.signal.aborted)return;
   setPreview({draft,reference:{operationId:crypto.randomUUID(),statementId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch}});
  }catch{
   if(!controller.signal.aborted)setNotice('Check the statement dates, amounts, source file and review notes.');
  }finally{
   request.current=null;if(!controller.signal.aborted)setBusy(false);
  }
 }
 function release(){
  sessionStorage.removeItem(key);setPending(null);
 }
 async function save(){
  if(request.current||!preview||context.writeState!=='ready'||context.recoveryEpoch!==preview.reference.recoveryEpoch)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setNotice('');
  const {reference,draft}=preview;
  try{
   sessionStorage.setItem(key,JSON.stringify(reference));
   setPending(reference);
   const result=await financeAccounts.stageStatement(context,reference,draft,controller.signal);
   if(controller.signal.aborted)return;
   if(result.state==='committed'){
    setSaved({receipt:result.receipt,reference});release();setPreview(null);
   }else if(result.state==='refused'){
    release();setPreview(null);
    setNotice(result.reason==='STATEMENT_IMPORT_FILE_ALREADY_RETAINED'?'This file checksum is already retained for the account.'
     :result.reason==='RECOVERY_REVIEW_REQUIRED'?'Writes are paused pending recovery review.'
     :'The statement could not be staged. Review the account, dates and evidence.');
   }else setNotice('Check the original save before submitting another statement.');
  }catch{
   if(!controller.signal.aborted)setNotice('The save could not be confirmed. Check the original save to see whether it was retained.');
  }finally{
   request.current=null;if(!controller.signal.aborted)setBusy(false);
  }
 }
 async function lookup(reference:StatementReference,checkingPending:boolean){
  if(request.current)return;
  const controller=new AbortController();request.current=controller;setBusy(true);setNotice('');setSaved(null);
  try{
   const result=await financeAccounts.lookupStagedStatement(context,reference,controller.signal);
   if(controller.signal.aborted)return;
   if(result.state==='committed'){
    setSaved({receipt:result.receipt,reference});
    if(checkingPending){release();setPreview(null);}
   }else if(result.state==='absent'){
    setNotice(checkingPending&&preview&&preview.reference.recoveryEpoch===context.recoveryEpoch
     ?'The original save was not found. You can retry the same reviewed statement.'
     :'The statement was not found for this reference.');
   }else setNotice('The original reference conflicts with a retained operation.');
  }catch{
   if(!controller.signal.aborted)setNotice('The original save could not be checked.');
  }finally{
   request.current=null;if(!controller.signal.aborted)setBusy(false);
  }
 }
 function lookupSaved(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const parts=field(new FormData(event.currentTarget),'reference').split('.');
  if(parts.length!==3){setNotice('Enter the complete statement save reference.');return;}
  try{
   const [operationId,recoveryEpoch,statementId]=parts;
   const reference=parseStatementReference({operationId,recoveryEpoch,statementId});
   void lookup(reference,false);
  }catch{setNotice('Enter the complete statement save reference.');}
 }
 const values=preview?assessStatementRows(preview.draft,preview.draft.rows):null;
 return <section aria-labelledby="statement-staging-heading">
  <h3 id="statement-staging-heading">Fictional bank statement staging</h3>
  <p>The app retains the rows you enter, the review notes and the file checksum. Keep the original file separately.
   Staging creates no ledger entries or reconciliation approval.</p>
  {channelError&&<p role="alert">Dedicated accounts could not be loaded.</p>}
  {channels?.length===0&&<p>No active dedicated bank or wallet account is available.</p>}
  {context.writeState!=='ready'&&<p>Statement staging is paused.</p>}
  {channels&&channels.length>0&&!pending&&!preview&&context.writeState==='ready'&&<form onSubmit={review} className={styles.openingGroup}>
   <label htmlFor="statement-channel">Dedicated money account</label>
   <select id="statement-channel" name="channel" required><option value="">Choose an account</option>
    {channels.map(channel=><option key={channel.channelId} value={channel.channelId}>{channel.label} ({channel.maskedSuffix})</option>)}
   </select>
   <label htmlFor="statement-source">Fictional source file for checksum</label>
   <input id="statement-source" name="source" type="file" required/>
   <label htmlFor="statement-start">Statement start date</label>
   <input id="statement-start" name="start" type="date" required/>
   <label htmlFor="statement-end">Statement end date</label>
   <input id="statement-end" name="end" type="date" required/>
   <label htmlFor="statement-opening">Opening balance (USD)</label>
   <input id="statement-opening" name="opening" inputMode="decimal" maxLength={21} required/>
   <label htmlFor="statement-closing">Closing balance (USD)</label>
   <input id="statement-closing" name="closing" inputMode="decimal" maxLength={21} required/>
   <label htmlFor="statement-convention">Provider statement date convention</label>
   <input id="statement-convention" name="convention" maxLength={1000} required/>
   <label htmlFor="statement-completeness">Completeness review</label>
   <input id="statement-completeness" name="completeness" maxLength={1000} required/>
   <label htmlFor="statement-rows">Statement rows</label>
   <p id="statement-rows-help">Enter up to {statementDraftRowLimit} rows, one date and signed dollar amount per line, such as
    {' '}<code>2026-01-30, -12.50</code>. For a statement with no activity, leave the rows empty.</p>
   <textarea id="statement-rows" name="rows" aria-describedby="statement-rows-help" rows={5} maxLength={10000}/>
   <button type="submit" disabled={busy}>Review statement</button>
  </form>}
  {preview&&values&&<div className={styles.openingGroup}>
   <p>{preview.draft.rows.length} rows for {preview.draft.startsOn} through {preview.draft.endsOn}.</p>
   <p>Opening balance {dollars(preview.draft.openingCents)}. Closing balance {dollars(preview.draft.closingCents)}.</p>
   <p>Signed row total {dollars(String(values.rowTotal))}. Statement difference {dollars(String(values.difference))}.</p>
   <p>File checksum <code>{preview.draft.fileSha256}</code></p>
   {preview.draft.rows.length>0&&<details><summary>Review entered rows</summary>
    <ul>{preview.draft.rows.map(row=><li key={row.id}>{row.statementOn} {dollars(row.signedCents)}</li>)}</ul>
   </details>}
   <button type="button" disabled={busy||context.writeState!=='ready'||context.recoveryEpoch!==preview.reference.recoveryEpoch}
    onClick={()=>void save()}>{pending?'Retry original save':'Stage reviewed statement'}</button>
   {!pending&&<button type="button" className="secondary" disabled={busy} onClick={()=>setPreview(null)}>Discard review</button>}
  </div>}
  {pending&&<div className={styles.openingGroup}>
   <p>Save reference <code>{displayReference(pending)}</code></p>
   <button type="button" className="secondary" disabled={busy} onClick={()=>void lookup(pending,true)}>Check original save</button>
  </div>}
  {!pending&&!preview&&<details>
   <summary>Check a saved statement</summary>
   <form className={styles.openingGroup} onSubmit={lookupSaved}>
    <label htmlFor="statement-save-reference">Statement save reference</label>
    <input id="statement-save-reference" name="reference" required minLength={110} maxLength={110} spellCheck={false} autoCapitalize="none"/>
    <button type="submit" className="secondary" disabled={busy}>Check saved statement</button>
   </form>
  </details>}
  {notice&&<p role="status">{notice}</p>}
  {saved&&<div role="status" className={styles.openingGroup}>
   <p>Statement staged. {saved.receipt.rowCount} rows retained with a statement difference of {dollars(saved.receipt.statementDifferenceCents)}.</p>
   <p>Statement dates {saved.receipt.startsOn} through {saved.receipt.endsOn}.</p>
   <p>File checksum <code>{saved.receipt.fileSha256}</code></p>
   <p>Save reference <code>{displayReference(saved.reference)}</code></p>
  </div>}
  {saved&&context.statementMatchReview&&<StatementMatchReview key={saved.reference.statementId} context={context}
   statementId={saved.reference.statementId} format={dollars} parse={cents}/>}
 </section>;
}
