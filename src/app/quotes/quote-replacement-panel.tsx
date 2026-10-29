'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {createQuoteReplacementController,initialQuoteReplacementView} from '../../client/quote-replacement-controller';
import type {QuoteReplacementRow} from '../../client/quote-replacement-controller';
import type {QuoteCommitted} from '../../commercial/quote-storage-contract';
import {createPendingQuoteReplacementStore} from '../../client/pending-quote-replacement';
import type {PendingQuoteReplacement} from '../../client/pending-quote-replacement';
import {createPendingQuoteStore} from '../../client/pending-quote-edit';
import {createPendingQuoteReviewStore} from '../../client/pending-quote-review';
import {createPendingQuoteCommercialStore} from '../../client/pending-quote-commercial';

type Props=Readonly<{row:QuoteReplacementRow;dirty:boolean;blocked?:boolean;onLock:(locked:boolean)=>void;onCommitted:(result:QuoteCommitted)=>Promise<void>}>;
export function QuoteReplacementPanel(props:Props){
 return <QuoteReplacementPanelContent key={props.row.family.id+':'+props.row.family.version+':'+props.row.revision.id+':'+props.row.revision.version} {...props}/>;
}
function QuoteReplacementPanelContent({row,dirty,blocked=false,onLock,onCommitted}:Props){
 const heading=useId(),[view,setView]=useState(initialQuoteReplacementView),[retained,setRetained]=useState<PendingQuoteReplacement|null>(null),[storageFailed,setStorageFailed]=useState(false),current=useRef<ReturnType<typeof createQuoteReplacementController>|null>(null);
 useEffect(()=>{
  const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)},store=createPendingQuoteReplacementStore(storage);
  let alive=true,controller:ReturnType<typeof createQuoteReplacementController>|null=null;
  queueMicrotask(()=>{if(!alive)return;try{
   const saved=store.read();setRetained(saved);setStorageFailed(false);
   // A pending original must remain reachable even after the visible row has
   // become a Draft or another saved revision. No quote content is persisted.
   if(row.revision.state==='Sent'||saved!==null){
    controller=createQuoteReplacementController({store,blockers:[createPendingQuoteStore(storage),createPendingQuoteReviewStore(storage),createPendingQuoteCommercialStore(storage)],change:value=>{
     if(!alive)return;setView(value);
     try{const original=store.read();setRetained(original);onLock(value.busy||value.pending!==null||original!==null);}
     catch{setStorageFailed(true);onLock(true);}
    },onCommitted});current.current=controller;void controller.read(row);
   }else onLock(false);
  }catch{setStorageFailed(true);onLock(true);}});
  const leave=()=>controller?.clearPrivate(),hidden=()=>{if(document.visibilityState==='hidden')leave();};
  window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',hidden);
  return ()=>{alive=false;current.current=null;controller?.dispose();onLock(false);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',hidden);};
 },[row,onLock,onCommitted]);
 const pending=view.pending!==null||retained!==null;
 if(row.revision.state!=='Sent'&&!pending&&!storageFailed)return null;
 return <section aria-labelledby={heading}><h3 id={heading}>Replacement draft</h3>
  <p className="field-help">Prepare a separate Draft from the exact saved quote. The old Sent offer remains valid until you review, approve and confirm actual sharing of its replacement. This does not amend an accepted agreement or record a customer decision.</p>
  {storageFailed?<><p role="alert">The original replacement reference could not be read or secured. Open Save review before another quote action; nothing was retried.</p><a href="/save-review">Review interrupted actions</a></>:<>
   <p role="status" aria-label="Replacement status" className="notice">{view.status}</p>
   {dirty&&<p className="field-help">Save and reopen your changes before preparing a replacement from the saved offer.</p>}
   {blocked&&<p className="field-help">Finish the other quote action before preparing a replacement.</p>}
   {pending?<div className="actions"><button type="button" disabled={view.busy||blocked} onClick={()=>void current.current?.lookup()}>Check original replacement</button><a href="/save-review">Review interrupted actions</a></div>:<div className="actions">
    <button type="button" disabled={dirty||blocked||!view.canCreate} onClick={()=>void current.current?.create(row)}>Prepare replacement draft</button>
    <button type="button" className="secondary" disabled={dirty||blocked||view.busy} onClick={()=>void current.current?.read(row)}>Reload replacement status</button>
   </div>}
  </>}
 </section>;
}
