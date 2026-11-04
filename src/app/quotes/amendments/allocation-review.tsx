'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {createAmendmentAllocationReview,initialAmendmentAllocationView} from '../../../client/amendment-allocation-review';
import type {QuoteAmendmentTarget} from '../../../commercial/quote-amendment-targets';
import {quoteMoney} from '../../../commercial/quote-pricing';

const labels={unassigned:'Unassigned work',assigned:'Assigned to jobs',completed:'Completed scope',cancelled:'Cancelled scope'} as const;
export function AmendmentAllocationReview({target}:{target:QuoteAmendmentTarget}){
 const [view,setView]=useState(initialAmendmentAllocationView),controller=useRef<ReturnType<typeof createAmendmentAllocationReview>|null>(null);
 useEffect(()=>{
  const current=createAmendmentAllocationReview({businessId:target.family.business_id,familyId:target.family.id,familyVersion:target.family.version,agreementId:target.parent.agreementId,agreementVersion:target.parent.versionNo,customerId:target.parent.customerId,totalCents:target.parent.revision.total_cents},{change:setView});controller.current=current;
  const clear=()=>current.clearPrivate(),hide=()=>{if(document.visibilityState==='hidden')clear();},restore=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',clear);window.addEventListener('pageshow',restore);
  return()=>{controller.current=null;current.dispose();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',clear);window.removeEventListener('pageshow',restore);};
 },[target]);
 const review=view.review;
 return <details onToggle={event=>{if(!event.currentTarget.open)controller.current?.clearPrivate();}}>
  <summary>Existing work and remaining scope</summary>
  <p className="field-help">Check existing commitments before changing accepted work. Saved visits stay in place while you prepare an amendment.</p>
  <p aria-live="polite" className="notice">{view.status}</p>
  <button type="button" className="secondary" disabled={view.phase==='loading'} onClick={()=>void controller.current?.load()}>Load existing work</button>
  {review&&<>
   <dl className="customer-values">{(Object.keys(labels) as (keyof typeof labels)[]).filter(state=>review.byState[state].count>0).map(state=><Fragment key={state}><dt>{labels[state]} · {review.byState[state].count} {review.byState[state].count===1?'portion':'portions'}</dt><dd>{quoteMoney(review.byState[state].amountCents)}</dd></Fragment>)}</dl>
   <ul className="customer-list">{review.agreement.sources.map(source=><li key={source.sourceAllocationId}>
    <strong className="service-scope">{source.scopeDescription}</strong>
    <p>{source.jobWide?'Job-wide scope':review.agreement.vehicles.find(vehicle=>vehicle.id===source.vehicleId)!.label} · {quoteMoney(source.amountCents)}</p>
    <ul>{source.parts.map(part=><li key={part.partitionId}><span>{labels[part.state]} · {quoteMoney(part.amountCents)}</span><p className="field-help">{part.scopeDescription}</p></li>)}</ul>
   </li>)}</ul>
   <p className="field-help">Work shown is from the last successful load. Open Schedule for saved visits, changes and their history.</p><a href="/schedule">Open schedule</a>
  </>}
 </details>;
}
