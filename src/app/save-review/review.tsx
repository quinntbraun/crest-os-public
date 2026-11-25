'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createOriginalOperationReviewController,initialOriginalOperationReviewView} from '../../client/original-operation-review-controller';
import type {OriginalOperationReviewView} from '../../client/original-operation-review-controller';
import type {OriginalOperationKind} from '../../security/original-operation-reference';

const choices:ReadonlyArray<readonly [OriginalOperationKind,string]>=[
 ['bookkeeping.expense.save','Expense'],['bookkeeping.receipt.reserve','Receipt upload reservation'],['bookkeeping.receipt.publish','Receipt publication'],
 ['business.rename','Business name'],['crm.customer.save','Customer'],['crm.address.save','Customer address'],
 ['crm.vehicle.save','Vehicle'],['crm.vehicle.association','Vehicle customer link'],
 ['crm.lead.source.save','Lead source'],['crm.lead.save','Lead'],['crm.lead.state','Lead status'],
 ['crm.lead.vehicle.save','Reported lead vehicle'],['crm.lead.address.save','Lead address'],['crm.lead.convert','Lead conversion'],['catalog.service.save','Service catalog'],['quote.draft.save','Quote draft'],['quote.review.submit','Quote review submission'],['quote.review.approve','Quote approval'],['quote.replacement.create','Replacement quote draft'],['quote.amendment.create','Amendment draft'],['quote.amendment.send','Amendment sharing confirmation'],['quote.manual.send','Quote sharing confirmation'],['quote.confirmation.accept','Customer quote acceptance'],['operations.appointment_hold.save','Appointment proposal'],
 ['quote.amendment.accept','Customer amendment acceptance'],
 ['operations.fulfillment_modes.initialize','Fulfillment settings setup'],['operations.fulfillment_modes.save','Fulfillment settings'],
 ['operations.job.book','Job booking'],['operations.job.cancel','Scheduled-job cancellation'],['operations.job.reschedule','Appointment change'],
 ['operations.job.field','Mobile work status'],['operations.job.complete','Work completion'],['operations.job.interrupt','En-route change'],
 ['operations.job.cancel_unfulfilled','Unfulfilled-work cancellation'],['operations.job.work_boundary.correct','Work-time correction'],['operations.job.work_start.correct','First work start correction'],['operations.job.work_end.correct','Completion time correction'],['operations.mobile_departure.correct','Mobile departure correction'],['operations.mileage.record','Mileage'],
 ['operations.pickup_custody.policy.save','Pickup handoff policy'],
 ['operations.pickup_custody.collect','Pickup vehicle collection'],
 ['operations.pickup_custody.release','Vehicle return handoff'],
 ['operations.pickup_custody.fail_return','Failed vehicle return'],
 ['operations.pickup_trip.record','Pickup trip'],['operations.support_trip.record','Support trip'],['operations.support_trip.correct','Support trip correction'],
 ['operations.message.record_outcome','Review message outcome'],['operations.follow_up.save','Maintenance reminder'],['operations.custody.save','Drop-Off handoff'],['operations.custody.policy.save','Drop-Off policy'],['operations.custody.policy.revise','Drop-Off policy revision']
];
const groups=[
 {label:'Customers and leads',matches:(kind:OriginalOperationKind)=>kind.startsWith('crm.')},
 {label:'Quotes and services',matches:(kind:OriginalOperationKind)=>kind.startsWith('quote.')||kind.startsWith('catalog.')},
 {label:'Schedule and field work',matches:(kind:OriginalOperationKind)=>kind.startsWith('operations.')},
 {label:'Expenses and business settings',matches:(kind:OriginalOperationKind)=>kind.startsWith('bookkeeping.')||kind==='business.rename'},
];
const reviewedTime=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'});

