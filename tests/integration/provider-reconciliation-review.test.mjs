import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import net from 'node:net';
import {once} from 'node:events';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {verifyProviderAttemptEvidence} from '../../src/security/provider-attempt-evidence.ts';
import {createProviderReconciliationReviewer,createProviderCleanupExecutor} from '../../src/security/provider-cleanup-maintenance.ts';
const runtimeRoles=[];let runtimeInventory,runtimeCleanup;
const freshSignal=()=>new AbortController().signal;
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
const issuer='https://auth.example.com/auth/v1',fn='crest_commands.provider_reconciliation_review(uuid,text,uuid,integer)';
let sandbox,target,client,web,second,maintenance,cleanup,bootstrap,owner,other,business,prior,receipt,retained,grants;
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic target owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,subject,bootstrap])).rows[0];return {id:a.id,subject,epoch:a.current_security_epoch};}
async function member(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
const begin=(a=owner)=>web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),issuer,a.subject]).then(r=>r.rows[0].result);
async function fixture(a=owner){const b=await begin(a),p=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[p,a.subject]);const passwordAt=new Date(Math.floor(Date.now()/1000)*1000),expiresAt=new Date(Date.now()+60000);return {a,b,p,passwordAt,expiresAt,args:[b.attemptId,a.id,b.securityEpoch,issuer,a.subject,p,passwordAt,expiresAt]};}
const capture=(f,c=web)=>c.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8) AS result',f.args).then(r=>r.rows[0].result);
async function issue(f,{legacy=false,mutate=()=>{},c=web}={}){await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);const hash=randomBytes(32),args=[f.b.appSessionId,hash,f.a.id,f.b.securityEpoch,issuer,f.a.subject,f.p,f.passwordAt,new Date(),false,randomBytes(32),'synthetic',f.b.attemptId];mutate(args);await c.query(`SELECT crest_commands.${legacy?'issue_tracked_app_session':'issue_open_app_session'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,args);return {hash,id:args[0]};}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(24));
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
 await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic review business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await member(owner);await member(other);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
 web=await sandbox.connect(target);second=await sandbox.connect(target);maintenance=await sandbox.connect(target);cleanup=await sandbox.connect(target);for(const c of [web,second])await c.query('SET ROLE crest_web');await maintenance.query('SET ROLE crest_inventory');await cleanup.query('SET ROLE crest_cleanup');
 const f=await fixture();await capture(f);f.stop=await finish(f);f.request=await request(f);await consume(f);retained=await sources();grants=await privileges();receipt=await sandbox.apply(target,await sandbox.prefix(25));
});
after(async()=>{for(const name of runtimeRoles)await sandbox.admin.query(`DROP ROLE ${name}`);await sandbox?.close();});
const finish=(f,phase='stopped_review',c=web)=>c.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[f.b.attemptId,f.a.id,f.b.securityEpoch,issuer,f.a.subject,phase]).then(r=>r.rows[0].result);
const request=f=>maintenance.query('SELECT crest_commands.request_provider_cleanup($1,$2,$3,$4) AS result',[randomUUID(),f.stop.evidence.finishId,f.a.id,issuer]).then(r=>r.rows[0].result);
const consume=(f,c=cleanup)=>c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3) AS result',[f.request.evidence.requestId,f.a.id,issuer]).then(r=>r.rows[0].result);
const page=(a=owner,{cursor=null,size=100,url=issuer,c=maintenance}={})=>c.query('SELECT * FROM crest_commands.provider_reconciliation_review($1,$2,$3,$4)',[a.id,url,cursor,size]).then(r=>r.rows);
const review=async(f,c=maintenance)=>(await page(f.a,{c})).find(r=>r.attempt_id===f.b.attemptId)?.observation;
async function selected(a=owner){const f=await fixture(a);await capture(f);f.stop=await finish(f);f.request=await request(f);return f;}
const sources=async()=>{
 const tables=['auth.sessions','crest_private.app_sessions','crest_private.session_events','crest_private.provider_login_attempts','crest_private.provider_login_targets','crest_private.provider_login_finishes','crest_private.provider_cleanup_requests','crest_private.provider_cleanup_outcomes'];
 const result={};for(const table of tables)result[table]=(await client.query(`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS hash FROM ${table} t`)).rows[0].hash;return result;
};
const privileges=()=>client.query("SELECT n.nspname,c.relname,c.relacl::text,array_agg(a.attacl::text ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname IN ('auth','crest','crest_private') GROUP BY n.nspname,c.relname,c.relacl::text ORDER BY 1,2").then(r=>r.rows);

test('schema24 upgrade preserves every source and all table/column privileges',async()=>{
 assert.equal(prior.history.length,24);assert.equal(receipt.history.length,25);assert.deepEqual(receipt.history.slice(0,24),prior.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(25))).history,receipt.history);assert.deepEqual(await sources(),retained);assert.deepEqual(await privileges(),grants);
});
test('a start without target or finish remains explicitly unconfirmed with original identity/hash',async()=>{
 const f=await fixture(),before=await sources(),r=await review(f);assert.equal(r.reviewState,'target_unconfirmed_review');assert.equal(r.target,null);assert.equal(r.stop,null);assert.equal(r.request,null);assert.equal(r.outcome,null);assert.equal(r.attempt.appSessionId,f.b.appSessionId);assert.equal(r.attempt.securityEpoch,f.b.securityEpoch);assert.equal(r.attempt.providerSubject,f.a.subject);assert.equal(r.attempt.evidenceHash,(await client.query('SELECT event_hash FROM crest_private.provider_login_attempts WHERE attempt_id=$1',[f.b.attemptId])).rows[0].event_hash);assert.deepEqual(await sources(),before);
});
test('a stopped unknown target and an expired provider timestamp never become automatic closure',async()=>{
 const f=await fixture();f.stop=await finish(f);await client.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 year' WHERE id=$1",[f.p]);const r=await review(f);assert.equal(r.reviewState,'target_unconfirmed_review');assert.equal(r.stop.finishId,f.stop.evidence.finishId);assert.equal(r.target,null);assert.equal(r.outcome,null);assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[f.p])).rows[0].n,1);
});
test('a late signed target appears after stop without rewriting original stop or inventing a request',async()=>{
 const f=await fixture();f.stop=await finish(f);await capture(f);const r=await review(f);assert.equal(r.reviewState,'stopped_without_request_review');assert.equal(r.target.providerSessionId,f.p);assert.equal(r.stop.evidenceHash,f.stop.evidenceHash);assert.equal(r.request,null);assert.equal(f.stop.evidence.providerSessionId,null);
});
test('a target without either finish remains finish-unconfirmed, even with a registered app',async()=>{
 const f=await fixture();await capture(f);await issue(f);const r=await review(f);assert.equal(r.reviewState,'finish_unconfirmed_review');assert.equal(r.registration.state,'registration_recorded');assert.equal(r.registration.providerSessionId,f.p);assert.equal(r.registration.localRevokedAt,null);
});
test('registration closure is a recorded local fact, not cleanup of an active device',async()=>{
 const f=await fixture();await capture(f);await issue(f);const closed=await finish(f,'registration_closed'),r=await review(f);assert.equal(r.reviewState,'registration_closed_recorded');assert.equal(r.registrationFinish.finishId,closed.evidence.finishId);assert.equal(r.stop,null);assert.equal(r.outcome,null);assert.equal((await client.query('SELECT revoked_at FROM crest_private.app_sessions WHERE id=$1',[f.b.appSessionId])).rows[0].revoked_at,null);
});
test('both local finish phases and their distinct original hashes remain visible after a stop',async()=>{
 const f=await fixture();await capture(f);await issue(f);const c=await finish(f,'registration_closed');f.stop=await finish(f);const r=await review(f);assert.equal(r.reviewState,'stopped_without_request_review');assert.equal(r.registrationFinish.evidenceHash,c.evidenceHash);assert.equal(r.stop.evidenceHash,f.stop.evidenceHash);assert(r.registration.localRevokedAt);
});
test('selected request is pending historical intent until a separate outcome is committed',async()=>{
 const f=await selected(),before=await sources(),r=await review(f);assert.equal(r.reviewState,'cleanup_outcome_unconfirmed_review');assert.equal(r.request.requestId,f.request.evidence.requestId);assert.equal(r.request.evidenceHash,f.request.evidenceHash);assert.equal(r.outcome,null);assert.deepEqual(await sources(),before);
});
test('removed outcome links original request/target/finish hashes without rewriting pending intent',async()=>{
 const f=await selected(),outcome=await consume(f),before=await sources(),r=await review(f);assert.equal(r.reviewState,'cleanup_outcome_recorded');assert.equal(r.target.evidenceHash,(await client.query('SELECT event_hash FROM crest_private.provider_login_targets WHERE attempt_id=$1',[f.b.attemptId])).rows[0].event_hash);assert.equal(r.stop.evidenceHash,f.stop.evidenceHash);assert.deepEqual(r.outcome,{outcome:'provider_removed',evidenceHash:outcome.evidenceHash});assert.equal((await client.query('SELECT state FROM crest_private.provider_cleanup_requests WHERE request_id=$1',[f.request.evidence.requestId])).rows[0].state,'pending_review');assert.deepEqual(await sources(),before);
});
test('observed absence stays distinct from recorded removal',async()=>{
 const f=await selected();await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);await consume(f);assert.equal((await review(f)).outcome.outcome,'provider_absent_observed');
});
test('a later provider row reappearance does not turn a recorded outcome into current absence or another action',async()=>{
 const f=await selected();await consume(f);const before=await review(f);await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[f.p,other.subject]);const after=await review(f);assert.equal(after.reviewState,'cleanup_outcome_recorded');assert.deepEqual(after.outcome,before.outcome);assert.equal((await client.query('SELECT user_id FROM auth.sessions WHERE id=$1',[f.p])).rows[0].user_id,other.subject);assert(!Object.hasOwn(after,'providerIsAbsent'));
});
test('disabled actors and old epochs retain original historical review without restoring eligibility',async()=>{
 const a=await actor();await member(a);const f=await selected(a);await consume(f);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);const r=await review(f);assert.equal(r.attempt.securityEpoch,f.b.securityEpoch);assert.equal(r.reviewState,'cleanup_outcome_recorded');
});
test('actor and exact configured issuer scope all returned sources',async()=>{
 const f=await fixture(other);await capture(f);assert(!(await page()).some(r=>r.attempt_id===f.b.attemptId));assert.equal((await review(f)).attempt.actorId,other.id);assert.deepEqual(await page(owner,{url:'https://other.example.com/auth/v1'}),[]);assert.deepEqual(await page({id:randomUUID()}),[]);
});
test('bounded UUID pages are ordered, exclusive and contain no cross-actor entries',async()=>{
 const a=await actor();await member(a);const ids=[];for(let i=0;i<5;i++)ids.push((await fixture(a)).b.attemptId);ids.sort();const seen=[];let cursor=null;for(let i=0;i<4;i++){const rows=await page(a,{cursor,size:2});assert(rows.length<=2);for(const r of rows){assert.equal(r.observation.attempt.actorId,a.id);seen.push(r.attempt_id);}if(!rows.length)break;cursor=rows.at(-1).attempt_id;}assert.deepEqual(seen,ids);assert.deepEqual(await page(a,{cursor,size:2}),[]);
});
test('read-only review uses UTC observation time and exports references without secrets or durable snapshot claims',async()=>{
 const f=await selected(),beforeZone=(await maintenance.query('SHOW timezone')).rows[0];await maintenance.query("BEGIN READ ONLY; SET LOCAL timezone='Pacific/Honolulu'");let r;try{r=await review(f);assert.match(r.observedAt,/\+00:00$/);}finally{await maintenance.query('ROLLBACK');}
 assert.deepEqual(Object.keys(r).sort(),['attempt','observedAt','outcome','registration','registrationFinish','request','reviewState','schemaVersion','stop','target'].sort());assert.equal(r.schemaVersion,1);assert(!/token|cipher|credential|password|secret|databasePrincipal|email|csrf/.test(JSON.stringify(r)));assert.deepEqual((await maintenance.query('SHOW timezone')).rows[0],beforeZone);
});
test('invalid inputs, bounds and non-fresh transaction isolation deny without mutation',async()=>{
 const before=await sources();for(const args of [[null,issuer,null,1],[owner.id,null,null,1],[owner.id,'',null,1],[owner.id,'x'.repeat(501),null,1],[owner.id,issuer,null,null],[owner.id,issuer,null,0],[owner.id,issuer,null,101]])await assert.rejects(maintenance.query('SELECT * FROM crest_commands.provider_reconciliation_review($1,$2,$3,$4)',args),e=>e.code==='22023');await maintenance.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(page(),e=>e.code==='25001');}finally{await maintenance.query('ROLLBACK');}assert.deepEqual(await sources(),before);
});
test('fixed definer grants no raw source/provider access or execution to web worker recovery or cleanup callers',async()=>{
 const meta=(await client.query('SELECT prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert.deepEqual({...meta,proconfig:meta.proconfig.map(x=>x.toLowerCase())},{prosecdef:true,provolatile:'s',proconfig:['search_path=pg_catalog, pg_temp','row_security=on','timezone=utc'],owner:'crest_inventory_owner'});
 for(const role of ['crest_web','crest_worker','crest_recovery','crest_cleanup','crest_cleanup_owner','crest_session_owner','anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[role,fn])).rows[0].ok,false);for(const table of ['crest_private.provider_login_attempts','crest_private.provider_cleanup_outcomes','auth.sessions'])await assert.rejects(maintenance.query(`SELECT * FROM ${table}`),e=>e.code==='42501');assert.deepEqual(await privileges(),grants);
});
test('uncommitted late target remains unconfirmed to another reader and rollback preserves that state',async()=>{
 const f=await fixture();f.stop=await finish(f);await second.query('BEGIN');try{await capture(f,second);assert.equal((await review(f)).reviewState,'target_unconfirmed_review');}finally{await second.query('ROLLBACK');}assert.equal((await review(f)).reviewState,'target_unconfirmed_review');
});
test('uncommitted cleanup never appears completed; commit exposes the single original outcome',async()=>{
 const f=await selected();await cleanup.query('BEGIN');let saved;try{saved=await consume(f);assert.equal((await review(f)).reviewState,'cleanup_outcome_unconfirmed_review');await cleanup.query('COMMIT');}catch(error){await cleanup.query('ROLLBACK');throw error;}assert.deepEqual((await review(f)).outcome,{outcome:'provider_removed',evidenceHash:saved.evidenceHash});
});
test('conflicting original registration ancestry suppresses derived details instead of claiming completion',async()=>{
 const f=await fixture();await capture(f);await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);await client.query('SELECT crest_commands.issue_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12)',[f.b.appSessionId,randomBytes(32),owner.id,f.b.securityEpoch,issuer,owner.subject,f.p,f.passwordAt,new Date(),randomBytes(32),'synthetic',randomUUID()]);const r=await review(f);assert.equal(r.reviewState,'binding_conflict_review');assert.equal(r.registration.providerSessionId,null);assert.equal(r.target,null);assert.equal(r.outcome,null);
});
test('inconsistent restored outcome source hash is review-only and hides linked derived facts',async()=>{
 const f=await selected();await consume(f);const before=await sources();await client.query('BEGIN');try{
  await client.query('ALTER TABLE crest_private.provider_cleanup_outcomes DISABLE TRIGGER USER');await client.query("UPDATE crest_private.provider_cleanup_outcomes SET canonical_evidence=jsonb_set(canonical_evidence::jsonb,'{requestHash}',to_jsonb(repeat('0',64)))::text,event_hash=encode(sha256(convert_to(jsonb_set(canonical_evidence::jsonb,'{requestHash}',to_jsonb(repeat('0',64)))::text,'UTF8')),'hex') WHERE request_id=$1",[f.request.evidence.requestId]);await client.query('SET LOCAL ROLE crest_inventory');const r=await review(f,client);assert.equal(r.reviewState,'binding_conflict_review');assert.equal(r.request,null);assert.equal(r.target,null);assert.equal(r.outcome,null);
 }finally{await client.query('ROLLBACK');}assert.deepEqual(await sources(),before);
});
test('changed prerequisite function refuses migration25 and retains pending-review state',async()=>{
 const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(24));await c.query('ALTER FUNCTION crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer) RESET row_security');await assert.rejects(sandbox.apply(t),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,24);assert.equal((await c.query('SELECT to_regprocedure($1) AS routine',[fn])).rows[0].routine,null);await assert.rejects(sandbox.apply(t),/MIGRATION_PENDING_REVIEW_REQUIRED/);
});
test('schema23 upgrade through24 and25 preserves the earlier migration prefix',async()=>{
 const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const old=await sandbox.apply(t,await sandbox.prefix(23)),updated=await sandbox.apply(t,await sandbox.prefix(25));assert.equal(updated.history.length,25);assert.deepEqual(updated.history.slice(0,23),old.history);
});
test('headerless legacy provider/app sessions are never adopted or removed by an empty attempt review',async()=>{
 const a=await actor();await member(a);const provider=randomUUID(),app=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal2')",[provider,a.subject]);await client.query('SELECT crest_commands.issue_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12)',[app,randomBytes(32),a.id,a.epoch,issuer,a.subject,provider,new Date(),new Date(),randomBytes(32),'synthetic',randomUUID()]);assert.deepEqual(await page(a),[]);assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[provider])).rows[0].n,1);assert.equal((await client.query('SELECT revoked_at FROM crest_private.app_sessions WHERE id=$1',[app])).rows[0].revoked_at,null);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest_private.provider_login_attempts WHERE actor_id=$1',[a.id])).rows[0].n,0);
});

async function provisionRuntime(role){
 const name=`crest_probe_${randomBytes(8).toString('hex')}`,password=randomBytes(32).toString('hex');assert.match(name,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);
 await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);runtimeRoles.push(name);await sandbox.admin.query(`GRANT ${role} TO ${name} WITH INHERIT FALSE`);
 const url=new URL(target);url.username=name;url.password=password;return {name,config:{connectionString:url.toString(),environment:'test',actorId:owner.id,issuer}};
}
const runtimeReview=(a=owner,config=runtimeInventory.config)=>createProviderReconciliationReviewer({...config,actorId:a.id});
const only=async(f,config=runtimeInventory.config)=>(await runtimeReview(f.a,config)(null,100,freshSignal())).find(r=>r.attempt.attemptId===f.b.attemptId);

test('runtime inventory adapter returns immutable original references without changing any retained source',async()=>{
 // Provision only after all closed-role migration/preflight cases have finished.
 runtimeInventory=await provisionRuntime('crest_inventory');runtimeCleanup=await provisionRuntime('crest_cleanup');
 const a=await actor();await member(a);const f=await selected(a),before=await sources(),r=await only(f);
 assert.equal(r.reviewState,'cleanup_outcome_unconfirmed_review');assert.equal(r.attempt.attemptId,f.b.attemptId);assert.equal(r.request.requestId,f.request.evidence.requestId);assert.equal(r.stop.evidenceHash,f.stop.evidenceHash);assert(Object.isFrozen(r));assert(Object.isFrozen(r.attempt));assert(Object.isFrozen(r.request));assert.deepEqual(await sources(),before);
});
test('runtime keyset pages are bounded and scoped with an explicitly supplied original cursor',async()=>{
 const a=await actor();await member(a);const ids=[];for(let i=0;i<5;i++)ids.push((await fixture(a)).b.attemptId);ids.sort();const read=runtimeReview(a),seen=[];let cursor=null;
 for(let i=0;i<4;i++){const rows=await read(cursor?.toUpperCase()??null,2,freshSignal());assert(rows.length<=2);seen.push(...rows.map(r=>r.attempt.attemptId));if(!rows.length)break;cursor=rows.at(-1).attempt.attemptId;}
 assert.deepEqual(seen,ids);assert.deepEqual(await read(cursor,2,freshSignal()),[]);assert.deepEqual(await runtimeReview({id:randomUUID()})(null,100,freshSignal()),[]);assert.deepEqual(await runtimeReview(a,{...runtimeInventory.config,issuer:'https://other.example.com/auth/v1'})(null,100,freshSignal()),[]);
});
test('runtime reader refuses administrator combined-capability and cleanup-only profiles before exposing evidence',async()=>{
 const f=await fixture();await capture(f);const before=await sources();
 await assert.rejects(only(f,{...runtimeInventory.config,connectionString:target}),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);await assert.rejects(only(f,runtimeCleanup.config),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);
 await sandbox.admin.query(`GRANT crest_cleanup TO ${runtimeInventory.name} WITH INHERIT FALSE`);try{await assert.rejects(only(f),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);}finally{await sandbox.admin.query(`REVOKE crest_cleanup FROM ${runtimeInventory.name}`);}
 assert.deepEqual(await sources(),before);
});
test('runtime review is historical across an uncommitted target rollback and outcome commit barrier',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);f.stop=await finish(f);await second.query('BEGIN');try{await capture(f,second);assert.equal((await only(f)).reviewState,'target_unconfirmed_review');}finally{await second.query('ROLLBACK');}
 assert.equal((await only(f)).reviewState,'target_unconfirmed_review');await capture(f);f.request=await request(f);await cleanup.query('BEGIN');let saved;try{saved=await consume(f);assert.equal((await only(f)).reviewState,'cleanup_outcome_unconfirmed_review');await cleanup.query('COMMIT');}catch(error){await cleanup.query('ROLLBACK');throw error;}
 assert.deepEqual((await only(f)).outcome,{outcome:'provider_removed',evidenceHash:saved.evidenceHash});
});
test('runtime observation grants no execution authority and cancellation starts no work',async()=>{
 const f=await selected(),before=await sources(),cancel=new AbortController();cancel.abort();await assert.rejects(runtimeReview()(null,1,cancel.signal),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);
 await assert.rejects(createProviderCleanupExecutor(runtimeInventory.config)(f.request.evidence.requestId,freshSignal()),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);
 const c=new pg.Client({connectionString:runtimeInventory.config.connectionString,options:'-c role=crest_inventory'});await c.connect();try{await assert.rejects(c.query('SELECT * FROM auth.sessions'),e=>e.code==='42501');await assert.rejects(c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3)',[f.request.evidence.requestId,owner.id,issuer]),e=>e.code==='42501');}finally{await c.end();}assert.deepEqual(await sources(),before);
});
test('runtime review preserves removed versus observed-absent history after provider reappearance',async()=>{
 const a=await actor();await member(a);const f=await selected(a),g=await selected(a);await client.query('DELETE FROM auth.sessions WHERE id=$1',[g.p]);await consume(f);await consume(g);await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[f.p,a.subject]);
 const before=await sources();assert.equal((await only(f)).outcome.outcome,'provider_removed');assert.equal((await only(g)).outcome.outcome,'provider_absent_observed');assert.deepEqual(await sources(),before);
});
test('runtime review retains old-epoch disabled-actor evidence without granting current access',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);await capture(f);await issue(f);await finish(f,'registration_closed');f.stop=await finish(f);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);
 const r=await only(f);assert.equal(r.reviewState,'stopped_without_request_review');assert.equal(r.attempt.securityEpoch,f.b.securityEpoch);assert(r.registrationFinish);assert(r.stop);assert(r.registration.localRevokedAt);
});
test('actual completed read closes its transport without waiting for a withheld peer shutdown',async()=>{
 const a=await actor();await member(a);const f=await fixture(a),before=await sources(),url=new URL(runtimeInventory.config.connectionString),upstreamPort=Number(url.port),sockets=new Set();let endedResolve;
 const ended=new Promise(resolve=>{endedResolve=resolve;});
 // Keep the proxy's read side open after frontend FIN and withhold Terminate.
 // The old graceful end awaited this peer forever after clearing its deadline.
 const proxy=net.createServer({allowHalfOpen:true},down=>{
  const up=net.createConnection({host:'127.0.0.1',port:upstreamPort});sockets.add(down);sockets.add(up);down.on('error',()=>{});up.on('error',()=>down.destroy());
  down.on('data',data=>{if(data.length===5&&data[0]===88&&data.readUInt32BE(1)===4)return;up.write(data);});up.on('data',data=>down.write(data));down.on('end',()=>endedResolve());
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));let deadline;
 try{url.port=String(proxy.address().port);const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('BOUNDED_TRANSPORT_CLOSE_REQUIRED')),2000);});
  const r=await Promise.race([only(f,{...runtimeInventory.config,connectionString:url.toString()}),timeout]);assert.equal(r.reviewState,'target_unconfirmed_review');await Promise.race([ended,timeout]);assert.deepEqual(await sources(),before);
 }finally{clearTimeout(deadline);for(const socket of sockets)socket.destroy();const closed=once(proxy,'close');proxy.close();await closed;}
});

async function portableFragment(f){
 const params=[f.a.id,issuer,null,100];
 const start=(await maintenance.query('SELECT * FROM crest_commands.provider_login_attempt_inventory($1,$2,$3,$4)',params)).rows.find(r=>r.attempt_id===f.b.attemptId);
 const targetRow=(await maintenance.query('SELECT * FROM crest_commands.provider_login_target_inventory($1,$2,$3,$4)',params)).rows.find(r=>r.attempt_id===f.b.attemptId);
 const finishes=(await maintenance.query('SELECT * FROM crest_commands.provider_login_finish_inventory($1,$2,$3,$4)',params)).rows.filter(r=>r.evidence.attemptId===f.b.attemptId);
 const rows=[];const add=(kind,row)=>{if(row)rows.push({kind,canonicalEvidence:row.canonical_evidence??row.canonicalEvidence,evidenceHash:row.evidence_hash??row.evidenceHash});};
 add('start',start);add('target',targetRow);for(const r of finishes)add(r.evidence.phase==='registration_closed'?'registration_finish':'stop',r);
 if(f.request){add('request',(await maintenance.query('SELECT crest_commands.read_provider_cleanup_request($1,$2,$3) AS result',[f.request.evidence.requestId,f.a.id,issuer])).rows[0].result);add('outcome',(await maintenance.query('SELECT crest_commands.read_provider_cleanup_outcome($1,$2,$3) AS result',[f.request.evidence.requestId,f.a.id,issuer])).rows[0].result);}
 const expected={actorId:f.a.id,issuer,attemptId:f.b.attemptId},header={format:'crest-provider-attempt-evidence',formatVersion:1,actorId:f.a.id,providerIssuer:issuer,attemptId:f.b.attemptId};
 return {serialized:[header,...rows].map(r=>JSON.stringify(r)).join('\n')+'\n',expected,rows};
}
test('portable verifier preserves actual restricted-reader original bytes for all six retained record kinds',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);await capture(f);await issue(f);await finish(f,'registration_closed');f.stop=await finish(f);f.request=await request(f);await consume(f);
 const before=await sources(),file=await portableFragment(f),report=verifyProviderAttemptEvidence(file.serialized,file.expected);assert.equal(report.assurance,'internal_consistency_only');assert.deepEqual(report.missingKinds,[]);assert.equal(report.records.length,6);
 for(const row of file.rows){const copied=report.records.find(r=>r.kind===row.kind);assert(Buffer.from(copied.canonicalEvidence,'utf8').equals(Buffer.from(row.canonicalEvidence,'utf8')));assert.equal(copied.evidenceHash,row.evidenceHash);}assert.deepEqual(await sources(),before);
});
test('portable fragments distinguish missing original target and later absence outcome without rewriting the stopped bytes',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);f.stop=await finish(f);const unknown=await portableFragment(f);assert.deepEqual(verifyProviderAttemptEvidence(unknown.serialized,unknown.expected).missingKinds,['target','registration_finish','request','outcome']);
 await capture(f);f.request=await request(f);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);await consume(f);const file=await portableFragment(f),report=verifyProviderAttemptEvidence(file.serialized,file.expected);
 assert.deepEqual(report.missingKinds,['registration_finish']);assert.equal(JSON.parse(report.records.find(r=>r.kind==='outcome').canonicalEvidence).outcome,'provider_absent_observed');assert.equal(report.records.find(r=>r.kind==='stop').canonicalEvidence,unknown.rows.find(r=>r.kind==='stop').canonicalEvidence);assert(verifyProviderAttemptEvidence(unknown.serialized,unknown.expected).missingKinds.includes('outcome'));
});
test('uncommitted and rolled-back originals stay missing in portable fragments; later commit never changes old file claims',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);f.stop=await finish(f);await second.query('BEGIN');try{await capture(f,second);const file=await portableFragment(f);assert(verifyProviderAttemptEvidence(file.serialized,file.expected).missingKinds.includes('target'));}finally{await second.query('ROLLBACK');}
 await capture(f);f.request=await request(f);await cleanup.query('BEGIN');let pending;try{await consume(f);pending=await portableFragment(f);assert(verifyProviderAttemptEvidence(pending.serialized,pending.expected).missingKinds.includes('outcome'));await cleanup.query('COMMIT');}catch(error){await cleanup.query('ROLLBACK');throw error;}
 const saved=await portableFragment(f);assert(!verifyProviderAttemptEvidence(saved.serialized,saved.expected).missingKinds.includes('outcome'));assert(verifyProviderAttemptEvidence(pending.serialized,pending.expected).missingKinds.includes('outcome'));
});
test('a separate credential-free Node process verifies historical bytes and rejects tampering without PostgreSQL or React',async()=>{
 const a=await actor();await member(a);const f=await selected(a);await consume(f);const file=await portableFragment(f);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);const before=await sources();
 const script=`import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';const {verifyProviderAttemptEvidence}=await import(pathToFileURL(process.argv[1]).href);const data=JSON.parse(readFileSync(0,'utf8'));try{process.stdout.write(JSON.stringify(verifyProviderAttemptEvidence(data.serialized,data.expected)));}catch(error){process.stdout.write(JSON.stringify({error:error.message}));}`;
 const offline=data=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script,resolve('src/security/provider-attempt-evidence.ts')],{input:JSON.stringify(data),encoding:'utf8',timeout:5000,maxBuffer:262144,env:{NODE_NO_WARNINGS:'1',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}}));
 const report=offline(file);assert.equal(report.assurance,'internal_consistency_only');assert.equal(JSON.parse(report.records[0].canonicalEvidence).securityEpoch,f.b.securityEpoch);assert.deepEqual(report.records,verifyProviderAttemptEvidence(file.serialized,file.expected).records);
 const lines=file.serialized.trimEnd().split('\n'),row=JSON.parse(lines[1]);row.canonicalEvidence+=' ';lines[1]=JSON.stringify(row);assert.deepEqual(offline({...file,serialized:lines.join('\n')}),{error:'PROVIDER_ATTEMPT_EVIDENCE_REVIEW_REQUIRED'});assert.deepEqual(await sources(),before);
});

test('portable verifier preserves actual PostgreSQL target ranges one microsecond apart',async()=>{
 const a=await actor();await member(a);const f=await fixture(a);await web.query("SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,date_trunc('second',statement_timestamp()),date_trunc('second',statement_timestamp())+interval '1 microsecond')",f.args.slice(0,6));
 const file=await portableFragment(f),report=verifyProviderAttemptEvidence(file.serialized,file.expected),targetRecord=report.records.find(r=>r.kind==='target'),e=JSON.parse(targetRecord.canonicalEvidence);assert.equal(Date.parse(e.passwordAt),Date.parse(e.accessExpiresAt));assert.equal(targetRecord.canonicalEvidence,file.rows.find(r=>r.kind==='target').canonicalEvidence);assert.deepEqual(report.missingKinds,['registration_finish','stop','request','outcome']);
});
