// Unregistered39-to40 proposal proof; canonical migration bytes stay unchanged.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {leadAddressProposalSandbox as migrationSandbox} from '../support/lead-address-proposal.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {parseLeadAddressDraft} from '../../src/customer/lead-resource-contract.ts';
import {parseLeadAddress} from '../../src/customer/lead-address-contract.ts';
import {formatLeadAddressCsv} from '../../src/customer/lead-address-csv.ts';
import {decodeLeadAddressCsv} from '../support/lead-address-fixture.ts';
let sandbox,client,target,web,web2,exporter,login,loginOwned=false,bootstrap,a,b,prior,receipt,proposal,guardRefused=false;
const issuer='https://auth.example.com/auth/v1';
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const body=(patch={})=>({line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:null,longitude:null,geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null,...patch});
const request=(lead,patch={})=>({lead,id:randomUUID(),version:'0',operation:randomUUID(),draft:body(),...patch});
const save=(f,r,c=web)=>c.query('SELECT crest_commands.save_lead_address($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,r.operation,r.lead,r.id,r.version,r.draft]).then(r=>r.rows[0].value);
const lookup=(f,operation)=>web.query('SELECT crest_commands.lookup_lead_address_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),operation]).then(r=>r.rows[0].value);
const source=id=>client.query('SELECT crest_private.lead_address_projection(v) AS value FROM crest.lead_addresses v WHERE id=$1',[id]).then(r=>r.rows[0]?.value);
async function evidence(f){return {sources:(await client.query('SELECT to_jsonb(v) FROM crest.lead_addresses v WHERE business_id=$1 ORDER BY id',[f.business])).rows,operations:(await client.query('SELECT to_jsonb(o) FROM crest_private.operations o WHERE business_id=$1 ORDER BY id',[f.business])).rows,audits:(await client.query('SELECT to_jsonb(a) FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY id',[f.business])).rows};}
async function session(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic lead address owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic lead address business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session({business,epoch,subject,actor});
}
async function lead(f){
 const id=randomUUID(),draft={label:'Synthetic incomplete lead',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null};
 const result=(await web.query('SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth(f),f.epoch,randomUUID(),id,draft])).rows[0].value;assert.equal(result.state,'committed');return id;
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(39));proposal=await sandbox.prefix(40);
 // Cluster roles are shared. Bootstrap both isolated histories before creating
 // the disposable web login; never grant or adopt a mutable domain owner.
 const guard=await sandbox.database(),guardClient=await sandbox.connect(guard);await sandbox.apply(guard,await sandbox.prefix(0),true);await installProviderSchema(guardClient,guard);await sandbox.apply(guard,await sandbox.prefix(39));
 await client.query('ALTER ROLE crest_lead_owner LOGIN');try{await assert.rejects(sandbox.apply(guard,proposal),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await guardClient.query("SELECT to_regclass('crest.lead_addresses') AS value")).rows[0].value,null);guardRefused=true;}finally{await client.query('ALTER ROLE crest_lead_owner NOLOGIN');}
 receipt=await sandbox.apply(target,proposal);
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;a=await state();b=await state();
 login='crest_lead_address_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");loginOwned=true;await sandbox.admin.query('GRANT crest_web,crest_export TO '+login);
 const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());exporter=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}await exporter.query('SET ROLE crest_export');
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();await exporter?.end();if(loginOwned)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('39-to40 proposal preserves all39 earlier migration hashes, refuses unsafe reused owners and applies idempotently',async()=>{assert(guardRefused);assert.equal(prior.history.length,39);assert.equal(receipt.history.length,40);assert.deepEqual(receipt.history.slice(0,39),prior.history);assert.deepEqual((await sandbox.apply(target,proposal)).history,receipt.history);});
test('forced RLS and closed domain owners deny raw web/export mutation and private verification',async()=>{
 assert.equal((await client.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_addresses'::regclass")).rows[0].yes,true);
 for(const sql of ['SELECT * FROM crest.lead_addresses','DELETE FROM crest.lead_addresses','TRUNCATE crest.lead_addresses',"UPDATE crest.lead_addresses SET instructions='forged'"])await assert.rejects(web.query(sql),e=>e.code==='42501');
 for(const role of ['crest_lead_owner','crest_lead_integrity_owner']){await assert.rejects(web.query('SET ROLE '+role),e=>e.code==='42501');assert.equal((await client.query('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolconfig IS NOT NULL AS bad FROM pg_roles WHERE rolname=$1',[role])).rows[0].bad,false);assert.equal((await client.query("SELECT has_table_privilege('crest_export','crest.lead_addresses','SELECT') AS yes")).rows[0].yes,false);}
 await assert.rejects(web.query('SELECT crest_private.lead_address_operation_result($1,$2,$3)',[a.business,a.actor,randomUUID()]),e=>e.code==='42501');
});
test('incomplete locations, exact decimal coordinates and original notes commit without a customer or Won outcome',async()=>{
 const parent=await lead(a),r=request(parent,{draft:body({line1:'',exactLocationText:'  É 😀 \nBehind the barn',instructions:'\tOriginal\n=SUM(A1)',latitude:'-89.00000000000000000001',longitude:'180.00000000000000000000',geocodeSource:'Owner entered',geocodeAccuracy:'Reported only',verifiedAt:'2026-10-25T01:02:03.123456Z'})}),first=await save(a,r);assert.equal(first.state,'committed');assert.deepEqual(await lookup(a,r.operation),first);
 const before=await source(r.id);assert.equal(before.line1,'');assert.equal(before.exact_location_text,r.draft.exactLocationText);assert.equal(before.latitude,r.draft.latitude);assert.equal(before.longitude,r.draft.longitude);assert.equal(before.verified_at,r.draft.verifiedAt);assert.equal(before.lead_id,parent);
 const next={...r,version:'1',operation:randomUUID(),draft:{...r.draft,instructions:'Updated original report'}};assert.equal((await save(a,next)).state,'committed');const after=await source(r.id);
 assert.deepEqual((await client.query('SELECT state,customer_id,version::text FROM crest.leads WHERE id=$1',[parent])).rows[0],{state:'new',customer_id:null,version:'1'});
 assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customers WHERE business_id=$1',[a.business])).rows[0].n,0);assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.addresses WHERE business_id=$1',[a.business])).rows[0].n,0);
 const audits=(await client.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='lead_addresses' AND entity_id=$1 ORDER BY entity_version",[r.id])).rows;assert.equal(audits.length,2);assert.deepEqual(audits[0].delta.before,null);assert.deepEqual(audits[0].delta.after,before);assert.deepEqual(audits[1].delta.before,before);assert.deepEqual(audits[1].delta.after,after);
});
test('original replay survives later edits/archive/reopen while payload/lead/reference substitutions fail',async()=>{
 const parent=await lead(a),r=request(parent),first=await save(a,r);for(const [version,draft] of [['1',body({archived:true,archiveReason:'  Retained reason 😀  '})],['2',body({instructions:'Later original intake'})]])assert.equal((await save(a,{...r,version,operation:randomUUID(),draft})).state,'committed');
 const retained=await evidence(a);assert.deepEqual(await save(a,r),first);assert.deepEqual(await lookup(a,r.operation),first);for(const patch of [{id:randomUUID()},{lead:randomUUID()},{version:'1'},{draft:body({instructions:'Changed request'})}])assert.deepEqual(await save(a,{...r,...patch}),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(a),retained);
});
test('signed zero retains exact decimal scale, original replay and archive timestamps across later archived edits',async()=>{
 const parent=await lead(a),r=request(parent,{draft:body({latitude:'-0.00000000000000000000',longitude:'-0.0'})}),first=await save(a,r);
 assert.equal(first.state,'committed');const initial=await source(r.id);assert.equal(initial.latitude,'0.00000000000000000000');assert.equal(initial.longitude,'0.0');
 assert.deepEqual(await save(a,{...r,draft:parseLeadAddressDraft(r.draft)}),first);
 assert.deepEqual(await lookup(a,r.operation),first);
 const archived={...r,version:'1',operation:randomUUID(),draft:body({archived:true,archiveReason:'  Retained archive 😀  '})};assert.equal((await save(a,archived)).state,'committed');const stamp=(await source(r.id)).archived_at;
 assert.equal((await save(a,{...archived,version:'2',operation:randomUUID(),draft:{...archived.draft,instructions:'Later archived note'}})).state,'committed');assert.equal((await source(r.id)).archived_at,stamp);
 const retained=await source(r.id),other=await lead(a);await assert.rejects(client.query('UPDATE crest.lead_addresses SET lead_id=$1,version=version+1 WHERE id=$2',[other,r.id]),e=>e.code==='55000');
 for(const sql of ['DELETE FROM crest.lead_addresses WHERE id=$1','TRUNCATE crest.lead_addresses'])await assert.rejects(client.query(sql,sql.includes('$1')?[r.id]:[]),e=>e.code==='55000');
 await assert.rejects(client.query("UPDATE crest.lead_addresses SET instructions='forged',version=version+1 WHERE id=$1",[r.id]),e=>e.code==='23514');assert.deepEqual(await source(r.id),retained);
});
test('malformed, oversized and invented commercial/geocode data leave no operation claims',async()=>{
 const parent=await lead(a);for(const draft of [null,{},[],body({state:'won'}),body({customerId:randomUUID()}),body({instructions:'\u0001'}),body({exactLocationText:'😀'.repeat(2001)}),body({latitude:'90.1',longitude:'0'}),body({latitude:'0',longitude:null}),body({latitude:0,longitude:0}),body({latitude:'1e0',longitude:'1'}),body({latitude:'0',longitude:'180.00001'}),body({verifiedAt:'2026-02-30T00:00:00.000000Z'}),body({archived:true,archiveReason:' \t '}),body({archived:true,archiveReason:'\u00a0\u2003'})]){assert.throws(()=>parseLeadAddressDraft(draft));const retained=await evidence(a);await assert.rejects(save(a,request(parent,{draft})),e=>e.code==='22023');assert.deepEqual(await evidence(a),retained);}
});
test('missing/cross-business parents, wrong source parents and stale versions roll back all losing claims',async()=>{
 const parent=await lead(a),other=await lead(b),r=request(parent);assert.equal((await save(a,r)).state,'committed');
 for(const [next,reason] of [[request(randomUUID()),'parent'],[request(other),'parent'],[{...r,operation:randomUUID()},'version'],[{...r,lead:await lead(a),version:'1',operation:randomUUID()},'parent']]){const retained=await evidence(a),result=await save(a,next);assert.equal(result.state,'conflict');assert.equal(result.reason,reason);assert.deepEqual(await lookup(a,next.operation),{state:'absent'});assert.deepEqual(await evidence(a),retained);}
 // Matching/incomplete locations remain distinct intake sources until explicit conversion.
 assert.equal((await save(a,request(parent))).state,'committed');
});
test('two devices race the same source version with one winner and no losing operation',async()=>{
 const f=await state(),second=await session(f),parent=await lead(f),r=request(parent);assert.equal((await save(f,r)).state,'committed');const one={...r,operation:randomUUID(),version:'1',draft:body({instructions:'One'})},two={...r,operation:randomUUID(),version:'1',draft:body({instructions:'Two'})};
 const ids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
 await client.query('BEGIN');await client.query('SELECT business_id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[f.business]);const pending=Promise.all([save(f,one),save(second,two,web2)]);let blocked=0;
 try{const end=Date.now()+1500;while(Date.now()<end){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[ids])).rows[0].n;if(blocked===2)break;}}finally{await client.query('ROLLBACK');}
 const results=await pending;assert.equal(blocked,2);assert.equal(results.filter(x=>x.state==='committed').length,1);assert.equal(results.filter(x=>x.state==='conflict'&&x.reason==='version').length,1);assert.equal((await source(r.id)).version,'2');assert.deepEqual(await lookup(f,results[0].state==='conflict'?one.operation:two.operation),{state:'absent'});
});
test('audit failure and explicit rollback leave no source/receipt/session-activity changes',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent),retained=await evidence(f),activity=(await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows;
 await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_lead_address_refusal CHECK(entity_kind<>'lead_addresses') NOT VALID");try{await assert.rejects(save(f,r),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);assert.deepEqual((await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows,activity);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_lead_address_refusal');}
 await web.query('BEGIN');assert.equal((await save(f,r)).state,'committed');await web.query('ROLLBACK');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await lookup(f,r.operation),{state:'absent'});
});
test('fresh credential/provider/epoch checks apply to writes and original replay; paused lookup retains receipt',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent),first=await save(f,r);assert.equal(first.state,'committed');const retained=await evidence(f);
 assert.deepEqual(await save({...f,hash:randomBytes(32)},r),{state:'denied'});await assert.rejects(save({...f,epoch:randomUUID()},r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.deepEqual(await lookup(f,r.operation),first);await assert.rejects(save(f,r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);assert.deepEqual(await save(f,r),{state:'denied'});assert.deepEqual(await evidence(f),retained);
});
test('scoped keyset pages and complete audit history retain archive/reopen locations without extending session activity',async()=>{
 const f=await state(),parent=await lead(f),other=await lead(f),foreign=await lead(b),one=request(parent),two=request(parent,{draft:body({archived:true,archiveReason:'Original archive'})});
 for(const r of [one,two])assert.equal((await save(f,r)).state,'committed');assert.equal((await save(f,{...one,version:'1',operation:randomUUID(),draft:body({instructions:'Later reported detail'})})).state,'committed');
 const activity=(await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows;
 const list=async(id,after=null,archived=false,size=1)=>(await web.query('SELECT crest_commands.read_lead_addresses($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),id,after,archived,size])).rows[0].value;
 const active=await list(parent);assert.equal(active.leadId,parent);assert.equal(active.leadVersion,'1');assert.equal(active.leadAddresses.length,1);assert.equal(active.leadAddresses[0].id,one.id);assert.equal(active.hasMore,false);parseLeadAddress(active.leadAddresses[0],f.business,parent);
 const first=await list(parent,null,true),second=await list(parent,first.leadAddresses[0].id,true);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.deepEqual([...first.leadAddresses,...second.leadAddresses].map(x=>x.id),[one.id,two.id].sort());assert.deepEqual((await list(other)).leadAddresses,[]);assert.deepEqual(await list(foreign),{state:'absent'});
 const history=async(leadId,id,after,size)=>(await web.query('SELECT crest_commands.read_lead_address_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS value',[...auth(f),leadId,id,after,size])).rows[0].value;
 const h1=await history(parent,one.id,'0',1),h2=await history(parent,one.id,'1',1);assert.equal(h1.hasMore,true);assert.equal(h2.hasMore,false);assert.equal(h1.history[0].before,null);assert.deepEqual(h1.history[0].after,h2.history[0].before);assert.deepEqual(h2.history[0].after,await source(one.id));assert.equal(h2.history[0].action,'edit');assert.deepEqual(await history(other,one.id,'0',1),{state:'absent'});
 await assert.rejects(list(parent,null,true,51),e=>e.code==='22023');await assert.rejects(history(parent,one.id,'0',21),e=>e.code==='22023');assert.deepEqual((await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows,activity);
});
test('privileged source extraction stays in one read-only repeatable-read snapshot and round-trips every original field',async()=>{
 const f=await state(),parent=await lead(f),one=request(parent,{draft:body({instructions:' =SUM(A1)\nUnicode é 😀 "\\N"'})}),two=request(parent,{draft:body({archived:true,archiveReason:"'Original archive\\N"})});for(const r of [one,two])assert.equal((await save(f,r)).state,'committed');
 const originals=await Promise.all([one,two].map(r=>source(r.id)));originals.sort((a,b)=>a.id<b.id?-1:1);
 await assert.rejects(web.query('SELECT crest_commands.lead_address_snapshot_context($1)',[f.business]),e=>e.code==='42501');await assert.rejects(exporter.query('SELECT * FROM crest.lead_addresses'),e=>e.code==='42501');await assert.rejects(exporter.query('SELECT crest_commands.lead_address_snapshot_context($1)',[f.business]),e=>e.code==='25001');
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const context=(await exporter.query('SELECT crest_commands.lead_address_snapshot_context($1) AS value',[f.business])).rows[0].value;assert.equal(context.rowCount,'2');assert.equal(context.scope,'lead_address_intake');
  assert.equal((await save(f,{...one,version:'1',operation:randomUUID(),draft:body({instructions:'After snapshot'})})).state,'committed');assert.equal((await save(f,request(parent))).state,'committed');
  const rows=[];let after=null;for(let i=0;i<2;i++){const page=(await exporter.query('SELECT crest_commands.lead_address_snapshot_page($1,$2,$3,1) AS value',[f.business,context.snapshotToken,after])).rows[0].value;assert.equal(page.snapshotToken,context.snapshotToken);assert.equal(page.leadAddresses.length,1);rows.push(...page.leadAddresses);after=page.leadAddresses[0].id;}
  assert.deepEqual(rows,originals);for(const row of rows)parseLeadAddress(row,f.business,parent);const csv=formatLeadAddressCsv({businessId:f.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows});assert.deepEqual(decodeLeadAddressCsv(csv.csv,csv.escapeMap,f.business),originals);
  await exporter.query('SAVEPOINT wrong_token');await assert.rejects(exporter.query('SELECT crest_commands.lead_address_snapshot_page($1,$2,NULL,1)',[f.business,'0'.repeat(64)]),e=>e.code==='22023');await exporter.query('ROLLBACK TO SAVEPOINT wrong_token');
  assert.equal((await exporter.query('SELECT crest_commands.lead_address_snapshot_context($1) AS value',[f.business])).rows[0].value.rowCount,'2');
 }finally{await exporter.query('ROLLBACK');}
 assert.equal((await source(one.id)).instructions,'After snapshot');
});
