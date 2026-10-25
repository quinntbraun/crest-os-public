import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { chmod,copyFile,mkdir,readFile,readdir,stat,unlink,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after,before,test } from 'node:test';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupDatabase,connect,hash,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,roleDefinitions,run,postgresTool,normalizedSchema } from '../support/recovery-drill.mjs';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {objectDirectory,encryptor,decryptor} from '../support/object-recovery-drill.mjs';

let sandbox,source,sourceUrl,sourceWeb,cluster,restored,restoredUrl,point,keys,emergencyKey,directory,backup,owner,original,sourceLogin,restoredLogin,liveSource,sourceLoginOwned=false,restoredLoginOwned=false;
let sourceObjects,vaultObjects,restoredObjects,objectInventory,postSnapshotObject;
let snapshotCustomer;
const objectSignal=()=>AbortSignal.timeout(30000);
const objectPorts=destination=>({readVault:vaultObjects.read,unseal:decryptor(emergencyKey),putDestination:destination.put,readDestination:destination.read});
const issuer='https://auth.example.com/auth/v1';
const renameSql='SELECT crest_commands.rename_business($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) AS value';
const args=(f,r)=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,r.operation,r.version,r.name];
const customerSave=(f,id,version,name)=>sourceWeb.query('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
  [f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+120000),f.business,f.epoch,randomUUID(),id,version,{displayName:name,phone:'(317) 555-0100',email:'Synthetic@Example.com',contactPreference:null,outreachOptOut:true,notes:'Synthetic \\N =evidence é 😀',customerSince:null,archived:false,archiveReason:null}]);
const rename=(connection,f,r)=>connection.query(renameSql,args(f,r));
const request=(version='2',name='Synthetic restored review')=>({operation:randomUUID(),version,name});
const closed=work=>assert.rejects(work,/SYNTHETIC_RECOVERY_RESTORE_FAILED/);

