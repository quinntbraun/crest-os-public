import {customerInstant as instant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseBookingLocation} from './confirmed-booking-contract.ts';
import type {BookingLocation} from './confirmed-booking-contract.ts';
import {parseFieldSessionSave} from './field-session-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const pickupTripKind='operations.pickup_trip.record' as const;
export const pickupTripConflicts=['operation','job','job_version','state','leg_version','vehicle','pickup_location','occupancy','leg'] as const;
type Site=Extract<BookingLocation,{kind:'manual'}>;
export type PickupTripBody=Readonly<
 {action:'depart';reason:string|null;trip:{jobVehicleIds:readonly string[];drivenVehicleId:string;origin:Site;etaAt:string|null;notes:string|null}}|
 {action:'arrive';reason:string|null;trip:null}|
 {action:'cancel';reason:string;trip:{actualStop:Site}}
>;
export type PickupTripSave=Readonly<{
 schemaVersion:1;businessId:string;jobId:string;expectedJobVersion:string;recoveryEpoch:string;operationId:string;
 legId:string;expectedLegVersionId:string|null;body:PickupTripBody;
}>;
export type PickupTripCursor=Readonly<{beforeDepartedAt:string|null;beforeLegId:string|null}>;
function check(value:unknown):asserts value{if(!value)throw Error('PICKUP_TRIP_DATA_REQUIRED');}
function text(value:unknown,max:number):value is string{
 return typeof value==='string'&&value.trim().length>0&&[...value].length<=max&&[...value].every(char=>{
  const code=char.codePointAt(0)!;
  return code===9||code===10||code===13||code>=32&&code!==127&&(code<0xd800||code>0xdfff);
 });
}
function targets(value:unknown):value is string[]{
 return Array.isArray(value)&&value.length>0&&value.every(uuid)&&new Set(value).size===value.length;
}
export function parsePickupTripSave(value:unknown):PickupTripSave{
 check(exact(value,['schemaVersion','businessId','jobId','expectedJobVersion','operationId','recoveryEpoch','legId','expectedLegVersionId','body']));
 check(value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.jobId)&&version(value.expectedJobVersion)&&
  BigInt(value.expectedJobVersion)<9223372036854775807n&&uuid(value.operationId)&&
  uuid(value.recoveryEpoch)&&uuid(value.legId)&&(value.expectedLegVersionId===null||uuid(value.expectedLegVersionId)));
 const body=value.body;
 check(exact(body,['action','reason','trip'])&&['depart','arrive','cancel'].includes(body.action as string));
 check((body.action==='depart')===(value.expectedLegVersionId===null));
 check(body.reason===null&&body.action!=='cancel'||text(body.reason,1000));
 let parsed:PickupTripBody;
 if(body.action==='depart'){
  check(exact(body.trip,['jobVehicleIds','drivenVehicleId','origin','etaAt','notes'])&&targets(body.trip.jobVehicleIds));
  const {jobVehicleIds,...trip}=body.trip;
  const departure=parseFieldSessionSave({schemaVersion:1,businessId:value.businessId,jobId:value.jobId,
   expectedJobVersion:value.expectedJobVersion,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
   body:{action:'depart',reason:body.reason,trip}}).body;
  check(departure.action==='depart');
  parsed={...departure,trip:{...departure.trip,jobVehicleIds}};
 }else if(body.action==='cancel'){
  check(text(body.reason,1000)&&exact(body.trip,['actualStop']));
  const stop=body.trip.actualStop;
  check(exact(stop,['schemaVersion','kind','locationText','instructions'])&&stop.schemaVersion===1&&stop.kind==='manual'
   &&text(stop.locationText,2000)&&(stop.instructions===null||text(stop.instructions,2000)));
  parsed={action:'cancel',reason:body.reason,trip:{actualStop:{schemaVersion:1,kind:'manual',locationText:stop.locationText,instructions:stop.instructions}}};
 }else{
  check(body.trip===null);
  parsed={action:'arrive',reason:body.reason as string|null,trip:null};
 }
 return Object.freeze({schemaVersion:1,businessId:value.businessId,jobId:value.jobId,expectedJobVersion:value.expectedJobVersion,
  recoveryEpoch:value.recoveryEpoch,operationId:value.operationId,legId:value.legId,expectedLegVersionId:value.expectedLegVersionId,body:parsed});
}
export function pickupTripOriginal(request:PickupTripSave){
 return parseFieldOriginal({schemaVersion:1,businessId:request.businessId,commandType:pickupTripKind,reference:{
  operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,jobId:request.jobId,
  expectedJobVersion:request.expectedJobVersion,legId:request.legId,expectedLegVersionId:request.expectedLegVersionId,action:request.body.action
 }});
}
export function parsePickupTripCommitted(value:unknown,request:PickupTripSave){
 const original=pickupTripOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
export function parsePickupTripCursor(value:unknown):PickupTripCursor{
 check(exact(value,['beforeDepartedAt','beforeLegId']));
 if(value.beforeDepartedAt===null&&value.beforeLegId===null)return {beforeDepartedAt:null,beforeLegId:null};
 check(instant(value.beforeDepartedAt)&&uuid(value.beforeLegId));
 return {beforeDepartedAt:value.beforeDepartedAt,beforeLegId:value.beforeLegId};
}
export type PickupTrip=Readonly<{
 legId:string;legVersionId:string;jobVehicleIds:readonly string[];drivenVehicleId:string;drivenVehicleLabel:string;departedAt:string;arrivedAt:string|null;
 state:'open'|'closed'|'cancelled';origin:BookingLocation;destination:BookingLocation;etaAt:string|null;reason:string|null;notes:string|null;
}>;
export type PickupTripPage=Readonly<{
 schemaVersion:1;state:'loaded';businessId:string;jobId:string;customerId:string;jobVersion:string;
 jobState:'scheduled'|'en_route'|'in_progress'|'paused'|'completed'|'cancelled';activeLegId:string|null;
 trips:readonly PickupTrip[];hasMore:boolean;
}>;
const loadedKeys=['schemaVersion','state','businessId','jobId','customerId','jobVersion','jobState','activeLegId','trips','hasMore'];
function parsePickupTrip(value:unknown,businessId:string,customerId:string):PickupTrip{
 check(exact(value,['legId','legVersionId','jobVehicleIds','drivenVehicleId','drivenVehicleLabel','departedAt','arrivedAt','state','origin','destination','etaAt','reason','notes']));
 check(uuid(value.legId)&&uuid(value.legVersionId)&&targets(value.jobVehicleIds)&&uuid(value.drivenVehicleId)&&
  text(value.drivenVehicleLabel,200)&&instant(value.departedAt)&&
  (value.etaAt===null||instant(value.etaAt))&&(value.reason===null||text(value.reason,1000))&&(value.notes===null||text(value.notes,2000)));
 const state=value.state;
 check(state==='open'||state==='closed'||state==='cancelled');
 check(state==='open'?value.arrivedAt===null&&value.legId===value.legVersionId:
  instant(value.arrivedAt)&&value.arrivedAt>=value.departedAt&&value.legId!==value.legVersionId);
 const origin=parseBookingLocation(value.origin,businessId,customerId),destination=parseBookingLocation(value.destination,businessId,customerId);
 check(origin.kind==='manual'&&(state!=='cancelled'||destination.kind==='manual'&&value.reason!==null));
 return Object.freeze({...value,origin,destination,state}) as PickupTrip;
}
export function parsePickupTripPage(value:unknown,scope:{businessId:string;jobId:string},cursor:PickupTripCursor):PickupTripPage|{state:'absent'}{
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'};
 check(exact(value,loadedKeys)&&value.schemaVersion===1&&value.state==='loaded'&&value.businessId===scope.businessId&&value.jobId===scope.jobId&&
  uuid(value.customerId)&&version(value.jobVersion)&&(value.activeLegId===null||uuid(value.activeLegId))&&typeof value.hasMore==='boolean'&&
  ['scheduled','en_route','in_progress','paused','completed','cancelled'].includes(value.jobState as string)&&Array.isArray(value.trips)&&
  value.trips.length<=20&&(!value.hasMore||value.trips.length===20));
 const trips=value.trips.map(row=>parsePickupTrip(row,scope.businessId,value.customerId as string));
 let prior=cursor.beforeDepartedAt===null?'':cursor.beforeDepartedAt+cursor.beforeLegId;
 for(const trip of trips){
  const key=trip.departedAt+trip.legId;
  check(!prior||prior>key);
  check((trip.state==='open')===(trip.legId===value.activeLegId));
  prior=key;
 }
 if(cursor.beforeLegId===null&&value.activeLegId!==null)check(trips.some(trip=>trip.legId===value.activeLegId));
 return Object.freeze({schemaVersion:1,state:'loaded',businessId:scope.businessId,jobId:scope.jobId,customerId:value.customerId,
  jobVersion:value.jobVersion,jobState:value.jobState as PickupTripPage['jobState'],activeLegId:value.activeLegId,trips,hasMore:value.hasMore});
}

export function parsePickupTripDatabasePage(value:unknown,scope:{businessId:string;jobId:string},cursor:PickupTripCursor){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
 check(exact(value,loadedKeys)&&Array.isArray(value.trips));
 const trips=value.trips.map(row=>{
  check(exact(row,['leg','jobVehicleIds','auditId','drivenVehicleLabel'])&&uuid(row.auditId)&&row.leg&&typeof row.leg==='object');
  const leg=row.leg as Record<string,unknown>;
  check(leg.business_id===scope.businessId&&leg.job_context_id===scope.jobId&&leg.purpose==='pickup');
  return {legId:leg.logical_id,legVersionId:leg.id,jobVehicleIds:row.jobVehicleIds,drivenVehicleId:leg.driven_vehicle_id,drivenVehicleLabel:row.drivenVehicleLabel,
   departedAt:leg.departed_at,arrivedAt:leg.arrived_at,state:leg.state,origin:leg.origin_snapshot,
   destination:leg.destination_snapshot,etaAt:leg.eta_at,reason:leg.reason,notes:leg.notes};
 });
 return parsePickupTripPage({...value,trips},scope,cursor);
}
