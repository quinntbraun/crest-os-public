import {exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadVehicleDraft} from './lead-resource-contract.ts';
import type {LeadVehicleDraft} from './lead-resource-contract.ts';

// Keep the existing bounded, duplicate-key-rejecting flat HTTP reader. Nested
// source JSON is constructed from these fixed primitives, never caller keys.
export const leadVehicleWireDraftKeys=['vehicleId','reportedLabel','reportedYear','reportedMake','reportedModel','reportedColor','reportedVin','reportedPlate','reportedNotes','requestedServicesText','conditionNotes','archived','archiveReason'] as const;
export function parseLeadVehicleWireDraft(value:unknown):LeadVehicleDraft{
 check(exact(value,leadVehicleWireDraftKeys));
 return parseLeadVehicleDraft({vehicleId:value.vehicleId,reportedVehicle:{schemaVersion:1,label:value.reportedLabel,year:value.reportedYear,make:value.reportedMake,model:value.reportedModel,color:value.reportedColor,vin:value.reportedVin,plate:value.reportedPlate,notes:value.reportedNotes},requestedServices:{schemaVersion:1,text:value.requestedServicesText},conditionNotes:value.conditionNotes,archived:value.archived,archiveReason:value.archiveReason});
}
export function leadVehicleDraftToWire(value:LeadVehicleDraft){
 const draft=parseLeadVehicleDraft(value),r=draft.reportedVehicle;
 return Object.freeze({vehicleId:draft.vehicleId,reportedLabel:r.label,reportedYear:r.year,reportedMake:r.make,reportedModel:r.model,reportedColor:r.color,reportedVin:r.vin,reportedPlate:r.plate,reportedNotes:r.notes,requestedServicesText:draft.requestedServices.text,conditionNotes:draft.conditionNotes,archived:draft.archived,archiveReason:draft.archiveReason});
}
