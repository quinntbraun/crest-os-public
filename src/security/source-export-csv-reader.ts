import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';

type Schema=Readonly<{columns:readonly string[];booleans?:readonly string[];integers?:readonly string[];json?:readonly string[];maxRows:number}>;
export class SourceExportCsvError extends Error{constructor(){super('SOURCE_EXPORT_CSV_REVIEW_REQUIRED');this.name='SourceExportCsvError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportCsvError();}
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function pairedBackslashes(value:string){
 const pieces:string[]=[];let start=0;
 for(let at=0;at<value.length;at++)if(value[at]==='\\'){require(value[at+1]==='\\');pieces.push(value.slice(start,at),'\\');at++;start=at+1;}
 pieces.push(value.slice(start));return pieces.join('');
}
function formula(value:string){return value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'');}

// Independent profile reader: no CSV writer import, type inference from cell
// appearance or spreadsheet execution. Caller supplies a closed source schema.
export function readSourceExportCsv(csv:unknown,escapes:unknown,schema:Schema){
 return readCsv(csv,escapes,schema,['id'],8388608);
}
// Separate proposed logical-file profile. The existing physical CSV reader
// keeps its8MiB/UUID-id contract; journal logical files allow composite UUID keys.
export function readLogicalSourceExportCsv(csv:unknown,escapes:unknown,schema:Schema&Readonly<{keyColumns:readonly string[]}>){
 return readCsv(csv,escapes,schema,schema.keyColumns,33554432);
}
function readCsv(csv:unknown,escapes:unknown,schema:Schema,keyColumns:readonly string[],limit:number){
 try{
  require(typeof csv==='string'&&csv.length<=limit&&Buffer.byteLength(csv)<=limit&&!csv.includes('\0')&&Buffer.from(csv).toString()===csv);
  require(schema.columns.length>0&&schema.columns.length<=100&&new Set(schema.columns).size===schema.columns.length&&Array.isArray(keyColumns)&&keyColumns.length>=1&&keyColumns.length<=2&&new Set(keyColumns).size===keyColumns.length&&keyColumns.every(k=>schema.columns.includes(k))&&Number.isSafeInteger(schema.maxRows)&&schema.maxRows>=0&&schema.maxRows<=10000);
  const validKey=(value:string)=>value.split(':').length===keyColumns.length&&value.split(':').every(part=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(part));
  require(Array.isArray(escapes)&&escapes.length<=100000);
  const flags=new Map<string,{rowId:string;column:string}>();
  for(const e of escapes){
   require(object(e)&&Object.keys(e).length===3&&Object.hasOwn(e,'row_id')&&Object.hasOwn(e,'column')&&Object.hasOwn(e,'apostrophe_prefix')&&typeof e.row_id==='string'&&validKey(e.row_id)&&typeof e.column==='string'&&schema.columns.includes(e.column)&&e.apostrophe_prefix===true);
   const key=e.row_id+':'+e.column;require(!flags.has(key)&&!(schema.booleans??[]).includes(e.column)&&!(schema.integers??[]).includes(e.column)&&!(schema.json??[]).includes(e.column));flags.set(key,{rowId:e.row_id,column:e.column});
  }
  let at=0;const matrix:string[][]=[];
  while(at<csv.length){
   const row:string[]=[];
   while(true){
    require(csv[at++]==='"');const pieces:string[]=[];let start=at,closed=false;
    while(at<csv.length){
     if(csv[at]!=='"'){at++;continue;}
     pieces.push(csv.slice(start,at));
     if(csv[at+1]==='"'){pieces.push('"');at+=2;start=at;continue;}
     at++;closed=true;break;
    }
    require(closed);row.push(pieces.join(''));require(row.length<=schema.columns.length);
    if(csv[at]===','){at++;continue;}
    require(csv[at]==='\r'&&csv[at+1]==='\n');at+=2;break;
   }
   require(row.length===schema.columns.length&&matrix.length<=schema.maxRows);matrix.push(row);
  }
  require(matrix.length>=1&&matrix[0]!.every((column,index)=>column===schema.columns[index]));
  const rows:Readonly<Record<string,unknown>>[]=[];let prior='';const used=new Set<string>();
  for(const cells of matrix.slice(1)){
   const id=keyColumns.map(k=>cells[schema.columns.indexOf(k)]!).join(':');require(validKey(id)&&id>prior);prior=id;
   const row:Record<string,unknown>={};
   for(const [index,column]of schema.columns.entries()){
    let value=cells[index]!;const key=id+':'+column,flag=flags.has(key);
    if(value==='\\N'){require(!flag);row[column]=null;continue;}
    if(flag){require(value.startsWith("'"));value=value.slice(1);used.add(key);}
    value=pairedBackslashes(value);
    if((schema.booleans??[]).includes(column)){require(!flag&&(value==='true'||value==='false'));row[column]=value==='true';}
    else if((schema.integers??[]).includes(column)){require(!flag&&/^(0|[1-9][0-9]{0,9})$/.test(value)&&Number.isSafeInteger(Number(value)));row[column]=Number(value);}
    else if((schema.json??[]).includes(column)){
     require(!flag);const decoded:unknown=JSON.parse(value);require(decoded!==null&&typeof decoded==='object'&&historyJsonEqual(parseHistoryJson(value),parseHistoryJson(JSON.stringify(decoded))));row[column]=decoded;
    }else{require(flag===formula(value));row[column]=value;}
   }
   rows.push(Object.freeze(row));
  }
  require(used.size===flags.size);return Object.freeze(rows);
 }catch{throw new SourceExportCsvError();}
}
