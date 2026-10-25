import {customerUuid as leadUuid,customerVersion as leadVersion,exactCustomerObject as exactLeadObject} from '../customer/customer-contract';
import type {LeadReference} from './leads';

export const pendingLeadKey='crest.lead.pending-reference.v1';
export type PendingLead=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:LeadReference}>;
export class PendingLeadError extends Error{constructor(){super('LEAD_REFERENCE_STORAGE_FAILED');this.name='PendingLeadError';}}

export function pendingLead(value:unknown):PendingLead{
  if(!exactLeadObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!leadUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactLeadObject(value.reference,['operationId','leadId','expectedVersion','recoveryEpoch'])
    ||!leadUuid(value.reference.operationId)||!leadUuid(value.reference.leadId)||!leadVersion(value.reference.expectedVersion,true)||!leadUuid(value.reference.recoveryEpoch))throw new PendingLeadError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as LeadReference});
}

// Opaque lookup metadata only. No draft, lead values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingLeadStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingLead|null{
    try{const raw=storage.getItem(pendingLeadKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingLead(JSON.parse(raw));}catch{throw new PendingLeadError();}
  }
  const same=(a:PendingLead|null,b:PendingLead)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingLead){if(!same(read(),pendingLead(value)))throw new PendingLeadError();}
  return Object.freeze({read,require,
    write(value:PendingLead){try{const pinned=pendingLead(value);if(read()!==null)throw new Error();storage.setItem(pendingLeadKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingLeadError();}},
    clear(value:PendingLead){try{require(value);storage.removeItem(pendingLeadKey);if(read()!==null)throw new Error();}catch{throw new PendingLeadError();}}
  });
}
