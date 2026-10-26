import {customerUuid as uuid,customerVersion as version,customerInstant as instant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadConversion} from './lead-conversion-contract.ts';
import type {LeadConversion} from './lead-conversion-contract.ts';

export const leadConversionColumns=['id','business_id','lead_id','customer_id','expected_lead_version','lead_version','customer_version','lead_before_audit_id','lead_audit_id','customer_audit_id','lead_child_operation_id','customer_child_operation_id','request','converted_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export const conversionLinkColumns=['id','business_id','conversion_id','lead_id','lead_vehicle_id','vehicle_id','lead_address_id','address_id','source_version','target_version','source_audit_id','target_audit_id','target_child_operation_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
type Retained=Readonly<{id:string;business_id:string;version:'1';created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual';operation_id:string;import_row_id:null}>;
export type LeadConversionRecord=Retained&Readonly<{
 lead_id:string;customer_id:string;expected_lead_version:string;lead_version:string;customer_version:string;
 lead_before_audit_id:string;lead_audit_id:string;customer_audit_id:string;lead_child_operation_id:string;
 customer_child_operation_id:string|null;request:LeadConversion;converted_at:string;
}>;
export type ConversionLink=Retained&Readonly<{
 conversion_id:string;lead_id:string;lead_vehicle_id:string|null;vehicle_id:string|null;
 lead_address_id:string|null;address_id:string|null;source_version:string;target_version:string;
 source_audit_id:string;target_audit_id:string;target_child_operation_id:string|null;
}>;
function retained(v:Record<string,unknown>,businessId:string){
 check(uuid(businessId)&&v.business_id===businessId&&uuid(v.id)&&v.version==='1'
  &&instant(v.created_at)&&v.updated_at===v.created_at&&uuid(v.created_by)&&v.updated_by===v.created_by
  &&v.origin==='manual'&&uuid(v.operation_id)&&v.import_row_id===null);
}
// Data validation does not prove existence, permission, current destination
// state or audit integrity. The database verifies the original immutable images.
export function parseLeadConversionRecord(value:unknown,businessId:string,leadId?:string):LeadConversionRecord{
 check(exact(value,leadConversionColumns));retained(value,businessId);
 check(uuid(value.lead_id)&&(leadId===undefined||uuid(leadId)&&value.lead_id===leadId)
  &&uuid(value.customer_id)&&version(value.expected_lead_version)&&version(value.lead_version)
  &&BigInt(value.lead_version)===BigInt(value.expected_lead_version)+1n&&version(value.customer_version)
  &&uuid(value.lead_before_audit_id)&&uuid(value.lead_audit_id)&&value.lead_before_audit_id!==value.lead_audit_id
  &&uuid(value.customer_audit_id)&&uuid(value.lead_child_operation_id)
  &&(value.customer_child_operation_id===null||uuid(value.customer_child_operation_id))
  &&value.converted_at===value.created_at);
 const request=parseLeadConversion(value.request);
 // Commands normalize signed zero before persistence. A source reader must
 // reject noncanonical stored text rather than silently rewrite its evidence.
 const supplied=value.request as LeadConversion;
 for(const [i,mapping] of request.addresses.entries())if(mapping.target.kind==='new'){
  const raw=supplied.addresses[i]!.target;check(raw.kind==='new'
   &&raw.draft.latitude===mapping.target.draft.latitude&&raw.draft.longitude===mapping.target.draft.longitude);
 }
 check(request.businessId===businessId&&request.conversionId===value.id&&request.leadId===value.lead_id
  &&request.operationId===value.operation_id&&request.expectedLeadVersion===value.expected_lead_version
  &&request.customer.id===value.customer_id);
 check(request.customer.kind==='new'
  ?value.customer_version==='1'&&value.customer_child_operation_id!==null
  :value.customer_version===request.customer.expectedVersion&&value.customer_child_operation_id===null);
 return Object.freeze({...value,request}) as LeadConversionRecord;
}
export function parseConversionLink(value:unknown,businessId:string,parent?:LeadConversionRecord):ConversionLink{
 check(exact(value,conversionLinkColumns));retained(value,businessId);
 check(uuid(value.conversion_id)&&uuid(value.lead_id)&&version(value.source_version)&&version(value.target_version)
  &&uuid(value.source_audit_id)&&uuid(value.target_audit_id)
  &&(value.target_child_operation_id===null||uuid(value.target_child_operation_id)&&value.target_version==='1'));
 const vehicle=uuid(value.lead_vehicle_id)&&uuid(value.vehicle_id)&&value.lead_address_id===null&&value.address_id===null;
 const address=uuid(value.lead_address_id)&&uuid(value.address_id)&&value.lead_vehicle_id===null&&value.vehicle_id===null;
 check(vehicle||address);
 if(parent!==undefined){
  const p=parseLeadConversionRecord(parent,businessId);
  check(value.conversion_id===p.id&&value.lead_id===p.lead_id&&value.operation_id===p.operation_id&&value.created_by===p.created_by);
  const mapping=vehicle?p.request.vehicles.find(m=>m.linkId===value.id):p.request.addresses.find(m=>m.linkId===value.id);
  check(mapping!==undefined);
  const source='leadVehicleId' in mapping?mapping.leadVehicleId:mapping.leadAddressId;
  const sourceVersion='expectedLeadVehicleVersion' in mapping?mapping.expectedLeadVehicleVersion:mapping.expectedLeadAddressVersion;
  check(source===(vehicle?value.lead_vehicle_id:value.lead_address_id)&&sourceVersion===value.source_version
   &&mapping.target.id===(vehicle?value.vehicle_id:value.address_id));
  check(mapping.target.kind==='new'?value.target_version==='1'&&value.target_child_operation_id!==null
   :value.target_version===mapping.target.expectedVersion&&value.target_child_operation_id===null);
 }
 return Object.freeze({...value}) as ConversionLink;
}
// A complete bounded partial-source collection, never a paginated subset or
// complete Crest export. UUID coincidences across the two tables are legitimate.
export function parseLeadConversionCollection(conversions:readonly unknown[],links:readonly unknown[],businessId:string){
 check(uuid(businessId)&&Array.isArray(conversions)&&Array.isArray(links)&&conversions.length<=1000&&links.length<=1000);
 const parents=Array.from(conversions,c=>parseLeadConversionRecord(c,businessId));
 check(new Set(parents.map(c=>c.id)).size===parents.length&&new Set(parents.map(c=>c.lead_id)).size===parents.length
  &&new Set(parents.map(c=>c.operation_id)).size===parents.length);
 const byId=new Map(parents.map(p=>[p.id,p]));
 const children=Array.from(links,l=>{check(l&&typeof l==='object'&&!Array.isArray(l));const parent=byId.get((l as ConversionLink).conversion_id);check(parent!==undefined);return parseConversionLink(l,businessId,parent);});
 check(new Set(children.map(c=>c.id)).size===children.length);
 for(const parent of parents)check(children.filter(c=>c.conversion_id===parent.id).length===parent.request.vehicles.length+parent.request.addresses.length);
 return Object.freeze({conversions:Object.freeze(parents.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)),links:Object.freeze(children.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))});
}
