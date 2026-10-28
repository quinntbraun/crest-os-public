import {customerUuid,customerVersion,exactCustomerObject as exactHoldObject} from '../customer/customer-contract';
import type {HoldReference} from './appointment-holds';

export const pendingHoldKey='crest.appointment-hold.pending-reference.v1';
export type PendingHold=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:HoldReference}>;
export class PendingHoldError extends Error{constructor(){super('HOLD_REFERENCE_STORAGE_FAILED');this.name='PendingHoldError';}}

export function pendingHold(value:unknown):PendingHold{
  if(!exactHoldObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!customerUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactHoldObject(value.reference,['operationId','holdId','expectedSequence','recoveryEpoch'])
    ||!customerUuid(value.reference.operationId)||!customerUuid(value.reference.holdId)||!customerVersion(value.reference.expectedSequence,true)||!customerUuid(value.reference.recoveryEpoch))throw new PendingHoldError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as HoldReference});
}

// Opaque lookup metadata only. No draft, contact values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingHoldStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingHold|null{
    try{const raw=storage.getItem(pendingHoldKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingHold(JSON.parse(raw));}catch{throw new PendingHoldError();}
  }
  const same=(a:PendingHold|null,b:PendingHold)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingHold){if(!same(read(),pendingHold(value)))throw new PendingHoldError();}
  return Object.freeze({read,require,
    write(value:PendingHold){try{const pinned=pendingHold(value);if(read()!==null)throw new Error();storage.setItem(pendingHoldKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingHoldError();}},
    clear(value:PendingHold){try{require(value);storage.removeItem(pendingHoldKey);if(read()!==null)throw new Error();}catch{throw new PendingHoldError();}}
  });
}
