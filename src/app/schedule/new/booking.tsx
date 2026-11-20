'use client';
import {TaskPrerequisite} from '../../task-prerequisite';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createBookJobController,initialBookJobView} from '../../../client/book-job-controller';
import type {BookJobView} from '../../../client/book-job-controller';
import {createPendingSchedulingStore,pendingSchedulingKeys} from '../../../client/pending-scheduling';
import type {SchedulingOriginalKind} from '../../../operations/scheduling-original-contract';
import {initialBookingPayload,bookingTimeFacts,bookingWindow} from '../../../client/booking-form';
import type {BookingPayload,BookingAppointment} from '../../../operations/confirmed-booking-contract';
import {initialFulfillmentModes} from '../../../operations/fulfillment-mode-contract';
import {quoteMoney} from '../../../commercial/quote-pricing';
import {PhoneInput} from '../../customers/phone-input';
import {BookingInstantInput,BookingLocationInput} from '../booking-fields';
import {ScopeDivision} from './scope-division';
import {prepareBookingDivisions,divisionKey} from '../../../client/booking-scope-division';
import type {BookingDivision} from '../../../client/booking-scope-division';
import {bookingSlotInput,prepareSlotReview} from '../../../client/booking-slot-review';
import type {SlotReviewSelection} from '../../../client/booking-slot-review';
import {BookingSlotReview} from '../slot-review';
import {mergeBookingWorkDraft} from '../../../client/booking-work';
import type {BookingWork} from '../../../client/booking-work';
import {AppointmentTime} from '../appointment-time';
type WorkAction='addAgreement'|'addVehicle'|'removeAgreement';
const steps=['Work','Time and contact','Confirm'] as const;
type Step=typeof steps[number];
const arrangementLabels={mobile:'Mobile detail',dropoff:'Drop-off',pickup_return:'Pickup and return'};
const summaryQuery='(min-width:950px)';
function subscribeSummaryWidth(change:()=>void){const query=window.matchMedia(summaryQuery);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);}
function wideSummary(){return window.matchMedia(summaryQuery).matches;}
function BookingForm({view,save,moreAddresses,findAgreements,findVehicles,changeWork}:{view:BookJobView;save:(payload:BookingPayload)=>Promise<void>;moreAddresses:()=>void;findAgreements:(search:string,more?:boolean)=>void;findVehicles:(search:string,more?:boolean)=>void;changeWork:(kind:WorkAction,id:string)=>Promise<BookingWork|null>}){
 const summaryOpen=useSyncExternalStore(subscribeSummaryWidth,wideSummary,()=>false);
 const agreement=view.work!,context=view.context!,modeVersion=context.context.modeVersion,enabled={mobile:modeVersion?.mobile_enabled??initialFulfillmentModes.mobileEnabled,dropoff:modeVersion?.dropoff_enabled??initialFulfillmentModes.dropoffEnabled,pickup_return:modeVersion?.pickup_return_enabled??initialFulfillmentModes.pickupReturnEnabled};
 const [payload,setPayload]=useState(()=>{const initial=initialBookingPayload(agreement,context.context.operatorId,view.jobId,context.context.timezone);return {...initial,fulfillmentMode:enabled.mobile?'mobile' as const:enabled.dropoff?'dropoff' as const:enabled.pickup_return?'pickup_return' as const:'mobile' as const};}),[divisions,setDivisions]=useState<Record<string,BookingDivision>>({}),[contact,setContact]=useState(''),[channel,setChannel]=useState(''),[dirty,setDirty]=useState(false),[issue,setIssue]=useState('');
 const [slotReview,setSlotReview]=useState<SlotReviewSelection|null>(null),reviewInput=bookingSlotInput(context,payload.appointment,null);
 const [quoteSearch,setQuoteSearch]=useState(''),[vehicleSearch,setVehicleSearch]=useState('');
 const [step,setStep]=useState<Step>('Work');
 const form=useRef<HTMLFormElement>(null),focusStep=useRef(false);
 useLayoutEffect(()=>{
  if(!focusStep.current)return;
  focusStep.current=false;
  form.current?.querySelector<HTMLElement>('[data-booking-step]:not([hidden]) > h2')?.focus();
 },[step]);
 async function choose(kind:WorkAction,id:string){const previous=agreement,next=await changeWork(kind,id);if(!next)return;try{update(mergeBookingWorkDraft(payload,previous,next,view.jobId));setDivisions(current=>Object.fromEntries(Object.entries(current).filter(([key])=>next.sources.some(source=>source.parts.some(part=>divisionKey(source.sourceAllocationId,part.partitionId)===key)))));}catch{setIssue('The selected work changed. Reload current accepted scope before continuing.');}}
 const zones=[...new Set([context.context.timezone,Intl.DateTimeFormat().resolvedOptions().timeZone,'UTC'])],locked=view.busy||context.context.writeState!=='ready'||agreement.customer.archived_at!==null;
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 function update(next:BookingPayload){setPayload(next);setDirty(true);setIssue('');}
 function appointment(patch:Partial<BookingAppointment>){if((['start_at','end_at','timezone','travel_before_seconds','travel_after_seconds'] as const).some(key=>Object.hasOwn(patch,key)&&patch[key]!==payload.appointment[key]))setSlotReview(null);update({...payload,appointment:{...payload.appointment,...patch}});}
 function time(endpoint:'start'|'end',instant:string){try{const facts=bookingTimeFacts(instant,payload.appointment.timezone);appointment({[endpoint==='start'?'start_at':'end_at']:instant,[endpoint==='start'?'local_start':'local_end']:facts.local,[endpoint==='start'?'start_offset_minutes':'end_offset_minutes']:facts.offset});}catch{appointment({[endpoint==='start'?'start_at':'end_at']:''});}}
 function zone(timezone:string){try{const start=bookingTimeFacts(payload.appointment.start_at,timezone),end=bookingTimeFacts(payload.appointment.end_at,timezone);appointment({timezone,local_start:start.local,local_end:end.local,start_offset_minutes:start.offset,end_offset_minutes:end.offset});}catch{appointment({timezone,local_start:'',local_end:''});}}
 function division(key:string,patch:Partial<BookingDivision>){setDivisions(previous=>{const current=previous[key]??{amount:'',discount:'',visitScope:'',remainingScope:'',remainderId:crypto.randomUUID()};return {...previous,[key]:{...current,...patch,remainderId:current.remainderId}};});setDirty(true);setIssue('');}
 function assign(sourceId:string,partitionId:string,include:boolean){setDivisions(previous=>{const next={...previous};delete next[divisionKey(sourceId,partitionId)];return next;});update({...payload,allocationPlans:payload.allocationPlans.map(plan=>plan.sourceAllocationId!==sourceId?plan:{...plan,parts:plan.parts.map(part=>part.partitionId!==partitionId?part:{...part,jobId:include?view.jobId:null,state:include?'assigned':'unassigned'})})});}
 const plans=(()=>{
  try{return prepareBookingDivisions(agreement.sources,payload.allocationPlans,view.jobId,divisions).filter(plan=>plan.parts.some(part=>part.jobId===view.jobId));}
  catch{return null;}
 })();
 const parts=plans?.flatMap(plan=>plan.parts.filter(part=>part.jobId===view.jobId))??[];
 const total=parts.reduce((amount,part)=>amount+BigInt(part.amountCents),0n);
 const visitAmount=parts.length>0?'$'+(total/100n).toLocaleString('en-US')+'.'+String(total%100n).padStart(2,'0'):null;
 const validWindow=(()=>{
  try{bookingWindow(payload.appointment.start_at,payload.appointment.end_at,payload.appointment.timezone);return true;}
  catch{return false;}
 })();
 function move(next:Step){
  if(locked||next===step)return;
  focusStep.current=true;setIssue('');setStep(next);
 }
 function nativeFieldsReady(){
  const panel=form.current?.querySelector('[data-booking-step]:not([hidden])');
  const fields=panel?.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea')??[];
  const invalid=Array.from(fields).find(field=>field.willValidate&&!field.validity.valid);
  if(!invalid)return true;
  for(let details=invalid.closest('details');details;details=details.parentElement?.closest('details')??null)details.open=true;
  invalid.reportValidity();invalid.focus();
  return false;
 }
 function workIssue(){
  if(!enabled[payload.fulfillmentMode])return 'Select an available service arrangement.';
  if(payload.vehicles.length===0)return 'Include at least one vehicle in this visit.';
  if(!plans)return 'Complete every scope division’s exact amount, descriptions and any discount allocation.';
  if(plans.length===0)return 'Assign at least one item of accepted work to this visit.';
  for(const plan of plans){
   const source=agreement.sources.find(source=>source.sourceAllocationId===plan.sourceAllocationId)!;
   if(source.vehicleId!==null&&!payload.vehicles.some(vehicle=>vehicle.vehicleId===source.vehicleId))return 'Include the vehicle for each selected work item.';
   if(plan.expectedSequence!=='0'&&!plan.reason?.trim())return 'Give a reason when assigning previously allocated work.';
  }
  return null;
 }
 function advance(){
  if(locked||!nativeFieldsReady())return;
  if(step==='Work'){
   const issue=workIssue();if(issue){setIssue(issue);return;}
   move('Time and contact');return;
  }
  if(!validWindow){setIssue('Enter a valid start, end and time zone. The end must be after the start.');return;}
  move('Confirm');
 }
 async function submit(){
  if(locked||!nativeFieldsReady())return;
  try{
   const issue=workIssue();if(issue||!plans){move('Work');setIssue(issue??'Review the selected work.');return;}
   if(!contact||!validWindow){move('Time and contact');setIssue('Review the visit time and contact.');return;}
   if(!channel)throw Error();
   let reviewed;try{if(!reviewInput)throw Error();reviewed=prepareSlotReview(slotReview,context,reviewInput,payload.appointment.timezone);}catch{setIssue('Review the current schedule, acknowledge any unknown travel and give a reason for any overlapping visits before saving.');return;}
   const {unknownTravelReviewed,...conflictReview}=reviewed;
   await save({...payload,appointment:{...payload.appointment,unknown_travel_reviewed:unknownTravelReviewed},allocationPlans:plans,conflictReview});
  }catch{setIssue('Review the recorded customer confirmation before saving.');}
 }
 return <form ref={form} className="booking-workbench" aria-label="Confirmed visit booking" noValidate onChange={()=>setIssue('')} onSubmit={event=>{event.preventDefault();if(step==='Confirm')void submit();else advance();}}>
  <fieldset className="booking-editor" disabled={locked}>
   <legend className="visually-hidden">Visit for {agreement.customer.display_name}</legend>
   <ol className="booking-progress" aria-label="Booking steps">
    {steps.map((item,index)=><li key={item} aria-current={item===step?'step':undefined}>
     {index<steps.indexOf(step)?<button type="button" className="secondary" onClick={()=>move(item)}>{item}</button>:<span>{item}</span>}
    </li>)}
   </ol>
   <div className="booking-layout">
    <aside className="booking-summary" aria-label="Visit summary">
     <p className="field-help">Visit draft · No time reserved</p><h2>{agreement.customer.display_name}</h2>
     <p className="booking-summary-selection"><strong>{visitAmount??'Review selected work'}</strong><span>{parts.length} {parts.length===1?'work item':'work items'} · {payload.vehicles.length} {payload.vehicles.length===1?'vehicle':'vehicles'}</span></p>
     <details className="booking-summary-details" open={summaryOpen}><summary>Selected work and visit details</summary>
     <ul className="booking-selected-work">{parts.map(part=><li key={part.partitionId}>{part.scopeDescription} · {quoteMoney(part.amountCents)}</li>)}</ul>
     {parts.length===0&&<p className="field-help">Assign accepted work before continuing.</p>}
     <dl>
      <div><dt>Service</dt><dd>{arrangementLabels[payload.fulfillmentMode]}</dd></div>
      <div><dt>Vehicles</dt><dd>{payload.vehicles.length?payload.vehicles.map(vehicle=>agreement.vehicles.find(row=>row.id===vehicle.vehicleId)?.label).filter(Boolean).join(' · '):'Choose a vehicle'}</dd></div>
      {validWindow&&step!=='Confirm'&&<div><dt>Visit time</dt><dd><AppointmentTime start={payload.appointment.start_at} end={payload.appointment.end_at} timezone={payload.appointment.timezone} showOffset/></dd></div>}
     </dl>
     </details>
    </aside>
    <div className="booking-stage">
     <section data-booking-step="Work" hidden={step!=='Work'}>
      <h2 tabIndex={-1}>Work for the visit</h2>
      <p className="field-help">Choose the accepted work, vehicles and service location.</p>
  <details><summary>Combine accepted agreements · {agreement.agreements.length} selected</summary><p className="field-help">Only current accepted work for this customer can be added. Each agreement keeps its scope, price and history. A newer unaccepted draft does not replace its accepted agreement.</p><ol>{agreement.agreements.map((row,index)=><li key={row.familyId}><strong>{index===0?'Starting agreement':'Additional agreement '+index}</strong><p>{row.sources.map(source=>source.scopeDescription).join(' · ')}</p>{index>0&&<button type="button" className="secondary" onClick={()=>void choose('removeAgreement',row.familyId)}>Remove additional agreement {index} from draft</button>}</li>)}</ol><label htmlFor="booking-find-quotes">Find this customer’s quotes</label><input id="booking-find-quotes" type="search" maxLength={200} value={quoteSearch} onChange={event=>setQuoteSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();findAgreements(quoteSearch);}}}/><button type="button" className="secondary" onClick={()=>findAgreements(quoteSearch)}>Find quotes for this customer</button><ul className="customer-list" aria-label="Quotes available to check">{view.quoteRows.map(row=><li key={row.familyId}><p><strong>{row.title}</strong></p><p className="field-help">Current revision: {row.state}</p><button type="button" className="secondary" disabled={agreement.agreements.some(selected=>selected.familyId===row.familyId)} onClick={()=>void choose('addAgreement',row.familyId)}>{agreement.agreements.some(selected=>selected.familyId===row.familyId)?'Already selected':'Check and add accepted work'}</button></li>)}</ul>{view.quotesMore&&<button type="button" className="secondary" onClick={()=>findAgreements(quoteSearch,true)}>Load more customer quotes</button>}</details>
  <label htmlFor="booking-mode">Service arrangement</label><select id="booking-mode" value={payload.fulfillmentMode} onChange={event=>{const mode=event.target.value as BookingPayload['fulfillmentMode'];if(enabled[mode])update({...payload,fulfillmentMode:mode,vehicles:payload.vehicles.map(vehicle=>({...vehicle,pickupLocation:mode==='pickup_return'?{schemaVersion:1,kind:'manual',locationText:'',instructions:null}:null,returnLocation:mode==='pickup_return'?{schemaVersion:1,kind:'manual',locationText:'',instructions:null}:null}))});}}><option value="mobile" disabled={!enabled.mobile}>Mobile detail</option><option value="dropoff" disabled={!enabled.dropoff}>Drop-off</option><option value="pickup_return" disabled={!enabled.pickup_return}>Pickup and return{!enabled.pickup_return?' — not enabled':''}</option></select>
  <section aria-label="Visit vehicles"><h2>Vehicles</h2>{agreement.vehicles.length===0&&<p>No vehicles are available yet. Find a saved vehicle below.</p>}{agreement.vehicles.map(vehicle=><div key={vehicle.id}><label htmlFor={'booking-vehicle-'+vehicle.id}>{vehicle.label}{vehicle.archivedAt!==null?' — archived':''}</label><select id={'booking-vehicle-'+vehicle.id} disabled={vehicle.archivedAt!==null} value={payload.vehicles.some(row=>row.vehicleId===vehicle.id)?'include':'exclude'} onChange={event=>update({...payload,vehicles:event.target.value==='include'?[...payload.vehicles,{vehicleId:vehicle.id,expectedVersion:vehicle.version,customerVehicleId:null,pickupLocation:payload.fulfillmentMode==='pickup_return'?{schemaVersion:1,kind:'manual',locationText:'',instructions:null}:null,returnLocation:payload.fulfillmentMode==='pickup_return'?{schemaVersion:1,kind:'manual',locationText:'',instructions:null}:null}]:payload.vehicles.filter(row=>row.vehicleId!==vehicle.id)})}><option value="include">In this visit</option><option value="exclude">Not in this visit</option></select></div>)}<details><summary>Add another saved vehicle</summary><p className="field-help">Select an existing vehicle for this visit. This does not change its owner or add priced work. Include only work authorized by the selected accepted agreements.</p><label htmlFor="booking-find-vehicles">Find a saved vehicle</label><input id="booking-find-vehicles" type="search" maxLength={200} value={vehicleSearch} onChange={event=>setVehicleSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();findVehicles(vehicleSearch);}}}/><button type="button" className="secondary" onClick={()=>findVehicles(vehicleSearch)}>Find saved vehicles</button><ul className="customer-list" aria-label="Vehicles available to add">{view.vehicleRows.map(row=><li key={row.id}><p><strong>{row.label}</strong></p><p className="field-help">{[row.year,row.make,row.model,row.plate].filter(Boolean).join(' · ')}</p><button type="button" className="secondary" disabled={agreement.vehicles.some(vehicle=>vehicle.id===row.id)} onClick={()=>void choose('addVehicle',row.id)}>{agreement.vehicles.some(vehicle=>vehicle.id===row.id)?'Already available':'Add vehicle to visit'}</button></li>)}</ul>{view.vehiclesMore&&<button type="button" className="secondary" onClick={()=>findVehicles(vehicleSearch,true)}>Load more saved vehicles</button>}</details></section>
  <section aria-label="Accepted work for this visit"><h2>Work for this visit</h2><p className="field-help">Assign whole remaining parts or divide paid work explicitly between visits. Each selected agreement retains its own accepted scope and amounts.</p>{agreement.sources.map(source=><details key={source.sourceAllocationId} open={source.planSequence!=="0"}><summary>{source.scopeDescription} · {payload.allocationPlans.some(plan=>plan.sourceAllocationId===source.sourceAllocationId&&plan.parts.some(part=>part.jobId===view.jobId))?"Included":"Not included"} · {quoteMoney(source.amountCents)} agreed</summary>{source.parts.map(part=>{const plan=payload.allocationPlans.find(plan=>plan.sourceAllocationId===source.sourceAllocationId),included=plan?.parts.some(row=>row.partitionId===part.partitionId&&row.jobId===view.jobId);return <div key={part.partitionId}><p>{part.scopeDescription} · {quoteMoney(part.amountCents)}</p>{part.state==='unassigned'?<><label htmlFor={'booking-scope-'+part.partitionId}>Visit assignment</label><select id={'booking-scope-'+part.partitionId} value={included?'include':'exclude'} onChange={event=>assign(source.sourceAllocationId,part.partitionId,event.target.value==='include')}><option value="include">Assign to this visit</option><option value="exclude">Keep unassigned</option></select>{included&&part.amountCents!=='0'&&<ScopeDivision source={source} part={part} jobId={view.jobId} draft={divisions[divisionKey(source.sourceAllocationId,part.partitionId)]} change={patch=>division(divisionKey(source.sourceAllocationId,part.partitionId),patch)}/>}</>:<p className="field-help">Retained {part.state} scope; it cannot be reassigned here.</p>}</div>;})}{source.planSequence!=='0'&&payload.allocationPlans.some(plan=>plan.sourceAllocationId===source.sourceAllocationId&&plan.parts.some(part=>part.jobId===view.jobId))&&<><label htmlFor={'booking-allocation-reason-'+source.sourceAllocationId}>Reason for this scope allocation</label><textarea id={'booking-allocation-reason-'+source.sourceAllocationId} maxLength={1000} required value={payload.allocationPlans.find(plan=>plan.sourceAllocationId===source.sourceAllocationId)?.reason??''} onChange={event=>update({...payload,allocationPlans:payload.allocationPlans.map(plan=>plan.sourceAllocationId===source.sourceAllocationId?{...plan,reason:event.target.value.trim()?event.target.value:null}:plan)})}/></>}</details>)}</section>
  <BookingLocationInput label="Work location" value={payload.workLocation} addresses={view.addresses} change={workLocation=>update({...payload,workLocation})}/>{!view.addressesAvailable&&<p className="field-help">Saved addresses could not be verified. You can enter the actual visit location manually.</p>}{view.addressesMore&&<button type="button" className="secondary" onClick={moreAddresses}>Load more saved addresses</button>}
  {payload.fulfillmentMode==='pickup_return'&&payload.vehicles.map(vehicle=><section key={vehicle.vehicleId}><h3>Transport locations · {agreement.vehicles.find(row=>row.id===vehicle.vehicleId)?.label}</h3>{(['pickupLocation','returnLocation'] as const).map(key=><BookingLocationInput key={key} label={key==='pickupLocation'?'Pickup location':'Return location'} value={vehicle[key]??{schemaVersion:1,kind:'manual',locationText:'',instructions:null}} addresses={view.addresses} change={location=>update({...payload,vehicles:payload.vehicles.map(row=>row.vehicleId===vehicle.vehicleId?{...row,[key]:location}:row)})}/>)}</section>)}
     </section>
     <section data-booking-step="Time and contact" hidden={step!=='Time and contact'}>
      <h2 tabIndex={-1}>Time and contact</h2>
  <section aria-label="Confirmed appointment"><h3>Actual visit time</h3><label htmlFor="booking-zone">Time zone</label><input id="booking-zone" list="booking-zones" maxLength={100} value={payload.appointment.timezone} required onChange={event=>zone(event.target.value)}/><datalist id="booking-zones">{zones.map(zone=><option key={zone} value={zone}/>)}</datalist><div className="booking-time-fields"><BookingInstantInput key={'start:'+payload.appointment.timezone} label="Visit starts" value={payload.appointment.start_at} zone={payload.appointment.timezone} change={value=>time('start',value)}/><BookingInstantInput key={'end:'+payload.appointment.timezone} label="Visit ends" value={payload.appointment.end_at} zone={payload.appointment.timezone} change={value=>time('end',value)}/></div><p className="field-help">Enter both actual endpoints. Changing the zone preserves chosen instants; no duration is assumed.</p>
   <details><summary>Travel around this visit</summary><p className="field-help">Blank means travel is unknown. Enter 0 only when no travel time is needed. Estimates here are minutes.</p>{(['travel_before_seconds','travel_after_seconds'] as const).map(key=><label key={key}>{key==='travel_before_seconds'?'Travel before (minutes)':'Travel after (minutes)'}<input type="number" inputMode="numeric" min={0} max={35791394} step={1} value={payload.appointment[key]===null?'':payload.appointment[key]!/60} onChange={event=>appointment({[key]:event.target.value===''?null:event.target.valueAsNumber*60,unknown_travel_reviewed:false})}/></label>)}</details>
  </section>
  <section aria-label="Visit contact"><h2>Contact for this visit</h2><label htmlFor="booking-contact">Contact method</label><select id="booking-contact" value={contact} required onChange={event=>{const kind=event.target.value;setContact(kind);appointment({contact_snapshot:kind==='phone'?{kind:'phone',value:agreement.customer.phone_raw??''}:kind==='email'?{kind:'email',value:agreement.customer.email_raw??''}:{kind:'no_contact',reason:''}});}}><option value="">Choose the actual contact</option><option value="phone">Phone</option><option value="email">Email</option><option value="no_contact">No contact selected</option></select>{contact==='phone'&&payload.appointment.contact_snapshot.kind==='phone'&&<PhoneInput name="booking-phone" limit={512} value={payload.appointment.contact_snapshot.value} change={value=>appointment({contact_snapshot:{kind:'phone',value}})}/>} {contact==='email'&&payload.appointment.contact_snapshot.kind==='email'&&<label>Visit email<input type="email" inputMode="email" required maxLength={512} value={payload.appointment.contact_snapshot.value} onChange={event=>appointment({contact_snapshot:{kind:'email',value:event.target.value}})}/></label>}{contact==='no_contact'&&payload.appointment.contact_snapshot.kind==='no_contact'&&<label>Reason no contact is selected<textarea rows={2} maxLength={1000} required value={payload.appointment.contact_snapshot.reason} onChange={event=>appointment({contact_snapshot:{kind:'no_contact',reason:event.target.value}})}/></label>}</section>
     </section>
     <section data-booking-step="Confirm" hidden={step!=='Confirm'}>
      <h2 tabIndex={-1}>Confirm the visit</h2>
      {validWindow&&<section className="booking-final-facts" aria-label="Appointment to confirm">
       <dl><div><dt>Visit time</dt><dd><AppointmentTime start={payload.appointment.start_at} end={payload.appointment.end_at} timezone={payload.appointment.timezone} showOffset/></dd></div>
       <div><dt>Work location</dt><dd>{payload.workLocation.kind==='manual'?payload.workLocation.locationText:
        payload.workLocation.snapshot.exact_location_text||[payload.workLocation.snapshot.line1,payload.workLocation.snapshot.city,payload.workLocation.snapshot.region,payload.workLocation.snapshot.postal_code].filter(Boolean).join(', ')}</dd></div></dl>
       <p className="field-help">Saving creates the reservation. Send any customer message separately.</p>
      </section>}
  <section aria-label="Customer confirmation"><h3>Customer confirmation</h3><p>Record the customer’s actual confirmation of this visit’s time, location and selected work.</p><label htmlFor="booking-confirm-channel">Visit confirmation channel</label><select id="booking-confirm-channel" value={channel} required onChange={event=>{setChannel(event.target.value);appointment({customer_confirmation:{...payload.appointment.customer_confirmation,channel:event.target.value as BookingAppointment['customer_confirmation']['channel']}});}}><option value="">Choose how they confirmed</option><option value="text">Text</option><option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option></select><BookingInstantInput key={'confirmation:'+payload.appointment.timezone} label="When the customer confirmed this visit" value={payload.appointment.customer_confirmation.effectiveAt} zone={payload.appointment.timezone} change={effectiveAt=>appointment({customer_confirmation:{...payload.appointment.customer_confirmation,effectiveAt}})}/><label>Visit confirmation evidence<textarea rows={3} required maxLength={2000} value={payload.appointment.customer_confirmation.evidenceNote} onChange={event=>appointment({customer_confirmation:{...payload.appointment.customer_confirmation,evidenceNote:event.target.value}})}/></label></section>
      <BookingSlotReview context={context} input={reviewInput} timezone={payload.appointment.timezone} value={slotReview} change={value=>{setSlotReview(value);setIssue('');}}/>
      <p className="field-help">Crest rechecks the accepted work, operating modes and reservations when you save.</p>
     </section>
     {issue&&<p className="booking-issue" role="alert">{issue}</p>}
     <div className="booking-stage-actions">
      {step!=='Work'&&<button type="button" className="secondary" onClick={()=>move(step==='Confirm'?'Time and contact':'Work')}>Back</button>}
      <button type="submit" disabled={locked||!Object.values(enabled).some(Boolean)}>
       {step==='Work'?'Continue to time':step==='Time and contact'?'Continue to confirmation':'Confirm and save job'}
      </button>
     </div>
    </div>
   </div>
  </fieldset>
 </form>;
}
export function BookJobScreen({familyId}:{familyId:string}){
 const [view,setView]=useState(initialBookJobView),current=useRef<ReturnType<typeof createBookJobController>|null>(null),status=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{const storage={getItem:(key:string)=>sessionStorage.getItem(key),setItem:(key:string,value:string)=>sessionStorage.setItem(key,value),removeItem:(key:string)=>sessionStorage.removeItem(key)},controller=createBookJobController({store:createPendingSchedulingStore(storage,'operations.job.book'),blockers:(Object.keys(pendingSchedulingKeys) as SchedulingOriginalKind[]).filter(kind=>kind!=='operations.job.book').map(kind=>createPendingSchedulingStore(storage,kind)),change:setView});current.current=controller;void controller.load(familyId);const hide=()=>{if(document.visibilityState==='hidden')controller.suspend();},leave=()=>controller.suspend(),restore=(event:PageTransitionEvent)=>{if(event.persisted)controller.suspend();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);return()=>{current.current=null;controller.dispose();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};},[familyId]);
 useEffect(()=>{if(!view.busy&&view.phase!=='pending')return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[view.busy,view.phase]);
 async function action(kind:'load'|'check'|'retry'){const controller=current.current;if(!controller)return;await(kind==='load'?controller.load(familyId):controller[kind]());if(controller===current.current)status.current?.focus();}
 return <section aria-label="Book accepted work" aria-busy={view.busy}><p ref={status} className={view.selectionNeeded?'visually-hidden':'booking-status'} role="status" tabIndex={-1}>{view.message}</p>{view.phase==='signed-out'&&<a className="primary-action" href="/sign-in">Sign in to book a visit</a>}{view.phase==='ready'&&view.agreement&&view.context&&<BookingForm key={view.jobId} view={view} findAgreements={(search,more)=>void current.current?.findAgreements(search,more)} findVehicles={(search,more)=>void current.current?.findVehicles(search,more)} changeWork={async(kind,id)=>{const controller=current.current;if(!controller)return null;await controller[kind](id);const next=controller.view();return controller===current.current&&next.phase==='ready'&&next.jobId===view.jobId?next.work:null;}} moreAddresses={()=>void current.current?.moreAddresses()} save={async payload=>{const controller=current.current;if(!controller)return;await controller.save(payload);if(controller===current.current)status.current?.focus();}}/>}{["committed","pending"].includes(view.phase)&&view.savedJobId&&<a className="primary-action" href={'/schedule?job='+encodeURIComponent(view.savedJobId)}>Open saved job in Schedule</a>}{view.phase==='pending'&&<><p>No booking retries automatically. Keep the original reference until its outcome is verified.</p>{view.reference&&<p className="save-reference">Original booking reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check original booking</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('retry')}>Retry unchanged original booking</button>}<a href="/save-review?kind=operations.job.book">Review interrupted booking request</a></>}{view.phase==='loading'&&<div className="workspace-skeleton appointment-change-loading" aria-hidden="true"/>}
 {view.selectionNeeded&&<TaskPrerequisite kind="booking"/>}
 {(['review','unavailable'].includes(view.phase)||view.phase==='blocked'&&!view.selectionNeeded)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Reload current accepted scope</button>}<nav aria-label="Booking navigation"><a href="/quotes">Saved quotes</a><a href="/schedule">Schedule</a><a href="/save-review">Interrupted saves</a></nav></section>;
}
