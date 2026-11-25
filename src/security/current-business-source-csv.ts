import 'server-only';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {currentBusinessInventoryForProfile} from './current-business-source-inventory.ts';
import type {CurrentBusinessRows} from './current-business-source.ts';

type Escape=Readonly<{row:number;column:string}>;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const formula=(value:string)=>value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'');
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_CSV_REVIEW_REQUIRED');}
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const currentSourceCsvScalarFormat='Exact PostgreSQL text; UTC ISO instants; quoted \\N null; escaped paired backslashes; remove only escape-map marked apostrophes before unescaping.';

// Independent decoder for this versioned all-text profile. Row ordinals avoid
// inventing a UUID id for a source with a composite or non-UUID primary key.
export function readCurrentBusinessCsv(csv:string,columns:readonly string[],escapes:readonly Escape[]){
 require(Buffer.byteLength(csv)<=33554432&&Buffer.from(csv).toString('utf8')===csv&&!csv.includes('\0')&&columns.length>0&&columns.length<=100&&new Set(columns).size===columns.length);
 const flags=new Set<string>();for(const flag of escapes){require(Object.keys(flag).sort().join(',')==='column,row'&&Number.isSafeInteger(flag.row)&&flag.row>=1&&columns.includes(flag.column));const key=flag.row+':'+flag.column;require(!flags.has(key));flags.add(key);}
 const matrix:string[][]=[];let at=0;
 while(at<csv.length){
  const cells:string[]=[];
  for(;;){
   require(csv[at++]==='"');let value='',closed=false;
   while(at<csv.length){const char=csv[at++]!;if(char!=='"'){value+=char;continue;}if(csv[at]==='"'){value+='"';at++;continue;}closed=true;break;}
   require(closed);cells.push(value);require(cells.length<=columns.length);
   if(csv[at]===','){at++;continue;}require(csv[at++]==='\r'&&csv[at++]==='\n');break;
  }
  require(cells.length===columns.length&&matrix.length<=100000);matrix.push(cells);
 }
 require(matrix.length>0&&isDeepStrictEqual(matrix.shift(),columns));const used=new Set<string>();
 const rows=matrix.map((cells,index)=>Object.fromEntries(columns.map((column,columnIndex)=>{
  let value=cells[columnIndex]!;const key=(index+1)+':'+column,flag=flags.has(key);
  if(value==='\\N'){require(!flag);return [column,null];}
  if(flag){require(value.startsWith("'"));value=value.slice(1);used.add(key);}
  let decoded='';for(let offset=0;offset<value.length;offset++){const char=value[offset]!;if(char==='\\')require(value[++offset]==='\\');decoded+=char;}
  require(flag===formula(decoded));return [column,decoded];
 })));
 require(used.size===flags.size);return rows;
}

export function formatCurrentBusinessCsv(capture:CurrentBusinessRows){
 const inventory=currentBusinessInventoryForProfile(capture.profile);require(inventory);
 require(capture.schemaVersion===1&&(capture.profile==='crest.current-business-rows.v1'||capture.profile==='crest.current-business-rows.v2')&&capture.completePortableExport===false&&capture.completeBackup===false&&capture.sources.length===inventory.length);
 const files:Record<string,Uint8Array>={},dictionary:Record<string,unknown>={},escapeMap:Record<string,readonly Escape[]>={};let total=0,recordCount=0;
 for(const [index,source]of capture.sources.entries()){
  const expected=inventory[index]!;require(source.source===expected.source&&isDeepStrictEqual(source.columns,expected.columns));
  const name=source.source.replace('.','_')+'.csv',escapes:Escape[]=[],lines=[source.columns.map(quote).join(',')];
  for(const [rowIndex,row]of source.rows.entries())lines.push(source.columns.map(column=>{
   const original=row[column];require(original===null||typeof original==='string');if(original===null)return quote('\\N');
   let cell=original.replaceAll('\\','\\\\');if(formula(cell)){cell="'"+cell;escapes.push({row:rowIndex+1,column});}return quote(cell);
  }).join(','));
  const csv=lines.join('\r\n')+'\r\n';require(isDeepStrictEqual(readCurrentBusinessCsv(csv,source.columns,escapes),source.rows));
  files[name]=Buffer.from(csv);total+=files[name].byteLength;recordCount+=source.rows.length;require(total<=67108864);
  dictionary[name]={source:source.source,columns:source.columns,types:source.types,primaryKey:source.primaryKey,records:source.rows.length};escapeMap[name]=escapes;
 }
 require(recordCount===capture.recordCount);
 // Stable open-format names; no source table or cell can select a path.
 files['current_business_dictionary.json']=Buffer.from(JSON.stringify(dictionary)+'\n');
 files['current_business_escape_map.json']=Buffer.from(JSON.stringify(escapeMap)+'\n');
 const manifest=JSON.stringify({schemaVersion:1,profile:'crest.current-business-csv.v1',businessId:capture.businessId,snapshotToken:capture.snapshotToken,observedAt:capture.observedAt,recordCount,
  scope:'All fixed business-scoped required columns. Actor/global/security metadata and private original bytes require their separate components.',
  scalarFormat:currentSourceCsvScalarFormat,
  completePortableExport:false,completeBackup:false,files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:sha(bytes)}))})+'\n';
 require(Object.values(files).reduce((sum,file)=>sum+file.byteLength,Buffer.byteLength(manifest))<=67108864);
 return Object.freeze({manifest,files:Object.freeze(files)});
}
