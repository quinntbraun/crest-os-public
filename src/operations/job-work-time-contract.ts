import {customerInstant,customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {summarizeWorkTime} from './work-time.ts';
import type {RecordedWorkInterval} from './work-time.ts';

const states=['scheduled','en_route','in_progress','paused','completed','cancelled'] as const;
type JobState=typeof states[number];
const changes=['open','record','close','correct'] as const;
type ChangeKind=typeof changes[number];
type SavedInterval=Readonly<RecordedWorkInterval&{intervalId:string;versionId:string;sequence:string;
 pauseReason:string|null;recordReason:string|null;changeKind:ChangeKind;replacesVersionId:string|null;recordedAt:string}>;
const optionalReason=(value:unknown):value is string|null=>value===null||
 typeof value==='string'&&value.trim().length>0&&[...value].length<=1000;
function check(value:unknown):asserts value{if(!value)throw Error('JOB_WORK_TIME_REVIEW_REQUIRED');}
const utcInstant=(value:unknown):value is string=>customerInstant(value)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value);

export function parseJobWorkTime(value:unknown,businessId:string,jobId:string){
 check(uuid(businessId)&&uuid(jobId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','jobId','jobVersion','jobState','observedAt','intervalVersions'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.jobId===jobId&&version(value.jobVersion)&&
  states.includes(value.jobState as JobState)&&utcInstant(value.observedAt)&&Array.isArray(value.intervalVersions)&&
  value.intervalVersions.length<=1000&&Reflect.ownKeys(value.intervalVersions).length===value.intervalVersions.length+1);
 const source=value.intervalVersions,observedAt=value.observedAt;
 const current=new Map<string,SavedInterval>(),versionIds=new Set<string>();
 const intervalVersions=Array.from({length:source.length},(_,index)=>{
  const property=Object.getOwnPropertyDescriptor(source,String(index));
  check(property?.enumerable&&Object.hasOwn(property,'value'));
  const row:unknown=property.value;
  check(exact(row,['intervalId','versionId','sequence','kind','startedAt','endedAt','pauseReason','recordReason',
   'changeKind','replacesVersionId','recordedAt'])&&
   uuid(row.intervalId)&&uuid(row.versionId)&&version(row.sequence)&&(row.sequence==='1')===(row.intervalId===row.versionId)&&
   (row.kind==='active'||row.kind==='pause')&&utcInstant(row.startedAt)&&utcInstant(row.recordedAt)&&row.recordedAt<=observedAt&&
   row.startedAt<=row.recordedAt&&(row.endedAt===null||utcInstant(row.endedAt)&&row.startedAt<=row.endedAt&&row.endedAt<=row.recordedAt)&&
   optionalReason(row.pauseReason)&&optionalReason(row.recordReason)&&(row.kind==='pause')===(row.pauseReason!==null)&&
   changes.includes(row.changeKind as ChangeKind)&&(row.replacesVersionId===null||uuid(row.replacesVersionId)));
  const prior=current.get(row.intervalId),entry=Object.freeze({...row}) as SavedInterval;
  check(!versionIds.has(entry.versionId));
  if(prior){
   check(entry.replacesVersionId===prior.versionId&&BigInt(entry.sequence)===BigInt(prior.sequence)+1n&&
    entry.recordedAt>=prior.recordedAt&&(prior.endedAt===null||entry.endedAt!==null)&&
    (entry.changeKind==='correct'&&entry.recordReason!==null||
     entry.changeKind==='close'&&prior.endedAt===null&&entry.endedAt!==null&&
     entry.startedAt===prior.startedAt&&entry.kind===prior.kind&&entry.pauseReason===prior.pauseReason));
  }else{
   check(entry.sequence==='1'&&entry.replacesVersionId===null&&
    (entry.changeKind==='open'&&entry.endedAt===null||entry.changeKind==='record'&&entry.recordReason!==null));
  }
  current.set(entry.intervalId,entry);versionIds.add(entry.versionId);
  return entry;
 });
 const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
 const intervals=[...current.values()].sort((a,b)=>compare(a.startedAt,b.startedAt)||
  compare(a.endedAt??'~',b.endedAt??'~')||compare(a.intervalId,b.intervalId));
 const summary=summarizeWorkTime(intervals.map(({kind,startedAt,endedAt})=>({kind,startedAt,endedAt})),observedAt);
 const expected=value.jobState==='in_progress'?'active':value.jobState==='paused'?'pause':null;
 check((summary.openInterval?.kind??null)===expected);
 const record=Object.freeze({schemaVersion:1 as const,businessId,jobId,jobVersion:value.jobVersion,jobState:value.jobState as JobState,
  observedAt,intervalVersions:Object.freeze(intervalVersions)});
 return Object.freeze({record,intervals:Object.freeze(intervals),summary});
}
export type LoadedJobWorkTime=Exclude<ReturnType<typeof parseJobWorkTime>,{state:'absent'}>;