async function session(client,f){
  const value={...f,session:randomUUID(),provider:randomUUID(),hash:randomBytes(32)};
  try{
  await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[value.provider,value.subject]);
  // Sample the database clock exactly once: authenticated_at must be <=created_at.
  await client.query("WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,observed.stamp,observed.stamp,observed.stamp,observed.stamp+interval '1 hour',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[value.session,value.actor,value.provider,value.hash,randomBytes(32)]);
  return value;
  }catch{throw new Error('SYNTHETIC_RECOVERY_SESSION_SEED_FAILED');}
}
async function web(url,admin){
  const login=`recovery_web_${randomBytes(8).toString('hex')}`,password=randomBytes(32).toString('hex');
  await admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await admin.query(`GRANT crest_web TO ${login}`);const u=new URL(url);u.username=login;u.password=password;
  const connection=await connect(u.toString());await connection.query('SET ROLE crest_web');return {connection,login};
}
async function emptyRestore(){const url=await cluster.database();return {url,client:await connect(url)};}
async function alteredPoint(name,change){
  const path=join(directory,name);await mkdir(path,{mode:0o700});
  for(const file of ['database.age','manifest.age','receipt.json'])await copyFile(join(point,file),join(path,file));
  await change(path);return path;
}
before(async()=>{
  directory=await privateWorkspace();const kit=join(directory,'emergency-kit');point=join(directory,'point');await mkdir(kit,{mode:0o700});await mkdir(point,{mode:0o700});
  keys=await keyPair(kit);emergencyKey=join(kit,'independent-key.txt');await copyFile(keys.path,emergencyKey);await chmod(emergencyKey,0o600);
  sandbox=await migrationSandbox();sourceUrl=await sandbox.database();source=await sandbox.connect(sourceUrl);
  await sandbox.apply(sourceUrl,await sandbox.prefix(0),true);await installProviderSchema(source,sourceUrl);await sandbox.apply(sourceUrl);
  const bootstrap=(await source.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id,subject=randomUUID();
  const actor=(await source.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic recovery owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
  await source.query('BEGIN');
  const business=(await source.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic before backup','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await source.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=(await source.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await source.query('COMMIT');
  await source.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,'synthetic-recovery@example.com','authenticated','authenticated')",[subject]);owner=await session(source,{actor,subject,business,epoch});
  // An otherwise unknown schema/table and a sequence ensure a selective export
  // cannot masquerade as a database backup. This fixture is never a migration.
  await source.query("CREATE SCHEMA recovery_fixture; CREATE SEQUENCE recovery_fixture.counter START 9007199254740993; CREATE TABLE recovery_fixture.evidence(id bigint PRIMARY KEY DEFAULT nextval('recovery_fixture.counter'),exact_time timestamptz NOT NULL,original bytea NOT NULL,label text NOT NULL CHECK(length(label)>0)); INSERT INTO recovery_fixture.evidence(exact_time,original,label) VALUES('2026-10-24T01:02:03.123456Z',decode('000102ff00','hex'),'Unicode é 😀 \\N =formula');");
  sourceObjects=await objectDirectory(join(directory,'source-objects'));vaultObjects=await objectDirectory(join(directory,'vault-objects'));restoredObjects=await objectDirectory(join(directory,'restored-objects'));
  // The real domain tables do not exist yet. Keep an explicitly drill-only
  // inventory schema, captured with the actual exported database snapshot.
  await source.query('CREATE TABLE recovery_fixture.objects(key text PRIMARY KEY, "byteSize" integer NOT NULL,sha256 text NOT NULL,retention text NOT NULL,state text NOT NULL)');
  for(const [i,retention] of ['original','derivative','quarantine'].entries()){
    const key=retention==='quarantine'?`staging/${business}/${randomUUID()}/${randomUUID()}`:`${i===0?'originals':'previews'}/${business}/${randomUUID()}`,bytes=Buffer.from(`Synthetic retained ${retention} é 😀`);
    await sourceObjects.put(key,bytes,objectSignal());await source.query('INSERT INTO recovery_fixture.objects VALUES($1,$2,$3,$4,$5)',[key,bytes.length,hash(bytes),retention,i===0?'Archived':i===1?'Available':'Quarantined']);
  }
  const w=await web(sourceUrl,sandbox.admin);sourceWeb=w.connection;sourceLogin=w.login;sourceLoginOwned=true;
  original=request('1','Synthetic committed before snapshot');assert.equal((await rename(sourceWeb,owner,original)).rows[0].value.state,'committed');
  snapshotCustomer=randomUUID();assert.equal((await customerSave(owner,snapshotCustomer,'0','Synthetic customer before snapshot')).rows[0].value.state,'committed');
  backup=await backupDatabase(source,sourceUrl,point,keys.recipient,async()=>{
    assert.equal((await rename(sourceWeb,owner,request('2','Synthetic committed after snapshot'))).rows[0].value.state,'committed');
    assert.equal((await customerSave(owner,snapshotCustomer,'1','Synthetic customer after snapshot')).rows[0].value.state,'committed');
    const key=`originals/${business}/${randomUUID()}`,bytes=Buffer.from('Committed after snapshot');postSnapshotObject=key;
    await sourceObjects.put(key,bytes,objectSignal());
    const later=await connect(sourceUrl);try{await later.query('INSERT INTO recovery_fixture.objects VALUES($1,$2,$3,$4,$5)',[key,bytes.length,hash(bytes),'original','Available']);}finally{await later.end();}
    const independent=await connect(sourceUrl);try{liveSource=await inventory(independent);}finally{await independent.end();}
  },{async inventory(client){objectInventory=(await client.query('SELECT key,"byteSize",sha256,retention FROM recovery_fixture.objects ORDER BY key COLLATE "C"')).rows;return objectInventory;},
    capture:objects=>captureObjectArchive(randomUUID(),objects,{readSource:sourceObjects.read,seal:encryptor(keys.recipient),putVault:vaultObjects.put,readVault:vaultObjects.read})});
  cluster=await recoveryCluster();restoredUrl=await cluster.database();
  // The fresh process receives no source URL/credential and has only the copy
  // of the emergency key after the original is removed.
  await unlink(keys.path);
  let output;
  try{output=await run(process.execPath,['tests/support/restore-recovery-drill.mjs',point,emergencyKey],{env:{...process.env,CREST_TEST_DATABASE_URL:'',CREST_RECOVERY_DRILL_TARGET:restoredUrl,CREST_RECOVERY_DRILL_VAULT:join(directory,'vault-objects'),CREST_RECOVERY_DRILL_OBJECTS:join(directory,'restored-objects')}});}
  catch(error){
    if(error.message!=='SYNTHETIC_RECOVERY_TOOL_FAILED:schema')throw error;
    const expected=normalizedSchema(await postgresTool('pg_dump',sourceUrl,['--schema-only'])),actual=normalizedSchema(await postgresTool('pg_dump',restoredUrl,['--schema-only']));
    assert.equal(hash(expected),backup.manifest.schemaSha256,'source schema changed after capture');
    const left=expected.split('\n'),right=actual.split('\n'),at=left.findIndex((line,i)=>line!==right[i]);
    // Only fixed public Crest DDL headers/grants and exact lines already in the
    // published customer migration may cross diagnostics. No source data, SQL
    // comments/bodies from arbitrary objects or connection details are emitted.
    const publicLines=new Set((await readFile(new URL('../../supabase/migrations/20261025020000_customer_directory.sql',import.meta.url),'utf8')).split('\n').map(s=>s.trim()));
    const safe=line=>line===''?'[blank]':publicLines.has(line?.trim())&&line?.trim()?line:
      /^(?:GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|CREATE FUNCTION|ALTER FUNCTION|CREATE TABLE|ALTER TABLE|CREATE TYPE|ALTER TYPE) [A-Za-z0-9_ .(),;"]+$/.test(line??'')&&/\bcrest(?:_|\.)[a-z_]+\b/.test(line)?line:'[schema statement withheld]';
    const object=lines=>{for(let i=at;i>=0;i--)if(/^(?:CREATE FUNCTION|CREATE TABLE|CREATE TYPE) crest(?:_|\.)/.test(lines[i]))return safe(lines[i]);return '[object withheld]';};
    // This fixture creates customers solely from the published migration and
    // makes no later customer DDL changes. Its table definition has no secrets
    // or source records; preserve literal control characters for exact diagnosis.
    const table=lines=>object(lines)==='CREATE TABLE crest.customers ('?lines.slice(Math.max(0,at-1),at+8):[];
    throw new Error('SYNTHETIC_SCHEMA_REVIEW_REQUIRED:'+JSON.stringify({line:at+1,expectedObject:object(left),actualObject:object(right),expected:left.slice(Math.max(0,at-1),at+8).map(safe),actual:right.slice(Math.max(0,at-1),at+8).map(safe),expectedCustomerDdl:table(left),actualCustomerDdl:table(right)}),{cause:error});
  }
  assert.match(output.toString(),/^Synthetic isolated database restore and verification completed\s*$/);
  restored=await connect(restoredUrl);
},{timeout:240000});
after(async()=>{
  await sourceWeb?.end();
  if(sourceLoginOwned)await sandbox.admin.query(`DROP ROLE ${sourceLogin}`);
  if(restoredLoginOwned)await restored.query(`DROP ROLE ${restoredLogin}`);
  await restored?.end();await cluster?.close();await sandbox?.close();
});

test('actual encrypted database recovery works in a fresh process and separate cluster',async()=>{
  assert.notEqual(new URL(sourceUrl).port,new URL(restoredUrl).port);
  assert.deepEqual(await inventory(restored),backup.manifest.rows);
  assert.deepEqual(await roleDefinitions(restored),backup.manifest.roles);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,32);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM auth.schema_migrations')).rows[0].n,(await source.query('SELECT count(*)::int AS n FROM auth.schema_migrations')).rows[0].n);
  assert.equal(backup.manifest.completeBackup,false); // vault/files/config/full release remain unfinished
});
test('one exported snapshot preserves prior operations and excludes concurrent committed changes',async()=>{
  assert.equal((await restored.query('SELECT legal_name FROM crest.businesses WHERE id=$1',[owner.business])).rows[0].legal_name,original.name);
  assert.equal((await source.query('SELECT legal_name FROM crest.businesses WHERE id=$1',[owner.business])).rows[0].legal_name,'Synthetic committed after snapshot');
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.operations')).rows[0].n,2);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM crest_private.operations')).rows[0].n,4);
});
test('actual customer contacts, raw notes and source audit recover at the exact snapshot version',async()=>{
  const customer=(await restored.query('SELECT crest_private.customer_projection(c) AS value FROM crest.customers c WHERE id=$1',[snapshotCustomer])).rows[0].value;
  assert.equal(customer.display_name,'Synthetic customer before snapshot');assert.equal(customer.version,'1');assert.equal(customer.phone_raw,'(317) 555-0100');assert.equal(customer.phone_normalized,'3175550100');assert.equal(customer.email_raw,'Synthetic@Example.com');assert.equal(customer.outreach_opt_out,true);assert.equal(customer.notes,'Synthetic \\N =evidence é 😀');
  assert.equal((await source.query('SELECT display_name FROM crest.customers WHERE id=$1',[snapshotCustomer])).rows[0].display_name,'Synthetic customer after snapshot');
  const audit=(await restored.query("SELECT delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='customers' AND entity_id=$2",[owner.business,snapshotCustomer])).rows;assert.equal(audit.length,1);assert.deepEqual(audit[0].delta.after,customer);
});

