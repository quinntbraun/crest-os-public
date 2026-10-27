import {customerUuid as uuid,customerInstant as instant} from '../customer/customer-contract.ts';
import {parseSourceExportJob} from './source-export-job-contract.ts';
export type SourceExportCursor=Readonly<{createdAt:string;id:string}>;
export class SourceExportListError extends Error{constructor(){super('SOURCE_EXPORT_LIST_REVIEW_REQUIRED');this.name='SourceExportListError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportListError();}
function object(input:unknown,keys:readonly string[]){
 require(input!==null&&typeof input==='object'&&!Array.isArray(input)&&(Object.getPrototypeOf(input)===Object.prototype||Object.getPrototypeOf(input)===null));const d=Object.getOwnPropertyDescriptors(input);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function stamp(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)&&instant(v);}
export function parseSourceExportCursor(input:unknown):SourceExportCursor|null{
 if(input===null)return null;const v=object(input,['createdAt','id']);require(stamp(v.createdAt)&&uuid(v.id));return Object.freeze({createdAt:v.createdAt,id:v.id as string});
}
function older(a:SourceExportCursor,b:SourceExportCursor){return a.createdAt<b.createdAt||a.createdAt===b.createdAt&&a.id<b.id;}
export function parseSourceExportList(input:unknown,businessId:string,before:unknown=null){
 try{
  const cursor=parseSourceExportCursor(before),v=object(input,['schemaVersion','jobs','next']);require(uuid(businessId)&&v.schemaVersion===1&&Array.isArray(v.jobs)&&v.jobs.length<=5);
  const count=v.jobs.length,d=Object.getOwnPropertyDescriptors(v.jobs);require(Reflect.ownKeys(d).length===count+1);
  const jobs=Array.from({length:count},(_,i)=>{const field=d[String(i)];require(field?.enumerable&&Object.hasOwn(field,'value'));return parseSourceExportJob(field.value,businessId);}),ids=new Set<string>();let previous=cursor;
  for(const job of jobs){require(stamp(job.created_at)&&!ids.has(job.id));ids.add(job.id);const current={createdAt:job.created_at,id:job.id};require(!previous||older(current,previous));previous=current;}
  const next=parseSourceExportCursor(v.next);if(next){require(jobs.length===5&&previous&&next.createdAt===previous.createdAt&&next.id===previous.id);}
  return Object.freeze({schemaVersion:1 as const,jobs:Object.freeze(jobs),next});
 }catch{throw new SourceExportListError();}
}
export const sourceExportListWireKeys=Object.freeze(['beforeCreatedAt','beforeId'] as const);
export function parseSourceExportListWire(input:unknown){const v=object(input,sourceExportListWireKeys);require((v.beforeCreatedAt===null)===(v.beforeId===null));return parseSourceExportCursor(v.beforeId===null?null:{createdAt:v.beforeCreatedAt,id:v.beforeId});}
export function sourceExportListToWire(input:unknown){const cursor=parseSourceExportCursor(input);return Object.freeze({beforeCreatedAt:cursor?.createdAt??null,beforeId:cursor?.id??null});}