function destination(kind:OriginalOperationKind){
 if(kind.startsWith('bookkeeping.'))return ['/expenses','Expenses'];
 if(kind.startsWith('quote.amendment.'))return ['/quotes/amendments','Quote amendments'];
 if(kind.startsWith('quote.'))return ['/quotes','Quotes'];
 if(kind.startsWith('crm.vehicle.'))return ['/vehicles','Vehicles'];
 if(kind==='crm.lead.source.save')return ['/lead-sources','Lead sources'];
 if(kind.startsWith('crm.lead.'))return ['/leads','Leads'];
 if(kind==='crm.address.save')return ['/addresses','Customer addresses'];
 if(kind==='crm.customer.save')return ['/customers','Customers'];
 if(kind==='catalog.service.save')return ['/services','Services'];
 if(kind==='operations.appointment_hold.save')return ['/appointment-holds','Appointment proposals'];
 if(kind.startsWith('operations.fulfillment_modes.')||kind.startsWith('operations.custody.policy.')||kind==='operations.pickup_custody.policy.save')return ['/schedule/modes','Service arrangements'];
 if(kind.startsWith('operations.support_trip.'))return ['/schedule/travel','Standalone travel'];
 if(kind.startsWith('operations.'))return ['/schedule','Schedule'];
 return ['/settings','Business settings'];
}
function outcomeTitle(view:OriginalOperationReviewView){
 if(view.busy)return 'Checking this save…';
 if(view.needsSignIn)return 'Sign in to continue';
 switch(view.verification){
  case 'no-reference':return 'No save to review in this tab';
  case 'absent':return 'No completed save found';
  case 'conflict':return 'Save reference needs review';
  case 'receipt-verified':return 'Confirmed saved';
  case 'retirement-acknowledged':return 'Retirement confirmed';
 }
 switch(view.phase){
  case 'review':return 'Ready to check';
  case 'confirm':return 'Confirm retirement';
  case 'retired':return 'Retirement recorded';
  case 'recorded':return 'Save recorded';
  default:return 'Outcome unverified';
 }
}
function Review({kind,label}:{kind:OriginalOperationKind;label:string}){
 const [view,setView]=useState(initialOriginalOperationReviewView);
 const [reasonOpen,setReasonOpen]=useState(false);
 const current=useRef<ReturnType<typeof createOriginalOperationReviewController>|null>(null);
 const status=useRef<HTMLDivElement>(null),reasonField=useRef<HTMLTextAreaElement>(null);
 const [href,name]=destination(kind);
 const resolved=view.verification==='receipt-verified'||view.verification==='retirement-acknowledged';
 const tone=resolved?'resolved':view.phase==='pending'||view.phase==='recorded'||view.phase==='retired'?'attention':'neutral';
 const timestamp=view.retiredAt??view.checkedAt;
 useLayoutEffect(()=>{if(reasonOpen&&view.canPrepareRetirement)reasonField.current?.focus();},[reasonOpen,view.canPrepareRetirement]);
 useEffect(()=>{
  const controller=createOriginalOperationReviewController({kind,storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value),removeItem:key=>sessionStorage.removeItem(key)},change:setView,resolved:()=>status.current?.focus()});
  current.current=controller;void controller.load();
  const leave=()=>{setReasonOpen(false);controller.suspend();};
  const hidden=()=>{if(document.visibilityState==='hidden')leave();},restored=(event:PageTransitionEvent)=>{if(event.persisted)leave();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restored);
  return ()=>{controller.dispose();current.current=null;document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restored);};
 },[kind]);
 async function action(operation:'load'|'review'|'retire'|'lookup'|'reconcile'){
  const controller=current.current;if(!controller)return;
  if(operation!=='review')setReasonOpen(false);
  await controller[operation]();
  if(current.current===controller)status.current?.focus();
 }
 return <section className="save-review-card" aria-label="Original save review" data-tone={tone} data-verification={view.verification} data-has-reference={!!view.reference}>
  <div className="save-review-outcome">
  <header><p className="save-review-subject">Original action · {label}</p>
   <div ref={status} className="save-review-status" tabIndex={-1} role="status" aria-atomic="true">
    <h2>{outcomeTitle(view)}</h2><p>{view.message}</p>
   </div>
   {timestamp&&<p className="save-review-time">{view.retiredAt?'Retirement recorded':'Last checked'} <time dateTime={timestamp}>{reviewedTime.format(new Date(timestamp))} UTC</time></p>}
  </header>
  <div className="save-review-actions" aria-busy={view.busy}>
   {view.phase==='recorded'&&<button type="button" disabled={!view.canReconcile} onClick={()=>void action('reconcile')}>Verify original save receipt</button>}
   {view.phase==='retired'&&<button type="button" disabled={!view.canAcknowledge} onClick={()=>current.current?.acknowledge()}>Acknowledge retirement and release local reference</button>}
   {view.canLookup&&!view.needsSignIn&&['review','pending'].includes(view.phase)&&<button type="button" onClick={()=>void action('lookup')}>Check original resolution</button>}
   {!view.needsSignIn&&['idle','pending','blocked'].includes(view.phase)&&<button type="button" className={view.canLookup?'secondary':undefined} disabled={view.busy} onClick={()=>void action('load')}>Load original save review</button>}

   {view.phase==='complete'&&<a className="primary-action" href={view.verification==='receipt-verified'&&view.record?view.record.href:href}>{view.verification==='receipt-verified'&&view.record?view.record.label:'Return to '+name}</a>}
   {view.needsSignIn&&!view.busy&&<a className="primary-action" href={'/sign-in?resumeSave='+encodeURIComponent(kind)}>Sign in and resume</a>}
   {!view.busy&&!view.needsSignIn&&view.phase!=='complete'&&<a className="save-review-return" href={href}>Return to {name}</a>}
  </div>
  {view.reference&&!resolved&&<p className="field-help save-review-return-help">Returning keeps the original reference in this tab. Verify its outcome before making another save.</p>}
  {view.canPrepareRetirement&&<button className="secondary save-review-options" type="button" aria-expanded={reasonOpen} aria-controls={reasonOpen?'save-review-retirement':undefined} disabled={view.busy} onClick={()=>setReasonOpen(!reasonOpen)}>Retirement options</button>}
  {view.canPrepareRetirement&&reasonOpen&&<form id="save-review-retirement" className="save-review-retirement" onSubmit={event=>{event.preventDefault();void action('review');}}>
   <p>Retirement prevents the original request from running later. Any completed save remains in the records. A recently authenticated owner must provide a reason. Expenses and receipts also require financial authority.</p>
   <label htmlFor="retirement-reason">Reason for retiring this original save</label>
   <textarea ref={reasonField} id="retirement-reason" autoComplete="off" rows={4} maxLength={4000} disabled={view.busy} value={view.reason} onChange={event=>current.current?.editReason(event.target.value)} required/>
   <p className="field-help">{[...view.reason].length}/2000 characters. Crest keeps this reason in the business history when retirement is recorded.</p>
   <button className="secondary" type="submit" disabled={!view.canReview}>Review retirement</button>
  </form>}
  {view.phase==='confirm'&&<section className="save-review-retirement" aria-label="Confirm original save retirement">
   <p>Reason</p><p className="retirement-reason">{view.reason}</p>
   <div className="save-review-actions">
    <button className="save-review-confirm" type="button" disabled={!view.canRetire} onClick={()=>void action('retire')}>Confirm retirement of this original save</button>
    <button type="button" className="secondary" disabled={view.busy} onClick={()=>{setReasonOpen(true);current.current?.back();}}>Edit reason</button>
   </div>
  </section>}
  </div>
  {view.reference&&<aside className="save-review-evidence" aria-label="Review evidence"><h3>Evidence</h3><details className="save-review-reference"><summary>Save reference</summary><p className="save-reference"><code>{view.reference}</code></p></details></aside>}
 </section>;
}
export function SaveReviewScreen({initialKind='crm.customer.save'}:{initialKind?:OriginalOperationKind}={}){
 const [kind,setKind]=useState<OriginalOperationKind>(initialKind);
 return <div className="save-review-layout">
  <Review key={kind} kind={kind} label={choices.find(([value])=>value===kind)?.[1]??'Original save'}/>
  <aside className="save-review-picker" aria-label="Save selection">
   <details><summary>Review a different save</summary>
   <label htmlFor="save-review-kind">Interrupted save type</label>
   <select id="save-review-kind" value={kind} onChange={event=>{const selected=choices.find(([value])=>value===event.target.value);if(selected)setKind(selected[0]);}}>{groups.map(group=><optgroup key={group.label} label={group.label}>
    {choices.filter(([value])=>group.matches(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </optgroup>)}</select>
   <p className="field-help">Keep this tab open until the outcome is verified. Leaving or hiding the page clears private review details.</p>
   </details>
  </aside>
 </div>;
}
