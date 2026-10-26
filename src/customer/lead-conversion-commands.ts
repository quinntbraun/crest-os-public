import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid,requireCustomer as check} from './customer-contract.ts';
import type {CustomerDraft} from './customer-contract.ts';
import type {AddressDraft,VehicleDraft} from './customer-resource-contract.ts';
import {draftFromLead} from './lead-contract.ts';
import type {LeadDraft} from './lead-contract.ts';
import {prepareLeadConversionReview} from './lead-conversion-preview.ts';

type Role='customer'|'vehicle'|'address'|'lead';
type Common=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;expectedVersion:string}>;
export type LeadConversionStep=
 |Readonly<{role:'customer';command:'save_customer';input:Common&Readonly<{customerId:string;draft:CustomerDraft}>}>
 |Readonly<{role:'vehicle';command:'save_vehicle';input:Common&Readonly<{vehicleId:string;draft:VehicleDraft}>}>
 |Readonly<{role:'address';command:'save_address';input:Common&Readonly<{addressId:string;customerId:string;draft:AddressDraft}>}>
 |Readonly<{role:'lead';command:'save_lead';input:Common&Readonly<{leadId:string;draft:LeadDraft}>}>;

// Fixed, versioned identity derivation for eventual database composition.
// Every variable part is an exact lower-case UUID; the ASCII unit separator
// cannot occur inside it. SQL must match these bytes and the golden vectors.
// Child IDs are retry identities, never permissions or secrets.
export function leadConversionChildOperation(businessId:string,operationId:string,conversionId:string,role:Role,entityId:string){
 check(uuid(businessId)&&uuid(operationId)&&uuid(conversionId)&&uuid(entityId)&&['customer','vehicle','address','lead'].includes(role));
 const bytes=createHash('sha256').update(['crest:lead-conversion:child:1',role,businessId,operationId,conversionId,entityId].join('\x1f'),'utf8').digest().subarray(0,16);
 bytes[6]=(bytes[6]!&15)|128;bytes[8]=(bytes[8]!&63)|128;
 const hex=bytes.toString('hex');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

// No execution/transport is provided. These fixed existing domain commands
// must eventually run inside ONE authenticated database command/transaction,
// with immutable parent mappings and atomic replay verification. Sequential
// HTTP calls or separate commandTransaction calls would not provide atomicity.
export function createLeadConversionCommands(value:unknown,leadSource:unknown,vehicleSources:readonly unknown[],addressSources:readonly unknown[],destinations:unknown){
 const review=prepareLeadConversionReview(value,leadSource,vehicleSources,addressSources,destinations),request=review.command,steps:LeadConversionStep[]=[];
 const common=(role:Role,id:string,expectedVersion='0'):Common=>Object.freeze({schemaVersion:1,businessId:request.businessId,operationId:leadConversionChildOperation(request.businessId,request.operationId,request.conversionId,role,id),recoveryEpoch:request.recoveryEpoch,expectedVersion});
 if(request.customer.kind==='new')steps.push(Object.freeze({role:'customer',command:'save_customer',input:Object.freeze({...common('customer',request.customer.id),customerId:request.customer.id,draft:request.customer.draft})}));
 for(const mapping of request.vehicles)if(mapping.target.kind==='new')steps.push(Object.freeze({role:'vehicle',command:'save_vehicle',input:Object.freeze({...common('vehicle',mapping.target.id),vehicleId:mapping.target.id,draft:mapping.target.draft})}));
 for(const mapping of request.addresses)if(mapping.target.kind==='new')steps.push(Object.freeze({role:'address',command:'save_address',input:Object.freeze({...common('address',mapping.target.id),addressId:mapping.target.id,customerId:request.customer.id,draft:mapping.target.draft})}));
 const draft=Object.freeze({...draftFromLead(review.lead),customerId:request.customer.id});
 steps.push(Object.freeze({role:'lead',command:'save_lead',input:Object.freeze({...common('lead',request.leadId,request.expectedLeadVersion),leadId:request.leadId,draft})}));
 const ids=steps.map(step=>step.input.operationId);check(!ids.includes(request.operationId)&&new Set(ids).size===ids.length);
 const result=Object.freeze({request,steps:Object.freeze(steps)});
 return Object.freeze({forServer:()=>result,toJSON():never{throw new Error('LEAD_CONVERSION_COMMANDS_PRIVATE');}});
}