test('same-snapshot retained files restore with Archived and quarantined evidence, excluding later commits',async()=>{
  assert.deepEqual((await restored.query('SELECT key,"byteSize",sha256,retention FROM recovery_fixture.objects ORDER BY key COLLATE "C"')).rows,objectInventory);
  assert.equal(objectInventory.length,3);assert.equal((await source.query('SELECT count(*)::int AS n FROM recovery_fixture.objects')).rows[0].n,4);
  for(const object of objectInventory){const b=await restoredObjects.read(object.key,object.byteSize,objectSignal());assert.equal(hash(b),object.sha256);assert.deepEqual(b,await sourceObjects.read(object.key,object.byteSize,objectSignal()));}
  await assert.rejects(readFile(restoredObjects.path(postSnapshotObject)),e=>e.code==='ENOENT');assert(!backup.manifest.excluded.includes('external_objects'));
});

test('missing referenced original blocks database restoration before SQL without touching the source',async()=>{
  const entry=objectInventory.find(o=>o.retention==='original'),index=objectInventory.indexOf(entry),key=`recovery/${backup.manifest.objectArchive.receipt.pointId}/objects/${index}.age`,path=vaultObjects.path(key),saved=await readFile(path);
  const f=await emptyRestore(),destination=await objectDirectory(join(directory,'missing-object-destination'));
  try{await unlink(path);await closed(restoreDatabase(point,emergencyKey,f.url,a=>restoreObjectArchive(a.receipt,a.inventory,objectPorts(destination))));assert.deepEqual(await inventory(f.client),[]);assert.deepEqual(await readdir(join(directory,'missing-object-destination')),[]);}
  finally{await writeFile(path,saved,{flag:'wx',mode:0o600});await f.client.end();}
});

