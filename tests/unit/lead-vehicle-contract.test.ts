import {expect,it} from 'vitest';
import {leadVehicleColumns,parseLeadVehicle,draftFromLeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {leadVehicleFixture as row,leadVehicleBusiness as business} from '../support/lead-vehicle-fixture.ts';
it('preserves all17 original source columns, exact bigint versions and UTC microseconds',()=>{
 const value=row({version:'9007199254740993',vehicle_id:business,reported_vehicle:{...row().reported_vehicle,year:-500,vin:' Shared VIN / é 001 '},condition_notes:'\tReported only\n=SUM(A1)'});
 expect(Object.keys(value)).toEqual([...leadVehicleColumns]);expect(parseLeadVehicle(value,business,value.lead_id)).toEqual(value);expect(draftFromLeadVehicle(value)).toMatchObject({vehicleId:business,archived:false,archiveReason:null});
});
it('pins independent nested original reports and requested services',()=>{
 const value=row(),parsed=parseLeadVehicle(value,business);expect(Object.isFrozen(parsed)&&Object.isFrozen(parsed.reported_vehicle)&&Object.isFrozen(parsed.requested_services)).toBe(true);
 const mutable=value.reported_vehicle as {label:string};mutable.label='Changed by caller';expect(parsed.reported_vehicle.label).toBe('Synthetic reported vehicle');
});
it('retains archive provenance without inventing a directory association or condition assessment',()=>{
 const value=row({archived_at:'2026-10-25T02:03:04.000001Z',updated_at:'2026-10-25T03:04:05.000002Z',archived_reason:'  Original reason 😀  '});expect(parseLeadVehicle(value,business)).toEqual(value);expect(draftFromLeadVehicle(value)).toMatchObject({vehicleId:null,archived:true,archiveReason:value.archived_reason});
});
it('rejects wrong business/lead, missing/extra fields, invalid provenance and impossible archive chronology',()=>{
 const value=row();expect(()=>parseLeadVehicle(value,business,business)).toThrow('CUSTOMER_DATA_INVALID');expect(()=>parseLeadVehicle(value,value.id)).toThrow('CUSTOMER_DATA_INVALID');
 for(const patch of [{version:1},{version:'0'},{version:'9223372036854775808'},{id:''},{lead_id:null},{created_by:1},{operation_id:''},{origin:'unreviewed'},{import_row_id:1},{created_at:'2026-10-25T01:02:03.123Z'},{updated_at:'2026-10-24T00:00:00.000000Z'},{archived_at:'2026-10-24T00:00:00.000000Z',archived_reason:'Earlier than creation'},{archived_at:'2026-10-26T00:00:00.000000Z',archived_reason:'Later than update'},{archived_reason:'No archive instant'},{customer_id:business},{state:'won'}])expect(()=>parseLeadVehicle({...value,...patch},business)).toThrow('CUSTOMER_DATA_INVALID');
 for(const key of leadVehicleColumns){const missing:Record<string,unknown>={...value};delete missing[key];expect(()=>parseLeadVehicle(missing,business)).toThrow('CUSTOMER_DATA_INVALID');}
});
