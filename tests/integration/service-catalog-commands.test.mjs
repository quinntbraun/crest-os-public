// Actual disposable PostgreSQL and official Auth DDL. No app/HTTP activation.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {testDatabaseConnection} from '../../src/tooling/test-database.ts';
import {parseServiceDefinition} from '../../src/commercial/service-catalog.ts';

const sql=await readFile(new URL('../../planning/proposals/service-catalog-commands.sql',import.meta.url),'utf8');
const meta=JSON.parse(await readFile(new URL('../../planning/proposals/service-catalog-commands.json',import.meta.url),'utf8'));
const schema=await readFile(new URL('../../planning/proposals/service-catalog-storage.sql',import.meta.url),'utf8');
const issuer='https://auth.example.com/auth/v1';
let sandbox,target,client,web,web2,login,bootstrap,a,b,prior,source,installed=false;
const d=(patch={})=>({name:'Synthetic interior',inclusions:'Vacuum.\nApplicable leather care.',exclusions:'No exterior protection or odor guarantee.',internalGuidance:'Synthetic private guidance',rangeLowCents:'10000',rangeHighCents:'15000',estimatedSeconds:'5430',...patch});
const body=(patch={})=>({code:'sample-'+randomUUID(),active:true,definition:d(),...patch});
const request=(patch={})=>({operation:randomUUID(),service:randomUUID(),revision:'0',schema:1,body:body(),...patch});
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,f.deadline??new Date(Date.now()+300000),f.business];
const value=(c,q,args=[])=>c.query(q,args).then(r=>r.rows[0].value);
const scalar=(q,args=[])=>value(client,q,args);
const save=(f,r=request(),c=web)=>value(c,'SELECT crest_commands.save_service($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,r.operation,r.schema,r.service,r.revision,r.body]);
const lookup=(f,id,c=web)=>value(c,'SELECT crest_commands.lookup_service_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),id]);
const directory=(f,{search='',after=null,inactive=false,size=50,c=web}={})=>value(c,'SELECT crest_commands.read_service_directory($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),search,after,inactive,size]);
const history=(f,id,{after='0',size=20,c=web}={})=>value(c,'SELECT crest_commands.read_service_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),id,after,size]);
const edit=(r,revision,patch={})=>request({service:r.service,revision,body:{...r.body,...patch}});
async function transaction(run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}}
async function extraSession(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=await scalar("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic catalog owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(async()=>{
  const business=await scalar("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic catalog business','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);
  await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);
  const epoch=await scalar("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return{business,epoch,subject,actor};
 });
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return extraSession(f);
}
// Compare SQL text, retaining bigint and microsecond precision in every field.
const evidence=f=>scalar("SELECT jsonb_build_object('services',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM crest.services s WHERE business_id=$1),'content',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.service_versions v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM crest_private.operations o WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM crest_private.audit_events a WHERE business_id=$1),'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM crest_private.app_sessions s WHERE actor_id=$2))::text AS value",[f.business,f.actor]);
const activity=f=>scalar('SELECT jsonb_build_object(\'version\',version::text,\'at\',last_active_at)::text AS value FROM crest_private.app_sessions WHERE id=$1',[f.session]);
const definitions=()=>client.query("SELECT p.oid::text,pg_get_functiondef(p.oid) AS definition,p.proowner::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY p.oid").then(r=>r.rows);
async function guard(setup,message='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED'){
 await client.query('BEGIN');try{await setup();await assert.rejects(client.query(sql),e=>e.code==='42501'&&e.message===message);}finally{await client.query('ROLLBACK');}
 assert.equal(await scalar("SELECT to_regprocedure('crest_commands.save_service(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NULL AS value"),true);
}
async function blocked(c,serviceId,run,change){
 const pid=await value(c,'SELECT pg_backend_pid() AS value');
 await client.query('BEGIN');await client.query('SELECT 1 FROM crest.services WHERE id=$1 FOR UPDATE',[serviceId]);
 const pending=run();pending.catch(()=>{});
 try{let waiting=false;for(let i=0;i<100;i++){if(await scalar("SELECT wait_event_type='Lock' AS value FROM pg_stat_activity WHERE pid=$1",[pid])){waiting=true;break;}await delay(20);}assert(waiting,'command reached the real service row lock');await change();await client.query('COMMIT');return await pending;}
 finally{await client.query('ROLLBACK');await pending.catch(()=>{});}
}
async function race(one,two){
 const pids=await Promise.all([web,web2].map(c=>value(c,'SELECT pg_backend_pid() AS value')));
 await client.query('BEGIN');await client.query('SELECT 1 FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[a.business]);
 const pending=Promise.all([one(),two()]);pending.catch(()=>{});
 try{let waiting=false;for(let i=0;i<100;i++){if(await scalar("SELECT count(*)=2 AS value FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])){waiting=true;break;}await delay(20);}assert(waiting,'both independent commands reached authority locks');await client.query('COMMIT');return await pending;}
 finally{await client.query('ROLLBACK');await pending.catch(()=>{});}
}

before(async()=>{
 assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);
 assert.equal(createHash('sha256').update(schema).digest('hex'),meta.requiredSchemaSqlSha256);
 // Refusal occurs before ownership tracking: cleanup must never adopt another operator's role.
 const probe=new pg.Client({connectionString:testDatabaseConnection(process.env.CREST_ENV,process.env.CREST_TEST_DATABASE_URL),connectionTimeoutMillis:5000});await probe.connect();
 try{for(const role of ['crest_catalog_integrity_owner','crest_catalog_owner']){
  assert.equal((await probe.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);
  await probe.query('CREATE ROLE '+role+' NOLOGIN NOINHERIT');try{await assert.rejects(migrationSandbox(),/refuse to adopt\/drop other operators/);assert.equal((await probe.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,1);}finally{await probe.query('DROP ROLE '+role);}
 }}finally{await probe.end();}
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=(await sandbox.apply(target,await sandbox.prefix(43))).history;
 await transaction(()=>client.query(schema));await sandbox.apply(target,await sandbox.prefix(43));source=await definitions();
 bootstrap=await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

for(const pin of meta.existingFunctionBodies)test('preflight rejects changed search path: '+pin.signature,()=>guard(()=>client.query('ALTER FUNCTION '+pin.signature+' SET search_path=public')));
test('preflight rejects changed source body',()=>guard(async()=>{
 const current=await scalar("SELECT pg_get_functiondef('crest_private.service_definition(crest.service_versions)'::regprocedure) AS value");
 await client.query(current.replace('jsonb_build_object(',"jsonb_build_object('tampered',true,"));
}));
test('preflight refuses unsafe command-owner login',()=>guard(()=>client.query('CREATE ROLE crest_catalog_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'),'CREST_CATALOG_COMMAND_ROLE_REVIEW_REQUIRED'));
for(const role of ['crest_schema_owner','crest_session_owner'])test('preflight rejects effective PUBLIC defaults: '+role,()=>guard(async()=>{
 await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE '+role+' GRANT EXECUTE ON FUNCTIONS TO PUBLIC');
 assert.equal(await scalar('SELECT count(*)::int AS value FROM pg_default_acl WHERE defaclrole=$1::regrole AND defaclnamespace=0 AND defaclobjtype=\'f\'',[role]),0);
}));
test('preflight refuses disabled forced RLS',()=>guard(()=>client.query('ALTER TABLE crest.service_versions NO FORCE ROW LEVEL SECURITY')));
test('preflight refuses disabled deferred audit enforcement',()=>guard(()=>client.query('ALTER TABLE crest.services DISABLE TRIGGER service_audit')));
test('preflight refuses missing typed current-content foreign key',()=>guard(()=>client.query('ALTER TABLE crest.services DROP CONSTRAINT service_current_version')));
test('command proposal installs without changing registered43 or existing function definitions',async()=>{
 await transaction(()=>client.query(sql));installed=true;
 assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(43))).history,prior);
 const now=await definitions();for(const f of source)assert.deepEqual(now.find(n=>n.oid===f.oid),f);
 login='crest_catalog_command_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2])await c.query("SET ROLE crest_web; SET lock_timeout='3s'");
},{timeout:240000});

test('web receives four typed RPCs, no raw source, session or private helper access',async()=>{
 assert(installed);for(const table of ['crest.services','crest.service_versions','crest_private.operations','crest_private.app_sessions'])for(const q of ['SELECT * FROM '+table,'DELETE FROM '+table,'TRUNCATE '+table])await assert.rejects(web.query(q),e=>e.code==='42501');
 for(const role of ['crest_catalog_owner','crest_catalog_integrity_owner']){
  assert.equal(await scalar('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL AS value FROM pg_roles WHERE rolname=$1',[role]),false);
  await assert.rejects(web.query('SET ROLE '+role),e=>e.code==='42501');
 }
 for(const signature of ['crest_private.valid_service_payload(jsonb)','crest_private.catalog_operation_result(uuid,uuid,uuid)','crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'])assert.equal(await scalar("SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[signature]),false);
 for(const privilege of ['UPDATE','DELETE','TRUNCATE'])assert.equal(await scalar("SELECT has_table_privilege('crest_catalog_owner','crest.service_versions',$1) AS value",[privilege]),false);
 for(const table of ['crest_private.actors','crest_private.app_sessions','crest.memberships'])assert.equal(await scalar("SELECT has_any_column_privilege('crest_catalog_owner',$1,'INSERT,UPDATE') AS value",[table]),false);
});
test('create commits root, retained scope, two exact audits and one session activity update',async()=>{
 const r=request(),before=JSON.parse(await activity(a)),result=await save(a,r);
 assert.equal(result.state,'committed');assert.equal(result.receipt.serviceId,r.service);assert.equal(result.receipt.serviceRevision,'1');assert.equal(result.receipt.contentSequence,'1');
 const h=await history(a,r.service);assert.equal(h.history.length,1);assert.equal(h.history[0].before,null);assert.deepEqual(h.history[0].after,h.service);
 const content=await scalar('SELECT crest_private.service_definition(v) AS value FROM crest.service_versions v WHERE id=$1',[result.receipt.contentVersionId]);assert.deepEqual(parseServiceDefinition(content),r.body.definition);
 assert.equal(await scalar('SELECT count(*)::int AS value FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2',[a.business,r.operation]),2);
 assert.equal(BigInt(JSON.parse(await activity(a)).version),BigInt(before.version)+1n);assert.deepEqual(await lookup(a,r.operation),result);
});
test('original receipts survive scope edits, archive and reopen without extra content versions',async()=>{
 const r=request(),first=await save(a,r),second=edit(r,'1',{definition:d({inclusions:'Revised scope',rangeLowCents:null,rangeHighCents:null})}),v2=await save(a,second);
 const archived=edit(second,'2',{active:false}),v3=await save(a,archived),reopened=edit(archived,'3',{active:true}),v4=await save(a,reopened);
 assert.equal(v2.receipt.contentSequence,'2');for(const v of [v3,v4]){assert.equal(v.receipt.contentVersionId,v2.receipt.contentVersionId);assert.equal(v.receipt.contentAuditEventId,null);}
 const h=await history(a,r.service);assert.deepEqual(h.history.map(e=>e.action),['create','edit','archive','reopen']);assert.deepEqual(h.history.map(e=>e.content.sequence),['1','2','2','2']);
 for(let i=1;i<h.history.length;i++)assert.deepEqual(h.history[i].before,h.history[i-1].after);
 const sources=await scalar('SELECT jsonb_agg(to_jsonb(v) ORDER BY id)::text AS value FROM crest.service_versions v WHERE service_id=$1',[r.service]);
 assert.deepEqual(await save(a,r),first);assert.deepEqual(await lookup(a,r.operation),first);assert.deepEqual(await lookup(a,second.operation),v2);
 assert.equal(await scalar('SELECT jsonb_agg(to_jsonb(v) ORDER BY id)::text AS value FROM crest.service_versions v WHERE service_id=$1',[r.service]),sources);
 const page=await history(a,r.service,{size:2});assert.equal(page.hasMore,true);assert.deepEqual(page.history.map(e=>e.revision),['1','2']);
 const rest=await history(a,r.service,{after:'2',size:2});assert.equal(rest.hasMore,false);assert.deepEqual(rest.history.map(e=>e.revision),['3','4']);
 for(const e of h.history)assert.match(e.at,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
});
test('unchanged submit leaves no operation, audit, source or session activity',async()=>{
 const r=request();await save(a,r);const same=edit(r,'1'),before=await evidence(a);
 assert.deepEqual(await save(a,same),{state:'unchanged',serviceId:r.service,currentRevision:'1'});assert.equal(await evidence(a),before);assert.deepEqual(await lookup(a,same.operation),{state:'absent'});
});
test('stale revision and stable code conflicts roll back their claims and activity',async()=>{
 const r=request();await save(a,r);for(const bad of [edit(r,'0'),edit(r,'1',{code:'different-'+randomUUID()})]){
  const before=await evidence(a),v=await save(a,bad);assert.equal(v.state,'conflict');assert.equal(v.reason,bad.revision==='0'?'version':'code');assert.equal(await evidence(a),before);assert.deepEqual(await lookup(a,bad.operation),{state:'absent'});
 }
});
test('duplicate code is scoped to business and never leaves a partial service',async()=>{
 const r=request();await save(a,r);const before=await evidence(a);assert.deepEqual(await save(a,request({body:r.body})),{state:'conflict',reason:'code'});assert.equal(await evidence(a),before);assert.equal((await save(b,request({body:r.body}))).state,'committed');
});
test('same original operation refuses changed payload, service or expected revision',async()=>{
 const r=request();await save(a,r);for(const bad of [{...r,body:{...r.body,definition:d({name:'Changed'})}},{...r,service:randomUUID()},{...r,revision:'1'}]){const before=await evidence(a);assert.deepEqual(await save(a,bad),{state:'conflict',reason:'operation'});assert.equal(await evidence(a),before);}
});
test('another workflow operation cannot be claimed as a service save',async()=>{
 const r=request();await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'crm.customer.save',1,$4,$5,$3,'manual')",[a.business,r.operation,a.actor,a.epoch,'a'.repeat(64)]);
 const before=await evidence(a);assert.deepEqual(await save(a,r),{state:'conflict',reason:'operation'});assert.equal(await evidence(a),before);assert.deepEqual(await lookup(a,r.operation),{state:'absent'});
});

const invalid=[['blank name',{definition:d({name:'\u00a0'})}],['blank scope',{definition:d({inclusions:' '})}],['number cents',{definition:d({rangeLowCents:100})}],['leading zero',{definition:d({rangeLowCents:'01'})}],['exponent',{definition:d({rangeLowCents:'1e2'})}],['trailing newline',{definition:d({rangeLowCents:'100\n'})}],['overflow',{definition:d({rangeLowCents:'9223372036854775808'})}],['negative',{definition:d({rangeLowCents:'-1'})}],['inverted',{definition:d({rangeLowCents:'20000'})}],['upper only',{definition:d({rangeLowCents:null})}],['zero duration',{definition:d({estimatedSeconds:'0'})}],['unknown field',{unexpected:true}],['unknown definition',{definition:{...d(),unexpected:true}}],['invalid code',{code:'bad code'}],['code newline',{code:'bad\n'}],['over budget',{definition:d({inclusions:'x'.repeat(4001)})}]];
for(const [label,patch] of invalid)test('malformed '+label+' is refused before claiming an operation',async()=>{
 const before=await evidence(a);await assert.rejects(save(a,request({body:body(patch)})),e=>e.code==='22023');assert.equal(await evidence(a),before);
});
test('optional, zero, lower-only and bigint maximum estimates stay exact',async()=>{
 for(const patch of [{internalGuidance:null,rangeLowCents:null,rangeHighCents:null,estimatedSeconds:null},{rangeLowCents:'0',rangeHighCents:'0',estimatedSeconds:'1'},{rangeLowCents:'0',rangeHighCents:null},{rangeLowCents:'9223372036854775807',rangeHighCents:'9223372036854775807',estimatedSeconds:'9223372036854775807'}]){
  const r=request({body:body({definition:d(patch)})}),v=await save(a,r);assert.equal(v.state,'committed');assert.deepEqual(await scalar('SELECT crest_private.service_definition(v) AS value FROM crest.service_versions v WHERE id=$1',[v.receipt.contentVersionId]),parseServiceDefinition(r.body.definition));assert.deepEqual(await lookup(a,r.operation),v);
 }
});
test('directory literal matching, UUID pagination and inactive selection do not extend activity',async()=>{
 const f=await state(),requests=[request({body:body({definition:d({name:'Literal %_ work'})})}),request(),request({body:body({active:false})})];for(const r of requests)await save(f,r);
 const before=await evidence(f),literal=await directory(f,{search:'%_'});assert.equal(literal.services.length,1);assert.equal(literal.services[0].service.id,requests[0].service);
 const first=await directory(f,{size:1}),second=await directory(f,{size:1,after:first.services[0].service.id});assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.notEqual(first.services[0].service.id,second.services[0].service.id);
 assert.equal((await directory(f,{inactive:true})).services.length,3);assert.equal((await directory(f,{search:'unmatched'})).services.length,0);assert.equal(await evidence(f),before);
});
for(const size of [0,51])test('directory rejects invalid page size '+size,async()=>{await assert.rejects(directory(a,{size}),e=>e.code==='22023');});
test('history refuses excessive size and negative cursor',async()=>{for(const options of [{size:21},{after:'-1'}])await assert.rejects(history(a,randomUUID(),options),e=>e.code==='22023');});
test('fresh credentials scope reads, writes and lookup despite forged context settings',async()=>{
 const r=request();await save(a,r);await web.query("SELECT set_config('crest.business_id',$1,false),set_config('crest.actor_id',$2,false),set_config('crest.operation_id',$3,false)",[a.business,a.actor,r.operation]);
 assert.deepEqual(await history(b,r.service),{state:'absent'});assert.deepEqual(await lookup(b,r.operation),{state:'absent'});
 const before=await evidence(a),bad={...a,hash:randomBytes(32)};assert.deepEqual(await save(bad,request()),{state:'denied'});await assert.rejects(directory(bad),e=>e.code==='42501');assert.equal(await evidence(a),before);
 await assert.rejects(directory({...a,business:b.business}),e=>e.code==='42501');
});
test('paused recovery blocks new writes and replay but permits scoped history and original lookup',async()=>{
 const r=request(),v=await save(a,r);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[a.business]);
 try{const before=await evidence(a);for(const q of [r,request()])await assert.rejects(save(a,q),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await lookup(a,r.operation),v);assert.equal((await history(a,r.service)).service.id,r.service);assert.equal(await evidence(a),before);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[a.business]);}
 await assert.rejects(save({...a,epoch:randomUUID()},request()),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');
});
test('provider AAL downgrade refuses mutation and read until restored',async()=>{
 await client.query("UPDATE auth.sessions SET aal='aal1' WHERE id=$1",[a.provider]);try{const before=await evidence(a);assert.deepEqual(await save(a,request()),{state:'denied'});await assert.rejects(directory(a),e=>e.code==='42501');assert.equal(await evidence(a),before);}finally{await client.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[a.provider]);}
});
test('same revision race commits one edit and rolls back the stale claimant',async()=>{
 const r=request();await save(a,r);const other=await extraSession(a),one=edit(r,'1',{definition:d({name:'First contender'})}),two=edit(r,'1',{definition:d({name:'Second contender'})});
 const before=[await activity(a),await activity(other)],results=await race(()=>save(a,one),()=>save(other,two,web2));assert.deepEqual(results.map(r=>r.state).sort(),['committed','conflict']);
 const loser=results[0].state==='conflict'?one:two;assert.deepEqual(await lookup(a,loser.operation),{state:'absent'});assert.equal((await history(a,r.service)).history.length,2);
 const loserIndex=results[0].state==='conflict'?0:1;assert.equal(await activity(loserIndex===0?a:other),before[loserIndex]);
});
test('concurrent duplicate operation from separate valid sessions returns one original receipt',async()=>{
 const other=await extraSession(a),r=request(),results=await race(()=>save(a,r),()=>save(other,r,web2));assert.equal(results[0].state,'committed');assert.deepEqual(results[0],results[1]);assert.equal((await history(a,r.service)).history.length,1);
});
test('provider session loss while waiting on the service row leaves no partial save or activity',async()=>{
 const f=await extraSession(a),r=request();await save(f,r);const before=await evidence(a);await assert.rejects(blocked(web,r.service,()=>save(f,edit(r,'1',{definition:d({name:'After wait'})})),()=>client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider])),e=>e.code==='42501');assert.equal(await evidence(a),before);
});
test('expired provider deadline after lock wait leaves no partial save or activity',async()=>{
 const r=request();await save(a,r);const f={...a,deadline:new Date(Date.now()+500)},before=await evidence(a);await assert.rejects(blocked(web,r.service,()=>save(f,edit(r,'1',{definition:d({name:'After deadline'})})),()=>delay(650)),e=>e.code==='42501');assert.equal(await evidence(a),before);
});
test('deferred COMMIT rejection rolls back a provisional receipt, source, audit and session activity',async()=>{
 const r=request(),before=await evidence(a);
 await client.query("CREATE FUNCTION public.crest_catalog_commit_probe() RETURNS trigger LANGUAGE plpgsql AS $probe$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic deferred refusal'; END $probe$");
 await client.query('CREATE CONSTRAINT TRIGGER crest_catalog_commit_probe AFTER INSERT OR UPDATE ON crest.services DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.crest_catalog_commit_probe()');
 try{await web.query('BEGIN');assert.equal((await save(a,r)).state,'committed');await assert.rejects(web.query('COMMIT'),e=>e.code==='23514');assert.equal(await evidence(a),before);assert.deepEqual(await lookup(a,r.operation),{state:'absent'});}finally{await web.query('ROLLBACK');await client.query('DROP TRIGGER crest_catalog_commit_probe ON crest.services');await client.query('DROP FUNCTION public.crest_catalog_commit_probe()');}
});
