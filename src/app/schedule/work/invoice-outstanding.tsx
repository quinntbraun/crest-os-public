'use client';
import {SignInLink} from "../../sign-in-link";



import {useCallback,useEffect,useRef,useState} from 'react';
import {financeAccounts} from '../../../client/finance-accounts';
import {watchFinanceActivity} from '../../../client/finance-activity';
import {AuthenticationError} from '../../../client/authentication';
import {quoteMoney} from '../../../commercial/quote-pricing';
import type {IssuedInvoice} from './invoice-issue-tax-review';

type Snapshot=Extract<Awaited<ReturnType<typeof financeAccounts.invoiceOutstanding>>,{state:'ready'}>&{checkedTime:string};
const dateFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});

export function InvoiceOutstanding({businessId,invoice}:{businessId:string;invoice:IssuedInvoice}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [busy,setBusy]=useState(false),[active,setActive]=useState(0);
 const [message,setMessage]=useState('Check the current amount still owed.');
 const [signIn,setSignIn]=useState(false);
 const request=useRef<AbortController|null>(null),status=useRef<HTMLParagraphElement>(null);
 const clear=useCallback(()=>{
  request.current?.abort();request.current=null;
  setSnapshot(null);setBusy(false);setSignIn(false);
  setMessage('Check the balance again before relying on this amount.');
 },[]);
 useEffect(()=>{
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);
  const unwatch=watchFinanceActivity(count=>{setActive(count);if(count>0)clear();});
  return ()=>{request.current?.abort();unwatch();document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);};
 },[clear]);
 async function check(){
  if(request.current||active>0)return;
  const controller=new AbortController();request.current=controller;
  setBusy(true);setSnapshot(null);setSignIn(false);setMessage('Checking the saved invoice balance…');
  try{
   const context=await financeAccounts.context(controller.signal);
   if(controller.signal.aborted)return;
   if(context.businessId!==businessId||!context.invoiceOutstanding){setMessage('Balance checking is unavailable in this workspace.');return;}
   if(context.writeState!=='ready'){setMessage('Balance checking is paused for recovery review.');return;}
   const result=await financeAccounts.invoiceOutstanding(context,invoice.customer.id,invoice.invoiceId,controller.signal);
   if(controller.signal.aborted)return;
   if(result.state==='absent'){setMessage('This invoice is unavailable. Reopen its saved record.');return;}
   if(result.invoiceNumber!==invoice.invoiceNumber||result.originalCents!==invoice.totalCents
    ||result.issuedOn!==invoice.issuedOn||result.dueOn!==invoice.dueOn)throw Error('INVOICE_CONTEXT_CHANGED');
   const current=await financeAccounts.context(controller.signal);
   if(controller.signal.aborted)return;
   if(current.businessId!==businessId||current.binding!==context.binding||current.recoveryEpoch!==context.recoveryEpoch
    ||current.writeState!=='ready'||!current.invoiceOutstanding)throw Error('INVOICE_CONTEXT_CHANGED');
   if(result.state==='not_effective'){setMessage('This invoice is dated after the checked business date. No current balance is shown.');return;}
   const checkedTime=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:result.timeZone}).format(new Date(result.observedAt));
   setSnapshot({...result,checkedTime});setMessage('Balance checked. Check again after payments or adjustments.');
  }catch(error){
   if(!controller.signal.aborted){setSnapshot(null);const denied=error instanceof AuthenticationError&&error.kind==='denied';
    setSignIn(denied);setMessage(denied?'Sign in again to check the balance.':'The balance could not be verified. Try checking again.');}
  }finally{
   if(request.current===controller){request.current=null;setBusy(false);status.current?.focus();}
  }
 }
 return <section className="invoice-outstanding" aria-label="Invoice outstanding balance" aria-busy={busy}>
  <div className="invoice-outstanding-value"><span>{snapshot?(snapshot.outstandingCents==='0'?'Nothing due':'Outstanding'):'Outstanding not checked'}</span>
   {snapshot&&<strong>{quoteMoney(snapshot.outstandingCents)}</strong>}</div>
  {snapshot&&<p className="invoice-outstanding-checked">Through {dateFormat.format(new Date(snapshot.throughOn+'T12:00:00Z'))}
   {' · Checked '+snapshot.checkedTime}
   {' · '+snapshot.timeZone}</p>}
  <p ref={status} role="status" tabIndex={-1}>{active>0?'Finish the current financial task, then check the balance again.':message}</p>
  {signIn?<SignInLink className="button secondary" returnTo="schedule">Sign in again</SignInLink>:<button type="button" className="secondary" disabled={busy||active>0} onClick={()=>void check()}>{busy?'Checking balance…':snapshot?'Check balance again':'Check balance'}</button>}
 </section>;
}
