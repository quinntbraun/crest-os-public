// Real registered53 PostgreSQL + explicit unregistered field storage proposal.
// Parent data uses retained restricted commands; field authority here is an
// administrator SQL fixture, not genuine MFA or an implemented application RPC.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
const proposal=await readFile(new URL('../../planning/proposals/field-time-storage.sql',import.meta.url),'utf8');
let sandbox,target,client,web,login,accepted,f,other,secondJob,definitions;
const scalar=async(q,args=[])=>(await client.query(q,args)).rows[0].value;
async function transaction(c,run){await c.query('BEGIN');try{const out=await run();await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}}
const at=n=>new Date(Date.UTC(2026,0,1,12,n)).toISOString().replace('.000Z','.000000Z');
async function book(parent,second=false){const q=confirmedBookingRequest(parent);if(second){q.expectedModeSequence='1';for(const key of ['start_at','end_at','local_start','local_end'])q.payload.appointment[key]=q.payload.appointment[key].replace('2026-11-03','2026-11-04');}const out=await transaction(web,()=>web.query('SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...parent.auth(),parent.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]));assert.equal(out.rows[0].value.state,'committed');return q.jobId;}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 login='crest_field_fixture_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});f=await accepted();f.job=await book(f);const same=await accepted(f,{customerId:f.customer});secondJob=await book(same,true);other=await accepted();other.job=await book(other);
 definitions=(await client.query("SELECT oid,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace IN('crest_private'::regnamespace,'crest_commands'::regnamespace) ORDER BY oid")).rows;
 const signatures=['crest_private.lock_booking_operator(uuid,uuid)','crest_private.prepare_command_audit()','crest_private.check_operation_completion()','crest_private.stamp_booking_row()','crest_private.check_booking_row_audit()','crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_private.check_booking_job_source()','crest_private.authorize_booking_statement()'],functions=[];
 for(const signature of signatures){const r=(await client.query("SELECT p.oid::regprocedure::text AS signature,r.rolname AS owner,p.prosecdef AS security_definer,p.proconfig AS config,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS sha256 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure",[signature])).rows[0];assert(r);functions.push(r);}
 await writeFile(new URL('../../.local/field-source-predecessors.json',import.meta.url),JSON.stringify({scope:'Fresh isolated registered53 source metadata before the field proposal; no function bodies or credentials',registeredMigrations:53,functions},null,2)+'\n');
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function draft(run,{command='operations.time.correct',commit=false,parent=f}={}){
 await client.query('BEGIN');try{
  const operation=randomUUID();await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true),set_config('crest.operation_id',$3,true)",[parent.business,parent.actor,operation]);
  await client.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,$4,1,$5,$6,$3,'manual')",[parent.business,operation,parent.actor,command,parent.epoch,'1'.repeat(64)]);
  const context={operation,parent};const result=await run(context);
  if(commit){await finish(context);await client.query('COMMIT');}else await client.query('ROLLBACK');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}
}
async function audit(kind,row){
 const fn=kind==='work_intervals'?'field_work_projection':'field_travel_projection';const afterRow=await scalar('SELECT crest_private.'+fn+'(v) AS value FROM crest.'+kind+' v WHERE id=$1',[row.id]);
 const beforeRow=row.replaces_id?await scalar('SELECT crest_private.'+fn+'(v) AS value FROM crest.'+kind+' v WHERE id=$1',[row.replaces_id]):null;
 await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'manual')",[row.business_id,row.operation_id,row.created_by,kind,row.logical_id,row.sequence,row.sequence==='1'?'create':row.change_kind,row.reason,{schemaVersion:1,before:beforeRow,after:afterRow}]);
}
async function work(c,start,end,kind='active',patch={},withAudit=true){
 const p=c.parent,id=randomUUID(),row={id,business_id:p.business,logical_id:id,sequence:'1',replaces_id:null,job_id:p.job,operator_actor_id:p.actor,kind,started_at:typeof start==='number'?at(start):start,ended_at:typeof end==='number'?at(end):end,pause_reason:kind==='pause'?'Synthetic supply stop':null,change_kind:'record',reason:'Synthetic recorded-time reconstruction',created_by:p.actor,operation_id:c.operation,origin:'manual',...patch};
 const out=(await client.query('INSERT INTO crest.work_intervals SELECT (jsonb_populate_record(null::crest.work_intervals,$1::jsonb)).* RETURNING *',[{...row,created_at:at(0)}])).rows[0];if(withAudit)await audit('work_intervals',out);return out;
}
async function travel(c,start,end,patch={},withAudit=true){
 const p=c.parent,id=randomUUID(),row={id,business_id:p.business,logical_id:id,sequence:'1',replaces_id:null,operator_actor_id:p.actor,driven_vehicle_id:p.vehicle,job_context_id:p.job,purpose:'supply',origin_snapshot:{schemaVersion:1,kind:'manual',locationText:'Synthetic workshop',instructions:null},destination_snapshot:{schemaVersion:1,kind:'manual',locationText:'Synthetic supply stop',instructions:null},departed_at:typeof start==='number'?at(start):start,arrived_at:typeof end==='number'?at(end):end,state:end===null?'open':'closed',eta_at:null,eta_source:null,eta_calculated_at:null,notes:null,change_kind:'record',reason:'Synthetic recorded travel reconstruction',created_by:p.actor,operation_id:c.operation,origin:'manual',...patch};
 const out=(await client.query('INSERT INTO crest.travel_legs SELECT (jsonb_populate_record(null::crest.travel_legs,$1::jsonb)).* RETURNING *',[{...row,created_at:at(0)}])).rows[0];if(withAudit)await audit('travel_legs',out);return out;
}
async function finish(c){await client.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result='{"+'"schemaVersion":1'+"}'::jsonb WHERE business_id=$1 AND operation_id=$2",[c.parent.business,c.operation]);await client.query('SET CONSTRAINTS ALL IMMEDIATE');}
async function rejects(run,codes=['23514','23P01','23505']){await assert.rejects(draft(run),e=>codes.includes(e.code));}

test('refuses unsafe defaults without creating field objects or changing registered history',async()=>{
 await client.query('BEGIN');try{await client.query('ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT SELECT ON TABLES TO PUBLIC');await assert.rejects(client.query(proposal),e=>e.code==='42501'&&e.message==='CREST_FIELD_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}
 assert.equal(await scalar("SELECT to_regclass('crest.work_intervals') AS value"),null);assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);
});
test('refuses a changed locking predecessor without creating field objects',async()=>{
 await client.query('BEGIN');try{await client.query("ALTER FUNCTION crest_private.lock_booking_operator(uuid,uuid) SET statement_timeout='1s'");await assert.rejects(client.query(proposal),e=>e.code==='42501'&&e.message==='CREST_FIELD_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}
 assert.equal(await scalar("SELECT to_regclass('crest.work_intervals') AS value"),null);
 for(const d of definitions)assert.equal(await scalar('SELECT pg_get_functiondef($1::oid) AS value',[d.oid]),d.definition);
});
test('refuses disabled parent protection and rolls back without changing registered history',async()=>{
 for(const relation of ['crest.jobs','crest.operator_controls','crest_private.operations','crest_private.audit_events']){
  await client.query('BEGIN');try{await client.query('ALTER TABLE '+relation+' NO FORCE ROW LEVEL SECURITY');await assert.rejects(client.query(proposal),e=>e.code==='42501'&&e.message==='CREST_FIELD_SOURCE_REVIEW_REQUIRED');}finally{await client.query('ROLLBACK');}
  assert.equal(await scalar("SELECT to_regclass('crest.work_intervals') AS value"),null);assert.equal(await scalar('SELECT relforcerowsecurity AS value FROM pg_class WHERE oid=$1::regclass',[relation]),true);
 }
 assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);
});
test('installs closed versioned sources and exclusion without rewriting a registered routine',async()=>{
 await transaction(client,()=>client.query(proposal));for(const d of definitions)assert.equal(await scalar('SELECT pg_get_functiondef($1::oid) AS value',[d.oid]),d.definition);
 for(const n of ['work_intervals','travel_legs','operator_occupancy']){const r=(await client.query("SELECT relrowsecurity,relforcerowsecurity,relowner='crest_schema_owner'::regrole AS owner FROM pg_class WHERE oid=$1::regclass",['crest.'+n])).rows[0];assert(r.relrowsecurity&&r.relforcerowsecurity&&r.owner);for(const role of ['crest_web','crest_worker','crest_booking_owner'])assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS value',[role,'crest.'+n,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE']),false);}
 for(const n of ['current_work_intervals','current_travel_legs']){const options=await scalar('SELECT reloptions AS value FROM pg_class WHERE oid=$1::regclass',['crest.'+n]);assert(options.includes('security_invoker=true')&&options.includes('security_barrier=true'));assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS value',['crest_web','crest.'+n,'SELECT']),false);}
 assert.equal(await scalar("SELECT has_schema_privilege('crest_booking_integrity_owner','crest_private','CREATE') AS value"),false);
 assert.equal(await scalar("SELECT count(*)::int AS value FROM pg_constraint WHERE conrelid='crest.operator_occupancy'::regclass AND contype='x' AND condeferrable AND NOT condeferred"),2);
 assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);
});
test('commits exact audited work/pause/travel with60 active and10 pause minutes in70 elapsed',async()=>{
 // Keep this durable history in a separate tenant/operator. An open January
 // interval in another case correctly extends through February indefinitely.
 await draft(async c=>{await travel(c,'2026-02-01T11:50:00.000000Z','2026-02-01T12:00:00.000000Z');await work(c,'2026-02-01T12:00:00.000000Z','2026-02-01T12:30:00.000000Z');await work(c,'2026-02-01T12:30:00.000000Z','2026-02-01T12:40:00.000000Z','pause');await travel(c,'2026-02-01T12:31:00.000000Z','2026-02-01T12:39:00.000000Z');await work(c,'2026-02-01T12:40:00.000000Z','2026-02-01T13:10:00.000000Z');},{commit:true,parent:other});
 const r=(await client.query("SELECT sum(extract(epoch FROM(ended_at-started_at))) FILTER(WHERE kind='active')::text AS active,sum(extract(epoch FROM(ended_at-started_at))) FILTER(WHERE kind='pause')::text AS pause,extract(epoch FROM(max(ended_at)-min(started_at)))::text AS elapsed FROM crest.current_work_intervals WHERE business_id=$1",[other.business])).rows[0];assert.equal(Number(r.active),3600);assert.equal(Number(r.pause),600);assert.equal(Number(r.elapsed),4200);
});
test('allows a paused session and open supply trip without counting pause as physical occupancy',()=>draft(async c=>{await work(c,0,null,'pause');await travel(c,10,null);await finish(c);assert.equal(await scalar("SELECT count(*)::int AS value FROM crest.operator_occupancy WHERE business_id=$1 AND ended_at IS NULL AND isempty(occupied)",[f.business]),1);}));
test('accepts exact half-open arrival/work adjacency and zero-length closed evidence',()=>draft(async c=>{await travel(c,0,10);await work(c,10,20);await work(c,15,15);await finish(c);}));
test('rejects a single microsecond of physical overlap',()=>rejects(async c=>{await travel(c,0,'2026-01-01T12:10:00.000001Z');await work(c,10,20);},['23P01']));
test('rejects active labor during physical travel',()=>rejects(async c=>{await work(c,0,30);await travel(c,10,20);},['23P01']));
test('rejects another job during a closed pause in historical evidence',()=>rejects(async c=>{await work(c,0,30,'pause');await work(c,10,20,'active',{job_id:secondJob});},['23P01']));
test('rejects two open work intervals even while paused',()=>rejects(async c=>{await work(c,0,null,'pause');await work(c,10,null,'active',{job_id:secondJob});}));
test('rejects two open physical trips',()=>rejects(async c=>{await travel(c,0,null);await travel(c,10,null);}));
test('closes an interval by appending and retaining its original open version',()=>draft(async c=>{const first=await work(c,0,null,'active',{change_kind:'open',reason:null});const closed=await work(c,0,10,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'close',reason:null});await finish(c);assert.equal(await scalar('SELECT ended_at AS value FROM crest.work_intervals WHERE id=$1',[first.id]),null);assert.equal(await scalar('SELECT id AS value FROM crest.current_work_intervals WHERE logical_id=$1',[first.logical_id]),closed.id);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.operator_occupancy WHERE business_id=$1 AND logical_id=$2',[f.business,first.logical_id]),1);}));
test('arrives by appending a closed trip without changing the original departure',()=>draft(async c=>{const first=await travel(c,0,null,{change_kind:'depart',reason:null});const arrived=await travel(c,0,10,{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'arrive',reason:null});await finish(c);assert.equal(await scalar('SELECT state AS value FROM crest.travel_legs WHERE id=$1',[first.id]),'open');assert.equal(await scalar('SELECT id AS value FROM crest.current_travel_legs WHERE logical_id=$1',[first.logical_id]),arrived.id);}));
test('cancels at the actual stop while preserving the departure version and planned destination',()=>draft(async c=>{
 const first=await travel(c,0,null,{change_kind:'depart',reason:null}),actualStop={schemaVersion:1,kind:'manual',locationText:'Synthetic safe stopping place before the destination',instructions:null};
 const cancelled=await travel(c,0,10,{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,state:'cancelled',change_kind:'cancel',reason:'Synthetic customer cancelled during the trip',destination_snapshot:actualStop});await finish(c);
 assert.deepEqual(await scalar('SELECT destination_snapshot AS value FROM crest.travel_legs WHERE id=$1',[first.id]),first.destination_snapshot);assert.deepEqual(await scalar('SELECT destination_snapshot AS value FROM crest.current_travel_legs WHERE logical_id=$1',[first.logical_id]),actualStop);assert.equal(await scalar('SELECT state AS value FROM crest.current_travel_legs WHERE id=$1',[cancelled.id]),'cancelled');assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE logical_id=$1',[first.logical_id]),2);
}));
test('arrival cannot silently change the confirmed destination',()=>assert.rejects(draft(async c=>{const first=await travel(c,0,null,{change_kind:'depart',reason:null});await travel(c,0,10,{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'arrive',reason:null,destination_snapshot:{kind:'manual',locationText:'A different place'}});}),e=>e.code==='23514'&&e.message==='CREST_FIELD_PREDECESSOR_REQUIRED'));
test('rejects stale predecessor branches',()=>rejects(async c=>{const first=await work(c,0,null);await work(c,0,10,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'close'});await work(c,0,20,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'close'});},['23514']));
test('rejects reopening closed evidence and skipped version numbers',async()=>{await rejects(async c=>{const first=await work(c,0,10);await work(c,0,null,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'correct'});},['23514']);await rejects(async c=>{const first=await work(c,0,10);await work(c,0,20,'active',{logical_id:first.logical_id,sequence:'3',replaces_id:first.id,change_kind:'correct'});},['23514']);});
test('corrects time with reason while retaining exact predecessor/audit and projection',()=>draft(async c=>{const first=await work(c,0,10);const corrected=await work(c,0,15,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'correct',reason:'Synthetic forgotten stop corrected'});await finish(c);const rows=(await client.query('SELECT sequence::text,to_char(ended_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS ending FROM crest.work_intervals WHERE logical_id=$1 ORDER BY sequence',[first.logical_id])).rows;assert.deepEqual(rows,[{sequence:'1',ending:at(10)},{sequence:'2',ending:at(15)}]);assert.equal(await scalar('SELECT work_interval_id AS value FROM crest.operator_occupancy WHERE logical_id=$1',[first.logical_id]),corrected.id);}));
test('time correction cannot create overlap with retained travel',()=>rejects(async c=>{const first=await work(c,0,10);await travel(c,10,20);await work(c,0,15,'active',{logical_id:first.logical_id,sequence:'2',replaces_id:first.id,change_kind:'correct'});},['23P01']));
test('refuses a missing work audit even when another valid audit completes the operation',()=>assert.rejects(draft(async c=>{await work(c,0,10,'active',{},false);await travel(c,20,30);await finish(c);}),e=>e.code==='23514'&&e.message==='CREST_FIELD_AUDIT_REQUIRED'));
test('refuses a forged projection even when all source audits match',()=>rejects(async c=>{const w=await work(c,0,10);await client.query("UPDATE crest.operator_occupancy SET occupied='empty'::tstzrange WHERE work_interval_id=$1",[w.id]);await finish(c);},['23514']));
test('refuses a newly inserted audit whose after snapshot changes the actual endpoint',()=>assert.rejects(draft(async c=>{
 const w=await work(c,0,10,'active',{},false),actual=await scalar('SELECT crest_private.field_work_projection(v) AS value FROM crest.work_intervals v WHERE id=$1',[w.id]);
 await client.query("INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES($1,$2,$3,$3,'work_intervals',$4,1,'create',$5,$6,'manual')",[w.business_id,w.operation_id,w.created_by,w.logical_id,w.reason,{schemaVersion:1,before:null,after:{...actual,ended_at:at(11)}}]);await finish(c);
}),e=>e.code==='23514'&&e.message==='CREST_FIELD_AUDIT_REQUIRED'));
test('retains source history against UPDATE DELETE and TRUNCATE',async()=>{for(const verb of ['UPDATE crest.work_intervals SET reason=reason','DELETE FROM crest.work_intervals','TRUNCATE crest.work_intervals,crest.travel_legs,crest.operator_occupancy','UPDATE crest.travel_legs SET reason=reason','DELETE FROM crest.operator_occupancy'])await assert.rejects(draft(()=>client.query(verb)),e=>e.code==='55000'&&e.message==='CREST_FIELD_HISTORY_RETAINED');});
test('ordinary web cannot read or mutate sources even with copied tenant settings',async()=>{await web.query('BEGIN');try{await web.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[f.business,f.actor]);await assert.rejects(web.query('SELECT * FROM crest.current_work_intervals'),e=>e.code==='42501');}finally{await web.query('ROLLBACK');}});
const badWork=[['negative interval',20,10,'active',{}],['future start','2099-01-01T00:00:00.000000Z',null,'active',{}],['missing pause reason',0,10,'pause',{pause_reason:null}],['unreasoned manual record',0,10,'active',{reason:null}],['wrong tenant job',0,10,'active',{job_id:'00000000-0000-4000-8000-000000000000'}]];
for(const [label,start,end,kind,patch]of badWork)test('rejects '+label,()=>rejects(c=>work(c,start,end,kind,patch),['23514','23503']));
test('rejects a vehicle from another business',()=>rejects(c=>travel(c,0,10,{driven_vehicle_id:other.vehicle}),['23503']));
test('keeps unknown ETA and absent mileage distinct from zero or a fabricated return trip',()=>draft(async c=>{await travel(c,0,10);await finish(c);const leg=(await client.query('SELECT * FROM crest.current_travel_legs WHERE business_id=$1 AND departed_at=$2',[f.business,at(0)])).rows[0];assert.equal(leg.eta_at,null);assert.equal(leg.eta_source,null);assert.equal(Object.hasOwn(leg,'actual_miles'),false);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.current_travel_legs WHERE business_id=$1 AND departed_at=$2',[f.business,at(0)]),1);}));
test('legacy job transition gate stays closed and both booked jobs remain scheduled',async()=>{assert.equal(await scalar("SELECT count(*)::int AS value FROM crest.jobs WHERE business_id=$1 AND state<>'scheduled'",[f.business]),0);assert.equal(await scalar("SELECT indisunique AND indisvalid AS value FROM pg_index WHERE indexrelid='crest.operator_one_unfinished_job'::regclass"),true);assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);});
test('a second real connection waits for operator locking then refuses overlapping physical travel',async()=>{
 const p=await accepted();p.job=await book(p);const competing=await sandbox.connect(target);let attempt;
 try{
  await draft(async c=>{
   await work(c,0,20);await competing.query('BEGIN');const operation=randomUUID();await competing.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true),set_config('crest.operation_id',$3,true)",[p.business,p.actor,operation]);
   await competing.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'operations.time.correct',1,$4,$5,$3,'manual')",[p.business,operation,p.actor,p.epoch,'2'.repeat(64)]);
   const pid=(await competing.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,id=randomUUID();
   attempt=competing.query("INSERT INTO crest.travel_legs(id,business_id,logical_id,sequence,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,change_kind,reason,created_by,operation_id) VALUES($1,$2,$1,1,$3,$4,$5,'supply',$6,$7,$8,$9,'closed','record','Synthetic competing physical trip',$3,$10)",[id,p.business,p.actor,p.vehicle,p.job,{kind:'manual',locationText:'Synthetic start'},{kind:'manual',locationText:'Synthetic stop'},at(10),at(30),operation]);void attempt.catch(()=>undefined);
   let waiting=false;for(let i=0;i<80;i++){waiting=await scalar("SELECT coalesce((SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=$1),false) AS value",[pid]);if(waiting)break;await delay(25);}assert.equal(waiting,true,'competing source must actually wait for the owned operator lock');
  },{parent:p,commit:true});
  await assert.rejects(attempt,e=>e.code==='23P01');await competing.query('ROLLBACK');assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[p.business]),0);
 }finally{await attempt?.catch(()=>undefined);await competing.query('ROLLBACK').catch(()=>{});await competing.end();}
});
