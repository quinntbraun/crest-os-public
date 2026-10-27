// Two closed synthetic journal profiles: legacy42 plus proposals, and registered43.
// Neither changes the separate8MiB inventory limit. Never accept uploaded SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrationTestTarget} from '../../src/tooling/migration-coordinator.ts';
import {connect,hash,normalizedSchema,postgresTool,roleDefinitions,run} from './recovery-drill.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),limit=67108864;
const tool=join(root,'.local/tools/recovery/age/age'+(process.platform==='win32'?'.exe':''));
const proposalPaths=['source-export-jobs.sql','source-export-snapshots.sql','source-export-parts.sql','source-export-ready.sql','source-export-journal-reads.sql','source-export-request-resolution.sql','source-export-owner-reads.sql'].map(n=>'planning/proposals/'+n);
async function binding(registered){
 if(registered){
  const raw=await readFile(join(root,'supabase/migration-checksums.json')),registry=JSON.parse(raw),pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8'));assert.equal(registry.migrations.length,43);
  const last=registry.migrations[42];assert.equal(last.file,'20261027010000_source_export_journal.sql');assert.equal(hash(await readFile(join(root,'supabase/migrations',last.file))),last.sha256);
  return{scope:'synthetic_registered43_journal_drill',schemaVersion:43,registrySha256:hash(raw),databaseImage:pins.testDatabaseImage,registeredMigration:{file:last.file,sha256:last.sha256},inventoryLimitBytes:limit};
 }
 const raw=await readFile(join(root,'tests/support/registered42-migration-checksums.json')),registry=JSON.parse(raw),pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8'));assert.equal(registry.migrations.length,42);assert.deepEqual(JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8')).migrations.slice(0,42),registry.migrations);
 const files=[];for(const path of proposalPaths)files.push({path,sha256:hash(await readFile(join(root,path)))});
 return{scope:'synthetic_forward43_journal_drill',schemaVersion:42,registrySha256:hash(raw),databaseImage:pins.testDatabaseImage,schemaProposal:{registered:false,registeredMigrationCount:42,proposedMigration:43,files},inventoryLimitBytes:limit};
}
export async function journalInventory(c){
 assert.equal(process.env.CREST_ENV,'test');const tables=(await c.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\"")).rows,result=[];let total=0;
 for(const t of tables){const quote=s=>'"'+s.replaceAll('"','""')+'"',rows=(await c.query(`SELECT row_to_json(t)::text AS value FROM ${quote(t.schema)}.${quote(t.name)} t ORDER BY row_to_json(t)::text COLLATE "C" LIMIT 10001`)).rows;assert(rows.length<=10000,'synthetic journal fixture capacity exceeded');const digest=createHash('sha256');
  for(const {value}of rows){total+=Buffer.byteLength(value)+1;assert(total<=limit,'synthetic journal fixture capacity exceeded');digest.update(value+'\n');}result.push({...t,rows:rows.length,sha256:digest.digest('hex')});
 }return result;
}
async function seal(path,bytes,recipient){const cipher=await run(tool,['--encrypt','--recipient',recipient],{input:bytes});await writeFile(path,cipher,{flag:'wx',mode:0o600});return{bytes:cipher.length,sha256:hash(cipher)};}
async function unseal(path,descriptor,identity){const cipher=await readFile(path);assert.equal(cipher.length,descriptor.bytes);assert.equal(hash(cipher),descriptor.sha256);return run(tool,['--decrypt','--identity',identity],{input:cipher});}
export async function backupJournalDatabase(...args){return backupWithProfile(false,...args);}
export async function backupRegisteredJournalDatabase(...args){return backupWithProfile(true,...args);}
async function backupWithProfile(registered,c,url,directory,recipient,duringSnapshot=async()=>{}){
 migrationTestTarget(process.env.CREST_ENV,url);const profile=await binding(registered);let stage='snapshot';await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await c.query("SET LOCAL timezone='UTC';SET LOCAL datestyle='ISO, YMD';SET LOCAL bytea_output='hex'");const snapshot=(await c.query('SELECT pg_export_snapshot() AS value')).rows[0].value,rows=await journalInventory(c),roles=await roleDefinitions(c);
  stage='schema';const schema=await postgresTool('pg_dump',url,['--schema-only','--snapshot',snapshot]);await duringSnapshot();stage='dump';const dump=await postgresTool('pg_dump',url,['--format=custom','--snapshot',snapshot]);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
  const manifest={formatVersion:1,...profile,completeBackup:false,snapshot,roles,rows,schemaSha256:hash(normalizedSchema(schema)),dump:{bytes:dump.length,sha256:hash(dump)},excluded:['runtime_login_credentials','external_objects','application_image','independent_vault','production_configuration','production_recovery_authority']};
  stage='encryption';const receipt={formatVersion:1,dump:await seal(join(directory,'database.age'),dump,recipient),manifest:await seal(join(directory,'manifest.age'),Buffer.from(JSON.stringify(manifest)),recipient)};await writeFile(join(directory,'receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});await c.query('COMMIT');return{manifest,receipt};
 }catch{await c.query('ROLLBACK');throw new Error('SYNTHETIC_JOURNAL_BACKUP_FAILED:'+stage);}
}
export async function restoreJournalDatabase(...args){return restoreWithProfile(false,...args);}
export async function restoreRegisteredJournalDatabase(...args){return restoreWithProfile(true,...args);}
async function restoreWithProfile(registered,directory,identity,url){
 migrationTestTarget(process.env.CREST_ENV,url);const profile=await binding(registered),c=await connect(url);let stage='empty_destination';
 try{
  assert.equal((await journalInventory(c)).length,0);assert.equal((await c.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN('information_schema','public')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS occupied")).rows[0].occupied,false);
  stage='receipt';const receipt=JSON.parse(await readFile(join(directory,'receipt.json'),'utf8'));assert.equal(receipt.formatVersion,1);stage='manifest';const manifest=JSON.parse((await unseal(join(directory,'manifest.age'),receipt.manifest,identity)).toString());assert.equal(manifest.formatVersion,1);assert.equal(manifest.completeBackup,false);for(const [key,value]of Object.entries(profile))assert.deepEqual(manifest[key],value);
  stage='authenticated_dump';const dump=await unseal(join(directory,'database.age'),receipt.dump,identity);assert.equal(dump.length,manifest.dump.bytes);assert.equal(hash(dump),manifest.dump.sha256);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
  // Authentication of the entire dump precedes ALL executable restored SQL.
  stage='closed_roles';for(const r of manifest.roles){assert.match(r.rolname,/^crest_[a-z_]+$/);assert(!r.rolsuper&&!r.rolinherit&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolcanlogin&&!r.rolreplication&&!r.rolbypassrls&&r.rolconnlimit===-1&&r.rolconfig===null);if(!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[r.rolname])).rowCount)await c.query(`CREATE ROLE "${r.rolname}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);}assert.deepEqual(await roleDefinitions(c),manifest.roles);
  stage='restore';await postgresTool('pg_restore',url,['--exit-on-error','--single-transaction'],dump);stage='rows';assert.deepEqual(await journalInventory(c),manifest.rows);stage='schema';assert.equal(hash(normalizedSchema(await postgresTool('pg_dump',url,['--schema-only']))),manifest.schemaSha256);return manifest;
 }catch{throw new Error('SYNTHETIC_RECOVERY_RESTORE_FAILED:'+stage);}finally{await c.end();}
}
