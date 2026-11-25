import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {formatCurrentBusinessCsv,readCurrentBusinessCsv} from '../../src/security/current-business-source-csv';
import {currentBusinessSourceInventory} from '../../src/security/current-business-source-inventory';
import type {CurrentBusinessRows} from '../../src/security/current-business-source';
it('keeps composite source columns, exact cents, null, quoted newlines and formula text reversible',()=>{
 const sources=currentBusinessSourceInventory.map(source=>({...source,primaryKey:['id'],types:Object.fromEntries(source.columns.map(column=>[column,'text'])),rows:[]}));
 const capture={schemaVersion:1,profile:'crest.current-business-rows.v1',businessId:'11111111-1111-4111-8111-111111111111',snapshotToken:'a'.repeat(64),observedAt:'2026-11-22T20:00:00.000000Z',sources,recordCount:0,completePortableExport:false,completeBackup:false} as CurrentBusinessRows;
 const bundle=formatCurrentBusinessCsv(capture),manifest=JSON.parse(bundle.manifest);
 expect(manifest.files).toHaveLength(currentBusinessSourceInventory.length+2);expect(manifest.completePortableExport).toBe(false);
 const columns=['business_id','sequence','value'],csv='"business_id","sequence","value"\r\n"exact","9007199254740993","\' =SUM(1,2)"\r\n"exact","2","\\N"\r\n"exact","3","\\\\N"\r\n"exact","4","line\r\n""two"""\r\n';
 expect(readCurrentBusinessCsv(csv,columns,[{row:1,column:'value'}])).toEqual([
  {business_id:'exact',sequence:'9007199254740993',value:' =SUM(1,2)'},{business_id:'exact',sequence:'2',value:null},{business_id:'exact',sequence:'3',value:'\\N'},{business_id:'exact',sequence:'4',value:'line\r\n"two"'}]);
 expect(()=>readCurrentBusinessCsv(csv,columns,[])).toThrow('CURRENT_BUSINESS_CSV_REVIEW_REQUIRED');
 expect(()=>readCurrentBusinessCsv(csv,columns,[{row:1,column:'value'},{row:1,column:'value'}])).toThrow('CURRENT_BUSINESS_CSV_REVIEW_REQUIRED');
 expect(()=>readCurrentBusinessCsv(csv.slice(0,-2),columns,[{row:1,column:'value'}])).toThrow('CURRENT_BUSINESS_CSV_REVIEW_REQUIRED');
});
