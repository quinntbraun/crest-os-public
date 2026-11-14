// DATABASE §1/BR09: exact four-decimal miles, independent estimates and explicit
// job attribution. No tax rate, expense, reimbursement or posting is inferred.
import {customerInstant,customerUuid,customerVersion} from '../customer/customer-contract.ts';
import {parseFieldOriginal,parseFieldOriginalResult} from './field-original-contract.ts';
import type {FieldOriginal} from './field-original-contract.ts';
import {supportTripPurposes} from './support-trip.ts';
export type MileageBody=Readonly<{
 source:'odometer'|'manual_actual'|'route_estimate';movementKind:'business_rig'|'customer_vehicle'|'personal'|'unclassified';
 actualMiles:string|null;estimateMiles:string|null;estimateSource:string|null;
 odometerStart:string|null;odometerEnd:string|null;notes:string|null;reason:string|null;
 allocationState:'unallocated'|'draft'|'allocated';allocations:readonly Readonly<{jobId:string;fraction:string}>[];
}>;
const keys=['source','movementKind','actualMiles','estimateMiles','estimateSource','odometerStart','odometerEnd','notes','reason','allocationState','allocations'] as const;
function check(v:unknown):asserts v{if(!v)throw Error('MILEAGE_INPUT_REQUIRED');}
function record(v:unknown,fields:readonly string[]):Record<string,unknown>{
 check(v!==null&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));
 const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===fields.length&&fields.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k]!,'value')));
 return Object.fromEntries(fields.map(k=>[k,d[k]!.value]));
}
function array(v:unknown):unknown[]{
 check(Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length<=1000);
 const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===v.length+1&&Array.from({length:v.length},(_,i)=>d[i]?.enumerable&&Object.hasOwn(d[i]!,'value')).every(Boolean));
 return Array.from({length:v.length},(_,i)=>d[i]!.value);
}
function decimal(v:unknown,places:number,wholeDigits:number):string|null{
 if(v===null||v==='')return null;check(typeof v==='string');
 check(new RegExp('^(0|[1-9][0-9]{0,'+(wholeDigits-1)+'})(\\.[0-9]{1,'+places+'})?$').test(v));
 const [whole,fraction='']=v.split('.');return whole+'.'+fraction.padEnd(places,'0');
}
function units(v:string){return BigInt(v.replace('.',''));}
export function mileageShareFraction(percent:string){
 const value=decimal(percent.trim(),6,3);
 check(value);
 const share=units(value);
 check(share>0n&&share<=100000000n);
 return (share/100000000n).toString()+'.'+(share%100000000n).toString().padStart(8,'0');
}
export function mileageSharePercent(fraction:string){
 const value=decimal(fraction,8,1);
 check(value);
 const share=units(value);
 const decimals=(share%1000000n).toString().padStart(6,'0').replace(/0+$/,'');
 return (share/1000000n).toString()+(decimals?'.'+decimals:'');
}
function miles(v:bigint){return (v/10000n).toString()+'.'+(v%10000n).toString().padStart(4,'0');}
function text(v:unknown,limit:number):string|null{
 if(v===null||v==='')return null;check(typeof v==='string'&&v.trim().length>0&&[...v].length<=limit&&[...v].every(c=>{const n=c.codePointAt(0)!;return n===9||n===10||n===13||n>=32&&n!==127&&!(n>=0xd800&&n<=0xdfff);}));return v;
}
export function prepareMileageBody(input:unknown):MileageBody{
 const r=record(input,keys);check(['odometer','manual_actual','route_estimate'].includes(r.source as string));
 const movementKind=r.movementKind===null||r.movementKind===''?'unclassified':r.movementKind;
 check(['business_rig','customer_vehicle','personal','unclassified'].includes(movementKind as string));
 let actualMiles=decimal(r.actualMiles,4,10);const estimateMiles=decimal(r.estimateMiles,4,10),odometerStart=decimal(r.odometerStart,4,10),odometerEnd=decimal(r.odometerEnd,4,10);
 const estimateSource=text(r.estimateSource,1000),notes=text(r.notes,2000),reason=text(r.reason,1000);
 check((estimateMiles===null)===(estimateSource===null));check((odometerStart===null)===(odometerEnd===null));
 if(odometerStart!==null&&odometerEnd!==null)check(units(odometerEnd)>=units(odometerStart));
 if(r.source==='odometer'){
  check(odometerStart!==null&&odometerEnd!==null);const derived=miles(units(odometerEnd)-units(odometerStart));check(actualMiles===null||actualMiles===derived);actualMiles=derived;
 }else if(r.source==='manual_actual')check(actualMiles!==null);
 else check(actualMiles===null&&estimateMiles!==null&&odometerStart===null);
 const allocations=array(r.allocations).map(v=>{const a=record(v,['jobId','fraction']);check(customerUuid(a.jobId));const fraction=decimal(a.fraction,8,1);check(fraction!==null&&units(fraction)<=100000000n);return Object.freeze({jobId:a.jobId,fraction});}).sort((a,b)=>a.jobId<b.jobId?-1:a.jobId>b.jobId?1:0);
 check(new Set(allocations.map(a=>a.jobId)).size===allocations.length);
 const allocationState=r.allocationState===null||r.allocationState===''?'unallocated':r.allocationState;
 check(['unallocated','draft','allocated'].includes(allocationState as string));const sum=allocations.reduce((n,a)=>n+units(a.fraction),0n);
 check(allocationState==='unallocated'?allocations.length===0:allocations.length>0&&sum<=100000000n&&(allocationState!=='allocated'||sum===100000000n));
 return Object.freeze({source:r.source,movementKind,actualMiles,estimateMiles,estimateSource,odometerStart,odometerEnd,notes,reason,allocationState,allocations:Object.freeze(allocations)}) as MileageBody;
}

