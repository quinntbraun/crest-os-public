import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';

const issuer='https://auth.example.com/auth/v1',table='crest_private.provider_inventory_observations';
const recordFn='crest_commands.record_provider_inventory(uuid,uuid,text,uuid,integer)',readFn='crest_commands.read_provider_inventory_observation(uuid,uuid,text)';
let sandbox,client,target,maintenance,second,login,loginOwned=false,bootstrap,owner,other,business,prior,receipt,retained,legacy;
const record=(id=randomUUID(),a=owner,{cursor=null,size=100,expectedIssuer=issuer,c=maintenance}={})=>c.query('SELECT crest_commands.record_provider_inventory($1,$2,$3,$4,$5) AS result',[id,a.id,expectedIssuer,cursor,size]).then(r=>r.rows[0].result);
const read=(id,a=owner,expectedIssuer=issuer,c=maintenance)=>c.query('SELECT crest_commands.read_provider_inventory_observation($1,$2,$3) AS result',[id,a.id,expectedIssuer]).then(r=>r.rows[0].result);
const count=async()=>(await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
async function sources(){return (await client.query("SELECT encode(sha256(convert_to(jsonb_build_array((SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM auth.sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.app_sessions s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.session_events s),(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM crest_private.provider_cleanup_references s))::text,'UTF8')),'hex') AS hash")).rows[0].hash;}
async function actor(){const subject=randomUUID();await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const id=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic findings owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;return {id,subject};}
async function provider(a=owner,{aal='aal2',notAfter=null}={}){const id=randomUUID();await client.query('INSERT INTO auth.sessions(id,user_id,aal,not_after,created_at,updated_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())',[id,a.subject,aal,notAfter]);return id;}
async function membership(a){await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[business,a.id,owner.id]);}
async function register(a,p,{expired=false}={}){const hash=randomBytes(32),id=(await client.query("WITH moment AS (SELECT clock_timestamp()-CASE WHEN $4 THEN interval '14 hours' ELSE interval '1 second' END AS stamp) INSERT INTO crest_private.app_sessions(actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT id,$2,$3,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,decode(repeat('ab',32),'hex'),'synthetic',id,id FROM crest_private.actors,moment WHERE id=$1 RETURNING id",[a.id,p,hash,expired])).rows[0].id;return {id,hash};}
const revoke=f=>client.query('SELECT crest_commands.revoke_app_session($1,$2)',[f.hash,randomUUID()]);
before(async()=>{
  sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(18));
  bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;owner=await actor();other=await actor();
  await client.query('BEGIN');try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic findings business','UTC',$1,$1,'manual') RETURNING id",[owner.id])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual'),($1,$3,'owner',$2,$2,'manual')",[business,owner.id,other.id]);await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,created_by,updated_by,origin) VALUES($1,$2,$2,'manual')",[business,owner.id]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
  const p=await provider();legacy=await register(owner,p);await revoke(legacy);retained=await sources();receipt=await sandbox.apply(target,await sandbox.prefix(19));
  login=`crest_probe_${randomBytes(8).toString('hex')}`;const password=randomBytes(32).toString('hex');assert.match(login,/^crest_probe_[a-f0-9]{16}$/);assert.match(password,/^[a-f0-9]{64}$/);await sandbox.admin.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);loginOwned=true;await sandbox.admin.query(`GRANT crest_inventory TO ${login}`);
  const url=new URL(target);url.username=login;url.password=password;maintenance=await sandbox.connect(url.toString());second=await sandbox.connect(url.toString());for(const c of [maintenance,second])await c.query('SET ROLE crest_inventory');
});
after(async()=>{await maintenance?.end();await second?.end();if(loginOwned)await sandbox.admin.query(`DROP ROLE ${login}`);await sandbox?.close();});

