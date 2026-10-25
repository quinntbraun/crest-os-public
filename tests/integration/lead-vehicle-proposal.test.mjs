// Actual PostgreSQL/RLS/fresh session authority, unregistered forward39 only.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {leadVehicleProposal} from '../support/lead-vehicle-proposal.mjs';
import {parseLeadVehicleDraft} from '../../src/customer/lead-resource-contract.ts';
let sandbox,client,target,web,web2,login,loginOwned=false,bootstrap,a,b,prior,receipt,proposal;
const issuer='https://auth.example.com/auth/v1';
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const body=(patch={})=>({vehicleId:null,reportedVehicle:{schemaVersion:1,label:'Synthetic reported vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,notes:null},requestedServices:{schemaVersion:1,text:null},conditionNotes:null,archived:false,archiveReason:null,...patch});
const request=(lead,patch={})=>({lead,id:randomUUID(),version:'0',operation:randomUUID(),draft:body(),...patch});
const save=(f,r,c=web)=>c.query('SELECT crest_commands.save_lead_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,r.operation,r.lead,r.id,r.version,r.draft]).then(r=>r.rows[0].value);
const lookup=(f,operation)=>web.query('SELECT crest_commands.lookup_lead_vehicle_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),operation]).then(r=>r.rows[0].value);
const source=id=>client.query('SELECT crest_private.lead_vehicle_projection(v) AS value FROM crest.lead_vehicles v WHERE id=$1',[id]).then(r=>r.rows[0]?.value);
async function evidence(f){return {sources:(await client.query('SELECT to_jsonb(v) FROM crest.lead_vehicles v WHERE business_id=$1 ORDER BY id',[f.business])).rows,operations:(await client.query('SELECT to_jsonb(o) FROM crest_private.operations o WHERE business_id=$1 ORDER BY id',[f.business])).rows,audits:(await client.query('SELECT to_jsonb(a) FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY id',[f.business])).rows};}
async function session(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic lead vehicle owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic lead vehicle business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return session({business,epoch,subject,actor});
}
async function lead(f){
 const id=randomUUID(),draft={label:'Synthetic incomplete lead',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null};
 const result=(await web.query('SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth(f),f.epoch,randomUUID(),id,draft])).rows[0].value;assert.equal(result.state,'committed');return id;
}
async function directoryVehicle(f){
 const id=randomUUID(),draft={label:'Synthetic chosen directory vehicle',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
 const result=(await web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...auth(f),f.epoch,randomUUID(),id,draft])).rows[0].value;assert.equal(result.state,'committed');return id;
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target);proposal=await leadVehicleProposal(sandbox);receipt=await sandbox.apply(target,proposal);
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;a=await state();b=await state();
 login='crest_lead_vehicle_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");loginOwned=true;await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}
},{timeout:240000});
after(async()=>{await web?.end();await web2?.end();if(loginOwned)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('forward proposal preserves all38 published migration hashes and applies idempotently',async()=>{assert.equal(prior.history.length,38);assert.equal(receipt.history.length,39);assert.deepEqual(receipt.history.slice(0,38),prior.history);assert.deepEqual((await sandbox.apply(target,proposal)).history,receipt.history);});
test('forced RLS and closed domain owners deny raw web/export mutation and private verification',async()=>{
 assert.equal((await client.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_vehicles'::regclass")).rows[0].yes,true);
 for(const sql of ['SELECT * FROM crest.lead_vehicles','DELETE FROM crest.lead_vehicles','TRUNCATE crest.lead_vehicles',"UPDATE crest.lead_vehicles SET condition_notes='forged'"])await assert.rejects(web.query(sql),e=>e.code==='42501');
 for(const role of ['crest_lead_owner','crest_lead_integrity_owner']){await assert.rejects(web.query('SET ROLE '+role),e=>e.code==='42501');assert.equal((await client.query('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolconfig IS NOT NULL AS bad FROM pg_roles WHERE rolname=$1',[role])).rows[0].bad,false);assert.equal((await client.query("SELECT has_table_privilege('crest_export','crest.lead_vehicles','SELECT') AS yes")).rows[0].yes,false);}
 await assert.rejects(web.query('SELECT crest_private.lead_vehicle_operation_result($1,$2,$3)',[a.business,a.actor,randomUUID()]),e=>e.code==='42501');
});
test('incomplete reports, exact original requests and explicit links commit full source audits without Won/customer/ownership',async()=>{
 const parent=await lead(a),r=request(parent,{draft:body({reportedVehicle:{...body().reportedVehicle,label:'  É 😀  ',vin:' Shared / unconfirmed ',year:-2,notes:'\tOriginal\n=SUM(A1)'},requestedServices:{schemaVersion:1,text:'  Interior\nExterior? '},conditionNotes:'Reported only'})}),first=await save(a,r);assert.equal(first.state,'committed');assert.deepEqual(await lookup(a,r.operation),first);
 const before=await source(r.id);assert.deepEqual(before.reported_vehicle,r.draft.reportedVehicle);assert.deepEqual(before.requested_services,r.draft.requestedServices);assert.equal(before.vehicle_id,null);assert.equal(before.lead_id,parent);
 const vehicleId=await directoryVehicle(a),next={...r,version:'1',operation:randomUUID(),draft:{...r.draft,vehicleId}};assert.equal((await save(a,next)).state,'committed');const after=await source(r.id);assert.deepEqual(after.reported_vehicle,before.reported_vehicle);assert.equal(after.vehicle_id,vehicleId);
 assert.deepEqual((await client.query('SELECT state,customer_id,version::text FROM crest.leads WHERE id=$1',[parent])).rows[0],{state:'new',customer_id:null,version:'1'});assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[a.business])).rows[0].n,0);
 const audits=(await client.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='lead_vehicles' AND entity_id=$1 ORDER BY entity_version",[r.id])).rows;assert.equal(audits.length,2);assert.deepEqual(audits[0].delta.before,null);assert.deepEqual(audits[0].delta.after,before);assert.deepEqual(audits[1].delta.before,before);assert.deepEqual(audits[1].delta.after,after);
});
test('original replay survives later edits/archive/reopen while payload/lead/reference substitutions fail',async()=>{
 const parent=await lead(a),r=request(parent),first=await save(a,r);for(const [version,draft] of [['1',body({archived:true,archiveReason:'  Retained reason 😀  '})],['2',body({conditionNotes:'Later original intake'})]])assert.equal((await save(a,{...r,version,operation:randomUUID(),draft})).state,'committed');
 const retained=await evidence(a);assert.deepEqual(await save(a,r),first);assert.deepEqual(await lookup(a,r.operation),first);for(const patch of [{id:randomUUID()},{lead:randomUUID()},{version:'1'},{draft:body({conditionNotes:'Changed request'})}])assert.deepEqual(await save(a,{...r,...patch}),{state:'conflict',reason:'operation'});assert.deepEqual(await evidence(a),retained);
});
test('malformed or oversized JSON and nested injected commercial fields leave no operation claims',async()=>{
 const parent=await lead(a);for(const draft of [null,{},[],body({state:'won'}),body({vehicleId:''}),body({conditionNotes:'\u0001'}),body({reportedVehicle:{...body().reportedVehicle,schemaVersion:2}}),body({reportedVehicle:{...body().reportedVehicle,year:1.5}}),body({requestedServices:{schemaVersion:1,text:null,priceCents:'0'}}),body({requestedServices:{schemaVersion:1,text:'😀'.repeat(4001)}}),body({archived:true,archiveReason:' \t '})]){assert.throws(()=>parseLeadVehicleDraft(draft));const retained=await evidence(a);await assert.rejects(save(a,request(parent,{draft})),e=>e.code==='22023');assert.deepEqual(await evidence(a),retained);}
});
test('missing/cross-business parents, duplicate selected vehicles and stale versions roll back all losing claims',async()=>{
 const parent=await lead(a),other=await lead(b),foreign=await directoryVehicle(b),vehicleId=await directoryVehicle(a),r=request(parent,{draft:body({vehicleId})});assert.equal((await save(a,r)).state,'committed');
 for(const [next,reason] of [[request(randomUUID()),'parent'],[request(other),'parent'],[request(parent,{draft:body({vehicleId:foreign})}),'parent'],[request(parent,{draft:body({vehicleId})}),'vehicle'],[{...r,operation:randomUUID()},'version'],[{...r,lead:await lead(a),version:'1',operation:randomUUID()},'parent']]){const retained=await evidence(a),result=await save(a,next);assert.equal(result.state,'conflict');assert.equal(result.reason,reason);assert.deepEqual(await lookup(a,next.operation),{state:'absent'});assert.deepEqual(await evidence(a),retained);}
});
test('two devices race the same source version with one winner and no losing operation',async()=>{
 const f=await state(),second=await session(f),parent=await lead(f),r=request(parent);assert.equal((await save(f,r)).state,'committed');const one={...r,operation:randomUUID(),version:'1',draft:body({conditionNotes:'One'})},two={...r,operation:randomUUID(),version:'1',draft:body({conditionNotes:'Two'})};
 const ids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
 await client.query('BEGIN');await client.query('SELECT business_id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[f.business]);const pending=Promise.all([save(f,one),save(second,two,web2)]);let blocked=0;
 try{const end=Date.now()+1500;while(Date.now()<end){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[ids])).rows[0].n;if(blocked===2)break;}}finally{await client.query('ROLLBACK');}
 const results=await pending;assert.equal(blocked,2);assert.equal(results.filter(x=>x.state==='committed').length,1);assert.equal(results.filter(x=>x.state==='conflict'&&x.reason==='version').length,1);assert.equal((await source(r.id)).version,'2');assert.deepEqual(await lookup(f,results[0].state==='conflict'?one.operation:two.operation),{state:'absent'});
});
test('audit failure and explicit rollback leave no source/receipt/session-activity changes',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent),retained=await evidence(f),activity=(await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows;
 await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_lead_vehicle_refusal CHECK(entity_kind<>'lead_vehicles') NOT VALID");try{await assert.rejects(save(f,r),e=>e.code==='23514');assert.deepEqual(await evidence(f),retained);assert.deepEqual((await client.query('SELECT to_jsonb(s) FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows,activity);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_lead_vehicle_refusal');}
 await web.query('BEGIN');assert.equal((await save(f,r)).state,'committed');await web.query('ROLLBACK');assert.deepEqual(await evidence(f),retained);assert.deepEqual(await lookup(f,r.operation),{state:'absent'});
});
test('fresh credential/provider/epoch checks apply to writes and original replay; paused lookup retains receipt',async()=>{
 const f=await state(),parent=await lead(f),r=request(parent),first=await save(f,r);assert.equal(first.state,'committed');const retained=await evidence(f);
 assert.deepEqual(await save({...f,hash:randomBytes(32)},r),{state:'denied'});await assert.rejects(save({...f,epoch:randomUUID()},r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);assert.deepEqual(await lookup(f,r.operation),first);await assert.rejects(save(f,r),e=>e.code==='P0001'&&e.message==='RECOVERY_REVIEW_REQUIRED');assert.deepEqual(await evidence(f),retained);
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);await client.query('DELETE FROM auth.sessions WHERE id=$1',[f.provider]);assert.deepEqual(await save(f,r),{state:'denied'});assert.deepEqual(await evidence(f),retained);
});