type MileageOriginal=Extract<FieldOriginal,{commandType:'operations.mileage.record'}>;
export type MileageSave=Readonly<{
 schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 legId:string;expectedLegVersionId:string;expectedEvidenceVersion:string;body:MileageBody;
}>;
export function mileageOriginal(input:Pick<MileageSave,'businessId'|'operationId'|'recoveryEpoch'|'legId'|'expectedLegVersionId'|'expectedEvidenceVersion'>):MileageOriginal{
 const {businessId,operationId,recoveryEpoch,legId,expectedLegVersionId,expectedEvidenceVersion}=input;
 const original=parseFieldOriginal({schemaVersion:1,businessId,commandType:'operations.mileage.record',
  reference:{operationId,recoveryEpoch,legId,expectedLegVersionId,expectedEvidenceVersion}});
 check(original.commandType==='operations.mileage.record');
 return original;
}
export function parseMileageSave(input:unknown):MileageSave{
 const request=record(input,['schemaVersion','businessId','operationId','recoveryEpoch','legId','expectedLegVersionId','expectedEvidenceVersion','body']);
 check(request.schemaVersion===1);
 const original=mileageOriginal(request as unknown as MileageSave);
 const body=prepareMileageBody(request.body);
 check(original.reference.expectedEvidenceVersion==='0'||body.reason!==null);
 return Object.freeze({schemaVersion:1,businessId:original.businessId,...original.reference,body});
}
export const mileageSaveConflicts=Object.freeze(['operation','leg','leg_version','open_leg','version','job'] as const);
export function parseMileageCommitted(value:unknown,request:MileageSave){
 const original=mileageOriginal(request),result=parseFieldOriginalResult(value,original);
 check(result.state==='committed');
 return Object.freeze({schemaVersion:1 as const,original,result});
}

const tripStates=['open','closed','cancelled'] as const;
const tripPurposes=['mobile_work_site','supply','between_jobs','return_to_base','pickup','to_work_site','return_to_customer','other'] as const;
const distanceStatuses=['unresolved','estimated','confirmed_actual','needs_review'] as const;
type MileageTripCursor=Readonly<{departedAt:string;legId:string}>;
export type MileageTripQuery=Readonly<{businessId:string;jobId:string;after:MileageTripCursor|null;pageSize:number}>;
export type MileageTrip=MileageTripCursor&Readonly<{
 legVersionId:string;evidenceVersion:string;arrivedAt:string|null;state:typeof tripStates[number];
 purpose:typeof tripPurposes[number];distanceStatus:typeof distanceStatuses[number];
}>;
export function parseMileageTripQuery(input:unknown):MileageTripQuery{
 const query=record(input,['businessId','jobId','after','pageSize']);
 check(customerUuid(query.businessId)&&customerUuid(query.jobId)&&typeof query.pageSize==='number'
  &&Number.isInteger(query.pageSize)&&query.pageSize>=1&&query.pageSize<=25);
 const cursor=query.after===null?null:record(query.after,['departedAt','legId']);
 if(cursor)check(customerInstant(cursor.departedAt)&&customerUuid(cursor.legId));
 return Object.freeze({businessId:query.businessId,jobId:query.jobId,pageSize:query.pageSize,
  after:cursor&&Object.freeze(cursor as MileageTripCursor)});
}
function parseMileageTrip(value:unknown):MileageTrip{
  const row=record(value,['legId','legVersionId','evidenceVersion','departedAt','arrivedAt','state','purpose','distanceStatus']);
  check(customerUuid(row.legId)&&customerUuid(row.legVersionId)&&customerVersion(row.evidenceVersion,true)
   &&customerInstant(row.departedAt)&&tripStates.includes(row.state as MileageTrip['state'])
   &&tripPurposes.includes(row.purpose as MileageTrip['purpose'])
   &&distanceStatuses.includes(row.distanceStatus as MileageTrip['distanceStatus']));
  check(row.state==='open'?row.arrivedAt===null:customerInstant(row.arrivedAt)&&row.arrivedAt>=row.departedAt);
  check((row.evidenceVersion==='0')===(row.distanceStatus==='unresolved'));
  return Object.freeze(row) as MileageTrip;
}
export function parseSupportTripMileage(input:unknown,businessId:string,legId:string){
 const result=record(input,['schemaVersion','businessId','trip']);
 check(customerUuid(businessId)&&result.businessId===businessId&&result.schemaVersion===1&&customerUuid(legId));
 const trip=parseMileageTrip(result.trip);
 check(trip.legId===legId&&trip.state!=='open'&&supportTripPurposes.some(purpose=>purpose===trip.purpose));
 return Object.freeze({schemaVersion:1 as const,businessId,trip});
}
export function parseMileageTripPage(input:unknown,query:MileageTripQuery){
 const result=record(input,['schemaVersion','state','businessId','jobId','hasMore','trips']);
 check(result.schemaVersion===1&&result.state==='loaded'&&result.businessId===query.businessId
  &&result.jobId===query.jobId&&typeof result.hasMore==='boolean');
 const trips=array(result.trips).map(parseMileageTrip);
 check(trips.length<=query.pageSize&&(!result.hasMore||trips.length===query.pageSize));
 check(new Set(trips.map(row=>row.legId)).size===trips.length);
 let previous=query.after;
 for(const row of trips){
  check(!previous||row.departedAt<previous.departedAt||row.departedAt===previous.departedAt&&row.legId<previous.legId);
  previous=row;
 }
 return Object.freeze({schemaVersion:1 as const,state:'loaded' as const,businessId:query.businessId,jobId:query.jobId,
  hasMore:result.hasMore,trips:Object.freeze(trips)});
}
