import {customerUuid as leadSourceUuid,customerVersion as leadSourceVersion,exactCustomerObject as exactLeadSourceObject} from '../customer/customer-contract';
import type {LeadSourceReference} from './lead-sources';

export const pendingLeadSourceKey='crest.lead.source.pending-reference.v1';
export type PendingLeadSource=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:LeadSourceReference}>;
export class PendingLeadSourceError extends Error{constructor(){super('LEAD_SOURCE_REFERENCE_STORAGE_FAILED');this.name='PendingLeadSourceError';}}

export function pendingLeadSource(value:unknown):PendingLeadSource{
  if(!exactLeadSourceObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!leadSourceUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactLeadSourceObject(value.reference,['operationId','leadSourceId','expectedVersion','recoveryEpoch'])
    ||!leadSourceUuid(value.reference.operationId)||!leadSourceUuid(value.reference.leadSourceId)||!leadSourceVersion(value.reference.expectedVersion,true)||!leadSourceUuid(value.reference.recoveryEpoch))throw new PendingLeadSourceError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as LeadSourceReference});
}

// Opaque lookup metadata only. No draft, leadSource values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingLeadSourceStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingLeadSource|null{
    try{const raw=storage.getItem(pendingLeadSourceKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingLeadSource(JSON.parse(raw));}catch{throw new PendingLeadSourceError();}
  }
  const same=(a:PendingLeadSource|null,b:PendingLeadSource)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingLeadSource){if(!same(read(),pendingLeadSource(value)))throw new PendingLeadSourceError();}
  return Object.freeze({read,require,
    write(value:PendingLeadSource){try{const pinned=pendingLeadSource(value);if(read()!==null)throw new Error();storage.setItem(pendingLeadSourceKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingLeadSourceError();}},
    clear(value:PendingLeadSource){try{require(value);storage.removeItem(pendingLeadSourceKey);if(read()!==null)throw new Error();}catch{throw new PendingLeadSourceError();}}
  });
}
