import {customerUuid as uuid,customerInstant as instant} from '../customer/customer-contract.ts';
import {parseSourceExportCommand} from './source-export-job-contract.ts';
import type {SourceExportCommand} from './source-export-job-contract.ts';

export type ExportRequestReference=Extract<SourceExportCommand,{commandType:'export.request'}>;
export class ExportRequestResolutionError extends Error{constructor(){super('EXPORT_REQUEST_RESOLUTION_REVIEW_REQUIRED');this.name='ExportRequestResolutionError';}}
function require(v:unknown):asserts v{if(!v)throw new ExportRequestResolutionError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function reason(v:unknown):v is string{return typeof v==='string'&&v.length<=4000&&[...v].length<=2000&&v.trim().length>0&&[...v].every(c=>{const n=c.codePointAt(0)!;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);});}
export function parseExportRequestReference(input:unknown):ExportRequestReference{try{const c=parseSourceExportCommand(input);require(c.commandType==='export.request');return c;}catch{throw new ExportRequestResolutionError();}}
export function parseExportRequestRetirement(input:unknown){
 try{const r=object(input,['schemaVersion','recoveryEpoch','original','reason']);require(r.schemaVersion===1&&uuid(r.recoveryEpoch)&&reason(r.reason));return Object.freeze({schemaVersion:1 as const,recoveryEpoch:r.recoveryEpoch,original:parseExportRequestReference(r.original),reason:r.reason});}catch{throw new ExportRequestResolutionError();}
}
// Historical evidence only. Absent/conflict/original-recorded never permits
// clearing pending. Typed original receipt lookup remains a separate operation.
export function parseExportRequestResolution(input:unknown,expected:unknown){
 try{
  const original=parseExportRequestReference(expected);require(input!==null&&typeof input==='object'&&!Array.isArray(input));const tag=Object.getOwnPropertyDescriptor(input,'state');require(tag&&Object.hasOwn(tag,'value'));
  if(tag.value==='absent'){object(input,['state']);return Object.freeze({state:'absent' as const});}
  if(tag.value==='conflict'){const r=object(input,['state','reason']);require(r.reason==='operation');return Object.freeze({state:'conflict' as const,reason:'operation' as const});}
  require(tag.value==='retired'||tag.value==='original_recorded');const r=object(input,tag.value==='retired'?['schemaVersion','state','original','retirement']:['schemaVersion','state','original']);require(r.schemaVersion===1&&JSON.stringify(parseExportRequestReference(r.original))===JSON.stringify(original));
  if(tag.value==='original_recorded')return Object.freeze({schemaVersion:1 as const,state:'original_recorded' as const,original});
  const d=object(r.retirement,['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']);require(uuid(d.operationRowId)&&uuid(d.auditEventId)&&uuid(d.recoveryEpoch)&&reason(d.reason)&&instant(d.recordedAt));
  return Object.freeze({schemaVersion:1 as const,state:'retired' as const,original,retirement:Object.freeze({operationRowId:d.operationRowId as string,auditEventId:d.auditEventId as string,recoveryEpoch:d.recoveryEpoch as string,reason:d.reason,recordedAt:d.recordedAt as string})});
 }catch{throw new ExportRequestResolutionError();}
}
