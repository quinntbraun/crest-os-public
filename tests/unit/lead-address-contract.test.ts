import {expect,it} from 'vitest';
import {leadAddressColumns,parseLeadAddress,draftFromLeadAddress} from '../../src/customer/lead-address-contract.ts';
import {leadAddressFixture as row,leadAddressBusiness as business} from '../support/lead-address-fixture.ts';
it('retains all26 lead-owned fields without a customer, complete postal address or verified location',()=>{
 const value=row();expect(Object.keys(value)).toEqual([...leadAddressColumns]);
 expect(parseLeadAddress(value,business,value.lead_id)).toEqual(value);
 expect(draftFromLeadAddress(value)).toMatchObject({line1:null,latitude:null,longitude:null,verifiedAt:null,archived:false});
});
it('preserves raw Unicode location notes, exact decimal strings, bigint versions and UTC microseconds',()=>{
 const value=row({line1:'  É 😀 ", unit 1  ',exact_location_text:'Behind the barn\r\nNot yet verified',instructions:'\t=SUM(A1)\n\\N',latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000',geocode_source:'Manual report',geocode_accuracy:'Unknown',verified_at:'2026-10-25T01:02:03.000001Z',version:'9007199254740993'});
 expect(parseLeadAddress(value,business)).toEqual(value);expect(Object.isFrozen(parseLeadAddress(value,business))).toBe(true);
 expect(draftFromLeadAddress(value)).toMatchObject({latitude:value.latitude,longitude:value.longitude,exactLocationText:value.exact_location_text});
});
it('keeps null distinct from empty text and retains the original archive instant/reason',()=>{
 const value=row({line1:'',line2:'\\N',archived_at:row().created_at,archived_reason:'  Earlier report 😀  '});
 expect(parseLeadAddress(value,business)).toEqual(value);expect(draftFromLeadAddress(value)).toMatchObject({archived:true,archiveReason:value.archived_reason});
});
it('rejects wrong scopes, invented customer links, noncanonical coordinates and impossible source history',()=>{
 const value=row();expect(()=>parseLeadAddress(value,business,business)).toThrow();expect(()=>parseLeadAddress(value,value.id)).toThrow();
 for(const patch of [{customer_id:business},{lead_id:null},{id:''},{version:1},{version:'0'},{version:'9223372036854775808'},{created_by:''},{updated_by:1},{operation_id:''},{origin:'unknown'},{import_row_id:1},{latitude:'0',longitude:null},{latitude:'-0.000',longitude:'0'},{latitude:'90.000000000000001',longitude:'0'},{latitude:'0',longitude:'180.1'},{latitude:0,longitude:0},{latitude:'1e0',longitude:'1'},{created_at:'2026-10-25T01:02:03.123Z'},{updated_at:'2026-10-24T00:00:00.000000Z'},{verified_at:'invalid'},{archived_at:'2026-10-24T00:00:00.000000Z',archived_reason:'Before creation'},{archived_at:'2026-10-26T00:00:00.000000Z',archived_reason:'After update'},{archived_reason:'Without instant'},{line1:'\u0000'},{instructions:'\ud800'}])expect(()=>parseLeadAddress({...value,...patch},business)).toThrow('CUSTOMER_DATA_INVALID');
 for(const key of leadAddressColumns){const missing:Record<string,unknown>={...value};delete missing[key];expect(()=>parseLeadAddress(missing,business)).toThrow();}
});
