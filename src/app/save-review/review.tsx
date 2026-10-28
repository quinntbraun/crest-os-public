'use client';
import {useEffect,useRef,useState} from 'react';
import {createOriginalOperationReviewController,initialOriginalOperationReviewView} from '../../client/original-operation-review-controller';
import type {OriginalOperationKind} from '../../security/original-operation-reference';

const choices:ReadonlyArray<readonly [OriginalOperationKind,string]>=[
 ['business.rename','Business name'],['crm.customer.save','Customer'],['crm.address.save','Customer address'],
 ['crm.vehicle.save','Vehicle'],['crm.vehicle.association','Vehicle customer link'],
 ['crm.lead.source.save','Lead source'],['crm.lead.save','Lead'],['crm.lead.state','Lead status'],
 ['crm.lead.vehicle.save','Reported lead vehicle'],['crm.lead.address.save','Lead address'],['crm.lead.convert','Lead conversion']
];
function Review({kind}:{kind:OriginalOperationKind}){
 const [view,setView]=useState(initialOriginalOperationReviewView),current=useRef<ReturnType<typeof createOriginalOperationReviewController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{
  const controller=createOriginalOperationReviewController({kind,storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView,resolved:()=>status.current?.focus()});
  current.current=controller;void controller.load();
  const hidden=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restored=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[kind]);
 async function action(kind:'load'|'review'|'retire'|'lookup'|'reconcile'){
  const controller=current.current;if(!controller)return;await controller[kind]();if(current.current===controller)status.current?.focus();
 }
 return <section aria-label="Original save review" aria-busy={view.busy}>
  <p ref={status} tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{view.message}</p>
  {view.reference&&<p className="save-reference">Original save reference: <code>{view.reference}</code></p>}
  {view.phase==='review'&&<form onSubmit={event=>{event.preventDefault();void action('review');}}>
   <label htmlFor="retirement-reason">Reason for retiring this original save</label>
   <textarea id="retirement-reason" autoComplete="off" rows={4} maxLength={4000} disabled={view.busy} value={view.reason} onChange={event=>current.current?.editReason(event.target.value)} required/>
   <p className="field-help">{[...view.reason].length}/2000 characters. The reason becomes retained business history when retirement is recorded.</p>
   <button type="submit" disabled={!view.canReview}>Review retirement</button>
  </form>}
  {view.phase==='confirm'&&<section aria-label="Confirm original save retirement">
   <h2>Confirm retirement</h2><p>This prevents the original save from running later. It does not undo a save already completed.</p>
   <p>Reason:</p><p className="retirement-reason">{view.reason}</p>
   <button type="button" disabled={!view.canRetire} onClick={()=>void action('retire')}>Confirm retirement of this original save</button>
   <button type="button" className="secondary" disabled={view.busy} onClick={()=>current.current?.back()}>Edit reason</button>
  </section>}
  {view.canLookup&&<button type="button" className="secondary" onClick={()=>void action('lookup')}>Check original resolution</button>}
  {view.phase==='recorded'&&<button type="button" disabled={!view.canReconcile} onClick={()=>void action('reconcile')}>Verify original save receipt</button>}
  {view.phase==='retired'&&<button type="button" disabled={!view.canAcknowledge} onClick={()=>current.current?.acknowledge()}>Acknowledge retirement and release local reference</button>}
  {['idle','pending','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load original save review</button>}
  <p className="field-help">Each check is explicit. A missing result leaves the original reference in place. Hiding or leaving this page clears private review details.</p>
 </section>;
}
export function SaveReviewScreen(){
 const [kind,setKind]=useState<OriginalOperationKind>('crm.customer.save');
 return <>
  <p>Resolve a retained nonfinancial save from this browser tab. Keep this tab open until its outcome is verified. Retirement requires a recently authenticated business owner.</p>
  <label htmlFor="save-review-kind">Interrupted save type</label>
  <select id="save-review-kind" value={kind} onChange={event=>{const selected=choices.find(([kind])=>kind===event.target.value);if(selected)setKind(selected[0]);}}>{choices.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
  <Review key={kind} kind={kind}/>
  <nav aria-label="Save review navigation"><a href="/customers">Load current customers</a><a href="/vehicles">Load current vehicles</a><a href="/leads">Load current leads</a><a href="/lead-sources">Load current lead sources</a><a href="/addresses">Load customer addresses</a><a href="/settings">Load business settings</a><a href="/sign-in">Device sign-in and sign-out</a></nav>
  <p className="field-help">Synthetic testing is still in progress. This screen does not approve production use or real business records.</p>
 </>;
}
