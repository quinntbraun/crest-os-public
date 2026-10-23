// Real PostgreSQL/RLS/transactions, synthetic sessions. Provider reconciliation
// itself is deliberately not implemented by this token-free reference slice.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

let sandbox,client,target,web,second,login,loginOwned=false,bootstrap,owner,other,business,prior,receipt,legacy,active,initiallyRevoked,retained;
const relation='crest_private.provider_cleanup_references';
const rows=async id=>(await client.query(`SELECT to_jsonb(r) AS row FROM ${relation} r WHERE app_session_id=$1`,[id])).rows.map(r=>r.row);
const session=async id=>(await client.query('SELECT to_jsonb(s) AS row FROM crest_private.app_sessions s WHERE id=$1',[id])).rows[0].row;
const events=async id=>(await client.query('SELECT to_jsonb(e) AS row FROM crest_private.session_events e WHERE session_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>r.row);
const revoke=(f,c=web)=>c.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);
async function actor(){return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic cleanup owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id",[randomUUID(),bootstrap])).rows[0].id;}
async function fixture({actorId=owner,expired=false,revoked=false}={}){
  const hash=randomBytes(32),provider=randomUUID();
  const row=(await client.query("WITH moment AS (SELECT clock_timestamp()-CASE WHEN $5 THEN interval '14 hours' ELSE interval '1 second' END AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by,revoked_at) SELECT id,$2,$3,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$4,'synthetic',id,id,CASE WHEN $6 THEN clock_timestamp() ELSE NULL END FROM crest_private.actors,moment WHERE id=$1 RETURNING id",[actorId,provider,hash,randomBytes(32),expired,revoked])).rows[0];
  return {id:row.id,hash,provider,actor:actorId};
}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(16));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{
    business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic cleanup business','UTC',$1,$1,'manual') RETURNING id",[owner])).rows[0].id;
    await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,owner,other]);
    await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  legacy=await fixture();await revoke(legacy,client);active=await fixture();initiallyRevoked=await fixture({revoked:true});
  retained={legacy:await session(legacy.id),events:await events(legacy.id),active:await session(active.id),initial:await session(initiallyRevoked.id)};
  receipt=await sandbox.apply(target);
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');
  assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
  await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_web TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());second=await sandbox.connect(url.toString());
  for(const c of [web,second])await c.query("SET ROLE crest_web; SET lock_timeout='3s'");
});
after(async()=>{await web?.end();await second?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});