test('schema18 upgrade preserves all provider/local source evidence and exact CLI prefix',async()=>{
  assert.equal(prior.history.length,18);assert.equal(receipt.history.length,19);assert.deepEqual(receipt.history.slice(0,18),prior.history);assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(19))).history,receipt.history);assert.equal(await sources(),retained);assert.equal(await count(),0);
});
test('one bounded database-derived evidence envelope has a reproducible hash and no source changes',async()=>{
  const before=await sources(),id=randomUUID(),r=await record(id),e=r.evidence;assert.equal(e.schemaVersion,1);assert.equal(e.requestId,id);assert.equal(e.actorId,owner.id);assert.equal(e.providerIssuer,issuer);assert.equal(e.pageSize,100);assert.equal(e.databasePrincipal,login);assert.equal(e.observationCount,e.observations.length);assert(new Date(e.recordedAt)>=new Date(e.observedAt));assert.equal(await sources(),before);
  const row=(await client.query(`SELECT canonical_evidence AS text,event_hash FROM ${table} WHERE request_id=$1`,[id])).rows[0];assert.equal(createHash('sha256').update(row.text,'utf8').digest('hex'),r.evidenceHash);assert.equal(row.event_hash,r.evidenceHash);assert.equal(r.canonicalEvidence,row.text);assert.deepEqual(JSON.parse(r.canonicalEvidence),r.evidence);
  for(const item of e.observations){assert.equal(new Date(item.observed_at).getTime(),new Date(e.observedAt).getTime());for(const key of Object.keys(item))assert(!/token|cipher|secret|password|csrf|credential|email|key_id/i.test(key));}
});
test('all four classifications are review-only metadata derived from the exact sampled devices',async()=>{
  const unregistered=await provider(),active=await provider(),f=await register(owner,active),stale=await provider(owner,{aal:'aal1'});await register(owner,stale);const e=(await record()).evidence;
  const by=id=>e.observations.find(r=>r.provider_session_id===id);assert.equal(by(unregistered).classification,'unregistered_review');assert.equal(by(active).classification,'registered_observed');assert.equal(by(active).app_session_id,f.id);assert.equal(by(stale).classification,'registered_review');assert.equal(e.observations.find(r=>r.app_session_id===legacy.id).classification,'local_revocation_review');
});
test('expired/epoch/disabled/MFA/deadline conditions never become an application eligibility claim',async()=>{
  for(const reason of ['expired','epoch','disabled','mfa','provider']){const a=await actor();await membership(a);const p=await provider(a,{aal:reason==='mfa'?'aal1':'aal2',notAfter:reason==='provider'?new Date(Date.now()-1000):null});await register(a,p,{expired:reason==='expired'});
    if(reason==='epoch')await client.query('UPDATE crest_private.actors SET current_security_epoch=$1,version=version+1 WHERE id=$2',[randomUUID(),a.id]);if(reason==='disabled')await client.query('UPDATE crest_private.actors SET disabled_at=clock_timestamp(),version=version+1 WHERE id=$1',[a.id]);
    const [r]=(await record(randomUUID(),a)).evidence.observations;assert.equal(r.classification,'registered_review');assert(!('eligible' in r));}
});
test('identical request replay preserves the original snapshot after provider and local state changes',async()=>{
  const id=randomUUID(),first=await record(id),newProvider=await provider();await client.query('DELETE FROM auth.sessions WHERE id=$1',[first.evidence.observations[0].provider_session_id]);const before=await count();assert.deepEqual(await record(id),first);assert.deepEqual(await read(id),first);assert.equal(await count(),before);assert(!first.evidence.observations.some(r=>r.provider_session_id===newProvider));assert((await record()).evidence.observations.some(r=>r.provider_session_id===newProvider));
});
test('historical lookup is scoped to exact request, actor and issuer and absence grants no authority',async()=>{
  const id=randomUUID(),first=await record(id);assert.deepEqual(await read(id),first);assert.equal(await read(randomUUID()),null);assert.equal(await read(id,other),null);assert.equal(await read(id,owner,'https://other.example.com/auth/v1'),null);assert.equal((await record(randomUUID(),other)).evidence.observationCount,0);
});
test('reused request ID with any different typed input conflicts without resampling or overwriting',async()=>{
  const id=randomUUID(),first=await record(id),before=await count();for(const [a,options] of [[other,{}],[owner,{expectedIssuer:'https://other.example.com/auth/v1'}],[owner,{cursor:randomUUID()}],[owner,{size:1}]])await assert.rejects(record(id,a,options),e=>e.code==='23505'&&e.message==='CREST_INVENTORY_REQUEST_CONFLICT');assert.deepEqual(await read(id),first);assert.equal(await count(),before);
});
test('concurrent same-ID work returns busy immediately and committed replay returns exactly one receipt',async()=>{
  const id=randomUUID();await maintenance.query('BEGIN');try{const first=await record(id);await assert.rejects(record(id,owner,{c:second}),e=>e.code==='55P03');assert.equal(await read(id,owner,issuer,second),null);await maintenance.query('COMMIT');assert.deepEqual(await record(id,owner,{c:second}),first);}finally{await maintenance.query('ROLLBACK');}assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE request_id=$1`,[id])).rows[0].n,1);
});
test('aborted concurrent capture releases its request claim and the same ID can capture a fresh snapshot',async()=>{
  const id=randomUUID();await maintenance.query('BEGIN');try{await record(id);await assert.rejects(record(id,owner,{c:second}),e=>e.code==='55P03');}finally{await maintenance.query('ROLLBACK');}assert.equal(await read(id),null);const p=await provider(),r=await record(id,owner,{c:second});assert(r.evidence.observations.some(i=>i.provider_session_id===p));
});
test('explicit rollback retains no partial scan or receipt and leaves all source state unchanged',async()=>{
  const id=randomUUID(),before=await sources(),n=await count();await maintenance.query('BEGIN');try{await record(id);assert.equal(await read(id,owner,issuer,second),null);}finally{await maintenance.query('ROLLBACK');}assert.equal(await read(id),null);assert.equal(await count(),n);assert.equal(await sources(),before);
});
test('injected failure after snapshot capture rolls back the whole append and permits the same-ID retry',async()=>{
  const id=randomUUID(),before=await sources();await client.query("CREATE FUNCTION crest_private.inventory_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_INVENTORY_FAILURE'; END $$");await client.query(`CREATE TRIGGER zz_inventory_failure_probe BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION crest_private.inventory_failure_probe()`);
  try{await assert.rejects(record(id),e=>e.code==='23514');}finally{await client.query(`DROP TRIGGER zz_inventory_failure_probe ON ${table}`);await client.query('DROP FUNCTION crest_private.inventory_failure_probe()');}assert.equal(await read(id),null);assert.equal(await sources(),before);assert.equal((await record(id)).evidence.requestId,id);
});
test('later provider deletion cannot erase a retained local-revocation finding or mark it resolved',async()=>{
  const a=await actor();await membership(a);const p=await provider(a),f=await register(a,p);await revoke(f);const id=randomUUID(),first=await record(id,a);assert.equal(first.evidence.observations[0].classification,'local_revocation_review');assert(first.evidence.observations[0].cleanup_reference_id);await client.query('DELETE FROM auth.sessions WHERE id=$1',[p]);assert.deepEqual(await read(id,a),first);assert.equal((await record(randomUUID(),a)).evidence.observationCount,0);assert.equal((await client.query('SELECT state FROM crest_private.provider_cleanup_references WHERE app_session_id=$1',[f.id])).rows[0].state,'review_required');
});
test('bounded ordered pages and empty results remain separate observations without completeness claims',async()=>{
  const a=await actor(),ids=[];for(let i=0;i<5;i++)ids.push(await provider(a));ids.sort();let cursor=null;const seen=[];for(let i=0;i<4;i++){const e=(await record(randomUUID(),a,{cursor,size:2})).evidence;assert(e.observationCount<=2);assert.equal(e.afterSessionId,cursor);if(!e.observationCount){assert.equal(e.lastSessionId,null);break;}seen.push(...e.observations.map(r=>r.provider_session_id));cursor=e.lastSessionId;}assert.deepEqual(seen,ids);
});
test('invalid typed inputs or wrong actor/issuer binding cannot create an observation row',async()=>{
  const n=await count();for(const [id,a,o] of [[null,owner,{}],[randomUUID(),{id:null},{}],[randomUUID(),owner,{size:null}],[randomUUID(),owner,{size:0}],[randomUUID(),owner,{size:101}],[randomUUID(),owner,{expectedIssuer:null}],[randomUUID(),owner,{expectedIssuer:'x'.repeat(501)}]])await assert.rejects(record(id,a,o),e=>e.code==='22023');for(const a of [{id:randomUUID()},{id:bootstrap}])await assert.rejects(record(randomUUID(),a),e=>e.code==='42501');await assert.rejects(record(randomUUID(),owner,{expectedIssuer:'https://other.example.com/auth/v1'}),e=>e.code==='42501');assert.equal(await count(),n);await assert.rejects(read(null),e=>e.code==='22023');
});
test('new capture requires READ COMMITTED and writes; historical lookup works read-only',async()=>{
  const id=randomUUID(),first=await record(id);await maintenance.query('BEGIN ISOLATION LEVEL REPEATABLE READ');try{await assert.rejects(record(),e=>e.code==='25001');}finally{await maintenance.query('ROLLBACK');}await maintenance.query('BEGIN READ ONLY');try{assert.deepEqual(await read(id),first);await assert.rejects(record(),e=>e.code==='25006');}finally{await maintenance.query('ROLLBACK');}
});
test('UTC/ISO evidence and exact original replay survive hostile caller date/time settings',async()=>{
  await maintenance.query("SET TimeZone='Pacific/Honolulu'; SET DateStyle='SQL, DMY'; SET search_path=pg_temp,public");let id,first;try{id=randomUUID();first=await record(id);assert.match(first.evidence.observedAt,/\+00:00$/);assert(first.evidence.observations.every(r=>/\+00:00$/.test(r.observed_at)));}finally{await maintenance.query('RESET TimeZone; RESET DateStyle; RESET search_path');}assert.deepEqual(await record(id),first);assert.deepEqual(await read(id),first);
});
test('ordinary runtimes cannot execute capture/lookup or access the retained table',async()=>{
  for(const role of ['crest_web','crest_worker','crest_recovery','anon','authenticated','service_role','crest_auth_reader','crest_session_owner']){for(const fn of [recordFn,readFn,'crest_private.capture_inventory_observation()'])assert.equal((await client.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed,false);assert.equal((await client.query("SELECT has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege($1,$2,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[role,table])).rows[0].allowed,false);}
  await assert.rejects(maintenance.query(`SELECT * FROM ${table}`),e=>e.code==='42501');await assert.rejects(maintenance.query(`DELETE FROM ${table}`),e=>e.code==='42501');await assert.rejects(maintenance.query('SET ROLE crest_inventory_owner'),e=>e.code==='42501');
});
test('forced RLS and fixed definer preserve existing source grants and grant no provider writes',async()=>{
  assert.deepEqual((await client.query('SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass',[table])).rows[0],{relrowsecurity:true,relforcerowsecurity:true,owner:'crest_schema_owner'});for(const fn of [recordFn,readFn]){const r=(await client.query('SELECT prosecdef,proconfig,pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid=$1::regprocedure',[fn])).rows[0];assert.deepEqual(r,{prosecdef:true,proconfig:['search_path=pg_catalog, pg_temp','row_security=on'],owner:'crest_inventory_owner'});}
  for(const source of ['auth.sessions','auth.users','auth.refresh_tokens','crest_private.app_sessions','crest_private.provider_cleanup_references'])assert.equal((await client.query("SELECT has_any_column_privilege('crest_inventory_owner',$1,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',$1,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS allowed",[source])).rows[0].allowed,false);for(const schema of ['auth','crest','crest_private','crest_commands','public'])assert.equal((await client.query("SELECT has_schema_privilege('crest_inventory_owner',$1,'CREATE') AS allowed",[schema])).rows[0].allowed,false);
});
test('evidence cannot be changed, deleted or truncated even by migration-authority ordinary DML',async()=>{
  const id=randomUUID(),first=await record(id);for(const sql of [`UPDATE ${table} SET event_hash=repeat('0',64) WHERE request_id=$1`,`DELETE FROM ${table} WHERE request_id=$1`])await assert.rejects(client.query(sql,[id]),e=>e.code==='55000');await assert.rejects(client.query(`TRUNCATE ${table}`),e=>e.code==='55000');assert.deepEqual(await read(id),first);
});
test('direct privileged INSERT cannot smuggle supplied findings, secrets, hashes, principal or timestamps',async()=>{
  const id=randomUUID();await client.query(`INSERT INTO ${table}(request_id,actor_id,provider_issuer,page_size,schema_version,origin,evidence,event_hash,observed_at,created_at,database_principal) VALUES($1,$2,$3,1,999,'manual','{"secret":"synthetic-forged"}','forged','infinity','-infinity','forged')`,[id,owner.id,issuer]);const r=await read(id);assert.equal(r.evidence.schemaVersion,1);assert.equal(r.evidence.databasePrincipal,'supabase_admin');assert(!JSON.stringify(r).includes('synthetic-forged'));assert(!JSON.stringify(r).includes('forged'));assert.equal(r.evidence.observationCount,1);assert.match(r.evidenceHash,/^[a-f0-9]{64}$/);
});
test('provider read failure blocks only a new snapshot; retained lookup and identical replay remain available',async()=>{
  const id=randomUUID(),first=await record(id),newId=randomUUID();await client.query('REVOKE SELECT(id,user_id,not_after,aal) ON auth.sessions FROM crest_inventory_owner');try{assert.deepEqual(await read(id),first);assert.deepEqual(await record(id),first);await assert.rejects(record(newId),e=>e.code==='42501');assert.equal(await read(newId),null);}finally{await client.query('GRANT SELECT(id,user_id,not_after,aal) ON auth.sessions TO crest_inventory_owner');}assert.equal((await record(newId)).evidence.requestId,newId);
});
test('schema17 upgrade through18/19 remains compatible without adopting existing role memberships',async()=>{
  await sandbox.admin.query(`REVOKE crest_inventory FROM ${login}`);try{const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);const before=await sandbox.apply(t,await sandbox.prefix(17)),after=await sandbox.apply(t,await sandbox.prefix(19));assert.equal(after.history.length,19);assert.deepEqual(after.history.slice(0,17),before.history);assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);}finally{await sandbox.admin.query(`GRANT crest_inventory TO ${login}`);}
});
test('changed reader configuration or provider privileges reject schema19 and retain pending review',async()=>{
  await sandbox.admin.query(`REVOKE crest_inventory FROM ${login}`);try{
    for(const change of ['ALTER FUNCTION crest_commands.provider_session_inventory(uuid,text,uuid,integer) RESET row_security','GRANT DELETE ON auth.sessions TO crest_inventory_owner','GRANT SELECT ON auth.users TO crest_inventory_owner','GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner']){
      const t=await sandbox.database(),c=await sandbox.connect(t);await sandbox.apply(t,await sandbox.prefix(0),true);await installProviderSchema(c,t);await sandbox.apply(t,await sandbox.prefix(18));await c.query(change);await assert.rejects(sandbox.apply(t,await sandbox.prefix(19)),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);
      assert.equal((await c.query('SELECT to_regclass($1) AS table',[table])).rows[0].table,null);assert.equal((await c.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,18);await assert.rejects(sandbox.apply(t,await sandbox.prefix(19)),/MIGRATION_PENDING_REVIEW_REQUIRED/);
    }
  }finally{await sandbox.admin.query(`GRANT crest_inventory TO ${login}`);}
});
