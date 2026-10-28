// Actual disposable registered44 + provider DDL + restricted web role. This
// proves trusted database commands, not genuine HTTP/MFA or production use.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {prepareQuoteContent} from '../../src/commercial/quote-content.ts';
const sql=await readFile(new URL('../../planning/proposals/quote-draft-commands.sql',import.meta.url),'utf8'),meta=JSON.parse(await readFile(new URL('../../planning/proposals/quote-draft-commands.json',import.meta.url),'utf8'));
const schema=await readFile(new URL('../../planning/proposals/quote-draft-storage.sql',import.meta.url),'utf8'),pricing=await readFile(new URL('../../planning/proposals/quote-pricing.sql',import.meta.url),'utf8');
const issuer='https://auth.example.com/auth/v1';let sandbox,target,client,web,web2,login,bootstrap,a,b,prior,source,base44;
const value=(c,query,parameters=[])=>c.query(query,parameters).then(result=>result.rows[0].value),scalar=(query,parameters=[])=>value(client,query,parameters);
async function transaction(run){await client.query('BEGIN');try{const result=await run();await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,f.deadline??new Date(Date.now()+300000),f.business];
const line=(grossCents)=>({id:randomUUID(),vehicleId:null,jobWide:true,vehicleLabel:null,serviceVersionId:null,description:'Synthetic job-wide service',inclusions:'Explicit synthetic scope',exclusions:'Exterior protection excluded',condition:'Moderate',grossCents,lineDiscount:null,documentDiscountEligible:true,complimentaryReason:null});
const draft=f=>({schemaVersion:1,title:'Synthetic quote',recipient:{customerId:f.customer,leadId:null,displayName:'Synthetic quote recipient',phone:null,email:null},workLocation:'Synthetic workshop',terms:'',timezone:'UTC',expiryAt:null,proposedSchedule:null,internalNotes:'Private synthetic guidance',documentDiscount:{kind:'fixed',cents:'2500'},lines:[line('25000'),line('30000')]});
function request(f,patch={}){const input=patch.input??draft(f);return {input,operation:randomUUID(),family:randomUUID(),revision:randomUUID(),familyVersion:'0',revisionVersion:'0',schema:1,body:prepareQuoteContent(input),...patch};}
const edit=(f,original,receipt,patch={})=>request(f,{input:{...original.input,...patch},family:original.family,revision:original.revision,familyVersion:receipt.familyVersion,revisionVersion:receipt.revisionVersion});
const save=(f,r=request(f),c=web)=>value(c,'SELECT crest_commands.save_quote_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS value',[...auth(f),f.epoch,r.operation,r.schema,r.family,r.revision,r.familyVersion,r.revisionVersion,r.body]);
const lookup=(f,operation,c=web)=>value(c,'SELECT crest_commands.lookup_quote_draft_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),operation]);
const directory=(f,{search='',after=null,size=50,c=web}={})=>value(c,'SELECT crest_commands.read_quote_draft_directory($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),search,after,size]);
const history=(f,r,{after='0',size=5,c=web}={})=>value(c,'SELECT crest_commands.read_quote_draft_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),r.family,r.revision,after,size]);
const evidence=f=>scalar("SELECT jsonb_build_object('families',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_families v WHERE business_id=$1),'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_revisions v WHERE business_id=$1),'items',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest.quote_items v WHERE business_id=$1),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.operations v WHERE business_id=$1),'audit',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY id),'[]') FROM crest_private.audit_events v WHERE business_id=$1))::text AS value",[f.business]);
const activity=f=>scalar("SELECT jsonb_build_object('version',version::text,'at',last_active_at)::text AS value FROM crest_private.app_sessions WHERE id=$1",[f.session]);
const definitions=()=>client.query("SELECT p.oid::text,pg_get_functiondef(p.oid) AS definition,p.proowner::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') ORDER BY p.oid").then(result=>result.rows);
async function extraSession(f){const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);return {...f,provider,session,hash};}
async function state(){
 const subject=randomUUID(),actor=await scalar("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic quote owner',$1,$2,$3,$3,'manual') RETURNING id AS value",[issuer,subject,bootstrap]);
 const f=await transaction(async()=>{const business=await scalar("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic quote business','UTC',$1,$1,'manual') RETURNING id AS value",[actor]);await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);const epoch=await scalar("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch AS value",[business,actor]);return {business,actor,subject,epoch};});
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,`synthetic-${subject}@example.com`]);const ready=await extraSession(f);ready.customer=randomUUID();ready.customerOperation=randomUUID();const result=await scalar('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS value',[...auth(ready),ready.epoch,ready.customerOperation,1,ready.customer,'0',{displayName:'Synthetic quote recipient',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}]);assert.equal(result.state,'committed');return ready;
}
async function guard(setup,message='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED'){
 await client.query('BEGIN');try{await setup();await assert.rejects(client.query(sql),error=>error.code==='42501'&&error.message===message);}finally{await client.query('ROLLBACK');}
 assert.equal(await scalar("SELECT to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') IS NULL AS value"),true);
}
async function race(one,two){
 const pids=await Promise.all([web,web2].map(c=>value(c,'SELECT pg_backend_pid() AS value')));await client.query('BEGIN');await client.query('SELECT 1 FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[a.business]);const pending=Promise.all([one(),two()]);pending.catch(()=>{});
 try{let waiting=false;for(let i=0;i<100;i++){if(await scalar("SELECT count(*)=2 AS value FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])){waiting=true;break;}await delay(20);}assert(waiting,'both devices reached the real authority lock');await client.query('COMMIT');return await pending;}finally{await client.query('ROLLBACK');await pending.catch(()=>{});}
}
before(async()=>{
 assert.equal(meta.registered,false);assert.equal(meta.runtimeEnabled,false);assert.equal(meta.existingMigrationCount,44);assert.equal(Buffer.byteLength(sql),meta.sqlBytes);assert.equal(createHash('sha256').update(sql).digest('hex'),meta.sqlSha256);assert.equal(createHash('sha256').update(schema).digest('hex'),meta.requiredSchemaSqlSha256);assert.equal(createHash('sha256').update(pricing).digest('hex'),meta.requiredPricingSqlSha256);
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);base44=await sandbox.prefix(44);prior=(await sandbox.apply(target,base44)).history;await transaction(()=>client.query(pricing));await transaction(()=>client.query(schema));await sandbox.apply(target,base44);source=await definitions();bootstrap=await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'");a=await state();b=await state();
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('preflight pins all source and authorization functions before granting any command access',async()=>{for(const pin of meta.existingFunctionBodies)await guard(()=>client.query('ALTER FUNCTION '+pin.signature+' SET search_path=public'));});
test('preflight refuses an unsafe quote command-owner login',()=>guard(()=>client.query('CREATE ROLE crest_quote_owner LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'),'CREST_QUOTE_COMMAND_ROLE_REVIEW_REQUIRED'));
test('preflight refuses a preexisting delete-only source grant without adopting the role',()=>guard(async()=>{await client.query('CREATE ROLE crest_quote_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');await client.query('GRANT DELETE ON crest.quote_items TO crest_quote_owner');},'CREST_QUOTE_COMMAND_ROLE_REVIEW_REQUIRED'));
test('preflight refuses disabled aggregate enforcement and typed family publication',async()=>{await guard(()=>client.query('ALTER TABLE crest.quote_revisions DISABLE TRIGGER quote_aggregate'));await guard(()=>client.query('ALTER TABLE crest.quote_families DROP CONSTRAINT quote_current_revision'));});
test('trusted commands install without altering registered44 or previous function definitions',async()=>{
 await transaction(()=>client.query(sql));assert.deepEqual((await sandbox.apply(target,base44)).history,prior);const now=await definitions();for(const row of source)assert.deepEqual(now.find(v=>v.oid===row.oid),row);
 login='crest_quote_command_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2])await c.query("SET ROLE crest_web; SET lock_timeout='3s'");
},{timeout:240000});
test('web receives only typed RPCs and cannot read/write source, private helpers or role authority',async()=>{
 for(const table of ['crest.quote_families','crest.quote_revisions','crest.quote_items','crest_private.operations','crest_private.app_sessions'])for(const command of ['SELECT * FROM ','DELETE FROM ','TRUNCATE '])await assert.rejects(web.query(command+table),error=>error.code==='42501');
 for(const role of ['crest_quote_owner','crest_quote_integrity_owner']){assert.equal(await scalar('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL AS value FROM pg_roles WHERE rolname=$1',[role]),false);await assert.rejects(web.query('SET ROLE '+role),error=>error.code==='42501');}
 for(const signature of ['crest_private.valid_quote_draft_payload(jsonb)','crest_private.quote_operation_result(uuid,uuid,uuid)','crest_commands.authorize_quote_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','crest_commands.finish_quote_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'])assert.equal(await scalar("SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[signature]),false);
 for(const table of ['crest_private.actors','crest_private.app_sessions','crest.memberships'])assert.equal(await scalar("SELECT has_any_column_privilege('crest_quote_owner',$1,'INSERT,UPDATE') AS value",[table]),false);
});
test('create/reload returns exact52500 cents, scoped receipt, history and genuine normalized items',async()=>{
 const q=request(a),saved=await save(a,q);assert.equal(saved.state,'committed');assert.equal(saved.receipt.familyVersion,'1');assert.equal(saved.receipt.revisionVersion,'1');assert.equal(saved.receipt.contentVersion,'1');assert.equal(saved.receipt.itemAuditEventIds.length,2);assert.equal(saved.receipt.contentHash,createHash('sha256').update(q.body.canonical).digest('hex'));
 const loaded=await history(a,q);assert.equal(loaded.revision.total_cents,'52500');assert.deepEqual(loaded.revision.customer_safe_snapshot,q.body.customer);assert.deepEqual(loaded.revision.internal_snapshot,q.body.internal);assert.deepEqual(loaded.items.map(row=>row.allocated_discount_cents),['1136','1364']);assert.equal(loaded.history.length,1);assert.equal(loaded.history[0].before,null);assert.equal(loaded.history[0].revision,'1');assert.deepEqual(await lookup(a,q.operation),saved);
});
test('replay remains the original immutable result after later edits and session activity advances only for saves',async()=>{
 const q=request(a),first=await save(a,q),changed=edit(a,q,first.receipt,{internalNotes:'Later private assumption'}),second=await save(a,changed);assert.equal(second.receipt.revisionVersion,'2');assert.equal(second.receipt.itemAuditEventIds.length,0);assert.notEqual(second.receipt.contentHash,first.receipt.contentHash);const before=await evidence(a);assert.deepEqual(await save(a,q),first);assert.deepEqual(await lookup(a,q.operation),first);assert.equal(await evidence(a),before);
 const page=await history(a,q,{size:1});assert.equal(page.hasMore,true);assert.equal(page.history[0].after.internal_snapshot.notes,q.input.internalNotes);const next=await history(a,q,{after:'1'});assert.equal(next.history[0].after.internal_snapshot.notes,'Later private assumption');assert.equal(next.history[0].before.content_hash,first.receipt.contentHash);
});
test('unchanged content creates no claim, audit, line rewrite or foreground activity',async()=>{
 const q=request(a),first=await save(a,q),same=edit(a,q,first.receipt),before=await evidence(a),session=await activity(a);assert.deepEqual(await save(a,same),{state:'unchanged',familyId:q.family,familyVersion:'1',revisionId:q.revision,revisionVersion:'1',contentHash:first.receipt.contentHash});assert.equal(await evidence(a),before);assert.equal(await activity(a),session);assert.deepEqual(await lookup(a,same.operation),{state:'absent'});
});
test('reordered, removed and reactivated lines retain physical IDs and all prior audit scope',async()=>{
 const q=request(a),first=await save(a,q),initial=await history(a,q),ids=new Map(initial.items.map(row=>[row.stable_line_key,row.id]));const reversed=edit(a,q,first.receipt,{lines:[q.input.lines[1],q.input.lines[0]]}),r2=await save(a,reversed);assert.equal(r2.state,'committed');let loaded=await history(a,q);assert.deepEqual(loaded.items.map(row=>row.id),[ids.get(q.input.lines[1].id),ids.get(q.input.lines[0].id)]);
 const removed=edit(a,reversed,r2.receipt,{lines:[q.input.lines[1]],documentDiscount:null}),r3=await save(a,removed);loaded=await history(a,q);assert.equal(loaded.items.length,2);assert.equal(loaded.items.filter(row=>row.active).length,1);assert.equal(loaded.items.find(row=>!row.active).position,null);
 const restored=edit(a,q,r3.receipt),r4=await save(a,restored);loaded=await history(a,q);assert.equal(r4.state,'committed');assert.deepEqual(loaded.items.map(row=>row.id),initial.items.map(row=>row.id));assert(loaded.items.every(row=>row.active));assert.equal(loaded.history.length,4);
});
test('a stale edit or operation payload collision does not leave a new claim or source change',async()=>{
 const q=request(a),saved=await save(a,q),changed=edit(a,q,saved.receipt,{terms:'Synthetic changed terms'});await save(a,changed);const before=await evidence(a);assert.deepEqual(await save(a,edit(a,q,saved.receipt,{terms:'Stale terms'})),{state:'conflict',reason:'version',currentFamilyVersion:'2',currentRevisionVersion:'2'});assert.deepEqual(await save(a,{...q,body:prepareQuoteContent({...q.input,title:'Different content under original operation'})}),{state:'conflict',reason:'operation'});assert.equal(await evidence(a),before);
});
test('collision with another command type cannot expose or overwrite its original result',async()=>{
 const before=await evidence(a);assert.deepEqual(await save(a,request(a,{operation:a.customerOperation})),{state:'conflict',reason:'operation'});assert.deepEqual(await lookup(a,a.customerOperation),{state:'absent'});assert.equal(await evidence(a),before);
});
test('foreign family/revision IDs and typed recipient references never cross tenant boundaries',async()=>{
 const foreign=request(b);await save(b,foreign);const before=await evidence(a);assert.deepEqual(await save(a,request(a,{family:foreign.family})),{state:'conflict',reason:'family'});assert.deepEqual(await save(a,request(a,{revision:foreign.revision})),{state:'conflict',reason:'revision'});assert.deepEqual(await history(a,foreign),{state:'absent'});assert.deepEqual(await lookup(a,foreign.operation),{state:'absent'});
 await assert.rejects(save(a,request(a,{input:{...draft(a),recipient:{customerId:b.customer,leadId:null,displayName:'Synthetic foreign recipient',phone:null,email:null}}})),error=>error.code==='22023'&&error.message==='CREST_QUOTE_REFERENCE_REQUIRED');assert.equal(await evidence(a),before);
});
test('malformed envelopes, forged totals and leaked private fields are refused before a claim',async()=>{
 const q=request(a),before=await evidence(a);for(const body of [{...q.body,extra:true},{...q.body,canonical:'not JSON'},{...q.body,customer:{...q.body.customer,totalCents:'1'}},{...q.body,customer:{...q.body.customer,privateNotes:'Forbidden'}}])await assert.rejects(save(a,{...q,operation:randomUUID(),body}),error=>error.code==='22023'&&error.message==='CREST_QUOTE_INPUT_REQUIRED');
 for(const patch of [{schema:2},{familyVersion:'0',revisionVersion:'1'},{familyVersion:'1',revisionVersion:'0'},{familyVersion:'-1'}])await assert.rejects(save(a,{...q,...patch}),error=>error.code==='22023');assert.equal(await evidence(a),before);
});
test('unreasoned zero work fails while an explicit complimentary reason records no fabricated money',async()=>{
 const input={...draft(a),documentDiscount:null,lines:[{...line('0'),complimentaryReason:'Synthetic goodwill'}]},q=request(a,{input}),saved=await save(a,q);assert.equal(saved.state,'committed');assert.equal((await history(a,q)).revision.total_cents,'0');const broken=structuredClone(q.body);broken.customer.lines[0].complimentaryReason=null;broken.canonical=JSON.stringify({schemaVersion:1,customer:broken.customer,internal:broken.internal});await assert.rejects(save(a,request(a,{body:broken})),error=>error.code==='22023');
});
test('paused recovery refuses saves but allows scoped original-result and retained-history review',async()=>{
 const q=request(a),saved=await save(a,q);await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[a.business]);
 try{
  const before=await evidence(a),session=await activity(a);
  // Recovery is an explicit authority fence, distinct from authentication denial.
  // The expected error must not prevent this case from exercising paused reads.
  for(const blocked of [q,request(a)])await assert.rejects(save(a,blocked),error=>error.code==='P0001'&&error.message==='RECOVERY_REVIEW_REQUIRED');
  assert.deepEqual(await lookup(a,q.operation),saved);assert.equal((await history(a,q)).revision.id,q.revision);assert((await directory(a)).quotes.some(row=>row.family.id===q.family));
  assert.equal(await evidence(a),before);assert.equal(await activity(a),session);
 }finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[a.business]);}
});
test('expired provider proof and a revoked session cannot submit or retrieve quote data',async()=>{
 const other=await extraSession(a),before=await evidence(a);assert.deepEqual(await save({...other,deadline:new Date(Date.now()-1000)},request(a)),{state:'denied'});await client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',[other.session]);assert.deepEqual(await save(other,request(a)),{state:'denied'});await assert.rejects(directory(other),error=>error.code==='42501');assert.equal(await evidence(a),before);
});
test('provider proof expiring during a real family-row wait rolls back the tentative save',async()=>{
 const q=request(a),saved=await save(a,q),changed=edit(a,q,saved.receipt,{terms:'Must roll back after proof expires'}),before=await evidence(a),session=await activity(a),pid=await value(web,'SELECT pg_backend_pid() AS value');
 await client.query('BEGIN');await client.query('SELECT 1 FROM crest.quote_families WHERE business_id=$1 AND id=$2 FOR UPDATE',[a.business,q.family]);const pending=save({...a,deadline:new Date(Date.now()+2000)},changed);pending.catch(()=>{});
 try{let waiting=false;for(let i=0;i<100;i++){if(await scalar("SELECT wait_event_type='Lock' AS value FROM pg_stat_activity WHERE pid=$1",[pid])){waiting=true;break;}await delay(20);}assert(waiting,'save reached the real family row lock');await delay(2100);await client.query('COMMIT');await assert.rejects(pending,error=>error.code==='42501');assert.equal(await evidence(a),before);assert.equal(await activity(a),session);}finally{await client.query('ROLLBACK');await pending.catch(()=>{});}
});
test('two devices racing distinct edits produce one committed revision and one explicit conflict',async()=>{
 const q=request(a),saved=await save(a,q),other=await extraSession(a),one=edit(a,q,saved.receipt,{terms:'Device one'}),two=edit(a,q,saved.receipt,{terms:'Device two'}),results=await race(()=>save(a,one,web),()=>save(other,two,web2));assert.equal(results.filter(row=>row.state==='committed').length,1);assert.equal(results.filter(row=>row.state==='conflict'&&row.reason==='version').length,1);assert.equal((await history(a,q)).revision.version,'2');
});
test('two devices replaying the same create converge on one receipt and one set of retained rows',async()=>{
 const q=request(a),other=await extraSession(a),results=await race(()=>save(a,q,web),()=>save(other,q,web2));assert.deepEqual(results[0],results[1]);assert.equal(results[0].state,'committed');const loaded=await history(a,q);assert.equal(loaded.items.length,2);assert.equal(loaded.history.length,1);
});
test('a deferred commit failure returns no receipt and rolls back source, audits, claims and activity',async()=>{
 await client.query("CREATE FUNCTION crest_private.synthetic_quote_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SYNTHETIC_QUOTE_COMMIT_FAILED';END $$");await client.query('CREATE CONSTRAINT TRIGGER synthetic_quote_commit_fail AFTER INSERT ON crest.quote_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.synthetic_quote_commit_fail()');
 try{const before=await evidence(a),session=await activity(a);await assert.rejects(save(a,request(a)),error=>error.code==='23514'&&error.message==='SYNTHETIC_QUOTE_COMMIT_FAILED');assert.equal(await evidence(a),before);assert.equal(await activity(a),session);}finally{await client.query('DROP TRIGGER synthetic_quote_commit_fail ON crest.quote_revisions');await client.query('DROP FUNCTION crest_private.synthetic_quote_commit_fail()');}
});
test('directory search is literal and keyset/history pagination retain exact identifiers and microseconds',async()=>{
 const q=request(a,{input:{...draft(a),title:'Synthetic %_ literal quote',expiryAt:'2026-10-29T20:00:00.123456Z'}});await save(a,q);const match=await directory(a,{search:'%_'});assert.equal(match.quotes.length,1);assert.equal(match.quotes[0].revision.expiry_at,'2026-10-29T20:00:00.123456Z');const first=await directory(a,{size:1}),next=await directory(a,{size:1,after:first.quotes[0].family.id});assert.equal(first.hasMore,true);assert(next.quotes[0].family.id>first.quotes[0].family.id);assert.equal((await history(a,q)).revision.expiry_at,'2026-10-29T20:00:00.123456Z');
});
test('history enforces its bounded page size without omitting requested events',async()=>{
 const q=request(a);await save(a,q);for(const size of [0,6])await assert.rejects(history(a,q,{size}),error=>error.code==='22023'&&error.message==='CREST_QUOTE_INPUT_REQUIRED');for(const size of [1,5]){const page=await history(a,q,{size});assert.equal(page.history.length,1);assert.equal(page.hasMore,false);}
});
