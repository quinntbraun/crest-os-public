// Real restricted saved-session support-trip commands. No owner runtime,
// browser/MFA, custody, GPS, accounting or complete recovery claim.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseSupportTripHistory,parseSupportTripList} from '../../src/operations/support-trip.ts';
import {parseSupportTripMileage} from '../../src/operations/mileage.ts';
const proposals=await Promise.all(['field-time-storage','field-session-commands','work-completion-plan','work-completion-commands','field-scope-floor','mileage-evidence','mileage-field-profile','mobile-trip-interruption','unfulfilled-work-cancellation','support-trip-commands','field-originals','field-source'].map(n=>readFile(new URL('../../planning/proposals/'+n+'.sql',import.meta.url),'utf8')));
let sandbox,client,web,login,target,accepted,main,original,arrived,mainBody;
const scalar=async(q,args=[])=>(await client.query(q,args)).rows[0].value;
async function tx(c,run){await c.query('BEGIN');try{const r=await run();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
const location=text=>({schemaVersion:1,kind:'manual',locationText:text,instructions:null});
const historical={departedAt:'2026-01-02T03:04:05.123456Z',arrivedAt:'2026-01-02T03:24:05.654321Z',state:'closed'};
async function fixture({job=false}={}){
 const p=await accepted(null);p.rig=randomUUID();
 const body={label:'Synthetic support-trip rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null};
 assert.equal((await tx(web,()=>web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',[...p.auth(),p.epoch,randomUUID(),p.rig,body]))).rows[0].value.state,'committed');
 if(job){const q=confirmedBookingRequest(p);assert.equal((await tx(web,()=>web.query('SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]))).rows[0].value.state,'committed');p.job=q.jobId;p.version='1';}
 return p;
}
const departBody=(p,patch={})=>({action:'depart',reason:null,trip:{drivenVehicleId:p.rig,jobId:p.job??null,purpose:'supply',origin:location('Synthetic equipment base'),destination:location('Synthetic supply stop'),notes:null,...patch}});
const manualBody=(p,patch={})=>({action:'record',reason:'Synthetic omitted trip, recorded explicitly',trip:{...departBody(p).trip,...historical,...patch}});
const arriveBody={action:'arrive',reason:null,trip:null};
function correctBody(receipt,patch={}){const l=receipt.leg;return {action:'correct',reason:'Synthetic reasoned trip correction',trip:{drivenVehicleId:l.driven_vehicle_id,jobId:l.job_context_id,purpose:l.purpose,origin:l.origin_snapshot,destination:l.destination_snapshot,notes:l.notes,departedAt:l.departed_at,arrivedAt:l.arrived_at,state:l.state,...patch}};}
async function save(p,body,{id=randomUUID(),expected=null,operation=randomUUID(),connection=web,auth=p.auth(),epoch=p.epoch}={}){
 const result=(await tx(connection,()=>connection.query('SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...auth,epoch,operation,id,expected,body]))).rows[0].value;
 return {result,body,id,expected,operation};
}
async function lookup(p,id){return (await tx(web,()=>web.query('SELECT crest_commands.lookup_support_trip_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),id]))).rows[0].value;}
const absent=async(p,id)=>assert.equal(await scalar('SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[p.business,id]),0);
async function snapshot(p){const r={};for(const table of ['jobs','appointments','schedule_reservations','allocation_plan_versions','allocation_plan_parts','work_intervals','travel_legs','operator_occupancy','mileage_evidence','leg_job_allocations','work_scope_outcomes','messages','review_requests','job_finalization_tasks'])r[table]=(await client.query('SELECT to_jsonb(t)::text value FROM crest.'+table+' t WHERE business_id=$1 ORDER BY id',[p.business])).rows;return r;}
async function field(p,action){const body={action,reason:action==='direct_arrive'?'Synthetic omitted outbound trip':action==='pause'?'Synthetic supply pause':null,...(action==='depart'?{trip:{drivenVehicleId:p.rig,origin:location('Synthetic equipment base'),etaAt:null,notes:null}}:{})};const r=(await tx(web,()=>web.query('SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,body]))).rows[0].value;assert.equal(r.state,'committed');p.version=r.receipt.jobVersion;return r;}
before(async()=>{
 sandbox=await migrationSandbox();target=await sandbox.database();client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 login='synthetic_support_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;target=url.toString();web=await sandbox.connect(target);await web.query('SET ROLE crest_web');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await scalar("SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 for(const s of proposals.slice(0,9))await tx(client,()=>client.query(s));
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});

test('support-trip installation refuses changed field guards RLS and unsafe default grants',async()=>{
 for(const mutation of ["ALTER FUNCTION crest_private.field_source_stamp() SET statement_timeout='1s'",'ALTER TABLE crest.operator_controls NO FORCE ROW LEVEL SECURITY','ALTER TABLE crest.operator_occupancy NO FORCE ROW LEVEL SECURITY','ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC']){
  await client.query('BEGIN');try{await client.query(mutation);await assert.rejects(client.query(proposals[9]),e=>e.code==='42501'&&e.message==='CREST_SUPPORT_SOURCE_REQUIRED');}finally{await client.query('ROLLBACK');}
 }
});
test('installs support-trip commands without granting ordinary source or helper access',async()=>{
 try{await tx(client,()=>client.query(proposals[9]));await tx(client,()=>client.query(proposals[10]));await tx(client,()=>client.query(proposals[11]));}catch(e){throw Error('SUPPORT_INSTALL '+JSON.stringify({code:e.code,message:e.message,position:e.position,internalPosition:e.internalPosition,where:e.where}),{cause:e});}
 for(const role of ['anon','authenticated','crest_web','crest_worker','crest_recovery']){
  assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) value',[role,'crest_private.support_trip_result(uuid,uuid,uuid)','EXECUTE']),false);
  assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) value',[role,'crest.travel_legs','SELECT,INSERT,UPDATE,DELETE,TRUNCATE']),false);
 }
});
test('support-trip reader verifies active and retained pages with exact versions and rejects foreign scope',async()=>{
 const sql=await readFile(new URL('../../planning/proposals/support-trip-reader.sql',import.meta.url),'utf8');
 await tx(client,()=>client.query(sql));
 const own=await fixture(),foreign=await fixture(),started=await save(own,departBody(own)),other=await save(foreign,manualBody(foreign));
 const list=(p,after=null)=>tx(web,async()=>(await web.query(
  'SELECT crest_commands.read_support_trips($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
  [...p.auth(),after?.departedAt??null,after?.legId??null,1])).rows[0].value);
 const history=(p,id,after,through)=>tx(web,async()=>(await web.query(
  'SELECT crest_commands.read_support_trip_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
  [...p.auth(),id,after,through,1])).rows[0].value);
 const mileage=(p,id)=>tx(web,async()=>(await web.query(
  'SELECT crest_commands.read_support_trip_mileage($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),id])).rows[0].value);
 const query={businessId:own.business,after:null,pageSize:1};
 const open=parseSupportTripList(await list(own),query);
 assert.equal(open.active.legId,started.id);assert.equal(open.active.arrivedAt,null);assert.deepEqual(open.trips,[]);
 assert.deepEqual(await mileage(own,started.id),{state:'not_found'});
 assert.deepEqual(await mileage(own,other.id),{state:'not_found'});
 const ended=await save(own,arriveBody,{id:started.id,expected:started.result.receipt.legVersionId});
 assert.equal(ended.result.state,'committed');
 const targetTrip=parseSupportTripMileage(await mileage(own,started.id),own.business,started.id).trip;
 assert.equal(targetTrip.legVersionId,ended.result.receipt.legVersionId);
 assert.equal(targetTrip.evidenceVersion,'0');assert.equal(targetTrip.distanceStatus,'unresolved');
 const older=await save(own,manualBody(own));assert.equal(older.result.state,'committed');
 const first=parseSupportTripList(await list(own),query);
 assert.equal(first.active,null);assert.equal(first.trips[0].legId,started.id);assert(first.hasMore);
 const after={departedAt:first.trips[0].departedAt,legId:first.trips[0].legId};
 const second=parseSupportTripList(await list(own,after),{...query,after});
 assert.equal(second.trips[0].legId,older.id);assert.equal(second.hasMore,false);
 const historyQuery={businessId:own.business,legId:started.id,afterVersion:'0',throughVersion:'2',pageSize:1};
 const firstVersion=parseSupportTripHistory(await history(own,started.id,'0','2'),historyQuery);
 const finalVersion=parseSupportTripHistory(await history(own,started.id,'1','2'),{...historyQuery,afterVersion:'1'});
 assert.equal(firstVersion.trips[0].departedAt,finalVersion.trips[0].departedAt);
 assert.equal(firstVersion.trips[0].state,'open');assert.equal(finalVersion.trips[0].state,'closed');
 assert.deepEqual(await history(own,other.id,'0','1'),{state:'not_found'});
 for(const role of ['anon','authenticated','crest_worker','crest_export']){
  assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) value',[role,
   'crest_commands.read_support_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer)','EXECUTE']),false);
  assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) value',[role,
   'crest_commands.read_support_trip_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','EXECUTE']),false);
 }
});
test('records an actual support departure without starting work posting money or guessing mileage',async()=>{
 main=await fixture({job:true});mainBody=departBody(main);const before=await snapshot(main);original=await save(main,mainBody);assert.equal(original.result.state,'committed');const r=original.result.receipt;
 assert.equal(r.legState,'open');assert.equal(r.legId,original.id);assert.equal(r.legSequence,'1');assert.equal(r.leg.job_context_id,main.job);assert.equal(r.leg.driven_vehicle_id,main.rig);assert.equal(r.mileageReviewRequired,true);assert.equal(r.leg.arrived_at,null);assert.equal(r.leg.eta_at,null);
 const after=await snapshot(main);for(const table of Object.keys(before).filter(t=>!['travel_legs','operator_occupancy'].includes(t)))assert.deepEqual(after[table],before[table],table);assert.deepEqual(await lookup(main,original.operation),original.result);
});
test('arrival preserves exact departure microseconds and immutable originals through later correction',async()=>{
 arrived=await save(main,arriveBody,{id:original.id,expected:original.result.receipt.legVersionId});assert.equal(arrived.result.state,'committed');assert.equal(arrived.result.receipt.leg.departed_at,original.result.receipt.leg.departed_at);assert.equal(arrived.result.receipt.legState,'closed');
 const corrected=await save(main,correctBody(arrived.result.receipt,{notes:'Synthetic corrected route note'}),{id:original.id,expected:arrived.result.receipt.legVersionId});assert.equal(corrected.result.state,'committed');assert.equal(corrected.result.receipt.legSequence,'3');
 const stale=await save(main,correctBody(arrived.result.receipt),{id:original.id,expected:arrived.result.receipt.legVersionId});assert.deepEqual(stale.result,{state:'conflict',reason:'version'});await absent(main,stale.operation);
 assert.deepEqual(await lookup(main,original.operation),original.result);assert.deepEqual(await lookup(main,arrived.operation),arrived.result);
 assert.deepEqual((await save(main,mainBody,original)).result,original.result);
 assert.deepEqual((await save(main,{...mainBody,reason:'Changed original reason'},original)).result,{state:'conflict',reason:'operation'});
});
test('cancellation requires an actual stop and retains the original planned destination',async()=>{
 const p=await fixture(),first=await save(p,departBody(p)),b={action:'cancel',reason:'Synthetic blocked road',trip:{actualStop:location('Synthetic actual turnaround')}};
 const r=await save(p,b,{id:first.id,expected:first.result.receipt.legVersionId});assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.legState,'cancelled');assert.deepEqual(r.result.receipt.leg.destination_snapshot,b.trip.actualStop);assert.deepEqual((await lookup(p,first.operation)).receipt.leg.destination_snapshot,first.body.trip.destination);
});
test('return and between-job travel are distinct physical legs with no automatic doubling',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p,{purpose:'between_jobs'})),second=await save(p,manualBody(p,{purpose:'return_to_base',departedAt:'2026-01-02T03:24:05.654321Z',arrivedAt:'2026-01-02T03:44:05.000001Z'}));assert.equal(first.result.state,'committed');assert.equal(second.result.state,'committed');assert.notEqual(first.id,second.id);assert.equal(await scalar('SELECT count(*)::int value FROM crest.current_travel_legs WHERE business_id=$1',[p.business]),2);assert.equal(await scalar('SELECT count(*)::int value FROM crest.mileage_evidence WHERE business_id=$1',[p.business]),0);
});
test('a paused job may retain supply travel but resume must wait for the actual trip to end',async()=>{
 const p=await fixture({job:true});await field(p,'direct_arrive');await field(p,'pause');const first=await save(p,departBody(p));assert.equal(first.result.state,'committed');
 const attempt=(await tx(web,()=>web.query('SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,randomUUID(),p.job,p.version,{action:'resume',reason:null}]))).rows[0].value;assert.notEqual(attempt.state,'committed');
 const closed=await save(p,arriveBody,{id:first.id,expected:first.result.receipt.legVersionId});assert.equal(closed.result.state,'committed');await field(p,'resume');assert.deepEqual(await lookup(p,first.operation),first.result);
});
test('active labor refuses an overlapping support trip and rolls back its operation',async()=>{
 const p=await fixture({job:true});await field(p,'direct_arrive');const before=await snapshot(p),r=await save(p,departBody(p));assert.deepEqual(r.result,{state:'conflict',reason:'occupancy'});await absent(p,r.operation);assert.deepEqual(await snapshot(p),before);
});
test('two real devices serialize simultaneous departures to one open physical leg',{timeout:30000},async()=>{
 const p=await fixture(),peer=await sandbox.connect(target);await peer.query('SET ROLE crest_web');const pids=[(await web.query('SELECT pg_backend_pid() pid')).rows[0].pid,(await peer.query('SELECT pg_backend_pid() pid')).rows[0].pid];let pending=[];
 try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||$1::text,0))",[p.business]);pending=[save(p,departBody(p)),save(p,departBody(p),{connection:peer})];let waiting=false;for(let i=0;i<80;i++){waiting=await scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock') value",[pids]);if(waiting)break;await delay(25);}assert(waiting);await client.query('COMMIT');const results=await Promise.all(pending);assert.equal(results.filter(r=>r.result.state==='committed').length,1);const loser=results.find(r=>r.result.state==='conflict');assert.equal(loser.result.reason,'occupancy');await absent(p,loser.operation);assert.equal(await scalar("SELECT count(*)::int value FROM crest.current_travel_legs WHERE business_id=$1 AND state='open'",[p.business]),1);}finally{await client.query('ROLLBACK');await Promise.allSettled(pending);await peer.end();}
});
test('manual retrospective travel retains effective and recorded time separately',async()=>{
 const p=await fixture(),r=await save(p,manualBody(p));assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.leg.departed_at,historical.departedAt);assert.equal(r.result.receipt.leg.arrived_at,historical.arrivedAt);assert(r.result.receipt.leg.created_at>historical.arrivedAt);assert.equal(r.result.receipt.leg.reason,r.body.reason);
});
test('reasoned corrections retain original values and exact fractional timestamps',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p)),r=await save(p,correctBody(first.result.receipt,{departedAt:'2026-01-02T03:00:00.000001Z',notes:'Synthetic corrected start'}),{id:first.id,expected:first.result.receipt.legVersionId});assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.leg.departed_at,'2026-01-02T03:00:00.000001Z');assert.equal(r.result.receipt.leg.replaces_id,first.result.receipt.legVersionId);assert.deepEqual(await lookup(p,first.operation),first.result);
});
test('an overlapping historical correction preserves the old projection on refusal',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p));await save(p,manualBody(p,{departedAt:'2026-01-02T03:30:00.000001Z',arrivedAt:'2026-01-02T03:50:00.000001Z'}));const before=await snapshot(p),r=await save(p,correctBody(first.result.receipt,{arrivedAt:'2026-01-02T03:40:00.000001Z'}),{id:first.id,expected:first.result.receipt.legVersionId});assert.deepEqual(r.result,{state:'conflict',reason:'occupancy'});await absent(p,r.operation);assert.deepEqual(await snapshot(p),before);
});
test('closed travel cannot silently reopen and old versions cannot be edited',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p)),before=await snapshot(p),r=await save(p,correctBody(first.result.receipt,{state:'open',arrivedAt:null}),{id:first.id,expected:first.result.receipt.legVersionId});assert.deepEqual(r.result,{state:'conflict',reason:'state'});await absent(p,r.operation);assert.deepEqual(await snapshot(p),before);
 await assert.rejects(client.query("UPDATE crest.travel_legs SET notes='overwrite' WHERE id=$1",[first.id]),e=>e.code==='55000');
});
test('invalid times reasons future values extra fields and custody purposes refuse without a receipt',async()=>{
 const p=await fixture();for(const b of [manualBody(p,{departedAt:'2026-02-30T01:00:00.000000Z'}),manualBody(p,{arrivedAt:'2026-01-02T03:00:00.000001Z'}),manualBody(p,{departedAt:'9999-01-02T03:00:00.000001Z'}),manualBody(p,{state:'open'}),{...manualBody(p),reason:null},{...departBody(p),extra:true},departBody(p,{purpose:'pickup'}),departBody(p,{purpose:'mobile_work_site'}),{action:'cancel',reason:' ',trip:{actualStop:location('Synthetic stop')}}]){const operation=randomUUID();await assert.rejects(save(p,b,{operation}),e=>e.code==='22023');await absent(p,operation);}
});
test('foreign legs jobs vehicles and invalid credentials cannot cross business boundaries',async()=>{
 const p=await fixture(),foreign=await fixture({job:true}),first=await save(foreign,manualBody(foreign));
 for(const [b,options,reason] of [[arriveBody,{id:first.id,expected:first.result.receipt.legVersionId},'version'],[departBody(p,{drivenVehicleId:foreign.rig}),{},'vehicle'],[departBody(p,{jobId:foreign.job}),{},'job']]){const r=await save(p,b,options);assert.deepEqual(r.result,{state:'conflict',reason});await absent(p,r.operation);}
 const auth=p.auth();auth[0]=randomBytes(32);await assert.rejects(save(p,departBody(p),{auth}),e=>e.code==='42501');assert.deepEqual(await lookup(p,first.operation),{state:'absent'});
});
test('trip corrections leave actual mileage evidence retained and explicitly needing review',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p)),body={source:'manual_actual',movementKind:'business_rig',actualMiles:'12.5000',estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:null,reason:null,allocationState:'unallocated',allocations:[]};
 const evidence=(await tx(web,()=>web.query('SELECT crest_commands.record_mileage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',[...p.auth(),p.epoch,randomUUID(),first.id,first.result.receipt.legVersionId,'0',body]))).rows[0].value;assert.equal(evidence.state,'committed');
 const r=await save(p,correctBody(first.result.receipt,{notes:'Synthetic route correction'}),{id:first.id,expected:first.result.receipt.legVersionId});assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.mileageReviewRequired,true);
 assert.equal(await scalar('SELECT count(*)::int value FROM crest.mileage_evidence WHERE business_id=$1 AND leg_version_id=$2 AND actual_miles=12.5',[p.business,first.result.receipt.legVersionId]),1);assert.notEqual(r.result.receipt.legVersionId,first.result.receipt.legVersionId);assert.deepEqual(await lookup(p,first.operation),first.result);
 assert.equal(await scalar('SELECT distance_status value FROM crest.current_mileage_evidence WHERE business_id=$1 AND leg_id=$2',[p.business,first.id]),'needs_review');
});
test('late COMMIT failure rolls back physical source projection audit and operation',async()=>{
 const p=await fixture(),before=await snapshot(p),operation=randomUUID();await client.query("CREATE FUNCTION pg_temp.refuse_support_trip() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1998',MESSAGE='SYNTHETIC_SUPPORT_COMMIT_REFUSAL'; END $$");await client.query('CREATE CONSTRAINT TRIGGER synthetic_support_refusal AFTER INSERT ON crest.travel_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_support_trip()');
 try{await assert.rejects(save(p,departBody(p),{operation}),e=>e.code==='P1998');}finally{await client.query('DROP TRIGGER synthetic_support_refusal ON crest.travel_legs');}await absent(p,operation);assert.deepEqual(await lookup(p,operation),{state:'absent'});assert.deepEqual(await snapshot(p),before);
});
test('forged persisted destination is refused below the UI with the whole operation rolled back',async()=>{
 const p=await fixture(),before=await snapshot(p),operation=randomUUID();await client.query("CREATE FUNCTION pg_temp.forge_support_destination() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.destination_snapshot:=jsonb_set(NEW.destination_snapshot,'{locationText}','\"Synthetic forged destination\"'); RETURN NEW; END $$");await client.query('CREATE TRIGGER synthetic_support_forgery BEFORE INSERT ON crest.travel_legs FOR EACH ROW EXECUTE FUNCTION pg_temp.forge_support_destination()');
 try{await assert.rejects(save(p,departBody(p),{operation}),e=>e.code==='23514'&&e.message==='CREST_SUPPORT_BODY_REQUIRED');}finally{await client.query('DROP TRIGGER synthetic_support_forgery ON crest.travel_legs');}await absent(p,operation);assert.deepEqual(await snapshot(p),before);
});
test('mobile work-site legs remain on their coupled field transition rather than support commands',async()=>{
 const p=await fixture({job:true}),r=await field(p,'depart'),before=await snapshot(p),attempt=await save(p,arriveBody,{id:r.receipt.travelLegId,expected:r.receipt.travelLegId});assert.deepEqual(attempt.result,{state:'conflict',reason:'leg'});await absent(p,attempt.operation);assert.deepEqual(await snapshot(p),before);await field(p,'arrive');
});
test('stale recovery epoch cannot authorize a new trip',async()=>{
 const p=await fixture(),operation=randomUUID();await assert.rejects(save(p,departBody(p),{operation,epoch:randomUUID()}),e=>e.message==='RECOVERY_REVIEW_REQUIRED');await absent(p,operation);
});
test('an archived driven vehicle cannot start a new trip but historical correction preserves it',async()=>{
 const p=await fixture(),first=await save(p,manualBody(p));
 // Existing CRM command records the archive, not a direct source overwrite.
 const b={label:'Synthetic support-trip rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:true,archiveReason:'Synthetic retired rig'};
 assert.equal((await tx(web,()=>web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',[...p.auth(),p.epoch,randomUUID(),p.rig,b]))).rows[0].value.state,'committed');
 assert.deepEqual((await save(p,departBody(p))).result,{state:'conflict',reason:'vehicle'});assert.equal((await save(p,correctBody(first.result.receipt,{notes:'Synthetic historical note'}),{id:first.id,expected:first.result.receipt.legVersionId})).result.state,'committed');
});
test('unknown finance schema refuses fresh trip writes while originals remain readable',async()=>{
 const p=await fixture(),operation=randomUUID(),before=await snapshot(p);await client.query('CREATE TABLE crest.synthetic_future_finance(id uuid)');try{await assert.rejects(save(p,departBody(p),{operation}),e=>e.code==='42501'&&e.message==='CREST_SUPPORT_SCHEMA_REVIEW_REQUIRED');assert.deepEqual(await lookup(main,original.operation),original.result);}finally{await client.query('DROP TABLE crest.synthetic_future_finance');}await absent(p,operation);assert.deepEqual(await snapshot(p),before);
});
test('genuine paused-job cancellation retains an actual supply trip until its independent arrival',async()=>{
 const p=await fixture({job:true});await field(p,'direct_arrive');await field(p,'pause');const first=await save(p,departBody(p));assert.equal(first.result.state,'committed');
 const operation=randomUUID(),body={reason:'Synthetic cancellation before any scope was fulfilled',noFulfilledScopeConfirmed:true,expectedWorkIntervalId:await scalar('SELECT id value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[p.business,p.job]),expectedOpenTravelLegVersionIds:[first.result.receipt.legVersionId],customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null},scope:(await client.query('SELECT DISTINCT source_allocation_id,plan_id,plan_sequence::text,entitlement_version_id FROM crest.current_scope_allocation_parts WHERE business_id=$1 AND job_id=$2 ORDER BY source_allocation_id',[p.business,p.job])).rows.map(r=>({sourceAllocationId:r.source_allocation_id,expectedPlanId:r.plan_id,expectedSequence:r.plan_sequence,entitlementVersionId:r.entitlement_version_id}))};
 const cancelled=(await tx(web,()=>web.query('SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',[...p.auth(),p.epoch,operation,p.job,p.version,body]))).rows[0].value;assert.equal(cancelled.state,'committed');assert.equal(await scalar('SELECT state value FROM crest.current_travel_legs WHERE business_id=$1 AND logical_id=$2',[p.business,first.id]),'open');
 const closed=await save(p,arriveBody,{id:first.id,expected:first.result.receipt.legVersionId});assert.equal(closed.result.state,'committed');assert.equal(await scalar('SELECT state value FROM crest.jobs WHERE id=$1',[p.job]),'cancelled');assert.deepEqual(await lookup(p,first.operation),first.result);
 assert.deepEqual((await tx(web,()=>web.query('SELECT crest_commands.lookup_unfulfilled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),operation]))).rows[0].value,cancelled);
});
