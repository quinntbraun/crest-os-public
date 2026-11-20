'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError} from '../../../../../client/authentication';
import {
 clearPendingFinanceMapping,downloadFinanceHistory,financeAccounts,readPendingFinanceMapping,retainPendingFinanceMapping,
} from '../../../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../../../client/finance-accounts';
import {customerDate} from '../../../../../customer/customer-contract';
import {financeAccountReviewReason,requireFinanceAccount as check} from '../../../../../bookkeeping/finance-account-contract';
import {expenseCategoryMappingLabels,expenseCategoryMappingPurpose,financeMappingLabels,fixedFinanceMappingLabels,fixedFinanceMappingPurpose,parseFinanceMappingApproval} from '../../../../../bookkeeping/finance-mapping-contract';
import type {FinanceMappingApproval,FinanceMappingEditorData,FinanceMappingPurpose} from '../../../../../bookkeeping/finance-mapping-contract';
import styles from '../../screen.module.css';
import {MappingApprovalHistory} from '../history';

type Pending=NonNullable<ReturnType<typeof readPendingFinanceMapping>>;
type Draft={action:'approve'|'close';date:string;reason:string;accountId:string};
type Choices=Awaited<ReturnType<typeof financeAccounts.expenseCategoryAccounts>>;
type History=Awaited<ReturnType<typeof financeAccounts.mappingHistory>>;
type HistoryRow=History['rows'][number];
type SavedResult={operationId:string;purpose:FinanceMappingPurpose;version:string;effectiveFrom:string;closed:boolean};
type Workspace={context:FinanceAccountContext;data:FinanceMappingEditorData;saved:HistoryRow|null;history:History;choices?:Choices};
const subscribeToHydration=()=>()=>undefined;
const expenseExamples={
 category_supplies:'Cleaning chemicals, towels and other consumable detailing supplies.',
 category_equipment:'Equipment purchases classified as an expense under the approved rules.',
 category_vehicle:'Business vehicle costs other than fuel.',
 category_fuel:'Fuel purchased for business travel.',
 category_insurance:'Business insurance premiums.',
 category_marketing:'Advertising and promotional materials.',
 category_software:'Software subscriptions and licenses.',
 category_fees:'Business fees assigned to this expense category.',
 category_rent:'Rent for business premises or storage.',
 category_utilities:'Utilities for business premises.',
 category_professional:'Work from an outside professional, such as bookkeeping.',
} as const;
const displayDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(value:string)=>displayDate.format(new Date(value+'T00:00:00Z'));

