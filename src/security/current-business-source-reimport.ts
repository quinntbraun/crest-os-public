import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {currentBusinessSourceInventory} from './current-business-source-inventory.ts';
import type {CurrentBusinessRows,CurrentBusinessSourceBinding} from './current-business-source.ts';
import {currentIdentityInventory,verifyCurrentIdentitySource} from './current-business-identity-source.ts';
import type {CurrentBusinessIdentitySource} from './current-business-identity-source.ts';

const schema='crest_portable_source',limit=33554432;
const identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"';
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_REIMPORT_REVIEW_REQUIRED');}
function literal(value:string|null){
 if(value===null)return 'NULL';require(typeof value==='string'&&!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);
 return "E'"+value.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
}
// A separate, neutral text schema. Never executes SQL, recreates application
// authority, changes posted history or claims complete recovery.
export function formatCurrentBusinessReimport(capture:CurrentBusinessRows,binding:CurrentBusinessSourceBinding,inputIdentity?:CurrentBusinessIdentitySource){
 require(capture.schemaVersion===1&&capture.profile==='crest.current-business-rows.v1'&&capture.completePortableExport===false&&capture.completeBackup===false&&capture.sources.length===currentBusinessSourceInventory.length);
 require(/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&[133,134].includes(binding.sourceSchemaVersion));
 const identity=inputIdentity?verifyCurrentIdentitySource(inputIdentity,capture):undefined,sources=[...capture.sources,...identity?.sources??[]];
 const lines:string[]=[];let bytes=0,count=0;
 function add(value:string){bytes+=Buffer.byteLength(value)+1;require(bytes<=limit);lines.push(value);}
 add('-- Crest business source: neutral PostgreSQL reimport, exact text values.');
 add('-- Run only in a separate empty database. Existing target schema causes rollback.');
 add('-- No application roles, permissions, credentials, posting rules or private original files.');
 add('BEGIN;');add("SET LOCAL client_encoding = 'UTF8';");add('SET LOCAL standard_conforming_strings = on;');add('CREATE SCHEMA '+identifier(schema)+';');
 const metadata=['business_id','snapshot_token','observed_at','source_schema_version','app_release_id','source_name','columns_json','types_json','primary_key_json','row_count','complete_portable_export','complete_backup'];
 add('CREATE TABLE '+identifier(schema)+'."_crest_export" ('+metadata.map(column=>identifier(column)+' text NOT NULL').join(',')+');');
 for(const [index,source]of sources.entries()){
  const business=index<capture.sources.length,expected=business?currentBusinessSourceInventory[index]!:currentIdentityInventory[index-capture.sources.length]!;require(source.source===expected.source&&isDeepStrictEqual(source.columns,expected.columns));
  require(Object.keys(source.types).sort().join(',')===[...source.columns].sort().join(',')&&Object.values(source.types).every(type=>typeof type==='string')&&Array.isArray(source.primaryKey)&&source.primaryKey.every(column=>source.columns.includes(column)));
  const target=identifier(schema)+'.'+identifier(source.source.replace('.','_')),columns=source.columns.map(identifier).join(',');
  add('CREATE TABLE '+target+' ('+source.columns.map(column=>identifier(column)+' text').join(',')+');');
  for(let offset=0;offset<source.rows.length;offset+=100){
   const values=source.rows.slice(offset,offset+100).map(row=>{
    require(Object.keys(row).sort().join(',')===[...source.columns].sort().join(',')&&(!business||(source.source==='crest.businesses'?row.id===capture.businessId:row.business_id===capture.businessId)));
    return '('+source.columns.map(column=>literal(row[column]!)).join(',')+')';
   });
   add('INSERT INTO '+target+' ('+columns+') VALUES\n'+values.join(',\n')+';');
  }
  count+=source.rows.length;require(count<=100000);
  const values=[capture.businessId,business?capture.snapshotToken:identity!.identitySnapshotToken,business?capture.observedAt:identity!.identityObservedAt,String(binding.sourceSchemaVersion),binding.appReleaseId,source.source,JSON.stringify(source.columns),JSON.stringify(source.types),JSON.stringify(source.primaryKey),String(source.rows.length),'false','false'];
  add('INSERT INTO '+identifier(schema)+'."_crest_export" ('+metadata.map(identifier).join(',')+') VALUES ('+values.map(literal).join(',')+');');
 }
 require(count===capture.recordCount+(identity?.recordCount??0));add('COMMIT;');
 return Buffer.from(lines.join('\n')+'\n');
}

export const currentBusinessReimportReadme=`Crest business records — neutral PostgreSQL import

Keep every file in this package private. Open business_records_reimport.txt as SQL
in a separate empty PostgreSQL database, or use psql with ON_ERROR_STOP=1 and -f.
The filename extension does not affect PostgreSQL execution. Execute the complete
file using a role allowed to create a schema. The script runs in one transaction.
If crest_portable_source already exists, it fails without replacing that schema.

All source values remain text. Explicit SQL escape literals double backslashes
and quotes regardless of the incoming connection's string settings.
NULL, empty strings, exact amounts, identifiers,
microsecond timestamps, JSON, backslashes, quotes and formula-like text retain
their source values. Unlike CSV display escaping, SQL literals need no apostrophe
removal or escape-map processing. Each original table becomes a table such as
crest_portable_source.crest_customers. Original column types and primary keys,
source row counts and snapshot/build identity are in _crest_export. Business rules
and relational constraints are metadata here; the imported text tables do not
run Crest commands or financial posting logic.

This imports the business-table component and any listed actor/role/identity
component from one source capture. Provider/session/runtime-security components
and original photo/receipt/supplier bytes remain separate.
It is not a complete Crest backup or an application restoration procedure.
`;
