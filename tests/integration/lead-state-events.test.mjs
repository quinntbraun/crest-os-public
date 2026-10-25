// Actual disposable PostgreSQL/Auth schema; canonical37-to38 upgrade.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {before,after,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {leadStates,parseLead} from '../../src/customer/lead-contract.ts';
import {parseLeadStateDraft,parseLeadEvent} from '../../src/customer/lead-state-contract.ts';
import {parseLeadStateCommitted,parseLeadStatePage} from '../../src/customer/lead-state-command-contract.ts';
import {validateLeadHistoryChange} from '../../src/customer/lead-history-contract.ts';
import {formatLeadEventCsv} from '../../src/customer/lead-csv.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
let sandbox,client,target,web,web2,exporter,login,loginOwned=false,bootstrap,a,b,prior,receipt,retained,seed,proposal,guardRefused=false;
const issuer='https://auth.example.com/auth/v1';
const auth=f=>[f.hash,f.session,f.actor,issuer,f.subject,f.provider,new Date(Date.now()+300000),f.business];
const body=(patch={})=>({label:'Synthetic lifecycle inquiry',customerId:null,sourceId:null,referralText:null,phone:null,email:null,requestedScope:null,availability:null,estimatedCents:'9007199254740993',followUpAt:'2026-11-01T12:00:00.123456Z',notes:'Original notes',...patch});
const save=(f,id,version='0',draft=body(),operation=randomUUID(),c=web)=>c.query('SELECT crest_commands.save_lead($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth(f),f.epoch,operation,id,version,draft]).then(r=>r.rows[0].value);
const request=(id,fromState,toState,patch={})=>({id,version:'1',operation:randomUUID(),schema:1,body:{fromState,toState,reason:null},...patch});
const change=(f,r,c=web)=>c.query('SELECT crest_commands.change_lead_state($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS value',[...auth(f),f.epoch,r.operation,r.schema,r.id,r.version,r.body]).then(r=>r.rows[0].value);
const lookup=(f,operation)=>web.query('SELECT crest_commands.lookup_lead_state_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...auth(f),operation]).then(r=>r.rows[0].value);
const lead=id=>client.query('SELECT crest_private.lead_projection(l) AS value FROM crest.leads l WHERE id=$1',[id]).then(r=>r.rows[0]?.value);
const events=id=>client.query('SELECT crest_private.lead_event_projection(e) AS value FROM crest.lead_events e WHERE lead_id=$1 ORDER BY lead_version',[id]).then(r=>r.rows.map(x=>x.value));
async function evidence(f){return {leads:(await client.query('SELECT to_jsonb(l) AS value FROM crest.leads l WHERE business_id=$1 ORDER BY id',[f.business])).rows,events:(await client.query('SELECT to_jsonb(e) AS value FROM crest.lead_events e WHERE business_id=$1 ORDER BY id',[f.business])).rows,operations:(await client.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o WHERE business_id=$1 ORDER BY id',[f.business])).rows,audit:(await client.query('SELECT to_jsonb(a) AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY id',[f.business])).rows};}
async function extraSession(f){
 const provider=randomUUID(),session=randomUUID(),hash=randomBytes(32);
 await client.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",[provider,f.subject]);
 await client.query("WITH observed AS MATERIALIZED(SELECT clock_timestamp()-interval '1 second' AS stamp) INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by) SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id FROM crest_private.actors CROSS JOIN observed WHERE id=$2",[session,f.actor,provider,hash,randomBytes(32)]);
 return {...f,provider,session,hash};
}
async function state(){
 const subject=randomUUID(),actor=(await client.query("INSERT INTO crest_private.actors(kind,display_label,auth_provider_issuer,auth_user_id,created_by,updated_by,origin) VALUES('owner','Synthetic lifecycle owner',$1,$2,$3,$3,'manual') RETURNING id",[issuer,subject,bootstrap])).rows[0].id;
 await client.query('BEGIN');let business,epoch;
 try{business=(await client.query("INSERT INTO crest.businesses(legal_name,timezone,created_by,updated_by,origin) VALUES('Synthetic lifecycle business','UTC',$1,$1,'manual') RETURNING id",[actor])).rows[0].id;await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$2,$2,'manual')",[business,actor]);epoch=(await client.query("INSERT INTO crest_private.business_recovery_authorities(business_id,writes_enabled,created_by,updated_by,origin) VALUES($1,true,$2,$2,'manual') RETURNING active_epoch",[business,actor])).rows[0].active_epoch;await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}
 await client.query("INSERT INTO auth.users(id,email,aud,role) VALUES($1,$2,'authenticated','authenticated')",[subject,'synthetic-'+subject+'@example.com']);return extraSession({business,epoch,subject,actor});
}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);prior=await sandbox.apply(target,await sandbox.prefix(37));
 // Prepare both schema histories before granting the disposable web login.
 // Cluster roles are shared; migration1 correctly rejects an existing member.
 const guard=await sandbox.database(),guardClient=await sandbox.connect(guard);await sandbox.apply(guard,await sandbox.prefix(0),true);await installProviderSchema(guardClient,guard);await sandbox.apply(guard,await sandbox.prefix(37));
 bootstrap=(await client.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;a=await state();b=await state();
 login='crest_state_probe_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");loginOwned=true;await sandbox.admin.query('GRANT crest_web,crest_export TO '+login);
 const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());web2=await sandbox.connect(url.toString());exporter=await sandbox.connect(url.toString());for(const c of [web,web2]){await c.query('SET ROLE crest_web');await c.query("SET lock_timeout='3s'");}await exporter.query('SET ROLE crest_export');
 seed=randomUUID();await save(a,seed);retained=await evidenceBefore(a);proposal=await sandbox.prefix(38);
 await client.query('ALTER ROLE crest_lead_owner LOGIN');
 try{await assert.rejects(sandbox.apply(guard,proposal),/MIGRATION_CLI_FAILED_REVIEW_REQUIRED/);assert.equal((await guardClient.query("SELECT to_regclass('crest.lead_events') AS value")).rows[0].value,null);await assert.rejects(sandbox.apply(guard,proposal),/MIGRATION_PENDING_REVIEW_REQUIRED/);guardRefused=true;}finally{await client.query('ALTER ROLE crest_lead_owner NOLOGIN');}
 receipt=await sandbox.apply(target,proposal);
},{timeout:240000});
async function evidenceBefore(f){return {lead:await lead(seed),operations:(await client.query('SELECT to_jsonb(o) AS value FROM crest_private.operations o WHERE business_id=$1 ORDER BY id',[f.business])).rows,audit:(await client.query('SELECT to_jsonb(a) AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY id',[f.business])).rows};}
after(async()=>{await web?.end();await web2?.end();await exporter?.end();if(loginOwned)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
test('37-to38 upgrade preserves every prior receipt/source and refuses an unsafe existing owner',async()=>{
 assert.equal(prior.history.length,37);assert.equal(receipt.history.length,38);assert.deepEqual(receipt.history.slice(0,37),prior.history);assert.deepEqual((await sandbox.apply(target,proposal)).history,receipt.history);assert(guardRefused);assert.deepEqual(await evidenceBefore(a),retained);
});
test('forced-RLS append-only events and private verifier deny ordinary/export raw authority',async()=>{
 assert.equal((await client.query("SELECT relrowsecurity AND relforcerowsecurity AS yes FROM pg_class WHERE oid='crest.lead_events'::regclass")).rows[0].yes,true);
 for(const c of [web,exporter])for(const sql of ['SELECT * FROM crest.lead_events','DELETE FROM crest.lead_events','TRUNCATE crest.lead_events',"UPDATE crest.lead_events SET reason='forged'"])await assert.rejects(c.query(sql),e=>e.code==='42501');
 for(const role of ['crest_lead_owner','crest_lead_integrity_owner']){assert.equal((await client.query('SELECT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL AS bad FROM pg_roles WHERE rolname=$1',[role])).rows[0].bad,false);await assert.rejects(web.query('SET ROLE '+role),e=>e.code==='42501');assert.equal((await client.query("SELECT has_schema_privilege($1,'crest_commands','CREATE') AS yes",[role])).rows[0].yes,false);}
 await assert.rejects(web.query('SELECT crest_private.lead_state_operation_result($1,$2,$3)',[a.business,a.actor,randomUUID()]),e=>e.code==='42501');
});
test('Lost and reopen commit two complete audits, exact original events and unchanged follow-up/intake',async()=>{
 const id=randomUUID();await save(a,id);const original=await lead(id);
 for(const [index,[fromState,toState,reason]] of [['new','contacted',null],['contacted','lost','  Synthetic no response 😀\nRetain evidence  '],['lost','follow_up','Synthetic owner reopened']].entries()){
  const r=request(id,fromState,toState,{version:String(index+1),body:{fromState,toState,reason}}),outcome=await change(a,r);assert.equal(outcome.state,'committed');assert.equal(outcome.receipt.leadVersion,String(index+2));assert.deepEqual(await lookup(a,r.operation),outcome);
  const e=(await events(id)).at(-1);assert.deepEqual(parseLeadEvent(e,a.business),e);assert.equal(e.reason,reason);assert.equal(e.from_state,fromState);assert.equal(e.to_state,toState);assert.equal(e.operation_id,r.operation);
  const current=parseLead(await lead(id),a.business);assert.equal(current.lost_reason,toState==='lost'?reason:null);assert.equal(current.state,toState);assert.equal(current.follow_up_at,original.follow_up_at);assert.equal(current.estimated_cents,original.estimated_cents);assert.equal(current.notes,original.notes);
  const audits=(await client.query('SELECT entity_kind,action,reason,delta FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 ORDER BY entity_kind',[a.business,r.operation])).rows;assert.equal(audits.length,2);assert.deepEqual(audits[0].delta.after,e);assert.equal(audits[0].action,'create');assert.equal(audits[1].action,'state_change');assert.equal(audits[1].delta.before.state,fromState);assert.deepEqual(audits[1].delta.after,current);assert(audits.every(x=>x.reason===reason));
 }
 assert.equal((await events(id)).length,3);
});
test('all64 database state pairs agree with the strict manual contract without fabricated commercial rows',async()=>{
 for(const fromState of leadStates)for(const toState of leadStates){const reason='Synthetic owner reason';let expected=true;try{parseLeadStateDraft({fromState,toState,reason});}catch{expected=false;}assert.equal((await client.query('SELECT crest_private.manual_lead_state_valid($1,$2,$3) AS value',[fromState,toState,reason])).rows[0].value,expected);}
});
test('invalid/missing/extra fields, missing reasons and manual commercial targets leave no claims or records',async()=>{
 const id=randomUUID();await save(a,id);
 for(const draft of [null,{},[],{fromState:'new',toState:'won',reason:'Synthetic'},{fromState:'new',toState:'quote_sent',reason:'Synthetic'},{fromState:'new',toState:'lost',reason:null},{fromState:'lost',toState:'follow_up',reason:null},{fromState:'won',toState:'lost',reason:'Synthetic'},{fromState:'new',toState:'new',reason:'Synthetic'},{fromState:'new',toState:'lost',reason:'\u00a0'},{fromState:'new',toState:'lost',reason:'Bad\u0001'},{fromState:'new',toState:'lost',reason:'😀'.repeat(1001)},{fromState:'new',toState:'lost',reason:123},{fromState:'new',toState:'lost',reason:'Synthetic',acceptanceId:randomUUID()},{fromState:'new',toState:'contacted',reason:null,followUpAt:null}]){
  const before=await evidence(a);await assert.rejects(change(a,request(id,'new','contacted',{body:draft})),e=>e.code==='22023');assert.deepEqual(await evidence(a),before);
 }
});
test('state/version/missing/cross-business conflicts roll back the losing operation',async()=>{
 const id=randomUUID();await save(a,id);
 for(const [r,reason] of [[request(id,'contacted','follow_up'),'state'],[request(id,'new','contacted',{version:'2'}),'version'],[request(randomUUID(),'new','contacted'),'lead']]){
  const before=await evidence(a),outcome=await change(a,r);assert.equal(outcome.state,'conflict');assert.equal(outcome.reason,reason);assert.deepEqual(await evidence(a),before);assert.deepEqual(await lookup(a,r.operation),{state:'absent'});
 }
 const other=randomUUID();await save(b,other);const r=request(other,'new','contacted');assert.deepEqual(await change(a,r),{state:'conflict',reason:'lead'});assert.deepEqual(await lookup(b,r.operation),{state:'absent'});
});
test('original command replay remains exact after later status/intake changes and rejects all ID/body substitution',async()=>{
 const id=randomUUID();await save(a,id);const r=request(id,'new','lost',{body:{fromState:'new',toState:'lost',reason:'Synthetic reason'}}),first=await change(a,r);
 await change(a,request(id,'lost','follow_up',{version:'2',body:{fromState:'lost',toState:'follow_up',reason:'Synthetic reopen'}}));await save(a,id,'3',body({notes:'Later independent intake'}));
 const before=await evidence(a);assert.deepEqual(await change(a,r),first);assert.deepEqual(await lookup(a,r.operation),first);
 for(const patch of [{id:randomUUID()},{version:'2'},{body:{...r.body,reason:'Different reason'}},{body:{fromState:'new',toState:'contacted',reason:null}}])assert.deepEqual(await change(a,{...r,...patch}),{state:'conflict',reason:'operation'});
 assert.deepEqual(await evidence(a),before);
 const saveOperation=randomUUID(),other=randomUUID();await save(a,other,'0',body(),saveOperation);assert.deepEqual(await change(a,request(other,'new','contacted',{operation:saveOperation})),{state:'conflict',reason:'operation'});
});
test('two devices serialize the original lead version with one event and no losing claim',async()=>{
 const f=await state(),other=await extraSession(f),id=randomUUID();await save(f,id);
 const one=request(id,'new','contacted'),two=request(id,'new','follow_up'),ids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await web2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
 await client.query('BEGIN');await client.query('SELECT business_id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE',[f.business]);const pending=Promise.all([change(f,one),change(other,two,web2)]);let blocked=0;
 try{const end=Date.now()+1500;while(Date.now()<end){await client.query('SELECT pg_stat_clear_snapshot()');blocked=(await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[ids])).rows[0].n;if(blocked===2)break;}}finally{await client.query('ROLLBACK');}
 const outcomes=await pending;assert.equal(blocked,2);assert.equal(outcomes.filter(x=>x.state==='committed').length,1);assert.equal(outcomes.filter(x=>x.state==='conflict'&&x.reason==='version').length,1);assert.equal((await events(id)).length,1);assert.equal((await lead(id)).version,'2');assert.deepEqual(await lookup(f,(outcomes[0].state==='conflict'?one:two).operation),{state:'absent'});
});
test('audit failure rolls back state, event, operation and foreground session activity together',async()=>{
 const f=await state(),id=randomUUID();await save(f,id);const r=request(id,'new','contacted'),before=await evidence(f),activity=(await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows;
 await client.query("ALTER TABLE crest_private.audit_events ADD CONSTRAINT synthetic_state_audit_refusal CHECK(entity_kind<>'lead_events') NOT VALID");
 try{await assert.rejects(change(f,r),e=>e.code==='23514');assert.deepEqual(await evidence(f),before);assert.deepEqual((await client.query('SELECT to_jsonb(s) AS value FROM crest_private.app_sessions s WHERE id=$1',[f.session])).rows,activity);}finally{await client.query('ALTER TABLE crest_private.audit_events DROP CONSTRAINT synthetic_state_audit_refusal');}
});
test('explicit rollback leaves no receipt or event; later unchanged original submission commits once',async()=>{
 const id=randomUUID();await save(a,id);const r=request(id,'new','contacted'),before=await evidence(a);await web.query('BEGIN');assert.equal((await change(a,r)).state,'committed');await web.query('ROLLBACK');assert.deepEqual(await evidence(a),before);assert.deepEqual(await lookup(a,r.operation),{state:'absent'});const committed=await change(a,r);assert.deepEqual(await lookup(a,r.operation),committed);assert.equal((await events(id)).length,1);
});
test('fresh provider/session/owner/epoch fences remain enforced and paused lookup retains original receipts',async()=>{
 const f=await state(),id=randomUUID();await save(f,id);const r=request(id,'new','contacted'),first=await change(f,r);const invalid={...f,hash:randomBytes(32)};
 assert.deepEqual(await change(invalid,r),{state:'denied'});await assert.rejects(lookup(invalid,r.operation),e=>e.code==='42501');assert.deepEqual(await lookup(b,r.operation),{state:'absent'});
 await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);
 try{await assert.rejects(change(f,r),/RECOVERY_REVIEW_REQUIRED/);assert.deepEqual(await lookup(f,r.operation),first);}finally{await client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);}
 await assert.rejects(change({...f,epoch:randomUUID()},request(id,'contacted','follow_up',{version:'2'})),/RECOVERY_REVIEW_REQUIRED/);
 const replacement=await state();await client.query("INSERT INTO crest.memberships(business_id,actor_id,role,created_by,updated_by,origin) VALUES($1,$2,'owner',$3,$3,'manual')",[f.business,replacement.actor,f.actor]);
 await client.query('UPDATE crest.memberships SET active=false,version=version+1,updated_by=$2 WHERE business_id=$1 AND actor_id=$2',[f.business,f.actor]);assert.deepEqual(await change(f,request(id,'contacted','follow_up',{version:'2'})),{state:'denied'});
});
test('raw state rewrites and orphan events fail; retained event updates/deletes/truncation stay forbidden',async()=>{
 const id=randomUUID(),op=randomUUID();await save(a,id,'0',body(),op);
 await assert.rejects(client.query("UPDATE crest.leads SET state='lost',lost_reason='forged',version=version+1 WHERE id=$1",[id]),/IMMUTABLE_LEAD_STATE_EVENT_REQUIRED/);
 await assert.rejects(client.query("INSERT INTO crest.lead_events(business_id,lead_id,lead_version,from_state,to_state,reason,created_by,updated_by,origin,operation_id) VALUES($1,$2,2,'new','lost','Orphan',$3,$3,'manual',$4)",[a.business,id,a.actor,op]),/CREST_LEAD_STATE_EVENT_REQUIRED/);assert.deepEqual(await events(id),[]);
 await change(a,request(id,'new','contacted'));for(const sql of ["UPDATE crest.lead_events SET reason='forged'","DELETE FROM crest.lead_events","TRUNCATE crest.lead_events"])await assert.rejects(client.query(sql),e=>e.code==='55000');
});
test('scoped ordered state history and complete18-column snapshot/CSV preserve gaps and every original event',async()=>{
 const id=randomUUID();await save(a,id);await change(a,request(id,'new','contacted'));await save(a,id,'2',body({notes:'Intake edit between events'}));await change(a,request(id,'contacted','lost',{version:'3',body:{fromState:'contacted',toState:'lost',reason:'=SUM(A1)\nOriginal 😀 \\N'}}));
 const read=(f,leadId,after=0,size=1)=>web.query('SELECT crest_commands.read_lead_state_events($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...auth(f),leadId,String(after),size]).then(r=>r.rows[0].value);
 const first=await read(a,id),next=await read(a,id,first.events[0].lead_version);assert(first.hasMore);assert.equal(first.leadVersion,'4');assert.equal(first.events[0].lead_version,'2');assert.equal(next.events[0].lead_version,'4');assert.equal(next.hasMore,false);assert.deepEqual([...first.events,...next.events],await events(id));assert.deepEqual(await read(b,id),{state:'absent'});for(const size of [0,51])await assert.rejects(read(a,id,0,size),e=>e.code==='22023');
 await assert.rejects(web.query('SELECT crest_commands.lead_event_snapshot_context($1)',[a.business]),e=>e.code==='42501');await assert.rejects(exporter.query('SELECT crest_commands.lead_event_snapshot_context($1)',[a.business]),e=>e.code==='25001');
 await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
  const context=(await exporter.query('SELECT crest_commands.lead_event_snapshot_context($1) AS value',[a.business])).rows[0].value,pointRows=(await client.query('SELECT crest_private.lead_event_projection(e) AS value FROM crest.lead_events e WHERE business_id=$1 ORDER BY id',[a.business])).rows.map(x=>x.value);let after=null,all=[];
  const later=await change(a,request(id,'lost','follow_up',{version:'4',body:{fromState:'lost',toState:'follow_up',reason:'Synthetic committed after source snapshot'}}));assert.equal(later.state,'committed');
  for(const args of [[a.business,'a'.repeat(64),null,2],[b.business,context.snapshotToken,null,2],[a.business,context.snapshotToken,null,0],[a.business,context.snapshotToken,null,101]]){
   await exporter.query('SAVEPOINT invalid_source_request');await assert.rejects(exporter.query('SELECT crest_commands.lead_event_snapshot_page($1,$2,$3,$4)',args),e=>e.code==='22023');await exporter.query('ROLLBACK TO SAVEPOINT invalid_source_request');await exporter.query('RELEASE SAVEPOINT invalid_source_request');
  }
  for(;;){const page=(await exporter.query('SELECT crest_commands.lead_event_snapshot_page($1,$2,$3,2) AS value',[a.business,context.snapshotToken,after])).rows[0].value;assert.equal(page.snapshotToken,context.snapshotToken);all.push(...page.events);if(page.events.length<2)break;after=page.events.at(-1).id;}
  assert.equal(all.length,Number(context.rowCount));assert.deepEqual(all,pointRows);assert(all.every(x=>x.id!==later.receipt.leadEventId));assert.equal((await client.query('SELECT count(*)::int AS n FROM crest.lead_events WHERE business_id=$1',[a.business])).rows[0].n,all.length+1);for(const e of all)parseLeadEvent(e,a.business);
  const formatted=formatLeadEventCsv({businessId:a.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows:all});assert.equal(readCustomerCsv(formatted.csv)[0].length,18);assert.equal(JSON.parse(formatted.manifest).completeBackup,false);assert(JSON.parse(formatted.escapeMap).escapes.some(x=>x.column==='reason'));
  await exporter.query('COMMIT');
 }catch(e){await exporter.query('ROLLBACK');throw e;}
});

test('typed original receipts and mixed intake/status history preserve event gaps and retained reopen reasons',async()=>{
 const f=await state(),id=randomUUID();await save(f,id);
 const lostRequest=request(id,'new','lost',{body:{fromState:'new',toState:'lost',reason:'Original lost reason é 😀'}});
 const lost=await change(f,lostRequest);const accepted=parseLeadStateCommitted(lost,f.business,lostRequest.operation);assert.equal(accepted.receipt.leadVersion,'2');
 await save(f,id,'2',body({notes:'Intake edit between status events'}));
 const reopen=request(id,'lost','follow_up',{version:'3',body:{fromState:'lost',toState:'follow_up',reason:'Original reopened reason \n kept'}});assert.equal((await change(f,reopen)).state,'committed');
 const history=(await web.query('SELECT crest_commands.read_lead_history($1,$2,$3,$4,$5,$6,$7,$8,$9,0,20) AS value',[...auth(f),id])).rows[0].value;
 assert.deepEqual(history.history.map(e=>e.action),['create','state_change','edit','state_change']);
 for(const e of history.history)validateLeadHistoryChange(e.action,e.before===null?null:parseLead(e.before,f.business),parseLead(e.after,f.business));
 const raw=(await web.query('SELECT crest_commands.read_lead_state_events($1,$2,$3,$4,$5,$6,$7,$8,$9,0,1) AS value',[...auth(f),id])).rows[0].value;
 const first=parseLeadStatePage(raw,f.business,id,'0',1);assert.equal(first.state,'found');assert(first.hasMore);assert.deepEqual(first.events.map(e=>e.lead_version),['2']);assert.equal(first.events[0].reason,lostRequest.body.reason);
 const next=(await web.query('SELECT crest_commands.read_lead_state_events($1,$2,$3,$4,$5,$6,$7,$8,$9,2,1) AS value',[...auth(f),id])).rows[0].value;
 const last=parseLeadStatePage(next,f.business,id,'2',1);assert.equal(last.state,'found');assert.equal(last.hasMore,false);assert.deepEqual(last.events.map(e=>e.lead_version),['4']);assert.equal(last.events[0].reason,reopen.body.reason);
 assert.deepEqual(parseLeadStateCommitted(await lookup(f,lostRequest.operation),f.business,lostRequest.operation),accepted);
});
