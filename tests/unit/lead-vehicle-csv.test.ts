import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatLeadVehicleCsv} from '../../src/customer/lead-vehicle-csv.ts';
import {leadVehicleColumns} from '../../src/customer/lead-vehicle-contract.ts';
import type {LeadVehicle} from '../../src/customer/lead-vehicle-contract.ts';
import {leadVehicleFixture as row,leadVehicleBusiness as business,decodeLeadVehicleCsv} from '../support/lead-vehicle-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const token='a'.repeat(64),format=(rows:LeadVehicle[])=>formatLeadVehicleCsv({businessId:business,snapshotToken:token,expectedRowCount:String(rows.length),rows});
it('round-trips all17 columns and versioned nested reports using independent CSV decoding',()=>{
 const original=row({version:'9007199254740993',reported_vehicle:{...row().reported_vehicle,label:'  É 😀 "\\N"  ',year:-500,vin:' Shared / 001 ',notes:'\t=SUM(A1)\r\n\\N'},requested_services:{schemaVersion:1,text:'  Interior\nExterior? 😀  '},condition_notes:' =SUM(A1)\nOriginal "\\N"'}),result=format([original]);
 expect(readCustomerCsv(result.csv)[0]).toEqual([...leadVehicleColumns]);expect(decodeLeadVehicleCsv(result.csv,result.escapeMap)).toEqual([original]);expect(JSON.parse(result.escapeMap).escapes).toContainEqual({row_id:original.id,column:'condition_notes',apostrophe_prefix:true});expect(JSON.parse(result.dictionary).scalarTypes.reported_vehicle).toContain('JSON');
});
it('keeps null, empty, literal null sentinels and original apostrophes distinct',()=>{
 const originals=[row(),row({id:business,requested_services:{schemaVersion:1,text:''},reported_vehicle:{...row().reported_vehicle,notes:'\\N'},condition_notes:"'original\\N"})],result=format(originals);expect(decodeLeadVehicleCsv(result.csv,result.escapeMap)).toEqual([...originals].sort((a,b)=>a.id.localeCompare(b.id)));
});
it('escapes formula-leading raw text without changing the original value or guessing an escape on import',()=>{
 for(const text of ['=1',' +1','\t-1','\n@SUM(A1)',"'retained",'\\N','']){const original=row({condition_notes:text}),result=format([original]);expect(decodeLeadVehicleCsv(result.csv,result.escapeMap)).toEqual([original]);const escapes=JSON.parse(result.escapeMap).escapes;expect(escapes.length).toBe(['\\N',''].includes(text)?0:1);}
});
it('pins deterministic byte counts/hashes and honest empty/source-only output',()=>{
 const a=format([row()]);expect(format([row()])).toEqual(a);const parts:Record<string,string>={'lead_vehicles.csv':a.csv,'lead_vehicles_escape_map.json':a.escapeMap,'lead_vehicles_dictionary.json':a.dictionary};
 for(const part of JSON.parse(a.manifest).parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
 expect(JSON.parse(a.manifest)).toMatchObject({scope:'lead_vehicle_intake',rowCount:'1',completeCrestExport:false,completeBackup:false});expect(readCustomerCsv(format([]).csv)).toEqual([[...leadVehicleColumns]]);expect(JSON.parse(format([]).manifest).rowCount).toBe('0');
});
it('rejects missing/duplicate/foreign/malformed collections instead of silently omitting source rows',()=>{
 const input={businessId:business,snapshotToken:token,expectedRowCount:'1',rows:[row()]};for(const patch of [{expectedRowCount:'0'},{expectedRowCount:'01'},{expectedRowCount:'1001'},{expectedRowCount:1},{snapshotToken:'bad'},{businessId:row().id},{expectedRowCount:'2',rows:[row(),row()]},{rows:[{...row(),reported_vehicle:{...row().reported_vehicle,schemaVersion:2}}]}])expect(()=>formatLeadVehicleCsv({...input,...patch} as never)).toThrow('CUSTOMER_DATA_INVALID');
});
it('bounds output at8MiB without truncating large original Unicode reports',()=>{
 const rows=Array.from({length:220},(_,i)=>row({id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0'),reported_vehicle:{...row().reported_vehicle,notes:'😀'.repeat(2000)},requested_services:{schemaVersion:1,text:'😀'.repeat(4000)},condition_notes:'😀'.repeat(4000)}));expect(()=>format(rows)).toThrow('CUSTOMER_DATA_INVALID');
});
