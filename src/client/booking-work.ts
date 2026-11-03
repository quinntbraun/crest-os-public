import type {scheduling} from './scheduling';
import type {BookingPayload} from '../operations/confirmed-booking-contract';
type Agreement=Exclude<Awaited<ReturnType<typeof scheduling.agreement>>,{state:'absent'}>;
export type BookingVehicleChoice=Agreement['vehicles'][number];
export type BookingWork=Readonly<{businessId:string;customer:Agreement['customer'];agreements:readonly Agreement[];vehicles:readonly BookingVehicleChoice[];sources:Agreement['sources']}>;
export function combineBookingWork(agreements:readonly Agreement[],extraVehicles:readonly BookingVehicleChoice[]=[]):BookingWork{
 const first=agreements[0];if(!first||first.customer.archived_at!==null)throw Error('BOOKING_WORK_REVIEW_REQUIRED');const families=new Set<string>(),sources=new Set<string>(),entitlements=new Set<string>(),partitions=new Set<string>(),vehicles=new Map<string,BookingVehicleChoice>();
 function vehicle(row:BookingVehicleChoice){const previous=vehicles.get(row.id);if(previous&&(previous.version!==row.version||previous.label!==row.label||previous.archivedAt!==row.archivedAt))throw Error('BOOKING_VEHICLE_CHANGED');vehicles.set(row.id,row);}
 for(const agreement of agreements){if(agreement.businessId!==first.businessId||agreement.customer.id!==first.customer.id||agreement.customer.version!==first.customer.version||agreement.customer.archived_at!==null||families.has(agreement.familyId))throw Error('BOOKING_WORK_REVIEW_REQUIRED');families.add(agreement.familyId);
  for(const source of agreement.sources){if(source.agreementId!==agreement.agreementId||sources.has(source.sourceAllocationId)||entitlements.has(source.entitlementId))throw Error('BOOKING_WORK_REVIEW_REQUIRED');sources.add(source.sourceAllocationId);entitlements.add(source.entitlementId);for(const part of source.parts){const key=source.sourceAllocationId+'/'+part.partitionId;if(partitions.has(key))throw Error('BOOKING_WORK_REVIEW_REQUIRED');partitions.add(key);}}
  agreement.vehicles.forEach(vehicle);
 }
 for(const row of extraVehicles){if(row.archivedAt!==null)throw Error('BOOKING_VEHICLE_CHANGED');vehicle(row);}
 return Object.freeze({businessId:first.businessId,customer:first.customer,agreements:Object.freeze([...agreements]),vehicles:Object.freeze([...vehicles.values()]),sources:Object.freeze(agreements.flatMap(a=>a.sources))});
}
// Only newly added work/vehicles receive defaults. Existing exclusions, split
// identities, amounts, contact, time and location remain the owner's draft.
export function mergeBookingWorkDraft(payload:BookingPayload,previous:BookingWork,next:BookingWork,jobId:string):BookingPayload{
 if(previous.businessId!==next.businessId||previous.customer.id!==next.customer.id||previous.customer.version!==next.customer.version||payload.customerId!==next.customer.id||payload.expectedCustomerVersion!==next.customer.version)throw Error('BOOKING_WORK_REVIEW_REQUIRED');
 const previousSources=new Set(previous.sources.map(s=>s.sourceAllocationId)),nextSources=new Set(next.sources.map(s=>s.sourceAllocationId)),previousVehicles=new Set(previous.vehicles.map(v=>v.id)),nextVehicles=new Set(next.vehicles.map(v=>v.id));
 const allocationPlans=[...payload.allocationPlans.filter(plan=>nextSources.has(plan.sourceAllocationId)),...next.sources.filter(source=>!previousSources.has(source.sourceAllocationId)&&source.parts.some(part=>part.state==='unassigned')).map(source=>({sourceAllocationId:source.sourceAllocationId,expectedSequence:source.planSequence,reason:null,parts:source.parts.map(part=>part.state==='unassigned'?{...part,jobId,state:'assigned' as const}:part)}))];
 const location=()=>payload.fulfillmentMode==='pickup_return'?{schemaVersion:1 as const,kind:'manual' as const,locationText:'',instructions:null}:null;
 const vehicles=[...payload.vehicles.filter(vehicle=>nextVehicles.has(vehicle.vehicleId)),...next.vehicles.filter(vehicle=>!previousVehicles.has(vehicle.id)&&vehicle.archivedAt===null).map(vehicle=>({vehicleId:vehicle.id,expectedVersion:vehicle.version,customerVehicleId:null,pickupLocation:location(),returnLocation:location()}))];
 return {...payload,allocationPlans,vehicles};
}
