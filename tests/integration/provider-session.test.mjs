import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { after,before,test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { migrationSandbox } from "../support/migration-sandbox.mjs";
import { installProviderSchema } from "../support/provider-schema.mjs";
import { createLiveProviderSessionLookup,ProviderSessionLookupError } from "../../src/security/provider-session-db.ts";

let sandbox,client,target,receipt,prior,lookup,login,loginOwned=false,runtimeUrl,identityHash;
const subject=randomUUID(),other=randomUUID();
const signal=()=>new AbortController().signal;
const hash=async()=> (await client.query("SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'UTF8')),'hex') AS hash FROM crest_private.identity_events e")).rows[0].hash;
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(client,target);
  prior=await sandbox.apply(target,await sandbox.prefix(3));
  const bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic provider owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual')",[subject,bootstrap]);
  identityHash=await hash();receipt=await sandbox.apply(target);
  await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,'first@example.com','authenticated','authenticated'),($2,'second@example.com','authenticated','authenticated')",[subject,other]);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();
  lookup=createLiveProviderSessionLookup({connectionString:runtimeUrl,environment:'test'});
});
after(async()=>{if(loginOwned) await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
async function session(user=subject,aal='aal2',notAfter=null) {
  const id=randomUUID();await client.query('INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())',[id,user,aal,notAfter]);return id;
}
async function denied(work) {
  await assert.rejects(work,error=>error instanceof ProviderSessionLookupError&&error.message==='PROVIDER_SESSION_LOOKUP_FAILED'&&error.cause===undefined);
}
async function asRole(role,work) {
  await client.query('BEGIN');try {await client.query(`SET LOCAL ROLE ${role}`);await work();}finally{await client.query('ROLLBACK');}
}

test('actual provider migrations and schema3 upgrade preserve identity history and CLI prefix',async()=>{
  assert.equal(prior.history.length,3);assert.equal(receipt.history.length,4);
  assert.deepEqual(receipt.history.slice(0,3),prior.history);assert.equal(await hash(),identityHash);
  assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.equal((await client.query("SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='auth.sessions'::regclass")).rows[0].owner,'supabase_auth_admin');
});
test('fresh connections reread exact subject/session and provider deletion is effective immediately',async()=>{
  const id=await session();assert.equal(await lookup(subject,id,signal()),true);
  assert.equal(await lookup(other,id,signal()),false);assert.equal(await lookup(subject,randomUUID(),signal()),false);
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[id]);assert.equal(await lookup(subject,id,signal()),false);
});
test('MFA downgrade and finite provider deadlines fail closed without cached positive results',async()=>{
  const id=await session();assert.equal(await lookup(subject,id,signal()),true);
  await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[id]);assert.equal(await lookup(subject,id,signal()),false);
  for(const deadline of [new Date(Date.now()-1000),'infinity','-infinity']) assert.equal(await lookup(subject,await session(subject,'aal2',deadline),signal()),false);
  assert.equal(await lookup(subject,await session(subject,'aal2',new Date(Date.now()+60000)),signal()),true);
});
test('independent device sessions coexist and revoking one leaves the other active',async()=>{
  const a=await session(),b=await session();assert.equal(await lookup(subject,a,signal()),true);assert.equal(await lookup(subject,b,signal()),true);
  await client.query('DELETE FROM auth.sessions WHERE id=$1',[a]);assert.equal(await lookup(subject,a,signal()),false);assert.equal(await lookup(subject,b,signal()),true);
});
test('reader owner has no login, membership, bypass, CREATE, app data or secret-column privileges',async()=>{
  const r=(await client.query("SELECT * FROM pg_roles WHERE rolname='crest_auth_reader'")).rows[0];
  for(const key of ['rolcanlogin','rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls']) assert.equal(r[key],false);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid=$1 OR member=$1',[r.oid])).rows[0].n,0);
  for(const schema of ['auth','crest','crest_private','crest_commands','public']) assert.equal((await client.query("SELECT has_schema_privilege('crest_auth_reader',$1,'CREATE') AS allowed",[schema])).rows[0].allowed,false);
  for(const table of ['auth.users','auth.refresh_tokens','auth.sessions','crest_private.actors','crest_private.app_sessions']) assert.equal((await client.query("SELECT has_table_privilege('crest_auth_reader',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
  const columns=(await client.query("SELECT column_name FROM information_schema.column_privileges WHERE grantee='crest_auth_reader' AND table_schema='auth' AND table_name='sessions' ORDER BY column_name")).rows.map(r=>r.column_name);
  assert.deepEqual(columns,['aal','id','not_after','user_id']);
});
test('function is fixed-path, nonexposed and only executable by web runtime among app/provider principals',async()=>{
  const f=(await client.query("SELECT p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p WHERE p.oid='crest_commands.provider_session_is_live(uuid,uuid)'::regprocedure")).rows[0];
  assert.equal(f.owner,'crest_auth_reader');assert(f.prosecdef);assert.equal(f.provolatile,'v');assert.deepEqual(f.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
  const id=await session();
  for(const role of ['crest_worker','crest_recovery','crest_command_owner','crest_schema_owner','anon','authenticated','service_role']) {
    assert.equal((await client.query("SELECT has_function_privilege($1,'crest_commands.provider_session_is_live(uuid,uuid)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
  }
  await asRole('crest_web',async()=>{
    assert.equal((await client.query('SELECT crest_commands.provider_session_is_live($1,$2) AS live',[subject,id])).rows[0].live,true);
    await assert.rejects(client.query('SELECT id FROM auth.sessions'),error=>error.code==='42501');
  });
  for(const role of ['anon','authenticated','service_role']) await asRole(role,async()=>{
    await assert.rejects(client.query('SELECT crest_commands.provider_session_is_live($1,$2)',[subject,id]),error=>error.code==='42501');
  });
});
test('null/mismatched SQL parameters deny and stale transaction isolation is rejected',async()=>{
  const id=await session();
  assert.equal((await client.query('SELECT crest_commands.provider_session_is_live(NULL,$1) AS live',[id])).rows[0].live,false);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {await assert.rejects(client.query('SELECT crest_commands.provider_session_is_live($1,$2)',[subject,id]),error=>error.code==='25001');}finally{await client.query('ROLLBACK');}
});
test('privileged migration connection cannot be substituted for the runtime adapter',async()=>{
  const root=createLiveProviderSessionLookup({connectionString:target,environment:'test'});
  assert.equal(await root(subject,await session(),signal()),false);
});
test('malformed IDs, cancelled work and connection failures produce generic errors without retained backends',async()=>{
  await denied(lookup('invalid',randomUUID(),signal()));
  const controller=new AbortController();controller.abort();await denied(lookup(subject,randomUUID(),controller.signal));
  const url=new URL(runtimeUrl);url.port='1';const unavailable=createLiveProviderSessionLookup({connectionString:url.toString(),environment:'test'});
  await denied(unavailable(subject,randomUUID(),signal()));
  assert.equal((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_provider_session_check'")).rows[0].n,0);
});
test('lock timeouts and active cancellation close the driver connection and allow a fresh next lookup',async()=>{
  const id=await session();const locker=await sandbox.connect(target);
  await locker.query('BEGIN');await locker.query('LOCK TABLE auth.sessions IN ACCESS EXCLUSIVE MODE');
  try {
    const start=Date.now();await denied(lookup(subject,id,signal()));assert(Date.now()-start<3000);
    const controller=new AbortController();const pending=lookup(subject,id,controller.signal);const deadline=Date.now()+2000;let blocked=false;
    while(Date.now()<deadline&&!blocked){blocked=(await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='crest_provider_session_check' AND wait_event_type='Lock'")).rows[0].n>0;if(!blocked)await delay(10);}
    assert(blocked,'actual adapter query must be blocked before cancellation');controller.abort();await denied(pending);
  }finally{await locker.query('ROLLBACK');}
  assert.equal(await lookup(subject,id,signal()),true);
});
test('fresh schema0 and both preceding schema2/3 upgrades use actual provider DDL',async()=>{
  await sandbox.admin.query(`DROP ROLE ${login}`);loginOwned=false;
  for(const ordinal of [0,2]) {
    const db=await sandbox.database(),c=await sandbox.connect(db);await sandbox.apply(db,await sandbox.prefix(0),true);await installProviderSchema(c,db);
    const before=ordinal?await sandbox.apply(db,await sandbox.prefix(ordinal)):null;
    const after=await sandbox.apply(db,sandbox.root);
    assert.equal(after.history.length,4);if(before)assert.deepEqual(after.history.slice(0,ordinal),before.history);
  }
});
test('missing provider schema fails closed without installing a callable helper',async()=>{
  const db=await sandbox.database(),c=await sandbox.connect(db);await sandbox.apply(db,await sandbox.prefix(3),true);
  await assert.rejects(sandbox.apply(db));
  assert.equal((await c.query("SELECT to_regprocedure('crest_commands.provider_session_is_live(uuid,uuid)') AS fn")).rows[0].fn,null);
});
