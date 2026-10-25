import type {LeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {parseLeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {decodeCustomerCsv} from './customer-fixture.ts';
export const leadVehicleBusiness='11111111-1111-4111-8111-111111111111';
export function leadVehicleFixture(patch:Partial<LeadVehicle>={}):LeadVehicle{return {
 id:'22222222-2222-4222-8222-222222222222',business_id:leadVehicleBusiness,lead_id:'33333333-3333-4333-8333-333333333333',vehicle_id:null,
 reported_vehicle:{schemaVersion:1,label:'Synthetic reported vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,notes:null},requested_services:{schemaVersion:1,text:null},condition_notes:null,archived_at:null,archived_reason:null,version:'1',created_at:'2026-10-25T01:02:03.123456Z',updated_at:'2026-10-25T01:02:03.123456Z',created_by:leadVehicleBusiness,updated_by:leadVehicleBusiness,origin:'manual',operation_id:'44444444-4444-4444-8444-444444444444',import_row_id:null,...patch
};}
// Independent CSV/text decoding, then the declared JSON columns. This is a
// round-trip assertion helper, never product import or authority validation.
export function decodeLeadVehicleCsv(csv:string,escapeMap:string,businessId=leadVehicleBusiness){
 return decodeCustomerCsv(csv,escapeMap).map(row=>parseLeadVehicle({...row,reported_vehicle:JSON.parse(row.reported_vehicle as string),requested_services:JSON.parse(row.requested_services as string)},businessId));
}
