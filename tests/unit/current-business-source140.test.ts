import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {captureCurrentBusinessRows140} from '../../src/security/current-business-source.ts';
import {currentBusinessSourceInventory140,currentBusinessSourceInventory,currentBusinessBindingMatches} from '../../src/security/current-business-source-inventory.ts';
import {formatCurrentBusinessCsv,readCurrentBusinessCsv} from '../../src/security/current-business-source-csv.ts';
import {formatCurrentBusinessWorkbook} from '../../src/security/current-business-source-workbook.ts';
import {formatCurrentBusinessReimport} from '../../src/security/current-business-source-reimport.ts';
const businessId='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const stamp='2026-11-25T12:00:00.123456Z',token='a'.repeat(64),binding={appReleaseId:'a'.repeat(40),sourceSchemaVersion:140 as const};
function page(source:string){const descriptor=currentBusinessSourceInventory140.find(item=>item.source===source)!;return {schemaVersion:1,businessId,source,snapshotToken:token,observedAt:stamp,columns:descriptor.columns,types:Object.fromEntries(descriptor.columns.map(column=>[column,'text'])),primaryKey:[descriptor.columns.includes('id')?'id':descriptor.columns[0]!],rows:[] as Record<string,string|null>[],nextCursor:null};}
async function capture(){return captureCurrentBusinessRows140(businessId,async(sql,args)=>{
 expect(sql).toContain('business_source_page_v2');const output=page(args[1] as string);
 if(output.source==='crest.opening_funds_origins')output.rows=[Object.fromEntries(output.columns.map(column=>[column,column==='id'?id:column==='business_id'?businessId:column==='external_id'?'=legacy,"receipt"\r\n\\N':null]))];
 if(output.source==='crest.opening_funds_schedule_revisions')output.rows=[Object.fromEntries(output.columns.map(column=>[column,column==='id'?id:column==='business_id'?businessId:column==='revision'?'9007199254740993':null]))];
 return [{page:output}];
},()=>{});}
it('uses the separate snapshot reader and retains every added source column without credential expansion',async()=>{
 const result=await capture();expect(result.profile).toBe('crest.current-business-rows.v2');expect(result.sources).toHaveLength(currentBusinessSourceInventory.length+3);expect(result.recordCount).toBe(2);
 expect(result.sources.filter(row=>row.source.startsWith('crest.opening_funds_')).map(row=>row.source)).toEqual(['crest.opening_funds_origins','crest.opening_funds_items','crest.opening_funds_schedule_revisions']);
});
it('keeps new CSV cells exact and includes them in the useful workbook and neutral SQL',async()=>{
 const result=await capture(),csv=formatCurrentBusinessCsv(result);
 // File names remain literal even when receipt references contain spreadsheet syntax.
 const source=result.sources.find(row=>row.source==='crest.opening_funds_origins')!,name='crest_opening_funds_origins.csv';
 const map=JSON.parse(Buffer.from(csv.files['current_business_escape_map.json']!).toString());
 expect(readCurrentBusinessCsv(Buffer.from(csv.files[name]!).toString(),source.columns,map[name])).toEqual(source.rows);
 const workbook=formatCurrentBusinessWorkbook(result,binding);expect(workbook.sheets).toHaveLength(currentBusinessSourceInventory140.length+3);
 const sql=formatCurrentBusinessReimport(result,binding).toString();expect(sql).toContain('"crest_opening_funds_schedule_revisions"');expect(sql).toContain("E'9007199254740993'");
});
it.each(['business','snapshot','columns'])('refuses mismatched new-source %s instead of omitting that source',async fault=>{
 await expect(captureCurrentBusinessRows140(businessId,async(_sql,args)=>{
  const output=page(args[1] as string);if(output.source==='crest.opening_funds_origins'){
   if(fault==='business')output.businessId=id;if(fault==='snapshot')output.snapshotToken='b'.repeat(64);if(fault==='columns')output.columns=[];
  }return [{page:output}];
 },()=>{})).rejects.toThrow('CURRENT_BUSINESS_SOURCE_REVIEW_REQUIRED');
});
it('requires the extended reader profile for140 and retains the fixed historical pairings',async()=>{
 expect(currentBusinessBindingMatches('crest.current-business-rows.v1',138)).toBe(true);expect(currentBusinessBindingMatches('crest.current-business-rows.v1',140)).toBe(false);
 expect(currentBusinessBindingMatches('crest.current-business-rows.v2',140)).toBe(true);expect(currentBusinessBindingMatches('crest.current-business-rows.v2',139)).toBe(false);expect(currentBusinessBindingMatches('crest.current-business-rows.v2',141)).toBe(false);
 const result=await capture();expect(()=>formatCurrentBusinessReimport(result,{...binding,sourceSchemaVersion:138})).toThrow();
 expect(()=>formatCurrentBusinessReimport({...result,sources:result.sources.slice(0,-1)},binding)).toThrow();
});