test('schema16 upgrade backfills proven revocations without changing retained source/history or receipt prefixes',async()=>{
  assert.equal(prior.history.length,16);assert.equal(receipt.history.length,17);assert.deepEqual(receipt.history.slice(0,16),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.deepEqual(await session(legacy.id),retained.legacy);assert.deepEqual(await events(legacy.id),retained.events);assert.deepEqual(await session(active.id),retained.active);assert.deepEqual(await session(initiallyRevoked.id),retained.initial);
  const [reference]=await rows(legacy.id);assert.equal(reference.provider_session_id,legacy.provider);assert.equal(reference.state,'review_required');assert.equal(reference.source_event_id,retained.events[1].id);assert.equal(reference.source_event_hash,retained.events[1].event_hash);
  assert.deepEqual(await rows(active.id),[]);assert.deepEqual(await rows(initiallyRevoked.id),[]);
});
test('runtime local revocation atomically retains the exact reference and destroys token material',async()=>{
  const f=await fixture(),before=await session(f.id);await revoke(f);const after=await session(f.id),[reference]=await rows(f.id),history=await events(f.id);
  assert(after.revoked_at);assert.equal(after.provider_token_ciphertext,null);assert.equal(after.key_id,null);assert.equal(reference.app_session_id,f.id);assert.equal(reference.actor_id,f.actor);assert.equal(reference.provider_session_id,f.provider);
  assert.equal(reference.issued_security_epoch,before.issued_security_epoch);assert.equal(reference.revoked_at,after.revoked_at);assert.equal(reference.source_version,after.version);assert.equal(reference.source_event_id,history[1].id);assert.equal(reference.operation_id,history[1].operation_id);assert.equal(reference.state,'review_required');
  for(const key of Object.keys(reference))assert(!/token|cipher|secret|password|csrf|credential|email/i.test(key));
});
test('other devices and actors remain unchanged and cannot be recorded as the selected target',async()=>{
  const a=await fixture(),b=await fixture(),c=await fixture({actorId:other}),before=[await session(b.id),await session(c.id)];await revoke(a);
  assert.deepEqual([await session(b.id),await session(c.id)],before);assert.deepEqual(await rows(b.id),[]);assert.deepEqual(await rows(c.id),[]);assert.equal((await rows(a.id)).length,1);
});
test('repeated and unknown credentials cannot append duplicate references or events',async()=>{
  const f=await fixture();await revoke(f);const before={row:await session(f.id),refs:await rows(f.id),events:await events(f.id)};
  await revoke(f);await revoke({hash:randomBytes(32)});assert.deepEqual({row:await session(f.id),refs:await rows(f.id),events:await events(f.id)},before);
});
test('concurrent independent revocations serialize to one source transition and reference',async()=>{
  const f=await fixture();await Promise.all([revoke(f),revoke(f,second)]);assert.equal((await rows(f.id)).length,1);assert.equal((await events(f.id)).length,2);assert.equal((await session(f.id)).version,2);
});
test('rollback removes both local revocation and reference, preserving original encrypted storage',async()=>{
  const f=await fixture(),before=await session(f.id);await web.query('BEGIN');try{await revoke(f);assert.deepEqual(await rows(f.id),[]);await web.query('ROLLBACK');}finally{await web.query('ROLLBACK');}
  assert.deepEqual(await session(f.id),before);assert.equal((await events(f.id)).length,1);assert.deepEqual(await rows(f.id),[]);
});
test('reference insert failure rolls back revocation and its audit instead of confirming partial success',async()=>{
  const f=await fixture(),before=await session(f.id);
  await client.query("CREATE FUNCTION crest_private.cleanup_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_CLEANUP_FAILURE'; END $$");
  await client.query(`CREATE TRIGGER cleanup_failure_probe BEFORE INSERT ON ${relation} FOR EACH ROW EXECUTE FUNCTION crest_private.cleanup_failure_probe()`);
  try{await assert.rejects(revoke(f),e=>e.code==='23514');}finally{await client.query(`DROP TRIGGER cleanup_failure_probe ON ${relation}`);await client.query('DROP FUNCTION crest_private.cleanup_failure_probe()');}
  assert.deepEqual(await session(f.id),before);assert.equal((await events(f.id)).length,1);assert.deepEqual(await rows(f.id),[]);await revoke(f);assert.equal((await rows(f.id)).length,1);
});
test('all ordinary runtime roles lack raw reference access and direct trigger execution',async()=>{
  for(const role of ['crest_web','crest_worker','crest_recovery','anon','authenticated']){
    const p=(await client.query("SELECT has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[role,relation])).rows[0];assert.equal(p.allowed,false);
    for(const fn of ['crest_private.capture_cleanup_reference()','crest_private.validate_cleanup_reference()'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);
  }
  await assert.rejects(web.query(`SELECT * FROM ${relation}`),e=>e.code==='42501');await assert.rejects(web.query(`TRUNCATE ${relation}`),e=>e.code==='42501');await assert.rejects(web.query('SET ROLE crest_session_owner'),e=>e.code==='42501');
});
test('forced RLS and the fixed trigger definer preserve role isolation without provider grants',async()=>{
  assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[relation])).rows[0],{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});
  assert.deepEqual((await client.query("SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='crest_private.capture_cleanup_reference()'::regprocedure")).rows[0],{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner:'crest_session_owner'});
  assert.equal((await client.query("SELECT has_schema_privilege('crest_session_owner','crest_private','CREATE') AS allowed")).rows[0].allowed,false);
  for(const table of ['auth.sessions','auth.refresh_tokens'])assert.equal((await client.query("SELECT has_table_privilege('crest_session_owner',$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[table])).rows[0].allowed,false);
});
test('retained references cannot be updated, deleted or truncated even by migration authority',async()=>{
  const f=await fixture();await revoke(f);const before=await rows(f.id);
  for(const sql of [`UPDATE ${relation} SET state='review_required' WHERE app_session_id=$1`,`DELETE FROM ${relation} WHERE app_session_id=$1`])await assert.rejects(client.query(sql,[f.id]),e=>e.code==='55000');
  await assert.rejects(client.query(`TRUNCATE ${relation}`),e=>e.code==='55000');assert.deepEqual(await rows(f.id),before);
});
test('forged target, event hash, epoch and source versions fail the relational source guard',async()=>{
  const f=await fixture();await revoke(f);const [r]=await rows(f.id);
  const sql=`INSERT INTO ${relation}(app_session_id,actor_id,provider_session_id,issued_security_epoch,source_version,revoked_at,source_event_id,source_event_hash,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const values=[r.app_session_id,r.actor_id,r.provider_session_id,r.issued_security_epoch,r.source_version,r.revoked_at,r.source_event_id,r.source_event_hash,r.created_by,r.operation_id];
  for(const [index,value] of [[0,randomUUID()],[1,other],[2,randomUUID()],[3,randomUUID()],[4,'999'],[7,'0'.repeat(64)]]){const changed=[...values];changed[index]=value;await assert.rejects(client.query(sql,changed),e=>e.code==='23514');}
});
test('ordinary activity and token refresh do not create revocation references',async()=>{
  const f=await fixture();await client.query("UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1 WHERE id=$1",[f.id]);
  await client.query("UPDATE crest_private.app_sessions SET provider_token_ciphertext=$2,version=version+1 WHERE id=$1",[f.id,randomBytes(32)]);assert.deepEqual(await rows(f.id),[]);assert.equal((await events(f.id)).length,1);
});
test('expired or disabled local authority can still be revoked without a provider call or false confirmation',async()=>{
  const expired=await fixture({expired:true}),disabled=await actor();await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,disabled,owner]);
  const f=await fixture({actorId:disabled});await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[disabled]);
  for(const current of [expired,f]){await revoke(current);assert.equal((await rows(current.id))[0].state,'review_required');assert.equal((await session(current.id)).provider_token_ciphertext,null);}
});
test('immutable source binding cannot be altered to redirect a future cleanup reference',async()=>{
  const f=await fixture();for(const field of ['provider_session_id','issued_security_epoch'])await assert.rejects(client.query(`UPDATE crest_private.app_sessions SET ${field}=$2,version=version+1 WHERE id=$1`,[f.id,randomUUID()]),e=>e.code==='55000');
  assert.deepEqual(await rows(f.id),[]);await revoke(f);assert.equal((await rows(f.id))[0].provider_session_id,f.provider);
});
