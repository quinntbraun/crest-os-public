'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AuthenticationError} from '../../client/authentication';
import {financeAccounts} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {createPendingSupplierPostingStore} from '../../client/pending-supplier-posting';
import type {PendingSupplierPosting} from '../../client/pending-supplier-posting';
import {SignInLink} from '../sign-in-link';
import {SupplierBillDrafts} from './supplier-bill-drafts';
import {SupplierPayableRegister} from './supplier-payables';
import {SupplierPostingReentry} from './supplier-posting-reentry';

type Register=Awaited<ReturnType<typeof financeAccounts.supplierPayableRegister>>;
type State={phase:'checking'|'ready'|'original'|'blocked';entry:PendingSupplierPosting|null;reentry:boolean;message:string;report:Register|null;reportNotice:string};
const initial:State={phase:'checking',entry:null,reentry:false,message:'Checking interrupted supplier postings…',report:null,reportNotice:''};

export function SupplierWorkspace({context,onAccessDenied,throughOn='',onThroughOnChange}:{context:FinanceAccountContext;onAccessDenied:()=>void;throughOn?:string;onThroughOnChange?:(value:string)=>void}){
 const store=useMemo(()=>createPendingSupplierPostingStore({getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)}),[]);
 const [state,setState]=useState<State>(initial),[busy,setBusy]=useState(false),[absent,setAbsent]=useState(false);
 const active=useRef<AbortController|null>(null),notice=useRef<HTMLParagraphElement>(null);
 useLayoutEffect(()=>{if(state.phase==='original'||state.phase==='blocked')notice.current?.focus();},[state.phase]);
 useEffect(()=>{
  let cancelled=false;
  void Promise.resolve().then(()=>store.read()).then(entry=>{
   if(cancelled)return;
   if(!entry){setState({...initial,phase:'ready',message:''});return;}
   if(entry.businessId!==context.businessId){setState({...initial,phase:'blocked',message:'An interrupted supplier posting belongs to another workspace. Its reference is retained. Return to the original workspace before recording another posting.'});return;}
   if(!context.supplierPayablePosting){setState({...initial,phase:'blocked',message:'This workspace cannot check the interrupted supplier posting. Its reference is retained. Check access before continuing.'});return;}
   const message=entry.reference.kind==='payable'?'Check the earlier supplier bill posting before posting another bill.':'Check the earlier supplier payment before recording another payment.';
   setState({...initial,phase:'original',entry,message:(entry.binding!==context.binding?'Your sign-in changed. ':'')+message});
  }).catch(()=>{if(!cancelled)setState({...initial,phase:'blocked',message:'The interrupted supplier posting reference needs review. It is retained; another posting is blocked.'});});
  return()=>{cancelled=true;active.current?.abort();};
 },[context.businessId,context.binding,context.supplierPayablePosting,store]);

 async function checkOriginal(){
  if(active.current||!state.entry)return;
  const entry=state.entry,request=new AbortController();active.current=request;setBusy(true);setAbsent(false);
  try{
   store.require(entry);
   const result=await financeAccounts.lookupSupplierPosting(context,entry.reference,request.signal);
   if(request.signal.aborted)return;
   if(result.state==='absent'){setAbsent(true);setState(previous=>({...previous,message:'No committed entry was found for this original request. Review the original record before retrying with the same reference.'}));return;}
   if(result.state!=='committed'){setState(previous=>({...previous,phase:'blocked',message:'This original posting reference does not match. It is retained; another posting is blocked until it is reviewed.'}));return;}
   store.clear(entry);
   const message=entry.reference.kind==='payable'?'Supplier bill posted. Reload Recorded supplier payables.':'Verified supplier payment recorded.';
   if(entry.reference.kind==='settlement'){
    // Re-read actual current balances after the verified original receipt.
    // An unavailable register does not turn a committed payment into unknown.
    let report:Register|null=null;
    try{report=await financeAccounts.supplierPayableRegister(context,throughOn||null,null,request.signal);}
    catch(error){if(error instanceof AuthenticationError&&error.kind==='denied'){onAccessDenied();return;}}
    if(request.signal.aborted)return;
    setState({...initial,phase:'ready',message:report?'':message+' Load Recorded supplier payables to check the current balances.',report,reportNotice:message});
   }else setState({...initial,phase:'ready',message});
  }catch(error){if(!request.signal.aborted){
   if(error instanceof AuthenticationError&&error.kind==='denied'){onAccessDenied();return;}
   setState(previous=>({...previous,message:'The original posting could not be checked. Its reference is retained. Check access and try the original lookup again.'}));
  }}finally{if(active.current===request){active.current=null;setBusy(false);}}
 }
 function reviewOriginal(){
  if(!absent||!state.entry||busy)return;
  try{store.require(state.entry);setState(previous=>({...previous,phase:'ready',reentry:true,message:'Review the original saved bill or payment below. Other supplier postings stay blocked until this original is resolved.'}));}
  catch{setState(previous=>({...previous,phase:'blocked',message:'The original posting reference changed. It is retained; check the original workspace before continuing.'}));}
 }

 if(state.phase!=='ready')return <section className="expense-editor" aria-label="Interrupted supplier posting">
  <h3>{state.entry?.reference.kind==='settlement'?'Check a supplier payment':'Check a supplier posting'}</h3>
  <p ref={notice} tabIndex={-1} role="status">{state.message}</p>
  {state.phase==='original'&&<>
   <button type="button" disabled={busy} onClick={()=>void checkOriginal()}>{busy?'Checking original posting…':'Check original posting request'}</button>
   <p className="field-help">Private bill and payment details were cleared. Checking this reference won’t record another posting.</p>
   {absent&&<button type="button" className="secondary" disabled={busy} onClick={reviewOriginal}>Review the original record again</button>}
   <details className="settings-save-reference"><summary>Original posting reference</summary><p className="save-reference"><code>{state.entry?.reference.operationId}</code></p></details>
  </>}
  {state.phase==='blocked'&&<SignInLink returnTo="expenses" context={{view:'suppliers'}}>Check the original sign-in</SignInLink>}
 </section>;
 return <SupplierPostingReentry.Provider value={{reentry:state.reentry?state.entry:null,onResolved:()=>setState(previous=>({...previous,entry:null,reentry:false,message:''})),onAccessDenied}}>
  {state.message&&<p role="status">{state.message}</p>}
  {context.supplierBillDrafts&&<SupplierBillDrafts context={context} onAccessDenied={onAccessDenied}/>}
  {context.supplierPayableReview&&<SupplierPayableRegister context={context} initialReport={state.report} initialNotice={state.reportNotice} initialThroughOn={throughOn} {...(onThroughOnChange?{onThroughOnChange}:{})}/>}
 </SupplierPostingReentry.Provider>;
}
