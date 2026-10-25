import {customerUuid,customerVersion,customerInstant,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {parseLeadVehicleDraft} from './lead-resource-contract.ts';
import type {LeadVehicleDraft,ReportedLeadVehicle,LeadRequestedServices} from './lead-resource-contract.ts';

export const leadVehicleColumns=['id','business_id','lead_id','vehicle_id','reported_vehicle','requested_services','condition_notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type LeadVehicle=Readonly<{
 id:string;business_id:string;lead_id:string;vehicle_id:string|null;
 reported_vehicle:ReportedLeadVehicle;requested_services:LeadRequestedServices;
 condition_notes:string|null;archived_at:string|null;archived_reason:string|null;
 version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;
 origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null;
}>;
export function draftFromLeadVehicle(row:LeadVehicle):LeadVehicleDraft{
 return parseLeadVehicleDraft({vehicleId:row.vehicle_id,reportedVehicle:row.reported_vehicle,requestedServices:row.requested_services,conditionNotes:row.condition_notes,archived:row.archived_at!==null,archiveReason:row.archived_reason});
}
export function parseLeadVehicle(value:unknown,businessId:string,leadId?:string):LeadVehicle{
 requireCustomer(exactCustomerObject(value,leadVehicleColumns)&&customerUuid(businessId)&&value.business_id===businessId&&customerUuid(value.id)&&customerUuid(value.lead_id)&&(leadId===undefined||customerUuid(leadId)&&value.lead_id===leadId)
  &&customerVersion(value.version)&&customerUuid(value.created_by)&&customerUuid(value.updated_by)&&customerUuid(value.operation_id)&&(value.import_row_id===null||customerUuid(value.import_row_id))&&['manual','import','system'].includes(value.origin as string));
 const row=value as LeadVehicle,draft=draftFromLeadVehicle(row);
 requireCustomer(customerInstant(row.created_at)&&customerInstant(row.updated_at)&&row.updated_at>=row.created_at
  &&(row.archived_at===null||customerInstant(row.archived_at)&&row.archived_at>=row.created_at&&row.archived_at<=row.updated_at));
 return Object.freeze({...row,reported_vehicle:draft.reportedVehicle,requested_services:draft.requestedServices});
}
