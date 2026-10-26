import type {LeadAddress} from '../../src/customer/lead-address-contract.ts';
import {parseLeadAddress} from '../../src/customer/lead-address-contract.ts';
import {decodeCustomerCsv} from './customer-fixture.ts';
export const leadAddressBusiness='11111111-1111-4111-8111-111111111111';
export function leadAddressFixture(patch:Partial<LeadAddress>={}):LeadAddress{return {
 id:'22222222-2222-4222-8222-222222222222',business_id:leadAddressBusiness,
 lead_id:'33333333-3333-4333-8333-333333333333',line1:null,line2:null,city:null,
 region:null,postal_code:null,country:null,exact_location_text:null,instructions:null,
 geocode_source:null,geocode_accuracy:null,latitude:null,longitude:null,verified_at:null,
 archived_at:null,archived_reason:null,version:'1',created_at:'2026-10-25T01:02:03.123456Z',
 updated_at:'2026-10-25T01:02:03.123456Z',created_by:leadAddressBusiness,
 updated_by:leadAddressBusiness,origin:'manual',operation_id:'44444444-4444-4444-8444-444444444444',
 import_row_id:null,...patch
};}
// Independent CSV/text decoder; not a product import or authority boundary.
export function decodeLeadAddressCsv(csv:string,escapeMap:string,businessId=leadAddressBusiness){
 return decodeCustomerCsv(csv,escapeMap).map(row=>parseLeadAddress(row,businessId));
}
