// UI projections and original JSON-text source rows are deliberately separate.
// Parsing a UI value never establishes original byte/hash or export custody.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseScheduleTime,scheduleTimeFields} from './schedule-time.ts';
import {parseBookingLocation,parseBookingContact,requireBooking} from './confirmed-booking-contract.ts';
import {parseCustomer} from '../customer/customer-contract.ts';
import {parseVehicle} from '../customer/vehicle-contract.ts';
import {parseFulfillmentModeVersion} from './fulfillment-mode-contract.ts';
import {bookingRecordSchema} from './confirmed-booking-record-schema.ts';
export {bookingRecordSchema};
export type BookingRecordGroup=keyof typeof bookingRecordSchema;
export const bookingRecordGroups=Object.freeze(Object.keys(bookingRecordSchema) as BookingRecordGroup[]);
type Descriptor={readonly type:string;readonly nullable:boolean};
type JsonObject=Readonly<Record<string,unknown>>;
type Range=Readonly<{start_at:string;end_at:string;lower_inclusive:true;upper_inclusive:false}>;
type Field<D extends Descriptor>=D['type'] extends 'boolean'?boolean:D['type'] extends 'integer'?number:D['type'] extends 'jsonb'?JsonObject:D['type'] extends 'tstzrange'?Range:string;
export type BookingRecord<G extends BookingRecordGroup>=Readonly<{[K in keyof typeof bookingRecordSchema[G]]:(typeof bookingRecordSchema[G])[K] extends infer D extends Descriptor?Field<D>|(D['nullable'] extends true?null:never):never}>;
export const jobStates=['scheduled','en_route','in_progress','paused','completed','cancelled'] as const;
export const appointmentStates=['proposed','confirmed','withdrawn','cancelled'] as const;
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function seal(v:unknown,depth=0):unknown{
 requireBooking(depth<=32);if(Array.isArray(v))return Object.freeze(v.map(child=>seal(child,depth+1)));
 if(object(v))return Object.freeze(Object.fromEntries(Object.entries(v).map(([key,child])=>[key,seal(child,depth+1)])));
 requireBooking(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&!v.includes('\0')&&[...v].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff);}));return v;
}
export function parseBookingRecord<G extends BookingRecordGroup>(group:G,v:unknown,businessId:string):BookingRecord<G>{
 const fields=bookingRecordSchema[group];requireBooking(fields&&customerUuid(businessId)&&exact(v,Object.keys(fields))&&v.business_id===businessId);
 for(const [column,spec]of Object.entries(fields)){
  const value=v[column];if(value===null){requireBooking(spec.nullable);continue;}
  switch(spec.type){
   case 'uuid':requireBooking(customerUuid(value));break;
   case 'bigint':requireBooking(customerVersion(value,column.endsWith('_cents')));break;
   case 'timestamptz':requireBooking(customerInstant(value));break;
   case 'timestamp':requireBooking(typeof value==='string'&&customerInstant(value+'Z'));break;
   case 'integer':requireBooking(typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647);break;
   case 'boolean':requireBooking(typeof value==='boolean');break;
   case 'jsonb':requireBooking(object(value));break;
   case 'tstzrange':requireBooking(exact(value,['start_at','end_at','lower_inclusive','upper_inclusive'])&&customerInstant(value.start_at)&&customerInstant(value.end_at)&&value.end_at>value.start_at&&value.lower_inclusive===true&&value.upper_inclusive===false);break;
   case 'text':requireBooking(typeof value==='string'&&!value.includes('\0'));break;
  }
 }
 requireBooking(v.origin==='manual');
 if(group==='fulfillment_mode_versions')return parseFulfillmentModeVersion(v,businessId) as BookingRecord<G>;
 if(group==='jobs'){
  requireBooking(jobStates.includes(v.state as typeof jobStates[number])&&['mobile','dropoff','pickup_return'].includes(v.fulfillment_mode as string)&&(v.completion_outcome===null||['full','partial'].includes(v.completion_outcome as string))&&(v.state==='completed')===(v.completed_at!==null&&v.completion_outcome!==null));
  parseBookingLocation(v.work_location_snapshot,businessId,v.customer_id as string);requireBooking((v.updated_at as string)>=(v.created_at as string));
 }
 if(group==='appointments'){
  requireBooking(appointmentStates.includes(v.confirmation_state as typeof appointmentStates[number]));parseScheduleTime(Object.fromEntries(scheduleTimeFields.map(k=>[k,v[k]])));parseBookingContact(v.contact_snapshot);
  requireBooking(v.sequence==='1'?v.replaces_id===null:v.replaces_id!==null);for(const key of ['travel_before_seconds','travel_after_seconds'])requireBooking(v[key]===null||(v[key] as number)>=0);
  if(v.confirmation_state==='confirmed'){const c=v.customer_confirmation;requireBooking(exact(c,['channel','effectiveAt','evidenceNote'])&&['text','phone','email','in_person'].includes(c.channel as string)&&customerInstant(c.effectiveAt)&&(c.effectiveAt as string)<=(v.created_at as string)&&typeof c.evidenceNote==='string'&&c.evidenceNote.trim().length>0);}
  else requireBooking(v.customer_confirmation===null);
 }
 if(group==='job_vehicles'){const vehicle=parseVehicle(v.vehicle_snapshot,businessId);parseCustomer(v.customer_snapshot,businessId);requireBooking(vehicle.id===v.vehicle_id);}
 if(group==='allocation_plan_versions')requireBooking(v.sequence==='1'?v.replaces_id===null:v.replaces_id!==null);
 if(group==='allocation_plan_parts')requireBooking(['unassigned','assigned','completed','cancelled'].includes(v.allocation_state as string)&&(v.job_id===null)===(v.allocation_state==='unassigned')&&BigInt(v.gross_inclusive_cents as string)-BigInt(v.discount_inclusive_cents as string)===BigInt(v.amount_cents as string)&&typeof v.scope_description==='string'&&v.scope_description.trim().length>0);
 if(group==='job_events')requireBooking((v.from_state===null||jobStates.includes(v.from_state as typeof jobStates[number]))&&jobStates.includes(v.to_state as typeof jobStates[number])&&(v.effective_at as string)<=(v.created_at as string));
 return seal(v) as BookingRecord<G>;
}
