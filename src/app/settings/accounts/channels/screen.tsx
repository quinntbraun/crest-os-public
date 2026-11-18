'use client';

import {useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
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
 const [selectedId,setSelectedId]=useState<string|null>(null),[search,setSearch]=useState('');
 const [focusTarget,setFocusTarget]=useState<{target:'record'|'directory'}|null>(null);
 const handledFocus=useRef<typeof focusTarget>(null);
 const directoryHeading=useRef<HTMLHeadingElement>(null),recordHeading=useRef<HTMLHeadingElement>(null),origin=useRef<HTMLButtonElement|null>(null);
 const mounted=useSyncExternalStore(subscribeToHydration,()=>true,()=>false),disabled=!mounted||busy;
 const controller=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const draft=editor?prepareDraft(editor,choices):null;
 const selected=workspace?.page.rows.find(row=>row.channelId===selectedId)??null;
 const query=search.trim().toLocaleLowerCase('en-US');
 const visible=workspace?.page.rows.filter(row=>[row.label,description(row),row.accountCode].some(value=>value.toLocaleLowerCase('en-US').includes(query)))??[];
 const dirty=editor!==null&&JSON.stringify(editor.fields)!==JSON.stringify(editor.record?fromRecord(editor.record):blank);
 useLayoutEffect(()=>{
  if(!focusTarget||handledFocus.current===focusTarget||busy||editor)return;
  if(focusTarget.target==='record')recordHeading.current?.focus();
  else if(origin.current?.isConnected)origin.current.focus();
  else directoryHeading.current?.focus();
  handledFocus.current=focusTarget;
 },[focusTarget,busy,editor,selectedId]);
 useEffect(()=>{
  if(!dirty)return;
  const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',warn);
  return()=>window.removeEventListener('beforeunload',warn);
 },[dirty]);
 const clearPrivate=useCallback(()=>{
  controller.current?.abort();controller.current=null;setWorkspace(null);setEditor(null);setChoices(null);setHistory(null);setSelectedId(null);setSearch('');setFocusTarget(null);origin.current=null;
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
  setWorkspace(null);setHistory(null);setSelectedId(null);setFocusTarget({target:'directory'});origin.current=null;setMessage(result);
  try{await refresh(context,signal);}catch{if(!signal.aborted)setMessage(result+' Reload channels to view the latest records.');}
 }
 async function lookup(context:FinanceAccountContext,entry:Pending,signal:AbortSignal){
  check(context.businessId===entry.businessId);
  setPending(entry);setCanClose(false);setReason('');setEditor(null);setChoices(null);setHistory(null);setWorkspace(null);setSelectedId(null);setFocusTarget(null);origin.current=null;
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
   setHistory(null);setWorkspace(null);setSelectedId(null);setFocusTarget(null);origin.current=null;
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
  setFocusTarget(null);setHistory(null);setChoices(null);setEditor({record,fields:record?fromRecord(record):blank});
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

 function selectChannel(record:RecordRow,button:HTMLButtonElement){
  origin.current=button;setSelectedId(record.channelId);setHistory(null);setFocusTarget({target:'record'});
 }
 function returnToDirectory(){setSelectedId(null);setHistory(null);setFocusTarget({target:'directory'});}
 function cancelEditor(){
  if(dirty&&!window.confirm('Discard this unsaved channel review?'))return;
  setEditor(null);setChoices(null);setMessage('Channel review draft cleared.');setFocusTarget({target:selected?'record':'directory'});
 }
 const historyView=!!history?.page.rows.length&&<section className="mapping-summary-card" aria-label="Saved channel history">
   <h3>{history.record.label} history</h3>
   <p className="field-help">{history.page.rows.length} loaded review{history.page.rows.length===1?'':'s'}. {history.page.hasMore?'Earlier reviews remain to be loaded.':'All earlier reviews loaded.'}</p>
   <div className={styles.actions}><button type="button" className="secondary" disabled={disabled} onClick={download}>Download loaded history (CSV)</button></div>
   <ol className="mapping-history-list">{history.page.rows.map((row,index)=><li key={row.version} className="channel-timeline-row">
    <strong>Version {row.version} · {row.active?'Open':'Closed'}</strong>
    <p>Effective <time dateTime={row.effectiveFrom}>{dateLabel(row.effectiveFrom)}</time>{index>0?' · Before '+dateLabel(history.page.rows[index-1]!.effectiveFrom)+' (exclusive)':' · Newest loaded review'}</p>
    <p>Account {history.record.accountCode} · {moneyChannelOpeningStates[row.openingState]}
     {row.openingCents===null?'':' · '+dollars(row.openingCents,true)+' USD'}</p>
    <p>{row.reason}</p>
    {(row.ownershipEvidence||row.openingEvidence)&&<details>
     <summary>Evidence</summary>
     {row.ownershipEvidence&&<p>Ownership · {row.ownershipEvidence}</p>}
     {row.openingEvidence&&<p>Opening · {row.openingOn} · {row.openingEvidence}</p>}
    </details>}
   </li>)}</ol>
   {history.page.hasMore&&<button type="button" className="secondary" disabled={disabled}
    onClick={()=>loadHistory(history.record,true)}>Earlier reviews</button>}
  </section>;
 return <section className={styles.workspace} aria-label="Money channel reviews" aria-busy={busy}>
  <p role="status" tabIndex={-1} ref={status}>{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  {!editor&&!pending&&<>
   <div className={styles.actions}>
    <button type="button" className={workspace?'secondary':undefined} disabled={disabled} onClick={()=>load()}>{workspace?'Reload channels':'Load channels'}</button>
    {workspace?.context.writeState==='ready'&&<button type="button" disabled={disabled}
     onClick={()=>openEditor(null)}>Add channel</button>}
   </div>
   <details className={styles.channelRecovery}>
    <summary>Review an interrupted save</summary>
    <p className="field-help">Check the original review before starting another if a save was interrupted.</p>
    <button type="button" className="secondary" disabled={disabled} onClick={()=>load(true)}>Check interrupted review</button>
   </details>
  </>}
  {!workspace&&!editor&&!pending&&!signedOut&&<section className={styles.channelIntro} aria-label="About money channels">
   <h2>A clear record of where money is held</h2>
   <p>Review dedicated accounts, payment wallets, physical cash, checks and Crest funds held by the owner.</p>
   <p className="field-help">Saved reviews and opening evidence are separate from current balances. This page does not connect to a bank or move money.</p>
  </section>}
  {workspace&&!editor&&!pending&&<div className={styles.channelWorkbench} data-selected={selected!==null}>
   <section className={styles.channelDirectory} aria-labelledby="channel-directory-heading">
    <h2 id="channel-directory-heading" ref={directoryHeading} tabIndex={-1}>Saved channels</h2>
    <p className="field-help">{workspace.page.rows.length} loaded · USD{workspace.page.hasMore?' · More channels available':''}</p>
    {!!workspace.page.rows.length&&<>
     <label htmlFor="channel-search">Filter loaded channels</label>
     <input id="channel-search" type="search" value={search} maxLength={200} disabled={disabled} onChange={event=>setSearch(event.target.value)}/>
     <p className="field-help">{visible.length} matching loaded channel{visible.length===1?'':'s'}</p>
    </>}
    {!workspace.page.rows.length&&<p>No money channels have been saved.</p>}
    {!!workspace.page.rows.length&&!visible.length&&<p>No loaded channels match. Clear the filter or load more channels.</p>}
    <ul className={"channel-directory "+styles.channelRows}>{visible.map(row=><li key={row.channelId} data-selected={row.channelId===selectedId}>
     <button type="button" className="secondary" aria-pressed={row.channelId===selectedId} disabled={disabled}
      onClick={event=>selectChannel(row,event.currentTarget)}>
      <strong>{row.label}</strong>
      <span>Account {row.accountCode} · USD</span>
      <span className="field-help">{moneyChannelKinds[row.kind]} · {row.active?'Open review record':'Closed review record'}</span>
      <span className="channel-opening" data-incomplete={row.openingState==='unknown'}>{moneyChannelOpeningStates[row.openingState]}</span>
     </button>
    </li>)}</ul>
    {workspace.page.hasMore&&<button type="button" className="secondary" disabled={disabled} onClick={moreChannels}>More channels</button>}
   </section>
   <div className={styles.channelInspector}>
    {selected?<section aria-labelledby="channel-record-heading" className={styles.channelRecord}>
     <div className={styles.actions}><button type="button" className="secondary" disabled={disabled} onClick={returnToDirectory}>Back to channels</button></div>
     <h2 id="channel-record-heading" ref={recordHeading} tabIndex={-1}>{selected.label}</h2>
     <p className="channel-effective" data-active={selected.active}>Latest review · {selected.active?'Open':'Closed'} from <time dateTime={selected.effectiveFrom}>{dateLabel(selected.effectiveFrom)}</time></p>
     <p className="field-help">{description(selected)}</p>
     <dl className={styles.channelFacts}>
      <div><dt>Linked ledger account</dt><dd>Account {selected.accountCode}</dd></div>
      <div><dt>Currency</dt><dd>USD</dd></div>
      <div><dt>Saved review</dt><dd>Version {selected.version}</dd></div>
     </dl>
     <section className={styles.channelOpening} aria-label="Saved opening evidence">
      <h3>Opening evidence</h3>
      <p>{moneyChannelOpeningStates[selected.openingState]}{selected.openingCents===null?'':' · '+dollars(selected.openingCents,true)}</p>
      {selected.openingOn&&<p>As of <time dateTime={selected.openingOn}>{dateLabel(selected.openingOn)}</time> · USD</p>}
      <p className="field-help">This is saved opening evidence, not a current balance or confirmation from a bank.</p>
      {selected.ownershipEvidence&&<><h4>Ownership evidence</h4><p>{selected.ownershipEvidence}</p></>}
      {selected.openingEvidence&&<><h4>Opening reference</h4><p>{selected.openingEvidence}</p></>}
     </section>
     <p><strong>Review reason</strong></p><p>{selected.reason}</p>
     <div className={styles.actions}>
      <button type="button" className="secondary" disabled={disabled} onClick={()=>loadHistory(selected)}>View history</button>
      {workspace.context.writeState==='ready'&&<button type="button" className="secondary" disabled={disabled} onClick={()=>openEditor(selected)}>Edit review</button>}
     </div>
     {historyView}
    </section>:<section className={styles.channelIntro} aria-label="Channel selection guidance"><h2>Review one channel</h2><p>Choose a saved channel to see its ownership, opening evidence and dated history.</p><p className="field-help">An open review record does not verify current funds or enable a bank connection.</p></section>}
   </div>
  </div>}
  {editor&&<MoneyChannelEditor record={editor.record} fields={editor.fields} choices={choices} busy={disabled} canSave={draft!==null}
   change={change} findAccounts={findAccounts} save={save} cancel={cancelEditor}/>}
  {pending&&<section className={styles.channelIntro} aria-label="Interrupted channel review">
   <h2>Check the original review</h2><p>The outcome is unconfirmed. Review this attempt before starting another change.</p>
   <button type="button" className="secondary" disabled={disabled} onClick={()=>load(true)}>Check interrupted review</button>
  </section>}
  {pending&&canClose&&<form onSubmit={closeAttempt}>
   <label htmlFor="channel-close-reason">Reason to close this attempt</label>
   <textarea id="channel-close-reason" rows={2} maxLength={1000} required disabled={disabled} value={reason}
    onChange={event=>setReason(event.target.value)}/>
   <button type="submit" disabled={disabled||!financeAccountReviewReason(reason.trim())}>Close interrupted review</button>
  </form>}
 </section>;
}
