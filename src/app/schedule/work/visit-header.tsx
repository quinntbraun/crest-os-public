import type {ReactNode} from 'react';
import type {FieldSessionView} from '../../../client/field-session-controller';
import {parseCustomer} from '../../../customer/customer-contract';
import {parseVehicle} from '../../../customer/vehicle-contract';
import {parseBookingLocation} from '../../../operations/confirmed-booking-contract';
import {AppointmentTime,appointmentDateTime} from '../appointment-time';

const states:Readonly<Record<string,string>>={scheduled:'Scheduled',en_route:'En route',in_progress:'In progress',paused:'Paused',completed:'Completed',cancelled:'Cancelled'};
const arrangements:Readonly<Record<string,string>>={mobile:'Mobile detail',dropoff:'Drop-off',pickup_return:'Pickup and return'};
type Resources=NonNullable<FieldSessionView['resources']>;

export function FieldVisitHeader({resources,departure,children}:{resources:Resources;departure?:string;children?:ReactNode}){
 const {job,appointment}=resources.head,business=resources.businessId;
 const customer=parseCustomer(resources.vehicles[0]!.customer_snapshot,business);
 const vehicles=resources.vehicles.map(row=>parseVehicle(row.vehicle_snapshot,business).label);
 const location=parseBookingLocation(job.work_location_snapshot,business,job.customer_id);
 const address=location.kind==='manual'?location.locationText:location.snapshot.exact_location_text||
  [location.snapshot.line1,location.snapshot.line2,location.snapshot.city,location.snapshot.region,location.snapshot.postal_code,location.snapshot.country].filter(Boolean).join(', ');
 return <header className="field-visit-heading">
  <p className="field-visit-state"><strong>{states[job.state]}</strong><span>{arrangements[job.fulfillment_mode]} · Version {job.version}</span></p>
  <h2>{customer.display_name}</h2>
  <p className="field-visit-vehicles">{vehicles.join(' · ')}</p>
  <dl>
   <div><dt>Confirmed visit</dt><dd><AppointmentTime start={appointment.start_at} end={appointment.end_at} timezone={appointment.timezone}/></dd></div>
   <div><dt>Work location</dt><dd>{address}</dd></div>
   {departure?<div><dt>Trip started</dt><dd><time dateTime={departure}>{appointmentDateTime(departure,appointment.timezone)}</time></dd></div>:
    job.first_work_at&&<div><dt>Work started</dt><dd><time dateTime={job.first_work_at}>{appointmentDateTime(job.first_work_at,appointment.timezone)}</time></dd></div>}
  </dl>
  {children}
 </header>;
}
