import {customerUuid,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {parseAddressDraft,parseVehicleDraft} from './customer-resource-contract.ts';
import type {AddressDraft} from './customer-resource-contract.ts';

// Reported intake is independent of a directory match. A selected UUID is a
// request to link, never proof of existence, ownership, condition or identity.
// The transactional command must validate its genuine same-business source.
export type ReportedLeadVehicle=Readonly<{
  schemaVersion:1;label:string;year:number|null;make:string|null;model:string|null;
  color:string|null;vin:string|null;plate:string|null;notes:string|null;
}>;
export type LeadRequestedServices=Readonly<{schemaVersion:1;text:string|null}>;
export type LeadVehicleDraft=Readonly<{
  vehicleId:string|null;reportedVehicle:ReportedLeadVehicle;
  requestedServices:LeadRequestedServices;conditionNotes:string|null;
  archived:boolean;archiveReason:string|null;
}>;

function text(value:unknown,limit:number,meaningful=false):value is string{
  if(typeof value!=='string'||value.length>limit*2)return false;
  return [...value].length<=limit&&(!meaningful||value.trim().length>0)&&[...value].every(c=>{
    const n=c.codePointAt(0)!;
    return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);
  });
}

export function parseReportedLeadVehicle(value:unknown):ReportedLeadVehicle{
  requireCustomer(exactCustomerObject(value,['schemaVersion','label','year','make','model','color','vin','plate','notes'])&&value.schemaVersion===1);
  // Reuse the directory's raw text/year constraints without adding its mutable
  // classification/archive fields to the original report.
  parseVehicleDraft({label:value.label,year:value.year,make:value.make,model:value.model,
    color:value.color,vin:value.vin,plate:value.plate,notes:value.notes,
    kind:'customer_vehicle',archived:false,archiveReason:null});
  return Object.freeze({...value}) as ReportedLeadVehicle;
}

export function parseLeadRequestedServices(value:unknown):LeadRequestedServices{
  requireCustomer(exactCustomerObject(value,['schemaVersion','text'])&&value.schemaVersion===1
    &&(value.text===null||text(value.text,4000)));
  // This is the original request, not catalog selection, accepted scope, a
  // category/condition assessment, a price or permission to schedule work.
  return Object.freeze({...value}) as LeadRequestedServices;
}

export function parseLeadVehicleDraft(value:unknown):LeadVehicleDraft{
  requireCustomer(exactCustomerObject(value,['vehicleId','reportedVehicle','requestedServices','conditionNotes','archived','archiveReason'])
    &&(value.vehicleId===null||customerUuid(value.vehicleId))
    &&(value.conditionNotes===null||text(value.conditionNotes,4000))
    &&typeof value.archived==='boolean'
    &&(value.archived?text(value.archiveReason,1000,true):value.archiveReason===null));
  const reportedVehicle=parseReportedLeadVehicle(value.reportedVehicle),requestedServices=parseLeadRequestedServices(value.requestedServices);
  return Object.freeze({...value,reportedVehicle,requestedServices}) as LeadVehicleDraft;
}

// Lead-owned intake has no fabricated customer owner. Reuse the existing raw
// address/coordinate/archive contract; an all-unknown address remains valid.
// Conversion must explicitly select/create a customer-owned destination while
// retaining this source and original history. No persistence is exposed here.
export type LeadAddressDraft=AddressDraft;
export function parseLeadAddressDraft(value:unknown):LeadAddressDraft{return parseAddressDraft(value);}
