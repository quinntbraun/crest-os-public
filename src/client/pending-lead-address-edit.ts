import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract';
import type {LeadAddressReference} from './lead-addresses';
export const pendingLeadAddressKey='crest.lead-address.pending-reference.v1';
export type PendingLeadAddress=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:LeadAddressReference}>;
export class PendingLeadAddressError extends Error{constructor(){super('LEAD_ADDRESS_REFERENCE_STORAGE_FAILED');this.name='PendingLeadAddressError';}}
export function pendingLeadAddress(value:unknown):PendingLeadAddress{
 if(!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!uuid(value.businessId)||typeof value.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value.binding)||!exact(value.reference,['operationId','leadId','leadAddressId','expectedVersion','recoveryEpoch'])||!uuid(value.reference.operationId)||!uuid(value.reference.leadId)||!uuid(value.reference.leadAddressId)||!version(value.reference.expectedVersion,true)||!uuid(value.reference.recoveryEpoch))throw new PendingLeadAddressError();
 return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as LeadAddressReference});
}
// Per-tab opaque original lookup metadata only; reports and credentials never
// enter persistence. Failed reads/removal block replacement writes.
export function createPendingLeadAddressStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingLeadAddress|null{try{const raw=storage.getItem(pendingLeadAddressKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingLeadAddress(JSON.parse(raw));}catch{throw new PendingLeadAddressError();}}
 function require(value:PendingLeadAddress){const current=read(),pinned=pendingLeadAddress(value);if(current===null||JSON.stringify(current)!==JSON.stringify(pinned))throw new PendingLeadAddressError();}
 return Object.freeze({read,require,
  write(value:PendingLeadAddress){try{const pinned=pendingLeadAddress(value);if(read()!==null)throw new Error();storage.setItem(pendingLeadAddressKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingLeadAddressError();}},
  clear(value:PendingLeadAddress){try{require(value);storage.removeItem(pendingLeadAddressKey);if(read()!==null)throw new Error();}catch{throw new PendingLeadAddressError();}}
 });
}
