import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {associationReference} from './associations';
import type {AssociationReference} from './associations';

export const pendingAssociationKey='crest.vehicle-association.pending-reference.v1';
export type PendingAssociation=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:AssociationReference}>;
export class PendingAssociationError extends Error{constructor(){super('ASSOCIATION_REFERENCE_STORAGE_FAILED');this.name='PendingAssociationError';}}

export function pendingAssociation(value:unknown):PendingAssociation{
  if(!exact(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!uuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding))throw new PendingAssociationError();
  try{return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:associationReference(value.reference)});}catch{throw new PendingAssociationError();}
}

// Opaque lookup metadata only. No draft, customer/link values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingAssociationStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingAssociation|null{
    try{const raw=storage.getItem(pendingAssociationKey);if(raw===null)return null;if(raw.length>1536)throw new Error();return pendingAssociation(JSON.parse(raw));}catch{throw new PendingAssociationError();}
  }
  const same=(a:PendingAssociation|null,b:PendingAssociation)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingAssociation){if(!same(read(),pendingAssociation(value)))throw new PendingAssociationError();}
  return Object.freeze({read,require,
    write(value:PendingAssociation){try{const pinned=pendingAssociation(value);if(read()!==null)throw new Error();storage.setItem(pendingAssociationKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingAssociationError();}},
    clear(value:PendingAssociation){try{require(value);storage.removeItem(pendingAssociationKey);if(read()!==null)throw new Error();}catch{throw new PendingAssociationError();}}
  });
}
