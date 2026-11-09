'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {readBookingSlotReview,slotReviewKey} from '../../client/booking-slot-review';
import type {SlotReviewSelection} from '../../client/booking-slot-review';
import type {BookingConflictRequest} from '../../operations/booking-conflict-review-contract';
import type {scheduling} from '../../client/scheduling';
type Context=Awaited<ReturnType<typeof scheduling.workspace>>;
const when=(instant:string,zone:string)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(instant));
export function BookingSlotReview({context,input,timezone,value,change}:{context:Context;input:BookingConflictRequest|null;timezone:string;value:SlotReviewSelection|null;change:(value:SlotReviewSelection|null)=>void}){
 let key='';try{if(input)key=slotReviewKey(context,input,timezone);}catch{/* Incomplete local times remain editable, with no request dispatched. */}
 return <SlotReviewContents key={key} context={context} input={key?input:null} timezone={timezone} reviewKey={key} value={value?.key===key?value:null} change={change}/>;
}
function SlotReviewContents({context,input,timezone,reviewKey,value,change}:{context:Context;input:BookingConflictRequest|null;timezone:string;reviewKey:string;value:SlotReviewSelection|null;change:(value:SlotReviewSelection|null)=>void}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),active=useRef<AbortController|null>(null),reasonId=useId();
 useEffect(()=>()=>active.current?.abort(),[]);
 async function load(){
  if(!input||busy)return;active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);setMessage('Checking current reservations and travel…');change(null);
  try{const review=await readBookingSlotReview(context,input,controller.signal);if(!controller.signal.aborted){change({key:reviewKey,review,unknownTravelReviewed:false,overrideReason:''});setMessage('Current schedule review loaded. Saving rechecks reservations.');}}
  catch{if(!controller.signal.aborted)setMessage('Schedule review could not be verified. No booking or time change was sent. Review again, or reload the form if access has changed.');}
  finally{if(!controller.signal.aborted){active.current=null;setBusy(false);}}
 }
 return <section className="slot-review" aria-label="Schedule conflict review" aria-busy={busy}><h2>Check the schedule</h2><p className="field-help">Includes confirmed visits and known travel buffers. Review again after changing times or travel estimates.</p>
  {!input?<p>Enter valid visit start and end times before checking the schedule.</p>:<button type="button" className="secondary" disabled={busy||context.context.writeState!=='ready'} onClick={()=>void load()}>{value?'Review schedule again':'Review schedule'}</button>}
  {message&&<p role="status">{message}</p>}
  {value&&<><p>{value.review.conflictingAppointmentIds.length?`${value.review.conflictingAppointmentIds.length} overlapping confirmed ${value.review.conflictingAppointmentIds.length===1?'visit':'visits'}. Saving requires an explicit override reason.`:'No overlapping confirmed visits found.'}</p>
   {value.review.reservations.length>0&&<details open={value.review.conflictingAppointmentIds.length>0}><summary>Relevant booked visits ({value.review.reservations.length})</summary><ul className="follow-up-list">{value.review.reservations.map(row=><li key={row.appointmentId}><a href={'/schedule?job='+encodeURIComponent(row.jobId)}>{row.customerName}</a><span>{row.relation==='overlap'?'Overlaps this visit':row.relation==='before'?'Nearest visit before':'Nearest visit after'}</span><time dateTime={row.startAt}>{when(row.startAt,row.timezone)} – {when(row.endAt,row.timezone)} · {row.timezone}</time><span>Travel before: {row.travelBeforeSeconds===null?'unknown':row.travelBeforeSeconds+' seconds'} · after: {row.travelAfterSeconds===null?'unknown':row.travelAfterSeconds+' seconds'}</span></li>)}</ul></details>}
   {value.review.unknownTravel&&<><p className="notice">Travel time is unknown for this visit or a relevant neighbouring visit. Review the surrounding schedule before saving.</p><label className="trust"><input type="checkbox" checked={value.unknownTravelReviewed} onChange={event=>change({...value,unknownTravelReviewed:event.target.checked})}/><span>I reviewed the schedule and the unknown travel time.</span></label></>}
   {value.review.conflictingAppointmentIds.length>0&&<><label htmlFor={reasonId}>Reason to allow these overlapping visits</label><textarea id={reasonId} aria-describedby={reasonId+'-help'} required rows={3} maxLength={1000} value={value.overrideReason} onChange={event=>change({...value,overrideReason:event.target.value})}/><p id={reasonId+'-help'} className="field-help">This reason and the conflicting reservations are retained in job history. Crest sends no message automatically.</p></>}
   <p className="field-help">Chosen visit display zone: {timezone}. This review does not save or reserve a visit.</p>
  </>}
 </section>;
}
