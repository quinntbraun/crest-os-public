'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {AuthenticationError} from '../../../../client/authentication';
import {
 clearPendingFinanceTax,financeAccounts,readPendingFinanceTax,retainPendingFinanceTax,
} from '../../../../client/finance-accounts';
import type {FinanceAccountContext} from '../../../../client/finance-accounts';
import {financeAccountReviewReason,requireFinanceAccount as check} from '../../../../bookkeeping/finance-account-contract';
import {financeTaxTreatmentLabels,parseFinanceTaxApproval} from '../../../../bookkeeping/finance-tax-contract';
import type {FinanceTaxScope} from '../../../../bookkeeping/finance-tax-contract';
import styles from '../screen.module.css';

type Latest=Awaited<ReturnType<typeof financeAccounts.taxHistory>>['rows'][number];
type Pending=NonNullable<ReturnType<typeof readPendingFinanceTax>>;
type Reviewed={context:FinanceAccountContext;latest:Latest|null};
const blankDraft={date:'',treatment:'',rate:'',evidence:'',reason:''};
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
const dateLabel=(date:string)=>dateFormat.format(new Date(date+'T00:00:00Z'));

function approvalFrom(scope:FinanceTaxScope,draft:typeof blankDraft,latest:Latest|null){
 try{
  if(latest&&draft.date<=latest.effectiveFrom)return null;
  return parseFinanceTaxApproval({...scope,effectiveFrom:draft.date,treatment:draft.treatment,
   rate:draft.treatment==='inclusive_single'?draft.rate.trim().replace(/(\.\d*?[1-9])0+$/,'$1').replace(/\.0+$/,''):null,
   verificationEvidence:draft.treatment==='unresolved'?null:draft.evidence.trim(),reason:draft.reason.trim()});
 }catch{return null;}
}

