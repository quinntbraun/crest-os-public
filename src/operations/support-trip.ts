import {customerInstant as instant,customerUuid as uuid,customerVersion as version} from '../customer/customer-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';

export const supportTripPurposes=['supply','between_jobs','return_to_base','other'] as const;
export const supportTripStates=['open','closed','cancelled'] as const;
export const supportTripConflicts=['operation','version','leg','state','occupancy','vehicle','job'] as const;
type Purpose=typeof supportTripPurposes[number];
type State=typeof supportTripStates[number];
type Place=Readonly<{schemaVersion:1;kind:'manual';locationText:string;instructions:string|null}>;
type Route=Readonly<{drivenVehicleId:string;jobId:string|null;purpose:Purpose;origin:Place;destination:Place;notes:string|null}>;
type Interval=Readonly<{departedAt:string;arrivedAt:string|null;state:State}>;
export type SupportTripBody=
 |Readonly<{action:'depart';reason:string|null;trip:Route}>
 |Readonly<{action:'arrive';reason:string|null;trip:null}>
 |Readonly<{action:'cancel';reason:string;trip:Readonly<{actualStop:Place}>}>
 |Readonly<{action:'record'|'correct';reason:string;trip:Route&Interval}>;
export type SupportTripSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 legId:string;expectedLegVersionId:string|null;body:SupportTripBody}>;
export type SupportTrip=Readonly<Route&Interval&{legId:string;legVersionId:string;sequence:string;reason:string|null;recordedAt:string}>;
export type SupportTripCursor=Readonly<{departedAt:string;legId:string}>;
export type SupportTripListQuery=Readonly<{businessId:string;after:SupportTripCursor|null;pageSize:number}>;
export type SupportTripHistoryQuery=Readonly<{businessId:string;legId:string;afterVersion:string;throughVersion:string;pageSize:number}>;

function check(v:unknown):asserts v{if(!v)throw Error('SUPPORT_TRIP_REVIEW_REQUIRED');}
function record(v:unknown,keys:readonly string[]):Record<string,unknown>{
 check(v!==null&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));
 const fields=Object.getOwnPropertyDescriptors(v);
 check(Reflect.ownKeys(fields).length===keys.length&&keys.every(key=>fields[key]?.enumerable&&Object.hasOwn(fields[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,fields[key]!.value]));
}
function text(v:unknown,max:number):v is string{
 return typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&[...v].every(c=>{
  const n=c.codePointAt(0)!;
  return [9,10,13].includes(n)||n>=32&&n!==127&&!(n>=0xd800&&n<=0xdfff);
 });
}
function place(value:unknown):Place{
 const row=record(value,['schemaVersion','kind','locationText','instructions']);
 check(row.schemaVersion===1&&row.kind==='manual'&&text(row.locationText,2000)&&(row.instructions===null||text(row.instructions,2000)));
 return Object.freeze(row) as Place;
}
function route(row:Record<string,unknown>):Route{
 check(uuid(row.drivenVehicleId)&&(row.jobId===null||uuid(row.jobId))&&supportTripPurposes.includes(row.purpose as Purpose)
  &&(row.notes===null||text(row.notes,2000)));
 return Object.freeze({drivenVehicleId:row.drivenVehicleId,jobId:row.jobId,purpose:row.purpose as Purpose,
  origin:place(row.origin),destination:place(row.destination),notes:row.notes});
}
function interval(row:Record<string,unknown>):Interval{
 check(instant(row.departedAt)&&supportTripStates.includes(row.state as State));
 check(row.state==='open'?row.arrivedAt===null:instant(row.arrivedAt)&&row.arrivedAt>=row.departedAt);
 return Object.freeze({departedAt:row.departedAt,arrivedAt:row.arrivedAt as string|null,state:row.state as State});
}
const routeKeys=['drivenVehicleId','jobId','purpose','origin','destination','notes'] as const;
const intervalKeys=['departedAt','arrivedAt','state'] as const;

