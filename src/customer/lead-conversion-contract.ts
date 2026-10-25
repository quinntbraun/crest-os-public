import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check,parseCustomerDraft} from './customer-contract.ts';
import type {CustomerDraft} from './customer-contract.ts';
import {parseAddressDraft,parseVehicleDraft} from './customer-resource-contract.ts';
import type {AddressDraft,VehicleDraft} from './customer-resource-contract.ts';
import {parseLead} from './lead-contract.ts';
import {parseLeadVehicle} from './lead-vehicle-contract.ts';
import {parseLeadAddress,draftFromLeadAddress} from './lead-address-contract.ts';

// Explicit selections, never existence/authorization claims. The eventual
// transaction must lock/recheck every genuine source and destination itself.
export type ConversionTarget<D>=Readonly<{kind:'existing';id:string;expectedVersion:string}>|Readonly<{kind:'new';id:string;draft:D}>;
export type ConversionVehicle=Readonly<{linkId:string;leadVehicleId:string;expectedLeadVehicleVersion:string;target:ConversionTarget<VehicleDraft>}>;
export type ConversionAddress=Readonly<{linkId:string;leadAddressId:string;expectedLeadAddressVersion:string;target:ConversionTarget<AddressDraft>}>;
export type LeadConversion=Readonly<{
 schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;
 conversionId:string;leadId:string;expectedLeadVersion:string;
 customer:ConversionTarget<CustomerDraft>;
 vehicles:readonly ConversionVehicle[];addresses:readonly ConversionAddress[];
}>;
// A bounded atomic request, not a business rule requiring a certain number of
// vehicles/locations. Never slice a plan to make it fit. Transport may add its
// own envelope and must enforce its independent complete-body limit.
export const leadConversionMaxBytes=131072;
const maxSelections=1000;
function target<D extends Readonly<{archived:boolean;archiveReason:string|null}>>(raw:unknown,parse:(value:unknown)=>D):ConversionTarget<D>{
 check(raw&&typeof raw==='object'&&!Array.isArray(raw));
 const value=raw as Record<string,unknown>;
 if(value.kind==='existing'){
  check(exact(value,['kind','id','expectedVersion'])&&uuid(value.id)&&version(value.expectedVersion));
  return Object.freeze({kind:'existing',id:value.id,expectedVersion:value.expectedVersion});
 }
 check(exact(value,['kind','id','draft'])&&value.kind==='new'&&uuid(value.id));
 const draft=parse(value.draft);check(!draft.archived&&draft.archiveReason===null);
 return Object.freeze({kind:'new',id:value.id,draft});
}
function vehicle(value:unknown):ConversionVehicle{
 check(exact(value,['linkId','leadVehicleId','expectedLeadVehicleVersion','target'])&&uuid(value.linkId)&&uuid(value.leadVehicleId)&&version(value.expectedLeadVehicleVersion));
 return Object.freeze({linkId:value.linkId,leadVehicleId:value.leadVehicleId,expectedLeadVehicleVersion:value.expectedLeadVehicleVersion,target:target(value.target,parseVehicleDraft)});
}
function address(value:unknown):ConversionAddress{
 check(exact(value,['linkId','leadAddressId','expectedLeadAddressVersion','target'])&&uuid(value.linkId)&&uuid(value.leadAddressId)&&version(value.expectedLeadAddressVersion));
 return Object.freeze({linkId:value.linkId,leadAddressId:value.leadAddressId,expectedLeadAddressVersion:value.expectedLeadAddressVersion,target:target(value.target,parseAddressDraft)});
}
function targetsAgree<D>(values:readonly ConversionTarget<D>[]){
 const seen=new Map<string,ConversionTarget<D>>();
 for(const item of values){const prior=seen.get(item.id);check(!prior||prior.kind==='existing'&&item.kind==='existing'&&prior.expectedVersion===item.expectedVersion);seen.set(item.id,item);}
}
export function parseLeadConversion(value:unknown):LeadConversion{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','customer','vehicles','addresses'])&&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.conversionId)&&uuid(value.leadId)&&version(value.expectedLeadVersion)
  &&Array.isArray(value.vehicles)&&Array.isArray(value.addresses)&&value.vehicles.length+value.addresses.length<=maxSelections);
 const customer=target(value.customer,parseCustomerDraft),vehicles=Object.freeze(Array.from(value.vehicles,vehicle)),addresses=Object.freeze(Array.from(value.addresses,address));
 // A genuine existing address belongs to its existing customer. Conversion
 // cannot move it to a newly created customer or overwrite that ownership.
 check(customer.kind==='existing'||addresses.every(a=>a.target.kind==='new'));
 check(new Set(vehicles.map(v=>v.leadVehicleId)).size===vehicles.length&&new Set(addresses.map(a=>a.leadAddressId)).size===addresses.length);
 const linkIds=[...vehicles.map(v=>v.linkId),...addresses.map(a=>a.linkId)];check(new Set(linkIds).size===linkIds.length);
 // Explicitly mapping different reports to the same existing directory record
 // is permitted. Repeated creation or contradictory versions are ambiguous.
 targetsAgree(vehicles.map(v=>v.target));targetsAgree(addresses.map(a=>a.target));
 const parsed:LeadConversion=Object.freeze({schemaVersion:1,businessId:value.businessId,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,conversionId:value.conversionId,leadId:value.leadId,expectedLeadVersion:value.expectedLeadVersion,customer,vehicles,addresses});
 check(new TextEncoder().encode(JSON.stringify(parsed)).byteLength<=leadConversionMaxBytes);
 return parsed;
}

