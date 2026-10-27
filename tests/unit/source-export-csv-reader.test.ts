import {expect,it} from 'vitest';
import {readSourceExportCsv,readLogicalSourceExportCsv} from '../../src/security/source-export-csv-reader.ts';
const id='00000000-0000-4000-8000-000000000001',columns=['id','label','active','year','request'],schema={columns,booleans:['active'],integers:['year'],json:['request'],maxRows:1};
const header='"id","label","active","year","request"\r\n',row='"'+id+'","Original","false","2026","{""version"":""9007199254740993""}"\r\n';
const error='SOURCE_EXPORT_CSV_REVIEW_REQUIRED';
it('independently decodes quoted CRLF CSV with fixed scalar types and exact nested decimal strings',()=>{
 const rows=readSourceExportCsv(header+row,[],schema);expect(rows).toEqual([{id,label:'Original',active:false,year:2026,request:{version:'9007199254740993'}}]);expect(Object.isFrozen(rows)).toBe(true);expect(Object.isFrozen(rows[0])).toBe(true);
});
it('accepts a header-only zero-row file and keeps null distinct from literal backslash N',()=>{
 expect(readSourceExportCsv(header,[],{...schema,maxRows:0})).toEqual([]);
 const original=header+row.replace('"Original"','"\\N"');expect(readSourceExportCsv(original,[],schema)[0]!.label).toBeNull();
 expect(readSourceExportCsv(header+row.replace('"Original"','"\\\\N"'),[],schema)[0]!.label).toBe('\\N');
});
it.each(["'Original",'=SUM(A1)',' +1','\t-1','\n@SUM(A1)','\ufeff=1'])('requires and reverses exactly one declared formula/literal prefix for %j',value=>{
 const encoded="'"+value,flags=[{row_id:id,column:'label',apostrophe_prefix:true}];
 const csv=header+row.replace('"Original"','"'+encoded+'"');expect(readSourceExportCsv(csv,flags,schema)[0]!.label).toBe(value);expect(()=>readSourceExportCsv(csv,[],schema)).toThrow(error);
});
it('preserves embedded quotes, commas, Unicode, CRLF and paired backslashes',()=>{
 const csv=header+row.replace('"Original"','"雪, ""é 😀""\r\n\\\\N"');expect(readSourceExportCsv(csv,[],schema)[0]!.label).toBe('雪, "é 😀"\r\n\\N');
});
it.each(['unquoted','bare LF','missing CRLF','after quote','trailing comma','extra cell','missing cell','wrong header','duplicate header','unterminated','odd backslash','NUL','surrogate','bad boolean','integer decimal','integer leading zero','integer exponent','rounded JSON','duplicate JSON key','scalar JSON','too many rows','duplicate ID','reversed ID'])('rejects %s instead of guessing CSV data or types',issue=>{
 let csv=header+row;let limit=1;
 if(issue==='unquoted')csv=csv.replace('"Original"','Original');if(issue==='bare LF')csv=csv.replaceAll('\r\n','\n');if(issue==='missing CRLF')csv=csv.slice(0,-2);if(issue==='after quote')csv=csv.replace('"Original",','"Original"x,');if(issue==='trailing comma')csv=csv.slice(0,-2)+',\r\n';
 if(issue==='extra cell')csv=csv.slice(0,-2)+',"extra"\r\n';if(issue==='missing cell')csv=header+row.slice(0,row.indexOf(',"{"'))+'\r\n';if(issue==='wrong header')csv=csv.replace('"label"','"wrong"');if(issue==='duplicate header')csv=csv.replace('"label"','"id"');if(issue==='unterminated')csv=csv.slice(0,-3);
 if(issue==='odd backslash')csv=csv.replace('"Original"','"odd\\slash"');if(issue==='NUL')csv=csv.replace('Original','bad\0');if(issue==='surrogate')csv=csv.replace('Original','\ud800');if(issue==='bad boolean')csv=csv.replace('"false"','"False"');
 if(issue==='integer decimal')csv=csv.replace('"2026"','"2026.0"');if(issue==='integer leading zero')csv=csv.replace('"2026"','"02026"');if(issue==='integer exponent')csv=csv.replace('"2026"','"2.026e3"');
 if(issue==='rounded JSON')csv=csv.replace('""9007199254740993""','9007199254740993');if(issue==='duplicate JSON key')csv=csv.replace('""version"":','""version"":""1"",""version"":');if(issue==='scalar JSON')csv=csv.replace('"{""version"":""9007199254740993""}"','"1"');
 if(issue==='too many rows')csv+=row.replace(id,'00000000-0000-4000-8000-000000000002');
 if(issue==='duplicate ID'){csv+=row;limit=2;}if(issue==='reversed ID'){csv=header+row.replace(id,'00000000-0000-4000-8000-000000000002')+row;limit=2;}
 expect(()=>readSourceExportCsv(csv,[],{...schema,maxRows:limit})).toThrow(error);
});
it.each(['missing prefix','unnecessary','unused row','unknown column','duplicate','false flag','extra field','boolean flag','JSON flag','null flag'])('rejects %s escape-map evidence',issue=>{
 let csv=header+row;const flag={row_id:id,column:'label',apostrophe_prefix:true},flags:Record<string,unknown>[]=[flag];
 if(issue==='missing prefix')csv=csv.replace('Original','=1');if(issue==='unnecessary')csv=csv.replace('Original',"'Original");if(issue==='unused row')flag.row_id='00000000-0000-4000-8000-000000000002';if(issue==='unknown column')flag.column='secret';if(issue==='duplicate')flags.push({...flag});if(issue==='false flag')Object.assign(flag,{apostrophe_prefix:false});if(issue==='extra field')Object.assign(flag,{extra:'x'});if(issue==='boolean flag')flag.column='active';if(issue==='JSON flag')flag.column='request';if(issue==='null flag')csv=csv.replace('"Original"','"\\N"');
 expect(()=>readSourceExportCsv(csv,flags,schema)).toThrow(error);
});
const compositeColumns=['generation_id','part_id','request_text'],compositeSchema={columns:compositeColumns,keyColumns:['generation_id','part_id'],maxRows:2},part='00000000-0000-4000-8000-000000000002',compositeHeader='"generation_id","part_id","request_text"\r\n',compositeRow='"'+id+'","'+part+'","\' =SUM(A1)"\r\n';
it('independently decodes generation/part keys and exact formula-prefix flags without inventing a source id column',()=>{
 expect(readLogicalSourceExportCsv(compositeHeader+compositeRow,[{row_id:id+':'+part,column:'request_text',apostrophe_prefix:true}],compositeSchema)).toEqual([{generation_id:id,part_id:part,request_text:' =SUM(A1)'}]);
});
it.each(['missing-key','duplicate-key-column','too-many-keys','wrong-flag-key','duplicate-row','reversed-row','null-key','non-uuid-key'])('logical CSV rejects %s',issue=>{
 let csv=compositeHeader+compositeRow;const s={...compositeSchema,keyColumns:[...compositeSchema.keyColumns]},flags=[{row_id:id+':'+part,column:'request_text',apostrophe_prefix:true}];
 if(issue==='missing-key')s.keyColumns=['absent'];if(issue==='duplicate-key-column')s.keyColumns=['generation_id','generation_id'];if(issue==='too-many-keys')s.keyColumns=['generation_id','part_id','request_text'];if(issue==='wrong-flag-key')flags[0]!.row_id=part;
 if(issue==='duplicate-row')csv+=compositeRow;if(issue==='reversed-row')csv=compositeHeader+compositeRow.replace(part,'ffffffff-ffff-4fff-8fff-ffffffffffff')+compositeRow;if(issue==='null-key')csv=csv.replace('"'+part+'"','"\\N"');if(issue==='non-uuid-key')csv=csv.replace(part,'invalid');
 expect(()=>readLogicalSourceExportCsv(csv,flags,s)).toThrow(error);
});
it('keeps the existing reader at8MiB while the explicit logical reader accepts a larger exact text field',()=>{
 const text='x'.repeat(8388608),csv=compositeHeader+'"'+id+'","'+part+'","'+text+'"\r\n';expect(()=>readSourceExportCsv(csv,[],{columns:['id'],maxRows:1})).toThrow(error);expect(readLogicalSourceExportCsv(csv,[],compositeSchema)[0]!.request_text).toBe(text);
});
