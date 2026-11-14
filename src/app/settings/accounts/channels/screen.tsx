'use client';

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError} from '../../../../client/authentication';
import {
 clearPendingMoneyChannel,downloadFinanceHistory,financeAccounts,readPendingMoneyChannel,retainPendingMoneyChannel,
} from '../../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../../client/finance-accounts';
import {financeAccountReviewReason,requireFinanceAccount as check} from '../../../../bookkeeping/finance-account-contract';
import {
 moneyChannelCents,moneyChannelKinds,moneyChannelOpeningStates,moneyChannelScopes,parseMoneyChannelDraft,
} from '../../../../bookkeeping/finance-money-channel-contract';
import type {MoneyChannel} from '../../../../bookkeeping/finance-money-channel-contract';
import {MoneyChannelEditor} from './editor';
import type {ChannelEditorFields} from './editor';
import styles from '../screen.module.css';

type Page=Awaited<ReturnType<typeof financeAccounts.moneyChannels>>;
type History=Awaited<ReturnType<typeof financeAccounts.moneyChannelHistory>>;
type Choices=Awaited<ReturnType<typeof financeAccounts.moneyChannelAccounts>>;
type RecordRow=Page['rows'][number];
type Pending=NonNullable<ReturnType<typeof readPendingMoneyChannel>>;
type Workspace={context:FinanceAccountContext;page:Page};
type Editor={record:RecordRow|null;fields:ChannelEditorFields};
const initialMessage='Load saved money channels.';
const subscribeToHydration=()=>()=>undefined;
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(value:string)=>dateFormat.format(new Date(value+'T00:00:00Z'));
const blank:ChannelEditorFields={kind:'',scope:'',accountId:'',provider:'',suffix:'',label:'',date:'',ownership:'',
 openingState:'unknown',openingOn:'',openingAmount:'',openingEvidence:'',active:true,reason:''};

function dollars(cents:string,formatted=false){
 const signed=BigInt(cents),amount=signed<0n?-signed:signed,whole=amount/100n;
 return (signed<0n?'-':'')+(formatted?'$':'')+(formatted?whole.toLocaleString('en-US'):whole.toString())
  +'.'+(amount%100n).toString().padStart(2,'0');
}
function cents(input:string){
 const match=/^(-?)(0|[1-9][0-9]{0,16})(?:\.([0-9]{1,2}))?$/.exec(input.trim());
 if(!match)return null;
 const value=(BigInt(match[2]!)*100n+BigInt((match[3]??'').padEnd(2,'0')))*(match[1]==='-'?-1n:1n);
 return moneyChannelCents(value.toString())?value.toString():null;
}
function fromRecord(record:RecordRow):ChannelEditorFields{
 return {kind:record.kind,scope:record.ownershipScope,accountId:record.accountId,provider:record.providerNamespace??'',
  suffix:record.maskedSuffix??'',label:record.label,date:'',ownership:record.ownershipEvidence??'',openingState:record.openingState,
  openingOn:record.openingOn??'',openingAmount:record.openingCents===null?'':dollars(record.openingCents),
  openingEvidence:record.openingEvidence??'',active:record.active,reason:''};
}
function prepareDraft(editor:Editor,choices:Choices|null){
 const {fields,record}=editor,external=fields.kind==='bank'||fields.kind==='wallet',known=fields.openingState!=='unknown';
 if(record&&fields.date<=record.effectiveFrom)return null;
 if(!record&&!choices?.rows.some(account=>account.id===fields.accountId))return null;
 const amount=fields.openingState==='verified_zero'?'0':known?cents(fields.openingAmount):null;
 if(fields.scope!=='dedicated_business'&&amount?.startsWith('-'))return null;
 try{
  return parseMoneyChannelDraft({
   identity:record?null:{accountId:fields.accountId,kind:fields.kind,ownershipScope:fields.scope,
    providerNamespace:external?fields.provider.trim().toLowerCase():null,maskedSuffix:external?fields.suffix.trim().toUpperCase():null},
   label:fields.label.trim(),effectiveFrom:fields.date,ownershipEvidence:fields.ownership.trim()||null,
   openingState:fields.openingState,openingOn:known?fields.openingOn:null,openingCents:amount,
   openingEvidence:known?fields.openingEvidence.trim():null,active:fields.active,reason:fields.reason.trim(),
  },record?.version??'0');
 }catch{return null;}
}
function description(row:MoneyChannel){
 return moneyChannelKinds[row.kind]+' · '+moneyChannelScopes[row.ownershipScope]
  +(row.providerNamespace&&row.maskedSuffix?' · '+row.providerNamespace+' •••• '+row.maskedSuffix:'');
}

