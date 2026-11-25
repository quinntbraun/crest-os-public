// Private instance-operator tooling. No browser/runtime import or new SQL grant.
import pg from 'pg';
import {openingSupplier141SourceProfile} from './opening-supplier141-catalog.ts';
import {openingSupplier141SourceInventory} from './opening-supplier141-source-inventory.ts';
import {workspaceExport140SourceProfile} from './workspace-export140-catalog.ts';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {withRecoveryBackupLease} from './recovery-backup-lease.ts';
import {verifyRecoveryBackupReader} from './recovery-backup-reader.ts';
import {operatorSourceInventory138} from './operator-source-inventory138.ts';
import {instanceSourceInventory138} from './instance-source-inventory138.ts';
import {openingFunds139SourceProfile,openingFunds139SourceInventory} from './opening-funds139-source-profile.ts';
import {captureRecoveryRoutineCatalog} from './recovery-routine-catalog.ts';
import {captureRecoverySchemaCatalog} from './recovery-schema-catalog.ts';
import {recoveryRoutineBaseline138} from './recovery-routine-baseline138.ts';
import {recoverySchemaBaseline138} from './recovery-schema-baseline138.ts';
import {captureInstanceSourceReferences} from './instance-source-references.ts';
import type {InstanceSourceForeignKey} from './instance-source-references.ts';
import {readCurrentBusinessCsv} from '../security/current-business-source-csv.ts';

type Row=Readonly<Record<string,string|null>>;
type Source=Readonly<{source:string;columns:readonly string[];excluded:readonly string[];types:Readonly<Record<string,string>>;primaryKey:readonly string[];rows:readonly Row[]}>;
type Capture=Readonly<{profile:'crest.private-operator-source.v1'|'crest.private-instance-source.v1'|'crest.private-instance-source139.v1'|'crest.private-instance-source140.v1'|'crest.private-opening-funds-instance-candidate.v1'|'crest.private-opening-supplier-instance-candidate.v1';sourceSchemaVersion:138|139|140|141;snapshotId:string;snapshotAt:string;scope:'instance_operator';sources:readonly Source[];recordCount:number;foreignKeys:readonly InstanceSourceForeignKey[];completePortableExport:false;completeBackup:false}>;
type Input=Readonly<{client:pg.Client;leaseBusinessId:string;migrations:readonly Readonly<{version:string;name:string}>[]}>;
const captures=new WeakMap<object,Capture>(),maximum=67108864;
type ExportStage='input'|'reader'|'catalog'|'references'|'columns'|'rows'|'format';
export class OperatorSourceExportError extends Error{readonly stage:ExportStage;constructor(stage:ExportStage='input'){super('OPERATOR_SOURCE_EXPORT_REVIEW_REQUIRED');this.name='OperatorSourceExportError';this.stage=stage;}}
function require(value:unknown):asserts value{if(!value)throw Error('REVIEW_REQUIRED');}
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"',hash=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const formula=(value:string)=>value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??'');
function neutralReimport(data:Capture){
 const schema=data.profile!=='crest.private-operator-source.v1'?'"crest_instance_source"':'"crest_operator_source"',identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"';
 function literal(value:string|null){if(value===null)return 'NULL';require(typeof value==='string'&&!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);return "E'"+value.replaceAll('\\','\\\\').replaceAll("'","''")+"'";}
 const lines:string[]=[];let size=0;function add(line:string){size+=Buffer.byteLength(line)+1;require(size<=33554432);lines.push(line);}
 add('-- Crest private operator source: neutral PostgreSQL text import.');
 add('-- Run only in a separate empty database; existing target schema refuses.');
 add('-- Inspection/migration evidence only. No active sessions, roles, grants,');
 add('-- OAuth attempts, application constraints, workers or posting logic are recreated.');
 add('BEGIN;');add("SET LOCAL client_encoding='UTF8';");add('SET LOCAL standard_conforming_strings=on;');add('SET LOCAL search_path=pg_catalog;');add('CREATE SCHEMA '+schema+';');
 const metadata=['source_schema_version','snapshot_id','snapshot_at','scope','source_name','columns_json','types_json','primary_key_json','excluded_json','row_count',...(data.profile!=='crest.private-operator-source.v1'?['foreign_keys_json']:[]),'reference_closure_verified','complete_portable_export','complete_backup'];
 add('CREATE TABLE '+schema+'."_crest_export" ('+metadata.map(column=>identifier(column)+' pg_catalog.text NOT NULL').join(',')+');');
 for(const source of data.sources){
  const table=schema+'.'+identifier(source.source.replace('.','_'));
  add('CREATE TABLE '+table+' ('+source.columns.map(column=>identifier(column)+' pg_catalog.text').join(',')+',PRIMARY KEY ('+source.primaryKey.map(identifier).join(',')+'));');
  for(const row of source.rows)add('INSERT INTO '+table+' VALUES ('+source.columns.map(column=>literal(row[column]!)).join(',')+');');
  const values=[String(data.sourceSchemaVersion),data.snapshotId,data.snapshotAt,data.scope,source.source,JSON.stringify(source.columns),JSON.stringify(source.types),JSON.stringify(source.primaryKey),JSON.stringify(source.excluded),String(source.rows.length),...(data.profile!=='crest.private-operator-source.v1'?[JSON.stringify(data.foreignKeys.filter(key=>key.source===source.source))]:[]),'false','false','false'];
  add('INSERT INTO '+schema+'."_crest_export" VALUES ('+values.map(literal).join(',')+');');
 }
 add('COMMIT;');return Buffer.from(lines.join('\n')+'\n');
}

