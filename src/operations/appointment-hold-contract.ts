// Prospective notes only. No accepted scope, contracted job or confirmation.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
export const holdPayloadKeys=['customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason'] as const;
export const holdColumns=['id','business_id','hold_id','sequence','replaces_sequence',...holdPayloadKeys,'created_at','created_by','operation_id','origin'] as const;
export type HoldPayload=Readonly<{customer_id:string|null;lead_id:string|null;label:string;state:'proposed'|'withdrawn';start_at:string;end_at:string;timezone:string;local_start:string;local_end:string;start_offset_minutes:number;end_offset_minutes:number;notes:string|null;reason:string|null}>;
export type StoredHold=HoldPayload&Readonly<{id:string;business_id:string;hold_id:string;sequence:string;replaces_sequence:string|null;created_at:string;created_by:string;operation_id:string;origin:'manual'}>;
export type HoldSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;holdId:string;expectedSequence:string;payload:HoldPayload}>;
export function requireHold(v:unknown):asserts v{if(!v)throw Error('APPOINTMENT_HOLD_DATA_INVALID');}
function text(v:unknown,max:number,empty=false,multiline=false):v is string{return typeof v==='string'&&[...v].length<=max&&(empty||v.trim()!=='')&&[...v].every(c=>{const n=c.codePointAt(0)!;return n>=32&&n!==127&&(n<0xd800||n>0xdfff)||multiline&&[9,10,13].includes(n);});}
function endpoint(instant:unknown,local:unknown,offset:unknown,formatter:Intl.DateTimeFormat){
 requireHold(customerInstant(instant)&&typeof local==='string'&&customerInstant(local+'Z')&&Number.isInteger(offset)&&Math.abs(Number(offset))<=840);
 const parts=formatter.formatToParts(new Date(instant)),get=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 const wall=get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute')+':'+get('second');
 requireHold(wall===local.slice(0,19)&&instant.slice(20,26)===local.slice(20,26)&&Date.parse(local+'Z')-Date.parse(instant)===Number(offset)*60000);
}
export function parseHoldPayload(v:unknown):HoldPayload{
 requireHold(exact(v,holdPayloadKeys)&&(v.customer_id===null||customerUuid(v.customer_id))&&(v.lead_id===null||customerUuid(v.lead_id))&&(v.customer_id===null)!==(v.lead_id===null));
 requireHold(text(v.label,200)&&['proposed','withdrawn'].includes(v.state as string)&&(v.notes===null||text(v.notes,2000,true,true))&&(v.reason===null||text(v.reason,1000,false,true))&&typeof v.timezone==='string'&&v.timezone.length<=100&&/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(v.timezone));
 const formatter=new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:v.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 endpoint(v.start_at,v.local_start,v.start_offset_minutes,formatter);endpoint(v.end_at,v.local_end,v.end_offset_minutes,formatter);requireHold((v.end_at as string)>(v.start_at as string)&&(v.state!=='withdrawn'||v.reason!==null));
 return Object.freeze({...v}) as HoldPayload;
}
export function holdPayload(row:StoredHold):HoldPayload{return parseHoldPayload(Object.fromEntries(holdPayloadKeys.map(k=>[k,row[k]])));}
export function parseHoldSave(v:unknown):HoldSave{
 requireHold(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','holdId','expectedSequence','payload'])&&v.schemaVersion===1&&[v.businessId,v.operationId,v.recoveryEpoch,v.holdId].every(customerUuid)&&customerVersion(v.expectedSequence,true)&&BigInt(v.expectedSequence)<9223372036854775807n);
 const payload=parseHoldPayload(v.payload);requireHold(v.expectedSequence==='0'?payload.state==='proposed':payload.reason!==null);
 return Object.freeze({...v,payload}) as HoldSave;
}
export function parseStoredHold(v:unknown,businessId:string):StoredHold{
 requireHold(exact(v,holdColumns)&&customerUuid(businessId)&&v.business_id===businessId&&[v.id,v.hold_id,v.created_by,v.operation_id].every(customerUuid)&&customerVersion(v.sequence)&&customerInstant(v.created_at)&&v.origin==='manual');
 const payload=parseHoldPayload(Object.fromEntries(holdPayloadKeys.map(k=>[k,v[k]])));
 requireHold(v.sequence==='1'?v.replaces_sequence===null&&payload.state==='proposed':customerVersion(v.replaces_sequence)&&BigInt(v.replaces_sequence)+1n===BigInt(v.sequence as string)&&payload.reason!==null);
 return Object.freeze({...v,...payload}) as StoredHold;
}
export function parseHoldCommitted(v:unknown,businessId:string,operationId:string){
 requireHold(exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operationId&&customerUuid(v.recoveryEpoch)&&exact(v.receipt,['schemaVersion','businessId','holdId','sequence','versionId','auditEventId']));
 const r=v.receipt;requireHold(r.schemaVersion===1&&r.businessId===businessId&&customerUuid(r.holdId)&&customerVersion(r.sequence)&&customerUuid(r.versionId)&&customerUuid(r.auditEventId));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r}) as Readonly<{schemaVersion:1;businessId:string;holdId:string;sequence:string;versionId:string;auditEventId:string}>});
}
