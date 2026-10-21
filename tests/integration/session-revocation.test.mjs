import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createSessionCredential} from '../../src/security/session-credential.ts';
import {createSessionRevoker,SessionRevocationError} from '../../src/security/session-revocation-db.ts';

let sandbox,client,target,login,loginOwned=false,runtimeUrl,revoke,owner,other,business,bootstrap,prior,receipt,snapshot,existing;
const signal=()=>new AbortController().signal;
const state=async id=>(await client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[id])).rows[0];
const events=async id=>(await client.query('SELECT * FROM crest_private.session_events WHERE session_id=$1 ORDER BY created_at,id',[id])).rows;
async function actor(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic revoke owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id",[randomUUID(),bootstrap])).rows[0].id;}
async function fixture(actorId=owner,expired=false){
  const credential=createSessionCredential();
  const row=(await client.query("WITH moment AS (SELECT date_trunc('milliseconds',clock_timestamp())-CASE WHEN $3 THEN interval '14 hours' ELSE interval '0 hours' END AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,$2,$4,a.current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic-key',$1,$1 FROM moment,crest_private.actors a WHERE a.id=$1 RETURNING id",[actorId,randomUUID(),expired,credential.hashForDatabase(),Buffer.from('synthetic-encrypted-placeholder')])).rows[0];
  return {id:row.id,credential};
}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(4));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  owner=await actor();other=await actor();
  await client.query('BEGIN');try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic revoke business','UTC',$1,$1,'manual') RETURNING id",[owner])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,owner,other]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  existing=await fixture();snapshot={row:await state(existing.id),events:await events(existing.id)};receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_web TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();revoke=createSessionRevoker({connectionString:runtimeUrl,environment:'test'});
});
after(async()=>{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
async function denied(work){await assert.rejects(work,e=>e instanceof SessionRevocationError&&e.message==='SESSION_REVOCATION_FAILED'&&e.cause===undefined);}
async function asRole(role,work){await client.query('BEGIN');try{await client.query(`SET LOCAL ROLE ${role}`);await work();}finally{await client.query('ROLLBACK');}}

test('schema4 upgrade preserves rows/history and the append-only CLI prefix',async()=>{
  assert.equal(prior.history.length,4);assert.equal(receipt.history.length,5);assert.deepEqual(receipt.history.slice(0,4),prior.history);
  assert.deepEqual(await state(existing.id),snapshot.row);assert.deepEqual(await events(existing.id),snapshot.events);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
});
test('command owner stays closed with only selected columns and an append-only audit insert',async()=>{
  const r=(await client.query("SELECT * FROM pg_roles WHERE rolname='crest_command_owner'")).rows[0];
  for(const key of ['rolcanlogin','rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(r[key],false);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE member=$1 OR roleid=$1',[r.oid])).rows[0].n,0);
  for(const schema of ['auth','public','crest','crest_private','crest_commands'])assert.equal((await client.query("SELECT has_schema_privilege('crest_command_owner',$1,'CREATE') AS allowed",[schema])).rows[0].allowed,false);
  const columns=(await client.query("SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='crest_command_owner' AND table_schema='crest_private' AND table_name='app_sessions' ORDER BY privilege_type,column_name")).rows;
  assert.deepEqual(columns.filter(r=>r.privilege_type==='SELECT').map(r=>r.column_name),['actor_id','id','revoked_at','token_hash','version']);
  assert.deepEqual(columns.filter(r=>r.privilege_type==='UPDATE').map(r=>r.column_name),['operation_id','revoked_at','updated_by','version']);
  for(const table of ['crest_private.actors','crest.memberships','auth.users','auth.sessions','auth.refresh_tokens'])assert.equal((await client.query("SELECT has_table_privilege('crest_command_owner',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
  for(const table of ['app_sessions','session_events'])assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[`crest_private.${table}`])).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
});
test('runtime revokes just the presented credential and atomically clears its stored tokens',async()=>{
  const a=await fixture(),b=await fixture(),c=await fixture(other),before=await state(a.id);
  assert.equal(await revoke(a.credential.cookieValueForResponse(),signal()),undefined);
  const after=await state(a.id);assert(after.revoked_at);assert.equal(after.provider_token_ciphertext,null);assert.equal(after.key_id,null);assert.equal(BigInt(after.version),BigInt(before.version)+1n);
  assert.equal((await state(b.id)).revoked_at,null);assert.equal((await state(c.id)).revoked_at,null);
  const audit=await events(a.id);assert.equal(audit.length,2);assert.equal(audit[1].database_principal,login);assert.equal(audit[1].created_by,owner);assert(audit[1].operation_id);
  const serialized=JSON.stringify(audit);for(const secret of [a.credential.cookieValueForResponse(),a.credential.hashForDatabase().toString('hex'),'token_hash','provider_token_ciphertext','synthetic-encrypted-placeholder'])assert(!serialized.includes(secret));
});
test('unknown and repeated revocation return no existence data or duplicate audit event',async()=>{
  const a=await fixture();await revoke(a.credential.cookieValueForResponse(),signal());const row=await state(a.id),history=await events(a.id);
  await revoke(a.credential.cookieValueForResponse(),signal());await revoke(createSessionCredential().cookieValueForResponse(),signal());assert.deepEqual(await state(a.id),row);assert.deepEqual(await events(a.id),history);
});
test('expired and disabled/epoch-invalid sessions can still revoke without provider access',async()=>{
  const expired=await fixture(owner,true);await revoke(expired.credential.cookieValueForResponse(),signal());assert((await state(expired.id)).revoked_at);
  const id=await actor();await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,id,owner]);const disabled=await fixture(id);
  await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),id]);
  await revoke(disabled.credential.cookieValueForResponse(),signal());assert((await state(disabled.id)).revoked_at);
});
test('concurrent revocations serialize to one version increment and one audit append',async()=>{
  const a=await fixture(),before=await state(a.id);await Promise.all([revoke(a.credential.cookieValueForResponse(),signal()),revoke(a.credential.cookieValueForResponse(),signal())]);
  assert.equal(BigInt((await state(a.id)).version),BigInt(before.version)+1n);assert.equal((await events(a.id)).length,2);
});
test('web cannot read/write tables, choose a session ID, forge audit rows or escalate roles',async()=>{
  const a=await fixture();for(const sql of ['SELECT * FROM crest_private.app_sessions','UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp()',"INSERT INTO crest_private.session_events DEFAULT VALUES"]){
    await asRole('crest_web',async()=>{await assert.rejects(client.query(sql),e=>e.code==='42501');});
  }
  const runtime=new pg.Client({connectionString:runtimeUrl,options:'-c role=crest_web'});await runtime.connect();try{await assert.rejects(runtime.query('SET ROLE crest_command_owner'),e=>e.code==='42501');}finally{await runtime.end();}
  await asRole('crest_web',async()=>{await client.query("SELECT set_config('crest.actor_id',$1,true),set_config('crest.session_id',$2,true)",[other,a.id]);await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[randomBytes(32),randomUUID()]);});
  assert.equal((await state(a.id)).revoked_at,null);
});
test('function has fixed path/RLS, no provider grants, and no provider/worker/recovery execution',async()=>{
  const f=(await client.query("SELECT p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p WHERE p.oid='crest_commands.revoke_app_session(bytea,uuid)'::regprocedure")).rows[0];
  assert.equal(f.owner,'crest_command_owner');assert(f.prosecdef);assert.equal(f.provolatile,'v');assert.deepEqual(f.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
  for(const role of ['crest_worker','crest_recovery','crest_auth_reader','crest_schema_owner','anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,'crest_commands.revoke_app_session(bytea,uuid)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
});
test('null/wrong-length SQL inputs and stale isolation reject without changes',async()=>{
  const a=await fixture();for(const values of [[null,randomUUID()],[Buffer.alloc(31),randomUUID()],[a.credential.hashForDatabase(),null]])await asRole('crest_web',async()=>{await assert.rejects(client.query('SELECT crest_commands.revoke_app_session($1,$2)',values),e=>e.code==='22023');});
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await client.query('SET LOCAL ROLE crest_web');await assert.rejects(client.query('SELECT crest_commands.revoke_app_session($1,$2)',[a.credential.hashForDatabase(),randomUUID()]),e=>e.code==='25001');}finally{await client.query('ROLLBACK');}
  assert.equal((await state(a.id)).revoked_at,null);
});
test('revocation and audit append roll back together before transaction commit',async()=>{
  const a=await fixture();await asRole('crest_web',async()=>{await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[a.credential.hashForDatabase(),randomUUID()]);});
  assert.equal((await state(a.id)).revoked_at,null);assert.equal((await events(a.id)).length,1);
});
test('privileged or broadened runtime logins cannot substitute for the restricted adapter',async()=>{
  const a=await fixture();await denied(createSessionRevoker({connectionString:target,environment:'test'})(a.credential.cookieValueForResponse(),signal()));
  await sandbox.admin.query(`GRANT crest_worker TO ${login}`);try{await denied(revoke(a.credential.cookieValueForResponse(),signal()));}finally{await sandbox.admin.query(`REVOKE crest_worker FROM ${login}`);}
  assert.equal((await state(a.id)).revoked_at,null);
});
test('lock timeout and cancellation fail safely, close connections, and permit idempotent retry',async()=>{
  const a=await fixture(),locker=await sandbox.connect(target);await locker.query('BEGIN');await locker.query('SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE',[a.id]);
  try{
    const started=Date.now();await denied(revoke(a.credential.cookieValueForResponse(),signal()));assert(Date.now()-started<3000);
    const controller=new AbortController(),pending=revoke(a.credential.cookieValueForResponse(),controller.signal);let blocked=false;const deadline=Date.now()+2000;
    while(!blocked&&Date.now()<deadline){blocked=(await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_session_revoke' AND wait_event_type='Lock'")).rows[0].n>0;if(!blocked)await delay(10);}
    assert(blocked);controller.abort();await denied(pending);
  }finally{await locker.query('ROLLBACK');}
  assert.equal((await state(a.id)).revoked_at,null);await revoke(a.credential.cookieValueForResponse(),signal());assert((await state(a.id)).revoked_at);
  assert.equal((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_session_revoke'")).rows[0].n,0);
});
test('database outage and malformed credentials expose only generic errors',async()=>{
  const url=new URL(runtimeUrl);url.port='1';const unavailable=createSessionRevoker({connectionString:url.toString(),environment:'test'});
  await denied(unavailable(createSessionCredential().cookieValueForResponse(),signal()));await denied(revoke('invalid',signal()));
});
test('migration rejects pre-existing command-owner grant drift rather than adopting it',async()=>{
  const db=await sandbox.database(),c=await sandbox.connect(db);await sandbox.apply(db,await sandbox.prefix(0),true);await installProviderSchema(c,db);await sandbox.apply(db,await sandbox.prefix(4));
  await c.query('GRANT SELECT ON crest_private.app_sessions TO crest_command_owner');await assert.rejects(sandbox.apply(db));
  assert.equal((await c.query("SELECT to_regprocedure('crest_commands.revoke_app_session(bytea,uuid)') AS routine")).rows[0].routine,null);
});
