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
import {financeAccountSourceColumns} from '../../src/bookkeeping/finance-account-source.ts';

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
const legacy55Bytes=await readFile(join(root,'tests/support/registered55-migration-checksums.json')),legacy55=JSON.parse(legacy55Bytes);
assert.equal(legacy55.migrations.length,55);assert.deepEqual(registry.migrations.slice(0,55),legacy55.migrations);
const legacy55Coverage=JSON.parse(await readFile(join(root,'tests/support/registered55-export-coverage.json'),'utf8'));
const legacy55Profile=Object.freeze({schemaVersion:55,registrySha256:hash(legacy55Bytes)});
const legacy56Bytes=await readFile(join(root,'tests/support/registered56-migration-checksums.json')),legacy56=JSON.parse(legacy56Bytes);
assert.equal(legacy56.migrations.length,56);assert.deepEqual(registry.migrations.slice(0,56),legacy56.migrations);
const legacy56Coverage=JSON.parse(await readFile(join(root,'tests/support/registered56-export-coverage.json'),'utf8'));
const legacy56Profile=Object.freeze({schemaVersion:56,registrySha256:hash(legacy56Bytes)});
const legacy57Bytes=await readFile(join(root,'tests/support/registered57-migration-checksums.json')),legacy57=JSON.parse(legacy57Bytes);
assert.equal(legacy57.migrations.length,57);assert.deepEqual(registry.migrations.slice(0,57),legacy57.migrations);
const legacy57Coverage=JSON.parse(await readFile(join(root,'tests/support/registered57-export-coverage.json'),'utf8'));
const legacy57Profile=Object.freeze({schemaVersion:57,registrySha256:hash(legacy57Bytes)});
const legacy58Bytes=await readFile(join(root,'tests/support/registered58-migration-checksums.json')),legacy58=JSON.parse(legacy58Bytes);
assert.equal(legacy58.migrations.length,58);assert.deepEqual(registry.migrations.slice(0,58),legacy58.migrations);
const legacy58Coverage=JSON.parse(await readFile(join(root,'tests/support/registered58-export-coverage.json'),'utf8'));
const legacy58Profile=Object.freeze({schemaVersion:58,registrySha256:hash(legacy58Bytes)});
const legacy59Bytes=await readFile(join(root,'tests/support/registered59-migration-checksums.json')),legacy59=JSON.parse(legacy59Bytes);
assert.equal(legacy59.migrations.length,59);assert.deepEqual(registry.migrations.slice(0,59),legacy59.migrations);
const legacy59Coverage=JSON.parse(await readFile(join(root,'tests/support/registered59-export-coverage.json'),'utf8'));
const legacy59Profile=Object.freeze({schemaVersion:59,registrySha256:hash(legacy59Bytes)});
const legacy60Bytes=await readFile(join(root,'tests/support/registered60-migration-checksums.json')),legacy60=JSON.parse(legacy60Bytes);
assert.equal(legacy60.migrations.length,60);assert.deepEqual(registry.migrations.slice(0,60),legacy60.migrations);
const legacy60Coverage=JSON.parse(await readFile(join(root,'tests/support/registered60-export-coverage.json'),'utf8'));
const legacy60Profile=Object.freeze({schemaVersion:60,registrySha256:hash(legacy60Bytes)});
const legacy61Bytes=await readFile(join(root,'tests/support/registered61-migration-checksums.json')),legacy61=JSON.parse(legacy61Bytes);
assert.equal(legacy61.migrations.length,61);assert.deepEqual(registry.migrations.slice(0,61),legacy61.migrations);
const legacy61Coverage=JSON.parse(await readFile(join(root,'tests/support/registered61-export-coverage.json'),'utf8'));
const legacy61Profile=Object.freeze({schemaVersion:61,registrySha256:hash(legacy61Bytes)});
const legacy62Bytes=await readFile(join(root,'tests/support/registered62-migration-checksums.json')),legacy62=JSON.parse(legacy62Bytes);
assert.equal(legacy62.migrations.length,62);assert.deepEqual(registry.migrations.slice(0,62),legacy62.migrations);
const legacy62Coverage=JSON.parse(await readFile(join(root,'tests/support/registered62-export-coverage.json'),'utf8'));
const legacy62Profile=Object.freeze({schemaVersion:62,registrySha256:hash(legacy62Bytes)});
const legacy63Bytes=await readFile(join(root,'tests/support/registered63-migration-checksums.json')),legacy63=JSON.parse(legacy63Bytes);
assert.equal(legacy63.migrations.length,63);assert.deepEqual(registry.migrations.slice(0,63),legacy63.migrations);
const legacy63Coverage=JSON.parse(await readFile(join(root,'tests/support/registered63-export-coverage.json'),'utf8'));
const legacy63Profile=Object.freeze({schemaVersion:63,registrySha256:hash(legacy63Bytes)});
const legacy64Bytes=await readFile(join(root,'tests/support/registered64-migration-checksums.json')),legacy64=JSON.parse(legacy64Bytes);
assert.equal(legacy64.migrations.length,64);assert.deepEqual(registry.migrations.slice(0,64),legacy64.migrations);
const legacy64Coverage=JSON.parse(await readFile(join(root,'tests/support/registered64-export-coverage.json'),'utf8'));
const legacy64Profile=Object.freeze({schemaVersion:64,registrySha256:hash(legacy64Bytes)});
const legacy65Bytes=await readFile(join(root,'tests/support/registered65-migration-checksums.json')),legacy65=JSON.parse(legacy65Bytes);
assert.equal(legacy65.migrations.length,65);assert.deepEqual(registry.migrations.slice(0,65),legacy65.migrations);
const legacy65Coverage=JSON.parse(await readFile(join(root,'tests/support/registered65-export-coverage.json'),'utf8'));
const legacy65Profile=Object.freeze({schemaVersion:65,registrySha256:hash(legacy65Bytes)});
const legacy66Bytes=await readFile(join(root,'tests/support/registered66-migration-checksums.json')),legacy66=JSON.parse(legacy66Bytes);
assert.equal(hash(legacy66Bytes),'f8b1e968201fba0d24b782a9fe3639f0ce6baeea2276eee98c0208ecd0eee28f');
assert.equal(legacy66.migrations.length,66);assert.deepEqual(registry.migrations.slice(0,66),legacy66.migrations);
const legacy66CoverageBytes=await readFile(join(root,'tests/support/registered66-export-coverage.json'));
assert.equal(hash(legacy66CoverageBytes),'93403923d39cf6ba8125ffb5d0114f36a03819396f8bcb3048e1c161a038dcc7');
const legacy66Coverage=JSON.parse(legacy66CoverageBytes);
const legacy66Profile=Object.freeze({schemaVersion:66,registrySha256:hash(legacy66Bytes)});
const legacy68Bytes=await readFile(join(root,'tests/support/registered68-migration-checksums.json')),legacy68=JSON.parse(legacy68Bytes);
assert.equal(hash(legacy68Bytes),'4388e636855e46a0ce83c14af951b73c57b9621f3cf6ff8584fc5d4884469d06');
assert.equal(legacy68.migrations.length,68);assert.deepEqual(registry.migrations.slice(0,68),legacy68.migrations);
const legacy68CoverageBytes=await readFile(join(root,'tests/support/registered68-export-coverage.json'));
assert.equal(hash(legacy68CoverageBytes),'226d4692b549b16374f8e51c0e416cd9b89f920e54f956b9d00f7d8c6aa30b2b');
const legacy68Coverage=JSON.parse(legacy68CoverageBytes);
const legacy68Profile=Object.freeze({schemaVersion:68,registrySha256:hash(legacy68Bytes)});
const legacy69Bytes=await readFile(join(root,'tests/support/registered69-migration-checksums.json')),legacy69=JSON.parse(legacy69Bytes);
assert.equal(legacy69.migrations.length,69);assert.deepEqual(registry.migrations.slice(0,69),legacy69.migrations);
assert.equal(hash(legacy69Bytes),'c43ff400d162d7a4f56c543fa54bf62fa3d54d6eb80ae3c940c480a38f43fe2a');
const legacy69CoverageBytes=await readFile(join(root,'tests/support/registered69-export-coverage.json'));
assert.equal(hash(legacy69CoverageBytes),'c70b5284cbfb4abfdc02442e8e99f50f0c0a095a4483418aacb7aead54512217');
const legacy69Coverage=JSON.parse(legacy69CoverageBytes);
const legacy69Profile=Object.freeze({schemaVersion:69,registrySha256:hash(legacy69Bytes)});
const legacy70Bytes=await readFile(join(root,'tests/support/registered70-migration-checksums.json')),legacy70=JSON.parse(legacy70Bytes);
assert.equal(hash(legacy70Bytes),'196cf9e6daffb9c4398a36c6010423545013ec5fa6049defd4ddf3025a858d54');
assert.equal(legacy70.migrations.length,70);assert.deepEqual(registry.migrations.slice(0,70),legacy70.migrations);
const legacy70CoverageBytes=await readFile(join(root,'tests/support/registered70-export-coverage.json'));
assert.equal(hash(legacy70CoverageBytes),'ea658e83083978f815089ee648461b10ee7bea73ebeab114cc26332e845355e6');
const legacy70Coverage=JSON.parse(legacy70CoverageBytes);
const legacy70Profile=Object.freeze({schemaVersion:70,registrySha256:hash(legacy70Bytes)});
const legacy71Bytes=await readFile(join(root,'tests/support/registered71-migration-checksums.json')),legacy71=JSON.parse(legacy71Bytes);
assert.equal(hash(legacy71Bytes),'5769296d8ee5fcc63b2f1a27c38a88a4cd3f2ffff533bc07723b93883113cef3');
assert.equal(legacy71.migrations.length,71);assert.deepEqual(registry.migrations.slice(0,71),legacy71.migrations);
const legacy71CoverageBytes=await readFile(join(root,'tests/support/registered71-export-coverage.json'));
assert.equal(hash(legacy71CoverageBytes),'cffa35a1da8be180222bb15b2154f272aacc3d5de409da1966edd4a052beb5b3');
const legacy71Coverage=JSON.parse(legacy71CoverageBytes);
const legacy71Profile=Object.freeze({schemaVersion:71,registrySha256:hash(legacy71Bytes)});
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
export function normalizedSchema(bytes,policyRoleSets=[]){
  // PG17's psql restriction nonce is intentionally random; retain every other
  // schema byte except the presentation order of verified Crest policy roles.
  let sql=bytes.toString().replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?$/gm,'');
  for(const {schemaName,tableName,policyName,roles} of policyRoleSets){
    if(!roles.every(role=>/^crest_[a-z_]+$/.test(role)))continue;
    assert(['crest','crest_private'].includes(schemaName));
    assert([tableName,policyName].every(name=>/^[a-z_][a-z0-9_]*$/.test(name)));
    const header=`-- Name: ${tableName} ${policyName}; Type: POLICY; Schema: ${schemaName}; Owner: crest_[a-z_]+`;
    const statement=`CREATE POLICY ${policyName} ON ${schemaName}\\.${tableName}(?: AS RESTRICTIVE)?(?: FOR (?:SELECT|INSERT|UPDATE|DELETE))? TO `;
    const line=new RegExp(`^(${header}\\n--\\n\\n${statement})(crest_[a-z_]+(?:, crest_[a-z_]+)+)(?= USING \\(| WITH CHECK \\(|;)`,'gm');
    let found=0;
    sql=sql.replace(line,(_match,prefix,listed)=>{
      assert.deepEqual(listed.split(', ').sort(),roles);
      found++;
      return prefix+roles.join(', ');
    });
    assert.equal(found,1,'dump must contain the exact policy entry');
  }
  return sql;
}
async function multiRolePolicySets(client){
  const {rows}=await client.query(`SELECT n.nspname AS "schemaName", c.relname AS "tableName", p.polname AS "policyName",
    ARRAY(SELECT CASE WHEN member.oid=0 THEN 'PUBLIC' ELSE r.rolname::text END
      FROM unnest(p.polroles) AS member(oid) LEFT JOIN pg_roles r ON r.oid=member.oid
      ORDER BY (CASE WHEN member.oid=0 THEN 'PUBLIC' ELSE r.rolname::text END) COLLATE "C") AS roles
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('crest','crest_private') AND cardinality(p.polroles)>1
    ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", p.polname COLLATE "C"`);
  for(const row of rows)assert(row.roles.every(role=>typeof role==='string'));
  return rows;
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
export async function backupLegacy55Database(...args){return backupWithProfile(legacy55Profile,...args);}
export async function restoreLegacy55Database(...args){return restoreWithProfile(legacy55Profile,...args);}
export async function backupLegacy56Database(...args){return backupWithProfile(legacy56Profile,...args);}
export async function restoreLegacy56Database(...args){return restoreWithProfile(legacy56Profile,...args);}
export async function backupLegacy57Database(...args){return backupWithProfile(legacy57Profile,...args);}
export async function restoreLegacy57Database(...args){return restoreWithProfile(legacy57Profile,...args);}
export async function backupLegacy58Database(...args){return backupWithProfile(legacy58Profile,...args);}
export async function restoreLegacy58Database(...args){return restoreWithProfile(legacy58Profile,...args);}
export async function backupLegacy59Database(...args){return backupWithProfile(legacy59Profile,...args);}
export async function restoreLegacy59Database(...args){return restoreWithProfile(legacy59Profile,...args);}
export async function backupLegacy60Database(...args){return backupWithProfile(legacy60Profile,...args);}
export async function restoreLegacy60Database(...args){return restoreWithProfile(legacy60Profile,...args);}
export async function backupLegacy61Database(...args){return backupWithProfile(legacy61Profile,...args);}
export async function restoreLegacy61Database(...args){return restoreWithProfile(legacy61Profile,...args);}
export async function backupLegacy62Database(...args){return backupWithProfile(legacy62Profile,...args);}
export async function restoreLegacy62Database(...args){return restoreWithProfile(legacy62Profile,...args);}
export async function backupLegacy63Database(...args){return backupWithProfile(legacy63Profile,...args);}
export async function restoreLegacy63Database(...args){return restoreWithProfile(legacy63Profile,...args);}
export async function backupLegacy64Database(...args){return backupWithProfile(legacy64Profile,...args);}
export async function restoreLegacy64Database(...args){return restoreWithProfile(legacy64Profile,...args);}
export async function backupLegacy65Database(...args){return backupWithProfile(legacy65Profile,...args);}
export async function restoreLegacy65Database(...args){return restoreWithProfile(legacy65Profile,...args);}
export async function backupLegacy66Database(...args){return backupWithProfile(legacy66Profile,...args);}
export async function restoreLegacy66Database(...args){return restoreWithProfile(legacy66Profile,...args);}
export async function backupLegacy68Database(...args){return backupWithProfile(legacy68Profile,...args);}
export async function restoreLegacy68Database(...args){return restoreWithProfile(legacy68Profile,...args);}
export async function backupLegacy69Database(...args){return backupWithProfile(legacy69Profile,...args);}
export async function restoreLegacy69Database(...args){return restoreWithProfile(legacy69Profile,...args);}
export async function backupLegacy70Database(...args){return backupWithProfile(legacy70Profile,...args);}
export async function restoreLegacy70Database(...args){return restoreWithProfile(legacy70Profile,...args);}
export async function backupLegacy71Database(...args){return backupWithProfile(legacy71Profile,...args);}
export async function restoreLegacy71Database(...args){return restoreWithProfile(legacy71Profile,...args);}
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
const dropoffCandidateCoverage={
  ...legacy66Coverage,
  tables:[
    ...legacy66Coverage.tables,
    {table:'crest.custody_cases',scope:'business',
      required:['id','business_id','job_id','job_vehicle_id','vehicle_id','mode','version','state','current_event_id'],
      excluded:[],partialEvidenceGroup:null},
    {table:'crest.custody_events',scope:'business',
      required:['id','business_id','case_id','version','prior_version','action','effective_at','recorded_at',
        'person_snapshot','location_snapshot','notes','missing_photo_reason','created_by','operation_id','origin'],
      excluded:[],partialEvidenceGroup:null}
  ]
};
const dropoffCommandCoverage={
  ...dropoffCandidateCoverage,
  tables:[
    ...legacy66Coverage.tables,
    {...dropoffCandidateCoverage.tables.at(-2),required:[...dropoffCandidateCoverage.tables.at(-2).required,'authorization_config_id']},
    {...dropoffCandidateCoverage.tables.at(-1),required:[...dropoffCandidateCoverage.tables.at(-1).required,
      'acknowledgement_confirmed','condition_photo_id']},
    {table:'crest.custody_authorization_configs',scope:'business',
      required:['id','business_id','mode_version_id','acknowledgement_text','condition_photo_required'],
      excluded:[],partialEvidenceGroup:null},
    {table:'crest.custody_photo_attempts',scope:'business',
      required:['id','business_id','job_id','job_vehicle_id','vehicle_id','case_id','handoff_version','actor_id',
        'recovery_epoch','dispatch_id','declared_type','byte_size','reserved_at'],
      excluded:[],partialEvidenceGroup:null},
    {table:'crest.custody_photo_originals',scope:'business',
      required:['business_id','photo_id','detected_type','byte_size','sha256','validation_version','width','height',
        'display_width','display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height','verified_at'],
      excluded:[],partialEvidenceGroup:null}
  ]
};
async function dropoffCandidateProfile(withCommands=false,withPolicy=false){
  assert.equal(legacy66Profile.schemaVersion,66);
  assert.equal(hash(legacy66Bytes),'f8b1e968201fba0d24b782a9fe3639f0ce6baeea2276eee98c0208ecd0eee28f');
  const proposal=await readFile(join(root,'planning/proposals/dropoff-custody-storage.sql'));
  const heldDropoffProposalSha256=hash(proposal);
  assert.equal(heldDropoffProposalSha256,'229d2ad7460ed9525e1179d3631cb5617eb077c00960cbf0ac19bc1b767ea58e');
  const profile={...legacy66Profile,heldDropoffProposalSha256};
  if(!withCommands)return profile;
  const heldDropoffCommandsSha256=hash(await readFile(join(root,'planning/proposals/dropoff-custody-commands.sql')));
  assert.equal(heldDropoffCommandsSha256,'e92c75c760b7611d8af1c7fb6d641d53c1b669b1c8503d551d869a2079459cf4');
  const heldDropoffPhotosSha256=hash(await readFile(join(root,'planning/proposals/dropoff-custody-photos.sql')));
  assert.equal(heldDropoffPhotosSha256,'3cb3deab2d85c08d8b2b5a0f91e15b86256d2c3e174e2bdb74ab029bc3876126');
  const commandProfile={...profile,heldDropoffCommandsSha256,heldDropoffPhotosSha256};
  if(!withPolicy)return commandProfile;
  const heldDropoffPolicySources={
    reads:'8e9817ac68e46cac6070b11973c8d755d78dab011e3cea9e8584e2251631a7e3',
    policy:'91ed3c4535d9834a89ac99b4f5c1c6dc87ed4f4aec5378f9af679a76fc11d185',
    originals:'17156abaa1319ecb2da7f7c9136a7f950dada870c2773343eec13ab9dabe77f6'
  };
  for(const [part,digest] of Object.entries(heldDropoffPolicySources)){
    assert.equal(hash(await readFile(join(root,'planning/proposals/dropoff-custody-'+part+'.sql'))),digest);
  }
  return {...commandProfile,heldDropoffPolicySources};
}
export async function backupDropoffCandidateDatabase(...args){
  return backupWithProfile(await dropoffCandidateProfile(),...args);
}
export async function restoreDropoffCandidateDatabase(...args){
  return restoreWithProfile(await dropoffCandidateProfile(),...args);
}
export async function backupDropoffCommandDatabase(...args){
  return backupWithProfile(await dropoffCandidateProfile(true),...args);
}
export async function restoreDropoffCommandDatabase(...args){
  return restoreWithProfile(await dropoffCandidateProfile(true),...args);
}
export async function backupDropoffPolicyDatabase(...args){
  return backupWithProfile(await dropoffCandidateProfile(true,true),...args);
}
export async function restoreDropoffPolicyDatabase(...args){
  return restoreWithProfile(await dropoffCandidateProfile(true,true),...args);
}
async function dropoffPhotoProfile(){
  const profile=await dropoffCandidateProfile(true,true);
  const heldDropoffPhotoAuthority=hash(await readFile(join(root,'planning/proposals/dropoff-custody-photo-commands.sql')));
  assert.equal(heldDropoffPhotoAuthority,'6aeda567169e88aa1daad516064a4635faeb37dc3b94a6c265b612604a449f74');
  return {...profile,heldDropoffPhotoAuthority};
}
export async function backupDropoffPhotoDatabase(client,url,directory,recipient,objectCapture){
  assert(objectCapture);
  return backupWithProfile(await dropoffPhotoProfile(),client,url,directory,recipient,undefined,objectCapture);
}
export async function restoreDropoffPhotoDatabase(directory,identity,url,restoreObjects){
  assert.equal(typeof restoreObjects,'function');
  return restoreWithProfile(await dropoffPhotoProfile(),directory,identity,url,restoreObjects);
}
async function dropoffPhotoAccessProfile(){
  const profile=await dropoffPhotoProfile();
  const sourceSha256=hash(await readFile(join(root,'planning/proposals/dropoff-custody-photo-access.sql')));
  assert.equal(sourceSha256,'8cecaee637196581da81af56ba7bb3f6de83c2d5eb297395a463fa87baa4dd13');
  return {...profile,heldDropoffPhotoAccess:sourceSha256};
}
export async function backupDropoffPhotoAccessDatabase(client,url,directory,recipient,objectCapture){
  assert(objectCapture);
  return backupWithProfile(await dropoffPhotoAccessProfile(),client,url,directory,recipient,undefined,objectCapture);
}
export async function restoreDropoffPhotoAccessDatabase(directory,identity,url,restoreObjects){
  assert.equal(typeof restoreObjects,'function');
  return restoreWithProfile(await dropoffPhotoAccessProfile(),directory,identity,url,restoreObjects);
}
async function dropoffWorkProfile(){
  const profile=await dropoffPhotoAccessProfile();
  const heldDropoffWorkSources={
    work:'a50f9d3627a190ee67d071fc1bfb8829145e70af0e39dbd4a12af225a3e73f9e',
    completion:'f5b2a8255932e558d10cd401a7dce5ad6e7db8c01f2ad704d60b7ee007f50d04',
    queue:'11d0a126e7639e64426b4cb5b12ede3f5ced0c22728a118fb94df3f1e052b25b'
  };
  for(const [part,digest] of Object.entries(heldDropoffWorkSources)){
    assert.equal(hash(await readFile(join(root,'planning/proposals/dropoff-custody-'+part+'.sql'))),digest);
  }
  return {...profile,heldDropoffWorkSources};
}
export async function backupDropoffWorkDatabase(client,url,directory,recipient,objectCapture){
  assert(objectCapture);
  return backupWithProfile(await dropoffWorkProfile(),client,url,directory,recipient,undefined,objectCapture);
}
export async function restoreDropoffWorkDatabase(directory,identity,url,restoreObjects){
  assert.equal(typeof restoreObjects,'function');
  return restoreWithProfile(await dropoffWorkProfile(),directory,identity,url,restoreObjects);
}
async function dropoff67RecoveryProfile(candidate){
  const frozenBytes=await readFile(join(root,'tests/support/registered66-migration-checksums.json'));
  assert.equal(hash(frozenBytes),'f8b1e968201fba0d24b782a9fe3639f0ce6baeea2276eee98c0208ecd0eee28f');
  const frozen=JSON.parse(frozenBytes),bytes=await readFile(join(candidate.directory,'supabase/migration-checksums.json'));
  const registered=JSON.parse(bytes);assert.equal(registered.migrations.length,67);
  assert.deepEqual(registered.migrations.slice(0,66),frozen.migrations);
  assert.equal(candidate.file,'20261121180000_dropoff_custody.sql');
  assert.equal(hash(bytes),candidate.registrySha256);
  assert.equal(registered.migrations.at(-1).file,candidate.file);
  assert.equal(registered.migrations.at(-1).sha256,candidate.sha256);
  assert.equal(hash(await readFile(join(candidate.directory,'supabase/migrations',candidate.file))),candidate.sha256);
  return {profile:Object.freeze({schemaVersion:67,registrySha256:candidate.registrySha256,
    heldCustody67MigrationSha256:candidate.sha256}),
    versions:registered.migrations.map(row=>row.version),coverage:{...dropoffCommandCoverage,migrationCount:67}};
}
export async function backupDropoff67CandidateDatabase(candidate,client,url,directory,recipient,objectCapture){
  assert(objectCapture);const checked=await dropoff67RecoveryProfile(candidate);
  return backupWithProfile(checked.profile,client,url,directory,recipient,undefined,objectCapture,checked);
}
export async function restoreDropoff67CandidateDatabase(candidate,directory,identity,url,restoreObjects){
  assert.equal(typeof restoreObjects,'function');
  return restoreWithProfile((await dropoff67RecoveryProfile(candidate)).profile,directory,identity,url,restoreObjects);
}
async function pickupReturnRecoveryProfile(failures){
  assert.equal(typeof failures,'boolean');
  const heldPickupReturnSources={
    'worksite-transport':'948e6c903586167ff906f34c6e031f7d562b9aa0ab7d35697e0340faeb7e7e1c',
    'work-session':'a70c019dfd0b156a39d82ee6dedbe1e91725ae5974364d6fe0031877f33d3c49',
    'custody-release':'28a694b7dcd026ed1ff1b30614ec461e719245a2be546f1f9f5e7d9ff7efb4db',
    'return-source':'52d0caa6d202d0870d83c14060fc7595290dfba773409eb85ef083c7cba19aa3',
    ...failures?{
      'return-failure':'05c10c2f0b4ae39b893f9092729dd75b331db6533c4a9b022677a8960f4ae9c1',
      'return-failure-source':'5a0fada6851b13bee6e8491a2678087c7c524cc66af7560e85cae9b78d47fd93',
      'return-queue':'a8ab5c6e66a90591cc240935fb9d2f6aa4c44f4502ad1122347bafd726902ab2'
    }:{}
  };
  for(const [part,digest] of Object.entries(heldPickupReturnSources)){
    assert.equal(hash(await readFile(join(root,'planning/proposals/pickup-'+part+'.sql'))),digest);
  }
  const tables=legacy69Coverage.tables.map(entry=>entry.table==='crest_private.pickup_photo_slots'
    ? {...entry,required:[...entry.required,'return_collection_id']} : entry);
  tables.push({table:'crest_private.pickup_custody_releases',scope:'business',required:[
    'id','business_id','collection_id','job_id','job_vehicle_id','vehicle_id','policy_id','return_leg_version_id',
    'job_version','effective_at','recorded_at','person_snapshot','location_snapshot','notes','missing_photo_reason',
    'condition_photo_id','acknowledgement_confirmed','created_by','operation_id'
  ],excluded:[],partialEvidenceGroup:null});
  if(failures)tables.push({table:'crest_private.pickup_return_failures',scope:'business',required:[
    'id','business_id','collection_id','return_leg_version_id','job_version','reason','recorded_at','created_by','operation_id'
  ],excluded:[],partialEvidenceGroup:null});
  return {profile:{...legacy69Profile,heldPickupReturnSources},versions:legacy69.migrations.map(row=>row.version),
    coverage:{...legacy69Coverage,tables}};
}
export async function backupPickupReturnCandidateDatabase(client,url,directory,recipient,objectCapture,{failures=false}={}){
  assert(objectCapture);const checked=await pickupReturnRecoveryProfile(failures);
  return backupWithProfile(checked.profile,client,url,directory,recipient,undefined,objectCapture,checked);
}
export async function restorePickupReturnCandidateDatabase(directory,identity,url,restoreObjects,{failures=false}={}){
  assert.equal(typeof restoreObjects,'function');
  return restoreWithProfile((await pickupReturnRecoveryProfile(failures)).profile,directory,identity,url,restoreObjects);
}
async function financeAccountsRecoveryProfile() {
  const heldFinanceAccountsSha256='9ae3cec08432dd15958bef225e074433387e31da9814ba42ac34d3a1e60878f6';
  const heldFinanceAccountCommandsSha256='55a6b43144bf4d6e806c50c2910279f8788e37d0911e0672a8486ee88ec5e11d';
  const heldFinanceAccountMappingsSha256='d3feafea6cebdd333f0f73a7a6a38ff006cb8c66d7502a35acc32c4d48e184a6';
  assert.equal(hash(await readFile(join(root,'planning/proposals/finance-accounts.sql'))),heldFinanceAccountsSha256);
  assert.equal(hash(await readFile(join(root,'planning/proposals/finance-account-commands.sql'))),heldFinanceAccountCommandsSha256);
  assert.equal(hash(await readFile(join(root,'planning/proposals/finance-account-mappings.sql'))),heldFinanceAccountMappingsSha256);
  const tables=Object.entries(financeAccountSourceColumns).map(([name,columns])=>({
    table:'crest.'+name,scope:'business',required:[...columns],excluded:[],partialEvidenceGroup:null
  }));
  tables.push({table:'crest_private.finance_controls',scope:'business',
    required:['id','business_id','recovery_authority_id','created_at','created_by','origin'],excluded:[],partialEvidenceGroup:null});
  return {profile:{...legacy70Profile,heldFinanceAccountsSha256,heldFinanceAccountCommandsSha256,heldFinanceAccountMappingsSha256},versions:legacy70.migrations.map(row=>row.version),
    coverage:{...legacy70Coverage,tables:[...legacy70Coverage.tables,...tables]}};
}
export async function backupFinanceAccountsCandidateDatabase(client,url,directory,recipient) {
  const checked=await financeAccountsRecoveryProfile();
  return backupWithProfile(checked.profile,client,url,directory,recipient,undefined,undefined,checked);
}
export async function restoreFinanceAccountsCandidateDatabase(directory,identity,url) {
  return restoreWithProfile((await financeAccountsRecoveryProfile()).profile,directory,identity,url);
}
async function backupWithProfile(profile,client,url,directory,recipient,duringSnapshot=async()=>{},objectCapture,checkedSnapshot){
  assert(checkedSnapshot===undefined||checkedSnapshot.profile===profile&&
    (profile.schemaVersion===67&&profile.heldCustody67MigrationSha256
      ||profile.schemaVersion===69&&profile.heldPickupReturnSources
      ||profile.schemaVersion===70&&profile.heldFinanceAccountsSha256
      ));
  target(url);let stage='snapshot';await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS value')).rows[0].value;
    if(checkedSnapshot||profile===currentProfile||profile===legacy71Profile||profile===legacy70Profile||profile===legacy69Profile||profile===legacy68Profile||profile===legacy66Profile||profile.heldDropoffProposalSha256||profile===legacy65Profile||profile===legacy64Profile||profile===legacy63Profile||profile===legacy62Profile||profile===legacy61Profile||profile===legacy60Profile||profile===legacy59Profile||profile===legacy58Profile||profile===legacy57Profile||profile===legacy56Profile||profile===legacy55Profile||profile===legacy52Profile||profile.schemaVersion===53||profile.schemaVersion===54){
      // A matching migration ordinal alone cannot label a construction schema
      // with an additional source column as the registered current profile.
      // Check the actual columns in the same held snapshot used by the dump.
      const versions=checkedSnapshot?checkedSnapshot.versions:
        profile.heldDropoffProposalSha256?legacy66.migrations.map(row=>row.version):profile.schemaVersion===54?field54Versions:
        (profile===legacy71Profile?legacy71:profile===legacy70Profile?legacy70:profile===legacy69Profile?legacy69:profile===legacy68Profile?legacy68:profile===legacy66Profile?legacy66:profile===legacy65Profile?legacy65:profile===legacy64Profile?legacy64:profile===legacy63Profile?legacy63:profile===legacy62Profile?legacy62:profile===legacy61Profile?legacy61:profile===legacy60Profile?legacy60:profile===legacy59Profile?legacy59:profile===legacy58Profile?legacy58:profile===legacy57Profile?legacy57:profile===legacy56Profile?legacy56:profile===legacy55Profile?legacy55:profile.schemaVersion===53?legacy53:profile===legacy52Profile?legacy52:registry).migrations.map(row=>row.version);
      stage='coverage';assert.deepEqual((await client.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version')).rows.map(row=>row.version),versions);
      const columns=(await client.query("SELECT n.nspname||'.'||c.relname AS \"table\",a.attname AS \"column\" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2")).rows;
      const coverage=checkedSnapshot?checkedSnapshot.coverage:profile===legacy71Profile?legacy71Coverage:profile===legacy70Profile?legacy70Coverage:profile===legacy69Profile?legacy69Coverage:profile===legacy68Profile?legacy68Coverage:profile.heldDropoffCommandsSha256?dropoffCommandCoverage:profile.heldDropoffProposalSha256?dropoffCandidateCoverage:profile===legacy66Profile?legacy66Coverage:profile===legacy65Profile?legacy65Coverage:profile===legacy64Profile?legacy64Coverage:profile===legacy63Profile?legacy63Coverage:profile===legacy62Profile?legacy62Coverage:profile===legacy61Profile?legacy61Coverage:profile===legacy60Profile?legacy60Coverage:profile===legacy59Profile?legacy59Coverage:profile===legacy58Profile?legacy58Coverage:profile===legacy57Profile?legacy57Coverage:profile===legacy56Profile?legacy56Coverage:profile===legacy55Profile?legacy55Coverage:profile===legacy53Profile?legacy53Coverage:profile.schemaVersion===54?field54Coverage:profile===legacy52Profile?legacy52Coverage:profile.schemaVersion===53?amendment53Coverage:currentCoverage;
      verifyExportCoverage(coverage,columns,profile.schemaVersion);
    }
    // Coverage has passed. Pending-object/source refusal belongs to snapshot
    // capture, rather than being misreported as a schema-coverage failure.
    stage='snapshot';const rows=await inventory(client),roles=await roleDefinitions(client);
    // PG stores a policy's role set in OID order. Preserve the relative role
    // creation order from schema53 so a multi-role policy deparses byte-exact after
    // restore; do not normalize away policy or permission differences.
    let roleCreationOrder;
    if(profile.schemaVersion>=53){
      roleCreationOrder=(await client.query("SELECT rolname FROM pg_roles WHERE rolname ~ '^crest_[a-z_]+$' ORDER BY oid")).rows.map(r=>r.rolname);
      assert.deepEqual([...roleCreationOrder].sort(),roles.map(r=>r.rolname));
    }
    const schemaPolicyRoles=profile.schemaVersion>=55?await multiRolePolicySets(client):undefined;
    const objects=objectCapture?await objectCapture.inventory(client):undefined;
    stage='schema';const schema=await postgresTool('pg_dump',url,['--schema-only','--snapshot',snapshot]);
    await duringSnapshot();
    stage='dump';const dump=await postgresTool('pg_dump',url,['--format=custom','--snapshot',snapshot]);
    assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';const objectArchive=objectCapture?{inventory:objects,receipt:await objectCapture.capture(objects)}:null;
    const manifest={formatVersion:1,scope:'synthetic_database_drill',completeBackup:false,...profile,
      databaseImage:pins.testDatabaseImage,snapshot,roles,...(roleCreationOrder?{roleCreationOrder}:{}),rows,
      ...(schemaPolicyRoles?{schemaPolicyRoles}:{}),schemaSha256:hash(normalizedSchema(schema,schemaPolicyRoles)),
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
    assert.equal(manifest.heldDropoffProposalSha256,profile.heldDropoffProposalSha256);
    assert.equal(manifest.heldDropoffCommandsSha256,profile.heldDropoffCommandsSha256);
    assert.equal(manifest.heldDropoffPhotosSha256,profile.heldDropoffPhotosSha256);
    assert.deepEqual(manifest.heldDropoffPolicySources,profile.heldDropoffPolicySources);
    assert.equal(manifest.heldDropoffPhotoAuthority,profile.heldDropoffPhotoAuthority);
    assert.equal(manifest.heldDropoffPhotoAccess,profile.heldDropoffPhotoAccess);
    assert.deepEqual(manifest.heldDropoffWorkSources,profile.heldDropoffWorkSources);
    assert.equal(manifest.heldCustody67MigrationSha256,profile.heldCustody67MigrationSha256);
    assert.deepEqual(manifest.heldPickupReturnSources,profile.heldPickupReturnSources);
    assert.equal(manifest.heldFinanceAccountsSha256,profile.heldFinanceAccountsSha256);
    assert.equal(manifest.heldFinanceAccountCommandsSha256,profile.heldFinanceAccountCommandsSha256);
    assert.equal(manifest.heldFinanceAccountMappingsSha256,profile.heldFinanceAccountMappingsSha256);
    assert.equal(manifest.heldFinanceTaxProfilesSha256,profile.heldFinanceTaxProfilesSha256);
    if(profile.heldDropoffPhotoAuthority||profile.heldCustody67MigrationSha256||profile.heldPickupReturnSources)assert(manifest.objectArchive);
    stage='authenticated_dump';const dump=await unseal(join(directory,'database.age'),receipt.dump,identity);
    assert.equal(dump.length,manifest.dump.bytes);assert.equal(hash(dump),manifest.dump.sha256);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';if(manifest.objectArchive){assert.equal(typeof restoreObjects,'function');await restoreObjects(manifest.objectArchive);}
    // Fully decrypt/authenticate/check BEFORE executing SQL. The bounded fixture
    // stays in memory; no partial plaintext dump is written to disk or published.
    stage='closed_roles';let orderedRoles=manifest.roles;
    if(profile.schemaVersion>=53){
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
    stage='schema';
    const policyRoleSets=profile.schemaVersion>=55?await multiRolePolicySets(client):undefined;
    if(policyRoleSets)assert.deepEqual(policyRoleSets,manifest.schemaPolicyRoles,'restored policy role sets differ');
    assert.equal(hash(normalizedSchema(await postgresTool('pg_dump',url,['--schema-only']),policyRoleSets)),manifest.schemaSha256,'restored schema/grants differ');
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
