'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {authentication,AuthenticationError} from '../../client/authentication';
import {createExpenseClient} from '../../client/expenses';
import {ExpenseEditor} from './expense-editor';
export function ExpensesScreen(){
 const client=useMemo(()=>createExpenseClient(authentication.session),[]),active=useRef<AbortController|null>(null),[phase,setPhase]=useState<'checking'|'ready'|'signed-out'|'unavailable'>('checking');
 const checkAccess=useCallback(()=>{
  active.current?.abort();const controller=new AbortController();active.current=controller;
  void authentication.session(controller.signal).then(()=>{if(active.current===controller&&!controller.signal.aborted&&document.visibilityState!=='hidden')setPhase('ready');}).catch(error=>{if(active.current===controller&&!controller.signal.aborted)setPhase(error instanceof AuthenticationError&&error.kind==='denied'?'signed-out':'unavailable');}).finally(()=>{if(active.current===controller)active.current=null;});
 },[]);
 useEffect(()=>{
  checkAccess();const clear=()=>{active.current?.abort();active.current=null;setPhase('unavailable');},hidden=()=>{if(document.visibilityState==='hidden')clear();},restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restored);
  return()=>{active.current?.abort();active.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restored);};
 },[checkAccess]);
 if(phase==='checking')return <p role="status">Checking expense access…</p>;
 if(phase==='signed-out')return <><p role="status">Sign in to view expenses.</p><a className="primary-action" href="/sign-in">Sign in to view expenses</a></>;
 if(phase==='unavailable')return <><p role="status">Expense access needs to be checked before private records are shown.</p><button type="button" onClick={()=>{setPhase('checking');checkAccess();}}>Check expense access</button><a href="/sign-in">Check sign-in</a></>;
 return <>
  <p>Record paid purchases and keep their corrections and history.</p>
  <p className="field-help">Receipt attachments and full accounting are still in development for this test build.</p>
  <ExpenseEditor client={client} embedded/>
  <nav aria-label="Expense workspace navigation"><a href="/save-review?kind=bookkeeping.expense.save">Review an interrupted expense</a><a href="/sign-in">Check sign-in</a></nav>
 </>;
}
