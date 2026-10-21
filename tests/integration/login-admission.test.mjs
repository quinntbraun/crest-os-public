import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createLoginAdmission,createLoginFingerprinter,LoginAdmissionError} from '../../src/security/login-admission.ts';
let sandbox,target,client,prior,receipt,bootstrap,legacy,legacyBefore,login,loginOwned=false,runtimeUrl,admit,fingerprint;
const key=randomBytes(32),signal=()=>new AbortController().signal,email=()=>`synthetic-${randomUUID()}@example.com`;
let address=0;const ip=()=>{address++;return `192.0.${Math.floor(address/254)}.${address%254+1}`;};
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(7));
  bootstrap=(await client.query("SELECT * FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0];
  await client.query('BEGIN');
  try{
    const actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic rate-limit owner','http://127.0.0.1:9999/auth/v1',$1,$2,$2,'manual') RETURNING *",[randomUUID(),bootstrap.id])).rows[0];
    const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic admission business','UTC',$1,$1,'manual') RETURNING id",[actor.id])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor.id]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,actor.id]);
    legacy=(await client.query("WITH moment AS (SELECT date_trunc('milliseconds',clock_timestamp()) AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,created_by,updated_by) SELECT $1,$2,$3,$4,stamp,stamp,stamp,stamp+interval '12 hours',false,$1,$1 FROM moment RETURNING id",[actor.id,randomUUID(),randomBytes(32),actor.current_security_epoch])).rows[0].id;
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  legacyBefore=(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy])).rows[0].row;
  receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;
  await sandbox.admin.query(`GRANT crest_web TO ${login}`);const url=new URL(target);url.username=login;url.password=password;runtimeUrl=url.toString();
  fingerprint=createLoginFingerprinter(key);admit=createLoginAdmission({connectionString:runtimeUrl,environment:'test'},key);
});
after(async()=>{if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});
const call=(identifier,address)=>admit(identifier,address,signal());
const parameters=(identifier,address)=>fingerprint(identifier,address).parametersForDatabase();
async function count(identifier,address){return (await client.query('SELECT count(*)::int AS n FROM crest_private.login_attempts WHERE identifier_hash=$1 OR ip_hash=$2',parameters(identifier,address).slice(0,2))).rows[0].n;}
async function asWeb(work,isolation='READ COMMITTED'){
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);try{await client.query('SET LOCAL ROLE crest_web');return await work();}finally{await client.query('ROLLBACK');}
}
async function denied(pending){await assert.rejects(pending,error=>error instanceof LoginAdmissionError&&error.message==='LOGIN_ADMISSION_FAILED'&&error.cause===undefined);}
async function blocked(minimum=1){
  const deadline=Date.now()+500;
  while(Date.now()<deadline){const n=(await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'",[new URL(target).pathname.slice(1),login])).rows[0].n;if(n>=minimum)return;await delay(5);}
  assert.fail('runtime admission must wait on the actual held database root');
}

test('schema7 upgrade preserves prior sessions, identity and append-only migration history',async()=>{
  assert.equal(prior.history.length,7);assert.equal(receipt.history.length,8);assert.deepEqual(receipt.history.slice(0,7),prior.history);
  assert.deepEqual((await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[legacy])).rows[0].row,legacyBefore);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.session_events WHERE session_id=$1',[legacy])).rows[0].n,1);
  assert.equal((await client.query('SELECT * FROM crest_private.actors WHERE id=$1',[bootstrap.id])).rows[0].current_security_epoch,bootstrap.current_security_epoch);
  assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
});
test('login owner is closed and web has only the fixed-path forced-RLS command',async()=>{
  const role=(await client.query("SELECT * FROM pg_roles WHERE rolname='crest_login_owner'")).rows[0];
  for(const field of ['rolcanlogin','rolinherit','rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(role[field],false);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid=$1 OR member=$1',[role.oid])).rows[0].n,0);
  for(const table of ['crest_private.login_limit_state','crest_private.login_attempts']){
    const row=(await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];
    assert(row.relrowsecurity&&row.relforcerowsecurity);assert.equal(row.owner,'crest_schema_owner');
    assert.equal((await client.query("SELECT has_table_privilege('crest_web',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
  }
  const fn=(await client.query("SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='crest_commands.admit_login(bytea,bytea,bytea)'::regprocedure")).rows[0];
  assert(fn.prosecdef);assert.equal(fn.owner,'crest_login_owner');assert.deepEqual(fn.proconfig,['search_path=pg_catalog, pg_temp','row_security=on']);
  for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_auth_reader','crest_session_owner','crest_command_owner'])assert.equal((await client.query("SELECT has_function_privilege($1,'crest_commands.admit_login(bytea,bytea,bytea)','EXECUTE') AS allowed",[role])).rows[0].allowed,false);
  for(const table of ['auth.users','auth.sessions','auth.refresh_tokens','crest_private.app_sessions','crest.memberships','crest_private.identity_events'])assert.equal((await client.query("SELECT has_table_privilege('crest_login_owner',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
  for(const schema of ['public','auth','crest','crest_private','crest_commands'])assert.equal((await client.query("SELECT has_schema_privilege('crest_login_owner',$1,'CREATE') AS allowed",[schema])).rows[0].allowed,false);
  await asWeb(async()=>{await assert.rejects(client.query('SELECT * FROM crest_private.login_attempts'),error=>error.code==='42501');});
});
test('initial key binding and admission roll back together before any configuration is persisted',async()=>{
  const identifier=email(),address=ip(),args=parameters(identifier,address);
  assert.equal((await client.query('SELECT key_fingerprint FROM crest_private.login_limit_state')).rows[0].key_fingerprint,null);
  await asWeb(async()=>{assert.equal((await client.query('SELECT crest_commands.admit_login($1,$2,$3) AS admitted',args)).rows[0].admitted,true);});
  assert.equal((await client.query('SELECT key_fingerprint FROM crest_private.login_limit_state')).rows[0].key_fingerprint,null);assert.equal(await count(identifier,address),0);
  assert.equal(await call(identifier,address),true);
  assert((await client.query('SELECT key_fingerprint FROM crest_private.login_limit_state')).rows[0].key_fingerprint.equals(args[2]),'the first committed key binds subsequent server instances');
});
test('five rolling identifier admissions survive new adapters and normalize casing across different IPs',async()=>{
  const identifier=email();for(let i=0;i<5;i++)assert.equal(await call(i%2?identifier.toUpperCase():` ${identifier} `,ip()),true);
  const fresh=createLoginAdmission({connectionString:runtimeUrl,environment:'test'},key);
  for(let i=0;i<3;i++)assert.equal(await fresh(identifier,ip(),signal()),false);
  assert.equal(await count(identifier,ip()),5,'denial does not append attempts or extend lockout');
});
test('twenty rolling IP admissions apply across identifiers and IPv4-mapped IPv6 spellings',async()=>{
  const address=ip();for(let i=0;i<20;i++)assert.equal(await call(email(),i%2?`::ffff:${address}`:address),true);
  assert.equal(await call(email(),address),false);assert.equal(await call(email(),`::ffff:${address}`),false);
  assert.equal(await count(email(),address),20);assert.equal(await call(email(),ip()),true);
});
test('recent attempts remain counted and expired attempts are pruned without fixed-window reset or owner lockout',async()=>{
  const identifier=email(),address=ip();for(let i=0;i<5;i++)assert.equal(await call(identifier,address),true);
  const args=parameters(identifier,address);
  await client.query("UPDATE crest_private.login_attempts SET admitted_at=clock_timestamp()-interval '14 minutes' WHERE identifier_hash=$1",[args[0]]);
  assert.equal(await call(identifier,address),false);
  await client.query("UPDATE crest_private.login_attempts SET admitted_at=clock_timestamp()-interval '15 minutes' WHERE identifier_hash=$1",[args[0]]);
  assert.equal(await call(identifier,address),true);assert.equal(await count(identifier,address),1);
});
test('concurrent identifier admissions serialize on the database root and admit exactly five',async()=>{
  const identifier=email(),locker=await sandbox.connect(target);await locker.query('BEGIN');await locker.query('SELECT singleton FROM crest_private.login_limit_state FOR UPDATE');
  const pending=Promise.all(Array.from({length:12},()=>call(identifier,ip())));const settled=pending.then(value=>({value}),error=>({error}));
  try{await blocked(2);}finally{await locker.query('ROLLBACK');}
  const result=await settled;assert(!result.error,'concurrent fixture calls must complete within the runtime lock bound');assert.equal(result.value.filter(Boolean).length,5);
  assert.equal(await count(identifier,ip()),5);
});
test('concurrent distinct identifiers sharing an IP admit exactly twenty',async()=>{
  const address=ip();const values=await Promise.all(Array.from({length:24},()=>call(email(),address)));assert.equal(values.filter(Boolean).length,20);assert.equal(await count(email(),address),20);
});
test('a different configured HMAC key cannot split counters or silently rebind the persistent key',async()=>{
  const identifier=email(),address=ip();assert.equal(await call(identifier,address),true);
  const other=createLoginAdmission({connectionString:runtimeUrl,environment:'test'},randomBytes(32));assert.equal(await other(identifier,address,signal()),false);
  assert.equal(await count(identifier,address),1);assert.equal(await call(identifier,address),true);
  await assert.rejects(client.query('UPDATE crest_private.login_limit_state SET key_fingerprint=$1',[randomBytes(32)]),error=>error.code==='42501');
});
test('SQL malformed inputs and stale isolation deny without appending any admission',async()=>{
  const identifier=email(),address=ip(),args=parameters(identifier,address),sql='SELECT crest_commands.admit_login($1,$2,$3)';
  for(const [index,value] of [[0,null],[0,Buffer.alloc(31)],[1,Buffer.alloc(33)],[2,null],[2,Buffer.alloc(31)]]){
    const bad=[...args];bad[index]=value;await asWeb(async()=>{await assert.rejects(client.query(sql,bad),error=>error.code==='22023');});
  }
  await asWeb(async()=>{await assert.rejects(client.query(sql,args),error=>error.code==='25001');},'REPEATABLE READ');assert.equal(await count(identifier,address),0);
});
test('expired cleanup is bounded and the closed owner cannot delete recent or update operational attempts',async()=>{
  const identifier=email(),address=ip(),args=parameters(identifier,address);
  await client.query("INSERT INTO crest_private.login_attempts(identifier_hash,ip_hash,admitted_at) SELECT $1,$2,clock_timestamp()-interval '16 minutes' FROM generate_series(1,300)",args.slice(0,2));
  assert.equal(await call(identifier,address),true);assert.equal(await count(identifier,address),45,'at most256 expired rows are removed per request');
  await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_login_owner');assert.equal((await client.query('DELETE FROM crest_private.login_attempts WHERE identifier_hash=$1',[args[0]])).rowCount,44);}finally{await client.query('ROLLBACK');}
  await client.query('BEGIN');try{await client.query('SET LOCAL ROLE crest_login_owner');await assert.rejects(client.query('UPDATE crest_private.login_attempts SET admitted_at=clock_timestamp()'),error=>error.code==='42501');}finally{await client.query('ROLLBACK');}
});
test('rolled-back admission leaves no durable reservation and a committed reservation survives another adapter',async()=>{
  const identifier=email(),address=ip(),args=parameters(identifier,address);
  await asWeb(async()=>{assert.equal((await client.query('SELECT crest_commands.admit_login($1,$2,$3) AS allowed',args)).rows[0].allowed,true);});
  assert.equal(await count(identifier,address),0);assert.equal(await call(identifier,address),true);
  assert.equal(await createLoginAdmission({connectionString:runtimeUrl,environment:'test'},key)(identifier,address,signal()),true);assert.equal(await count(identifier,address),2);
});
test('cancellation and database failure fail closed and retain no runtime connection',async()=>{
  const identifier=email(),address=ip(),locker=await sandbox.connect(target),controller=new AbortController();
  await locker.query('BEGIN');await locker.query('SELECT singleton FROM crest_private.login_limit_state FOR UPDATE');
  const pending=denied(admit(identifier,address,controller.signal));try{await blocked();controller.abort();await pending;}finally{await locker.query('ROLLBACK');}
  assert.equal(await count(identifier,address),0);
  const url=new URL(runtimeUrl);url.port='1';await denied(createLoginAdmission({connectionString:url.toString(),environment:'test'},key)(identifier,address,signal()));
  await denied(createLoginAdmission({connectionString:target,environment:'test'},key)(identifier,address,signal()));
  assert.equal(await call(identifier,address),true);
  assert.equal((await sandbox.admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1 AND usename=$2",[new URL(target).pathname.slice(1),login])).rows[0].n,0);
});
test('migration rejects owned-role and writable-schema drift without partially creating operational tables',async()=>{
  // Release only this fixture-owned runtime membership before new DB bootstrap.
  await sandbox.admin.query(`DROP ROLE ${login}`);loginOwned=false;
  for(const drift of ['login','create']){
    const db=await sandbox.database(),c=await sandbox.connect(db);
    await sandbox.apply(db,await sandbox.prefix(0),true);await installProviderSchema(c,db);await sandbox.apply(db,await sandbox.prefix(7));
    if(drift==='login')await sandbox.admin.query('ALTER ROLE crest_login_owner LOGIN');else await c.query('GRANT CREATE ON SCHEMA public TO crest_login_owner');
    try{
      await assert.rejects(sandbox.apply(db));
      assert.equal((await c.query("SELECT to_regclass('crest_private.login_attempts') AS relation")).rows[0].relation,null);
      assert.equal((await c.query("SELECT to_regprocedure('crest_commands.admit_login(bytea,bytea,bytea)') AS routine")).rows[0].routine,null);
      assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,7);
    }finally{if(drift==='login')await sandbox.admin.query('ALTER ROLE crest_login_owner NOLOGIN');else await c.query('REVOKE CREATE ON SCHEMA public FROM crest_login_owner');}
  }
});
