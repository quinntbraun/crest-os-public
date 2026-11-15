'use client';
import {useId,useState} from 'react';
import type {FieldSessionView} from '../../../client/field-session-controller';
import {bookingTimeFacts} from '../../../client/booking-form';
import {bookingSlotInput,prepareSlotReview} from '../../../client/booking-slot-review';
import type {SlotReviewSelection} from '../../../client/booking-slot-review';
import {parseBookingContact} from '../../../operations/confirmed-booking-contract';
import type {BookingConfirmation} from '../../../operations/confirmed-booking-contract';
import type {InterruptionDraft} from '../../../operations/trip-interruption-contract';
import {BookingInstantInput} from '../booking-fields';
import {BookingSlotReview} from '../slot-review';

export function TripInterruptionForm({view,save}:{view:FieldSessionView;save:(draft:InterruptionDraft)=>Promise<void>}){
 const id=useId(),context=view.context!,{job,appointment}=view.resources!.head,trip=view.openTrip!;
 const zone=appointment.timezone;
 const [action,setAction]=useState<'cancel'|'reschedule'>('cancel');
 const [communication,setCommunication]=useState(''),[effectiveAt,setEffectiveAt]=useState('');
 const [start,setStart]=useState(''),[end,setEnd]=useState('');
 const [before,setBefore]=useState<number|null>(appointment.travel_before_seconds);
 const [after,setAfter]=useState<number|null>(appointment.travel_after_seconds);
 const [review,setReview]=useState<SlotReviewSelection|null>(null),[error,setError]=useState('');
 const disabled=view.busy||context.context.writeState!=='ready';
 const slot={start_at:start,end_at:end,travel_before_seconds:before,travel_after_seconds:after};
 const reviewInput=bookingSlotInput(context,slot,job.id);
 const customerConfirmed=action==='reschedule';
 const hasEvidence=customerConfirmed||communication==='sent';
 const format=new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'medium',timeStyle:'short'});
 return <form className="field-work-form trip-interruption-form" onSubmit={event=>{
  event.preventDefault();
  if(disabled)return;
  const data=new FormData(event.currentTarget),text=(name:string)=>String(data.get(name)??'');
  const reason=text('reason'),note=text('note'),instructions=text('instructions');
  const actualStop={schemaVersion:1 as const,kind:'manual' as const,locationText:text('stop'),instructions:instructions.trim()?instructions:null};
  const channel=text('channel') as BookingConfirmation['channel'];
  const confirmation={channel,effectiveAt,evidenceNote:note};
  setError('');
  if(action==='cancel'){
   if(!communication||hasEvidence&&!effectiveAt){setError('Record what actually happened with the customer.');return;}
   void save({action,reason,actualStop,customerCommunication:communication==='sent'?{state:'sent',...confirmation}:
    communication==='no_contact'?{state:'no_contact',channel:null,effectiveAt:null,evidenceNote:note}:
    {state:'not_sent',channel:null,effectiveAt:null,evidenceNote:note.trim()?note:null}});
   return;
  }
  try{
   if(!reviewInput||!effectiveAt)throw Error();
   const first=bookingTimeFacts(start,zone),last=bookingTimeFacts(end,zone);
   const {unknownTravelReviewed,...conflictReview}=prepareSlotReview(review,context,reviewInput,zone);
   void save({action,reason,actualStop,conflictReview,appointment:{...slot,timezone:zone,
    local_start:first.local,local_end:last.local,start_offset_minutes:first.offset,end_offset_minutes:last.offset,
    contact_snapshot:parseBookingContact(appointment.contact_snapshot),customer_confirmation:confirmation,
    unknown_travel_reviewed:unknownTravelReviewed}});
  }catch{setError('Enter the confirmed replacement and actual customer confirmation, then review the schedule for this time.');}
 }}>
  <p>Departed <time dateTime={trip.departedAt}>{format.format(new Date(trip.departedAt))}</time>.</p>
  <p>Confirmed visit <time dateTime={appointment.start_at}>{format.format(new Date(appointment.start_at))}</time> · {zone}</p>
  <fieldset disabled={disabled}>
   <legend>End travel and change the visit</legend>
   <p>The save records when the trip ends and keeps the departure in history.</p>
   <label htmlFor={id+'-action'}>What happened?</label>
   <select id={id+'-action'} value={action} onChange={event=>{
    setAction(event.target.value==='reschedule'?'reschedule':'cancel');setEffectiveAt('');setReview(null);setError('');
   }}><option value="cancel">Cancel the visit</option><option value="reschedule">Reschedule confirmed visit</option></select>
   <label htmlFor={id+'-stop'}>Actual stop location</label>
   <textarea id={id+'-stop'} name="stop" rows={2} maxLength={2000} required/>
   <label htmlFor={id+'-instructions'}>Stop instructions (optional)</label>
   <textarea id={id+'-instructions'} name="instructions" rows={2} maxLength={2000}/>
   <label htmlFor={id+'-reason'}>Reason for stopping</label>
   <textarea id={id+'-reason'} name="reason" rows={2} maxLength={1000} required/>
   {customerConfirmed?<fieldset>
    <legend>Customer-confirmed replacement</legend>
    <BookingInstantInput label="Replacement starts" value={start} zone={zone} change={setStart}/>
    <BookingInstantInput label="Replacement ends" value={end} zone={zone} change={setEnd}/>
    <details><summary>Travel estimates</summary>
     <p>Leave blank when unknown. Use 0 for no travel time.</p>
     <label>Travel before (seconds)<input type="number" inputMode="numeric" min={0} max={2147483647} step={1} value={before??''}
      onChange={event=>setBefore(event.target.value===''?null:event.target.valueAsNumber)}/></label>
     <label>Travel after (seconds)<input type="number" inputMode="numeric" min={0} max={2147483647} step={1} value={after??''}
      onChange={event=>setAfter(event.target.value===''?null:event.target.valueAsNumber)}/></label>
    </details>
    <BookingSlotReview context={context} input={reviewInput} timezone={zone} value={review} change={setReview}/>
   </fieldset>:<>
    <label htmlFor={id+'-communication'}>Customer-communication status</label>
    <select id={id+'-communication'} value={communication} required onChange={event=>{setCommunication(event.target.value);setEffectiveAt('');}}>
     <option value="">Choose what actually happened</option><option value="not_sent">Not sent</option>
     <option value="sent">Already communicated</option><option value="no_contact">No contact available</option>
    </select>
   </>}
   <div key={action+':'+communication}>
    {hasEvidence&&<>
     <label htmlFor={id+'-channel'}>Actual confirmation or communication channel</label>
     <select id={id+'-channel'} name="channel" required defaultValue="">
      <option value="">Choose the actual channel</option><option value="text">Text</option><option value="phone">Phone</option>
      <option value="email">Email</option><option value="in_person">In person</option>
     </select>
     <BookingInstantInput label="When the confirmation or communication occurred" value={effectiveAt} zone={zone} change={setEffectiveAt}/>
    </>}
    {(customerConfirmed||communication)&&<>
     <label htmlFor={id+'-note'}>{hasEvidence?'Confirmation or communication evidence':
      communication==='no_contact'?'Reason no contact is available':'Communication note (optional)'}</label>
     <textarea id={id+'-note'} name="note" rows={2} maxLength={2000} required={hasEvidence||communication==='no_contact'}/>
    </>}
   </div>
   <p className="field-help">Enter communication that has already happened.</p>
   {error&&<p role="alert">{error}</p>}
   <button type="submit">{customerConfirmed?'End trip and save replacement':'End trip and cancel visit'}</button>
  </fieldset>
 </form>;
}
