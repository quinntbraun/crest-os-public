// Declared FK metadata and source-snapshot orphan checks, not every logical or
// polymorphic business reference. Credentials and external parents are not read.
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import {instanceSourceInventory138} from './instance-source-inventory138.ts';
import {openingFunds139SourceInventory} from './opening-funds139-source-profile.ts';
import {openingSupplier141SourceInventory} from './opening-supplier141-source-inventory.ts';
export type InstanceSourceForeignKey=Readonly<{source:string;name:string;columns:readonly string[];target:string;targetColumns:readonly string[];match:'simple'|'full';constraintValidated:boolean;verification:'snapshot_no_orphans'|'excluded_column'|'external_source'}>;
export async function captureInstanceSourceReferences(snapshot:RecoveryBackupSnapshot,signal:AbortSignal,candidate:boolean|'supplier141'=false){
 function require(value:unknown):asserts value{if(!value)throw Error('INSTANCE_SOURCE_REFERENCES_REVIEW_REQUIRED');}
 require(isLiveRecoveryBackupSnapshot(snapshot)&&snapshot.databaseRole==='crest_backup_reader');signal.throwIfAborted();
 const inventory=new Map((candidate==='supplier141'?openingSupplier141SourceInventory:candidate?openingFunds139SourceInventory:instanceSourceInventory138).map(source=>[source.source,source])),quote=(value:string)=>'"'+value.replaceAll('"','""')+'"',relation=(value:string)=>value.split('.').map(quote).join('.');
 const definitions=(await snapshot.query(`SELECT n.nspname||'.'||c.relname AS source,f.conname AS name,
  ARRAY(SELECT a.attname::text FROM unnest(f.conkey) WITH ORDINALITY k(num,pos) JOIN pg_catalog.pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=k.num ORDER BY k.pos) AS local_columns,
  pn.nspname||'.'||p.relname AS target,
  ARRAY(SELECT a.attname::text FROM unnest(f.confkey) WITH ORDINALITY k(num,pos) JOIN pg_catalog.pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=k.num ORDER BY k.pos) AS target_columns,
  f.confmatchtype::text AS match,f.convalidated AS validated
  FROM pg_catalog.pg_constraint f JOIN pg_catalog.pg_class c ON c.oid=f.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_catalog.pg_class p ON p.oid=f.confrelid JOIN pg_catalog.pg_namespace pn ON pn.oid=p.relnamespace
  WHERE f.contype='f' AND n.nspname IN('crest','crest_private')
  ORDER BY (n.nspname||'.'||c.relname) COLLATE "C",f.conname COLLATE "C"`)).rows;
 require(definitions.length>0&&definitions.length<=4096);const result:InstanceSourceForeignKey[]=[],seen=new Set<string>();
 for(const row of definitions){
  signal.throwIfAborted();const source=inventory.get(row.source),target=inventory.get(row.target);require(source&&typeof row.target==='string'&&typeof row.name==='string'&&row.name.length>0&&Array.isArray(row.local_columns)&&row.local_columns.length>0&&row.local_columns.length<=32&&row.local_columns.every((x:unknown)=>typeof x==='string')&&Array.isArray(row.target_columns)&&row.target_columns.length===row.local_columns.length&&row.target_columns.every((x:unknown)=>typeof x==='string')&&['s','f'].includes(row.match)&&typeof row.validated==='boolean');
  const columns=row.local_columns as string[],targetColumns=row.target_columns as string[];
  const key=row.source+':'+row.name;require(!seen.has(key));seen.add(key);let verification:InstanceSourceForeignKey['verification'];
  if(!target)verification='external_source';
  else if(!columns.every(column=>source.columns.includes(column))||!targetColumns.every(column=>target.columns.includes(column)))verification='excluded_column';
  else{
   const notNull=columns.map(column=>'c.'+quote(column)+' IS NOT NULL'),allNotNull=notNull.join(' AND '),partialNull=row.match==='f'?'((' +notNull.join(' OR ')+') AND NOT ('+allNotNull+')) OR ':'';
   const equal=columns.map((column,index)=>'p.'+quote(targetColumns[index]!)+'=c.'+quote(column)).join(' AND ');
   const absent=(await snapshot.query('SELECT count(*)::text AS missing FROM ONLY '+relation(row.source)+' c WHERE '+partialNull+'(('+allNotNull+') AND NOT EXISTS(SELECT 1 FROM ONLY '+relation(row.target)+' p WHERE '+equal+'))')).rows;
   require(absent.length===1&&absent[0]?.missing==='0');verification='snapshot_no_orphans';
  }
  result.push(Object.freeze({source:row.source,name:row.name,columns:Object.freeze([...columns]),target:row.target,targetColumns:Object.freeze([...targetColumns]),match:row.match==='s'?'simple':'full',constraintValidated:row.validated,verification}));
 }
 return Object.freeze(result);
}
