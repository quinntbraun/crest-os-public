import 'server-only';
import {zipSync,strToU8} from 'fflate';
import type {CurrentBusinessRows,CurrentBusinessSourceBinding} from './current-business-source.ts';
import {currentBusinessSourceInventory} from './current-business-source-inventory.ts';
import {isDeepStrictEqual} from 'node:util';

type Sheet=Readonly<{name:string;rows:readonly (readonly (string|null)[])[]}>;
type Sidecar=Readonly<{sheet:string;cell:string;csv:string;csvDataRow:number;column:string;characters:number}>;
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRelationships='http://schemas.openxmlformats.org/package/2006/relationships';
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function xml(value:string){
 const literal=value.replace(/_x[0-9a-f]{4}_/gi,match=>'_x005F_'+match.slice(1));
 return Array.from(literal,char=>{const code=char.charCodeAt(0);return code<=8||code===11||code===12||code>=14&&code<=31||code===65534||code===65535?'_x'+code.toString(16).padStart(4,'0').toUpperCase()+'_':char;}).join('').replace(/[&<>"\r]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\r':'&#13;'}[char]!));
}
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_WORKBOOK_REVIEW_REQUIRED');}
export function workbookColumn(index:number){
 require(Number.isSafeInteger(index)&&index>=0&&index<16384);let value=index+1,result='';while(value){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26);}return result;
}
export function formatCurrentBusinessWorkbook(capture:CurrentBusinessRows,binding:CurrentBusinessSourceBinding){
 require(binding&&typeof binding.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&[133,134,135].includes(binding.sourceSchemaVersion));
 require(capture.schemaVersion===1&&capture.profile==='crest.current-business-rows.v1'&&capture.sources.length===currentBusinessSourceInventory.length);
 const sidecars:Sidecar[]=[],schemaRows:string[][]=[['Source','Column','PostgreSQL type','Primary key','CSV file']],coverageRows:string[][]=[['Source','Data rows','Workbook sheet','Coverage']];
 const dataSheets:Sheet[]=capture.sources.map((source,index)=>{
  const expected=currentBusinessSourceInventory[index]!;require(source.source===expected.source&&isDeepStrictEqual(source.columns,expected.columns));
  const name=(String(index+1).padStart(3,'0')+' '+source.source.split('.')[1]!.replaceAll('_',' ')).slice(0,31),csv=source.source.replace('.','_')+'.csv';
  coverageRows.push([source.source,String(source.rows.length),name,'Business-scoped required columns']);
  for(const column of source.columns)schemaRows.push([source.source,column,source.types[column]!,source.primaryKey.includes(column)?'Yes':'',csv]);
  const rows:(readonly (string|null)[])[]=[source.columns];
  for(const [rowIndex,row]of source.rows.entries())rows.push(source.columns.map((column,columnIndex)=>{
   const value=row[column];require(value===null||typeof value==='string');if(value===null)return null;
   if(value.length<=32767)return value;
   sidecars.push({sheet:name,cell:workbookColumn(columnIndex)+(rowIndex+2),csv,csvDataRow:rowIndex+1,column,characters:value.length});
   return 'Full value in '+csv+'; data row '+(rowIndex+1)+', column '+column+'. See workbook_coverage.json.';
  }));
  return {name,rows};
 });
 const sheets:Sheet[]=[{name:'Read Me',rows:[['Crest OS — business source records',''],['Business',capture.businessId],['App release',binding.appReleaseId],['Source schema',String(binding.sourceSchemaVersion)],['Captured at (UTC)',capture.observedAt],['Snapshot',capture.snapshotToken],['Records',String(capture.recordCount)],['How to use','Use Coverage to locate a source sheet. Headers are frozen and filters are enabled.'],['Exact values','All cells are text. IDs, decimal values and cents retain exact precision.'],['Null and empty','Absent cells are null. An explicit empty text cell is an empty string.'],['Large text','Values exceeding Excel’s cell limit are linked to the matching CSV instead of truncated.'],['Scope','Business-scoped required columns only. See source manifest for remaining components.'],['Recovery','This workbook is an inspection/migration component. It is not a system backup.']]},{name:'Coverage',rows:coverageRows},{name:'Schema',rows:schemaRows},...dataSheets];
 require(new Set(sheets.map(sheet=>sheet.name.toLowerCase())).size===sheets.length);
 const parts:Record<string,Uint8Array>={};let uncompressed=0;
 function add(name:string,body:string){const bytes=strToU8(declaration+body);uncompressed+=bytes.length;require(uncompressed<=134217728);parts[name]=bytes;}
 const relation=(id:number,type:string,target:string)=>'<Relationship Id="rId'+id+'" Type="'+relationships+'/'+type+'" Target="'+target+'"/>';
 add('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,index)=>'<Override PartName="/xl/worksheets/sheet'+(index+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>');
 add('_rels/.rels','<Relationships xmlns="'+packageRelationships+'">'+relation(1,'officeDocument','xl/workbook.xml')+'</Relationships>');
 add('xl/workbook.xml','<workbook xmlns="'+ns+'" xmlns:r="'+relationships+'"><bookViews><workbookView/></bookViews><sheets>'+sheets.map((sheet,index)=>'<sheet name="'+xml(sheet.name)+'" sheetId="'+(index+1)+'" r:id="rId'+(index+1)+'"/>').join('')+'</sheets></workbook>');
 add('xl/_rels/workbook.xml.rels','<Relationships xmlns="'+packageRelationships+'">'+sheets.map((_,index)=>relation(index+1,'worksheet','worksheets/sheet'+(index+1)+'.xml')).join('')+relation(sheets.length+1,'styles','styles.xml')+'</Relationships>');
 add('xl/styles.xml','<styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Aptos"/><color rgb="FF172B37"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF163B46"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
 sheets.forEach((sheet,index)=>{
  require(sheet.rows.length<=1000001);const width=sheet.rows.reduce((maximum,row)=>Math.max(maximum,row.length),0);require(width>0&&width<=16384);
  const rows=sheet.rows.map((row,rowIndex)=>'<row r="'+(rowIndex+1)+'"'+(rowIndex===0?' ht="25" customHeight="1"':'')+'>'+row.map((value,columnIndex)=>value===null?'':'<c r="'+workbookColumn(columnIndex)+(rowIndex+1)+'" t="inlineStr" s="'+(rowIndex===0?1:0)+'"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>').join('')+'</row>').join('');
  add('xl/worksheets/sheet'+(index+1)+'.xml','<worksheet xmlns="'+ns+'"><sheetPr><tabColor rgb="FF247C80"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols><col min="1" max="'+width+'" width="28" customWidth="1"/></cols><sheetData>'+rows+'</sheetData>'+(index===0?'':'<autoFilter ref="A1:'+workbookColumn(width-1)+sheet.rows.length+'"/>')+'</worksheet>');
 });
 const bytes=zipSync(parts,{level:6,mtime:new Date('2000-01-01T00:00:00Z')});require(bytes.length<=33554432);
 return Object.freeze({bytes,sheets:Object.freeze(sheets.map(sheet=>sheet.name)),sidecarReferences:Object.freeze(sidecars)});
}
