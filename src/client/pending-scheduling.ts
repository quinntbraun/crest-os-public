import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseSchedulingOriginal} from '../operations/scheduling-original-contract.ts';
import type {SchedulingOriginalKind,SchedulingOriginal} from '../operations/scheduling-original-contract.ts';
export const pendingSchedulingKeys=Object.freeze({
 'operations.job.field':'crest.field-session.pending-reference.v1',
 'operations.job.complete':'crest.field-completion.pending-reference.v1',
 'operations.job.interrupt':'crest.trip-interruption.pending-reference.v1',
 'operations.job.cancel_unfulfilled':'crest.unfulfilled-cancellation.pending-reference.v1',
 'operations.job.work_boundary.correct':'crest.work-boundary.pending-reference.v1',
 'operations.job.work_start.correct':'crest.work-start.pending-reference.v1',
 'operations.job.work_end.correct':'crest.work-end.pending-reference.v1',
 'operations.mobile_departure.correct':'crest.mobile-departure.pending-reference.v1',
 'operations.message.record_outcome':'crest.review-message-outcome.pending-reference.v1',
 'operations.mileage.record':'crest.mileage.pending-reference.v1',
 'operations.support_trip.record':'crest.support-trip.pending-reference.v1',
 'operations.support_trip.correct':'crest.support-trip-correction.pending-reference.v1',
 'operations.fulfillment_modes.initialize':'crest.fulfillment-mode-initialize.pending-reference.v1',
 'operations.fulfillment_modes.save':'crest.fulfillment-mode.pending-reference.v1',
 'operations.job.book':'crest.book-job.pending-reference.v1',
 'operations.job.cancel':'crest.cancel-job.pending-reference.v1',
 'operations.job.reschedule':'crest.reschedule-job.pending-reference.v1'
} satisfies Record<SchedulingOriginalKind,string>);
export type PendingScheduling=Readonly<{schemaVersion:1;businessId:string;binding:string;reference:SchedulingOriginal['reference']}>;
export class PendingSchedulingError extends Error{constructor(){super('SCHEDULING_REFERENCE_STORAGE_FAILED');this.name='PendingSchedulingError';}}
function parse(kind:SchedulingOriginalKind,v:unknown):PendingScheduling{
 try{
  if(!exact(v,['schemaVersion','businessId','binding','reference'])||valueDescriptorsInvalid(v)||v.schemaVersion!==1||typeof v.binding!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(v.binding))throw Error();
  const original=parseSchedulingOriginal({schemaVersion:1,businessId:v.businessId,commandType:kind,reference:v.reference});
  return Object.freeze({schemaVersion:1,businessId:original.businessId,binding:v.binding,reference:original.reference});
 }catch{throw new PendingSchedulingError();}
}
function valueDescriptorsInvalid(v:object){return Reflect.ownKeys(v).length!==4||!Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>d.enumerable&&Object.hasOwn(d,'value'));}
// Only opaque original identity, per-tab binding and versions. Never drafts,
// worksite/contact/financial values, credentials, automatic replay or expiry.
export function createPendingSchedulingStore(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>,kind:SchedulingOriginalKind){
 if(!Object.hasOwn(pendingSchedulingKeys,kind))throw new PendingSchedulingError();const key=pendingSchedulingKeys[kind];
 function read():PendingScheduling|null{
  try{const raw=storage.getItem(key);if(raw===null)return null;if(raw.length>2048)throw Error();const value=parse(kind,JSON.parse(raw));if((raw.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length!==4+Object.keys(value.reference).length)throw Error();return value;}catch{throw new PendingSchedulingError();}
 }
 function require(value:PendingScheduling){try{const pinned=parse(kind,value),current=read();if(current===null||JSON.stringify(current)!==JSON.stringify(pinned))throw Error();}catch{throw new PendingSchedulingError();}}
 return Object.freeze({read,require,
  write(value:PendingScheduling){try{const pinned=parse(kind,value);if(read()!==null)throw Error();storage.setItem(key,JSON.stringify(pinned));require(pinned);}catch{throw new PendingSchedulingError();}},
  clear(value:PendingScheduling){try{require(value);storage.removeItem(key);if(read()!==null)throw Error();}catch{throw new PendingSchedulingError();}}
 });
}
