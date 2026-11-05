// Shared P06 time data. Local labels, UTC microseconds and reviewed offsets must
// describe the same actual instants; the browser clock creates no authority.
import {customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
export const scheduleTimeFields=['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes'] as const;
export type ScheduleTime=Readonly<{start_at:string;end_at:string;timezone:string;local_start:string;local_end:string;start_offset_minutes:number;end_offset_minutes:number}>;
export class ScheduleTimeError extends Error{constructor(){super('SCHEDULE_TIME_REVIEW_REQUIRED');this.name='ScheduleTimeError';}}
function check(value:unknown):asserts value{if(!value)throw new ScheduleTimeError();}
function endpoint(instant:unknown,local:unknown,offset:unknown,formatter:Intl.DateTimeFormat){
 check(customerInstant(instant)&&typeof local==='string'&&customerInstant(local+'Z')&&Number.isInteger(offset)&&Math.abs(Number(offset))<=840);
 const parts=formatter.formatToParts(new Date(instant)),get=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 const wall=get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute')+':'+get('second');
 check(wall===local.slice(0,19)&&instant.slice(20,26)===local.slice(20,26)&&Date.parse(local+'Z')-Date.parse(instant)===Number(offset)*60000);
}
export function parseScheduleTime(value:unknown):ScheduleTime{
 check(exact(value,scheduleTimeFields)&&typeof value.timezone==='string'&&value.timezone.length<=100&&/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value.timezone));
 try{
  const formatter=new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:value.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  endpoint(value.start_at,value.local_start,value.start_offset_minutes,formatter);endpoint(value.end_at,value.local_end,value.end_offset_minutes,formatter);check((value.end_at as string)>(value.start_at as string));
 }catch{throw new ScheduleTimeError();}
 return Object.freeze({...value}) as ScheduleTime;
}
export function scheduleInstantMicroseconds(value:string):bigint{
 check(customerInstant(value));return BigInt(Date.parse(value.slice(0,19)+'Z'))*1000n+BigInt(value.slice(20,26));
}
