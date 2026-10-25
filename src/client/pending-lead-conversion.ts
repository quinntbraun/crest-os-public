import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {parseLeadConversionReference} from '../customer/lead-conversion-command-contract';
import type {LeadConversionReference} from '../customer/lead-conversion-command-contract';
export const pendingLeadConversionKey='crest.lead-conversion.pending-reference.v1';
export type PendingLeadConversion=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:LeadConversionReference}>;
export class PendingLeadConversionError extends Error{constructor(){super('LEAD_CONVERSION_REFERENCE_STORAGE_FAILED');this.name='PendingLeadConversionError';}}
export function pendingLeadConversion(value:unknown):PendingLeadConversion{
 try{
  if(!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!uuid(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding))throw new Error();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:parseLeadConversionReference(value.reference)});
 }catch{throw new PendingLeadConversionError();}
}
// Per-tab original identifiers only. No drafts, names, coordinates, credentials,
// selections, or replacement key can enter this reference.
export function createPendingLeadConversionStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingLeadConversion|null{try{const raw=storage.getItem(pendingLeadConversionKey);if(raw===null)return null;if(raw.length>1024||(raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length!==10)throw new Error();return pendingLeadConversion(JSON.parse(raw));}catch{throw new PendingLeadConversionError();}}
 function require(value:PendingLeadConversion){const current=read(),pinned=pendingLeadConversion(value);if(current===null||JSON.stringify(current)!==JSON.stringify(pinned))throw new PendingLeadConversionError();}
 return Object.freeze({read,require,
  write(value:PendingLeadConversion){try{const pinned=pendingLeadConversion(value);if(read()!==null)throw new Error();storage.setItem(pendingLeadConversionKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingLeadConversionError();}},
  clear(value:PendingLeadConversion){try{require(value);storage.removeItem(pendingLeadConversionKey);if(read()!==null)throw new Error();}catch{throw new PendingLeadConversionError();}}
 });
}
