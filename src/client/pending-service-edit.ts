import {parseServiceOriginalOperation} from '../commercial/service-original-operation';
import type {ServiceOriginalOperation} from '../commercial/service-original-operation';
export const pendingServiceKey='crest.service.pending-reference.v1';
export type PendingService=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:ServiceOriginalOperation['reference']}>;
export class PendingServiceError extends Error{constructor(){super('SERVICE_REFERENCE_STORAGE_FAILED');this.name='PendingServiceError';}}
export function pendingService(value:unknown):PendingService{
 try{
  // Use the same exact, data-only reference contract as server resolution.
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
  const keys=Reflect.ownKeys(value);if(keys.length!==4||!['schemaVersion','businessId','binding','reference'].every(k=>keys.includes(k)))throw new Error();
  const descriptors=Object.getOwnPropertyDescriptors(value);if(Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')||!d.enumerable))throw new Error();
  const v=value as Record<string,unknown>;
  if(v.schemaVersion!==1||typeof v.binding!=='string'||!(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).test(v.binding))throw new Error();
  const original=parseServiceOriginalOperation({schemaVersion:1,businessId:v.businessId,commandType:'catalog.service.save',reference:v.reference});
  return Object.freeze({schemaVersion:1,businessId:original.businessId,binding:v.binding,reference:original.reference});
 }catch{throw new PendingServiceError();}
}
// Per-tab opaque original metadata only; no definition, price, credential,
// expiry purge, replacement identity, background retry or offline draft.
export function createPendingServiceStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 function read():PendingService|null{try{const raw=storage.getItem(pendingServiceKey);if(raw===null)return null;if(raw.length>1024)throw new Error();return pendingService(JSON.parse(raw));}catch{throw new PendingServiceError();}}
 const same=(a:PendingService|null,b:PendingService)=>a!==null&&JSON.stringify(a)===JSON.stringify(b);
 function require(value:PendingService){try{if(!same(read(),pendingService(value)))throw new Error();}catch{throw new PendingServiceError();}}
 return Object.freeze({read,require,
  write(value:PendingService){try{const pinned=pendingService(value);if(read()!==null)throw new Error();storage.setItem(pendingServiceKey,JSON.stringify(pinned));require(pinned);}catch{throw new PendingServiceError();}},
  clear(value:PendingService){try{require(value);storage.removeItem(pendingServiceKey);if(read()!==null)throw new Error();}catch{throw new PendingServiceError();}}
 });
}
