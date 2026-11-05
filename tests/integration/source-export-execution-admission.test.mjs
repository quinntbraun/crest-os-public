// Disposable registered43 + unregistered admission proposal. No runtime activation.
// These cases require real PostgreSQL; syntax checking does not execute them.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseSourceExportAdmission} from '../../src/security/source-export-admission.ts';
let sandbox,target,client,web,web2,login,bootstrap,pid2,history,definitions;
const issuer='https://auth.example.com/auth/v1',release='a'.repeat(40);
const signature='crest_commands.request_source_export_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)';
const sql=await readFile(new URL('../../planning/proposals/source-export-execution-admission.sql',import.meta.url),'utf8');
const provenance=JSON.parse(await readFile(new URL('../../planning/proposals/source-export-execution-admission.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');
const query=(c,sql,args)=>c.query(sql,args).then(r=>r.rows[0].value);
const command=(f,job,operation,app=release)=>({schemaVersion:1,businessId:f.business,commandType:'export.request',reference:{operationId:operation,recoveryEpoch:f.epoch,exportJobId:job,appReleaseId:app,profile:'crest.business-source-journal-bundle.v1',sourceSchemaVersion:43}});
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,f.validUntil??new Date(Date.now()+300000),f.business,f.epoch];
async function request(f,job,operation,c=web,kind='admission',app=release){
 const name=kind==='admission'?'request_source_export_for_execution':kind==='foreground'?'request_source_export_with_activity':'request_source_export';
 const value=await query(c,'SELECT crest_commands.'+name+'($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),operation,job,app]);
 return kind==='admission'?parseSourceExportAdmission(value,command(f,job,operation,app),f.actor):value;
}
async function session(f,age='1 second'){
 const provider=randomUUID(),id=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH t AS MATERIALIZED(SELECT clock_timestamp()-$6::interval AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN t WHERE id=$2",[id,f.actor,provider,hash,randomBytes(32),age]);
 return {...f,session:id,provider,hash};
}
async function fixture(age='1 second'){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic execution owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 let business,epoch;await client.query('BEGIN');
 try{
  business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic execution business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);
 return session({actor,subject,business,epoch},age);
}
async function evidence(f){
 const out={};for(const table of ['export_jobs','export_job_attempts','operations','audit_events'])out[table]=(await client.query('SELECT to_jsonb(t) AS value FROM crest_private.'+table+' t WHERE business_id=$1 ORDER BY id',[f.business])).rows;
 return out;
}
const activity=f=>query(client,"SELECT jsonb_build_object('version',version::text,'lastActiveAt',to_char(last_active_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),'authenticatedAt',authenticated_at,'reauthAt',reauth_at,'expiresAt',expires_at,'operationId',operation_id,'updatedBy',updated_by) AS value FROM crest_private.app_sessions WHERE id=$1",[f.session]);
async function oldDefinitions(){return(await client.query("SELECT p.oid::text,pg_get_functiondef(p.oid) AS definition,p.proowner::text,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest_private','crest_commands') ORDER BY p.oid")).rows;}
async function waitForLock(){
 const deadline=Date.now()+1800;let blocked=false;
 while(Date.now()<deadline){
  await client.query('SELECT pg_stat_clear_snapshot()');
  blocked=(await client.query("SELECT wait_event_type='Lock' AS blocked FROM pg_stat_activity WHERE pid=$1",[pid2])).rows[0]?.blocked;
  if(blocked)break;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.equal(blocked,true,'second connection must actually wait on a database lock');
}
before(async()=>{
 assert.equal(provenance.registered,false);assert.equal(provenance.nativeExecuted,false);assert.equal(provenance.existingMigrationCount,43);assert.equal(provenance.sourceProjectionVersion,43);
 assert.equal(Buffer.byteLength(sql),provenance.sqlBytes);assert.equal(sha(sql),provenance.sqlSha256);assert.equal(provenance.existingFunctionBodies.length,7);
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);
 history=(await sandbox.apply(target,await sandbox.prefix(43))).history;assert.equal(history.length,43);definitions=await oldDefinitions();
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
for(const entry of provenance.existingFunctionBodies)test('admission proposal refuses changed source '+entry.signature,async()=>{
 await client.query('BEGIN');try{
  await client.query('ALTER FUNCTION '+entry.signature+' SET search_path=public');
  await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_EXPORT_EXECUTION_SOURCE_REVIEW_REQUIRED');
 }finally{await client.query('ROLLBACK');}
 assert.equal(await query(client,'SELECT to_regprocedure($1) AS value',[signature]),null);assert.deepEqual(await oldDefinitions(),definitions);
});
for(const role of ['crest_schema_owner','crest_command_owner','crest_session_owner'])test('admission proposal refuses unsafe owner '+role,async()=>{
 await client.query('BEGIN');try{
  await client.query('ALTER ROLE '+role+' LOGIN');
  await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_EXPORT_EXECUTION_SOURCE_REVIEW_REQUIRED');
 }finally{await client.query('ROLLBACK');}
 assert.equal(await query(client,'SELECT to_regprocedure($1) AS value',[signature]),null);
});
for(const table of ['crest_private.operations','crest_private.audit_events','crest_private.export_jobs','crest.memberships','crest_private.app_sessions'])test('admission proposal refuses missing forced RLS on '+table,async()=>{
 await client.query('BEGIN');try{
  await client.query('ALTER TABLE '+table+' NO FORCE ROW LEVEL SECURITY');
  await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_EXPORT_EXECUTION_SOURCE_REVIEW_REQUIRED');
 }finally{await client.query('ROLLBACK');}
 assert.equal(await query(client,'SELECT to_regprocedure($1) AS value',[signature]),null);
});
test('admission proposal refuses unsafe default function privileges atomically',async()=>{
 await client.query('BEGIN');try{
  await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
  assert.equal(await query(client,"SELECT count(*)::int AS value FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'"),0,'built-in PUBLIC execute can be effective without an explicit global default ACL row');
  await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message==='CREST_EXPORT_EXECUTION_SOURCE_REVIEW_REQUIRED');
 }finally{await client.query('ROLLBACK');}
 assert.equal(await query(client,'SELECT to_regprocedure($1) AS value',[signature]),null);
});
test('admission proposal installs only the closed entry point and preserves registered43 history and old definitions',async()=>{
 await client.query('BEGIN');try{await client.query(sql);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}
 const after=await oldDefinitions();assert.deepEqual(after.filter(r=>!r.definition.includes('CREATE OR REPLACE FUNCTION crest_commands.request_source_export_for_execution(')),definitions);assert.equal(after.length,definitions.length+1);
 assert.equal((await client.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,43);
 const r=(await client.query("SELECT r.rolname,p.prosecdef,p.provolatile,lower(array_to_string(p.proconfig,',')) AS config,has_function_privilege('crest_web',p.oid,'EXECUTE') AS web,has_function_privilege('crest_export',p.oid,'EXECUTE') AS exporter FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure($1)",[signature])).rows[0];
 assert.deepEqual(r,{rolname:'crest_command_owner',prosecdef:true,provolatile:'v',config:'search_path=pg_catalog, pg_temp,row_security=on',web:true,exporter:false});
 assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure($1) AND a.grantee=0",[signature])).rows[0].n,0);
 assert.equal((await client.query("SELECT has_schema_privilege('crest_command_owner','crest_commands','CREATE') AS allowed")).rows[0].allowed,false);
 login='crest_admission_probe_0'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());
 for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}
 pid2=(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
});
test('fresh admission commits one exact original receipt and activity; same-transaction replay is recorded',async()=>{
 const f=await fixture(),job=randomUUID(),op=randomUUID(),before=await activity(f);let first;
 await web.query('BEGIN');try{first=await request(f,job,op);assert.equal(first.state,'created');assert.deepEqual(await request(f,job,op),{state:'recorded',result:first.result});assert.deepEqual(await evidence(f),{export_jobs:[],export_job_attempts:[],operations:[],audit_events:[]});await web.query('COMMIT');}catch(error){await web.query('ROLLBACK');throw error;}
 const saved=await evidence(f),after=await activity(f);
 assert.equal(saved.export_jobs.length,1);assert.equal(saved.operations.length,1);assert.equal(saved.audit_events.length,1);assert.equal(saved.export_job_attempts.length,0);
 assert.equal(saved.audit_events[0].value.event_hash,sha(saved.audit_events[0].value.hash_input));
 assert.deepEqual(saved.operations[0].value.result,first.result.receipt);assert.equal(after.version,String(BigInt(before.version)+2n));assert.equal(after.operationId,op);assert.equal(after.updatedBy,f.actor);
 for(const field of ['authenticatedAt','reauthAt','expiresAt'])assert.deepEqual(after[field],before[field]);
 assert.deepEqual(await request(f,job,op),{state:'recorded',result:first.result});assert.deepEqual(await evidence(f),saved);
});
for(const winner of ['admission','legacy','foreground'])for(const follower of ['admission','legacy','foreground'])for(const commit of [true,false]){
 if(winner!=='admission'&&follower!=='admission')continue;
 test('real devices '+winner+' then '+follower+' preserve one original after '+(commit?'commit':'rollback'),async()=>{
  const f=await fixture(),second=await session(f),job=randomUUID(),op=randomUUID();let pending;
  await web.query('BEGIN');try{
   const first=await request(f,job,op,web,winner);pending=request(second,job,op,web2,follower);void pending.catch(()=>undefined);
   await waitForLock();await web.query(commit?'COMMIT':'ROLLBACK');const result=await pending;
   if(follower==='admission')assert.equal(result.state,commit?'recorded':'created');else assert.equal(result.state,'committed');
   const actual=follower==='admission'?result.result:result;
   if(commit)assert.deepEqual(actual,winner==='admission'?first.result:first);
   const saved=await evidence(f);assert.equal(saved.export_jobs.length,1);assert.equal(saved.operations.length,1);assert.equal(saved.audit_events.length,1);assert.equal(saved.export_job_attempts.length,0);
   assert.deepEqual(saved.operations[0].value.result,actual.receipt);
  }finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
 });
}
test('different original or release conflicts without admitting work or changing evidence/activity',async()=>{
 const f=await fixture(),job=randomUUID(),op=randomUUID();await request(f,job,op);const saved=await evidence(f),before=await activity(f);
 assert.deepEqual(await request(f,randomUUID(),op),{state:'conflict',reason:'operation'});
 assert.deepEqual(await request(f,job,op,web,'admission','b'.repeat(40)),{state:'conflict',reason:'operation'});
 assert.deepEqual(await request(f,randomUUID(),randomUUID()),{state:'conflict',reason:'active_or_identity'});
 assert.deepEqual(await evidence(f),saved);assert.deepEqual(await activity(f),before);
});
for(const failure of ['audit','activity'])test(failure+' failure rolls back admission, job, audit, original and foreground activity',async()=>{
 const f=await fixture(),saved=await evidence(f),before=await activity(f),table=failure==='audit'?'crest_private.audit_events':'crest_private.app_sessions';
 const condition=failure==='audit'?"entity_kind<>'export_jobs'":"id<>'"+f.session+"'::uuid OR version<="+before.version+'::bigint';
 await client.query('ALTER TABLE '+table+' ADD CONSTRAINT synthetic_admission_refusal CHECK('+condition+') NOT VALID');
 try{await assert.rejects(request(f,randomUUID(),randomUUID()),e=>e.code==='23514');}finally{await client.query('ALTER TABLE '+table+' DROP CONSTRAINT synthetic_admission_refusal');}
 assert.deepEqual(await evidence(f),saved);assert.deepEqual(await activity(f),before);
 assert.equal((await request(f,randomUUID(),randomUUID())).state,'created');
});
test('a deferred failure at actual COMMIT never leaves a request or activity change',async()=>{
 const f=await fixture(),saved=await evidence(f),before=await activity(f);
 // Deliberately clear the verified scope AFTER the function returns. Existing
 // deferred operation/audit checks must reject the commit without disabling guards.
 await web.query('BEGIN');try{
  assert.equal((await request(f,randomUUID(),randomUUID())).state,'created');
  await web.query("SELECT set_config('crest.actor_id','',true),set_config('crest.business_id','',true),set_config('crest.operation_id','',true)");
  await assert.rejects(web.query('COMMIT'),e=>e.code==='23514'&&e.message==='CREST_EXPORT_JOB_AUDIT_REQUIRED');
 }finally{await web.query('ROLLBACK');}
 assert.deepEqual(await evidence(f),saved);assert.deepEqual(await activity(f),before);
});
for(const change of ['local-revocation','provider-loss','recovery-pause','epoch-rotation'])test('blocked admission rechecks '+change+' after the lock wait',async()=>{
 const f=await fixture(),saved=await evidence(f),before=await activity(f);let pending;
 await client.query('BEGIN');try{
  const local=change==='local-revocation';
  await client.query(local?'SELECT id FROM crest_private.app_sessions WHERE id=$1 FOR UPDATE':'SELECT business_id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[local?f.session:f.business]);
  pending=request(f,randomUUID(),randomUUID(),web2);void pending.catch(()=>undefined);await waitForLock();
  if(local)await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[f.session]);
  if(change==='provider-loss')await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);
  if(change==='recovery-pause')await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);
  if(change==='epoch-rotation')await client.query('UPDATE crest_private.business_recovery_authorities SET active_epoch=$2,version=version+1 WHERE business_id=$1',[f.business,randomUUID()]);
  await client.query('COMMIT');await assert.rejects(pending,e=>e.code==='42501'||e.message==='RECOVERY_REVIEW_REQUIRED');
 }finally{await client.query('ROLLBACK');await pending?.catch(()=>undefined);}
 assert.deepEqual(await evidence(f),saved);if(change!=='local-revocation')assert.deepEqual(await activity(f),before);
});
test('same-session concurrent admissions serialize without two activity upgrades or jobs',async()=>{
 const f=await fixture(),job=randomUUID(),op=randomUUID(),before=await activity(f);let pending;
 await web.query('BEGIN');try{
  const first=await request(f,job,op);pending=request(f,job,op,web2);void pending.catch(()=>undefined);await waitForLock();
  await web.query('COMMIT');assert.deepEqual(await pending,{state:'recorded',result:first.result});
 }finally{await web.query('ROLLBACK');await pending?.catch(()=>undefined);}
 assert.equal((await activity(f)).version,String(BigInt(before.version)+2n));assert.equal((await evidence(f)).operations.length,1);
});
test('stale owner and restricted web grants cannot create or forge an admission',async()=>{
 const f=await fixture('16 minutes'),saved=await evidence(f);
 await assert.rejects(request(f,randomUUID(),randomUUID()),e=>e.code==='42501');
 for(const text of ['SELECT * FROM crest_private.operations','SELECT * FROM crest_private.export_jobs','SET ROLE crest_command_owner'])await assert.rejects(web.query(text),e=>e.code==='42501');
 assert.deepEqual(await evidence(f),saved);assert.equal((await client.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,43);
});