async function captureSources138(input:Input,external:AbortSignal,instance:boolean,candidate=false,registered139=false,registered140=false,supplier141=false){
 const catalog=supplier141?openingSupplier141SourceProfile:registered140?workspaceExport140SourceProfile:openingFunds139SourceProfile;
 const client=input.client;let stage:ExportStage='input';try{
  require(client instanceof pg.Client&&(!supplier141||instance&&candidate&&!registered139&&!registered140)&&input.migrations.length===(supplier141?141:registered140?140:candidate?139:138)&&(!candidate||instance&&input.migrations.at(-1)?.version===(supplier141?'20270215183000':registered140?'20270206183000':'20270205183000')&&input.migrations.at(-1)?.name===(supplier141?'fictional_opening_supplier_sources':registered140?'opening_funds_workspace_export':'fictional_opening_funds_sources')));stage='reader';await verifyRecoveryBackupReader(client,input.migrations);
  return await withRecoveryBackupLease(client,input.leaseBusinessId,external,async lease=>{
   const captured=await lease.capture(async snapshot=>{
    const inventory=supplier141?openingSupplier141SourceInventory:candidate?openingFunds139SourceInventory:instance?instanceSourceInventory138:operatorSourceInventory138;
    if(instance){
     stage='catalog';
     require(inventory.length===(supplier141?196:candidate?192:189)&&new Set(inventory.map(source=>source.source)).size===inventory.length);
     const routines=await captureRecoveryRoutineCatalog(snapshot,lease.signal),schema=await captureRecoverySchemaCatalog(snapshot,lease.signal);
     require(routines.routineCount===(candidate?catalog.routineCount:recoveryRoutineBaseline138.routineCount)&&routines.sha256===(candidate?catalog.routineSha256:recoveryRoutineBaseline138.sha256)&&schema.objectCount===(candidate?catalog.schemaObjectCount:recoverySchemaBaseline138.objectCount)&&schema.sha256===(candidate?catalog.schemaSha256:recoverySchemaBaseline138.sha256));
     const tables=(await snapshot.query("SELECT n.nspname||'.'||c.relname AS source FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') ORDER BY (n.nspname||'.'||c.relname) COLLATE \"C\"")).rows.map(row=>row.source);
     require(isDeepStrictEqual(tables,inventory.map(source=>source.source)));
    }
    for(const sql of["SET LOCAL timezone='UTC'","SET LOCAL datestyle='ISO, YMD'",'SET LOCAL extra_float_digits=3',"SET LOCAL intervalstyle='postgres'","SET LOCAL bytea_output='hex'"])await snapshot.query(sql);
    const sources:Source[]=[];let recordCount=0,total=0;
    for(const expected of inventory){
     stage='columns';lease.signal.throwIfAborted();const metadata=(await snapshot.query(`SELECT a.attname AS name,a.atttypid::text AS oid,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE a.attrelid=$1::regclass AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[expected.source])).rows;
     require(isDeepStrictEqual(metadata.map(x=>x.name).sort(),[...expected.columns,...expected.excluded].sort()));
     const types:Record<string,string>={};for(const column of expected.columns){const item=metadata.find(x=>x.name===column);require(item&&(instance||['16','20','21','23','25','1184','2950'].includes(item.oid))&&typeof item.type==='string');types[column]=item.type;}
     const keys=(await snapshot.query(`SELECT a.attname AS name FROM pg_catalog.pg_index i JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::smallint[],a.attnum)`,[expected.source])).rows.map(x=>x.name as string);require(keys.length>0&&keys.every(key=>expected.columns.includes(key)));
     // Identifiers come only from the literal reviewed inventory and checked
     // primary-key subset; there is no caller-selected table, column or filter.
     stage='rows';const rows:Row[]=[],projection=expected.columns.map(column=>'"'+column+'"::text AS "'+column+'"').join(','),order=keys.map(key=>'"'+key+'"').join(',');
     await snapshot.query(`DECLARE crest_operator_source NO SCROLL CURSOR FOR SELECT ${projection} FROM ONLY ${expected.source} ORDER BY ${order}`);
     try{for(;;){lease.signal.throwIfAborted();const page=(await snapshot.query('FETCH FORWARD 256 FROM crest_operator_source')).rows;if(!page.length)break;require(page.length<=256);
      for(const raw of page){require(isDeepStrictEqual(Object.keys(raw),expected.columns));const row:Record<string,string|null>={};for(const column of expected.columns){const value=raw[column];require(value===null||typeof value==='string'&&!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);row[column]=value;total+=value===null?1:Buffer.byteLength(value);require(total<=maximum);}rows.push(Object.freeze(row));recordCount++;require(recordCount<=100000);}
     }}finally{await snapshot.query('CLOSE crest_operator_source');}
     sources.push(Object.freeze({...expected,types:Object.freeze(types),primaryKey:Object.freeze(keys),rows:Object.freeze(rows)}));
    }stage='references';const foreignKeys=instance?await captureInstanceSourceReferences(snapshot,lease.signal,supplier141?'supplier141':candidate):Object.freeze([]);return Object.freeze({sources:Object.freeze(sources),recordCount,foreignKeys});
   });await lease.assertHeld();
   const evidence:Capture=Object.freeze({profile:supplier141?'crest.private-opening-supplier-instance-candidate.v1':registered140?'crest.private-instance-source140.v1':registered139?'crest.private-instance-source139.v1':candidate?'crest.private-opening-funds-instance-candidate.v1':instance?'crest.private-instance-source.v1':'crest.private-operator-source.v1',sourceSchemaVersion:supplier141?141:registered140?140:candidate?139:138,snapshotId:captured.snapshot.id,snapshotAt:captured.snapshot.capturedAt,scope:'instance_operator',...captured.value,completePortableExport:false,completeBackup:false}),result=Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new OperatorSourceExportError();}});captures.set(result,evidence);return result;
  });
 }catch{throw new OperatorSourceExportError(stage);}finally{if(client instanceof pg.Client)await client.end().catch(()=>{});}
}

export function captureOperatorSources138(input:Input,external:AbortSignal){return captureSources138(input,external,false);}
export function captureInstanceSources138(input:Input,external:AbortSignal){return captureSources138(input,external,true);}
export function captureOpeningFunds139CandidateSources(input:Input,external:AbortSignal){return captureSources138(input,external,true,true);}
export function captureInstanceSources139(input:Input,external:AbortSignal){return captureSources138(input,external,true,true,true);}
function formatSourceExport(capture:unknown,instance:boolean,candidate=false,registered139=false,registered140=false,supplier141=false){
 const catalog=supplier141?openingSupplier141SourceProfile:registered140?workspaceExport140SourceProfile:openingFunds139SourceProfile;
 try{
  require(capture&&typeof capture==='object');const data=captures.get(capture);require(data&&data.profile===(supplier141?'crest.private-opening-supplier-instance-candidate.v1':registered140?'crest.private-instance-source140.v1':registered139?'crest.private-instance-source139.v1':candidate?'crest.private-opening-funds-instance-candidate.v1':instance?'crest.private-instance-source.v1':'crest.private-operator-source.v1'));const prefix=instance?'instance':'operator',files:Record<string,Uint8Array>={},dictionary:Record<string,unknown>={},escapeMap:Record<string,unknown>={};let size=0;
  for(const source of data.sources){
   const name=source.source.replace('.','_')+'.csv',escapes:{row:number;column:string}[]=[],lines=[source.columns.map(quote).join(',')];
   for(const[rowIndex,row]of source.rows.entries())lines.push(source.columns.map(column=>{const original=row[column];require(original===null||typeof original==='string');if(original===null)return quote('\\N');let cell=original.replaceAll('\\','\\\\');if(formula(cell)){cell="'"+cell;escapes.push({row:rowIndex+1,column});}return quote(cell);}).join(','));
   const csv=lines.join('\r\n')+'\r\n';require(isDeepStrictEqual(readCurrentBusinessCsv(csv,source.columns,escapes),source.rows));files[name]=Buffer.from(csv);size+=files[name].byteLength;require(size<=maximum);
   dictionary[name]={source:source.source,columns:source.columns,excluded:source.excluded,types:source.types,primaryKey:source.primaryKey,records:source.rows.length,...(instance?{foreignKeys:data.foreignKeys.filter(key=>key.source===source.source)}:{})};escapeMap[name]=escapes;
  }
  files[prefix+'_dictionary.json']=Buffer.from(JSON.stringify(dictionary)+'\n');files[prefix+'_escape_map.json']=Buffer.from(JSON.stringify(escapeMap)+'\n');
  files[prefix+'_reimport.sql']=neutralReimport(data);
  files[prefix+'_manifest.json']=Buffer.from(JSON.stringify({profile:supplier141?'crest.private-opening-supplier-instance-csv-candidate.v1':registered140?'crest.private-instance-csv140.v1':registered139?'crest.private-instance-csv139.v1':candidate?'crest.private-opening-funds-instance-csv-candidate.v1':instance?'crest.private-instance-csv.v1':'crest.private-operator-csv.v2',
    sourceSchemaVersion:data.sourceSchemaVersion,
    ...((registered139||registered140)?{catalogRegistered:true,migrationSha256:catalog.migrationSha256}:candidate?{catalogRegistered:false,candidateMigrationSha256:catalog.migrationSha256}:{}),
    snapshotId:data.snapshotId,
    snapshotAt:data.snapshotAt,
    scope:'instance_operator',
    ...(instance?{sourceSet:'instance_sources',
    reviewedColumnCoverageComplete:true,
    sourceCount:data.sources.length,
    declaredForeignKeys:{total:data.foreignKeys.length,
    snapshotVerified:data.foreignKeys.filter(relation=>relation.verification==='snapshot_no_orphans').length,
    excludedColumns:data.foreignKeys.filter(relation=>relation.verification==='excluded_column').length,
    externalSources:data.foreignKeys.filter(relation=>relation.verification==='external_source').length,
    allIncludedAndVerified:data.foreignKeys.every(relation=>relation.verification==='snapshot_no_orphans')},
    canonicalDefinition:{migrationRegistrySha256:candidate?catalog.migrationRegistrySha256:recoveryRoutineBaseline138.migrationRegistrySha256,
    routineCount:candidate?catalog.routineCount:recoveryRoutineBaseline138.routineCount,
    routineSha256:candidate?catalog.routineSha256:recoveryRoutineBaseline138.sha256,
    schemaObjectCount:candidate?catalog.schemaObjectCount:recoverySchemaBaseline138.objectCount,
    schemaSha256:candidate?catalog.schemaSha256:recoverySchemaBaseline138.sha256}}:{}),
    recordCount:data.recordCount,
    scalarFormat:'Exact PostgreSQL text, UTC dates/times, quoted backslash-N null, paired backslashes, only escape-map-marked spreadsheet apostrophes.',
    neutralImport:prefix+'_reimport.sql creates an isolated text schema only; it does not restore application authority.',
    referenceClosureVerified:false,
    completePortableExport:false,
    completeBackup:false,
    files:Object.entries(files).map(([name,
    bytes])=>({name,
    byteSize:bytes.byteLength,
    sha256:hash(bytes)}))})+'\n');
  require(Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0)<=maximum);return Object.freeze(files);
 }catch{throw new OperatorSourceExportError('format');}
}
export function formatOperatorSourceExport(capture:unknown){return formatSourceExport(capture,false);}
export function formatInstanceSourceExport(capture:unknown){return formatSourceExport(capture,true);}

export function formatOpeningFunds139CandidateSourceExport(capture:unknown){return formatSourceExport(capture,true,true);}

export function formatInstanceSourceExport139(capture:unknown){return formatSourceExport(capture,true,true,true);}

export function captureInstanceSources140(input:Input,external:AbortSignal){return captureSources138(input,external,true,true,false,true);}
export function formatInstanceSourceExport140(capture:unknown){return formatSourceExport(capture,true,true,false,true);}

// Separately pinned candidate identity; never routes a registered140 export here.
export function captureOpeningSupplier141CandidateSources(input:Input,external:AbortSignal){return captureSources138(input,external,true,true,false,false,true);}
export function formatOpeningSupplier141CandidateSourceExport(capture:unknown){return formatSourceExport(capture,true,true,false,false,true);}
