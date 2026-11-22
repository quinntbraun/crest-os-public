'use client';
import {SignInLink} from "../sign-in-link";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {createExpenseClient} from '../../client/expenses';
import {createReceiptClient} from '../../client/expense-receipts';
import {financeAccounts} from '../../client/finance-accounts';
import type {FinanceAccountContext} from '../../client/finance-accounts';
import {ExpenseEditor,ExpenseRecordPlaceholder} from './expense-editor';
import type {ExpensePane} from './expense-editor';
import {SupplierBillDrafts} from './supplier-bill-drafts';
import {SupplierPayableRegister} from './supplier-payables';
export function ExpensesScreen({initialPane='purchases'}:{initialPane?:ExpensePane}){
 const client=useMemo(()=>createExpenseClient(authentication.session),[]),active=useRef<AbortController|null>(null),[phase,setPhase]=useState<'checking'|'ready'|'signed-out'|'unavailable'>('checking');
 const receiptService=useMemo(()=>createReceiptClient(authentication.session,false,{
  getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key),
 }),[]);
 const [financeContext,setFinanceContext]=useState<FinanceAccountContext|null>(null);
 const [pane,setPane]=useState<ExpensePane>(initialPane);
 function choosePane(next:ExpensePane){
  setPane(next);const url=new URL('/expenses',window.location.origin);if(next!=='purchases')url.searchParams.set('view',next);
  window.history.replaceState(null,'',url.pathname+url.search);
 }
 const accessStatus=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(phase==='signed-out')accessStatus.current?.focus();},[phase]);
 const accessDenied=useCallback(()=>{
  active.current?.abort();active.current=null;setFinanceContext(null);setPhase('signed-out');
 },[]);
 const checkAccess=useCallback(()=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;
  void authentication.session(controller.signal).then(async proof=>{
   if(active.current!==controller||controller.signal.aborted||document.visibilityState==='hidden')return;
   setPhase('ready');
   const finance=await financeAccounts.context(controller.signal,proof).catch(()=>null);
   if(active.current===controller&&!controller.signal.aborted)setFinanceContext(finance);
  }).catch(error=>{if(active.current===controller&&!controller.signal.aborted)setPhase(error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable');}).finally(()=>{if(active.current===controller)active.current=null;});
 },[]);
 useEffect(()=>{
  checkAccess();const clear=()=>{active.current?.abort();active.current=null;setPhase('unavailable');setFinanceContext(null);},hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{active.current?.abort();active.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[checkAccess]);
 if(phase==='checking')return <>
  <div className="expense-workbench-navigation expense-placeholder-controls" aria-hidden="true">
   <span className="workspace-skeleton"/><span className="workspace-skeleton"/>
  </div>
  <div className="expense-workbench-toolbar expense-placeholder-controls" aria-hidden="true">
   <span className="workspace-skeleton"/><span className="workspace-skeleton"/>
  </div>
  <p className="expense-workbench-status" role="status">Checking expense access…</p>
  <div className="expense-records"><h2>Saved expenses</h2><ExpenseRecordPlaceholder/></div>
 </>;
 if(phase==='signed-out')return <><p ref={accessStatus} tabIndex={-1} role="status">Sign in to view expenses.</p><SignInLink className="primary-action" returnTo="expenses" context={pane==='purchases'?{}:{view:pane}}>Sign in to view expenses</SignInLink></>;
 if(phase==='unavailable')return <><p role="status">Expense access needs to be checked before private records are shown.</p><button type="button" onClick={()=>{setPhase('checking');checkAccess();}}>Check expense access</button><SignInLink returnTo="expenses">Check sign-in</SignInLink></>;
 const sameDayExpenses=financeContext?.sameDayExpenses===true;
 const suppliers=financeContext?.supplierBillDrafts||financeContext?.supplierPayableReview;
 const activePane=pane==='suppliers'&&!suppliers?'purchases':pane;
 return <>
  <nav className="expense-workbench-navigation" aria-label="Expense views">
   <button type="button" className="secondary" aria-pressed={activePane==='purchases'} onClick={()=>choosePane('purchases')}>Purchases</button>
   {suppliers&&<button type="button" className="secondary" aria-pressed={activePane==='suppliers'} onClick={()=>choosePane('suppliers')}>Suppliers</button>}
   <button type="button" className="secondary" aria-pressed={activePane==='exports'} onClick={()=>choosePane('exports')}>Exports</button>
  </nav>
  <ExpenseEditor client={client} receiptService={receiptService} embedded sameDayExpenses={sameDayExpenses} pane={activePane} onAccessDenied={accessDenied}/>
  {suppliers&&<div className="expense-supplier-panel" hidden={activePane!=='suppliers'}>
   <h2>Supplier bills and payables</h2>
   {financeContext?.supplierBillDrafts&&<SupplierBillDrafts context={financeContext} onAccessDenied={accessDenied}/>}
   {financeContext?.supplierPayableReview&&<SupplierPayableRegister context={financeContext}/>}
  </div>}
  <nav aria-label="Expense workspace navigation"><a href="/save-review?kind=bookkeeping.expense.save">Review an interrupted expense</a><SignInLink returnTo="expenses">Check sign-in</SignInLink></nav>
 </>;
}
