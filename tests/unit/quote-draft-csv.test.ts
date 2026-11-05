import {randomUUID,createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {formatQuoteDraftCsv,QuoteDraftCsvError} from '../../src/commercial/quote-draft-csv.ts';
import {quoteFixture} from '../support/quote-fixture';
import {prepareQuoteContent} from '../../src/commercial/quote-content';
import type {QuoteContentInput} from '../../src/commercial/quote-content';
import {readCustomerCsv} from '../support/customer-fixture';
const f=quoteFixture(),snapshotToken='a'.repeat(64),ordered=<T extends {id:string}>(rows:readonly T[])=>[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
function input(content:QuoteContentInput=f.input){
 const prepared=prepareQuoteContent(content),revision={...f.revision,customer_safe_snapshot:prepared.customer,internal_snapshot:prepared.internal,canonical_content:prepared.canonical,content_hash:createHash('sha256').update(prepared.canonical).digest('hex'),total_cents:prepared.customer.totalCents,expiry_at:prepared.customer.expiryAt,timezone:prepared.customer.timezone};
 const family={...f.family,customer_id:content.recipient.customerId,lead_id:content.recipient.leadId},items=prepared.customer.lines.map((row,index)=>{const source=prepared.internal.sources[index]!;return {...f.items[index]??f.items[0]!,id:f.items[index]?.id??randomUUID(),stable_line_key:source.stableLineKey,position:index+1,vehicle_id:source.vehicleId,job_wide:source.jobWide,service_version_id:source.serviceVersionId,gross_cents:row.grossCents,line_discount:row.lineDiscount,document_discount_eligible:row.documentDiscountEligible,line_discount_cents:row.lineDiscountCents,allocated_discount_cents:row.allocatedDiscountCents,final_cents:row.finalCents,complimentary_reason:row.complimentaryReason,customer_snapshot:row};});
 return {businessId:f.business,snapshotToken,expectedFamilyCount:'1',expectedRevisionCount:'1',expectedItemCount:String(items.length),families:[family],revisions:[revision],items};
}
function retained(){
 const source=input(),later=input({...f.input,title:'Later synthetic revision',internalNotes:'Later private assumption'}),operation=randomUUID(),revision={...later.revisions[0]!,id:randomUUID(),sequence:'2',operation_id:operation};
 const earlier={...source.revisions[0]!,version:'3',content_version:'3'},inactive={...source.items[0]!,id:randomUUID(),stable_line_key:randomUUID(),active:false,position:null,version:'2',customer_snapshot:{...source.items[0]!.customer_snapshot,description:'Removed earlier draft line'}};
 return {...source,expectedRevisionCount:'2',expectedItemCount:'5',families:[{...source.families[0]!,current_revision_id:revision.id,version:'4',operation_id:operation}],revisions:[revision,earlier],items:[...later.items.map(row=>({...row,id:randomUUID(),revision_id:revision.id,operation_id:operation})),inactive,...source.items]};
}
type Entity='quote_families'|'quote_revisions'|'quote_items';
// Independent RFC4180 reader and declared-type decoder. The formatter is never
// its own round-trip oracle; canonical_content remains source text throughout.
function decode(csv:string,files:ReturnType<typeof formatQuoteDraftCsv>,entity:Entity){
 const matrix=readCustomerCsv(csv),columns=matrix.shift()!,map=JSON.parse(files.escapeMap),dictionary=JSON.parse(files.dictionary),table=dictionary.tables[entity],slash=String.fromCharCode(92);
 return matrix.map(cells=>{const rowId=cells[columns.indexOf('id')]!;return Object.fromEntries(columns.map((column,index)=>{
  let value:unknown=cells[index]!;if(value===slash+'N'){expect(table.jsonColumns).not.toContain(column);return [column,null];}
  let text=value as string;if(map.escapes.some((escape:{entity:string;row_id:string;column:string})=>escape.entity===entity&&escape.row_id===rowId&&escape.column===column)){expect(text.startsWith("'")).toBe(true);text=text.slice(1);}text=text.replaceAll(slash+slash,slash);
  if(table.jsonColumns.includes(column))value=JSON.parse(text);
  else if(table.scalarTypes[column]==='boolean'){expect(['true','false']).toContain(text);value=text==='true';}
  else if(table.scalarTypes[column]==='nullable bounded integer'){expect(/^[1-9][0-9]{0,3}$/.test(text)).toBe(true);value=Number(text);expect(Number.isSafeInteger(value)).toBe(true);}
  else value=text;
  return [column,value];
 }));});
}
it('round trips every declared source column, retained revision and inactive line without changing inputs',()=>{
 const source=retained(),before=structuredClone(source),files=formatQuoteDraftCsv(source);
 expect(decode(files.familiesCsv,files,'quote_families')).toEqual(ordered(source.families));expect(decode(files.revisionsCsv,files,'quote_revisions')).toEqual(ordered(source.revisions));expect(decode(files.itemsCsv,files,'quote_items')).toEqual(ordered(source.items));expect(source).toEqual(before);expect(Object.isFrozen(files)).toBe(true);
 expect(JSON.parse(files.dictionary).privacy).toContain('Owner-only private');expect(JSON.parse(files.dictionary).privacy).toContain('Never customer-safe sharing');expect(files.revisionsCsv).not.toContain('[object Object]');
});
it.each([null,'\\N','\\\\N',"'original",'=1+2',' \t+SUM(1,2)','\n@function','-original','ordinary, "quoted"\r\n é 😀'])('preserves SQL null, raw reason %j, empty JSON text and formula-like private snapshots',reason=>{
 const source=input({...f.input,terms:'',internalNotes:'=PRIVATE internal formula-like text',lines:f.input.lines.map((row,index)=>({...row,exclusions:'',complimentaryReason:index===0?reason:null}))}),files=formatQuoteDraftCsv(source);
 expect(decode(files.itemsCsv,files,'quote_items')).toEqual(ordered(source.items));expect(decode(files.revisionsCsv,files,'quote_revisions')).toEqual(source.revisions);expect(files.itemsCsv.endsWith('\r\n')).toBe(true);const map=JSON.parse(files.escapeMap);expect(map.escapes.every((escape:{entity:string;column:string})=>escape.entity==='quote_items'&&escape.column==='complimentary_reason')).toBe(true);
 const matrix=readCustomerCsv(files.itemsCsv),columns=matrix.shift()!;for(const cells of matrix)expect(cells[columns.indexOf('line_discount')]).toBe('null');
});
it('retains exact large money/version strings, microseconds and chosen current pointers without numeric conversion',()=>{
 const source=input({...f.input,documentDiscount:null,expiryAt:'2026-10-29T21:00:00.123456Z',lines:[{...f.input.lines[0]!,grossCents:'9223372036854775807'}]});source.families[0]={...source.families[0]!,version:'9007199254740993'};source.revisions[0]={...source.revisions[0]!,version:'9007199254740993',content_version:'9007199254740993'};const files=formatQuoteDraftCsv(source);
 expect(decode(files.familiesCsv,files,'quote_families')).toEqual(source.families);expect(decode(files.revisionsCsv,files,'quote_revisions')).toEqual(source.revisions);expect(decode(files.itemsCsv,files,'quote_items')).toEqual(source.items);
 const retainedSource=retained(),earlier={...retainedSource,families:[{...retainedSource.families[0]!,current_revision_id:f.revision.id}]};expect(decode(formatQuoteDraftCsv(earlier).familiesCsv,formatQuoteDraftCsv(earlier),'quote_families')[0]!.current_revision_id).toBe(earlier.families[0]!.current_revision_id);
});
it('does not conflate equal UUIDs in different tables or infer spreadsheet prefix removal',()=>{
 const source=input({...f.input,lines:f.input.lines.map((row,index)=>({...row,complimentaryReason:index===0?"' =1+2 \\N":null}))}),shared=source.families[0]!.id;source.items[0]={...source.items[0]!,id:shared};const files=formatQuoteDraftCsv(source),map=JSON.parse(files.escapeMap);
 expect(map.escapes).toContainEqual({entity:'quote_items',row_id:shared,column:'complimentary_reason',apostrophe_prefix:true});expect(decode(files.familiesCsv,files,'quote_families')).toEqual(source.families);expect(decode(files.itemsCsv,files,'quote_items')).toEqual(ordered(source.items));
});
it('declares every part by actual UTF-8 length/hash and keeps all global/snapshot/backup assurances false',()=>{
 const files=formatQuoteDraftCsv(input()),manifest=JSON.parse(files.manifest),parts:Record<string,string>={'quote_families.csv':files.familiesCsv,'quote_revisions.csv':files.revisionsCsv,'quote_items.csv':files.itemsCsv,'quote_draft_escape_map.json':files.escapeMap,'quote_draft_dictionary.json':files.dictionary};
 expect(manifest).toMatchObject({businessId:f.business,snapshotToken,familyCount:'1',revisionCount:'1',itemCount:'2',assurance:'included_quote_consistency_only',snapshotProven:false,sourceCompletenessProven:false,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false});expect(manifest.parts).toHaveLength(5);
 for(const part of manifest.parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!,'utf8').digest('hex'));expect(part.bytes).toBeLessThanOrEqual(8*1024*1024);}expect(manifest.parts.reduce((sum:number,part:{bytes:number})=>sum+part.bytes,Buffer.byteLength(files.manifest))).toBeLessThanOrEqual(32*1024*1024);
 const dictionary=JSON.parse(files.dictionary);expect(dictionary.tables.quote_families.columns).toHaveLength(13);expect(dictionary.tables.quote_revisions.columns).toHaveLength(23);expect(dictionary.tables.quote_items.columns).toHaveLength(25);expect(dictionary.tables.quote_revisions.scalarTypes.canonical_content).toBe('exact UTF-8 text; do not reserialize');
});
it('represents an included empty quote dataset with three header-only files and no completeness claim',()=>{const files=formatQuoteDraftCsv({...input(),expectedFamilyCount:'0',expectedRevisionCount:'0',expectedItemCount:'0',families:[],revisions:[],items:[]});for(const csv of [files.familiesCsv,files.revisionsCsv,files.itemsCsv])expect(readCustomerCsv(csv)).toHaveLength(1);expect(JSON.parse(files.manifest).completeBackup).toBe(false);});
it.each(['bad','A'.repeat(64),'a'.repeat(64)+'\n','../private'])('rejects an invalid snapshot identity %j',snapshotToken=>{expect(()=>formatQuoteDraftCsv({...input(),snapshotToken})).toThrow(QuoteDraftCsvError);});
it.each(['01','1\n','-1','9223372036854775808',1])('rejects a noncanonical declared count %j',expectedFamilyCount=>{expect(()=>formatQuoteDraftCsv({...input(),expectedFamilyCount} as never)).toThrow(QuoteDraftCsvError);});
it('refuses declared omissions, sparse arrays, duplicates, foreign tenants and unknown source columns',()=>{
 const source=input();const corruptions=[{...source,expectedFamilyCount:'2'},{...source,expectedRevisionCount:'2'},{...source,expectedItemCount:'3'},{...source,families:Array(1)},{...source,revisions:Array(1)},{...source,items:Array(2)},{...source,expectedFamilyCount:'2',families:[source.families[0]!,source.families[0]!]},{...source,expectedRevisionCount:'2',revisions:[source.revisions[0]!,source.revisions[0]!]},{...source,items:[source.items[0]!,source.items[0]!]},{...source,families:[{...source.families[0]!,business_id:randomUUID()}]},{...source,revisions:[{...source.revisions[0]!,business_id:randomUUID()}]},{...source,items:[{...source.items[0]!,business_id:randomUUID()},source.items[1]!]},{...source,revisions:[{...source.revisions[0]!,unexpected:'future'}]}];
 for(const corrupted of corruptions)expect(()=>formatQuoteDraftCsv(corrupted)).toThrow(QuoteDraftCsvError);
});
it('refuses omitted parents/current revisions, sequence gaps and mismatched family parties',()=>{
 const source=retained();for(const corrupted of [{...source,families:[{...source.families[0]!,current_revision_id:randomUUID()}]},{...source,revisions:source.revisions.map((row,index)=>index===0?{...row,family_id:randomUUID()}:row)},{...source,revisions:source.revisions.map((row,index)=>index===0?{...row,sequence:'3'}:row)},{...source,families:[{...source.families[0]!,customer_id:randomUUID()}]},{...source,items:source.items.map((row,index)=>index===0?{...row,revision_id:randomUUID()}:row)}])expect(()=>formatQuoteDraftCsv(corrupted)).toThrow(QuoteDraftCsvError);
});
it('rejects real canonical-hash corruption and normalized line/source/allocation disagreement',()=>{
 const source=input();expect(()=>formatQuoteDraftCsv({...source,revisions:[{...source.revisions[0]!,content_hash:'0'.repeat(64)}]})).toThrow(QuoteDraftCsvError);
 for(const patch of [{active:false,position:null},{position:2},{stable_line_key:randomUUID()},{allocated_discount_cents:'1135',final_cents:'23865',customer_snapshot:{...source.items[0]!.customer_snapshot,allocatedDiscountCents:'1135',finalCents:'23865'}}])expect(()=>formatQuoteDraftCsv({...source,items:[{...source.items[0]!,...patch},source.items[1]!]})).toThrow(QuoteDraftCsvError);
 const missing=retained();expect(()=>formatQuoteDraftCsv({...missing,items:missing.items.filter(row=>row.active)})).toThrow(QuoteDraftCsvError);
});
it('rejects an oversized part atomically instead of dropping a large quoted scope',()=>{
 const content={...f.input,documentDiscount:null,lines:Array.from({length:140},()=>({...f.input.lines[0]!,id:randomUUID(),inclusions:'😀'.repeat(8000)}))},source=input(content);expect(()=>formatQuoteDraftCsv(source)).toThrow(QuoteDraftCsvError);expect(source.items).toHaveLength(140);
});
