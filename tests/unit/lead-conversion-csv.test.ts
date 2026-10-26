import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {formatLeadConversionCsv} from '../../src/customer/lead-conversion-csv.ts';
import {leadConversionColumns,conversionLinkColumns} from '../../src/customer/lead-conversion-record.ts';
import {conversionRecordFixture as row,conversionLinkFixture as link,conversionBusiness as business,decodeLeadConversionCsv} from '../support/lead-conversion-record-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
const token='a'.repeat(64);
const input=()=>({businessId:business,snapshotToken:token,expectedConversionCount:'1',expectedLinkCount:'2',conversions:[row()],links:[link(),link('address')]});
it('round-trips all43 columns and versioned JSON without inventing source or audit data',()=>{
 const result=formatLeadConversionCsv(input());expect(readCustomerCsv(result.conversions.csv)[0]).toEqual([...leadConversionColumns]);expect(readCustomerCsv(result.links.csv)[0]).toEqual([...conversionLinkColumns]);expect(decodeLeadConversionCsv(result)).toEqual({conversions:[row()],links:[link(),link('address')]});
 expect(JSON.parse(result.manifest)).toMatchObject({scope:'lead_conversion',conversionCount:'1',linkCount:'2',completeCrestExport:false,completeBackup:false});
 expect(JSON.parse(result.conversions.dictionary).scalarTypes.request).toContain('complete schema1 JSON');
});
it('preserves nested raw formula text, Unicode, newlines, literal sentinels, exact decimals and null/empty distinctions',()=>{
 for(const text of [null,'','\\N',"'Original\\N",'=SUM(A1)',' +1','\t-1','\n@SUM(A1)','  É 😀 ",\r\n\\N  ']){
  const p=row({customer_child_operation_id:business,request:{...row().request,customer:{kind:'new',id:row().customer_id,draft:{displayName:'Explicit owner choice',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:text,customerSince:null,archived:false,archiveReason:null}},vehicles:[],addresses:[{...row().request.addresses[0]!,target:{kind:'new',id:link('address').address_id!,draft:{line1:'',line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:text,instructions:null,latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000',geocodeSource:null,geocodeAccuracy:null,verifiedAt:'2026-10-25T01:02:03.000001Z',archived:false,archiveReason:null}}}]}});
  const child=link('address',{target_child_operation_id:business});const result=formatLeadConversionCsv({...input(),expectedLinkCount:'1',conversions:[p],links:[child]});expect(decodeLeadConversionCsv(result)).toEqual({conversions:[p],links:[child]});
 }
});
it('binds every component byte/hash, sorts deterministically and supports empty snapshots',()=>{
 const result=formatLeadConversionCsv(input());expect(formatLeadConversionCsv({...input(),links:[...input().links].reverse()})).toEqual(result);
 const parts:Record<string,string>={'lead_conversions.csv':result.conversions.csv,'lead_conversions_escape_map.json':result.conversions.escapeMap,'lead_conversions_dictionary.json':result.conversions.dictionary,'conversion_links.csv':result.links.csv,'conversion_links_escape_map.json':result.links.escapeMap,'conversion_links_dictionary.json':result.links.dictionary};
 for(const part of JSON.parse(result.manifest).parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
 const empty=formatLeadConversionCsv({...input(),expectedConversionCount:'0',expectedLinkCount:'0',conversions:[],links:[]});expect(decodeLeadConversionCsv(empty)).toEqual({conversions:[],links:[]});
});
it('rejects foreign, duplicate, incomplete or falsely counted collections without returning partial output',()=>{
 for(const patch of [{businessId:row().id},{snapshotToken:'wrong'},{expectedConversionCount:1},{expectedConversionCount:'01'},{expectedLinkCount:'1'},{expectedLinkCount:'1001'},{links:[link()]},{conversions:[]},{conversions:[{...row(),extra:'not in schema'}]},{links:[link(),link()]}])expect(()=>formatLeadConversionCsv({...input(),...patch} as never)).toThrow();
});