export function parseSupportTripSave(value:unknown):SupportTripSave{
 const row=record(value,['schemaVersion','businessId','operationId','recoveryEpoch','legId','expectedLegVersionId','body']);
 check(row.schemaVersion===1&&[row.businessId,row.operationId,row.recoveryEpoch,row.legId].every(uuid));
 const body=record(row.body,['action','reason','trip']),action=body.action;
 check(['depart','arrive','cancel','record','correct'].includes(action as string));
 check(action==='depart'||action==='record'?row.expectedLegVersionId===null:uuid(row.expectedLegVersionId));
 check(body.reason===null?action==='depart'||action==='arrive':text(body.reason,1000));
 let parsed:SupportTripBody;
 if(action==='arrive'){
  check(body.trip===null);
  parsed={action,reason:body.reason as string|null,trip:null};
 }else if(action==='cancel'){
  const trip=record(body.trip,['actualStop']);
  parsed={action,reason:body.reason as string,trip:Object.freeze({actualStop:place(trip.actualStop)})};
 }else if(action==='depart'){
  parsed={action,reason:body.reason as string|null,trip:route(record(body.trip,routeKeys))};
 }else{
  const trip=record(body.trip,[...routeKeys,...intervalKeys]);
  parsed={action:action as 'record'|'correct',reason:body.reason as string,trip:Object.freeze({...route(trip),...interval(trip)})};
 }
 const result=Object.freeze({...row,body:Object.freeze(parsed)}) as SupportTripSave;
 supportTripOriginal(result);
 return result;
}
export function supportTripOriginal(request:SupportTripSave){
 const {action}=request.body;
 return parseFieldOriginal({schemaVersion:1,businessId:request.businessId,
  commandType:action==='record'||action==='correct'?'operations.support_trip.correct':'operations.support_trip.record',
  reference:{operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,legId:request.legId,
   expectedLegVersionId:request.expectedLegVersionId,action}});
}
export function parseSupportTripCommitted(value:unknown,input:SupportTripSave){
 const original=supportTripOriginal(parseSupportTripSave(input)),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}
function pageSize(value:unknown):value is number{
 return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=20;
}
export function parseSupportTripListQuery(value:unknown):SupportTripListQuery{
 const row=record(value,['businessId','after','pageSize']);
 check(uuid(row.businessId)&&pageSize(row.pageSize));
 if(row.after===null)return Object.freeze({businessId:row.businessId,after:null,pageSize:row.pageSize});
 const after=record(row.after,['departedAt','legId']);
 check(instant(after.departedAt)&&uuid(after.legId));
 return Object.freeze({businessId:row.businessId,after:Object.freeze({departedAt:after.departedAt,legId:after.legId}),pageSize:row.pageSize});
}
export function parseSupportTripHistoryQuery(value:unknown):SupportTripHistoryQuery{
 const row=record(value,['businessId','legId','afterVersion','throughVersion','pageSize']);
 check(uuid(row.businessId)&&uuid(row.legId)&&version(row.afterVersion,true)&&version(row.throughVersion)
  &&BigInt(row.afterVersion)<BigInt(row.throughVersion)&&pageSize(row.pageSize));
 return Object.freeze(row) as SupportTripHistoryQuery;
}
function trip(value:unknown):SupportTrip{
 const row=record(value,[...routeKeys,...intervalKeys,'legId','legVersionId','sequence','reason','recordedAt']);
 check(uuid(row.legId)&&uuid(row.legVersionId)&&version(row.sequence)&&instant(row.recordedAt)
  &&(row.reason===null||text(row.reason,1000)));
 const times=interval(row);
 check(times.departedAt<=row.recordedAt&&(times.arrivedAt===null||times.arrivedAt<=row.recordedAt));
 return Object.freeze({...route(row),...times,legId:row.legId,legVersionId:row.legVersionId,
  sequence:row.sequence,reason:row.reason,recordedAt:row.recordedAt});
}
export function parseSupportTripList(value:unknown,query:SupportTripListQuery){
 const row=record(value,['schemaVersion','businessId','active','trips','hasMore']);
 check(row.schemaVersion===1&&row.businessId===query.businessId&&Array.isArray(row.trips)
  &&row.trips.length<=query.pageSize&&typeof row.hasMore==='boolean'&&(!row.hasMore||row.trips.length===query.pageSize));
 const active=row.active===null?null:trip(row.active);
 check(!active||active.state==='open');
 let previous=query.after;
 const seen=new Set<string>();
 const trips=row.trips.map(value=>{
  const next=trip(value);
  check(next.state!=='open'&&!seen.has(next.legId)&&(!previous||next.departedAt<previous.departedAt
   ||next.departedAt===previous.departedAt&&next.legId<previous.legId));
  seen.add(next.legId);
  previous=next;
  return next;
 });
 return Object.freeze({schemaVersion:1 as const,businessId:query.businessId,active,trips:Object.freeze(trips),hasMore:row.hasMore});
}
export function parseSupportTripHistory(value:unknown,query:SupportTripHistoryQuery){
 const row=record(value,['schemaVersion','businessId','legId','throughVersion','trips','hasMore']);
 check(row.schemaVersion===1&&row.businessId===query.businessId&&row.legId===query.legId&&row.throughVersion===query.throughVersion
  &&Array.isArray(row.trips)&&row.trips.length>0&&row.trips.length<=query.pageSize&&typeof row.hasMore==='boolean');
 let next=BigInt(query.afterVersion);
 const trips=row.trips.map(value=>{
  const entry=trip(value);
  check(entry.legId===query.legId&&BigInt(entry.sequence)===++next);
  return entry;
 });
 check(row.hasMore?trips.length===query.pageSize&&next<BigInt(query.throughVersion):next===BigInt(query.throughVersion));
 return Object.freeze({schemaVersion:1 as const,businessId:query.businessId,legId:query.legId,throughVersion:query.throughVersion,
  trips:Object.freeze(trips),hasMore:row.hasMore});
}