export function TaxApprovalEditor({scope,disabled,onSaved}:{
 scope:FinanceTaxScope|null;disabled:boolean;onSaved:()=>void;
}){
 const [reviewed,setReviewed]=useState<Reviewed|null>(null),[draft,setDraft]=useState(blankDraft);
 const [pending,setPending]=useState<Pending|null>(null),[canClose,setCanClose]=useState(false);
 const [closeReason,setCloseReason]=useState(''),[message,setMessage]=useState('');
 const [busy,setBusy]=useState(false),[signedOut,setSignedOut]=useState(false);
 const active=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const latest=reviewed?.latest;
 const approval=scope&&reviewed?approvalFrom(scope,draft,reviewed.latest):null;
 const clear=useCallback(()=>{
  active.current?.abort();active.current=null;setReviewed(null);setDraft(blankDraft);setPending(null);
  setCanClose(false);setCloseReason('');setMessage('');setBusy(false);setSignedOut(false);
 },[]);
 useEffect(()=>{
  const hide=()=>{if(document.visibilityState==='hidden')clear();};
  const restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hide);
  window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restore);
  return()=>{
   active.current?.abort();active.current=null;
   document.removeEventListener('visibilitychange',hide);
   window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);
  };
 },[clear]);

 async function run(work:(context:FinanceAccountContext,signal:AbortSignal)=>Promise<void>,failure:string){
  if(active.current||disabled)return;
  const controller=new AbortController(),signal=controller.signal;
  active.current=controller;setBusy(true);setSignedOut(false);setCanClose(false);setCloseReason('');
  try{
   const context=await financeAccounts.context(signal);
   check(!signal.aborted&&context.taxProfiles);
   await work(context,signal);
  }catch(error){
   if(signal.aborted)return;
   const denied=error instanceof AuthenticationError&&error.kind==='denied';
   if(denied){setReviewed(null);setDraft(blankDraft);setPending(null);}
   setSignedOut(denied);setMessage(denied?'Sign in again to manage tax approvals.':failure);
  }finally{
   if(active.current===controller){active.current=null;setBusy(false);status.current?.focus();}
  }
 }
 function finish(entry:Pending,signal:AbortSignal,saved:boolean,messageAfter:string){
  check(!signal.aborted);clearPendingFinanceTax(entry);
  setPending(null);setReviewed(null);setDraft(blankDraft);setMessage(messageAfter);
  if(saved)onSaved();
 }
 async function lookup(context:FinanceAccountContext,entry:Pending,signal:AbortSignal){
  check(context.businessId===entry.businessId);
  setPending(entry);setReviewed(null);setDraft(blankDraft);
  const result=await financeAccounts.taxOperation(context,entry.reference,signal);
  check(!signal.aborted);
  if(result.state==='committed'||result.state==='retired'){
   finish(entry,signal,result.state==='committed',result.state==='committed'?'The original tax approval was confirmed.':
    'The interrupted tax approval was closed.');return;
  }
  if(result.state==='conflict'){
   setMessage('The saved operation does not match this reference. Keep it for review.');return;
  }
  setCanClose(context.writeState==='ready');
  setMessage(context.writeState==='ready'?'No completed approval was found. Review and close this attempt before starting a new approval.':
   'No completed approval was found. Approval review can resume after recovery review.');
 }
 function load(reviewOnly=false){
  setReviewed(null);setDraft(blankDraft);
  setMessage(reviewOnly?'Checking the interrupted approval…':'Checking the latest approval…');
  void run(async(context,signal)=>{
   const entry=readPendingFinanceTax();
   if(entry){await lookup(context,entry,signal);return;}
   if(reviewOnly){setMessage('There is no interrupted approval in this tab.');return;}
   check(scope);
   const history=await financeAccounts.taxHistory(context,scope,null,signal);
   check(!signal.aborted);setDraft(blankDraft);
   if(context.writeState!=='ready'){setMessage('Tax approvals are paused for recovery review.');return;}
   setReviewed({context,latest:history.rows[0]??null});
   setMessage(history.rows.length?'Latest approval loaded.':'This will be the first approval for this selection.');
  },'Crest could not verify the approval settings. Try again.');
 }
 function submit(event:FormEvent){
  event.preventDefault();
  if(!approval||!reviewed||pending)return;
  const expectedVersion=latest?.version??'0';
  void run(async(context,signal)=>{
   if(context.writeState!=='ready'||!context.recoveryEpoch){setMessage('Tax approvals are paused for recovery review.');return;}
   if(context.businessId!==reviewed.context.businessId||context.binding!==reviewed.context.binding
    ||context.recoveryEpoch!==reviewed.context.recoveryEpoch){
    setReviewed(null);setDraft(blankDraft);setMessage('Approval settings changed. Reload them before saving.');return;
   }
   let entry:Pending;
   try{entry=retainPendingFinanceTax(context,{operationId:crypto.randomUUID(),recoveryEpoch:context.recoveryEpoch,expectedVersion});}
   catch{setMessage('Crest could not retain a recovery reference. The approval was not sent.');return;}
   setPending(entry);setReviewed(null);setDraft(blankDraft);setMessage('Saving tax approval…');
   const result=await financeAccounts.approveTaxProfile(context,entry.reference,approval,signal);
   check(!signal.aborted);
   if(result.state==='committed'){finish(entry,signal,true,'Tax approval saved.');return;}
   const recentSignIn=result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED';
   setSignedOut(recentSignIn);
   setMessage(recentSignIn?'Sign in again, then check the original approval.':'The approval could not be confirmed. Check its status before starting another.');
  },'The approval could not be confirmed. Check its status before starting another.');
 }
 function retire(event:FormEvent){
  event.preventDefault();
  const reason=closeReason.trim();
  if(!pending||!canClose||!financeAccountReviewReason(reason))return;
  void run(async(context,signal)=>{
   check(context.businessId===pending.businessId&&JSON.stringify(readPendingFinanceTax())===JSON.stringify(pending));
   setMessage('Closing the interrupted approval…');
   const result=await financeAccounts.retireTaxApproval(context,pending.reference,reason,signal);
   check(!signal.aborted);
   if(result.state==='committed'||result.state==='retired'){
    finish(pending,signal,result.state==='committed',result.state==='committed'?'The original tax approval was confirmed.':
     'The interrupted tax approval was closed.');return;
   }
   if(result.state==='rejected'&&result.reason==='FINANCE_ACCOUNT_SIGN_IN_REQUIRED')setSignedOut(true);
   setMessage('Crest could not close this attempt. Check its status again.');
  },'Crest could not confirm the closure. Check the approval status again.');
 }
 function change(field:keyof typeof blankDraft,value:string){setDraft(current=>({...current,[field]:value}));}
 const locked=disabled||busy;
 return <section aria-label="Manage tax approvals" aria-busy={busy}>
   <p role="status" tabIndex={-1} ref={status}>{message}</p>
   {signedOut&&<a href="/sign-in">Sign in again</a>}
   {!reviewed&&<div className={styles.actions}>
    {!pending&&<button type="button" className="secondary" disabled={locked||!scope} onClick={()=>load()}>Load approval settings</button>}
    <button type="button" className="secondary" disabled={locked} onClick={()=>load(true)}>Check interrupted approval</button>
   </div>}
   {reviewed&&!pending&&<form onSubmit={submit}>
    {latest&&<p>Latest version {latest.version} · Effective {dateLabel(latest.effectiveFrom)}</p>}
    <label htmlFor="tax-approval-date">Effective from</label>
    <input id="tax-approval-date" type="date" required value={draft.date} disabled={locked}
     aria-describedby={latest?'tax-approval-date-help':undefined} onChange={event=>change('date',event.target.value)}/>
    {latest&&<p id="tax-approval-date-help" className="field-help">Choose a date after {dateLabel(latest.effectiveFrom)}.</p>}
    <label htmlFor="tax-approval-treatment">Tax treatment</label>
    <select id="tax-approval-treatment" required value={draft.treatment} disabled={locked}
     onChange={event=>change('treatment',event.target.value)}>
     <option value="">Choose a treatment</option>
     {Object.entries(financeTaxTreatmentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select>
    {draft.treatment==='inclusive_single'&&<>
     <label htmlFor="tax-approval-rate">Decimal rate</label>
     <input id="tax-approval-rate" inputMode="decimal" maxLength={128} required value={draft.rate} disabled={locked}
      aria-describedby="tax-approval-rate-help" onChange={event=>change('rate',event.target.value)}/>
     <p id="tax-approval-rate-help" className="field-help">Enter the verified rate as a decimal. For example, 0.08 is 8%.</p>
    </>}
    {draft.treatment&&draft.treatment!=='unresolved'&&<>
     <label htmlFor="tax-approval-evidence">Verification evidence</label>
     <textarea id="tax-approval-evidence" rows={2} maxLength={1000} required value={draft.evidence} disabled={locked}
      onChange={event=>change('evidence',event.target.value)}/>
    </>}
    <label htmlFor="tax-approval-reason">Approval reason</label>
    <textarea id="tax-approval-reason" rows={2} maxLength={1000} required value={draft.reason} disabled={locked}
     onChange={event=>change('reason',event.target.value)}/>
    <div className={styles.actions}>
     <button type="submit" disabled={locked||!approval}>Save tax approval</button>
     <button type="button" className="secondary" disabled={locked} onClick={()=>{
      setReviewed(null);setDraft(blankDraft);setMessage('Approval draft cleared.');status.current?.focus();
     }}>Cancel</button>
    </div>
   </form>}
   {pending&&canClose&&<form onSubmit={retire}>
    <label htmlFor="tax-approval-close-reason">Reason to close this attempt</label>
    <textarea id="tax-approval-close-reason" rows={2} maxLength={1000} required value={closeReason} disabled={locked}
     onChange={event=>setCloseReason(event.target.value)}/>
    <div className={styles.actions}><button type="submit" disabled={locked||!financeAccountReviewReason(closeReason.trim())}>
     Close interrupted attempt
    </button></div>
   </form>}
 </section>;
}
