'use client';
import type {Ref} from 'react';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {parseJobResources} from '../../operations/booking-context-contract';
import type {JobHistoryEvent} from '../../operations/confirmed-job-read-contract';
import type {BookingLocation} from '../../operations/confirmed-booking-contract';
import {parseBookingContact,parseBookingLocation} from '../../operations/confirmed-booking-contract';
import {parseCustomer} from '../../customer/customer-contract';
import {parseVehicle} from '../../customer/vehicle-contract';
import {quoteMoney} from '../../commercial/quote-pricing';
import {DropoffCustodyHistory} from './dropoff-custody-history';
import {PickupCollection} from './pickup-collection';
import {PickupTrips} from './pickup-trips';
import {InvoiceDrafts} from './work/invoice-drafts';
import {defaultWorkAction,workActionLabels} from './work/actions';

export type SavedJobResources=Exclude<ReturnType<typeof parseJobResources>,{state:'absent'}>;
import {AppointmentTime,appointmentDateTime} from './appointment-time';

const states:Readonly<Record<string,string>>={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const modes:Readonly<Record<string,string>>={mobile:'Mobile detail',dropoff:'Drop-off',pickup_return:'Pickup and return'};
const events={book:'Job booked',propose:'Time change proposed',confirm:'Time change confirmed',withdraw:'Proposal withdrawn',cancel:'Job cancelled',state_change:'Work status changed'};
const visitDetailsQuery='(min-width:880px)';
function subscribeVisitWidth(change:()=>void){const query=window.matchMedia(visitDetailsQuery);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);}
function wideVisitDetails(){return window.matchMedia(visitDetailsQuery).matches;}
function WorkLocation({value}:{value:BookingLocation}){
 if(value.kind==='manual')return <><p>{value.locationText}</p>{value.instructions&&<p className="field-help">{value.instructions}</p>}</>;
 const address=value.snapshot;
 return <><address>{[address.line1,address.line2,[address.city,address.region,address.postal_code].filter(Boolean).join(', '),address.country].filter(Boolean).map((line,index)=><div key={index}>{line}</div>)}</address>{address.exact_location_text&&<p>{address.exact_location_text}</p>}{address.instructions&&<p className="field-help">{address.instructions}</p>}</>;
}
type Props=Readonly<{
 resources:SavedJobResources;headingRef?:Ref<HTMLHeadingElement>;initialJobVehicleId?:string;visitsSource?:'customer'|'vehicle';history:readonly JobHistoryEvent[];historyComplete:boolean;busy:boolean;canChange:boolean;
 onWorkStatus?:(()=>void)|undefined;completionAvailable?:boolean;invoiceDraftsAvailable?:boolean;googleCalendarAvailable?:boolean;mileageAvailable?:boolean;workTimeAvailable?:boolean;dropoffCustodyAvailable?:boolean;pickupTripsAvailable?:boolean;pickupWorkAvailable?:boolean;pickupCollectionAvailable?:boolean;pickupPhotosAvailable?:boolean;pickupReleaseAvailable?:boolean;onChangeAppointment?:()=>void;onCancel?:()=>void;onDownload?:()=>void;onMoreHistory?:()=>void;
}>;
export function SavedJobDetails(props:Props){return <SavedJobDetailsContent key={props.resources.head.job.id+':'+props.resources.head.job.version} {...props}/>;}
function SavedJobDetailsContent({resources,headingRef,initialJobVehicleId,visitsSource,history,historyComplete,busy,canChange,onWorkStatus,completionAvailable,invoiceDraftsAvailable,googleCalendarAvailable,mileageAvailable,workTimeAvailable,dropoffCustodyAvailable,pickupTripsAvailable,pickupWorkAvailable,pickupCollectionAvailable,pickupPhotosAvailable,pickupReleaseAvailable,onChangeAppointment,onCancel,onDownload,onMoreHistory}:Props){
 const {head}=resources,{job,appointment,latestAppointment}=head;
 const visitDetailsOpen=useSyncExternalStore(subscribeVisitWidth,wideVisitDetails,()=>false);
 const customer=parseCustomer(resources.vehicles[0]!.customer_snapshot,resources.businessId);
 const primaryVehicle=parseVehicle((resources.vehicles.find(row=>row.id===initialJobVehicleId)??resources.vehicles[0]!).vehicle_snapshot,resources.businessId);
 const location=parseBookingLocation(job.work_location_snapshot,resources.businessId,job.customer_id),contact=parseBookingContact(appointment.contact_snapshot);
 const [copyState,setCopyState]=useState(''),alive=useRef(false),target=useRef<HTMLElement|null>(null);
 const savedHistory=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(initialJobVehicleId)target.current?.focus();},[initialJobVehicleId]);
 async function copyMessage(){
  if(!head.confirmationDraft||busy)return;
  try{await navigator.clipboard.writeText(head.confirmationDraft.bodyText);if(alive.current)setCopyState('Message copied. No delivery has been recorded.');}
  catch{if(alive.current)setCopyState('Copy could not be confirmed. Select the message text to copy it manually.');}
 }
 const changeable=canChange&&!busy&&job.state==='scheduled'&&job.first_work_at===null;
 const proposed=latestAppointment.confirmation_state==='proposed'&&latestAppointment.id!==appointment.id;
 const fieldAction=onWorkStatus&&(job.fulfillment_mode==='mobile'||
  dropoffCustodyAvailable&&job.fulfillment_mode==='dropoff'||
  pickupWorkAvailable&&job.fulfillment_mode==='pickup_return'&&job.state!=='scheduled'
 )?defaultWorkAction(job):null;
 const completionAction=completionAvailable&&(job.fulfillment_mode==='mobile'||dropoffCustodyAvailable&&job.fulfillment_mode==='dropoff'||
  pickupWorkAvailable&&job.fulfillment_mode==='pickup_return')&&['in_progress','paused','completed'].includes(job.state);
 const appointmentActions=(onChangeAppointment||onCancel)&&job.state==='scheduled'&&
  <section className="schedule-job-primary" aria-label="Job actions">
   {onChangeAppointment&&<button type="button" className={fieldAction?'secondary':undefined} disabled={!changeable} onClick={onChangeAppointment}>Change appointment…</button>}
   {onCancel&&<button type="button" className="secondary" disabled={!changeable} onClick={onCancel}>Cancel this job…</button>}
  </section>;
 return <article className="schedule-job" aria-label="Saved job">
  <header className="schedule-job-heading">
   <p className="schedule-job-state"><strong>{states[job.state]}</strong><span>{' · '}{modes[job.fulfillment_mode]}</span></p>
   <div className="schedule-job-identity"><h2 ref={headingRef} tabIndex={headingRef?-1:undefined}>{customer.display_name}</h2><p className="schedule-job-vehicle">Vehicle · {primaryVehicle.label}{resources.vehicles.length>1?' · +'+(resources.vehicles.length-1)+' more':''}</p></div>
   <a className="schedule-job-record-link" href={'/customers?customer='+encodeURIComponent(job.customer_id)+'&job='+encodeURIComponent(job.id)+(visitsSource==='customer'?'&view=visits':'')}>{visitsSource==='customer'?'Back to customer visits':'Open customer record'}</a>
   <dl className="job-appointment">
    <dt>{job.state==='cancelled'?'Retained appointment':'Confirmed appointment'}</dt>
    <dd><AppointmentTime start={appointment.start_at} end={appointment.end_at} timezone={appointment.timezone}/></dd>
   </dl>
   {(fieldAction||completionAction)&&<section className="schedule-job-primary" aria-label="Field work actions">
   {fieldAction&&<button type="button" disabled={busy||!canChange} onClick={onWorkStatus}>{fieldAction==='start_dropoff'?'Review work start':workActionLabels[fieldAction]}…</button>}
   {completionAction&&<a className={fieldAction?'schedule-job-completion':'primary-action'} href={'/schedule/work/complete?job='+encodeURIComponent(job.id)}>{job.state==='completed'?'Review saved completion':'Review and end job'}</a>}
   </section>}
   {!fieldAction&&!completionAction&&appointmentActions}
  </header>
  <details className="schedule-job-visit-details" open={visitDetailsOpen}><summary>Location and visit contact</summary><dl className="schedule-job-facts">
   <div><dt>Work location</dt><dd><WorkLocation value={location}/></dd></div>
   <div><dt>Contact for this visit</dt><dd>{contact.kind==='no_contact'?<>No contact selected: {contact.reason}</>:contact.value}</dd></div>
  </dl></details>
  <nav className="schedule-job-jumps" aria-label="Job sections">
   <a href="#job-vehicles">Vehicles</a>
   <a href="#job-work">Work scope</a>
   <a href="#job-history" onClick={()=>{if(savedHistory.current)savedHistory.current.open=true;}}>History</a>
   {invoiceDraftsAvailable&&<a href="#job-money">Invoice tools</a>}
  </nav>
  {proposed&&<section aria-label="Proposed appointment change"><h3>Time change awaiting confirmation</h3><p>{appointmentDateTime(latestAppointment.start_at,latestAppointment.timezone)} – {appointmentDateTime(latestAppointment.end_at,latestAppointment.timezone)}</p><p className="field-help">The confirmed appointment above still reserves the time. This proposal reserves no time.</p></section>}
  {pickupTripsAvailable&&job.fulfillment_mode==='pickup_return'&&<PickupTrips resources={resources} canChange={canChange&&!busy} workAvailable={pickupWorkAvailable===true}/>}
  <section id="job-vehicles" aria-label="Vehicles for this job"><h3>Vehicles</h3>{resources.vehicles.map(row=>{
   const vehicle=parseVehicle(row.vehicle_snapshot,resources.businessId);
   const pickup=row.pickup_location_snapshot===null?null:parseBookingLocation(row.pickup_location_snapshot,resources.businessId,job.customer_id),returned=row.return_location_snapshot===null?null:parseBookingLocation(row.return_location_snapshot,resources.businessId,job.customer_id);
   const selected=row.id===initialJobVehicleId,returnToVisits=selected&&visitsSource==='vehicle';
   const vehicleLinkLabel=returnToVisits?'Back to vehicle visits':'Open vehicle record';
   return <details key={row.id} open={selected||undefined}><summary ref={selected?target:undefined}>{vehicle.label}</summary><dl className="customer-values"><dt>Vehicle</dt><dd>{[vehicle.year,vehicle.make,vehicle.model,vehicle.color].filter(v=>v!==null&&v!=='').join(' · ')||vehicle.label}</dd>{vehicle.plate&&<><dt>Plate</dt><dd>{vehicle.plate}</dd></>}{vehicle.vin_raw&&<><dt>VIN</dt><dd>{vehicle.vin_raw}</dd></>}{pickup&&<><dt>Pickup</dt><dd><WorkLocation value={pickup}/></dd></>}{returned&&<><dt>Return</dt><dd><WorkLocation value={returned}/></dd></>}</dl>
    <a className="schedule-job-record-link" href={'/vehicles?vehicle='+encodeURIComponent(row.vehicle_id)+'&job='+encodeURIComponent(job.id)+'&jobVehicle='+encodeURIComponent(row.id)+(returnToVisits?'&view=visits':'')} aria-label={vehicleLinkLabel+' for '+vehicle.label}>{vehicleLinkLabel}</a>
    {pickupCollectionAvailable&&job.fulfillment_mode==='pickup_return'&&<PickupCollection businessId={resources.businessId} jobId={job.id} jobVehicleId={row.id} jobVersion={job.version} timezone={appointment.timezone} canChange={canChange&&!busy} photosAvailable={pickupPhotosAvailable===true} releaseAvailable={pickupReleaseAvailable===true}/>}
    {dropoffCustodyAvailable&&job.fulfillment_mode==='dropoff'&&<DropoffCustodyHistory businessId={resources.businessId} jobId={job.id} jobVehicleId={row.id} vehicleId={vehicle.id} timezone={appointment.timezone} canChange={canChange}/>}
   </details>;
  })}</section>
  <section id="job-work" aria-label="Retained work allocation"><h3>Work for this visit</h3><ul>{resources.scopeParts.map(part=><li key={part.sourceAllocationId+'/'+part.partitionId}><p>{part.scopeDescription}</p><p className="field-help">{quoteMoney(part.amountCents)} allocated · {part.state==='cancelled'?'Cancelled allocation':part.state==='completed'?'Completed scope':'Assigned scope'}</p></li>)}</ul></section>
  {head.confirmationDraft&&<details><summary>Prepared confirmation message</summary><p className="field-help">Prepared only. No message delivery is recorded here.</p><textarea aria-label="Prepared confirmation text" readOnly value={head.confirmationDraft.bodyText} rows={6}/><button type="button" className="secondary" disabled={busy} onClick={()=>void copyMessage()}>Copy message</button><p role="status" aria-live="polite">{copyState}</p></details>}
  {invoiceDraftsAvailable&&<div id="job-money"><InvoiceDrafts businessId={resources.businessId} jobId={job.id} canPrepare={job.state!=='cancelled'}/></div>}
  {(googleCalendarAvailable||mileageAvailable||workTimeAvailable&&job.fulfillment_mode==='mobile'&&job.first_work_at)&&
   <nav className="schedule-job-tools" aria-label="Saved job tools">
    {googleCalendarAvailable&&<a href={'/settings/google-calendar?job='+encodeURIComponent(job.id)}>Calendar sync status</a>}
    {mileageAvailable&&<a href={'/schedule/mileage?job='+encodeURIComponent(job.id)}>Review trip mileage</a>}
    {workTimeAvailable&&job.fulfillment_mode==='mobile'&&job.first_work_at&&<a href={'/schedule/work/time?job='+encodeURIComponent(job.id)}>Review recorded work time</a>}
   </nav>}
  {(fieldAction||completionAction)&&appointmentActions}
  <details id="job-history" className="job-history-panel" ref={savedHistory}>
   <summary>Saved history · version {job.version}</summary>
   {onDownload&&<button type="button" className="secondary" disabled={busy} onClick={onDownload}>Download saved history</button>}
   {history.length===0?<p>Load the retained history to review changes.</p>:<ol className="activity-timeline">{history.map(event=><li className="activity-entry" key={event.id}>
    <div className="activity-heading"><strong>{event.fromState==='en_route'&&event.toState==='scheduled'?'Trip interrupted and visit rescheduled':
     event.fromState==='en_route'&&event.toState==='cancelled'?'Trip interrupted and visit cancelled':events[event.action]}</strong><span className="activity-version">Version {event.sequence}</span></div>
    <p className="activity-meta"><time dateTime={event.recordedAt}>{appointmentDateTime(event.recordedAt,appointment.timezone)}</time></p>
    {event.reason&&<p>{event.reason}</p>}
    {event.conflictReview?<><p className="field-help">Schedule review: {event.conflictReview.appointmentIds.length?event.conflictReview.appointmentIds.length+' overlapping visits explicitly allowed':'No overlapping reservations recorded'}{event.conflictReview.unknownTravel?' · Unknown travel reviewed':''}.</p>{event.conflictReview.overrideReason&&<><strong>Schedule overlap override</strong><p>{event.conflictReview.overrideReason}</p></>}</>:(event.action==='book'||event.action==='confirm')&&<p className="field-help">Schedule review details are unavailable in this historical display record.</p>}
    {event.customerCommunication&&<>
     <p className="field-help">Customer communication: {event.customerCommunication.state==='sent'?'Recorded as sent':event.customerCommunication.state==='no_contact'?'No contact recorded':'Not sent'}</p>
     {event.customerCommunication.evidenceNote&&<details><summary>Communication note</summary><p>{event.customerCommunication.evidenceNote}</p></details>}
    </>}
   </li>)}</ol>}
   {!historyComplete&&onMoreHistory&&<button type="button" className="secondary" disabled={busy} onClick={onMoreHistory}>Load more history</button>}
   <p className="field-help">Saved version {job.version}. Details above use the retained visit snapshots.</p>
  </details>
 </article>;
}
