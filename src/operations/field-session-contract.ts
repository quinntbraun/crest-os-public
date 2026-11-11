// Persisted work transitions. This prepares data only; current state,
// authority, occupancy and idempotence are enforced by the existing SQL command.
import {customerUuid,customerVersion,customerInstant} from '../customer/customer-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
export type FieldAction='depart'|'arrive'|'direct_arrive'|'start_dropoff'|'pause'|'resume';
type Site=Readonly<{schemaVersion:1;kind:'manual';locationText:string;instructions:string|null}>;
type Body=Readonly<{action:Exclude<FieldAction,'depart'>;reason:string|null}>|Readonly<{action:'depart';reason:string|null;trip:Readonly<{drivenVehicleId:string;origin:Site;etaAt:string|null;notes:string|null}>}>;
export type FieldSessionSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;jobId:string;expectedJobVersion:string;body:Body}>;
export class FieldSessionDataError extends Error{constructor(){super('FIELD_SESSION_DATA_REQUIRED');this.name='FieldSessionDataError';}}
function check(v:unknown):asserts v{if(!v)throw new FieldSessionDataError();}
function record(v:unknown,keys:readonly string[]):Record<string,unknown>{
 check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));
 const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function text(v:unknown,max:number):v is string{return typeof v==='string'&&v.trim().length>0&&[...v].length<=max&&[...v].every(c=>{const n=c.codePointAt(0)!;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||[9,10,13].includes(n));});}
export function parseFieldSessionSave(value:unknown):FieldSessionSave{
 try{
  const row=record(value,['schemaVersion','businessId','operationId','recoveryEpoch','jobId','expectedJobVersion','body']);
  check(row.schemaVersion===1&&[row.businessId,row.operationId,row.recoveryEpoch,row.jobId].every(customerUuid)&&customerVersion(row.expectedJobVersion)&&BigInt(row.expectedJobVersion)<9223372036854775807n);
  // Inspect descriptors before reading the action: accessors/hooks are never
  // invoked while sealing an operation's target or draft.
  check(row.body!==null&&typeof row.body==='object');const action=Object.getOwnPropertyDescriptor(row.body,'action');check(action&&Object.hasOwn(action,'value')&&action.enumerable);
  const body=record(row.body,action.value==='depart'?['action','reason','trip']:['action','reason']);check(typeof body.action==='string'&&['depart','arrive','direct_arrive','start_dropoff','pause','resume'].includes(body.action));
  check(body.reason===null?['depart','arrive','start_dropoff','resume'].includes(body.action):text(body.reason,1000));
  let parsed:Body;
  if(body.action==='depart'){
   const trip=record(body.trip,['drivenVehicleId','origin','etaAt','notes']),origin=record(trip.origin,['schemaVersion','kind','locationText','instructions']);
   check(customerUuid(trip.drivenVehicleId)&&origin.schemaVersion===1&&origin.kind==='manual'&&text(origin.locationText,2000)&&(origin.instructions===null||text(origin.instructions,2000))&&(trip.notes===null||text(trip.notes,2000)));
   check(trip.etaAt===null||typeof trip.etaAt==='string'&&trip.etaAt.length===27&&trip.etaAt.endsWith('Z')&&customerInstant(trip.etaAt));
   parsed=Object.freeze({action:'depart' as const,reason:body.reason as string|null,trip:Object.freeze({drivenVehicleId:trip.drivenVehicleId,origin:Object.freeze({...origin}) as Site,etaAt:trip.etaAt as string|null,notes:trip.notes as string|null})});
  }else parsed=Object.freeze({action:body.action as Exclude<FieldAction,'depart'>,reason:body.reason as string|null});
  const result=Object.freeze({...row,body:parsed}) as FieldSessionSave;fieldSessionOriginal(result);return result;
 }catch(error){if(error instanceof FieldSessionDataError)throw error;throw new FieldSessionDataError();}
}
export function fieldSessionOriginal(request:FieldSessionSave){
 return parseFieldOriginal({schemaVersion:1,businessId:request.businessId,commandType:'operations.job.field',reference:{operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,jobId:request.jobId,expectedJobVersion:request.expectedJobVersion,action:request.body.action}});
}
export function parseFieldSessionCommitted(value:unknown,input:FieldSessionSave){
 const request=parseFieldSessionSave(input),original=fieldSessionOriginal(request),result=parseFieldOriginalResult(value,original);check(result.state==='committed');return Object.freeze({schemaVersion:1 as const,original,result});
}
export const fieldSessionConflicts=Object.freeze(['operation','job','version','state','custody','travel','vehicle','occupancy'] as const);
