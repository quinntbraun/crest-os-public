import {customerUuid as leadUuid,customerVersion as leadVersion,exactCustomerObject as exactLeadObject} from '../customer/customer-contract';
import type {LeadStateReference} from './lead-states';

export const pendingLeadStateKey='crest.lead-state.pending-reference.v1';
export type PendingLeadState=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:LeadStateReference}>;
export class PendingLeadStateError extends Error{constructor(){super('LEAD_STATE_REFERENCE_STORAGE_FAILED');this.name='PendingLeadStateError';}}

export function pendingLeadState(value:unknown):PendingLeadState{
  if(!exactLeadObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!leadUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactLeadObject(value.reference,['operationId','leadId','expectedVersion','recoveryEpoch'])
    ||!leadUuid(value.reference.operationId)||!leadUuid(value.reference.leadId)||!leadVersion(value.reference.expectedVersion)||!leadUuid(value.reference.recoveryEpoch))throw new PendingLeadStateError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as LeadStateReference});
}

// Opaque lookup metadata only. No draft, lead values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingLeadStateStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingLeadState|null{
    try{const raw=storage.getItem(pendingLeadStateKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingLeadState(JSON.parse(raw));}catch{throw new PendingLeadStateError();}
  }
  const same=(a:PendingLeadState|null,b:PendingLeadState)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingLeadState){if(!same(read(),pendingLeadState(value)))throw new PendingLeadStateError();}
  return Object.freeze({read,require,
    write(value:PendingLeadState){try{const pinned=pendingLeadState(value);if(read()!==null)throw new Error();storage.setItem(pendingLeadStateKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingLeadStateError();}},
    clear(value:PendingLeadState){try{require(value);storage.removeItem(pendingLeadStateKey);if(read()!==null)throw new Error();}catch{throw new PendingLeadStateError();}}
  });
}
