'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {reviewStatementMatches} from '../../../bookkeeping/statement-match-review';
import {financeAccounts,type FinanceAccountContext} from '../../../client/finance-accounts';
import styles from './screen.module.css';

type Snapshot=Awaited<ReturnType<typeof financeAccounts.readStatementMatchReview>>;
type Match={statementRowId:string;movementId:string;signedCents:string};

export function StatementMatchReview({context,statementId,format,parse}:{
 context:FinanceAccountContext;statementId:string;format:(cents:string)=>string;parse:(dollars:string)=>string;
}){
 const [fromOn,setFromOn]=useState('');
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [matches,setMatches]=useState<Match[]>([]);
 const [rowId,setRowId]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const controller=useRef<AbortController|null>(null);
 const id=useId();
 function clear(){
  controller.current?.abort();controller.current=null;
  setSnapshot(null);setMatches([]);setRowId('');setMessage('');setBusy(false);
 }
 useEffect(()=>{
  const hide=()=>{if(document.visibilityState==='hidden')clear();};
  document.addEventListener('visibilitychange',hide);
  window.addEventListener('pagehide',clear);
  return ()=>{
   controller.current?.abort();
   document.removeEventListener('visibilitychange',hide);
   window.removeEventListener('pagehide',clear);
  };
 },[]);
 async function load(){
  clear();
  const request=new AbortController(),{signal}=request;
  controller.current=request;setBusy(true);
  try{
   const result=await financeAccounts.readStatementMatchReview(context,statementId,fromOn||null,signal);
   if(signal.aborted)return;
   setSnapshot(result);
   setMessage(result.movements.length?'Posted movements loaded.':'There are no posted movements in this search window.');
  }catch{if(!signal.aborted)setMessage('Crest could not verify this search. Check the statement or try a later movement start date.');}
  finally{if(controller.current===request){controller.current=null;setBusy(false);}}
 }
 const byMovement=new Map(snapshot?.movements.map(row=>[row.id,row]));
 const assessment=snapshot?reviewStatementMatches(snapshot,matches,id=>byMovement.get(id)):null;
 const remainingRows=new Map(assessment?.outstanding.map(row=>[row.rowId,row.remainingCents]));
 const allocatedMovements=new Map<string,bigint>();
 for(const match of matches){
  allocatedMovements.set(match.movementId,(allocatedMovements.get(match.movementId)??0n)+BigInt(match.signedCents));
 }
 const selected=snapshot?.rows.find(row=>row.id===rowId);
 const eligible=selected&&remainingRows.has(selected.id)?snapshot!.movements
  .filter(row=>row.effectiveOn<=selected.statementOn&&row.signedCents.startsWith('-')===selected.signedCents.startsWith('-'))
  .map(row=>({...row,remainingCents:String(BigInt(row.signedCents)-BigInt(row.previouslyMatchedCents)-(allocatedMovements.get(row.id)??0n))}))
  .filter(row=>row.remainingCents!=='0'):[];
 function add(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!snapshot||!selected)return;
  try{
   const data=new FormData(event.currentTarget);
   const proposal=[...matches,{statementRowId:selected.id,movementId:String(data.get('movement')),
    signedCents:parse(String(data.get('amount')).trim())}];
   reviewStatementMatches(snapshot,proposal,id=>byMovement.get(id));
   setMatches(proposal);setMessage('Proposed allocation added.');event.currentTarget.reset();
  }catch{setMessage('Check the signed amount. It must fit both amounts that remain available.');}
 }
 return <details className={styles.openingGroup} onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Review statement matches</summary>
  <section aria-label="Statement match review" aria-busy={busy}>
   <p>Compare statement rows with posted movements. The proposed allocations stay on this screen.</p>
   <form onSubmit={event=>{event.preventDefault();void load();}}>
    <label htmlFor={id+'-date'}>Search for posted movements from (optional)</label>
    <input id={id+'-date'} type="date" value={fromOn} onChange={event=>{clear();setFromOn(event.target.value);}} disabled={busy}/>
    <button className="secondary" type="submit" disabled={busy}>Load posted movements</button>
   </form>
   <p role="status">{message}</p>
   {snapshot&&assessment&&<>
    {snapshot.statementDifferenceCents!=='0'&&<p>Resolve the {format(snapshot.statementDifferenceCents)} statement difference before approving any reconciliation.</p>}
    <p>{assessment.outstanding.length===0?'Every statement row is fully allocated in this preview.':
     [assessment.outstanding.length,assessment.outstanding.length===1?'statement row needs a match.':'statement rows need matching.'].join(' ')}</p>
    {snapshot.rows.length>0&&snapshot.movements.length>0&&<form onSubmit={add}>
     <label htmlFor={id+'-row'}>Statement row</label>
     <select id={id+'-row'} value={rowId} onChange={event=>setRowId(event.target.value)} required>
      <option value="">Choose a statement row</option>
      {snapshot.rows.map((row,index)=><option key={row.id} value={row.id} disabled={!remainingRows.has(row.id)}>
       {index+1}. {row.statementOn} · {format(remainingRows.get(row.id)??'0')} remaining
      </option>)}
     </select>
     {selected&&remainingRows.has(selected.id)&&eligible.length===0&&<p>No posted movements in this search match the row’s direction and date.</p>}
     {eligible.length>0&&<>
      <label htmlFor={id+'-movement'}>Posted movement</label>
      <select id={id+'-movement'} name="movement" required key={rowId}>
       <option value="">Choose a posted movement</option>
       {eligible.map(row=><option key={row.id} value={row.id}>{row.effectiveOn} · {format(row.remainingCents)} remaining · {row.id.slice(0,8)}</option>)}
      </select>
      <label htmlFor={id+'-amount'}>Signed amount to allocate (USD)</label>
      <input id={id+'-amount'} name="amount" inputMode="decimal" required maxLength={21}/>
      <button type="submit">Add proposed match</button>
     </>}
    </form>}
    {matches.length>0&&<ul>{matches.map((match,index)=>{
     const row=snapshot.rows.find(row=>row.id===match.statementRowId)!;
     const movement=byMovement.get(match.movementId)!;
     return <li key={match.statementRowId+':'+match.movementId}>{row.statementOn} to {movement.effectiveOn} · {format(match.signedCents)}
      <button type="button" className="secondary" onClick={()=>setMatches(matches.filter(item=>item!==match))}>Remove match {index+1}</button>
     </li>;
    })}</ul>}
   </>}
  </section>
 </details>;
}
