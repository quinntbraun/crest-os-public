import {randomUUID} from 'node:crypto';
import {confirmedJobRecords} from './confirmed-job-records';
import {bookingContextFixture} from './booking-context';
import {customerFixture} from '../support/customer-fixture';
import {vehicleFixture} from '../support/vehicle-fixture';
import {parseJobResources} from '../../src/operations/booking-context-contract';
import type {CancelScheduledJobSave} from '../../src/operations/confirmed-booking-contract';
import type {CancelJobCommand} from '../../src/operations/amended-booking-contract';
import type {ChangeJobScheduleSave,ScheduleChangePayload} from '../../src/operations/confirmed-reschedule-contract';
export function jobChangeFixture(proposed=false){
 const f=proposed?bookingContextFixture():confirmedJobRecords(),{q,head}=f,business=q.businessId,actor=q.payload.operatorId,stamp=head.job.created_at,agreement=randomUUID(),family=randomUUID(),shared={business_id:business,created_at:stamp,created_by:actor,operation_id:q.operationId,origin:'manual'},part=q.payload.allocationPlans[0]!.parts[0]!;
 const resources=parseJobResources({schemaVersion:1,businessId:business,jobId:q.jobId,head,vehicles:[{...shared,id:randomUUID(),job_id:q.jobId,vehicle_id:q.payload.vehicles[0]!.vehicleId,customer_vehicle_id:null,vehicle_snapshot:vehicleFixture({id:q.payload.vehicles[0]!.vehicleId,business_id:business}),customer_snapshot:customerFixture({id:q.payload.customerId,business_id:business}),pickup_address_id:null,return_address_id:null,pickup_location_snapshot:null,return_location_snapshot:null}],encounters:[{...shared,id:randomUUID(),job_id:q.jobId,customer_id:q.payload.customerId,family_id:family,agreement_id:agreement,encounter_id:family}],scopeParts:[{...part,sourceAllocationId:q.payload.allocationPlans[0]!.sourceAllocationId,entitlementId:randomUUID(),entitlementVersionId:randomUUID(),agreementId:agreement,planId:randomUUID(),planSequence:'1'}]},business,q.jobId);if('state'in resources)throw Error();
 const mode={id:head.job.mode_version_id,business_id:business,sequence:'1',replaces_sequence:null,mobile_enabled:true,dropoff_enabled:true,pickup_return_enabled:false,reason:null,created_at:stamp,created_by:actor,operation_id:randomUUID(),origin:'manual' as const};
 const cancel:CancelScheduledJobSave['payload']={reason:'Synthetic customer cancelled this visit.',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}};
 const appointment=head.latestAppointment,proposal:ScheduleChangePayload={action:'propose',reason:'Synthetic customer requested a later visit.',latestAppointmentId:appointment.id,expectedModeSequence:'1',appointment:{start_at:appointment.start_at,end_at:appointment.end_at,timezone:appointment.timezone,local_start:appointment.local_start,local_end:appointment.local_end,start_offset_minutes:appointment.start_offset_minutes,end_offset_minutes:appointment.end_offset_minutes,travel_before_seconds:appointment.travel_before_seconds,travel_after_seconds:appointment.travel_after_seconds,contact_snapshot:q.payload.appointment.contact_snapshot},customerConfirmation:null,conflictReview:null};
 return {q,resources,mode,cancel,proposal};
}
export function jobChangeCommitted(request:CancelJobCommand|ChangeJobScheduleSave){
 const audit=randomUUID(),latest=randomUUID(),version=(BigInt(request.expectedJobVersion)+1n).toString(),base={state:'committed' as const,operationId:request.operationId,recoveryEpoch:request.recoveryEpoch},common={schemaVersion:1 as const,businessId:request.businessId,jobId:request.jobId,version,appointmentSequence:version,jobAuditEventId:audit,sourceAuditIds:[audit]};
 if('action'in request.payload){const action=request.payload.action;return {...base,receipt:{...common,action,latestAppointmentId:latest,currentAppointmentId:action==='confirm'?latest:randomUUID(),confirmationState:({propose:'proposed',confirm:'confirmed',withdraw:'withdrawn'} as const)[action]}};}
 if(request.schemaVersion===2)return {...base,receipt:{...common,schemaVersion:2 as const,appointmentId:latest}};
 return {...base,receipt:{...common,appointmentId:latest}};
}
