'use client';

import {useEffect,useId,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {reviewStatementMatches} from '../../../bookkeeping/statement-match-review';
import {statementMatchDraftLimit} from '../../../bookkeeping/statement-match-draft-contract';
import type {StatementMatchDraftInput,StatementMatchDraftReceipt} from '../../../bookkeeping/statement-match-draft-contract';
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
 const [saved,setSaved]=useState<StatementMatchDraftReceipt|null>(null);
 const [reason,setReason]=useState('');
 const [pending,setPending]=useState<StatementMatchDraftInput|null>(null);
 const controller=useRef<AbortController|null>(null);
 const id=useId();
 function clear(){
  controller.current?.abort();controller.current=null;
  setSnapshot(null);setMatches([]);setRowId('');setMessage('');setBusy(false);
  setSaved(null);setReason('');setPending(null);
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
   const draft=context.statementMatchDrafts?await financeAccounts.readStatementMatchDraft(context,statementId,null,signal):null;
   const savedFrom=draft?.allocations.length?draft.movementFromOn:'';
   const requestedFrom=savedFrom&&(!fromOn||savedFrom<fromOn)?savedFrom:fromOn;
   const result=await financeAccounts.readStatementMatchReview(context,statementId,requestedFrom||null,signal);
   if(signal.aborted)return;
   const retainedMovements=new Map(result.movements.map(row=>[row.id,row]));
   if(draft)reviewStatementMatches(result,draft.allocations,id=>retainedMovements.get(id));
   if(requestedFrom!==fromOn)setFromOn(requestedFrom);
   setSnapshot(result);
   setSaved(draft);setMatches(draft?.allocations??[]);
   setMessage(draft?'Saved match draft loaded.':result.movements.length?'Posted movements loaded.':'There are no posted movements in this search window.');
  }catch{if(!signal.aborted)setMessage('Crest could not verify this search. Check the statement or try a later movement start date.');}
  finally{if(controller.current===request){controller.current=null;setBusy(false);}}
 }
 const byMovement=new Map(snapshot?.movements.map(row=>[row.id,row]));
 const assessment=snapshot?reviewStatementMatches(snapshot,matches,id=>byMovement.get(id)):null;
 const changed=JSON.stringify(matches)!==JSON.stringify(saved?.allocations??[]);
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
  if(!snapshot||!selected||busy||pending)return;
  if(context.statementMatchDrafts&&matches.length>=statementMatchDraftLimit){
   setMessage('This draft holds up to '+statementMatchDraftLimit+' allocations. Remove an allocation to add another.');return;
  }
  try{
   const data=new FormData(event.currentTarget);
   const proposal=[...matches,{statementRowId:selected.id,movementId:String(data.get('movement')),
    signedCents:parse(String(data.get('amount')).trim())}];
   reviewStatementMatches(snapshot,proposal,id=>byMovement.get(id));
   setMatches(proposal);setMessage('Proposed allocation added.');event.currentTarget.reset();
  }catch{setMessage('Check the signed amount. It must fit both amounts that remain available.');}
 }
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(!context.statementMatchDrafts||!snapshot||!context.recoveryEpoch||context.writeState!=='ready'||busy||!changed)return;
  const input=pending??{statementId,recoveryEpoch:context.recoveryEpoch,operationId:crypto.randomUUID(),
   expectedRevision:saved?.revision??'0',movementFromOn:snapshot.movementFromOn,allocations:matches,reason:reason.trim()};
  if(!input.reason){setMessage('Enter a review note before saving.');return;}
  const request=new AbortController(),{signal}=request;
  controller.current=request;setPending(input);setBusy(true);
  try{
   const result=await financeAccounts.saveStatementMatchDraft(context,input,signal);
   if(signal.aborted)return;
   if(result.state==='committed'){
    setSaved(result.receipt);setMatches(result.receipt.allocations);setReason('');
    setMessage('Match draft saved.');
   }else if(result.state==='conflict'||result.reason==='STATEMENT_MATCH_DRAFT_REVISION_CONFLICT'){
    setMessage('This draft changed since you loaded it. Load posted movements again to review the latest revision.');
   }else{
    setMessage('The draft could not be saved. Check the statement, allocations, and review note.');
   }
   setPending(null);
  }catch{if(!signal.aborted)setMessage('The save could not be confirmed. Retry this save or load the latest draft.');}
  finally{if(controller.current===request){controller.current=null;setBusy(false);}}
 }
 return <details className={styles.openingGroup} onToggle={event=>{if(!event.currentTarget.open)clear();}}>
  <summary>Review statement matches</summary>
  <section aria-label="Statement match review" aria-busy={busy}>
   <p>{context.statementMatchDrafts?'Compare statement rows with posted movements and save your work as a draft. Approval is a separate step.':
    'Compare statement rows with posted movements. The proposed allocations stay on this screen.'}</p>
   <form onSubmit={event=>{event.preventDefault();void load();}}>
    <label htmlFor={id+'-date'}>Search for posted movements from (optional)</label>
    <input id={id+'-date'} type="date" value={fromOn} onChange={event=>{clear();setFromOn(event.target.value);}} disabled={busy||!!pending}/>
    <button className="secondary" type="submit" disabled={busy}>Load posted movements</button>
   </form>
   <p role="status">{message}</p>
   {snapshot&&assessment&&<>
    {saved&&<p>Saved draft revision {saved.revision} · {saved.reason}</p>}
    {snapshot.statementDifferenceCents!=='0'&&<p>Resolve the {format(snapshot.statementDifferenceCents)} statement difference before approving any reconciliation.</p>}
    <p>{assessment.outstanding.length===0?'Every statement row is fully allocated in this preview.':
     [assessment.outstanding.length,assessment.outstanding.length===1?'statement row needs a match.':'statement rows need matching.'].join(' ')}</p>
    {snapshot.rows.length>0&&snapshot.movements.length>0&&<form onSubmit={add}><fieldset disabled={busy||!!pending}>
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
      <button type="submit" className={context.statementMatchDrafts&&context.writeState==='ready'&&changed?'secondary':undefined}>Add proposed match</button>
     </>}
    </fieldset></form>}
    {matches.length>0&&<ul>{matches.map((match,index)=>{
     const row=snapshot.rows.find(row=>row.id===match.statementRowId)!;
     const movement=byMovement.get(match.movementId)!;
     return <li key={match.statementRowId+':'+match.movementId}>{row.statementOn} to {movement.effectiveOn} · {format(match.signedCents)}
      <button type="button" className="secondary" disabled={busy||!!pending} onClick={()=>setMatches(matches.filter(item=>item!==match))}>Remove match {index+1}</button>
     </li>;
    })}</ul>}
    {context.statementMatchDrafts&&context.writeState==='ready'&&changed&&<form onSubmit={save}>
     <label htmlFor={id+'-draft-note'}>Match draft review note</label>
     <textarea id={id+'-draft-note'} value={reason} required maxLength={1000} disabled={busy||!!pending}
      onChange={event=>setReason(event.target.value)}/>
     <button type="submit" disabled={busy}>{pending?'Retry match draft save':'Save match draft'}</button>
    </form>}
   </>}
  </section>
 </details>;
}
