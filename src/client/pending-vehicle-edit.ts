import {customerUuid as vehicleUuid,customerVersion as vehicleVersion,exactCustomerObject as exactVehicleObject} from '../customer/customer-contract';
import type {VehicleReference} from './vehicles';

export const pendingVehicleKey='crest.vehicle.pending-reference.v1';
export type PendingVehicle=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:VehicleReference}>;
export class PendingVehicleError extends Error{constructor(){super('VEHICLE_REFERENCE_STORAGE_FAILED');this.name='PendingVehicleError';}}

export function pendingVehicle(value:unknown):PendingVehicle{
  if(!exactVehicleObject(value,['schemaVersion','businessId','binding','reference'])||value.schemaVersion!==1||!vehicleUuid(value.businessId)
    ||typeof value.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(value.binding)
    ||!exactVehicleObject(value.reference,['operationId','vehicleId','expectedVersion','recoveryEpoch'])
    ||!vehicleUuid(value.reference.operationId)||!vehicleUuid(value.reference.vehicleId)||!vehicleVersion(value.reference.expectedVersion,true)||!vehicleUuid(value.reference.recoveryEpoch))throw new PendingVehicleError();
  return Object.freeze({schemaVersion:1,businessId:value.businessId,binding:value.binding,reference:Object.freeze({...value.reference}) as VehicleReference});
}

// Opaque lookup metadata only. No draft, vehicle values, credential, proof,
// payload hash, expiry purge, offline cache or background replay.
export function createPendingVehicleStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  function read():PendingVehicle|null{
    try{const raw=storage.getItem(pendingVehicleKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingVehicle(JSON.parse(raw));}catch{throw new PendingVehicleError();}
  }
  const same=(a:PendingVehicle|null,b:PendingVehicle)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
  function require(value:PendingVehicle){if(!same(read(),pendingVehicle(value)))throw new PendingVehicleError();}
  return Object.freeze({read,require,
    write(value:PendingVehicle){try{const pinned=pendingVehicle(value);if(read()!==null)throw new Error();storage.setItem(pendingVehicleKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingVehicleError();}},
    clear(value:PendingVehicle){try{require(value);storage.removeItem(pendingVehicleKey);if(read()!==null)throw new Error();}catch{throw new PendingVehicleError();}}
  });
}
