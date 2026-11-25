'use client';
import {SignInLink} from "../../sign-in-link";

import {useFinancialNotice} from './use-financial-notice';
import {FinanceHistoryComparison,previousLoadedFinanceVersion} from './history-comparison';
import {FinanceHistoryRecordedTime,FinanceHistoryRecordingFacts} from './history-recording';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {accountingNavigationHref,readAccountingNavigation} from '../../../client/accounting-navigation';
import type {AccountingNavigation} from '../../../client/accounting-navigation';
import type {FormEvent} from 'react';
import {InvoiceSetup} from './invoice-setup';
import {StatementStaging} from './statement-staging';
import {OpeningWorksheet} from './opening-worksheet';
import {AccountingReports} from './accounting-reports';
import styles from './screen.module.css';
import {AuthenticationError} from '../../../client/authentication';
import {
 clearPendingFinanceAccount,downloadFinanceHistory,financeAccounts,readPendingFinanceAccount,retainPendingFinanceAccount,
} from '../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../client/finance-accounts';
import {
 financeAccountTypes,financeAccountReviewReason,parseFinanceAccountDraft,requireFinanceAccount as check,
} from '../../../bookkeeping/finance-account-contract';
import type {
 FinanceAccount,FinanceAccountDraft,FinanceAccountType,
} from '../../../bookkeeping/finance-account-contract';

type Workspace={context:FinanceAccountContext;rows:FinanceAccount[];hasMore:boolean;includeArchived:boolean};
type AccountHistoryRow=Awaited<ReturnType<typeof financeAccounts.history>>['rows'][number];
type AccountHistory={accountId:string;currentName:string|null;rows:AccountHistoryRow[];hasMore:boolean};
type Pending=NonNullable<ReturnType<typeof readPendingFinanceAccount>>;
type Editor={account:FinanceAccount|null;name:string;code:string;accountType:FinanceAccountType|'';
 reportRole:string;controlKind:string;active:boolean;reason:string};
const newEditor:Editor={account:null,name:'',code:'',accountType:'',reportRole:'',controlKind:'',active:true,reason:''};
const typeLabels:Readonly<Record<FinanceAccountType,string>>={
 asset:'Asset',liability:'Liability',equity:'Equity',revenue:'Revenue',contra_revenue:'Contra revenue',expense:'Expense',
};
function readEditor(editor:Editor){
 const expectedVersion=editor.account?.version??'0',reportRole=editor.reportRole.trim();
 const side=reportRole==='contra_asset'?'credit':reportRole==='contra_equity'?'debit':
  ['asset','expense','contra_revenue'].includes(editor.accountType)?'debit':'credit';
 return parseFinanceAccountDraft({
  identity:editor.account?null:{code:editor.code.trim(),accountType:editor.accountType,normalSide:side,
   controlKind:editor.controlKind.trim()||null,reportRole},
  name:editor.name.trim(),active:editor.active,reason:editor.reason.trim()||null,
 },expectedVersion);
}
function downloadHistory(rows:readonly AccountHistoryRow[]){
 const recordingAvailable=rows.length>0&&rows.every(row=>row.recording!==undefined);
 downloadFinanceHistory('crest-account-history.csv',[
  ['Account code','Name','Version','Status','Change reason',...(recordingAvailable?['Recorded in Crest (UTC)','Recorded by reference']:[])],
  ...rows.map(row=>[row.code,row.name,row.version,row.active?'Active':'Archived',row.reason??'',...(recordingAvailable?[row.recording!.recordedAt,row.recording!.actorId]:[])]),
 ]);
}
const initialMessage='Checking accounting access…';
type Area='reports'|'setup'|'accounts';

