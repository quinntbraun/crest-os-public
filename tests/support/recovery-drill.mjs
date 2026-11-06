// Bounded, synthetic-only recovery machinery. No production escape flag or
// runtime/vault credentials. Dumps are trusted executable SQL, never user uploads.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {privateRecoveryWorkspace} from './private-recovery-permissions.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { migrationTestTarget } from '../../src/tooling/migration-coordinator.ts';
import {verifyExportCoverage} from '../../src/tooling/export-coverage.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8'));
const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));
const currentCoverage=JSON.parse(await readFile(join(root,'planning/SECURITY_EXPORT_COVERAGE.json'),'utf8'));
const registryHash=hash(await readFile(join(root,'supabase/migration-checksums.json')));
const legacy53Bytes=await readFile(join(root,'tests/support/registered53-migration-checksums.json')),legacy53=JSON.parse(legacy53Bytes);
assert.equal(legacy53.migrations.length,53);assert.deepEqual(registry.migrations.slice(0,53),legacy53.migrations);
const legacy53Coverage=JSON.parse(await readFile(join(root,'tests/support/registered53-export-coverage.json'),'utf8'));
const legacy53Profile=Object.freeze({schemaVersion:53,registrySha256:hash(legacy53Bytes)}),field54Coverage=JSON.parse(await readFile(join(root,'tests/support/field54-export-coverage.json'),'utf8'));
const field54Versions=[...legacy53.migrations.map(row=>row.version),'20261105180000'];
const legacy52Bytes=await readFile(join(root,'tests/support/registered52-migration-checksums.json')),legacy52=JSON.parse(legacy52Bytes);
assert.equal(legacy52.migrations.length,52);assert.deepEqual(registry.migrations.slice(0,52),legacy52.migrations);
const legacy52Profile=Object.freeze({schemaVersion:52,registrySha256:hash(legacy52Bytes)}),legacy52Coverage=JSON.parse(await readFile(join(root,'tests/support/registered52-export-coverage.json'),'utf8')),amendment53Coverage=JSON.parse(await readFile(join(root,'tests/support/amendment53-export-coverage.json'),'utf8'));
const legacy51Bytes=await readFile(join(root,'tests/support/registered51-migration-checksums.json')),legacy51=JSON.parse(legacy51Bytes);
assert.equal(legacy51.migrations.length,51);assert.deepEqual(registry.migrations.slice(0,51),legacy51.migrations);
const legacy51Profile=Object.freeze({schemaVersion:51,registrySha256:hash(legacy51Bytes)});
const legacy50Bytes=await readFile(join(root,'tests/support/registered50-migration-checksums.json')),legacy50=JSON.parse(legacy50Bytes);
assert.equal(legacy50.migrations.length,50);assert.deepEqual(registry.migrations.slice(0,50),legacy50.migrations);
const legacy50Profile=Object.freeze({schemaVersion:50,registrySha256:hash(legacy50Bytes)});
const legacy42Bytes=await readFile(join(root,'tests/support/registered42-migration-checksums.json')),legacy42=JSON.parse(legacy42Bytes);
assert.equal(legacy42.migrations.length,42);assert.deepEqual(registry.migrations.slice(0,42),legacy42.migrations);
const legacy43Bytes=await readFile(join(root,'tests/support/registered43-migration-checksums.json')),legacy43=JSON.parse(legacy43Bytes);
assert.equal(legacy43.migrations.length,43);assert.deepEqual(registry.migrations.slice(0,43),legacy43.migrations);
const legacy46Bytes=await readFile(join(root,'tests/support/registered46-migration-checksums.json')),legacy46=JSON.parse(legacy46Bytes);
assert.equal(legacy46.migrations.length,46);assert.deepEqual(registry.migrations.slice(0,46),legacy46.migrations);
const legacy46Profile=Object.freeze({schemaVersion:46,registrySha256:hash(legacy46Bytes)});
const legacy48Bytes=await readFile(join(root,'tests/support/registered48-migration-checksums.json')),legacy48=JSON.parse(legacy48Bytes);
assert.equal(legacy48.migrations.length,48);assert.deepEqual(registry.migrations.slice(0,48),legacy48.migrations);
const legacy48Profile=Object.freeze({schemaVersion:48,registrySha256:hash(legacy48Bytes)});
const legacy49Bytes=await readFile(join(root,'tests/support/registered49-migration-checksums.json')),legacy49=JSON.parse(legacy49Bytes);
assert.equal(legacy49.migrations.length,49);assert.deepEqual(registry.migrations.slice(0,49),legacy49.migrations);
const legacy49Profile=Object.freeze({schemaVersion:49,registrySha256:hash(legacy49Bytes)});
const legacy47Bytes=await readFile(join(root,'tests/support/registered47-migration-checksums.json')),legacy47=JSON.parse(legacy47Bytes);
assert.equal(legacy47.migrations.length,47);assert.deepEqual(registry.migrations.slice(0,47),legacy47.migrations);
const legacy47Profile=Object.freeze({schemaVersion:47,registrySha256:hash(legacy47Bytes)});
const legacy45Bytes=await readFile(join(root,'tests/support/registered45-migration-checksums.json')),legacy45=JSON.parse(legacy45Bytes);
assert.equal(legacy45.migrations.length,45);assert.deepEqual(registry.migrations.slice(0,45),legacy45.migrations);
const legacy45Profile=Object.freeze({schemaVersion:45,registrySha256:hash(legacy45Bytes)});
const legacy44Bytes=await readFile(join(root,'tests/support/registered44-migration-checksums.json')),legacy44=JSON.parse(legacy44Bytes);
assert.equal(legacy44.migrations.length,44);assert.deepEqual(registry.migrations.slice(0,44),legacy44.migrations);
const legacy44Profile=Object.freeze({schemaVersion:44,registrySha256:hash(legacy44Bytes)});
const legacy43Profile=Object.freeze({schemaVersion:43,registrySha256:hash(legacy43Bytes)});
const currentProfile=Object.freeze({schemaVersion:registry.migrations.length,registrySha256:registryHash}),legacy42Profile=Object.freeze({schemaVersion:42,registrySha256:hash(legacy42Bytes)});
const tool=name=>join(root,`.local/tools/recovery/age/${name}${process.platform==='win32'?'.exe':''}`);
const maxBytes=32*1024*1024;
export function hash(value){return createHash('sha256').update(value).digest('hex');}
export function run(command,args,{input,env=process.env,signal}={}){
  return new Promise((resolve,reject)=>{
    const child=execFile(command,args,{env,signal,timeout:120000,maxBuffer:maxBytes,encoding:'buffer'},(error,stdout,stderr)=>{
      // Only fixed restore stages may cross the child boundary. Never echo raw
      // tool stderr, SQL, target URLs, credentials or restored source values.
      const stage=stderr.toString().match(/SYNTHETIC_RECOVERY_RESTORE_FAILED:(empty_destination|receipt|manifest|authenticated_dump|objects|closed_roles|restore|rows|schema)\b/)?.[1];
      if(error)reject(new Error('SYNTHETIC_RECOVERY_TOOL_FAILED'+(stage?':'+stage:'')));else resolve(stdout);
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
function target(value){return new URL(migrationTestTarget(process.env.CREST_ENV,value));}
export async function privateWorkspace(){
  return privateRecoveryWorkspace();
}
export async function keyPair(directory){
  const path=join(directory,`key-${randomBytes(8).toString('hex')}.txt`);
  const privateKey=await run(tool('age-keygen'),[]);await writeFile(path,privateKey,{flag:'wx',mode:0o600});
  const recipient=(await run(tool('age-keygen'),['-y',path])).toString().trim();
  assert.match(recipient,/^age1[a-z0-9]+$/);return {path,recipient};
}
export async function postgresTool(name,url,args=[],input){
  assert(['pg_dump','pg_restore'].includes(name));const u=target(url);
  const env={...process.env,PGPASSWORD:decodeURIComponent(u.password)};
  return run('docker',['run','--rm','--interactive',...(process.platform==='win32'?[]:['--network','host']),'--env','PGPASSWORD',pins.testDatabaseImage,name,
    '--host',process.platform==='win32'?'host.docker.internal':u.hostname.replace(/^\[|\]$/g,''),'--port',u.port||'5432','--username',decodeURIComponent(u.username),'--no-password',
    ...args,'--dbname',u.pathname.slice(1)],{input,env});
}
export async function connect(url){
  target(url);const client=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:30000});
  await client.connect();await client.query("SET timezone='UTC'; SET datestyle='ISO, YMD'; SET bytea_output='hex'");return client;
}
export async function inventory(client){
  const tables=(await client.query("SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY n.nspname COLLATE \"C\",c.relname COLLATE \"C\"")).rows;
  const result=[];let total=0;
  for(const table of tables){
    const quote=s=>'"'+s.replaceAll('"','""')+'"';
    const rows=(await client.query(`SELECT row_to_json(t)::text AS value FROM ${quote(table.schema)}.${quote(table.name)} t ORDER BY row_to_json(t)::text COLLATE "C" LIMIT 10001`)).rows;
    assert(rows.length<=10000,'synthetic recovery fixture capacity exceeded');
    const digest=createHash('sha256');
    for(const {value} of rows){total+=Buffer.byteLength(value)+1;assert(total<=8*1024*1024,'synthetic recovery fixture capacity exceeded');digest.update(value+'\n');}
    result.push({...table,rows:rows.length,sha256:digest.digest('hex')});
  }
  return result;
}
export function normalizedSchema(bytes){
  // PG17's psql restriction nonce is intentionally random; retain every other
  // schema byte, including constraints, grants, policies, triggers and comments.
  return bytes.toString().replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?$/gm,'');
}
export async function roleDefinitions(client){
  const roles=(await client.query("SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' ORDER BY rolname")).rows;
  assert(roles.length>0);
  for(const r of roles)assert(!r.rolsuper&&!r.rolinherit&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolcanlogin&&!r.rolreplication&&!r.rolbypassrls&&r.rolconnlimit===-1&&r.rolconfig===null,'unexpected source role authority');
  const links=(await client.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member WHERE a.rolname ~ '^crest_[a-z_]+$' AND b.rolname ~ '^crest_[a-z_]+$'")).rows;
  assert.equal(links.length,0,'unreviewed internal role membership');return roles;
}
async function seal(path,bytes,recipient){
  const cipher=await run(tool('age'),['--encrypt','--recipient',recipient],{input:bytes});
  await writeFile(path,cipher,{flag:'wx',mode:0o600});return {bytes:cipher.length,sha256:hash(cipher)};
}
async function unseal(path,expected,identity){
  const cipher=await readFile(path);assert.equal(cipher.length,expected.bytes,'recovery ciphertext length mismatch');
  assert.equal(hash(cipher),expected.sha256,'recovery ciphertext checksum mismatch');
  return run(tool('age'),['--decrypt','--identity',identity],{input:cipher});
}
export async function backupDatabase(client,...args){
  // The default current label must not silently describe an older database.
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),registry.migrations.map(m=>m.version));
  return backupWithProfile(currentProfile,client,...args);
}
export async function backupLegacy52Database(client,...args){
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),legacy52.migrations.map(m=>m.version));
  return backupWithProfile(legacy52Profile,client,...args);
}
export async function backupLegacy51Database(client,...args){
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),legacy51.migrations.map(m=>m.version));
  return backupWithProfile(legacy51Profile,client,...args);
}
export async function backupLegacy50Database(client,...args){
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),legacy50.migrations.map(m=>m.version));
  return backupWithProfile(legacy50Profile,client,...args);
}
export async function backupLegacy49Database(client,...args){
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),legacy49.migrations.map(m=>m.version));
  return backupWithProfile(legacy49Profile,client,...args);
}
export async function backupLegacy48Database(...args){return backupWithProfile(legacy48Profile,...args);}
export async function backupLegacy47Database(...args){return backupWithProfile(legacy47Profile,...args);}
export async function backupLegacy46Database(...args){return backupWithProfile(legacy46Profile,...args);}
export async function backupLegacy45Database(...args){return backupWithProfile(legacy45Profile,...args);}
export async function backupLegacy44Database(...args){return backupWithProfile(legacy44Profile,...args);}
export async function backupLegacy43Database(...args){return backupWithProfile(legacy43Profile,...args);}
export async function backupLegacy42Database(...args){return backupWithProfile(legacy42Profile,...args);}
// Explicit synthetic candidate profile; never relabel a50 dump as registered49.
// Existing current/legacy entry points retain their exact bounds and hashes.
async function booking50CandidateProfile(candidate){
  assert.equal(candidate.file,'20261030160000_confirmed_bookings.sql');
  const bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json')),value=JSON.parse(bytes);
  const frozen=JSON.parse(await readFile(join(root,'tests/support/registered49-migration-checksums.json')));
  assert.equal(value.migrations.length,50);assert.equal(frozen.migrations.length,49);assert.deepEqual(value.migrations.slice(0,49),frozen.migrations);
  assert.equal(hash(bytes),candidate.registrySha256);assert.equal(value.migrations.at(-1).file,candidate.file);assert.equal(value.migrations.at(-1).sha256,candidate.sha256);
  assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
  return {profile:Object.freeze({schemaVersion:50,registrySha256:candidate.registrySha256}),versions:value.migrations.map(m=>m.version)};
}
export async function backupBooking50CandidateDatabase(candidate,client,...args){
  const checked=await booking50CandidateProfile(candidate);
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),checked.versions);
  return backupWithProfile(checked.profile,client,...args);
}
// Narrow disposable51 profile. Frozen50 remains separately identified and
// recoverable; never relabel a51 dump as the currently registered50 release.
async function booking51CandidateProfile(candidate){
  assert.equal(candidate.file,'20261102180000_booking_conflict_review.sql');
  const bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json')),value=JSON.parse(bytes),frozen=JSON.parse(await readFile(join(root,'tests/support/registered50-migration-checksums.json')));
  assert.equal(frozen.migrations.length,50);assert.equal(value.migrations.length,51);assert.deepEqual(value.migrations.slice(0,50),frozen.migrations);
  assert.equal(hash(bytes),candidate.registrySha256);assert.equal(value.migrations.at(-1).file,candidate.file);assert.equal(value.migrations.at(-1).sha256,candidate.sha256);
  assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
  return {profile:Object.freeze({schemaVersion:51,registrySha256:candidate.registrySha256}),versions:value.migrations.map(m=>m.version)};
}
export async function backupBooking51CandidateDatabase(candidate,client,...args){
  const checked=await booking51CandidateProfile(candidate);
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),checked.versions);
  return backupWithProfile(checked.profile,client,...args);
}
export async function restoreBooking51CandidateDatabase(candidate,...args){return restoreWithProfile((await booking51CandidateProfile(candidate)).profile,...args);}
// Explicit52 construction profile. Never relabel a registered51 recovery point.
async function amendment52CandidateProfile(candidate){
  assert.equal(candidate.file,'20261103180000_quote_amendment_preparation.sql');
  const bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json')),value=JSON.parse(bytes);
  assert.equal(value.migrations.length,52);assert.deepEqual(value.migrations.slice(0,51),legacy51.migrations);
  assert.equal(hash(bytes),candidate.registrySha256);assert.equal(value.migrations.at(-1).file,candidate.file);assert.equal(value.migrations.at(-1).sha256,candidate.sha256);
  assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
  return {profile:Object.freeze({schemaVersion:52,registrySha256:candidate.registrySha256}),versions:value.migrations.map(m=>m.version)};
}
export async function backupAmendment52CandidateDatabase(candidate,client,...args){
  const checked=await amendment52CandidateProfile(candidate);
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),checked.versions);
  return backupWithProfile(checked.profile,client,...args);
}
export async function restoreAmendment52CandidateDatabase(candidate,...args){return restoreWithProfile((await amendment52CandidateProfile(candidate)).profile,...args);}
async function amendment53CandidateProfile(candidate){
  assert.equal(candidate.file,'20261104180000_quote_amendment_acceptance.sql');
  const bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json')),value=JSON.parse(bytes);
  assert.equal(value.migrations.length,53);assert.deepEqual(value.migrations.slice(0,52),legacy52.migrations);
  assert.equal(hash(bytes),candidate.registrySha256);assert.equal(value.migrations.at(-1).file,candidate.file);assert.equal(value.migrations.at(-1).sha256,candidate.sha256);
  assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
  return {profile:Object.freeze({schemaVersion:53,registrySha256:candidate.registrySha256}),versions:value.migrations.map(m=>m.version)};
}
export async function backupAmendment53CandidateDatabase(candidate,client,...args){
  const checked=await amendment53CandidateProfile(candidate);
  assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(r=>r.version),checked.versions);
  return backupWithProfile(checked.profile,client,...args);
}
export async function restoreAmendment53CandidateDatabase(candidate,...args){return restoreWithProfile((await amendment53CandidateProfile(candidate)).profile,...args);}
export async function backupLegacy53Database(client,...args){
 assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version),legacy53.migrations.map(row=>row.version));
 return backupWithProfile(legacy53Profile,client,...args);
}
export async function restoreLegacy53Database(...args){return restoreWithProfile(legacy53Profile,...args);}
async function field54CandidateProfile(candidate){
 assert.equal(candidate.file,'20261105180000_field_workspace.sql');
 const bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json')),value=JSON.parse(bytes);
 assert.equal(value.migrations.length,54);assert.deepEqual(value.migrations.slice(0,53),legacy53.migrations);assert.deepEqual(value.migrations.map(row=>row.version),field54Versions);
 assert.equal(hash(bytes),candidate.registrySha256);assert.equal(candidate.previousRegistrySha256,hash(legacy53Bytes));assert.equal(value.migrations.at(-1).file,candidate.file);assert.equal(value.migrations.at(-1).sha256,candidate.sha256);
 assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
 return {profile:Object.freeze({schemaVersion:54,registrySha256:candidate.registrySha256}),versions:field54Versions};
}
export async function backupField54CandidateDatabase(candidate,client,...args){
 const checked=await field54CandidateProfile(candidate);assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version),checked.versions);
 return backupWithProfile(checked.profile,client,...args);
}
export async function restoreField54CandidateDatabase(candidate,...args){return restoreWithProfile((await field54CandidateProfile(candidate)).profile,...args);}
async function backupWithProfile(profile,client,url,directory,recipient,duringSnapshot=async()=>{},objectCapture){
  target(url);let stage='snapshot';await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS value')).rows[0].value;
    if(profile===currentProfile||profile===legacy52Profile||profile.schemaVersion===53||profile.schemaVersion===54){
      // A matching migration ordinal alone cannot label a construction schema
      // with an additional source column as the registered current profile.
      // Check the actual columns in the same held snapshot used by the dump.
      stage='coverage';assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version),profile===currentProfile?registry.migrations.map(row=>row.version):profile.schemaVersion===54?field54Versions:profile.schemaVersion===53?legacy53.migrations.map(row=>row.version):(profile===legacy52Profile?legacy52:registry).migrations.map(row=>row.version));
      const columns=(await client.query("SELECT n.nspname||'.'||c.relname AS \"table\",a.attname AS \"column\" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
      verifyExportCoverage(profile===currentProfile?currentCoverage:profile===legacy53Profile?legacy53Coverage:profile.schemaVersion===54?field54Coverage:profile===legacy52Profile?legacy52Coverage:profile.schemaVersion===53?amendment53Coverage:currentCoverage,columns,profile.schemaVersion);
    }
    // Coverage has passed. Pending-object/source refusal belongs to snapshot
    // capture, rather than being misreported as a schema-coverage failure.
    stage='snapshot';const rows=await inventory(client),roles=await roleDefinitions(client);
    // PG stores a policy's role set in OID order. Preserve the relative role
    // creation order for53 so a multi-role policy deparses byte-exact after
    // restore; do not normalize away policy or permission differences.
    let roleCreationOrder;
    if(profile.schemaVersion===53||profile.schemaVersion===54){
      roleCreationOrder=(await client.query("SELECT rolname FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' ORDER BY oid")).rows.map(r=>r.rolname);
      assert.deepEqual([...roleCreationOrder].sort(),roles.map(r=>r.rolname));
    }
    const objects=objectCapture?await objectCapture.inventory(client):undefined;
    stage='schema';const schema=await postgresTool('pg_dump',url,['--schema-only','--snapshot',snapshot]);
    await duringSnapshot();
    stage='dump';const dump=await postgresTool('pg_dump',url,['--format=custom','--snapshot',snapshot]);
    assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';const objectArchive=objectCapture?{inventory:objects,receipt:await objectCapture.capture(objects)}:null;
    const manifest={formatVersion:1,scope:'synthetic_database_drill',completeBackup:false,...profile,
      databaseImage:pins.testDatabaseImage,snapshot,roles,...(roleCreationOrder?{roleCreationOrder}:{}),rows,schemaSha256:hash(normalizedSchema(schema)),
      dump:{bytes:dump.length,sha256:hash(dump)},objectArchive,excluded:['runtime_login_credentials',...(objectArchive?[]:['external_objects']),'application_image','independent_vault','production_configuration','production_recovery_authority']};
    // The backup side receives a public recipient only. No private identity.
    stage='encryption';const receipt={formatVersion:1,dump:await seal(join(directory,'database.age'),dump,recipient),
      manifest:await seal(join(directory,'manifest.age'),Buffer.from(JSON.stringify(manifest)),recipient)};
    await writeFile(join(directory,'receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
    await client.query('COMMIT');return {manifest,receipt};
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_RECOVERY_BACKUP_FAILED:'+stage);}
}
export async function restoreDatabase(...args){return restoreWithProfile(currentProfile,...args);}
export async function restoreLegacy52Database(...args){return restoreWithProfile(legacy52Profile,...args);}
export async function restoreLegacy51Database(...args){return restoreWithProfile(legacy51Profile,...args);}
export async function restoreLegacy50Database(...args){return restoreWithProfile(legacy50Profile,...args);}
export async function restoreLegacy49Database(...args){return restoreWithProfile(legacy49Profile,...args);}
export async function restoreLegacy48Database(...args){return restoreWithProfile(legacy48Profile,...args);}
export async function restoreLegacy47Database(...args){return restoreWithProfile(legacy47Profile,...args);}
export async function restoreLegacy46Database(...args){return restoreWithProfile(legacy46Profile,...args);}
export async function restoreLegacy45Database(...args){return restoreWithProfile(legacy45Profile,...args);}
export async function restoreLegacy44Database(...args){return restoreWithProfile(legacy44Profile,...args);}
export async function restoreLegacy43Database(...args){return restoreWithProfile(legacy43Profile,...args);}
export async function restoreLegacy42Database(...args){return restoreWithProfile(legacy42Profile,...args);}
export async function restoreBooking50CandidateDatabase(candidate,...args){return restoreWithProfile((await booking50CandidateProfile(candidate)).profile,...args);}
async function restoreWithProfile(profile,directory,identity,url,restoreObjects){
  target(url);const client=await connect(url);let stage='empty_destination';
  try{
    assert.equal((await inventory(client)).length,0,'restore target must be empty');
    assert.equal((await client.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','public')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS occupied")).rows[0].occupied,false,'restore target has existing definitions');
    stage='receipt';const receipt=JSON.parse(await readFile(join(directory,'receipt.json'),'utf8'));assert.equal(receipt.formatVersion,1);
    stage='manifest';const manifest=JSON.parse((await unseal(join(directory,'manifest.age'),receipt.manifest,identity)).toString());
    assert.equal(manifest.formatVersion,1);assert.equal(manifest.scope,'synthetic_database_drill');assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.schemaVersion,profile.schemaVersion);assert.equal(manifest.registrySha256,profile.registrySha256);assert.equal(manifest.databaseImage,pins.testDatabaseImage);
    stage='authenticated_dump';const dump=await unseal(join(directory,'database.age'),receipt.dump,identity);
    assert.equal(dump.length,manifest.dump.bytes);assert.equal(hash(dump),manifest.dump.sha256);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';if(manifest.objectArchive){assert.equal(typeof restoreObjects,'function');await restoreObjects(manifest.objectArchive);}
    // Fully decrypt/authenticate/check BEFORE executing SQL. The bounded fixture
    // stays in memory; no partial plaintext dump is written to disk or published.
    stage='closed_roles';let orderedRoles=manifest.roles;
    if(profile.schemaVersion===53||profile.schemaVersion===54){
      assert(Array.isArray(manifest.roleCreationOrder));
      assert(manifest.roleCreationOrder.every(name=>typeof name==='string'&&/^crest_[a-z_]+$/.test(name)));
      assert.deepEqual([...manifest.roleCreationOrder].sort(),manifest.roles.map(r=>r.rolname));
      assert.equal(new Set(manifest.roleCreationOrder).size,manifest.roles.length);
      orderedRoles=manifest.roleCreationOrder.map(name=>manifest.roles.find(r=>r.rolname===name));
    }
    for(const r of orderedRoles){
      assert.match(r.rolname,/^crest_[a-z_]+$/);
      assert(!r.rolsuper&&!r.rolinherit&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolcanlogin&&!r.rolreplication&&!r.rolbypassrls&&r.rolconnlimit===-1&&r.rolconfig===null);
      // Restore only closed migration roles; fresh runtime credentials are separate.
      if(!(await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[r.rolname])).rowCount)
        await client.query(`CREATE ROLE "${r.rolname}" NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    }
    assert.deepEqual(await roleDefinitions(client),manifest.roles);
    stage='restore';await postgresTool('pg_restore',url,['--exit-on-error','--single-transaction'],dump);
    stage='rows';assert.deepEqual(await inventory(client),manifest.rows,'restored row content differs');
    stage='schema';assert.equal(hash(normalizedSchema(await postgresTool('pg_dump',url,['--schema-only']))),manifest.schemaSha256,'restored schema/grants differ');
    return manifest;
  }catch{throw new Error('SYNTHETIC_RECOVERY_RESTORE_FAILED:'+stage);}finally{await client.end();}
}
export async function recoveryCluster(){
  assert.equal(process.env.CREST_ENV,'test');const password=randomBytes(32).toString('hex');
  const name=`crest-recovery-${randomBytes(8).toString('hex')}`;let owned=false;const clients=[];
  try{
    const id=(await run('docker',['create','--name',name,'--publish','127.0.0.1::5432','--env','POSTGRES_USER=supabase_admin','--env','POSTGRES_DB=crest_test','--env','POSTGRES_PASSWORD',pins.testDatabaseImage],{env:{...process.env,POSTGRES_PASSWORD:password}})).toString().trim();
    assert.match(id,/^[a-f0-9]{64}$/);owned=true;await run('docker',['start',name]);
    const binding=JSON.parse((await run('docker',['inspect','--format','{{json (index .NetworkSettings.Ports "5432/tcp")}}',name])).toString());
    assert.equal(binding.length,1);assert.equal(binding[0].HostIp,'127.0.0.1');assert.match(binding[0].HostPort,/^\d+$/);
    const base=`postgresql://supabase_admin:${password}@127.0.0.1:${binding[0].HostPort}`;
    let admin;const deadline=Date.now()+45000;
    while(Date.now()<deadline){
      const probe=new pg.Client({connectionString:base+'/crest_test',connectionTimeoutMillis:1000});
      try{await probe.connect();admin=probe;break;}catch{await probe.end().catch(()=>{});await delay(250);}
    }
    assert(admin,'recovery cluster not ready');clients.push(admin);
    return {testDatabaseUrl:base+'/crest_test',async database(){
      const db=`crest_migrate_${randomBytes(8).toString('hex')}`;await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);return base+'/'+db;
    },async close(){for(const c of clients)await c.end();if(owned){await run('docker',['rm','--force','--volumes',name]);owned=false;}}};
  }catch{for(const c of clients)await c.end().catch(()=>{});if(owned)await run('docker',['rm','--force','--volumes',name]);throw new Error('SYNTHETIC_RECOVERY_CLUSTER_FAILED');}
}
