import {customerUuid,customerVersion,customerInstant,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {parseLeadAddressDraft} from './lead-resource-contract.ts';
import type {LeadAddressDraft} from './lead-resource-contract.ts';

// A retained intake source belongs to the lead. Customer-owned addresses and
// conversion mappings remain separate sources; no synthetic customer is needed.
export const leadAddressColumns=['id','business_id','lead_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type LeadAddress=Readonly<{
 id:string;business_id:string;lead_id:string;line1:string|null;line2:string|null;
 city:string|null;region:string|null;postal_code:string|null;country:string|null;
 exact_location_text:string|null;instructions:string|null;geocode_source:string|null;
 geocode_accuracy:string|null;latitude:string|null;longitude:string|null;
 verified_at:string|null;archived_at:string|null;archived_reason:string|null;
 version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;
 origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null;
}>;
export function draftFromLeadAddress(row:LeadAddress):LeadAddressDraft{
 return parseLeadAddressDraft({line1:row.line1,line2:row.line2,city:row.city,region:row.region,
  postalCode:row.postal_code,country:row.country,exactLocationText:row.exact_location_text,
  instructions:row.instructions,geocodeSource:row.geocode_source,geocodeAccuracy:row.geocode_accuracy,
  latitude:row.latitude,longitude:row.longitude,verifiedAt:row.verified_at,
  archived:row.archived_at!==null,archiveReason:row.archived_reason});
}
export function parseLeadAddress(value:unknown,businessId:string,leadId?:string):LeadAddress{
 requireCustomer(exactCustomerObject(value,leadAddressColumns)&&customerUuid(businessId)
  &&value.business_id===businessId&&customerUuid(value.id)&&customerUuid(value.lead_id)
  &&(leadId===undefined||customerUuid(leadId)&&value.lead_id===leadId)
  &&customerVersion(value.version)&&customerUuid(value.created_by)&&customerUuid(value.updated_by)
  &&customerUuid(value.operation_id)&&(value.import_row_id===null||customerUuid(value.import_row_id))
  &&['manual','import','system'].includes(value.origin as string));
 const row=value as LeadAddress,draft=draftFromLeadAddress(row);
 requireCustomer(draft.latitude===row.latitude&&draft.longitude===row.longitude
  &&customerInstant(row.created_at)&&customerInstant(row.updated_at)&&row.updated_at>=row.created_at
  &&(row.archived_at===null||customerInstant(row.archived_at)&&row.archived_at>=row.created_at&&row.archived_at<=row.updated_at));
 return Object.freeze({...row});
}