export function FinanceMappingEditor({categories=false,initialPurpose=''}:{categories?:boolean;initialPurpose?:FinanceMappingPurpose|''}){
 const initialMessage=categories?'Choose an expense category to review its approval settings.':'Choose a purpose to review its approval settings.';
 const [purpose,setPurpose]=useState<FinanceMappingPurpose|''>(initialPurpose);
 const [result,setResult]=useState<SavedResult|null>(null);
 const labels=categories?expenseCategoryMappingLabels:fixedFinanceMappingLabels;
 const acceptsPurpose=categories?expenseCategoryMappingPurpose:fixedFinanceMappingPurpose;
 const [workspace,setWorkspace]=useState<Workspace|null>(null),[draft,setDraft]=useState<Draft|null>(null);
 const [pending,setPending]=useState<Pending|null>(null),[review,setReview]=useState<'none'|'retry'|'retire'>('none');
 const [reviewReason,setReviewReason]=useState(''),[message,setMessage]=useState(initialMessage);
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const mounted=useSyncExternalStore(subscribeToHydration,()=>true,()=>false);
 const controlsDisabled=!mounted||busy;
 const active=useRef<AbortController|null>(null),original=useRef<FinanceMappingApproval|null>(null);
 const status=useRef<HTMLParagraphElement>(null),draftTitle=useRef<HTMLHeadingElement>(null),historyHeading=useRef<HTMLHeadingElement>(null);
 const draftAction=draft?.action;
 useEffect(()=>{if(draftAction)draftTitle.current?.focus();},[draftAction]);

 const clearPrivate=useCallback(()=>{
  active.current?.abort();active.current=null;original.current=null;
  setPurpose('');setWorkspace(null);setDraft(null);setPending(null);setReview('none');setReviewReason('');setResult(null);
  setBusy(false);setSignedOut(false);setMessage(initialMessage);
 },[initialMessage]);
 useEffect(()=>{
  const visibility=()=>{if(document.visibilityState==='hidden')clearPrivate();};
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)clearPrivate();};
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',clearPrivate);window.addEventListener('pageshow',restore);
  return()=>{
   active.current?.abort();active.current=null;original.current=null;
   document.removeEventListener('visibilitychange',visibility);
   window.removeEventListener('pagehide',clearPrivate);window.removeEventListener('pageshow',restore);
  };
 },[clearPrivate]);

 async function run(work:(signal:AbortSignal)=>Promise<void>,failure:string){
  if(active.current)return;
  const controller=new AbortController(),signal=controller.signal;
  active.current=controller;setBusy(true);setSignedOut(false);
  try{await work(signal);}
  catch(error){
   if(signal.aborted)return;
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   if(denied){setSignedOut(true);setWorkspace(null);setDraft(null);original.current=null;}
   setMessage(denied?'Sign in again to review mapping approvals.':failure);
  }finally{
   if(active.current===controller){active.current=null;setBusy(false);status.current?.focus();}
  }
 }
 async function savedRule(context:FinanceAccountContext,selected:FinanceMappingPurpose,latest:FinanceMappingEditorData['latest'],signal:AbortSignal){
  if(!latest)return {rows:[],hasMore:false};
  const history=await financeAccounts.mappingHistory(context,selected,null,signal);
  const saved=history.rows[0];
  check(!signal.aborted&&saved?.version===latest.version&&saved.accountId===latest.accountId&&saved.effectiveFrom===latest.effectiveFrom);
  return history;
 }
 async function loadEditor(context:FinanceAccountContext,selected:FinanceMappingPurpose,signal:AbortSignal){
  if(expenseCategoryMappingPurpose(selected)){
   const choices=await financeAccounts.expenseCategoryAccounts(context,selected,null,signal);
   const history=await savedRule(context,selected,choices.latest,signal);
   check(!signal.aborted);
   setWorkspace({context,data:{purpose:selected,latest:choices.latest,eligible:null},saved:history.rows[0]??null,history,choices});
  }else{
   const data=await financeAccounts.mappingEditor(context,selected,signal);
   const history=await savedRule(context,selected,data.latest,signal);
   check(!signal.aborted);
   setWorkspace({context,data,saved:history.rows[0]??null,history});
  }
  setPurpose(selected);setDraft(null);
 }
 function loadMoreAccounts(){
  if(!workspace?.choices?.hasMore)return;
  const {context,choices,data}=workspace,selected=data.purpose;
  if(!expenseCategoryMappingPurpose(selected))return;
  const cursor=choices.rows.at(-1)?.code;
  if(!cursor)return;
  void run(async signal=>{
   const result=await financeAccounts.expenseCategoryAccounts(context,selected,cursor,signal);
   check(!signal.aborted);
   if(JSON.stringify(result.latest)!==JSON.stringify(choices.latest)){
    setWorkspace(null);setDraft(null);setMessage('The saved mapping changed. Reload approval settings.');return;
   }
   const rows=[...choices.rows,...result.rows];
   check(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.code)).size===rows.length);
   setWorkspace({...workspace,choices:{...result,rows}});setMessage('More eligible accounts loaded.');
  },'More accounts could not be loaded. Try again.');
 }
 function loadMoreHistory(){
  if(!workspace?.history.hasMore)return;
  const {context,data,history}=workspace,last=history.rows.at(-1);if(!last)return;
  void run(async signal=>{
   // Earlier approvals are immutable; loading them preserves the proposal and its original version.
   const page=await financeAccounts.mappingHistory(context,data.purpose,last.version,signal);
   check(!signal.aborted);
   const rows=[...history.rows,...page.rows];
   check(new Set(rows.map(row=>row.id)).size===rows.length&&new Set(rows.map(row=>row.version)).size===rows.length);
   setWorkspace({...workspace,history:{rows,hasMore:page.hasMore}});setMessage('Older approvals loaded.');
  },'Older approvals could not be loaded. The loaded history is still available.');
 }
 function downloadHistory(){
  if(!workspace?.history.rows.length||active.current)return;
  downloadFinanceHistory('crest-mapping-approvals.csv',[
   ['Purpose','Version','Effective from','Status','Account code','Approval reason'],
   ...workspace.history.rows.map(row=>[financeMappingLabels[row.purpose],row.version,row.effectiveFrom,
    row.accountId===null?'Closed':'Approved',row.accountCode??'',row.reason]),
  ]);
 }
 async function finish(context:FinanceAccountContext,entry:Pending,messageAfter:string,signal:AbortSignal,receipt?:{version:string;effectiveFrom:string;accountId:string|null}){
  check(!signal.aborted);clearPendingFinanceMapping(entry);original.current=null;
  if(receipt)setResult({operationId:entry.reference.operationId,purpose:entry.reference.purpose,version:receipt.version,effectiveFrom:receipt.effectiveFrom,closed:receipt.accountId===null});
  setPending(null);setDraft(null);setReview('none');setReviewReason('');setWorkspace(null);
  setMessage(messageAfter);
  if(!acceptsPurpose(entry.reference.purpose))return;
  try{await loadEditor(context,entry.reference.purpose,signal);}
  catch{if(!signal.aborted)setWorkspace(null);}
 }
 async function lookup(context:FinanceAccountContext,entry:Pending,signal:AbortSignal){
  check(context.businessId===entry.businessId);
  setPending(entry);setWorkspace(null);setDraft(null);setReview('none');setReviewReason('');
  const result=await financeAccounts.mappingOperation(context,entry.reference,signal);
  check(!signal.aborted);
  if(result.state==='committed'||result.state==='retired'){
   await finish(context,entry,result.state==='committed'?'The original approval was confirmed.':
    'The interrupted approval was closed. You can start a new change.',signal,result.state==='committed'?result.receipt:undefined);
   return;
  }
  if(result.state==='conflict'){
   setMessage('The saved operation does not match this reference. Keep it for review.');return;
  }
  const canRetry=original.current&&context.binding===entry.binding&&context.recoveryEpoch===entry.reference.recoveryEpoch;
  if(canRetry){
   setReview('retry');setMessage('No completed approval was found. You can retry the original request.');
  }else if(context.writeState==='ready'){
   setReview('retire');setMessage('No completed approval was found. Review and close the attempt before starting a new change.');
  }else setMessage('No completed approval was found. Review can resume when account changes reopen.');
 }
 function load(reviewOnly=false){
  void run(async signal=>{
   setMessage(reviewOnly?'Checking the interrupted approval…':'Loading approval settings…');
   setWorkspace(null);setDraft(null);setReview('none');setReviewReason('');
   const entry=readPendingFinanceMapping();
   if(reviewOnly&&!entry){setMessage('There is no interrupted approval in this tab.');return;}
   const context=await financeAccounts.context(signal);
   check(!signal.aborted);
   if(!context.fixedMappings||categories&&!context.categoryMappings){
    setWorkspace(null);setMessage('Mapping approvals are unavailable in this workspace.');return;
   }
   if(entry){await lookup(context,entry,signal);return;}
   check(purpose);await loadEditor(context,purpose,signal);
   setMessage(context.writeState==='ready'?'Approval settings loaded.':'Account changes are paused for recovery review.');
  },reviewOnly?'The interrupted approval could not be verified. Keep the reference and try again.':
   'Approval settings could not be verified. Try again.');
 }
 async function send(context:FinanceAccountContext,entry:Pending,approval:FinanceMappingApproval,signal:AbortSignal){
  setReview('none');setResult(null);setMessage('Saving mapping approval…');
  const result=await financeAccounts.approveMapping(context,entry.reference,approval,signal);
  check(!signal.aborted);
  if(result.state==='committed'){
   await finish(context,entry,approval.accountId===null?'Mapping closure saved.':'Mapping approval saved.',signal,result.receipt);
   return;
  }
  if(result.state==='rejected')original.current=null;
  if(result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED')setSignedOut(true);
  setMessage(result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED'
   ?'Sign in again, then check the approval status.':'The approval could not be confirmed. Check its status before another change.');
 }
 function submit(event:FormEvent){
  event.preventDefault();
  if(!workspace||!draft||pending||active.current)return;
  const {context,data}=workspace;
  if(!context.recoveryEpoch||context.writeState!=='ready'||!validDraft)return;
  const accountId=draft.action==='close'?null:draft.accountId;
  const recoveryEpoch=context.recoveryEpoch;
  void run(async signal=>{
   const approval=parseFinanceMappingApproval({accountId,effectiveFrom:draft.date,reason:draft.reason.trim()});
   let entry:Pending;
   try{entry=retainPendingFinanceMapping(context,{operationId:crypto.randomUUID(),recoveryEpoch,
    purpose:data.purpose,expectedVersion:data.latest?.version??'0'});}
   catch{setMessage('Crest could not keep a recovery reference. Approval was not sent.');return;}
   original.current=approval;setPending(entry);setDraft(null);setWorkspace(null);
   await send(context,entry,approval,signal);
  },'The approval could not be confirmed. Check its status before another change.');
 }
 function retry(){
  const approval=original.current;
  if(!approval||!pending||review!=='retry')return;
  void run(async signal=>{
   const context=await financeAccounts.context(signal);
   check(!signal.aborted&&context.businessId===pending.businessId&&context.binding===pending.binding
    &&context.recoveryEpoch===pending.reference.recoveryEpoch&&JSON.stringify(readPendingFinanceMapping())===JSON.stringify(pending));
   await send(context,pending,approval,signal);
  },'The retry could not be confirmed. Check the original approval status.');
 }
 function retire(event:FormEvent){
  event.preventDefault();
  const reason=reviewReason.trim();
  if(!pending||review!=='retire'||!financeAccountReviewReason(reason))return;
  void run(async signal=>{
   const context=await financeAccounts.context(signal);
   check(!signal.aborted&&context.businessId===pending.businessId
    &&JSON.stringify(readPendingFinanceMapping())===JSON.stringify(pending));
   setReview('none');setReviewReason('');setMessage('Closing the interrupted attempt…');
   const result=await financeAccounts.retireMappingApproval(context,pending.reference,reason,signal);
   check(!signal.aborted);
   if(result.state==='committed'||result.state==='retired'){
    await finish(context,pending,result.state==='committed'?'The original approval was confirmed.':
     'The interrupted approval was closed. You can start a new change.',signal,result.state==='committed'?result.receipt:undefined);
   }else{
    if(result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED')setSignedOut(true);
    setMessage('The attempt could not be closed. Check the approval status again.');
   }
  },'The review could not be confirmed. Check the approval status again.');
 }
 const latest=workspace?.data.latest,eligible=workspace?.data.eligible,choices=workspace?.choices;
 const hasChoice=categories?!!choices?.rows.length:!!eligible;
 const canEdit=workspace?.context.writeState==='ready'&&!pending;
 const canClose=latest!==null&&latest!==undefined&&latest.accountId!==null;
 const proposedAccount=draft?.action==='approve'?(categories?choices?.rows.find(account=>account.id===draft.accountId):eligible):null;
 const validDraft=!!draft&&customerDate(draft.date)&&(!latest||draft.date>latest.effectiveFrom)
  &&financeAccountReviewReason(draft.reason.trim())&&(draft.action==='close'?canClose:categories?choices?.rows.some(account=>account.id===draft.accountId):eligible?.id===draft.accountId);

 return <section className={styles.workspace+' mapping-approval-workspace'} aria-label="Mapping approvals" aria-busy={busy}>
  <p ref={status} tabIndex={-1} role="status">{message}</p>
  {signedOut&&<a href="/sign-in">Sign in again</a>}
  {result&&<section className="mapping-summary-card" aria-label="Saved mapping change">
   <h2>{result.closed?'Mapping closure recorded':'Mapping approval recorded'}</h2>
   <p>{financeMappingLabels[result.purpose]} · Version {result.version} · Effective {dateLabel(result.effectiveFrom)}</p>
   <details className="mapping-save-reference"><summary>Save reference</summary><p className="save-reference"><code>{result.operationId}</code></p></details>
  </section>}
  {!pending&&!draft&&<section className={!workspace?'mapping-approval-start':'mapping-approval-selector'} aria-label="Choose an approval setting">
   {!workspace&&<div className="mapping-approval-introduction"><h2>Review an approval setting</h2><p>Choose a {categories?'category':'purpose'} to see its saved setting and the accounts eligible for a new approval.</p><p>Review the saved and proposed rules before confirming a change. Earlier approvals stay in history.</p></div>}
   <div className="mapping-approval-fields">
   <div className={styles.lookupFields}>
    <div>
     <label htmlFor="approval-purpose">{categories?'Expense category':'Purpose'}</label>
     <select id="approval-purpose" disabled={controlsDisabled} value={purpose} onChange={event=>{
      const value=event.target.value;
      setPurpose(acceptsPurpose(value)?value:'');setWorkspace(null);setDraft(null);setResult(null);setMessage(initialMessage);
     }}>
      <option value="">{categories?'Choose a category':'Select a purpose'}</option>
      {Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}
     </select>
    </div>
   </div>
   <div className={styles.actions}>
    <button type="button" disabled={controlsDisabled||!purpose} onClick={()=>load()}>Load approval settings</button>
    <button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>load(true)}>Review interrupted approval</button>
   </div>
   </div>
  </section>}
  {workspace&&!pending&&<section className="mapping-summary-card" aria-label="Saved approval settings">
   <h2>{financeMappingLabels[workspace.data.purpose]}</h2>
   {expenseCategoryMappingPurpose(workspace.data.purpose)&&<p className="field-help">{expenseExamples[workspace.data.purpose]}</p>}
   <div className="mapping-approval-columns"><div className="mapping-approval-proposal">
   <p>{latest?<>Version {latest.version} · {latest.accountId===null?'Closed':'Approved'} · Effective {dateLabel(latest.effectiveFrom)}</>:
    'No approved mapping yet.'}</p>
   {eligible&&<p>Eligible account <strong>{eligible.code} · {eligible.name}</strong></p>}
   {categories&&choices?.latest?.accountCode&&<p>Approved account <strong>{choices.latest.accountCode}</strong></p>}
   {!hasChoice&&<p>Add or activate an eligible account in the chart of accounts before approving this {categories?'mapping':'purpose'}.</p>}
   {canEdit&&!draft&&<div className={styles.actions}>
    {hasChoice&&<button type="button" disabled={controlsDisabled} onClick={()=>setDraft({action:'approve',date:'',reason:'',accountId:eligible?.id??''})}>Approve mapping</button>}
    {canClose&&<button type="button" className="secondary" disabled={controlsDisabled}
     onClick={()=>setDraft({action:'close',date:'',reason:'',accountId:''})}>Close mapping</button>}
   </div>}
   {draft&&<form onSubmit={submit}>
    <h3 ref={draftTitle} className="editor-heading" tabIndex={-1}>{draft.action==='close'?'Close mapping':'Approve mapping'}</h3>
    {draft.action==='close'&&<p className="field-help">The mapping stops applying from this date. Earlier approvals stay in history.</p>}
    {draft.action==='approve'&&categories&&<>
     <label htmlFor="mapping-category-account">Account</label>
     <select id="mapping-category-account" required disabled={controlsDisabled} value={draft.accountId}
      onChange={event=>setDraft({...draft,accountId:event.target.value})}>
      <option value="">Choose an account</option>
      {choices?.rows.map(account=><option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
     </select>
     {choices?.hasMore&&<div className={styles.actions}>
      <button type="button" className="secondary" disabled={controlsDisabled} onClick={loadMoreAccounts}>Load more accounts</button>
     </div>}
    </>}
    <label htmlFor="mapping-approval-date">Effective from</label>
    <input id="mapping-approval-date" type="date" required disabled={controlsDisabled} value={draft.date}
     aria-describedby={latest?'mapping-approval-date-help':undefined}
     onChange={event=>setDraft({...draft,date:event.target.value})}/>
    {latest&&<p id="mapping-approval-date-help" className="field-help">Choose a date after {dateLabel(latest.effectiveFrom)}.</p>}
    <label htmlFor="mapping-approval-reason">{draft.action==='close'?'Closure reason':'Approval reason'}</label>
    <textarea id="mapping-approval-reason" rows={2} maxLength={1000} required disabled={controlsDisabled}
     value={draft.reason} onChange={event=>setDraft({...draft,reason:event.target.value})}/>
    <div className="mapping-rule-comparison" aria-label="Rule comparison">
     <section aria-label="Latest saved rule">
      <h4>Latest saved rule</h4>
      <dl>
       <dt>Posting account</dt><dd>{workspace.saved?.accountCode??(latest?'Mapping closed':'No approved rule')}</dd>
       <dt>Effective period</dt><dd>{latest?<>From {dateLabel(latest.effectiveFrom)}{customerDate(draft.date)&&draft.date>latest.effectiveFrom&&<> · Before {dateLabel(draft.date)} if saved</>}</>:'No saved effective period'}</dd>
       <dt>Reason</dt><dd>{workspace.saved?.reason??'No saved reason'}</dd>
      </dl>
     </section>
     <section aria-label="Proposed rule">
      <h4>Proposed rule</h4>
      <dl>
       <dt>Posting account</dt><dd>{draft.action==='close'?'No posting account from this date':proposedAccount?proposedAccount.code+' · '+proposedAccount.name:'Choose an account'}</dd>
       <dt>Effective period</dt><dd>{customerDate(draft.date)?'From '+dateLabel(draft.date):'Choose an effective date'}</dd>
       <dt>Reason</dt><dd>{draft.reason.trim()||'Enter a reason'}</dd>
      </dl>
     </section>
    </div>
    <div className={styles.actions}>
     <button type="submit" disabled={controlsDisabled||!validDraft}>{draft.action==='close'?'Save closure':'Save approval'}</button>
     <button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>{setDraft(null);status.current?.focus();}}>Cancel</button>
    </div>
   </form>}
   </div>
   <MappingApprovalHistory embedded history={workspace.history} purpose={workspace.data.purpose} categories={categories}
    heading={historyHeading} disabled={controlsDisabled} download={downloadHistory} more={loadMoreHistory}/>
   </div>
  </section>}
  {pending&&<section aria-label="Interrupted mapping approval">
   <h2>Interrupted approval</h2>
   <p>{financeMappingLabels[pending.reference.purpose]}</p>
   <details className="mapping-save-reference"><summary>Save reference</summary><p className="save-reference"><code>{pending.reference.operationId}</code></p></details>
   <div className={styles.actions}>
    <button type="button" className="secondary" disabled={controlsDisabled} onClick={()=>load(true)}>Check approval status</button>
    {review==='retry'&&<button className="secondary" type="button" disabled={controlsDisabled} onClick={retry}>Retry original approval</button>}
   </div>
   {review==='retire'&&<form onSubmit={retire}>
    <p className="field-help">Closing this attempt prevents it from saving later. If an approval already saved, it stays in history.</p>
    <label htmlFor="mapping-attempt-reason">Reason for closing the attempt</label>
    <textarea id="mapping-attempt-reason" rows={2} maxLength={1000} required disabled={controlsDisabled}
     value={reviewReason} onChange={event=>setReviewReason(event.target.value)}/>
    <button type="submit" disabled={controlsDisabled||!financeAccountReviewReason(reviewReason.trim())}>Close interrupted attempt</button>
   </form>}
  </section>}
 </section>;
}
