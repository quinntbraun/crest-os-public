import {customerUuid,customerVersion,exactCustomerObject} from '../customer/customer-contract';
import type {AddressReference} from './customer-addresses';

export const pendingAddressKey='crest.address.pending-reference.v1';
export type PendingAddress=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:AddressReference}>;
export class PendingAddressError extends Error{constructor(){super('ADDRESS_REFERENCE_STORAGE_FAILED');this.name='PendingAddressError';}}

export function pendingAddress(value:unknown):PendingAddress{
  if(!exactCustomerObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!customerUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactCustomerObject(value.reference,['operationId','customerId','addressId','expectedVersion','recoveryEpoch'])
    ||!customerUuid(value.reference.operationId)||!customerUuid(value.reference.customerId)||!customerUuid(value.reference.addressId)||!customerVersion(value.reference.expectedVersion,true)||!customerUuid(value.reference.recoveryEpoch))throw new PendingAddressError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as AddressReference});
}

// Opaque lookup metadata only. No draft, contact values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingAddressStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingAddress|null{
    try{const raw=storage.getItem(pendingAddressKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingAddress(JSON.parse(raw));}catch{throw new PendingAddressError();}
  }
  const same=(a:PendingAddress|null,b:PendingAddress)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingAddress){if(!same(read(),pendingAddress(value)))throw new PendingAddressError();}
  return Object.freeze({read,require,
    write(value:PendingAddress){try{const pinned=pendingAddress(value);if(read()!==null)throw new Error();storage.setItem(pendingAddressKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingAddressError();}},
    clear(value:PendingAddress){try{require(value);storage.removeItem(pendingAddressKey);if(read()!==null)throw new Error();}catch{throw new PendingAddressError();}}
  });
}