export function MoneyChannelsScreen(){
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[editor,setEditor]=useState<Editor|null>(null);
 const [choices,setChoices]=useState<Choices|null>(null),[history,setHistory]=useState<{record:RecordRow;page:History}|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[canClose,setCanClose]=useState(false),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false),[message,setMessage]=useState(initialMessage);
 const mounted=useSyncExternalStore(subscribeToHydration,()=>true,()=>false),disabled=!mounted||busy;
 const controller=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const draft=editor?prepareDraft(editor,choices):null;
 const clearPrivate=useCallback(()=>{
  controller.current?.abort();controller.current=null;setWorkspace(null);setEditor(null);setChoices(null);setHistory(null);
  setPending(null);setCanClose(false);setReason('');setBusy(false);setSignedOut(false);setMessage(initialMessage);
 },[]);
 useEffect(()=>{
  const hide=()=>{if(document.visibilityState==='hidden')clearPrivate();};
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)clearPrivate();};
  document.addEventListener('visibilitychange',hide);
  window.addEventListener('pagehide',clearPrivate);window.addEventListener('pageshow',restore);
  return()=>{
   controller.current?.abort();controller.current=null;
   document.removeEventListener('visibilitychange',hide);
   window.removeEventListener('pagehide',clearPrivate);window.removeEventListener('pageshow',restore);
  };
 },[clearPrivate]);

 async function run(work:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
  if(controller.current||!mounted)return;
  const active=new AbortController(),signal=active.signal;
  controller.current=active;setBusy(true);setSignedOut(false);
  try{
   const context=await financeAccounts.context(signal);
   if(signal.aborted)return;
   if(!context.moneyChannels){clearPrivate();setMessage('Money channels are unavailable in this workspace.');return;}
   await work(context,signal);
  }catch(error){
   if(signal.aborted)return;
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   if(denied){clearPrivate();setSignedOut(true);}
   setMessage(denied?'Sign in again to review money channels.':failure);
  }finally{
   if(controller.current===active){controller.current=null;setBusy(false);status.current?.focus();}
  }
 }
 async function refresh(context:FinanceAccountContext,signal:AbortSignal){
  const page=await financeAccounts.moneyChannels(context,null,signal);
  if(!signal.aborted)setWorkspace({context,page});
 }
 async function finish(context:FinanceAccountContext,entry:Pending,signal:AbortSignal,result:string){
  check(!signal.aborted);clearPendingMoneyChannel(entry);setPending(null);setCanClose(false);setReason('');
  setWorkspace(null);setHistory(null);setMessage(result);
  try{await refresh(context,signal);}catch{if(!signal.aborted)setMessage(result+' Reload channels to view the latest records.');}
 }
 async function lookup(context:FinanceAccountContext,entry:Pending,signal:AbortSignal){
  check(context.businessId===entry.businessId);
  setPending(entry);setCanClose(false);setReason('');setEditor(null);setChoices(null);setHistory(null);setWorkspace(null);
  const decision=await financeAccounts.moneyChannelOperation(context,entry.reference,signal);
  if(signal.aborted)return;
  if(decision.state==='committed'||decision.state==='retired'){
   await finish(context,entry,signal,decision.state==='committed'?'The original channel review was confirmed.':
    'The interrupted channel review was closed.');return;
  }
  if(decision.state==='conflict'){setMessage('The saved outcome does not match this reference. Keep it for review.');return;}
  setCanClose(context.writeState==='ready');
  setMessage(context.writeState==='ready'?'No completed review was found. Close this attempt before starting another.':
   'No completed review was found. Review is paused for recovery.');
 }
 function load(reviewOnly=false){
  void run(async(context,signal)=>{
   setMessage(reviewOnly?'Checking the interrupted save…':'Loading saved channels…');
   const entry=readPendingMoneyChannel();
   if(entry){await lookup(context,entry,signal);return;}
   if(reviewOnly){setMessage('There is no interrupted channel review in this tab.');return;}
   setHistory(null);setWorkspace(null);
   await refresh(context,signal);if(!signal.aborted)setMessage('Saved money channels loaded.');
  },'Crest could not verify the saved records. Try again.');
 }
 function moreChannels(){
  if(!workspace?.page.hasMore)return;
  const previous=workspace.page;
  void run(async(context,signal)=>{
   check(context.businessId===workspace.context.businessId);
   const page=await financeAccounts.moneyChannels(context,previous.rows.at(-1)!.channelId,signal);
   if(!signal.aborted)setWorkspace({context,page:{rows:[...previous.rows,...page.rows],hasMore:page.hasMore}});
  },'More channels could not be loaded. Try again.');
 }
 function openEditor(record:RecordRow|null){
  setHistory(null);setChoices(null);setEditor({record,fields:record?fromRecord(record):blank});
  setMessage(record?'Enter the effective date and reason for your review.':'Choose a channel type and ownership.');
 }
 function change(fields:Partial<ChannelEditorFields>){
  if(fields.kind!==undefined||fields.scope!==undefined)setChoices(null);
  setEditor(value=>value?{...value,fields:{...value.fields,...fields}}:null);
 }
 function findAccounts(more:boolean){
  if(!editor||editor.record||!editor.fields.kind||!editor.fields.scope||!workspace)return;
  const {kind,scope}=editor.fields,previous=more?choices:null;
  void run(async(context,signal)=>{
   check(context.businessId===workspace.context.businessId);
   const page=await financeAccounts.moneyChannelAccounts(context,kind,scope,previous?.rows.at(-1)?.code??null,signal);
   if(signal.aborted)return;
   const rows=[...(previous?.rows??[]),...page.rows];
   check(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.code)).size===rows.length);
   if(!previous)change({accountId:''});
   setChoices({...page,rows});setMessage(rows.length?'Choose the linked account.':'No eligible account found.');
  },'Eligible accounts could not be loaded. Try again.');
 }
 function save(event:FormEvent){
  event.preventDefault();
  if(!draft||!workspace||!editor||pending)return;
  const {record}=editor;
  void run(async(context,signal)=>{
   if(context.writeState!=='ready'||!context.recoveryEpoch||context.businessId!==workspace.context.businessId
    ||context.binding!==workspace.context.binding||context.recoveryEpoch!==workspace.context.recoveryEpoch){
    setEditor(null);setChoices(null);setWorkspace(null);setMessage('The workspace changed. Reload channels before saving.');return;
   }
   let entry:Pending;
   try{entry=retainPendingMoneyChannel(context,{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,
    channelId:record?.channelId??crypto.randomUUID(),expectedVersion:record?.version??'0'});}
   catch{setMessage('Crest could not retain a recovery reference. The review was not sent.');return;}
   setPending(entry);setEditor(null);setChoices(null);setWorkspace(null);setMessage('Saving channel review…');
   const result=await financeAccounts.saveMoneyChannel(context,entry.reference,draft,signal);
   if(signal.aborted)return;
   if(result.state==='committed'){await finish(context,entry,signal,'Channel review saved.');return;}
   const signIn=result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED';
   setSignedOut(signIn);setMessage(signIn?'Sign in again, then check the original review.':
    'The channel review could not be confirmed. Check its status before another change.');
  },'The channel review could not be confirmed. Check its status before another change.');
 }
 function closeAttempt(event:FormEvent){
  event.preventDefault();
  const text=reason.trim();
  if(!pending||!canClose||!financeAccountReviewReason(text))return;
  void run(async(context,signal)=>{
   check(context.businessId===pending.businessId&&JSON.stringify(readPendingMoneyChannel())===JSON.stringify(pending));
   setCanClose(false);setReason('');setMessage('Closing the interrupted review…');
   const result=await financeAccounts.retireMoneyChannelOperation(context,pending.reference,text,signal);
   if(signal.aborted)return;
   if(result.state==='committed'||result.state==='retired'){
    await finish(context,pending,signal,result.state==='committed'?'The original channel review was confirmed.':
     'The interrupted channel review was closed.');return;
   }
   if(result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED')setSignedOut(true);
   setMessage('The attempt could not be closed. Check its status again.');
  },'The closure could not be confirmed. Check the review status again.');
 }
 function loadHistory(record:RecordRow,more=false){
  const previous=more?history?.page:null;
  if(!more)setHistory(null);
  void run(async(context,signal)=>{
   check(context.businessId===record.businessId);
   const result=await financeAccounts.moneyChannelHistory(context,record.channelId,previous?.rows.at(-1)?.version??null,signal);
   if(signal.aborted)return;
   setHistory({record,page:{rows:[...(previous?.rows??[]),...result.rows],hasMore:result.hasMore}});
   setMessage(result.rows.length?'Saved channel history loaded.':'No channel reviews found.');
  },'Channel history could not be verified. Try again.');
 }
 function download(){
  if(!history?.page.rows.length||controller.current)return;
  downloadFinanceHistory('crest-money-channel-history.csv',[
   ['Channel','Version','Effective from','Type','Ownership','Account code','Provider','Masked suffix','Status','Ownership evidence',
    'Opening state','Opening date','Opening cents','Opening evidence','Reason','Audit event'],
   ...history.page.rows.map(row=>[row.label,row.version,row.effectiveFrom,moneyChannelKinds[row.kind],moneyChannelScopes[row.ownershipScope],
    history.record.accountCode,row.providerNamespace??'',row.maskedSuffix??'',row.active?'Open':'Closed',row.ownershipEvidence??'',
    moneyChannelOpeningStates[row.openingState],row.openingOn??'',row.openingCents??'',row.openingEvidence??'',row.reason,row.auditEventId])
  ]);
 }

 return <section className={styles.workspace} aria-label="Money channel reviews" aria-busy={busy}>
  <p role="status" tabIndex={-1} ref={status}>{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  {!editor&&!pending&&<div className={styles.actions}>
   <button type="button" disabled={disabled} onClick={()=>load()}>{workspace?'Reload channels':'Load channels'}</button>
   <button type="button" className="secondary" disabled={disabled} onClick={()=>load(true)}>Check interrupted review</button>
   {workspace?.context.writeState==='ready'&&<button type="button" className="secondary" disabled={disabled}
    onClick={()=>openEditor(null)}>Add channel</button>}
  </div>}
  {workspace&&!editor&&!pending&&<>
   {!workspace.page.rows.length&&<p>No money channels have been saved.</p>}
   <ul className="service-list">{workspace.page.rows.map(row=><li key={row.channelId}>
    <strong>{row.label}</strong>
    <p>{description(row)} · Account {row.accountCode}</p>
    <p>Latest review · {row.active?'Open':'Closed'} from <time dateTime={row.effectiveFrom}>{dateLabel(row.effectiveFrom)}</time></p>
    <p>{moneyChannelOpeningStates[row.openingState]}{row.openingCents===null?'':' · '+dollars(row.openingCents,true)}</p>
    <div className={styles.actions}>
     <button type="button" className="secondary" disabled={disabled} onClick={()=>loadHistory(row)}>View history</button>
     {workspace.context.writeState==='ready'&&<button type="button" className="secondary" disabled={disabled}
      onClick={()=>openEditor(row)}>Edit review</button>}
    </div>
   </li>)}</ul>
   {workspace.page.hasMore&&<button type="button" className="secondary" disabled={disabled} onClick={moreChannels}>More channels</button>}
  </>}
  {editor&&<MoneyChannelEditor record={editor.record} fields={editor.fields} choices={choices} busy={disabled} canSave={draft!==null}
   change={change} findAccounts={findAccounts} save={save} cancel={()=>{setEditor(null);setChoices(null);status.current?.focus();}}/>}
  {pending&&<div className={styles.actions}>
   <button type="button" className="secondary" disabled={disabled} onClick={()=>load(true)}>Check interrupted review</button>
  </div>}
  {pending&&canClose&&<form onSubmit={closeAttempt}>
   <label htmlFor="channel-close-reason">Reason to close this attempt</label>
   <textarea id="channel-close-reason" rows={2} maxLength={1000} required disabled={disabled} value={reason}
    onChange={event=>setReason(event.target.value)}/>
   <button type="submit" disabled={disabled||!financeAccountReviewReason(reason.trim())}>Close interrupted review</button>
  </form>}
  {!!history?.page.rows.length&&<section aria-label="Saved channel history">
   <h2>{history.record.label} history</h2>
   <div className={styles.actions}><button type="button" className="secondary" disabled={disabled} onClick={download}>Download loaded history (CSV)</button></div>
   <ol className="service-list">{history.page.rows.map(row=><li key={row.version}>
    <strong>Version {row.version} · {row.active?'Open':'Closed'}</strong>
    <p>Effective {row.effectiveFrom} · {moneyChannelOpeningStates[row.openingState]}
     {row.openingCents===null?'':' · '+dollars(row.openingCents,true)}</p>
    <p>{row.reason}</p>
    {(row.ownershipEvidence||row.openingEvidence)&&<details>
     <summary>Evidence</summary>
     {row.ownershipEvidence&&<p>Ownership · {row.ownershipEvidence}</p>}
     {row.openingEvidence&&<p>Opening · {row.openingOn} · {row.openingEvidence}</p>}
    </details>}
   </li>)}</ol>
   {history.page.hasMore&&<button type="button" className="secondary" disabled={disabled}
    onClick={()=>loadHistory(history.record,true)}>Earlier reviews</button>}
  </section>}
 </section>;
}
