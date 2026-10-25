// Bounded, synthetic-only recovery machinery. No production escape flag or
// runtime/vault credentials. Dumps are trusted executable SQL, never user uploads.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { migrationTestTarget } from '../../src/tooling/migration-coordinator.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const pins=JSON.parse(await readFile(join(root,'release/toolchain.json'),'utf8'));
const registry=JSON.parse(await readFile(join(root,'supabase/migration-checksums.json'),'utf8'));
const registryHash=hash(await readFile(join(root,'supabase/migration-checksums.json')));
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
  assert.equal(process.env.CREST_ENV,'test');
  const base=join(root,'.local/recovery-drill');await mkdir(base,{recursive:true,mode:0o700});
  const directory=await mkdtemp(join(base,'case-'));await chmod(directory,0o700);return directory;
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
  return run('docker',['run','--rm','--interactive','--network','host','--env','PGPASSWORD',pins.testDatabaseImage,name,
    '--host',u.hostname.replace(/^\[|\]$/g,''),'--port',u.port||'5432','--username',decodeURIComponent(u.username),'--no-password',
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
export async function backupDatabase(client,url,directory,recipient,duringSnapshot=async()=>{},objectCapture){
  target(url);let stage='snapshot';await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
    const snapshot=(await client.query('SELECT pg_export_snapshot() AS value')).rows[0].value;
    const rows=await inventory(client),roles=await roleDefinitions(client);
    const objects=objectCapture?await objectCapture.inventory(client):undefined;
    stage='schema';const schema=await postgresTool('pg_dump',url,['--schema-only','--snapshot',snapshot]);
    await duringSnapshot();
    stage='dump';const dump=await postgresTool('pg_dump',url,['--format=custom','--snapshot',snapshot]);
    assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';const objectArchive=objectCapture?{inventory:objects,receipt:await objectCapture.capture(objects)}:null;
    const manifest={formatVersion:1,scope:'synthetic_database_drill',completeBackup:false,schemaVersion:registry.migrations.length,
      registrySha256:registryHash,databaseImage:pins.testDatabaseImage,snapshot,roles,rows,schemaSha256:hash(normalizedSchema(schema)),
      dump:{bytes:dump.length,sha256:hash(dump)},objectArchive,excluded:['runtime_login_credentials',...(objectArchive?[]:['external_objects']),'application_image','independent_vault','production_configuration','production_recovery_authority']};
    // The backup side receives a public recipient only. No private identity.
    stage='encryption';const receipt={formatVersion:1,dump:await seal(join(directory,'database.age'),dump,recipient),
      manifest:await seal(join(directory,'manifest.age'),Buffer.from(JSON.stringify(manifest)),recipient)};
    await writeFile(join(directory,'receipt.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});
    await client.query('COMMIT');return {manifest,receipt};
  }catch{await client.query('ROLLBACK');throw new Error('SYNTHETIC_RECOVERY_BACKUP_FAILED:'+stage);}
}
export async function restoreDatabase(directory,identity,url,restoreObjects){
  target(url);const client=await connect(url);let stage='empty_destination';
  try{
    assert.equal((await inventory(client)).length,0,'restore target must be empty');
    assert.equal((await client.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','public')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS occupied")).rows[0].occupied,false,'restore target has existing definitions');
    stage='receipt';const receipt=JSON.parse(await readFile(join(directory,'receipt.json'),'utf8'));assert.equal(receipt.formatVersion,1);
    stage='manifest';const manifest=JSON.parse((await unseal(join(directory,'manifest.age'),receipt.manifest,identity)).toString());
    assert.equal(manifest.formatVersion,1);assert.equal(manifest.scope,'synthetic_database_drill');assert.equal(manifest.completeBackup,false);
    assert.equal(manifest.schemaVersion,registry.migrations.length);assert.equal(manifest.registrySha256,registryHash);assert.equal(manifest.databaseImage,pins.testDatabaseImage);
    stage='authenticated_dump';const dump=await unseal(join(directory,'database.age'),receipt.dump,identity);
    assert.equal(dump.length,manifest.dump.bytes);assert.equal(hash(dump),manifest.dump.sha256);assert.equal(dump.subarray(0,5).toString(),'PGDMP');
    stage='objects';if(manifest.objectArchive){assert.equal(typeof restoreObjects,'function');await restoreObjects(manifest.objectArchive);}
    // Fully decrypt/authenticate/check BEFORE executing SQL. The bounded fixture
    // stays in memory; no partial plaintext dump is written to disk or published.
    stage='closed_roles';for(const r of manifest.roles){
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
    return {async database(){
      const db=`crest_migrate_${randomBytes(8).toString('hex')}`;await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);return base+'/'+db;
    },async close(){for(const c of clients)await c.end();if(owned){await run('docker',['rm','--force','--volumes',name]);owned=false;}}};
  }catch{for(const c of clients)await c.end().catch(()=>{});if(owned)await run('docker',['rm','--force','--volumes',name]);throw new Error('SYNTHETIC_RECOVERY_CLUSTER_FAILED');}
}
