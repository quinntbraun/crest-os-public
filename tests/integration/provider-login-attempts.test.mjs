import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

const issuer='https://auth.example.com/auth/v1',table='crest_private.provider_login_attempts';
const beginFn='crest_commands.begin_provider_login(uuid,uuid,text,uuid)',issueFn='crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)',inventoryFn='crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer)';
let sandbox,target,client,web,second,maintenance,bootstrap,owner,other,business,prior,receipt,retained;
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const a=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic login owner',$1,$2,$3,$3,'manual') RETURNING id,current_security_epoch",[issuer,subject,bootstrap])).rows[0];return {id:a.id,subject,epoch:a.current_security_epoch};}
async function member(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
const begin=(a=owner,{id=randomUUID(),app=randomUUID(),expectedIssuer=issuer,c=web}={})=>c.query('SELECT crest_commands.begin_provider_login($1,$2,$3,$4) AS result',[id,app,expectedIssuer,a.subject]).then(r=>r.rows[0].result);
const inventory=(a=owner,{cursor=null,size=100,expectedIssuer=issuer,c=maintenance}={})=>c.query('SELECT * FROM crest_commands.provider_login_attempt_inventory($1,$2,$3,$4)',[a.id,expectedIssuer,cursor,size]).then(r=>r.rows);
async function provider(a=owner){const id=randomUUID();await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[id,a.subject]);return id;}
async function issue(a,b,{p,mutate=()=>{},legacy=false}={}){p??=await provider(a);const stamp=new Date(Date.now()-1000),hash=randomBytes(32),args=[b.appSessionId,hash,a.id,b.securityEpoch,issuer,a.subject,p,stamp,stamp,false,randomBytes(32),'synthetic',b.attemptId];mutate(args);await (web??client).query(`SELECT crest_commands.${legacy?'issue_app_session':'issue_tracked_app_session'}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,args);return {id:args[0],hash,p};}
async function sources(){return (await client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY request_id) FROM crest_private.provider_inventory_observations s))::text,'UTF8')),'hex') AS hash")).rows[0].hash;}
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(19));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic login business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await member(owner);await member(other);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
  // Retain a genuine pre20 untracked issuance and its source event.
  await issue(owner,{appSessionId:randomUUID(),securityEpoch:owner.epoch,attemptId:randomUUID()},{legacy:true});retained=await sources();receipt=await sandbox.apply(target,await sandbox.prefix(20));
  web=await sandbox.connect(target);second=await sandbox.connect(target);maintenance=await sandbox.connect(target);for(const c of [web,second])await c.query('SET ROLE crest_web');await maintenance.query('SET ROLE crest_inventory');
});
after(async()=>{await sandbox?.close();});

test('schema19 upgrade preserves sources and original CLI history without inventing historical attempts',async()=>{
  assert.equal(prior.history.length,19);assert.equal(receipt.history.length,20);assert.deepEqual(receipt.history.slice(0,19),prior.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(20))).history,receipt.history);assert.equal(await sources(),retained);assert.deepEqual(await inventory(),[]);
});
test('begin derives a token-free immutable header with original portable JSON/hash and no source mutation',async()=>{
  const before=await sources(),b=await begin(),r=(await inventory()).find(r=>r.attempt_id===b.attemptId);assert.equal(await sources(),before);assert.equal(b.actorId,owner.id);assert.equal(b.securityEpoch,owner.epoch);assert.equal(r.registration_state,'registration_unconfirmed');assert.equal(r.provider_session_id,null);assert.equal(r.evidence.appSessionId,b.appSessionId);assert.equal(r.evidence.securityEpoch,owner.epoch);assert.equal(r.evidence.databasePrincipal,'supabase_admin');assert.deepEqual(JSON.parse(r.canonical_evidence),r.evidence);assert.equal(createHash('sha256').update(r.canonical_evidence,'utf8').digest('hex'),r.evidence_hash);
  for(const key of Object.keys(r.evidence))assert(!/token|cipher|password|credential|email|factor|code|key_id/i.test(key));
});
test('begin rejects missing binding, wrong issuer, disabled owner and missing active membership',async()=>{
  await assert.rejects(begin({subject:randomUUID()}),e=>e.code==='42501');await assert.rejects(begin(owner,{expectedIssuer:'https://other.example.com/auth/v1'}),e=>e.code==='42501');
  const a=await actor();await assert.rejects(begin(a),e=>e.code==='42501');await member(a);await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[a.id]);await assert.rejects(begin(a),e=>e.code==='42501');assert.deepEqual(await inventory(a),[]);
});
test('duplicate attempt or app reservation never authorizes begin replay',async()=>{
  const b=await begin();for(const options of [{id:b.attemptId},{app:b.appSessionId},{id:b.attemptId,app:b.appSessionId}])await assert.rejects(begin(owner,options),e=>e.code==='23505');assert.equal((await inventory()).filter(r=>r.attempt_id===b.attemptId).length,1);
});
test('begin cannot adopt an already-created app session',async()=>{
  const b=await begin(),f=await issue(owner,b);await assert.rejects(begin(owner,{app:f.id}),e=>e.code==='23514');
});
test('begin rollback leaves no marker and injected insert failure cannot partially register a login',async()=>{
  const id=randomUUID();await web.query('BEGIN');try{await begin(owner,{id});assert(!(await inventory()).some(r=>r.attempt_id===id));}finally{await web.query('ROLLBACK');}assert(!(await inventory()).some(r=>r.attempt_id===id));
  await client.query("CREATE FUNCTION crest_private.login_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_LOGIN_FAILURE'; END $$");await client.query(`CREATE TRIGGER zz_login_failure BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION crest_private.login_failure_probe()`);
  try{await assert.rejects(begin(owner,{id}),e=>e.code==='23514');}finally{await client.query(`DROP TRIGGER zz_login_failure ON ${table}`);await client.query('DROP FUNCTION crest_private.login_failure_probe()');}assert(!(await inventory()).some(r=>r.attempt_id===id));
});
test('overlapping duplicate begins serialize on the unique reservation and cannot replay after commit',async()=>{
  const id=randomUUID(),app=randomUUID();await web.query('BEGIN');await second.query("SET lock_timeout='100ms'");try{await begin(owner,{id,app});await assert.rejects(begin(owner,{id,app,c:second}),e=>e.code==='55P03');await web.query('COMMIT');await assert.rejects(begin(owner,{id,app,c:second}),e=>e.code==='23505');}finally{await web.query('ROLLBACK');await second.query('RESET lock_timeout');}
});
test('tracked registration requires the exact reserved attempt, app, actor, epoch, issuer and subject',async()=>{
  const b=await begin(),p=await provider();for(const [index,value] of [[0,randomUUID()],[2,other.id],[3,randomUUID()],[4,'https://other.example.com/auth/v1'],[5,other.subject],[12,randomUUID()]])await assert.rejects(issue(owner,b,{p,mutate:args=>{args[index]=value;}}),e=>e.code==='42501');assert.equal((await inventory()).find(r=>r.attempt_id===b.attemptId).registration_state,'registration_unconfirmed');
});
test('registration links the immutable CREATED operation and rejects repeat issuance',async()=>{
  const b=await begin(),f=await issue(owner,b),r=(await inventory()).find(r=>r.attempt_id===b.attemptId);assert.equal(r.registration_state,'registration_recorded');assert.equal(r.provider_session_id,f.p);assert.equal((await client.query("SELECT operation_id FROM crest_private.session_events WHERE session_id=$1 AND action='CREATED'",[f.id])).rows[0].operation_id,b.attemptId);await assert.rejects(issue(owner,b,{p:f.p}),e=>e.code==='23505');
});
test('epoch change after begin denies registration without silently rebasing the attempt',async()=>{
  const a=await actor();await member(a);const b=await begin(a);await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);await assert.rejects(issue(a,b),e=>e.code==='42501');const [r]=await inventory(a);assert.equal(r.registration_state,'registration_unconfirmed');assert.equal(r.evidence.securityEpoch,b.securityEpoch);
});
test('current membership, owner and provider checks still apply after a valid begin',async()=>{
  const a=await actor();await member(a);const b=await begin(a),p=await provider(a);await client.query('UPDATE crest.memberships SET active=false,version=version+1 WHERE actor_id=$1',[a.id]);await assert.rejects(issue(a,b,{p}),e=>e.code==='42501');await client.query('UPDATE crest.memberships SET active=true,version=version+1 WHERE actor_id=$1',[a.id]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[p]);await assert.rejects(issue(a,b,{p}),e=>e.code==='42501');assert.equal((await inventory(a))[0].registration_state,'registration_unconfirmed');
});
test('uncertain attempts never gain an expiry, cleanup outcome or provider identity by inference',async()=>{
  const a=await actor();await member(a);const b=await begin(a);await provider(a);const [r]=await inventory(a);assert.equal(r.registration_state,'registration_unconfirmed');assert.equal(r.provider_session_id,null);assert.equal(r.local_revoked_at,null);assert(!('expiresAt' in r.evidence));assert(!('closedAt' in r.evidence));assert.equal(r.attempt_id,b.attemptId);
});
test('matching app UUID without the source CREATED operation is a conflict and hides provider identity',async()=>{
  const a=await actor();await member(a);const b=await begin(a);await issue(a,b,{legacy:true,mutate:args=>{args[12]=randomUUID();}});const [r]=await inventory(a);assert.equal(r.registration_state,'binding_conflict_review');assert.equal(r.provider_session_id,null);assert.equal(r.local_revoked_at,null);
});
test('source link survives current operation changes, local revocation and provider disappearance',async()=>{
  const a=await actor();await member(a);const b=await begin(a),f=await issue(a,b);await client.query('UPDATE crest_private.app_sessions SET operation_id=$1,version=version+1 WHERE id=$2',[randomUUID(),f.id]);assert.equal((await inventory(a))[0].registration_state,'registration_recorded');await web.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.p]);const [r]=await inventory(a);assert.equal(r.registration_state,'registration_recorded');assert.equal(r.provider_session_id,f.p);assert(r.local_revoked_at);
});
test('inventory is bounded, ordered and scoped by actor and exact issuer without caller GUC authority',async()=>{
  const a=await actor();await member(a);const ids=[];for(let i=0;i<5;i++)ids.push((await begin(a)).attemptId);ids.sort();const seen=[];let cursor=null;for(let i=0;i<4;i++){const rows=await inventory(a,{cursor,size:2});assert(rows.length<=2);seen.push(...rows.map(r=>r.attempt_id));if(!rows.length)break;cursor=rows.at(-1).attempt_id;}assert.deepEqual(seen,ids);assert.deepEqual(await inventory(a,{expectedIssuer:'https://other.example.com/auth/v1'}),[]);await maintenance.query("SET crest.actor_id='forged'; SET search_path=public,pg_temp");try{assert.deepEqual((await inventory(a)).map(r=>r.attempt_id),ids);}finally{await maintenance.query('RESET crest.actor_id; RESET search_path');}
});
test('typed invalid input and unsuitable isolation/read-only begin fail before creating evidence',async()=>{
  for(const o of [{id:null},{app:null},{expectedIssuer:null},{expectedIssuer:''},{expectedIssuer:'x'.repeat(501)}])await assert.rejects(begin(owner,o),e=>e.code==='22023');for(const size of [null,0,101])await assert.rejects(inventory(owner,{size}),e=>e.code==='22023');
  for(const c of [web,maintenance]){await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(c===web?begin():inventory(),e=>e.code==='25001');}finally{await c.query('ROLLBACK');}}
  await web.query('BEGIN READ ONLY');try{await assert.rejects(begin(),e=>e.code==='25006');}finally{await web.query('ROLLBACK');}await maintenance.query('BEGIN READ ONLY');try{assert((await inventory()).length>0);}finally{await maintenance.query('ROLLBACK');}
});
test('header derivation discards forged principal, time, origin, schema and body even on privileged insert',async()=>{
  const id=randomUUID(),app=randomUUID();await client.query(`INSERT INTO ${table}(attempt_id,reserved_app_session_id,actor_id,issued_security_epoch,provider_issuer,provider_subject,schema_version,origin,created_at,database_principal,canonical_evidence,event_hash) VALUES($1,$2,$3,$4,$5,$6,999,'manual','-infinity','forged','{"password":"synthetic-forged"}','forged')`,[id,app,owner.id,owner.epoch,issuer,owner.subject]);const r=(await inventory()).find(r=>r.attempt_id===id);assert.equal(r.evidence.schemaVersion,1);assert.equal(r.evidence.origin,'system');assert.equal(r.evidence.databasePrincipal,'supabase_admin');assert(!r.canonical_evidence.includes('forged'));assert.match(r.evidence.createdAt,/\+00:00$/);
});
test('retained attempt headers reject update, deletion and truncate',async()=>{
  const b=await begin();for(const sql of [`UPDATE ${table} SET event_hash=repeat('0',64) WHERE attempt_id=$1`,`DELETE FROM ${table} WHERE attempt_id=$1`])await assert.rejects(client.query(sql,[b.attemptId]),e=>e.code==='55000');await assert.rejects(client.query(`TRUNCATE ${table}`),e=>e.code==='55000');assert((await inventory()).some(r=>r.attempt_id===b.attemptId));
});
test('ordinary web cannot read evidence or inventory and maintenance cannot begin, issue or write sources',async()=>{
  await assert.rejects(web.query(`SELECT * FROM ${table}`),e=>e.code==='42501');await assert.rejects(inventory(owner,{c:web}),e=>e.code==='42501');await assert.rejects(begin(owner,{c:maintenance}),e=>e.code==='42501');await assert.rejects(maintenance.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
  for(const role of ['anon','authenticated','service_role','crest_worker','crest_recovery','crest_auth_reader'])for(const fn of [beginFn,issueFn,inventoryFn])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);
  for(const source of ['auth.sessions','auth.users','auth.refresh_tokens','crest_private.actors','crest_private.app_sessions','crest_private.session_events'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_inventory_owner',$1,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',$1,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[source])).rows[0].allowed,false);
});
test('fixed definers and forced RLS grant only five safe source event columns without payload access',async()=>{
  assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[table])).rows[0],{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});
  for(const [fn,owner] of [[beginFn,'crest_session_owner'],[issueFn,'crest_session_owner'],[inventoryFn,'crest_inventory_owner']])assert.deepEqual((await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0],{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner});
  const columns=(await client.query("SELECT attname FROM pg_attribute WHERE attrelid='crest_private.session_events'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege('crest_inventory_owner',attrelid,attnum,'SELECT') ORDER BY attname")).rows.map(r=>r.attname);assert.deepEqual(columns,['action','actor_id','id','operation_id','session_id']);
});
test('schema18 upgrade through19/20 preserves compatible history',async()=>{
  const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const before=await sandbox.apply(t,await sandbox.prefix(18)),after=await sandbox.apply(t,await sandbox.prefix(20));assert.equal(after.history.length,20);assert.deepEqual(after.history.slice(0,18),before.history);
});
test('changed upstream owner/configuration or source privilege blocks migration and keeps pending review',async()=>{
  for(const change of ['ALTER FUNCTION crest_commands.session_actor_context(text,uuid) RESET row_security','GRANT DELETE ON auth.sessions TO crest_inventory_owner','GRANT SELECT ON crest_private.session_events TO crest_inventory_owner','GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner']){
    const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(19));await c.query(change);await assert.rejects(sandbox.apply(t,await sandbox.prefix(20)),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await c.query('SELECT to_regclass($1) AS table',[table])).rows[0].table,null);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,19);await assert.rejects(sandbox.apply(t,await sandbox.prefix(20)),/MIGRATION_PENDING_REVIEW_REQUIRED/);
  }
});
