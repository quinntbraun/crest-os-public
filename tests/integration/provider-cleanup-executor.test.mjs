import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import net from 'node:net';
import {once} from 'node:events';
import {createProviderCleanupExecutor,createProviderCleanupOutcomeReader,dispatchProviderCleanup} from '../../src/security/provider-cleanup-maintenance.ts';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

const runtimeRoles=[];let runtimeCleanup,runtimeHistory,executeAdapter,readAdapter;
const freshSignal=()=>new AbortController().signal;
const issuer='https://auth.example.com/auth/v1',table='crest_private.provider_cleanup_outcomes';
const executeFn='crest_commands.execute_provider_cleanup(uuid,uuid,text)';
let sandbox,target,client,web,second,maintenance,bootstrap,owner,other,business,prior,receipt,retained,localRetained,cleanup,cleanupSecond;
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic target owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,subject,bootstrap])).rows[0];return {id:a.id,subject,epoch:a.current_security_epoch};}
async function member(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
const begin=(a=owner)=>web.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[randomUUID(),randomUUID(),issuer,a.subject]).then(r=>r.rows[0].result);
async function fixture(a=owner){const b=await begin(a),p=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[p,a.subject]);const passwordAt=new Date(Math.floor(Date.now()/1000)*1000),expiresAt=new Date(Date.now()+60000);return {a,b,p,passwordAt,expiresAt,args:[b.attemptId,a.id,b.securityEpoch,issuer,a.subject,p,passwordAt,expiresAt]};}
const capture=(f,c=web)=>c.query('SELECT crest_commands.record_provider_login_target($1,$2,$3,$4,$5,$6,$7,$8) AS result',f.args).then(r=>r.rows[0].result);
async function issue(f,{legacy=false,mutate=()=>{},c=web}={}){await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);const hash=randomBytes(32),args=[f.b.appSessionId,hash,f.a.id,f.b.securityEpoch,issuer,f.a.subject,f.p,f.passwordAt,new Date(),false,randomBytes(32),'synthetic',f.b.attemptId];mutate(args);await c.query(`SELECT crest_commands.${legacy?'issue_tracked_app_session':'issue_open_app_session'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,args);return {hash,id:args[0]};}
async function sources(){return (await client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY attempt_id) FROM crest_private.provider_login_attempts s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY attempt_id) FROM crest_private.provider_login_targets s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.provider_cleanup_references s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.provider_login_finishes s))::text,'UTF8')),'hex') AS hash")).rows[0].hash;}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(23));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic target business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await member(owner);await member(other);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
  web=await sandbox.connect(target);second=await sandbox.connect(target);maintenance=await sandbox.connect(target);for(const c of [web,second])await c.query('SET ROLE crest_web');await maintenance.query('SET ROLE crest_inventory');
  const f=await fixture();await capture(f);await issue(f);f.stop=await finish(f);await request(f);retained=await sources();localRetained=await localSources();receipt=await sandbox.apply(target);cleanup=await sandbox.connect(target);cleanupSecond=await sandbox.connect(target);for(const c of [cleanup,cleanupSecond])await c.query('SET ROLE crest_cleanup');

});
after(async()=>{for(const name of runtimeRoles)await sandbox.admin.query(`DROP ROLE ${name}`);await sandbox?.close();});

const finish=(f,phase='stopped_review',c=web)=>c.query('SELECT crest_commands.finish_provider_login($1,$2,$3,$4,$5,$6) AS result',[f.b.attemptId,f.a.id,f.b.securityEpoch,issuer,f.a.subject,phase]).then(r=>r.rows[0].result);
const local=f=>client.query('SELECT * FROM crest_private.app_sessions WHERE id=$1',[f.b.appSessionId]).then(r=>r.rows[0]);

const request=(f,id=randomUUID(),c=maintenance,actor=f.a,expectedIssuer=issuer)=>c.query('SELECT crest_commands.request_provider_cleanup($1,$2,$3,$4) AS result',[id,f.stop.evidence.finishId,actor.id,expectedIssuer]).then(r=>r.rows[0].result);
const read=(id,a=owner,expectedIssuer=issuer,c=maintenance)=>c.query('SELECT crest_commands.read_provider_cleanup_outcome($1,$2,$3) AS result',[id,a.id,expectedIssuer]).then(r=>r.rows[0].result);
async function stopped(a=owner,{registered=false,late=false}={}){const f=await fixture(a);if(!late)await capture(f);if(registered)f.app=await issue(f);f.stop=await finish(f);if(late)await capture(f);return f;}
const count=()=>client.query(`SELECT count(*)::int AS n FROM ${table}`).then(r=>r.rows[0].n);

const consume=(f,c=cleanup,a=f.a,url=issuer)=>c.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3) AS result',[f.request.evidence.requestId,a.id,url]).then(r=>r.rows[0].result);
async function selected(a=owner,options={}){const f=await stopped(a,options);f.request=await request(f);return f;}
const present=f=>client.query('SELECT count(*)::int AS n FROM auth.sessions WHERE id=$1',[f.p]).then(r=>r.rows[0].n);
const localSources=()=>client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY request_id) FROM crest_private.provider_cleanup_requests s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.provider_login_finishes s))::text,'UTF8')),'hex') AS hash").then(r=>r.rows[0].hash);
async function children(f){await client.query('INSERT INTO auth.refresh_tokens(session_id,user_id,token,revoked,created_at,updated_at) VALUES($1,$2,$3,false,clock_timestamp(),clock_timestamp())',[f.p,f.a.subject,randomUUID()]);await client.query("INSERT INTO auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) VALUES($1,$2,clock_timestamp(),clock_timestamp(),'password')",[randomUUID(),f.p]);}
const childCount=f=>client.query('SELECT (SELECT count(*) FROM auth.refresh_tokens WHERE session_id=$1)::int AS refresh,(SELECT count(*) FROM auth.mfa_amr_claims WHERE session_id=$1)::int AS amr',[f.p]).then(r=>r.rows[0]);

test('schema23 upgrade preserves source requests and provider state without inventing outcomes',async()=>{
 assert.equal(prior.history.length,23);assert.equal(receipt.history.length,24);assert.deepEqual(receipt.history.slice(0,23),prior.history);assert.deepEqual((await sandbox.apply(target)).history,receipt.history);assert.equal(await sources(),retained);assert.equal(await localSources(),localRetained);assert.equal(await count(),0);
});
test('one exact stopped target is removed with original source hash and portable server-derived evidence',async()=>{
 const f=await selected(),before=await localSources(),r=await consume(f),e=r.evidence;assert.equal(await present(f),0);assert.equal(await localSources(),before);assert.equal(e.outcome,'provider_removed');assert.equal(e.requestId,f.request.evidence.requestId);assert.equal(e.requestHash,f.request.evidenceHash);assert.equal(e.providerSessionId,f.p);assert.equal(e.providerSubject,f.a.subject);assert.equal(e.securityEpoch,f.b.securityEpoch);assert.equal(e.databasePrincipal,'supabase_admin');assert.match(e.createdAt,/\+00:00$/);assert.deepEqual(JSON.parse(r.canonicalEvidence),e);assert.equal(createHash('sha256').update(r.canonicalEvidence,'utf8').digest('hex'),r.evidenceHash);for(const k of Object.keys(e))assert(!/token|cipher|secret|password|credential|email|csrf|key_id/i.test(k));
});
test('pinned cascades remove only this target refresh and AMR rows while another device and user remain',async()=>{
 const f=await selected(),g=await fixture(),h=await fixture(other);for(const item of [f,g,h])await children(item);await consume(f);assert.deepEqual(await childCount(f),{refresh:0,amr:0});for(const item of [g,h]){assert.equal(await present(item),1);assert.deepEqual(await childCount(item),{refresh:1,amr:1});}assert.equal((await client.query('SELECT count(*)::int AS n FROM auth.users WHERE id=ANY($1::uuid[])',[[owner.subject,other.subject]])).rows[0].n,2);
});
test('already absent provider has a distinct historical observation without claiming a global cleanup',async()=>{
 const f=await selected();await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);const before=await localSources(),r=await consume(f);assert.equal(r.evidence.outcome,'provider_absent_observed');assert.equal(await localSources(),before);assert(!('allExternalWorkEnded' in r.evidence));
});
test('registered stop preserves local revocation/audit/reference and another registered app device',async()=>{
 const f=await selected(owner,{registered:true}),g=await fixture();await capture(g);await issue(g);const before=await localSources();await consume(f);assert.equal(await localSources(),before);assert((await local(f)).revoked_at);assert.equal((await local(g)).revoked_at,null);assert.equal(await present(g),1);assert(f.request.evidence.cleanupReferenceId);
});
test('late exact target after a stop remains eligible only through its immutable selected request',async()=>{
 const f=await selected(owner,{late:true});assert.equal(f.stop.evidence.providerSessionId,null);await consume(f);assert.equal(await present(f),0);assert.deepEqual(await finish(f),f.stop);
});
test('disabled original actor, stale epoch and expired provider time remain reduction-only',async()=>{
 const a=await actor();await member(a);const f=await selected(a,{registered:true});await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,disabled_at=clock_timestamp(),version=version+1 WHERE id=$2',[randomUUID(),a.id]);await client.query("UPDATE auth.sessions SET not_after=clock_timestamp()-interval '1 minute' WHERE id=$1",[f.p]);const r=await consume(f);assert.equal(r.evidence.securityEpoch,f.b.securityEpoch);assert.equal(await present(f),0);assert((await local(f)).revoked_at);
});
test('arbitrary provider/start/finish IDs cannot substitute for a cleanup request',async()=>{
 const f=await selected(),before=await sources();for(const id of [f.p,f.b.attemptId,f.stop.evidence.finishId,randomUUID()])await assert.rejects(cleanup.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3)',[id,owner.id,issuer]),e=>e.code==='42501');assert.equal(await sources(),before);
});
test('wrong expected actor or issuer cannot remove another request target or read its original result',async()=>{
 const f=await selected(),before=await sources();await assert.rejects(consume(f,cleanup,other),e=>e.code==='42501');await assert.rejects(consume(f,cleanup,owner,'https://other.example.com/auth/v1'),e=>e.code==='42501');assert.equal(await sources(),before);await consume(f);await assert.rejects(consume(f,cleanup,other),e=>e.code==='42501');assert.equal(await read(f.request.evidence.requestId,other),null);
});
test('provider session UUID now bound to another user is rejected without removing either device',async()=>{
 const f=await selected();await client.query('UPDATE auth.sessions SET user_id=$1 WHERE id=$2',[other.subject,f.p]);const before=await sources();await assert.rejects(consume(f),e=>e.code==='42501');assert.equal(await sources(),before);assert.equal(await read(f.request.evidence.requestId),null);
});
test('privileged later app adoption under another app is rechecked before provider deletion',async()=>{
 const f=await selected();await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);await client.query('SELECT crest_commands.issue_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12)',[randomUUID(),randomBytes(32),owner.id,owner.epoch,issuer,owner.subject,f.p,f.passwordAt,new Date(),randomBytes(32),'synthetic',randomUUID()]);const before=await sources();await assert.rejects(consume(f),e=>e.code==='23514');assert.equal(await sources(),before);
});
test('a revoked but conflicting CREATED operation cannot replace original request ancestry',async()=>{
 const f=await selected();await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[f.p]);const hash=randomBytes(32);await client.query('SELECT crest_commands.issue_app_session($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12)',[f.b.appSessionId,hash,owner.id,owner.epoch,issuer,owner.subject,f.p,f.passwordAt,new Date(),randomBytes(32),'synthetic',randomUUID()]);await client.query('SELECT crest_commands.revoke_app_session($1,$2)',[hash,randomUUID()]);const before=await sources();await assert.rejects(consume(f),e=>e.code==='23514');assert.equal(await sources(),before);
});
test('rollback restores provider row and both child tables with no retained outcome or local mutation',async()=>{
 const f=await selected();await children(f);const before=await sources(),localBefore=await localSources();await cleanup.query('BEGIN');try{await consume(f);assert.equal(await read(f.request.evidence.requestId),null);}finally{await cleanup.query('ROLLBACK');}assert.equal(await sources(),before);assert.equal(await localSources(),localBefore);assert.deepEqual(await childCount(f),{refresh:1,amr:1});assert.equal(await read(f.request.evidence.requestId),null);
});
test('outcome append failure rolls back provider deletion and cascades atomically',async()=>{
 const f=await selected();await children(f);const before=await sources();await client.query("CREATE FUNCTION crest_private.outcome_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_OUTCOME_FAILURE'; END $$");await client.query(`CREATE TRIGGER zz_outcome_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION crest_private.outcome_failure_probe()`);try{await assert.rejects(consume(f),e=>e.code==='23514');}finally{await client.query(`DROP TRIGGER zz_outcome_failure ON ${table}`);await client.query('DROP FUNCTION crest_private.outcome_failure_probe()');}assert.equal(await sources(),before);assert.deepEqual(await childCount(f),{refresh:1,amr:1});assert.equal(await read(f.request.evidence.requestId),null);await consume(f);
});
test('overlapping execution is immediately busy, invisible until commit, then exact historical replay',async()=>{
 const f=await selected();await cleanup.query('BEGIN');let r;try{r=await consume(f);await assert.rejects(consume(f,cleanupSecond),e=>e.code==='55P03');assert.equal(await read(f.request.evidence.requestId),null);await cleanup.query('COMMIT');}finally{await cleanup.query('ROLLBACK');}assert.deepEqual(await consume(f,cleanupSecond),r);assert.deepEqual(await read(f.request.evidence.requestId),r);
});
test('a rolled-back executor releases its claim for a later explicit attempt',async()=>{
 const f=await selected();await cleanup.query('BEGIN');try{await consume(f);}finally{await cleanup.query('ROLLBACK');}assert.equal(await present(f),1);assert.equal(await read(f.request.evidence.requestId),null);assert.equal((await consume(f,cleanupSecond)).evidence.outcome,'provider_removed');
});
test('the shared producer lifecycle lock denies overlapping execution without touching provider rows',async()=>{
 const f=await selected();await client.query('BEGIN');try{await client.query("SELECT pg_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||$1::text,0))",[f.b.attemptId]);await assert.rejects(consume(f),e=>e.code==='55P03');}finally{await client.query('ROLLBACK');}assert.equal(await present(f),1);assert.equal(await read(f.request.evidence.requestId),null);await consume(f);
});
test('an actual provider refresh-row update lock bounds deletion and leaves no partial outcome',async()=>{
 const f=await selected(),c=await sandbox.connect(target);await c.query('BEGIN');try{await c.query('UPDATE auth.sessions SET refresh_token_counter=coalesce(refresh_token_counter,0)+1 WHERE id=$1',[f.p]);await assert.rejects(consume(f),e=>e.code==='55P03');assert.equal(await read(f.request.evidence.requestId),null);}finally{await c.query('ROLLBACK');}assert.equal(await present(f),1);await consume(f);
});
test('concurrent provider sign-out is not called absent while its delete remains uncommitted',async()=>{
 const f=await selected(),c=await sandbox.connect(target);await c.query('BEGIN');try{await c.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);await assert.rejects(consume(f),e=>e.code==='55P03');assert.equal(await read(f.request.evidence.requestId),null);await c.query('COMMIT');}finally{await c.query('ROLLBACK');}assert.equal((await consume(f)).evidence.outcome,'provider_absent_observed');
});
test('historical replay never deletes a later reinserted provider row or reinterprets a changed schema',async()=>{
 const f=await selected(),r=await consume(f);await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[f.p,f.a.subject]);await client.query("CREATE FUNCTION auth.cleanup_drift_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$");await client.query('CREATE TRIGGER cleanup_drift BEFORE DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION auth.cleanup_drift_probe()');try{assert.deepEqual(await consume(f),r);assert.equal(await present(f),1);assert.deepEqual(await read(f.request.evidence.requestId),r);}finally{await client.query('DROP TRIGGER cleanup_drift ON auth.sessions');await client.query('DROP FUNCTION auth.cleanup_drift_probe()');}
});
test('direct privileged append derives actual deletion result, identity and provenance despite forged fields',async()=>{
 const f=await selected();await client.query(`INSERT INTO ${table}(request_id,actor_id,provider_issuer,provider_subject,provider_session_id,outcome,schema_version,origin,created_at,database_principal,canonical_evidence,event_hash) VALUES($1,$2,$3,$4,$4,'forged',999,'manual','-infinity','forged','{"secret":"forged"}','forged')`,[f.request.evidence.requestId,owner.id,issuer,randomUUID()]);const r=await read(f.request.evidence.requestId);assert.equal(r.evidence.providerSessionId,f.p);assert.equal(r.evidence.outcome,'provider_removed');assert.equal(r.evidence.schemaVersion,1);assert.equal(r.evidence.origin,'system');assert(!r.canonicalEvidence.includes('forged'));assert.equal(await present(f),0);
});
test('outcomes reject ordinary privileged UPDATE DELETE TRUNCATE and remain separate from pending requests',async()=>{
 const f=await selected(),r=await consume(f),id=f.request.evidence.requestId;for(const sql of [`UPDATE ${table} SET provider_session_id=$1 WHERE request_id=$1`,`DELETE FROM ${table} WHERE request_id=$1`])await assert.rejects(client.query(sql,[id]),e=>e.code==='55000');await assert.rejects(client.query(`TRUNCATE ${table}`),e=>e.code==='55000');assert.deepEqual(await read(id),r);assert.equal((await request(f,id)).evidence.state,'pending_review');
});
test('historical read is exact actor/issuer, read-only and gives no fresh provider absence guarantee',async()=>{
 const f=await selected(),r=await consume(f),id=f.request.evidence.requestId;await maintenance.query('BEGIN READ ONLY');try{assert.deepEqual(await read(id),r);assert.equal(await read(id,other),null);assert.equal(await read(id,owner,'https://other.example.com/auth/v1'),null);assert.equal(await read(randomUUID()),null);}finally{await maintenance.query('ROLLBACK');}
});
test('typed input/isolation/read-only new execution denies, while exact read-only replay preserves evidence',async()=>{
 const f=await selected();for(const args of [[null,owner.id,issuer],[f.request.evidence.requestId,null,issuer],[f.request.evidence.requestId,owner.id,''],[f.request.evidence.requestId,owner.id,'x'.repeat(501)]])await assert.rejects(cleanup.query('SELECT crest_commands.execute_provider_cleanup($1,$2,$3)',args),e=>e.code==='22023');await cleanup.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(consume(f),e=>e.code==='25001');}finally{await cleanup.query('ROLLBACK');}await cleanup.query('BEGIN READ ONLY');try{await assert.rejects(consume(f),e=>e.code==='25006');}finally{await cleanup.query('ROLLBACK');}assert.equal(await present(f),1);const r=await consume(f);await cleanup.query('BEGIN READ ONLY');try{assert.deepEqual(await consume(f),r);}finally{await cleanup.query('ROLLBACK');}
});
test('isolated nonlogin/noninheriting owner has only two provider columns, DELETE and version read',async()=>{
 assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('crest_cleanup','crest_cleanup_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL")).rows[0].n,2);assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE roleid IN ('crest_cleanup'::regrole,'crest_cleanup_owner'::regrole) OR member IN ('crest_cleanup'::regrole,'crest_cleanup_owner'::regrole)")).rows[0].n,0);assert.deepEqual((await client.query("SELECT attname FROM pg_attribute WHERE attrelid='auth.sessions'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('crest_cleanup_owner',attrelid,attnum,'SELECT') ORDER BY attname")).rows.map(r=>r.attname),['id','user_id']);assert.equal((await client.query("SELECT has_table_privilege('crest_cleanup_owner','auth.sessions','DELETE') AS allowed")).rows[0].allowed,true);assert.equal((await client.query("SELECT has_any_column_privilege('crest_cleanup_owner','auth.sessions','INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_cleanup_owner','auth.sessions','TRUNCATE,TRIGGER,MAINTAIN') AS allowed")).rows[0].allowed,false);for(const source of ['auth.users','auth.refresh_tokens','auth.mfa_amr_claims'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_cleanup_owner',$1,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_cleanup_owner',$1,'DELETE,TRUNCATE,TRIGGER') AS allowed",[source])).rows[0].allowed,false);
 for(const source of ['auth.refresh_tokens','auth.mfa_amr_claims'])assert.equal((await client.query("SELECT has_table_privilege('crest_cleanup_owner',$1,'MAINTAIN') AS allowed",[source])).rows[0].allowed,true);
});
test('fixed definer and forced RLS deny raw data and execution to app inventory provider and recovery roles',async()=>{
 assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[table])).rows[0],{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});assert.deepEqual((await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[executeFn])).rows[0],{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner:'crest_cleanup_owner'});for(const c of [web,maintenance,cleanup])await assert.rejects(c.query(`SELECT * FROM ${table}`),e=>e.code==='42501');for(const role of ['crest_web','crest_inventory','crest_inventory_owner','crest_worker','crest_recovery','crest_session_owner','crest_auth_reader','anon','authenticated','service_role'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,executeFn])).rows[0].allowed,false);await assert.rejects(consume(await selected(),maintenance),e=>e.code==='42501');await assert.rejects(read(randomUUID(),owner,issuer,cleanup),e=>e.code==='42501');await assert.rejects(cleanup.query('DELETE FROM auth.sessions'),e=>e.code==='42501');
});
test('runtime schema changes to provider version, cascade dependencies or custom triggers require review before deletion',async()=>{
 const f=await selected();for(const kind of ['version','dependency','trigger']){if(kind==='version')await client.query("INSERT INTO auth.schema_migrations(version) VALUES('99999999999999')");if(kind==='dependency')await client.query('CREATE TABLE auth.cleanup_dependency_probe(session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE)');if(kind==='trigger'){await client.query("CREATE FUNCTION auth.cleanup_trigger_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$");await client.query('CREATE TRIGGER cleanup_probe BEFORE DELETE ON auth.mfa_amr_claims FOR EACH ROW EXECUTE FUNCTION auth.cleanup_trigger_probe()');}try{await assert.rejects(consume(f),e=>e.code==='55000');assert.equal(await present(f),1);assert.equal(await read(f.request.evidence.requestId),null);}finally{if(kind==='version')await client.query("DELETE FROM auth.schema_migrations WHERE version='99999999999999'");if(kind==='dependency')await client.query('DROP TABLE auth.cleanup_dependency_probe');if(kind==='trigger'){await client.query('DROP TRIGGER cleanup_probe ON auth.mfa_amr_claims');await client.query('DROP FUNCTION auth.cleanup_trigger_probe()');}}}await consume(f);
});
test('schema22 upgrade retains prefix and a changed cascade refuses migration with pending-review state',async()=>{
 const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const prior=await sandbox.apply(t,await sandbox.prefix(22)),after=await sandbox.apply(t);assert.equal(after.history.length,24);assert.deepEqual(after.history.slice(0,22),prior.history);
 const u=await sandbox.database(),d=await sandbox.connect(u);await sandbox.apply(u,await sandbox.prefix(0),true);await installProviderSchema(d,u);await sandbox.apply(u,await sandbox.prefix(23));await d.query('ALTER TABLE auth.refresh_tokens DROP CONSTRAINT refresh_tokens_session_id_fkey');await d.query('ALTER TABLE auth.refresh_tokens ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY(session_id) REFERENCES auth.sessions(id) ON DELETE RESTRICT');await assert.rejects(sandbox.apply(u),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await d.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,23);assert.equal((await d.query('SELECT to_regclass($1) AS table',[table])).rows[0].table,null);await assert.rejects(sandbox.apply(u),/MIGRATION_PENDING_REVIEW_REQUIRED/);
});

test('DELETE rechecks the provider subject after an actual row-lock wait and rejects changed ownership',async()=>{
 const f=await selected(),c=await sandbox.connect(target);const holder=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,waiter=(await cleanup.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await c.query('BEGIN');let pending;
 try{await c.query('UPDATE auth.sessions SET user_id=$1 WHERE id=$2',[other.subject,f.p]);pending=consume(f).then(value=>({value}),error=>({error}));let blocked=false;const deadline=Date.now()+1500;while(Date.now()<deadline&&!blocked)blocked=(await client.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked',[holder,waiter])).rows[0].blocked;assert(blocked,'actual provider-row wait must be observed before releasing the barrier');await c.query('COMMIT');assert.equal((await pending).error?.code,'40001');}finally{await c.query('ROLLBACK');if(pending)await pending.catch(()=>{});}assert.equal(await present(f),1);assert.equal((await client.query('SELECT user_id FROM auth.sessions WHERE id=$1',[f.p])).rows[0].user_id,other.subject);assert.equal(await read(f.request.evidence.requestId),null);
});

test('actual child-trigger and parent-FK DDL cannot cross the held inspection/deletion transaction',async()=>{
 const f=await selected(),c=await sandbox.connect(target);await c.query("SET lock_timeout='200ms'");await client.query("CREATE FUNCTION auth.cleanup_ddl_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$");await cleanup.query('BEGIN');try{await consume(f);for(const child of ['refresh_tokens','mfa_amr_claims'])await assert.rejects(c.query(`CREATE TRIGGER cleanup_ddl_probe BEFORE DELETE ON auth.${child} FOR EACH ROW EXECUTE FUNCTION auth.cleanup_ddl_probe()`),e=>e.code==='55P03');await assert.rejects(c.query('CREATE TABLE auth.cleanup_fk_probe(session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE)'),e=>e.code==='55P03');assert.equal(await read(f.request.evidence.requestId),null);}finally{await cleanup.query('ROLLBACK');await client.query('DROP FUNCTION auth.cleanup_ddl_probe()');}assert.equal(await present(f),1);await consume(f);
});

async function provisionSyntheticMaintenance(){
  async function runtime(role){const name=`crest_probe_${randomBytes(8).toString('hex')}`,password=randomBytes(32).toString('hex');assert.match(name,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);await sandbox.admin.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);runtimeRoles.push(name);await sandbox.admin.query(`GRANT ${role} TO ${name} WITH INHERIT FALSE`);const url=new URL(target);url.username=name;url.password=password;return {name,config:{connectionString:url.toString(),environment:'test',actorId:owner.id,issuer}};}
  runtimeCleanup=await runtime('crest_cleanup');runtimeHistory=await runtime('crest_inventory');executeAdapter=createProviderCleanupExecutor(runtimeCleanup.config);readAdapter=createProviderCleanupOutcomeReader(runtimeHistory.config);
}
test('restricted maintenance adapters execute and read exact persisted source bytes without source mutation',async()=>{
 await provisionSyntheticMaintenance();
 const f=await selected(owner,{registered:true}),before=await localSources(),id=f.request.evidence.requestId;
 const r=await executeAdapter(id.toUpperCase(),freshSignal());assert.equal(r.outcome,'provider_removed');assert.equal(r.canonicalEvidence,(await read(id)).canonicalEvidence);assert.deepEqual(await readAdapter(id,freshSignal()),r);assert.equal(JSON.parse(r.canonicalEvidence).databasePrincipal,runtimeCleanup.name);assert.equal(await present(f),0);assert.equal(await localSources(),before);
});
test('maintenance reader null is scoped historical absence, never execution or current eligibility',async()=>{
 const f=await selected(),id=f.request.evidence.requestId;assert.equal(await readAdapter(id,freshSignal()),null);assert.equal(await present(f),1);await executeAdapter(id,freshSignal());assert.equal(await createProviderCleanupOutcomeReader({...runtimeHistory.config,actorId:other.id})(id,freshSignal()),null);
});
test('maintenance refuses administrator and combined capability logins before provider action',async()=>{
 const f=await selected(),id=f.request.evidence.requestId;
 await assert.rejects(createProviderCleanupExecutor({...runtimeCleanup.config,connectionString:target})(id,freshSignal()),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);
 await sandbox.admin.query(`GRANT crest_inventory TO ${runtimeCleanup.name} WITH INHERIT FALSE`);
 try{await assert.rejects(executeAdapter(id,freshSignal()),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);}finally{await sandbox.admin.query(`REVOKE crest_inventory FROM ${runtimeCleanup.name}`);}
 assert.equal(await present(f),1);assert.equal(await readAdapter(id,freshSignal()),null);
});
test('inventory login cannot substitute for the executor and cancellation starts no database action',async()=>{
 const f=await selected(),id=f.request.evidence.requestId;
 await assert.rejects(createProviderCleanupExecutor(runtimeHistory.config)(id,freshSignal()),/PROVIDER_CLEANUP_REVIEW_REQUIRED/);
 const c=new AbortController();c.abort();assert.equal((await dispatchProviderCleanup([id],executeAdapter,c.signal)).telemetry.notStarted,1);assert.equal(await present(f),1);assert.equal(await readAdapter(id,freshSignal()),null);
});
test('bounded sequential dispatch confirms removed and observed-absent receipts without inventing new deletions on replay',async()=>{
 const f=await selected(),g=await selected();await client.query('DELETE FROM auth.sessions WHERE id=$1',[g.p]);const ids=[f.request.evidence.requestId,g.request.evidence.requestId];
 const r=await dispatchProviderCleanup(ids,executeAdapter,freshSignal());assert.deepEqual(r.telemetry,{selected:2,started:2,confirmed:2,removed:1,absentObserved:1,unknown:0,notStarted:0});
 await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[f.p,owner.subject]);assert.deepEqual((await dispatchProviderCleanup(ids,executeAdapter,freshSignal())).results,r.results);assert.equal(await present(f),1);
});
test('failed source binding stops dispatch and leaves later selected targets unstarted with original identities',async()=>{
 const f=await selected(other),g=await selected(),ids=[f.request.evidence.requestId,g.request.evidence.requestId];const r=await dispatchProviderCleanup(ids,executeAdapter,freshSignal());assert.deepEqual(r.results,ids.map((requestId,i)=>({requestId,status:i?'not_started':'outcome_unknown'})));assert.equal(await present(f),1);assert.equal(await present(g),1);assert.equal(await readAdapter(ids[1],freshSignal()),null);
});
test('transport drops the committed execution response: dispatch stops and independent exact history resolves it',async()=>{
 const f=await selected(),g=await selected(),id=f.request.evidence.requestId,url=new URL(runtimeCleanup.config.connectionString),sockets=new Set();let dropped=false;
 // Disposable loopback proxy only. Forward authentication/guard normally; withhold
 // command packets until the backend ReadyForQuery proves autocommit completed,
 // then sever transport before the adapter can confirm the receipt.
 const proxy=net.createServer(down=>{
   const up=net.createConnection({host:'127.0.0.1',port:Number(url.port)});sockets.add(down);sockets.add(up);let tail=Buffer.alloc(0),discard=false,pending=Buffer.alloc(0);
   const stop=()=>{down.destroy();up.destroy();};down.on('error',stop);up.on('error',stop);down.on('close',()=>{sockets.delete(down);up.destroy();});up.on('close',()=>{sockets.delete(up);down.destroy();});
   down.on('data',data=>{tail=Buffer.concat([tail,data]);if(tail.includes(Buffer.from('execute_provider_cleanup')))discard=true;tail=tail.subarray(-256);up.write(data);});
   up.on('data',data=>{
     if(!discard){down.write(data);return;}pending=Buffer.concat([pending,data]);if(pending.length>32768){stop();return;}
     while(pending.length>=5){const size=pending.readUInt32BE(1)+1;if(size<5||size>32768){stop();return;}if(pending.length<size)return;
       if(pending[0]===90){dropped=true;stop();return;}pending=pending.subarray(size);
     }
   });
 });
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{
   url.port=String(proxy.address().port);const execute=createProviderCleanupExecutor({...runtimeCleanup.config,connectionString:url.toString()});
   const r=await dispatchProviderCleanup([id,g.request.evidence.requestId],execute,freshSignal());assert.equal(dropped,true);assert.deepEqual(r.results.map(x=>x.status),['outcome_unknown','not_started']);assert.equal(await present(f),0);assert.equal(await present(g),1);
   const retained=await readAdapter(id,freshSignal());assert.equal(retained.outcome,'provider_removed');assert.equal(retained.requestId,id);
   await client.query("INSERT INTO auth.sessions(id,user_id,aal) VALUES($1,$2,'aal1')",[f.p,owner.subject]);assert.deepEqual(await executeAdapter(id,freshSignal()),retained);assert.equal(await present(f),1);
 }finally{for(const socket of sockets)socket.destroy();const closed=once(proxy,'close');proxy.close();await closed;}
});
