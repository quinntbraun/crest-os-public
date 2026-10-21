import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { after,before,test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { migrationSandbox } from "../support/migration-sandbox.mjs";
import { localSessionEligibility,sessionLimits } from "../../src/security/session-policy.ts";

let sandbox; let client; let target; let schema2; let oldReceipt; let receipt; let owner; let bootstrap; let beforeHash;
const identitiesHash = async () => (await client.query("SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'UTF8')),'hex') AS hash FROM crest_private.identity_events e")).rows[0].hash;
before(async () => {
  sandbox=await migrationSandbox(); target=await sandbox.database(); schema2=await sandbox.prefix(2);
  oldReceipt=await sandbox.apply(target,schema2,true); client=await sandbox.connect(target);
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  await client.query("BEGIN");
  owner=await makeActor(); const backup=await makeActor();
  const business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic session business','UTC',$1,$1,'manual') RETURNING id",[owner])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,owner,backup]);
  await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner]);
  await client.query("COMMIT"); beforeHash=await identitiesHash();
  receipt=await sandbox.apply(target);
});
after(async () => { await sandbox?.close(); });
async function makeActor() {
  return (await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic session owner','https://auth.example.com/auth/v1',$1,$2,$2,'manual') RETURNING id",[randomUUID(),bootstrap])).rows[0].id;
}
async function transaction(body) { await client.query("BEGIN"); try { await body(); } finally { await client.query("ROLLBACK"); } }
async function denied(body,code="23514") {
  await client.query("SAVEPOINT expected_denial");
  try { await assert.rejects(body(),(error)=>error.code===code); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_denial"); }
}
async function fixture(options={}) {
  const actor=options.actor??owner;
  const state=(await client.query("SELECT current_security_epoch FROM crest_private.actors WHERE id=$1",[actor])).rows[0];
  const created=options.created??(await client.query("SELECT date_trunc('milliseconds',clock_timestamp())-interval '1 hour' AS stamp")).rows[0].stamp;
  const trusted=options.trusted??true;
  const expires=options.expires??new Date(created.getTime()+(trusted?sessionLimits.trustedAbsoluteMs:sessionLimits.untrustedAbsoluteMs));
  return (await client.query("INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$5,$5,$6,$7,$8,'synthetic-test-key',$1,$1) RETURNING *",
    [actor,options.provider??randomUUID(),options.hash??randomBytes(32),options.epoch??state.current_security_epoch,created,expires,trusted,Buffer.from("synthetic-encrypted-placeholder")])).rows[0];
}
async function local(id,recent=false) {
  const row=(await client.query("SELECT s.*,a.kind,a.disabled_at,a.current_security_epoch,date_trunc('milliseconds',clock_timestamp()) AS now FROM crest_private.app_sessions s JOIN crest_private.actors a ON a.id=s.actor_id WHERE s.id=$1",[id])).rows[0];
  return localSessionEligibility({actorId:row.actor_id,issuedSecurityEpoch:row.issued_security_epoch,trusted:row.trusted,
    createdAt:row.created_at.getTime(),authenticatedAt:row.authenticated_at.getTime(),lastActiveAt:row.last_active_at.getTime(),expiresAt:row.expires_at.getTime(),revokedAt:row.revoked_at?.getTime()??null,reauthAt:row.reauth_at?.getTime()??null},
    {id:row.actor_id,kind:row.kind,securityEpoch:row.current_security_epoch,disabled:row.disabled_at!==null},row.now.getTime(),"foreground",recent);
}

test("schema2 identity history survives schema3 unchanged; real CLI no-op retains history",async () => {
  assert.equal(oldReceipt.history.length,2); assert.equal(receipt.history.length,3);
  assert.deepEqual(receipt.history.slice(0,2),oldReceipt.history); assert.equal(await identitiesHash(),beforeHash);
  assert.deepEqual((await sandbox.apply(target)).history,receipt.history);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.app_sessions")).rows[0].n,0);
});
test("session tables force RLS and deny all runtime/provider reads, writes and helper execution",async () => transaction(async () => {
  const tables=(await client.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest_private' AND c.relname IN ('app_sessions','session_events')")).rows;
  assert.equal(tables.length,2); for(const t of tables) { assert(t.relrowsecurity&&t.relforcerowsecurity); assert.equal(t.owner,"crest_schema_owner"); }
  for(const role of ["crest_web","crest_worker","crest_command_owner","crest_recovery","anon","authenticated","service_role"]) {
    for(const table of ["app_sessions","session_events"]) assert.equal((await client.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[role,`crest_private.${table}`])).rows[0].allowed,false);
    for(const fn of ["validate_session_change()","record_session_event()"]) assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,`crest_private.${fn}`])).rows[0].allowed,false);
  }
  const s=await fixture(); assert(s);
  await client.query("SET LOCAL ROLE crest_schema_owner");
  for(const table of ["app_sessions","session_events"]) assert.equal((await client.query(`SELECT count(*)::int AS n FROM crest_private.${table}`)).rows[0].n,0);
}));
test("hashed cookie/provider-session identities are unique and immutable",async () => transaction(async () => {
  const s=await fixture();
  await denied(()=>fixture({hash:s.token_hash}),"23505"); await denied(()=>fixture({provider:s.provider_session_id}),"23505");
  await denied(()=>fixture({hash:randomBytes(31)}));
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET provider_session_id=$1,version=version+1 WHERE id=$2",[randomUUID(),s.id]),"55000");
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET token_hash=$1,version=version+1 WHERE id=$2",[randomBytes(32),s.id]),"55000");
}));
test("unlinked, disabled, system and stale-epoch identities cannot create app sessions",async () => transaction(async () => {
  const unlinked=await makeActor(); await denied(()=>fixture({actor:unlinked}));
  await denied(()=>fixture({actor:bootstrap})); await denied(()=>fixture({epoch:randomUUID()}));
  await client.query("UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1",[owner]);
  await denied(()=>fixture());
}));
test("absolute expiry uses elapsed hours even across DST and rejects future/corrupt time",async () => transaction(async () => {
  await client.query("SET LOCAL TIME ZONE 'America/New_York'");
  const created=new Date("2025-11-02T04:00:00Z");
  const calendar=(await client.query("SELECT $1::timestamptz+interval '30 days' AS expiry",[created])).rows[0].expiry;
  assert.equal(calendar.getTime()-created.getTime(),721*60*60*1000);
  await fixture({created}); await denied(()=>fixture({created,expires:calendar}));
  const now=(await client.query("SELECT clock_timestamp() AS stamp")).rows[0].stamp;
  await denied(()=>fixture({created:new Date(now.getTime()+60000)}));
  const s=await fixture({trusted:false});
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET expires_at=expires_at+interval '1 second',version=version+1 WHERE id=$1",[s.id]));
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET trusted=true,version=version+1 WHERE id=$1",[s.id]),"55000");
}));
test("refresh/activity do not extend absolute expiry or fifteen-minute recent authentication",async () => transaction(async () => {
  const s=await fixture(); const events=(await client.query("SELECT count(*)::int AS n FROM crest_private.session_events")).rows[0].n;
  assert.equal((await local(s.id,true)).reason,"RECENT_AUTH_REQUIRED");
  await client.query("UPDATE crest_private.app_sessions SET provider_token_ciphertext=$1,last_active_at=date_trunc('milliseconds',clock_timestamp()),version=version+1 WHERE id=$2",[Buffer.from("synthetic-refreshed-placeholder"),s.id]);
  assert.equal((await local(s.id,true)).reason,"RECENT_AUTH_REQUIRED");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.session_events")).rows[0].n,events);
  await client.query("UPDATE crest_private.app_sessions SET reauth_at=date_trunc('milliseconds',clock_timestamp()),version=version+1 WHERE id=$1",[s.id]);
  const decision=await local(s.id,true); assert.equal(decision.state,"locally_eligible"); assert.equal(decision.providerAndTenantVerificationRequired,true);
  const refreshed=(await client.query("SELECT * FROM crest_private.app_sessions WHERE id=$1",[s.id])).rows[0];
  assert.equal(refreshed.expires_at.getTime(),s.expires_at.getTime()); assert.equal(refreshed.authenticated_at.getTime(),s.authenticated_at.getTime());
}));
test("revocation clears token ciphertext atomically and cannot be undone",async () => transaction(async () => {
  const s=await fixture(); assert.equal((await local(s.id)).state,"locally_eligible");
  await client.query("UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1",[s.id]);
  assert.equal((await local(s.id)).reason,"REVOKED");
  const revoked=(await client.query("SELECT provider_token_ciphertext,key_id FROM crest_private.app_sessions WHERE id=$1",[s.id])).rows[0];
  assert.deepEqual(revoked,{provider_token_ciphertext:null,key_id:null});
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET revoked_at=NULL,version=version+1 WHERE id=$1",[s.id]),"55000");
  await denied(()=>client.query("UPDATE crest_private.app_sessions SET provider_token_ciphertext=$1,key_id='synthetic-test-key',version=version+1 WHERE id=$2",[Buffer.from("synthetic-reuse"),s.id]),"55000");
}));
test("live security epoch and actor disable invalidate an existing session on its next local check",async () => transaction(async () => {
  const s=await fixture();
  await client.query("UPDATE crest_private.actors SET current_security_epoch=gen_random_uuid(),version=version+1 WHERE id=$1",[owner]);
  assert.equal((await local(s.id)).reason,"ACTOR_UNAVAILABLE");
  const another=await fixture(); assert.equal((await local(another.id)).state,"locally_eligible");
  await client.query("UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1",[owner]);
  assert.equal((await local(another.id)).reason,"ACTOR_UNAVAILABLE");
}));
test("session security history omits cookie hashes, provider IDs, ciphertext, key IDs and future secrets",async () => transaction(async () => {
  await client.query("ALTER TABLE crest_private.app_sessions ADD COLUMN fixture_secret text DEFAULT 'synthetic-do-not-audit'");
  const s=await fixture(); await client.query("UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1",[s.id]);
  const events=(await client.query("SELECT * FROM crest_private.session_events WHERE session_id=$1 ORDER BY created_at",[s.id])).rows;
  assert.deepEqual(events.map(e=>e.action),["CREATED","SECURITY_CHANGED"]);
  const json=JSON.stringify(events.map(e=>e.payload));
  for(const omitted of ["token_hash","provider_session_id","provider_token_ciphertext","key_id","fixture_secret",s.token_hash.toString("hex"),s.provider_session_id,"synthetic-do-not-audit","synthetic-encrypted-placeholder"]) assert(!json.includes(omitted));
  assert.equal((await client.query("SELECT count(*)::int AS n FROM crest_private.session_events WHERE event_hash<>encode(sha256(convert_to(payload::text,'UTF8')),'hex')")).rows[0].n,0);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  for(const table of ["app_sessions","session_events"]) {
    await denied(()=>client.query(`DELETE FROM crest_private.${table}`),"55000");
    await denied(()=>client.query(`TRUNCATE crest_private.${table} CASCADE`),"55000");
  }
  await denied(()=>client.query("UPDATE crest_private.session_events SET event_hash=repeat('0',64)"),"55000");
}));
test("refresh row lock makes a second refresher observe the first committed version",async () => {
  const s=await fixture(); const first=await sandbox.connect(target); const second=await sandbox.connect(target);
  try {
    await first.query("BEGIN"); await second.query("BEGIN");
    const pid=(await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await first.query("SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE",[s.id]);
    const waiting=second.query("SELECT version FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE",[s.id]).then(value=>({value}),error=>({error}));
    const deadline=Date.now()+3000; let blocked=false;
    while(!blocked&&Date.now()<deadline) { blocked=(await sandbox.admin.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked; if(!blocked) await delay(20); }
    assert(blocked,"actual second refresher must block before first commit");
    await first.query("UPDATE crest_private.app_sessions SET provider_token_ciphertext=$1,version=version+1 WHERE id=$2",[Buffer.from("synthetic-first-refresh"),s.id]); await first.query("COMMIT");
    const outcome=await waiting; assert(!outcome.error); assert.equal(outcome.value.rows[0].version,"2");
    await second.query("COMMIT");
  } finally { await first.query("ROLLBACK"); await second.query("ROLLBACK"); }
});
test("both previous supported schemas upgrade through actual CLI with no rewritten history",async () => {
  const from1=await sandbox.database(); const prior=await sandbox.apply(from1,await sandbox.prefix(1),true);
  const upgraded=await sandbox.apply(from1); assert.deepEqual(upgraded.history.slice(0,1),prior.history); assert.deepEqual(upgraded.history,receipt.history);
  const fresh=await sandbox.database(); assert.deepEqual((await sandbox.apply(fresh,sandbox.root,true)).history,receipt.history);
});