test('object archive requires an explicit restore transport and cannot silently restore DB alone',async()=>{
  const f=await emptyRestore();try{await closed(restoreDatabase(point,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('unknown-schema rows retain exact bigint, microseconds, binary bytes and sequence state',async()=>{
  assert.deepEqual((await restored.query("SELECT id::text,to_char(exact_time AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,encode(original,'hex') AS original,label FROM recovery_fixture.evidence")).rows,(await source.query("SELECT id::text,to_char(exact_time AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,encode(original,'hex') AS original,label FROM recovery_fixture.evidence")).rows);
  assert.equal((await restored.query("SELECT nextval('recovery_fixture.counter')::text AS value")).rows[0].value,'9007199254740994');
});
test('private recovery point contains ciphertext and a non-secret receipt, without the original key',async()=>{
  assert.deepEqual((await readdir(point)).sort(),['database.age','manifest.age','receipt.json']);
  for(const file of ['database.age','manifest.age']){const bytes=await readFile(join(point,file));assert.match(bytes.subarray(0,32).toString(),/^age-encryption.org\/v1/);assert.equal((await stat(join(point,file))).mode&0o077,0);}
  await assert.rejects(readFile(keys.path),e=>e.code==='ENOENT');assert.equal((await stat(emergencyKey)).mode&0o077,0);
});
test('wrong emergency key fails before creating schema or business rows',async()=>{
  const other=await keyPair(directory),f=await emptyRestore();try{await closed(restoreDatabase(point,other.path,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('missing ciphertext never becomes a successful recovery',async()=>{
  const altered=await alteredPoint('missing',async p=>unlink(join(p,'database.age'))),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('truncated ciphertext fails the exact receipt check before SQL',async()=>{
  const altered=await alteredPoint('truncated',async p=>{const path=join(p,'database.age');const bytes=await readFile(path);await writeFile(path,bytes.subarray(0,bytes.length-1));}),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('ciphertext tampering still fails authenticated decryption with a recomputed public checksum',async()=>{
  const altered=await alteredPoint('tampered',async p=>{const path=join(p,'database.age'),bytes=await readFile(path);bytes[bytes.length-20]^=1;await writeFile(path,bytes);const r=JSON.parse(await readFile(join(p,'receipt.json'),'utf8'));r.dump.sha256=hash(bytes);await writeFile(join(p,'receipt.json'),JSON.stringify(r));}),f=await emptyRestore();try{await closed(restoreDatabase(altered,emergencyKey,f.url));assert.deepEqual(await inventory(f.client),[]);}finally{await f.client.end();}
});
test('a populated destination is rejected without overwriting its evidence',async()=>{
  const f=await emptyRestore();try{await f.client.query('CREATE TABLE public.retained(id integer PRIMARY KEY); INSERT INTO public.retained VALUES(7)');await closed(restoreDatabase(point,emergencyKey,f.url));assert.deepEqual((await f.client.query('SELECT * FROM public.retained')).rows,[{id:7}]);}finally{await f.client.end();}
});
test('an existing function without tables also prevents restore',async()=>{
  const f=await emptyRestore();try{await f.client.query('CREATE FUNCTION public.retained() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$');await closed(restoreDatabase(point,emergencyKey,f.url));assert.equal((await f.client.query('SELECT public.retained() AS value')).rows[0].value,7);}finally{await f.client.end();}
});
test('restored grants/RLS block raw writes and privileged role assumption',async()=>{
  const w=await web(restoredUrl,restored);restoredLogin=w.login;restoredLoginOwned=true;
  try{for(const role of ['crest_schema_owner','crest_session_owner','crest_command_owner'])await assert.rejects(w.connection.query(`SET ROLE ${role}`),e=>e.code==='42501');await assert.rejects(w.connection.query('SELECT token_hash FROM crest_private.app_sessions'),e=>e.code==='42501');await assert.rejects(w.connection.query("UPDATE crest.businesses SET legal_name='forged'"),e=>e.code==='42501');
    const tables=(await restored.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private') AND relkind='r'")).rows;assert(tables.length>=22);assert(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
  }finally{await w.connection.end();}
});
test('restored FK/check/append-only guards still enforce source integrity',async()=>{
  await assert.rejects(restored.query("UPDATE crest.businesses SET timezone='',version=version+1 WHERE id=$1",[owner.business]),e=>e.code==='23514');
  await assert.rejects(restored.query('DELETE FROM crest.memberships WHERE actor_id=$1',[owner.actor]),e=>['23503','55000'].includes(e.code));
  await assert.rejects(restored.query("UPDATE crest_private.audit_events SET action='forged'"),e=>e.code==='55000');
});
test('one-microsecond authentication drift is rejected; the corrected seed shares one exact timestamp',async()=>{
  await restored.query('BEGIN');try{
    await assert.rejects(restored.query("INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT gen_random_uuid(),actor_id,$2,$3,issued_security_epoch,created_at,created_at+interval '1 microsecond',created_at,created_at+interval '1 hour',false,provider_token_ciphertext,key_id,created_by,updated_by FROM crest_private.app_sessions WHERE id=$1",[owner.session,randomUUID(),randomBytes(32)]),e=>e.code==='23514'&&e.constraint==='app_sessions_check2');
  }finally{await restored.query('ROLLBACK');}
  await restored.query('BEGIN');try{
    const fresh=await session(restored,owner);
    assert.equal((await restored.query("SELECT created_at=authenticated_at AND created_at=last_active_at AND expires_at=created_at+interval '1 hour' AS exact FROM crest_private.app_sessions WHERE id=$1",[fresh.session])).rows[0].exact,true);
  }finally{await restored.query('ROLLBACK');}
});
test('incident fixture pauses authority, revokes sessions and records a new epoch independently',async()=>{
  const incident=randomUUID(),epoch=randomUUID(),file=join(directory,'independent-incident.json');
  // This is a drill-only administrative fixture, not an exposed recovery command.
  // The original source remains running separately; production old-writer fencing
  // and owner incident authorization are explicit unfinished activation gates.
  await writeFile(file,JSON.stringify({incident,businessId:owner.business,priorEpoch:owner.epoch,epoch,writesEnabled:false}),{flag:'wx',mode:0o600});
  await restored.query('BEGIN');try{
    await restored.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[owner.business]);
    await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,active_epoch=$1,incident_id=$2,version=version+1 WHERE business_id=$3',[epoch,incident,owner.business]);
    await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
    await restored.query('UPDATE crest_private.actors SET current_security_epoch=gen_random_uuid(),version=version+1 WHERE kind=\'owner\'');
    await restored.query('DELETE FROM auth.sessions');await restored.query('COMMIT');
  }catch(error){await restored.query('ROLLBACK');throw error;}
  const authority=(await restored.query('SELECT active_epoch,writes_enabled,incident_id FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0];
  assert.deepEqual(authority,{active_epoch:epoch,writes_enabled:false,incident_id:incident});assert.equal(JSON.parse(await readFile(file,'utf8')).epoch,epoch);
  assert.equal((await restored.query('SELECT count(*)::int AS n FROM crest_private.app_sessions WHERE revoked_at IS NULL OR provider_token_ciphertext IS NOT NULL OR key_id IS NOT NULL')).rows[0].n,0);
});
test('old restored credentials are denied; fresh credentials cannot bypass paused writes or replay old epochs',async()=>{
  const u=new URL(restoredUrl); // fresh login is separate from backup role definitions
  const w=await web(u.toString(),restored);
  try{
    assert.deepEqual((await rename(w.connection,owner,original)).rows[0].value,{state:'denied'});
    const current=await session(restored,owner),epoch=(await restored.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0].active_epoch;
    for(const command of [original,request()])await assert.rejects(rename(w.connection,current,command),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    await assert.rejects(rename(w.connection,{...current,epoch},request()),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    await restored.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[owner.business]);
    for(const command of [original,request()])await assert.rejects(rename(w.connection,current,command),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
    const result=(await rename(w.connection,{...current,epoch},request())).rows[0].value;assert.equal(result.state,'committed');assert.equal(result.recoveryEpoch,epoch);
    const retained=(await restored.query('SELECT recovery_epoch,result FROM crest_private.operations WHERE operation_id=$1',[original.operation])).rows[0];assert.equal(retained.recovery_epoch,owner.epoch);assert.equal(retained.result.businessVersion,'2');
    assert.equal((await source.query('SELECT active_epoch FROM crest_private.business_recovery_authorities WHERE business_id=$1',[owner.business])).rows[0].active_epoch,owner.epoch);
  }finally{await w.connection.end();await restored.query(`DROP ROLE ${w.login}`);}
});
test('backup, isolated restore and incident fixtures never alter the original source',async()=>{
  assert.deepEqual(await inventory(source),liveSource);
});
