'use client';
import {useId,useState} from 'react';
import type {FieldSessionView} from '../../../client/field-session-controller';
import {parseBookingCommunication} from '../../../operations/confirmed-booking-contract';
import type {UnfulfilledCancellationDraft} from '../../../operations/unfulfilled-cancellation-contract';
import {BookingInstantInput} from '../booking-fields';
import {FieldVisitHeader} from './visit-header';

export function UnfulfilledCancellationForm({view,save}:{view:FieldSessionView;save:(draft:UnfulfilledCancellationDraft)=>Promise<void>}){
 const id=useId(),context=view.context!,job=view.cancellation!,resources=view.resources!;
 const assignments=resources.scopeParts.filter(part=>part.state==='assigned');
 const [communication,setCommunication]=useState(''),[effectiveAt,setEffectiveAt]=useState(''),[issue,setIssue]=useState('');
 const disabled=view.busy||context.context.writeState!=='ready';
 return <form className="field-work-form trip-interruption-form" onSubmit={event=>{
  event.preventDefault();
  if(disabled)return;
  const data=new FormData(event.currentTarget),reason=String(data.get('reason')??''),note=String(data.get('note')??'');
  try{
   if(data.get('scope')!=='none'||!communication)throw Error();
   const customerCommunication=parseBookingCommunication({
    state:communication,channel:communication==='sent'?data.get('channel'):null,
    effectiveAt:communication==='sent'?effectiveAt:null,evidenceNote:note.trim()?note:null
   });
   setIssue('');
   void save({reason,noFulfilledScopeConfirmed:true,customerCommunication});
  }catch{setIssue('Confirm that no work was completed and record what happened with the customer.');}
 }}>
  <FieldVisitHeader resources={resources}/>
  <section className="appointment-cancellation-notice" aria-label="Cancellation consequences">
   <strong>Cancellation releases this visit</strong>
   <p>The current work interval closes and Crest keeps the reason in the job history.</p>
  </section>
  {resources.head.job.fulfillment_mode==='dropoff'&&<p className="notice">Any vehicle in your custody still needs a separate recorded handoff. Cancellation keeps it in the return queue.</p>}
  <details><summary>Assigned work ({assignments.length})</summary>
   <ul>{assignments.map(part=><li key={part.sourceAllocationId+'/'+part.partitionId}>{part.scopeDescription}</li>)}</ul>
  </details>
  <p>If any work was completed, including a free service, record it through {context.jobCompletionAvailable
   ?<a href={'/schedule/work/complete?job='+encodeURIComponent(job.jobId)}>End job</a>
   :'the completion workflow'}.</p>
  {job.openTravelLegVersionIds.length>0&&<p role="status">A trip is still open. It will need to be ended separately when the travel actually stops.</p>}
  <fieldset disabled={disabled}>
   <legend>Cancel with no completed work</legend>
   <label htmlFor={id+'-scope'}>Work completed</label>
   <select id={id+'-scope'} name="scope" defaultValue="" required>
    <option value="">Confirm what happened</option><option value="none">No assigned work was completed</option>
   </select>
   <label htmlFor={id+'-reason'}>Cancellation reason</label>
   <textarea id={id+'-reason'} name="reason" rows={2} maxLength={1000} required/>
   <label htmlFor={id+'-communication'}>Customer-communication status</label>
   <select id={id+'-communication'} value={communication} required onChange={event=>{
    setCommunication(event.target.value);setEffectiveAt('');setIssue('');
   }}>
    <option value="">Choose what actually happened</option><option value="not_sent">Not sent</option>
    <option value="sent">Already communicated</option><option value="no_contact">No contact available</option>
   </select>
   <div key={communication}>
    {communication==='sent'&&<>
     <label htmlFor={id+'-channel'}>Actual communication channel</label>
     <select id={id+'-channel'} name="channel" defaultValue="" required>
      <option value="">Choose the actual channel</option><option value="text">Text</option>
      <option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option>
     </select>
     <BookingInstantInput label="When communication occurred" value={effectiveAt} zone={context.context.timezone} change={setEffectiveAt}/>
    </>}
    {communication&&<>
     <label htmlFor={id+'-note'}>{communication==='sent'?'Communication evidence':
      communication==='no_contact'?'Reason no contact is available':'Communication note (optional)'}</label>
     <textarea id={id+'-note'} name="note" rows={2} maxLength={2000} required={communication!=='not_sent'}/>
    </>}
   </div>
   <p className="field-help">Enter communication that has already happened.</p>
   {issue&&<p role="alert">{issue}</p>}
   <button className="field-cancel-submit" type="submit">Cancel job and close work time</button>
  </fieldset>
 </form>;
}
