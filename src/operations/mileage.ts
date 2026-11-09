// DATABASE §1/BR09: exact four-decimal miles, independent estimates and explicit
// job attribution. No tax rate, expense, reimbursement or posting is inferred.
import {customerUuid} from '../customer/customer-contract.ts';
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
