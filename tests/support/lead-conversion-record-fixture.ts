import type {LeadConversionRecord,ConversionLink} from '../../src/customer/lead-conversion-record.ts';
import {parseLeadConversionCollection} from '../../src/customer/lead-conversion-record.ts';
import {decodeCustomerCsv} from './customer-fixture.ts';
export const conversionBusiness='11111111-1111-4111-8111-111111111111';
export const conversionId='33333333-3333-4333-8333-333333333333';
export const conversionLead='44444444-4444-4444-8444-444444444444';
const customer='55555555-5555-4555-8555-555555555555',operation='66666666-6666-4666-8666-666666666666',actor='22222222-2222-4222-8222-222222222222';
const stamp='2026-10-25T01:02:03.123456Z';
export function conversionRecordFixture(patch:Partial<LeadConversionRecord>={}):LeadConversionRecord{return {
 id:conversionId,business_id:conversionBusiness,lead_id:conversionLead,customer_id:customer,
 expected_lead_version:'1',lead_version:'2',customer_version:'1',
 lead_before_audit_id:'77777777-7777-4777-8777-777777777777',lead_audit_id:'88888888-8888-4888-8888-888888888888',customer_audit_id:'99999999-9999-4999-8999-999999999999',
 lead_child_operation_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customer_child_operation_id:null,
 request:{schemaVersion:1,businessId:conversionBusiness,operationId:operation,recoveryEpoch:conversionBusiness,conversionId,leadId:conversionLead,expectedLeadVersion:'1',customer:{kind:'existing',id:customer,expectedVersion:'1'},vehicles:[{linkId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',leadVehicleId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expectedLeadVehicleVersion:'1',target:{kind:'existing',id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',expectedVersion:'1'}}],addresses:[{linkId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',leadAddressId:'ffffffff-ffff-4fff-8fff-ffffffffffff',expectedLeadAddressVersion:'1',target:{kind:'existing',id:'00000000-0000-4000-8000-000000000001',expectedVersion:'1'}}]},
 converted_at:stamp,version:'1',created_at:stamp,updated_at:stamp,created_by:actor,updated_by:actor,origin:'manual',operation_id:operation,import_row_id:null,...patch
};}
export function conversionLinkFixture(kind:'vehicle'|'address'='vehicle',patch:Partial<ConversionLink>={}):ConversionLink{
 const parent=conversionRecordFixture(),vehicle=kind==='vehicle',m=vehicle?parent.request.vehicles[0]!:parent.request.addresses[0]!;
 return {id:m.linkId,business_id:conversionBusiness,conversion_id:conversionId,lead_id:conversionLead,
  lead_vehicle_id:vehicle?parent.request.vehicles[0]!.leadVehicleId:null,vehicle_id:vehicle?m.target.id:null,
  lead_address_id:vehicle?null:parent.request.addresses[0]!.leadAddressId,address_id:vehicle?null:m.target.id,
  source_version:'1',target_version:'1',source_audit_id:'00000000-0000-4000-8000-000000000002',target_audit_id:'00000000-0000-4000-8000-000000000003',target_child_operation_id:null,
  version:'1',created_at:stamp,updated_at:stamp,created_by:actor,updated_by:actor,origin:'manual',operation_id:operation,import_row_id:null,...patch};
}
// Independent RFC4180/sentinel/escape decoder. The structured request stays
// JSON with exact nested decimal strings; this is not a product import route.
export function decodeLeadConversionCsv(value:{conversions:{csv:string;escapeMap:string};links:{csv:string;escapeMap:string}},businessId=conversionBusiness){
 const conversions=decodeCustomerCsv(value.conversions.csv,value.conversions.escapeMap).map(row=>({...row,request:JSON.parse(row.request as string)}));
 const links=decodeCustomerCsv(value.links.csv,value.links.escapeMap);
 return parseLeadConversionCollection(conversions,links,businessId);
}
