import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

const issuer='https://auth.example.com/auth/v1',table='crest_private.provider_login_targets';
const recordFn='crest_commands.record_provider_login_target(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz)',issueFn='crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)',inventoryFn='crest_commands.provider_login_target_inventory(uuid,text,uuid,integer)';
let sandbox,target,client,web,second,maintenance,bootstrap,owner,other,business,prior,receipt,retained;
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic target owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,subject,bootstrap])).rows[0];return {id:a.id,subject,epoch:a.current_security_epoch};}
async function member(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
const begin=(a=owner)=>web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),issuer,a.subject]).then(r=>r.rows[0].result);
async function fixture(a=owner){const b=await begin(a),p=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[p,a.subject]);const passwordAt=new Date(Math.floor(Date.now()/1000)*1000),expiresAt=new Date(Date.now()+60000);return {a,b,p,passwordAt,expiresAt,args:[b.attemptId,a.id,b.securityEpoch,issuer,a.subject,p,passwordAt,expiresAt]};}
const capture=(f,c=web)=>c.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8) AS result',f.args).then(r=>r.rows[0].result);
const inventory=(a=owner,{cursor=null,size=100,expectedIssuer=issuer,c=maintenance}={})=>c.query('SELECT * FROM crest_commands.provider_login_target_inventory($1,$2,$3,$4)',[a.id,expectedIssuer,cursor,size]).then(r=>r.rows);
async function issue(f,{legacy=false,untracked=false,mutate=()=>{}}={}){await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);const hash=randomBytes(32),args=[f.b.appSessionId,hash,f.a.id,f.b.securityEpoch,issuer,f.a.subject,f.p,f.passwordAt,new Date(),false,randomBytes(32),'synthetic',f.b.attemptId];mutate(args);await web.query(`SELECT crest_commands.${untracked?'issue_app_session':legacy?'issue_tracked_app_session':'issue_targeted_app_session'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,args);return {hash,id:args[0]};}
async function sources(){return (await client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY attempt_id) FROM crest_private.provider_login_attempts s))::text,'UTF8')),'hex') AS hash")).rows[0].hash;}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(20));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic target business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await member(owner);await member(other);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
  web=await sandbox.connect(target);second=await sandbox.connect(target);maintenance=await sandbox.connect(target);for(const c of [web,second])await c.query('SET ROLE crest_web');await maintenance.query('SET ROLE crest_inventory');
  const f=await fixture();await issue(f,{legacy:true});retained=await sources();receipt=await sandbox.apply(target,await sandbox.prefix(21));
});
after(async()=>{await sandbox?.close();});

test('schema20 upgrade preserves all source state and does not invent historical targets',async()=>{
  assert.equal(prior.history.length,20);assert.equal(receipt.history.length,21);assert.deepEqual(receipt.history.slice(0,20),prior.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(21))).history,receipt.history);assert.equal(await sources(),retained);assert.deepEqual(await inventory(),[]);
});
test('recording retains an exact portable token-free reference without changing provider/header/app sources',async()=>{
  const f=await fixture(),before=await sources(),r=await capture(f);assert.equal(await sources(),before);assert.equal(r.evidence.attemptId,f.b.attemptId);assert.equal(r.evidence.providerSessionId,f.p);assert.equal(r.evidence.appSessionId,f.b.appSessionId);assert.equal(r.evidence.securityEpoch,f.b.securityEpoch);assert.equal(r.evidence.databasePrincipal,'supabase_admin');assert.deepEqual(JSON.parse(r.canonicalEvidence),r.evidence);assert.equal(createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex'),r.evidenceHash);
  assert.deepEqual(Object.keys(r.evidence).sort(),['accessExpiresAt','actorId','appSessionId','attemptId','createdAt','databasePrincipal','origin','passwordAt','providerIssuer','providerSessionId','providerSubject','schemaVersion','securityEpoch'].sort());assert.equal((await inventory()).find(r=>r.attempt_id===f.b.attemptId).registration_state,'registration_unconfirmed');
});
test('exact replay returns original evidence bytes after current epoch/provider/registration changes',async()=>{
  const a=await actor();await member(a);const f=await fixture(a),first=await capture(f),s=await issue(f);await client.query('UPDATE crest_private.app_sessions SET operation_id=$1,version=version+1 WHERE id=$2',[randomUUID(),s.id]);await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[s.hash,randomUUID()]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);assert.deepEqual(await capture(f),first);const [r]=await inventory(a);assert.equal(r.registration_state,'registration_recorded');assert.equal(r.provider_session_id,f.p);assert(r.local_revoked_at);
});
test('different typed replay inputs conflict without overwriting the original receipt',async()=>{
  const f=await fixture(),first=await capture(f);for(const [i,value] of [[1,other.id],[2,randomUUID()],[3,'https://other.example.com/auth/v1'],[4,other.subject],[5,randomUUID()],[6,new Date(f.passwordAt.getTime()+1)],[7,new Date(f.expiresAt.getTime()+1)]]){const args=[...f.args];args[i]=value;await assert.rejects(capture({...f,args}),e=>e.code==='23505');}assert.deepEqual(await capture(f),first);
});
test('capture rejects a missing header or any mismatched immutable actor/epoch/issuer/subject',async()=>{
  const f=await fixture();for(const [i,value] of [[0,randomUUID()],[1,other.id],[2,randomUUID()],[3,'https://other.example.com/auth/v1'],[4,other.subject]]){const args=[...f.args];args[i]=value;await assert.rejects(capture({...f,args}),e=>e.code==='23514');}assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));
});
test('timestamp bounds reject malformed, pre-attempt and future values and accept the exact database boundary',async()=>{
  const f=await fixture();for(const [i,value] of [[0,null],[5,null],[6,null],[6,'infinity'],[7,'-infinity'],[7,f.passwordAt],[3,''],[3,'x'.repeat(501)]]){const args=[...f.args];args[i]=value;await assert.rejects(capture({...f,args}),e=>e.code==='22023');}
  // The provider timestamp is sampled after begin/insert work and can cross a
  // second boundary. One second before that later sample may still be valid.
  // Derive the actual inclusive floor from the immutable database header.
  const earliest=(await client.query("SELECT date_trunc('second',created_at) AS earliest FROM crest_private.provider_login_attempts WHERE attempt_id=$1",[f.b.attemptId])).rows[0].earliest;
  const before=[...f.args];before[6]=new Date(earliest.getTime()-1);await assert.rejects(capture({...f,args:before}),e=>e.code==='23514');
  // Evaluate future values in PostgreSQL, so host clock skew or scheduling
  // between sampling and dispatch cannot turn this into a valid past sample.
  await assert.rejects(web.query("SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '1 day',clock_timestamp()+interval '2 days')",f.args.slice(0,6)),e=>e.code==='23514');
  assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));
  await web.query('BEGIN');try{const atBoundary=[...f.args];atBoundary[6]=earliest;const recorded=await capture({...f,args:atBoundary});assert.equal(new Date(recorded.evidence.passwordAt).getTime(),earliest.getTime());}finally{await web.query('ROLLBACK');}
  assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));
});
test('late signed evidence remains recordable after recovery, disable or provider disappearance without authorizing issuance',async()=>{
  const a=await actor();await member(a);const f=await fixture(a);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);const r=await capture(f);assert.equal(r.evidence.securityEpoch,f.b.securityEpoch);assert.equal((await inventory(a))[0].registration_state,'registration_unconfirmed');await assert.rejects(issue(f),e=>e.code==='42501');
});
test('a provider session can belong to only one retained attempt',async()=>{
  const f=await fixture();await capture(f);const g=await fixture(),args=[...g.args];args[5]=f.p;await assert.rejects(capture({...g,args}),e=>e.code==='23505');
});
test('first capture cannot adopt an already registered app/provider session',async()=>{
  const f=await fixture();await issue(f,{legacy:true});await assert.rejects(capture(f),e=>e.code==='23514');
});
test('overlapping captures return busy and committed replay returns the same one receipt',async()=>{
  const f=await fixture();await web.query('BEGIN');try{const first=await capture(f);await assert.rejects(capture(f,second),e=>e.code==='55P03');assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));await web.query('COMMIT');assert.deepEqual(await capture(f,second),first);}finally{await web.query('ROLLBACK');}
});
test('rollback releases a capture claim without inventing a completed provider outcome',async()=>{
  const f=await fixture();await web.query('BEGIN');try{await capture(f);await assert.rejects(capture(f,second),e=>e.code==='55P03');}finally{await web.query('ROLLBACK');}assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));assert.equal((await capture(f,second)).evidence.providerSessionId,f.p);
});
test('injected append failure leaves no partial receipt or source changes',async()=>{
  const f=await fixture(),before=await sources();await client.query("CREATE FUNCTION crest_private.target_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_TARGET_FAILURE'; END $$");await client.query(`CREATE TRIGGER zz_target_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION crest_private.target_failure_probe()`);try{await assert.rejects(capture(f),e=>e.code==='23514');}finally{await client.query(`DROP TRIGGER zz_target_failure ON ${table}`);await client.query('DROP FUNCTION crest_private.target_failure_probe()');}assert.equal(await sources(),before);assert(!(await inventory()).some(r=>r.attempt_id===f.b.attemptId));assert.equal((await capture(f)).evidence.attemptId,f.b.attemptId);
});
test('targeted issuance requires a receipt and exact target/password/actor/epoch/source operation',async()=>{
  const f=await fixture();await assert.rejects(issue(f),e=>e.code==='42501');await capture(f);for(const [i,value] of [[0,randomUUID()],[2,other.id],[3,randomUUID()],[4,'https://other.example.com/auth/v1'],[5,other.subject],[6,randomUUID()],[7,new Date(f.passwordAt.getTime()+1)],[12,randomUUID()]])await assert.rejects(issue(f,{mutate:args=>{args[i]=value;}}),e=>e.code==='42501');const s=await issue(f);assert.equal((await client.query("SELECT operation_id FROM crest_private.session_events WHERE session_id=$1 AND action='CREATED'",[s.id])).rows[0].operation_id,f.b.attemptId);
});
test('a receipt never replaces current MFA/provider or security-epoch checks',async()=>{
  const a=await actor();await member(a);const f=await fixture(a);await capture(f);await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);await assert.rejects(issue(f),e=>e.code==='42501');assert.equal((await inventory(a))[0].registration_state,'registration_unconfirmed');
});
test('registration inventory distinguishes unknown and mismatched source without declaring cleanup success',async()=>{
  const a=await actor();await member(a);const f=await fixture(a);await capture(f);await issue(f,{untracked:true,mutate:args=>{args[12]=randomUUID();}});const [r]=await inventory(a);assert.equal(r.registration_state,'binding_conflict_review');assert.equal(r.provider_session_id,f.p);assert.equal(r.local_revoked_at,null);assert(!('cleanupAllowed' in r.evidence));
});
test('bounded keyset pages are scoped to actor/exact issuer and remain read-only observations',async()=>{
  const a=await actor();await member(a);const ids=[];for(let i=0;i<5;i++){const f=await fixture(a);await capture(f);ids.push(f.b.attemptId);}ids.sort();const seen=[];let cursor=null;for(let i=0;i<4;i++){const rows=await inventory(a,{cursor,size:2});assert(rows.length<=2);seen.push(...rows.map(r=>r.attempt_id));if(!rows.length)break;cursor=rows.at(-1).attempt_id;}assert.deepEqual(seen,ids);assert.deepEqual(await inventory(a,{expectedIssuer:'https://other.example.com/auth/v1'}),[]);for(const size of [null,0,101])await assert.rejects(inventory(a,{size}),e=>e.code==='22023');await maintenance.query('BEGIN READ ONLY');try{assert.equal((await inventory(a)).length,5);}finally{await maintenance.query('ROLLBACK');}
});
test('capture and inventory require fresh READ COMMITTED; a read-only transaction cannot append',async()=>{
  const f=await fixture();for(const c of [web,maintenance]){await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(c===web?capture(f):inventory(),e=>e.code==='25001');}finally{await c.query('ROLLBACK');}}await web.query('BEGIN READ ONLY');try{await assert.rejects(capture(f),e=>e.code==='25006');}finally{await web.query('ROLLBACK');}
});
test('privileged insert cannot smuggle provenance/body/hash and retained evidence cannot be edited or removed',async()=>{
  const f=await fixture();await client.query(`INSERT INTO ${table}(attempt_id,actor_id,issued_security_epoch,provider_issuer,provider_subject,provider_session_id,password_at,access_expires_at,schema_version,origin,created_at,database_principal,canonical_evidence,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,999,'manual','-infinity','forged','{"password":"synthetic-forged"}','forged')`,f.args);const r=await capture(f);assert.equal(r.evidence.schemaVersion,1);assert.equal(r.evidence.origin,'system');assert.equal(r.evidence.databasePrincipal,'supabase_admin');assert(!r.canonicalEvidence.includes('forged'));assert.match(r.evidence.createdAt,/\+00:00$/);for(const sql of [`UPDATE ${table} SET event_hash=repeat('0',64) WHERE attempt_id=$1`,`DELETE FROM ${table} WHERE attempt_id=$1`])await assert.rejects(client.query(sql,[f.b.attemptId]),e=>e.code==='55000');await assert.rejects(client.query(`TRUNCATE ${table}`),e=>e.code==='55000');assert.deepEqual(await capture(f),r);
});
test('fixed definers and forced RLS expose no raw evidence or source writes to ordinary callers',async()=>{
  assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[table])).rows[0],{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});for(const [fn,owner] of [[recordFn,'crest_session_owner'],[issueFn,'crest_session_owner'],[inventoryFn,'crest_inventory_owner']])assert.deepEqual((await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0],{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner});
  for(const c of [web,maintenance])await assert.rejects(c.query(`SELECT * FROM ${table}`),e=>e.code==='42501');await assert.rejects(inventory(owner,{c:web}),e=>e.code==='42501');await assert.rejects(capture(await fixture(),maintenance),e=>e.code==='42501');for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_auth_reader'])for(const fn of [recordFn,issueFn,inventoryFn])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);
  for(const source of ['auth.sessions','auth.users','auth.refresh_tokens','crest_private.actors','crest_private.app_sessions','crest_private.session_events'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_inventory_owner',$1,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',$1,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[source])).rows[0].allowed,false);
});
test('schema19 upgrade through20/21 preserves compatible history',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const before=await sandbox.apply(t,await sandbox.prefix(19)),after=await sandbox.apply(t,await sandbox.prefix(21));assert.equal(after.history.length,21);assert.deepEqual(after.history.slice(0,19),before.history);
});
test('unexpected source-event read/write grants or upstream definer drift block21 and retain pending review',async()=>{
  for(const change of ['GRANT SELECT(payload) ON crest_private.session_events TO crest_inventory_owner','GRANT DELETE ON auth.sessions TO crest_inventory_owner','ALTER FUNCTION crest_commands.session_actor_context(text,uuid) RESET row_security']){const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(20));await c.query(change);await assert.rejects(sandbox.apply(t,await sandbox.prefix(21)),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT to_regclass($1) AS table',[table])).rows[0].table,null);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,20);await assert.rejects(sandbox.apply(t,await sandbox.prefix(21)),/MIGRATION_PENDING_REVIEW_REQUIRED/);}
});
