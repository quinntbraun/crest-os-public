// Private instance-operator tooling. No browser/runtime import or new SQL grant.
import pg from 'pg';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {withRecoveryBackupLease} from './recovery-backup-lease.ts';
import {verifyRecoveryBackupReader} from './recovery-backup-reader.ts';
import {operatorSourceInventory138} from './operator-source-inventory138.ts';
import {readCurrentBusinessCsv} from '../security/current-business-source-csv.ts';

type Row=Readonly<Record<string,string|null>>;
type Source=Readonly<{source:string;columns:readonly string[];excluded:readonly string[];types:Readonly<Record<string,string>>;primaryKey:readonly string[];rows:readonly Row[]}>;
type Capture=Readonly<{profile:'crest.private-operator-source.v1';sourceSchemaVersion:138;snapshotId:string;snapshotAt:string;scope:'instance_operator';sources:readonly Source[];recordCount:number;completePortableExport:false;completeBackup:false}>;
const captures=new WeakMap<object,Capture>(),maximum=67108864;
export class OperatorSourceExportError extends Error{constructor(){super('OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED');this.name='OperatorSourceExportError';}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"',hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const formula=(value:string)=>value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'');

export async function captureOperatorSources138(input:Readonly<{client:pg.Client;leaseBusinessId:string;migrations:readonly Readonly<{version:string;name:string}>[]}>,external:AbortSignal){
 const client=input.client;try{
  require(client instanceof pg.Client&&input.migrations.length===138);await verifyRecoveryBackupReader(client,input.migrations);
  return await withRecoveryBackupLease(client,input.leaseBusinessId,external,async lease=>{
   const captured=await lease.capture(async snapshot=>{
    for(const sql of["SET LOCAL timezone='UTC'","SET LOCAL datestyle='ISO, YMD'",'SET LOCAL extra_float_digits=3'])await snapshot.query(sql);
    const sources:Source[]=[];let recordCount=0,total=0;
    for(const expected of operatorSourceInventory138){
     lease.signal.throwIfAborted();const metadata=(await snapshot.query(`SELECT a.attname AS name,a.atttypid::text AS oid,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE a.attrelid=$1::regclass AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[expected.source])).rows;
     require(isDeepStrictEqual(metadata.map(x=>x.name).sort(),[...expected.columns,...expected.excluded].sort()));
     const types:Record<string,string>={};for(const column of expected.columns){const item=metadata.find(x=>x.name===column);require(item&&['16','20','21','23','25','1184','2950'].includes(item.oid)&&typeof item.type==='string');types[column]=item.type;}
     const keys=(await snapshot.query(`SELECT a.attname AS name FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::smallint[],a.attnum)`,[expected.source])).rows.map(x=>x.name as string);require(keys.length>0&&keys.every(key=>expected.columns.includes(key)));
     // Identifiers come only from the literal reviewed inventory and checked
     // primary-key subset; there is no caller-selected table, column or filter.
     const rows:Row[]=[],projection=expected.columns.map(column=>'"'+column+'"::text AS "'+column+'"').join(','),order=keys.map(key=>'"'+key+'"').join(',');
     await snapshot.query(`DECLARE crest_operator_source NO SCROLL CURSOR FOR SELECT ${projection} FROM ONLY ${expected.source} ORDER BY ${order}`);
     try{for(;;){lease.signal.throwIfAborted();const page=(await snapshot.query('FETCH FORWARD 256 FROM crest_operator_source')).rows;if(!page.length)break;require(page.length<=256);
      for(const raw of page){require(isDeepStrictEqual(Object.keys(raw),expected.columns));const row:Record<string,string|null>={};for(const column of expected.columns){const value=raw[column];require(value===null||typeof value==='string'&&!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);row[column]=value;total+=value===null?1:Buffer.byteLength(value);require(total<=maximum);}rows.push(Object.freeze(row));recordCount++;require(recordCount<=100000);}
     }}finally{await snapshot.query('CLOSE crest_operator_source');}
     sources.push(Object.freeze({...expected,types:Object.freeze(types),primaryKey:Object.freeze(keys),rows:Object.freeze(rows)}));
    }return Object.freeze({sources:Object.freeze(sources),recordCount});
   });await lease.assertHeld();
   const evidence:Capture=Object.freeze({profile:'crest.private-operator-source.v1',sourceSchemaVersion:138,snapshotId:captured.snapshot.id,snapshotAt:captured.snapshot.capturedAt,scope:'instance_operator',...captured.value,completePortableExport:false,completeBackup:false}),result=Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new OperatorSourceExportError();}});captures.set(result,evidence);return result;
  });
 }catch{throw new OperatorSourceExportError();}finally{if(client instanceof pg.Client)await client.end().catch(()=>{});}
}

export function formatOperatorSourceExport(capture:unknown){
 try{
  require(capture&&typeof capture==='object');const data=captures.get(capture);require(data);const files:Record<string,Uint8Array>={},dictionary:Record<string,unknown>={},escapeMap:Record<string,unknown>={};let size=0;
  for(const source of data.sources){
   const name=source.source.replace('.','_')+'.csv',escapes:{row:number;column:string}[]=[],lines=[source.columns.map(quote).join(',')];
   for(const[rowIndex,row]of source.rows.entries())lines.push(source.columns.map(column=>{const original=row[column];require(original===null||typeof original==='string');if(original===null)return quote('\\N');let cell=original.replaceAll('\\','\\\\');if(formula(cell)){cell="'"+cell;escapes.push({row:rowIndex+1,column});}return quote(cell);}).join(','));
   const csv=lines.join('\r\n')+'\r\n';require(isDeepStrictEqual(readCurrentBusinessCsv(csv,source.columns,escapes),source.rows));files[name]=Buffer.from(csv);size+=files[name].byteLength;require(size<=maximum);
   dictionary[name]={source:source.source,columns:source.columns,excluded:source.excluded,types:source.types,primaryKey:source.primaryKey,records:source.rows.length};escapeMap[name]=escapes;
  }
  files['operator_dictionary.json']=Buffer.from(JSON.stringify(dictionary)+'\n');files['operator_escape_map.json']=Buffer.from(JSON.stringify(escapeMap)+'\n');
  files['operator_manifest.json']=Buffer.from(JSON.stringify({profile:'crest.private-operator-csv.v1',sourceSchemaVersion:138,snapshotId:data.snapshotId,snapshotAt:data.snapshotAt,scope:'instance_operator',recordCount:data.recordCount,scalarFormat:'Exact PostgreSQL text, UTC dates/times, quoted backslash-N null, paired backslashes, only escape-map-marked spreadsheet apostrophes.',referenceClosureVerified:false,completePortableExport:false,completeBackup:false,files:Object.entries(files).map(([name,bytes])=>({name,byteSize:bytes.byteLength,sha256:hash(bytes)}))})+'\n');
  require(Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0)<=maximum);return Object.freeze(files);
 }catch{throw new OperatorSourceExportError();}
}
