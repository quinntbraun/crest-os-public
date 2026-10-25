import {customerUuid,customerVersion,exactCustomerObject} from '../customer/customer-contract';
import type {CustomerReference} from './customers';

export const pendingCustomerKey='crest.customer.pending-reference.v1';
export type PendingCustomer=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:CustomerReference}>;
export class PendingCustomerError extends Error{constructor(){super('CUSTOMER_REFERENCE_STORAGE_FAILED');this.name='PendingCustomerError';}}

export function pendingCustomer(value:unknown):PendingCustomer{
  if(!exactCustomerObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!customerUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactCustomerObject(value.reference,['operationId','customerId','expectedVersion','recoveryEpoch'])
    ||!customerUuid(value.reference.operationId)||!customerUuid(value.reference.customerId)||!customerVersion(value.reference.expectedVersion,true)||!customerUuid(value.reference.recoveryEpoch))throw new PendingCustomerError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as CustomerReference});
}

// Opaque lookup metadata only. No draft, contact values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingCustomerStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingCustomer|null{
    try{const raw=storage.getItem(pendingCustomerKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingCustomer(JSON.parse(raw));}catch{throw new PendingCustomerError();}
  }
  const same=(a:PendingCustomer|null,b:PendingCustomer)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingCustomer){if(!same(read(),pendingCustomer(value)))throw new PendingCustomerError();}
  return Object.freeze({read,require,
    write(value:PendingCustomer){try{const pinned=pendingCustomer(value);if(read()!==null)throw new Error();storage.setItem(pendingCustomerKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingCustomerError();}},
    clear(value:PendingCustomer){try{require(value);storage.removeItem(pendingCustomerKey);if(read()!==null)throw new Error();}catch{throw new PendingCustomerError();}}
  });
}