export function FinanceAccountsScreen(){
 const navigation=useSearchParams();
 const [reportNavigation,setReportNavigation]=useState(()=>{
  const input:Record<string,unknown>={};
  for(const key of new Set(navigation?.keys()??[])){
   const values=navigation!.getAll(key);input[key]=values.length===1?values[0]:values;
  }
  return readAccountingNavigation(input);
 });
 const entryArea=reportNavigation.view;
 const initialArchived=useRef(reportNavigation.accountsArchived);
 function updateReportNavigation(change:Partial<AccountingNavigation>){
  const next=readAccountingNavigation({...reportNavigation,...change});
  setReportNavigation(next);
  if(window.location.pathname==='/settings/accounts')window.history.replaceState(null,'',accountingNavigationHref(next)+window.location.hash);
 }
 const {message,setMessage,confirmed:saveConfirmed,resetConfirmation}=useFinancialNotice(initialMessage);
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[editor,setEditor]=useState<Editor|null>(null);
 const [history,setHistory]=useState<AccountHistory|null>(null),[pending,setPending]=useState<Pending|null>(null);
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const [canRetry,setCanRetry]=useState(false),[stale,setStale]=useState(false);
 const [canRetire,setCanRetire]=useState(false),[reviewReason,setReviewReason]=useState('');
 const [area,setArea]=useState<Area|null>(null),[initialRead,setInitialRead]=useState(true);
 const request=useRef<AbortController|null>(null),original=useRef<FinanceAccountDraft|null>(null);
 const status=useRef<HTMLParagraphElement>(null);
 const historyHeading=useRef<HTMLHeadingElement>(null);
 const historyReturn=useRef<string|null>(null);
 const focusArea=useRef<Area|null>(null);
 const historyAccount=history?.accountId;
 useLayoutEffect(()=>{
  if(historyAccount)historyHeading.current?.focus();
  else if(historyReturn.current){
   const id=historyReturn.current;historyReturn.current=null;
   (document.querySelector<HTMLElement>('[data-account-history="'+id+'"]')??document.getElementById('finance-accounts-heading'))?.focus();
  }
 },[historyAccount]);
 const clearPrivate=useCallback(()=>{
  request.current?.abort();request.current=null;original.current=null;
  setWorkspace(null);setEditor(null);setHistory(null);setPending(null);setCanRetry(false);setStale(false);
  setCanRetire(false);setReviewReason('');
  historyReturn.current=null;
  focusArea.current=null;setInitialRead(false);
  setBusy(false);setSignedOut(false);setMessage('Check access to reload private accounting records.');
 },[setMessage]);
 function reportAccessDenied(){
  clearPrivate();setSignedOut(true);setMessage('Sign in again to review accounting records.');
  status.current?.focus();
 }
 useEffect(()=>{
  const visibility=()=>{if(document.visibilityState==='hidden')clearPrivate();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clearPrivate();};
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',clearPrivate);window.addEventListener('pageshow',restored);
  return()=>{
   request.current?.abort();request.current=null;original.current=null;
   document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('pagehide',clearPrivate);window.removeEventListener('pageshow',restored);
  };
 },[clearPrivate]);
 const run=useCallback(async(work:(signal:AbortSignal)=>Promise<void>,failure:string,focus=true)=>{
  if(request.current)return;
  const active=new AbortController();request.current=active;setBusy(true);resetConfirmation();setSignedOut(false);
  try{await work(active.signal);}
  catch(error){if(!active.signal.aborted){
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   if(denied){clearPrivate();setSignedOut(true);status.current?.focus();}
   setMessage(denied?'Sign in to review your accounts.':failure);
  }}finally{if(request.current===active){request.current=null;setBusy(false);if(focus)status.current?.focus();}}
 },[clearPrivate,setMessage,resetConfirmation]);
 const showAccounts=useCallback(async(context:FinanceAccountContext,includeArchived:boolean,signal:AbortSignal)=>{
  const page=await financeAccounts.list(context,null,includeArchived,signal);
  check(!signal.aborted);setWorkspace({context,...page,includeArchived});
  return page.rows.length;
 },[]);
 const load=useCallback(async(includeArchived=false,focus=true)=>{
  await run(async signal=>{
   setMessage('Loading accounts…');setHistory(null);
   setCanRetire(false);setReviewReason('');
   setWorkspace(current=>current?{...current,includeArchived,rows:[],hasMore:false}:null);
   try{
    const context=await financeAccounts.context(signal);
    const retained=readPendingFinanceAccount();check(!signal.aborted);
    setPending(retained);
    const count=await showAccounts(context,includeArchived,signal);
    setMessage(retained?'Review the interrupted account save before editing.':
     count?'Saved accounts loaded.':'No accounts match this view.');
   }catch(error){if(!signal.aborted)setWorkspace(null);throw error;}
  },'Accounting could not be verified. Check access and try again.',focus);
 },[run,showAccounts,setMessage]);
 useEffect(()=>{
  let mounted=true;
  queueMicrotask(()=>{
   if(!mounted)return;
   if(document.visibilityState==='hidden'){clearPrivate();return;}
   void load(initialArchived.current,false).then(()=>{if(mounted)setInitialRead(false);});
  });
  return()=>{mounted=false;};
 },[clearPrivate,load]);
 async function moreAccounts(current:Workspace){
  await run(async signal=>{
   const cursor=current.rows.at(-1)?.code;check(cursor);
   const page=await financeAccounts.list(current.context,cursor,current.includeArchived,signal);
   const rows=[...current.rows,...page.rows];check(!signal.aborted&&new Set(rows.map(row=>row.id)).size===rows.length);
   setWorkspace({...current,rows,hasMore:page.hasMore});setMessage('More saved accounts loaded.');
  },'More accounts could not be loaded. Try again.');
 }
 async function openHistory(current:Workspace,accountId:string,more=false){
  await run(async signal=>{
   setMessage('Loading account history…');
   if(!more)setHistory(null);
   const existing=more&&history?.accountId===accountId?history.rows:[];
   const page=await financeAccounts.history(current.context,accountId,existing.at(-1)?.version??'0',signal);
   check(!signal.aborted);setHistory({accountId,currentName:current.rows.find(account=>account.id===accountId)?.name??null,
    rows:[...existing,...page.rows],hasMore:page.hasMore});
   if(!more)updateReportNavigation({view:'accounts',accountHistory:accountId});
   setMessage('Saved account history loaded.');
  },'Account history could not be verified.');
 }
 function closeHistory(){
  historyReturn.current=history?.accountId??null;setHistory(null);updateReportNavigation({accountHistory:''});
 }
 async function refreshAfterSave(current:Workspace,signal:AbortSignal){
  setEditor(null);setHistory(null);setStale(false);
  try{await showAccounts(current.context,current.includeArchived,signal);}
  catch{if(!signal.aborted)setWorkspace(null);}
 }
 async function confirmed(current:Workspace,entry:Pending,outcome:'retired'|'committed',signal:AbortSignal){
  clearPendingFinanceAccount(entry);setPending(null);original.current=null;
  setCanRetry(false);setCanRetire(false);setReviewReason('');
  setMessage(outcome==='committed'?'The original account save was confirmed.':
   'The interrupted save was closed. You can start a new edit.',outcome==='committed');
  await refreshAfterSave(current,signal);
 }
 async function transmit(current:Workspace,entry:Pending,draft:FinanceAccountDraft,signal:AbortSignal){
  setCanRetry(false);setMessage('Saving account…');
  const result=await financeAccounts.save(current.context,entry.reference,draft,signal);
  check(!signal.aborted);
  if(result.state==='conflict'&&result.reason==='operation'){
   setMessage('The save reference needs review. Check the original outcome.');
   return;
  }
  if(result.state==='rejected'){
   if(result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED'){
    setSignedOut(true);setWorkspace(null);setEditor(null);setHistory(null);
   }
   if(result.reason==='RECOVERY_REVIEW_REQUIRED')setStale(true);
   setMessage(result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED'?'Sign in again, then check this save reference.':
    result.reason==='RECOVERY_REVIEW_REQUIRED'?'Account changes are paused. Reload after recovery review.':
    result.reason==='FINANCE_CHANNEL_ACCOUNT_PINNED'?'Close the linked money channel before archiving this account.':
    'Account setup needs review before changes can be saved.');
   return;
  }
  clearPendingFinanceAccount(entry);setPending(null);original.current=null;
  if(result.state==='conflict'){
   setStale(result.reason==='version');
   setMessage(result.reason==='version'?'This account changed. Reload the saved version before editing again.':
    'That account code is already in use. Review the code and try again.');
  }else{
   setMessage('Account saved.',true);await refreshAfterSave(current,signal);
  }
 }
 async function submit(event:FormEvent){
  event.preventDefault();
  if(!workspace||!editor||pending||stale||request.current)return;
  let draft:FinanceAccountDraft;
  try{draft=readEditor(editor);}catch{setMessage('Check the account name, code, classification and change reason.');return;}
  const context=workspace.context,recoveryEpoch=context.recoveryEpoch;
  if(context.writeState!=='ready'||!recoveryEpoch)return;
  await run(async signal=>{
   const entry=retainPendingFinanceAccount(context,{operationId:crypto.randomUUID(),recoveryEpoch,
    accountId:editor.account?.id??crypto.randomUUID(),expectedVersion:editor.account?.version??'0'});
   original.current=draft;setPending(entry);await transmit(workspace,entry,draft,signal);
  },'The save could not be confirmed. Check its status before trying again.');
 }
 async function checkPending(){
  if(!workspace||!pending)return;
  const context=workspace.context;
  await run(async signal=>{
   check(pending.businessId===context.businessId);
   setCanRetry(false);setCanRetire(false);setReviewReason('');
   const decision=await financeAccounts.lookup(context,pending.reference,signal);
   check(!signal.aborted);
   if(decision.state==='committed'||decision.state==='retired'){
    await confirmed(workspace,pending,decision.state,signal);
   }else if(decision.state==='absent'){
    const canRepeat=!!original.current&&pending.binding===context.binding&&context.recoveryEpoch===pending.reference.recoveryEpoch;
    const canClose=!canRepeat&&context.writeState==='ready';
    setCanRetry(canRepeat);
    setCanRetire(canClose);
    setMessage(canRepeat?'The save is still unconfirmed. You can retry the original request.':
     canClose?'No completed save was found. Review and close this attempt before starting a new edit.':
      'The save is still unconfirmed. Keep its reference for review before making another change.');
   }else{
    setMessage('The saved operation did not match this reference. Keep it for review.');
   }
  },'The original save could not be checked. Keep its reference and try again.');
 }
 async function retire(event:FormEvent){
  event.preventDefault();
  const reason=reviewReason.trim();
  if(!workspace||!pending||!canRetire||request.current||workspace.context.writeState!=='ready'||!financeAccountReviewReason(reason))return;
  await run(async signal=>{
   check(pending.businessId===workspace.context.businessId&&JSON.stringify(readPendingFinanceAccount())===JSON.stringify(pending));
   setCanRetire(false);setReviewReason('');setMessage('Reviewing the interrupted save…');
   const decision=await financeAccounts.retire(workspace.context,pending.reference,reason,signal);
   check(!signal.aborted);
   if(decision.state==='committed'||decision.state==='retired'){
    await confirmed(workspace,pending,decision.state,signal);
   }else if(decision.state==='rejected'&&decision.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED'){
    setSignedOut(true);setWorkspace(null);setEditor(null);setHistory(null);
    setMessage('Sign in again, then check the interrupted save.');
   }else{
    setMessage('The interrupted save could not be closed. Check its status again.');
   }
  },'The review could not be confirmed. Check save status before starting a new edit.');
 }
 async function retry(){
  if(!workspace||!pending||!original.current||!canRetry||workspace.context.binding!==pending.binding)return;
  const draft=original.current;
  await run(async signal=>{
   check(JSON.stringify(readPendingFinanceAccount())===JSON.stringify(pending));
   await transmit(workspace,pending,draft,signal);
  },'The original save could not be confirmed. Check its status again.');
 }
 function edit(account:FinanceAccount){
  setStale(false);setEditor({account,name:account.name,code:account.code,accountType:account.accountType,
   reportRole:account.reportRole,controlKind:account.controlKind??'',active:account.active,reason:''});
 }
 const writable=workspace?.context.writeState==='ready'&&!pending&&!signedOut;
 const context=workspace?.context;
 const hasSetupLinks=context&&(context.fixedMappings||context.moneyChannels||context.categoryMappings||context.taxProfiles);
 const hasSetup=!!(hasSetupLinks||context?.invoiceIssue||context?.openingWorksheet||context?.statementStaging);
 const currentArea=area??entryArea;
 const activeArea=currentArea==='setup'&&hasSetup?'setup':currentArea==='accounts'||!context?.trialBalance?'accounts':'reports';
 function selectArea(next:Area){
  setArea(next);
  updateReportNavigation({view:next});
  if(next===activeArea)document.getElementById('finance-'+next+'-heading')?.focus();
  else focusArea.current=next;
 }
 useEffect(()=>{
  if(focusArea.current===activeArea){
   focusArea.current=null;
   document.getElementById('finance-'+activeArea+'-heading')?.focus();
  }
 },[activeArea]);
 const loading=initialRead||busy;
 return <section className={styles.workspace} aria-label="Account settings" aria-busy={loading}>
  <p role="status" className={styles.notice} data-confirmed={saveConfirmed&&!busy} tabIndex={-1} ref={status}>{message}</p>
  {!editor&&!signedOut&&!workspace&&!loading&&<button type="button" className={styles.openAccounting}
   onClick={()=>void load(reportNavigation.accountsArchived)}>Check accounting access</button>}
  {loading&&!workspace&&!editor&&!signedOut&&<div className={styles.accountLoading} aria-hidden="true">
   <span className="workspace-skeleton"/><span className="workspace-skeleton"/><span className="workspace-skeleton"/>
  </div>}
  {signedOut&&<nav className="actions" aria-label="Accounting access recovery">
   <SignInLink className="primary-action" returnTo="accounting" context={{...reportNavigation,view:currentArea??'reports'}}>Sign in again</SignInLink>
   <a className="record-return-link" href="/save-review">Review interrupted saves</a>
  </nav>}
  {workspace&&!editor&&(context?.trialBalance||hasSetup)&&<nav className={styles.sectionLinks} aria-label="Accounting sections">
   {context?.trialBalance&&<button type="button" className="secondary" aria-current={activeArea==='reports'?'true':undefined} onClick={()=>selectArea('reports')}>Reports</button>}
   <button type="button" className="secondary" aria-current={activeArea==='accounts'?'true':undefined} onClick={()=>selectArea('accounts')}>Accounts</button>
   {hasSetup&&<button type="button" className="secondary" aria-current={activeArea==='setup'?'true':undefined} onClick={()=>selectArea('setup')}>Setup</button>}
  </nav>}
  {context?.trialBalance&&!editor&&<section className={styles.reportSection} aria-labelledby="finance-reports-heading" hidden={activeArea!=='reports'}>
   <h2 id="finance-reports-heading" tabIndex={-1}>Reports</h2>
   <AccountingReports key={context.businessId} context={context} navigation={reportNavigation} onNavigate={updateReportNavigation}
    onAccessDenied={reportAccessDenied}/>
  </section>}
  {context&&hasSetup&&!editor&&<section className={styles.section} aria-labelledby="finance-setup-heading" hidden={activeArea!=='setup'}>
   <h2 id="finance-setup-heading" tabIndex={-1}>Finance setup</h2>
   {hasSetupLinks&&<ul className={styles.setupLinks}>
    {context.fixedMappings&&<li><a href="/settings/accounts/mappings">Dated account mappings</a></li>}
    {context.moneyChannels&&<li><a href="/settings/accounts/channels">Money channels</a></li>}
    {context.categoryMappings&&<li><a href="/settings/accounts/mappings/categories">Expense category mappings</a></li>}
    {context.taxProfiles&&<li><a href="/settings/accounts/tax">Tax profiles</a></li>}
   </ul>}
   {context.invoiceIssue&&<InvoiceSetup businessId={context.businessId}/>}
   {context.statementStaging&&<StatementStaging key={context.businessId} context={context}/>}
   {context.openingWorksheet&&<OpeningWorksheet businessId={context.businessId} arPreview={context.openingArPreview===true} funds={context.openingFunds===true}/>}
  </section>}
  {pending&&workspace&&<section className={styles.section} aria-label="Interrupted account save">
   <button type="button" disabled={busy} onClick={()=>void checkPending()}>Check save status</button>
   {canRetry&&<button className="secondary" type="button" disabled={busy} onClick={()=>void retry()}>Retry original save</button>}
   <details className="statement-evidence account-original-reference"><summary>Save reference</summary>
    <p className="save-reference"><code>{pending.reference.operationId}</code></p>
   </details>
   {canRetire&&<form onSubmit={event=>void retire(event)}>
    <p className="field-help">Closing this attempt blocks it from saving later. Any change that already saved stays in account history.</p>
    <label htmlFor="finance-retirement-reason">Reason for closing the attempt</label>
    <textarea id="finance-retirement-reason" rows={2} autoComplete="off" maxLength={1000} required disabled={busy} value={reviewReason}
     onChange={event=>setReviewReason(event.target.value)}/>
    <button type="submit" className="secondary" disabled={busy||!financeAccountReviewReason(reviewReason.trim())}>Close interrupted save</button>
   </form>}
  </section>}
  {workspace&&!editor&&<section className={styles.section} aria-labelledby="finance-accounts-heading" hidden={activeArea!=='accounts'}>
   <h2 id="finance-accounts-heading" tabIndex={-1}>Chart of accounts</h2>
   <div className={styles.actions}>
    {writable&&<button type="button" disabled={busy} onClick={()=>setEditor(newEditor)}>Add account</button>}
    <button type="button" className="secondary" disabled={busy} onClick={()=>void load(workspace.includeArchived)}>Reload accounts</button>
   </div>
   {workspace.context.writeState==='paused'&&<p className="notice">Account changes are paused for recovery review.</p>}
   <label className="trust"><input type="checkbox" checked={workspace.includeArchived} disabled={busy}
    onChange={event=>{updateReportNavigation({accountsArchived:event.target.checked});void load(event.target.checked);}}/>Show archived accounts</label>
   {!history&&reportNavigation.accountHistory&&<div className="notice">
    <p>Your selected account history is ready to reopen.</p>
    <div className={styles.actions}>
     <button type="button" className="secondary" disabled={busy}
      onClick={()=>void openHistory(workspace,reportNavigation.accountHistory)}>Reopen selected account history</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>{
      updateReportNavigation({accountHistory:''});document.getElementById('finance-accounts-heading')?.focus();
     }}>Clear history selection</button>
    </div>
   </div>}
   <ul className={styles.accountList}>{workspace.rows.map(account=><li key={account.id}>
    <div className={styles.accountIdentity}>
     <strong><span className={styles.accountCode}>{account.code}</span> · {account.name}</strong>
     <p className="field-help">{typeLabels[account.accountType]} · {account.active?'Active':'Archived'}</p>
    </div>
    <div className={styles.actions}><button className="secondary" type="button" disabled={busy} aria-label={'View history for '+account.name}
     data-account-history={account.id} onClick={()=>void openHistory(workspace,account.id)}>View history</button>
    {writable&&<button className="secondary" type="button" disabled={busy} aria-label={'Edit account '+account.name}
     onClick={()=>edit(account)}>Edit account</button>}</div>
   </li>)}</ul>
   {workspace.hasMore&&<button type="button" className="secondary" disabled={busy}
    onClick={()=>void moreAccounts(workspace)}>Load more accounts</button>}
  </section>}
  {editor&&<form onSubmit={event=>void submit(event)}>
   <fieldset disabled={busy||!!pending||signedOut}>
    <legend>{editor.account?'Edit account':'New account'}</legend>
    <label htmlFor="finance-account-name">Account name</label>
    <input id="finance-account-name" value={editor.name} maxLength={400} required
     onChange={event=>setEditor({...editor,name:event.target.value})}/>
    {editor.account?<>
     <p className="field-help">Account {editor.account.code} · {typeLabels[editor.account.accountType]}</p>
     <label htmlFor="finance-account-status">Availability</label>
     <select id="finance-account-status" value={editor.active?'active':'archived'}
      onChange={event=>setEditor({...editor,active:event.target.value==='active'})}>
      <option value="active">Active</option><option value="archived">Archived</option>
     </select>
     <label htmlFor="finance-account-reason">Reason for change</label>
     <textarea id="finance-account-reason" rows={2} maxLength={2000} required value={editor.reason}
      onChange={event=>setEditor({...editor,reason:event.target.value})}/>
    </>:<>
     <label htmlFor="finance-account-code">Account code</label>
     <input id="finance-account-code" value={editor.code} maxLength={128} required
      onChange={event=>setEditor({...editor,code:event.target.value})}/>
     <label htmlFor="finance-account-type">Account type</label>
     <select id="finance-account-type" value={editor.accountType} required
      onChange={event=>setEditor({...editor,accountType:event.target.value as FinanceAccountType|''})}>
      <option value="">Select account type</option>
      {financeAccountTypes.map(type=><option value={type} key={type}>{typeLabels[type]}</option>)}
     </select>
     <label htmlFor="finance-account-report-role">Report role</label>
     <input id="finance-account-report-role" autoCapitalize="none" spellCheck={false} value={editor.reportRole} maxLength={64}
      pattern="[a-z][a-z0-9_]{0,63}" required onChange={event=>setEditor({...editor,reportRole:event.target.value})}/>
     <label htmlFor="finance-account-control-kind">Control kind (optional)</label>
     <input id="finance-account-control-kind" autoCapitalize="none" spellCheck={false} value={editor.controlKind} maxLength={64}
      pattern="[a-z][a-z0-9_]{0,63}" onChange={event=>setEditor({...editor,controlKind:event.target.value})}/>
    </>}
    <button type="submit" disabled={stale}>Save account</button>
   </fieldset>
   <button type="button" className="secondary" disabled={busy||!!pending} onClick={()=>{setEditor(null);setStale(false);}}>
    Discard edit
   </button>
  </form>}
  {history&&workspace&&!editor&&<section className={styles.section} aria-label="Saved account history" hidden={activeArea!=='accounts'}>
   <h2 ref={historyHeading} tabIndex={-1}>{history.currentName?history.currentName+' history':'Selected account history'}</h2>
   <ol className="activity-timeline">{history.rows.map(row=>{const previous=previousLoadedFinanceVersion(history.rows,row);return <li className="activity-entry" key={row.auditEventId}>
    <div className="activity-heading">
     <strong>{row.name}</strong>
     <span className="activity-version">Version {row.version}</span>
    </div>
    <p className="activity-meta">{row.active?'Active':'Archived'}</p>
    <FinanceHistoryRecordedTime recording={row.recording}/>
    {row.reason&&<p>{row.reason}</p>}
    <FinanceHistoryComparison version={row.version} previousVersion={previous?.version} fields={previous?[
     {label:'Account name',before:previous.name,after:row.name},
     {label:'Status',before:previous.active?'Active':'Archived',after:row.active?'Active':'Archived'},
     {label:'Reason',before:previous.reason??'No reason recorded',after:row.reason??'No reason recorded'},
    ]:[]}/>
    <details><summary>Version evidence</summary><FinanceHistoryRecordingFacts recording={row.recording} auditEventId={row.auditEventId}/></details>
   </li>;})}</ol>
   <div className={styles.actions}>{history.hasMore&&<button type="button" className="secondary" disabled={busy}
    onClick={()=>void openHistory(workspace,history.accountId,true)}>Load more history</button>}
   {history.rows.length>0&&<button type="button" className="secondary" disabled={busy}
    onClick={()=>downloadHistory(history.rows)}>Download loaded history (CSV)</button>}
   <button type="button" className="secondary" onClick={closeHistory}>Close history</button></div>
  </section>}
 </section>;
}
