import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatLeadAddressCsv} from '../../src/customer/lead-address-csv.ts';
import {leadAddressColumns} from '../../src/customer/lead-address-contract.ts';
import type {LeadAddress} from '../../src/customer/lead-address-contract.ts';
import {leadAddressFixture as row,leadAddressBusiness as business,decodeLeadAddressCsv} from '../support/lead-address-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const token='a'.repeat(64),format=(rows:LeadAddress[])=>formatLeadAddressCsv({businessId:business,snapshotToken:token,expectedRowCount:String(rows.length),rows});
it('round-trips all26 fields through an independent decoder with exact coordinates and original free text',()=>{
 const original=row({line1:'  É 😀 ", unit 1  ',exact_location_text:'Behind the barn\r\n\\N',instructions:'\t=SUM(A1)\nOriginal "\\N"',latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000',verified_at:'2026-10-25T01:02:03.000001Z',version:'9007199254740993'}),result=format([original]);
 expect(readCustomerCsv(result.csv)[0]).toEqual([...leadAddressColumns]);expect(decodeLeadAddressCsv(result.csv,result.escapeMap)).toEqual([original]);
 expect(JSON.parse(result.escapeMap).escapes).toContainEqual({row_id:original.id,column:'latitude',apostrophe_prefix:true});
 expect(JSON.parse(result.dictionary).scalarTypes.latitude).toContain('exact decimal');
});
it('distinguishes null, empty, literal sentinels, formula-leading strings and original apostrophes',()=>{
 for(const text of [null,'','\\N',"'original\\N",'=1',' +1','\t-1','\n@SUM(A1)']){const original=row({instructions:text}),result=format([original]);expect(decodeLeadAddressCsv(result.csv,result.escapeMap)).toEqual([original]);}
});
it('sorts deterministically, declares partial coverage and binds original byte counts/hashes',()=>{
 const rows=[row(),row({id:business,archived_at:row().created_at,archived_reason:'Retained'})],result=format(rows);
 expect(format([...rows].reverse())).toEqual(result);expect(decodeLeadAddressCsv(result.csv,result.escapeMap)).toEqual([...rows].sort((a,b)=>a.id.localeCompare(b.id)));
 const parts:Record<string,string>={'lead_addresses.csv':result.csv,'lead_addresses_escape_map.json':result.escapeMap,'lead_addresses_dictionary.json':result.dictionary};
 for(const part of JSON.parse(result.manifest).parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
 expect(JSON.parse(result.manifest)).toMatchObject({scope:'lead_address_intake',rowCount:'2',completeCrestExport:false,completeBackup:false});
 expect(readCustomerCsv(format([]).csv)).toEqual([[...leadAddressColumns]]);
});
it('rejects duplicate, incomplete, foreign and malformed collections instead of omitting records',()=>{
 const input={businessId:business,snapshotToken:token,expectedRowCount:'1',rows:[row()]};
 for(const patch of [{expectedRowCount:'0'},{expectedRowCount:'01'},{expectedRowCount:'1001'},{expectedRowCount:1},{snapshotToken:'bad'},{businessId:row().id},{expectedRowCount:'2',rows:[row(),row()]},{rows:[{...row(),latitude:'0',longitude:null}]}])expect(()=>formatLeadAddressCsv({...input,...patch} as never)).toThrow();
});
it('rejects oversized output without returning a truncated subset',()=>{
 const rows=Array.from({length:600},(_,i)=>row({id:'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0'),exact_location_text:'😀'.repeat(2000),instructions:'😀'.repeat(2000)}));expect(()=>format(rows)).toThrow();
});