// Private advisory preview only. No session, operation claim, persistence or
// automatic duplicate selection. Database locks and fresh checks remain vital.
export function prepareLeadConversion(value:unknown,leadSource:unknown,vehicleSources:readonly unknown[],addressSources:readonly unknown[]){
 const command=parseLeadConversion(value),lead=parseLead(leadSource,command.businessId);
 check(lead.id===command.leadId&&lead.version===command.expectedLeadVersion&&(lead.customer_id===null||command.customer.kind==='existing'&&lead.customer_id===command.customer.id));
 check(Array.isArray(vehicleSources)&&Array.isArray(addressSources)&&vehicleSources.length===command.vehicles.length&&addressSources.length===command.addresses.length);
 const vehicles=Object.freeze(Array.from(vehicleSources,row=>parseLeadVehicle(row,command.businessId,command.leadId))),addresses=Object.freeze(Array.from(addressSources,row=>parseLeadAddress(row,command.businessId,command.leadId)));
 check(new Set(vehicles.map(v=>v.id)).size===vehicles.length&&new Set(addresses.map(a=>a.id)).size===addresses.length);
 const vehicleById=new Map(vehicles.map(row=>[row.id,row])),addressById=new Map(addresses.map(row=>[row.id,row]));
 for(const mapping of command.vehicles){const row=vehicleById.get(mapping.leadVehicleId);check(row&&row.version===mapping.expectedLeadVehicleVersion&&row.archived_at===null);}
 for(const mapping of command.addresses){const row=addressById.get(mapping.leadAddressId);check(row&&row.version===mapping.expectedLeadAddressVersion&&row.archived_at===null);}
 return Object.freeze({command,lead,vehicles,addresses});
}

// Owner must explicitly choose classification, identity, contact preferences,
// opt-out state, notes and date. Requested services/condition remain lead
// evidence, not accepted catalog scope or a fabricated vehicle description.
export function newConversionCustomer(leadSource:unknown,businessId:string,choices:Readonly<{contactPreference:string|null;outreachOptOut:boolean;notes:string|null;customerSince:string|null}>):CustomerDraft{
 const lead=parseLead(leadSource,businessId);
 check(exact(choices,['contactPreference','outreachOptOut','notes','customerSince']));
 return parseCustomerDraft({displayName:lead.label,phone:lead.phone_raw,email:lead.email_raw,contactPreference:choices.contactPreference,outreachOptOut:choices.outreachOptOut,notes:choices.notes,customerSince:choices.customerSince,archived:false,archiveReason:null});
}
export function newConversionVehicle(source:unknown,businessId:string,leadId:string,linkId:string,vehicleId:string,kind:VehicleDraft['kind']):ConversionVehicle{
 const row=parseLeadVehicle(source,businessId,leadId);check(row.archived_at===null);const report=row.reported_vehicle;
 const draft=parseVehicleDraft({label:report.label,year:report.year,make:report.make,model:report.model,color:report.color,vin:report.vin,plate:report.plate,notes:report.notes,kind,archived:false,archiveReason:null});
 return vehicle({linkId,leadVehicleId:row.id,expectedLeadVehicleVersion:row.version,target:{kind:'new',id:vehicleId,draft}});
}
export function newConversionAddress(source:unknown,businessId:string,leadId:string,linkId:string,addressId:string):ConversionAddress{
 const row=parseLeadAddress(source,businessId,leadId);check(row.archived_at===null);
 return address({linkId,leadAddressId:row.id,expectedLeadAddressVersion:row.version,target:{kind:'new',id:addressId,draft:draftFromLeadAddress(row)}});
}
