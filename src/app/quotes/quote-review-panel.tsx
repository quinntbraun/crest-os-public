'use client';
import {useEffect,useRef,useState} from 'react';
import {createQuoteReviewController,initialQuoteReviewView} from '../../client/quote-review-controller';
import type {QuoteReviewRow} from '../../client/quote-review-controller';
import type {QuoteReviewCommitted} from '../../commercial/quote-review-contract';
import {createPendingQuoteReviewStore} from '../../client/pending-quote-review';
import {createPendingQuoteStore} from '../../client/pending-quote-edit';
import {QuoteDocument} from './quote-document';

type Props=Readonly<{row:QuoteReviewRow;dirty:boolean;onLock:(locked:boolean)=>void;onCommitted:(result:QuoteReviewCommitted)=>Promise<void>;onPrepare:()=>void}>;
export function QuoteReviewPanel({row,dirty,onLock,onCommitted,onPrepare}:Props){
 const [view,setView]=useState(initialQuoteReviewView),[extreme,setExtreme]=useState(false),current=useRef<ReturnType<typeof createQuoteReviewController>|null>(null);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)};
  const controller=createQuoteReviewController({store:createPendingQuoteReviewStore(storage),draftStore:createPendingQuoteStore(storage),change:value=>{setView(value);onLock(value.busy||value.pending!==null);},onCommitted});current.current=controller;void controller.read(row);
  const leave=()=>controller.clearPrivate(),hidden=()=>{if(document.visibilityState==='hidden')leave();};window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',hidden);
  return ()=>{current.current=null;controller.dispose();onLock(false);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',hidden);};
 },[row,onLock,onCommitted]);
 return <section aria-labelledby="quote-review-heading"><h3 id="quote-review-heading">Review and approval</h3>
  <p role="status" aria-label="Quote review status" className="notice">{view.status}</p>
  {dirty&&<p className="field-help">Save your changes and reopen the quote before requesting review or approval.</p>}
  {row.revision.customer_safe_snapshot.schemaVersion===1&&<button type="button" className="secondary" disabled={dirty||view.busy||view.pending!==null} onClick={onPrepare}>Prepare this draft for approval</button>}
  {view.pending?<div className="actions"><button type="button" disabled={view.busy} onClick={()=>void current.current?.lookup()}>Check original review action</button><a href="/save-review">Review interrupted actions</a></div>:<>
   <div className="actions"><button type="button" className="secondary" disabled={dirty||view.busy} onClick={()=>void current.current?.read(row)}>Reload review status</button>
    {row.revision.state==='Draft'&&<button type="button" disabled={dirty||!view.canSubmit} onClick={()=>void current.current?.submit(row)}>Request review of saved quote</button>}</div>
   {view.hasExtreme&&view.canApprove&&<label className="checkbox"><input type="checkbox" checked={extreme} onChange={event=>setExtreme(event.target.checked)}/>I reviewed the Extreme condition and the exact proposed scope.</label>}
   {row.revision.state==='Ready for Review'&&!view.approvedPresentation&&<button type="button" disabled={dirty||!view.canApprove||view.hasExtreme&&!extreme} onClick={()=>void current.current?.approve(row,extreme)}>Approve this exact quote</button>}
  </>}
  {view.approvedPresentation&&<details open><summary>Retained approved customer content</summary><QuoteDocument quote={view.approvedPresentation} stage="approved"/></details>}
  <p className="field-help">Approval records your review of this exact content. Sharing confirmation and customer acceptance remain separate steps; this build cannot record them yet.</p>
 </section>;
}
