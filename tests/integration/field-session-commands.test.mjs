// Actual restricted command/session authority over registered53 and the held
// field proposal. This does not claim an HTTP/MFA/product or release journey.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseJobWorkTime} from '../../src/operations/job-work-time-contract.ts';
const storage=await readFile(new URL('../../planning/proposals/field-time-storage.sql',import.meta.url),'utf8');
const commands=await readFile(new URL('../../planning/proposals/field-session-commands.sql',import.meta.url),'utf8');
let sandbox,client,web,login,restrictedTarget,accepted,f,other,second,firstReceipt,pauseReceipt,resumeReceipt,mobile,departure,arrival;
const scalar=async(q,args=[])=>(await client.query(q,args)).rows[0].value;
async function tx(c,run){await c.query('BEGIN');try{const r=await run();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
async function book(p,{later=false,mode='mobile',contact=null}={}){
 const q=confirmedBookingRequest(p);q.payload.fulfillmentMode=mode;if(contact)q.payload.appointment.contact_snapshot=contact;if(later){q.expectedModeSequence='1';for(const k of ['start_at','end_at','local_start','local_end'])q.payload.appointment[k]=q.payload.appointment[k].replace('2026-11-03','2026-11-04');}
 const r=await tx(web,()=>web.query('SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]));assert.equal(r.rows[0].value.state,'committed');return q.jobId;
}
before(async()=>{
 sandbox=await migrationSandbox();const target=await sandbox.database();client=await sandbox.connect(target);await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);assert.equal((await sandbox.apply(target,await sandbox.prefix(53))).history.length,53);
 login='crest_field_commands_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_web TO '+login);const url=new URL(target);url.username=login;url.password=password;restrictedTarget=url.toString();web=await sandbox.connect(restrictedTarget);await web.query('SET ROLE crest_web');
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await scalar("SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});f=await accepted();f.job=await book(f);const sibling=await accepted(f,{customerId:f.customer});second=await book(sibling,{later:true});other=await accepted();other.job=await book(other);
 await tx(client,()=>client.query(storage));try{await tx(client,()=>client.query(commands));}catch(error){throw new Error('CREST_FIELD_COMMAND_INSTALL_FAILED '+JSON.stringify({code:error.code,position:error.position,internalPosition:error.internalPosition,where:error.where}),{cause:error});}
},{timeout:240000});
after(async()=>{await web?.end();if(login)await sandbox.admin.query('DROP ROLE '+login);await sandbox?.close();});
async function change(p,action,version,{reason=action==='resume'?null:'Synthetic '+action+' evidence',operation=randomUUID(),job=p.job,body={action,reason},auth=p.auth(),connection=web}={}){
 const r=await tx(connection,()=>connection.query('SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[...auth,p.epoch,operation,job,version,body]));return {result:r.rows[0].value,operation,body};
}
async function lookup(p,operation){return (await tx(web,()=>web.query('SELECT crest_commands.lookup_field_session_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...p.auth(),operation]))).rows[0].value;}
const noOperation=async(p,operation)=>assert.equal(await scalar('SELECT count(*)::int AS value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[p.business,operation]),0);

const rigPayload=(archived=false)=>({label:'Synthetic Crest equipment rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived,archiveReason:archived?'Synthetic rig archived for refusal test':null});
async function newMobile({mode='mobile',contact={kind:'phone',value:'+12025550123'}}={}){const p=await accepted();p.job=await book(p,{mode,contact});p.rig=randomUUID();const r=await tx(web,()=>web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',[...p.auth(),p.epoch,randomUUID(),p.rig,rigPayload()]));assert.equal(r.rows[0].value.state,'committed');return p;}
const tripBody=(p,etaAt=null)=>({action:'depart',reason:null,trip:{drivenVehicleId:p.rig,origin:{schemaVersion:1,kind:'manual',locationText:'Synthetic equipment base',instructions:null},etaAt,notes:null}});

test('ordinary web still has no direct source writes or private field helper execution',async()=>{
 for(const relation of ['crest.work_intervals','crest.travel_legs','crest.operator_occupancy'])assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS value',['crest_web',relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE']),false);
 assert.equal(await scalar("SELECT has_function_privilege('crest_web','crest_private.check_field_session_graph(uuid,uuid,uuid)','EXECUTE') AS value"),false);
 assert.equal(await scalar('SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),53);
});
test('blank direct-arrival/pause reasons and unexpected body fields fail before mutation',async()=>{
 for(const body of [{action:'direct_arrive',reason:null},{action:'direct_arrive',reason:'  '},{action:'pause',reason:''},{action:'direct_arrive',reason:'Synthetic',effectiveAt:'2026-01-01T00:00:00Z'}]){
  const operation=randomUUID();await assert.rejects(change(f,body.action,1,{operation,body}),e=>e.code==='22023'&&e.message==='CREST_FIELD_INPUT_REQUIRED');await noOperation(f,operation);
 }
});
test('refuses invalid authority despite copied business/actor settings',async()=>{
 const auth=f.auth();auth[0]=randomBytes(32);await assert.rejects(change(f,'direct_arrive',1,{auth}),e=>e.code==='42501');assert.equal(await scalar('SELECT state AS value FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,f.job]),'scheduled');
});
test('a foreign principal cannot start another business job or observe its receipt',async()=>{
 const r=await change(other,'direct_arrive',1,{job:f.job});assert.deepEqual(r.result,{state:'conflict',reason:'job'});await noOperation(other,r.operation);
});
test('direct arrival commits a real interval, job event and explicit travel omission atomically',async()=>{
 firstReceipt=await change(f,'direct_arrive',1);const r=firstReceipt.result;assert.equal(r.state,'committed');assert.equal(r.receipt.state,'in_progress');assert.equal(r.receipt.jobVersion,'2');assert.equal(r.receipt.travelOmissionRecorded,true);assert.equal(r.receipt.auditIds.length,3);
 const j=(await client.query('SELECT state,first_work_at,version::text FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,f.job])).rows[0];assert.equal(j.state,'in_progress');assert.equal(j.version,'2');assert(j.first_work_at);assert.equal(await scalar('SELECT kind AS value FROM crest.current_work_intervals WHERE id=$1',[r.receipt.workIntervalId]),'active');assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[f.business]),0);
 assert.deepEqual(await lookup(f,firstReceipt.operation),r);assert.deepEqual(await lookup(other,firstReceipt.operation),{state:'absent'});
});
test('stale/new action keys and changed-body replays cannot bypass state/version checks',async()=>{
 const stale=await change(f,'pause',1);assert.deepEqual(stale.result,{state:'conflict',reason:'version'});await noOperation(f,stale.operation);
 const changed=await change(f,'direct_arrive',1,{operation:firstReceipt.operation,reason:'Different evidence'});assert.deepEqual(changed.result,{state:'conflict',reason:'operation'});
 const duplicate=await change(f,'direct_arrive',2);assert.deepEqual(duplicate.result,{state:'conflict',reason:'state'});await noOperation(f,duplicate.operation);
});
test('a second scheduled job cannot start while this operator has unfinished work',async()=>{
 const r=await change(f,'direct_arrive',1,{job:second});assert.deepEqual(r.result,{state:'conflict',reason:'occupancy'});await noOperation(f,r.operation);assert.equal(await scalar('SELECT state AS value FROM crest.jobs WHERE id=$1',[second]),'scheduled');
});
test('pause closes the actual interval and opens a reasoned pause at the same server instant',async()=>{
 pauseReceipt=await change(f,'pause',2);const r=pauseReceipt.result;assert.equal(r.state,'committed');assert.equal(r.receipt.state,'paused');assert.equal(r.receipt.auditIds.length,4);
 const closed=(await client.query('SELECT replaces_id,ended_at FROM crest.work_intervals WHERE id=$1',[r.receipt.closedWorkIntervalId])).rows[0],open=(await client.query('SELECT kind,started_at,pause_reason FROM crest.current_work_intervals WHERE id=$1',[r.receipt.workIntervalId])).rows[0];assert.equal(closed.replaces_id,firstReceipt.result.receipt.workIntervalId);assert.equal(closed.ended_at.toISOString(),open.started_at.toISOString());assert.equal(open.kind,'pause');assert.equal(open.pause_reason,pauseReceipt.body.reason);
 assert.equal(await scalar('SELECT ended_at AS value FROM crest.work_intervals WHERE id=$1',[firstReceipt.result.receipt.workIntervalId]),null);assert.equal(await scalar('SELECT isempty(occupied) AS value FROM crest.operator_occupancy WHERE work_interval_id=$1',[r.receipt.workIntervalId]),true);
});
test('resume retains the original first work instant and closes only its persisted pause',async()=>{
 const before=await scalar('SELECT first_work_at AS value FROM crest.jobs WHERE id=$1',[f.job]);resumeReceipt=await change(f,'resume',3);const r=resumeReceipt.result;assert.equal(r.state,'committed');assert.equal(r.receipt.state,'in_progress');assert.equal(r.receipt.jobVersion,'4');assert.equal((await scalar('SELECT first_work_at AS value FROM crest.jobs WHERE id=$1',[f.job])).toISOString(),before.toISOString());
 const closed=(await client.query('SELECT replaces_id,kind,ended_at FROM crest.work_intervals WHERE id=$1',[r.receipt.closedWorkIntervalId])).rows[0];assert.equal(closed.replaces_id,pauseReceipt.result.receipt.workIntervalId);assert.equal(closed.kind,'pause');assert(closed.ended_at);
 assert.deepEqual(await lookup(f,firstReceipt.operation),firstReceipt.result);assert.deepEqual(await lookup(f,pauseReceipt.operation),pauseReceipt.result);const replay=await change(f,'direct_arrive',1,{operation:firstReceipt.operation,body:firstReceipt.body});assert.deepEqual(replay.result,firstReceipt.result);
});
test('an independent operator can start without disturbing the first operator or initial booking commands',async()=>{
 const r=await change(other,'direct_arrive',1);assert.equal(r.result.state,'committed');assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.current_work_intervals WHERE ended_at IS NULL'),2);
 const fresh=await accepted();fresh.job=await book(fresh);assert.equal(await scalar('SELECT state AS value FROM crest.jobs WHERE id=$1',[fresh.job]),'scheduled');
});
test('a deferred COMMIT failure rolls back job, intervals, events, receipt and audit together',async()=>{
 const fresh=await accepted();fresh.job=await book(fresh);const operation=randomUUID();
 await client.query("CREATE FUNCTION pg_temp.field_test_commit_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1899',MESSAGE='SYNTHETIC_FIELD_COMMIT_REFUSAL'; END $$");
 await client.query('CREATE CONSTRAINT TRIGGER synthetic_field_commit_refusal AFTER INSERT ON crest.work_intervals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.field_test_commit_refusal()');
 try{await assert.rejects(change(fresh,'direct_arrive',1,{operation}),e=>e.code==='P1899'&&e.message==='SYNTHETIC_FIELD_COMMIT_REFUSAL');}finally{await client.query('DROP TRIGGER synthetic_field_commit_refusal ON crest.work_intervals');}
 await noOperation(fresh,operation);assert.equal(await scalar('SELECT state AS value FROM crest.jobs WHERE id=$1',[fresh.job]),'scheduled');for(const relation of ['crest.work_intervals','crest.job_events','crest_private.audit_events'])assert.equal(await scalar('SELECT count(*)::int AS value FROM '+relation+' WHERE operation_id=$1',[operation]),0);
});
test('two real command connections serialize to one durable start and one stale-version conflict',{timeout:20000},async()=>{
 const fresh=await accepted();fresh.job=await book(fresh);const peer=await sandbox.connect(restrictedTarget);await peer.query('SET ROLE crest_web');const pids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];let requests=[];
 try{
  await client.query('BEGIN');await client.query('SELECT crest_private.lock_booking_operator($1,$2)',[fresh.business,fresh.actor]);
  requests=[change(fresh,'direct_arrive',1),change(fresh,'direct_arrive',1,{connection:peer})];let waiting=false;
  for(let i=0;i<80;i++){waiting=await scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock') AS value",[pids]);if(waiting)break;await delay(25);}assert.equal(waiting,true,'at least one actual command must wait for a real lock before the competing commands proceed');
  await client.query('COMMIT');const results=await Promise.all(requests),saved=results.filter(x=>x.result.state==='committed'),stale=results.filter(x=>x.result.state==='conflict');assert.equal(saved.length,1);assert.equal(stale.length,1);assert.equal(stale[0].result.reason,'version');await noOperation(fresh,stale[0].operation);assert.deepEqual(await lookup(fresh,saved[0].operation),saved[0].result);
  assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.work_intervals WHERE business_id=$1',[fresh.business]),1);assert.equal(await scalar('SELECT version::text AS value FROM crest.jobs WHERE id=$1',[fresh.job]),'2');
 }finally{await client.query('ROLLBACK');await Promise.allSettled(requests);await peer.end();}
});
test('departure rejects missing trip, malformed ETA, incomplete origin and unexpected distance without mutations',async()=>{
 mobile=await newMobile();const base=tripBody(mobile);
 const bodies=[{action:'depart',reason:null},{...base,trip:null},{...base,trip:{...base.trip,etaAt:'2026-02-30T09:00:00.000000Z'}},{...base,trip:{...base.trip,etaAt:'2026-11-05T09:00:00Z'}},{...base,trip:{...base.trip,origin:{schemaVersion:1,kind:'manual',locationText:'',instructions:null}}},{...base,trip:{...base.trip,actualMiles:'0'}},{...base,trip:{...base.trip,etaSource:'gps'}}];
 for(const body of bodies){const operation=randomUUID();await assert.rejects(change(mobile,'depart',1,{operation,body}),e=>e.code==='22023'&&e.message==='CREST_FIELD_INPUT_REQUIRED');await noOperation(mobile,operation);}assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[mobile.business]),0);
});
test('Mobile departure saves actual rig, origin, job destination and approximate ETA without starting labor',async()=>{
 const eta=new Date(Date.now()+30*60000).toISOString().replace('.000Z','.000000Z').replace(/\.(\d{3})Z$/,'.$1000Z'),body=tripBody(mobile,eta);body.trip.notes='Synthetic internal travel note';departure=await change(mobile,'depart',1,{body});const r=departure.result;assert.equal(r.state,'committed');assert.equal(r.receipt.state,'en_route');assert.equal(r.receipt.workIntervalId,null);assert.equal(r.receipt.mileageStatus,'unresolved');assert.equal(r.receipt.auditIds.length,3);
 const leg=(await client.query('SELECT * FROM crest.current_travel_legs WHERE id=$1',[r.receipt.travelLegId])).rows[0];assert.equal(leg.driven_vehicle_id,mobile.rig);assert.equal(leg.purpose,'mobile_work_site');assert.deepEqual(leg.origin_snapshot,body.trip.origin);assert.deepEqual(leg.destination_snapshot,await scalar('SELECT work_location_snapshot AS value FROM crest.jobs WHERE id=$1',[mobile.job]));assert.equal(leg.state,'open');assert.equal(leg.arrived_at,null);assert.equal(leg.eta_source,'owner_entered');assert.equal(await scalar('SELECT first_work_at AS value FROM crest.jobs WHERE id=$1',[mobile.job]),null);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.work_intervals WHERE business_id=$1',[mobile.business]),0);
 const draft=r.receipt.etaDraft;assert.equal(draft.state,'prepared');assert.equal(draft.suppressionReason,null);assert.equal(draft.etaAt,eta);assert.equal(draft.kind,'mobile_arrival_eta');assert.equal(draft.travelLegId,leg.id);assert.equal(draft.recipientSnapshot.kind,'phone');assert.match(draft.bodyText,/Estimated arrival:/);assert.match(draft.bodyText,/approximate/);assert(!draft.bodyText.includes(body.trip.notes));assert.equal(Object.hasOwn(leg,'actual_miles'),false);
});
test('departure replay keeps one physical leg and its frozen prepared draft',async()=>{
 const replay=await change(mobile,'depart',1,{operation:departure.operation,body:departure.body});assert.deepEqual(replay.result,departure.result);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[mobile.business]),1);
 const changed=await change(mobile,'depart',1,{operation:departure.operation,body:{...departure.body,trip:{...departure.body.trip,etaAt:null}}});assert.deepEqual(changed.result,{state:'conflict',reason:'operation'});
});
test('an unfinished Mobile trip blocks another job and cannot start labor through the direct-arrival exception',async()=>{
 const sibling=await accepted(mobile,{customerId:mobile.customer}),job=await book(sibling,{later:true});
 for(const [action,body]of [['direct_arrive',{action:'direct_arrive',reason:'Synthetic arrival elsewhere'}],['depart',tripBody(mobile)]]){const r=await change(mobile,action,1,{job,body});assert.deepEqual(r.result,{state:'conflict',reason:'travel'});await noOperation(mobile,r.operation);}
 const bypass=await change(mobile,'direct_arrive',2);assert.deepEqual(bypass.result,{state:'conflict',reason:'state'});await noOperation(mobile,bypass.operation);
});
test('foreign and archived driven vehicles cannot create a departure',async()=>{
 const p=await newMobile(),body=tripBody(p);body.trip.drivenVehicleId=other.vehicle;const foreign=await change(p,'depart',1,{body});assert.deepEqual(foreign.result,{state:'conflict',reason:'vehicle'});await noOperation(p,foreign.operation);
 const archived=await tx(web,()=>web.query('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',[...p.auth(),p.epoch,randomUUID(),p.rig,rigPayload(true)]));assert.equal(archived.rows[0].value.state,'committed');const refused=await change(p,'depart',1,{body:tripBody(p)});assert.deepEqual(refused.result,{state:'conflict',reason:'vehicle'});await noOperation(p,refused.operation);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[p.business]),0);
});
test('unknown ETA remains null and prepares a neutral draft without an invented arrival or distance',async()=>{
 const p=await newMobile(),r=await change(p,'depart',1,{body:tripBody(p)});assert.equal(r.result.state,'committed');const draft=r.result.receipt.etaDraft;assert.equal(draft.etaAt,null);assert(!draft.bodyText.includes('Estimated arrival:'));assert.match(draft.bodyText,/arrival estimate/);
 const l=(await client.query('SELECT eta_at,eta_source,eta_calculated_at FROM crest.current_travel_legs WHERE id=$1',[r.result.receipt.travelLegId])).rows[0];assert.deepEqual(l,{eta_at:null,eta_source:null,eta_calculated_at:null});assert.equal(r.result.receipt.mileageStatus,'unresolved');assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[p.business]),1);
});
test('an explicit no-contact booking records skipped ETA outreach while still saving actual travel',async()=>{
 const p=await newMobile({contact:{kind:'no_contact',reason:'Synthetic customer requested no contact'}}),r=await change(p,'depart',1,{body:tripBody(p)});assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.state,'en_route');assert.equal(r.result.receipt.etaDraft.state,'skipped');assert.equal(r.result.receipt.etaDraft.suppressionReason,'no_contact');assert.equal(r.result.receipt.etaDraft.bodyText,null);assert.deepEqual(await lookup(p,r.operation),r.result);
});
test('current outreach opt-out suppresses the ETA draft without blocking travel or inventing Sent evidence',async()=>{
 const p=await newMobile(),payload={displayName:await scalar('SELECT display_name AS value FROM crest.customers WHERE id=$1',[p.customer]),phone:null,email:null,contactPreference:null,outreachOptOut:true,notes:null,customerSince:null,archived:false,archiveReason:null};const saved=await tx(web,()=>web.query('SELECT crest_commands.save_customer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) AS value',[...p.auth(),p.epoch,randomUUID(),p.customer,payload]));assert.equal(saved.rows[0].value.state,'committed');const r=await change(p,'depart',1,{body:tripBody(p)});assert.equal(r.result.state,'committed');assert.equal(r.result.receipt.etaDraft.state,'skipped');assert.equal(r.result.receipt.etaDraft.suppressionReason,'outreach_opt_out');assert.equal(r.result.receipt.etaDraft.bodyText,null);assert.equal(r.result.receipt.mileageStatus,'unresolved');
});
test('Arrived closes the actual trip and starts labor at its exact endpoint while retaining departure history',async()=>{
 arrival=await change(mobile,'arrive',2,{reason:null});const r=arrival.result;assert.equal(r.state,'committed');assert.equal(r.receipt.state,'in_progress');assert.equal(r.receipt.mileageStatus,'unresolved');assert.equal(r.receipt.etaDraft,null);assert.equal(r.receipt.travelOmissionRecorded,false);assert.equal(r.receipt.auditIds.length,4);
 const l=(await client.query('SELECT * FROM crest.travel_legs WHERE id=$1',[r.receipt.travelLegId])).rows[0];assert.equal(l.replaces_id,departure.result.receipt.travelLegId);assert.equal(l.state,'closed');assert.equal(l.sequence,'2');assert.equal(l.driven_vehicle_id,mobile.rig);assert.equal(await scalar('SELECT arrived_at AS value FROM crest.travel_legs WHERE id=$1',[l.replaces_id]),null);assert.equal(await scalar('SELECT w.started_at=l.arrived_at AS value FROM crest.work_intervals w JOIN crest.travel_legs l ON l.id=$2 WHERE w.id=$1',[r.receipt.workIntervalId,l.id]),true);assert.equal(await scalar('SELECT first_work_at=w.started_at AS value FROM crest.jobs j JOIN crest.work_intervals w ON w.job_id=j.id WHERE w.id=$1',[r.receipt.workIntervalId]),true);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.current_travel_legs WHERE business_id=$1 AND state=$2',[mobile.business,'open']),0);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.current_travel_legs WHERE business_id=$1',[mobile.business]),1);
});
test('saved departure and arrival receipts remain exact after later pause/resume without duplicate travel',async()=>{
 const pause=await change(mobile,'pause',3);assert.equal(pause.result.state,'committed');const resume=await change(mobile,'resume',4);assert.equal(resume.result.state,'committed');assert.deepEqual(await lookup(mobile,departure.operation),departure.result);assert.deepEqual(await lookup(mobile,arrival.operation),arrival.result);
 const replay=await change(mobile,'arrive',2,{operation:arrival.operation,body:arrival.body});assert.deepEqual(replay.result,arrival.result);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[mobile.business]),2);assert.equal(await scalar('SELECT version::text AS value FROM crest.jobs WHERE id=$1',[mobile.job]),'5');
});
test('Arrived cannot invent a departure for a scheduled job',async()=>{
 const p=await newMobile(),r=await change(p,'arrive',1,{reason:null});assert.deepEqual(r.result,{state:'conflict',reason:'state'});await noOperation(p,r.operation);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[p.business]),0);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.work_intervals WHERE business_id=$1',[p.business]),0);
});
test('Mobile travel cannot run on a Drop-Off booking or enable Pickup + Return',async()=>{
 const p=await newMobile({mode:'dropoff'}),r=await change(p,'depart',1,{body:tripBody(p)});assert.deepEqual(r.result,{state:'conflict',reason:'state'});await noOperation(p,r.operation);assert.equal(await scalar('SELECT pickup_return_enabled AS value FROM crest.fulfillment_mode_versions WHERE business_id=$1 ORDER BY sequence DESC LIMIT 1',[p.business]),false);
});
test('departure cannot overlap another active job even when the schedule itself was confirmed',async()=>{
 const p={...f,rig:f.vehicle},r=await change(p,'depart',1,{job:second,body:tripBody(p)});assert.deepEqual(r.result,{state:'conflict',reason:'occupancy'});await noOperation(p,r.operation);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[f.business]),0);
});
test('deferred departure failure rolls back travel, ETA draft, job and receipt before any external effect',async()=>{
 const p=await newMobile(),operation=randomUUID();await client.query("CREATE FUNCTION pg_temp.field_trip_commit_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1898',MESSAGE='SYNTHETIC_TRIP_COMMIT_REFUSAL'; END $$");await client.query('CREATE CONSTRAINT TRIGGER synthetic_trip_commit_refusal AFTER INSERT ON crest.travel_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.field_trip_commit_refusal()');
 try{await assert.rejects(change(p,'depart',1,{operation,body:tripBody(p)}),e=>e.code==='P1898');}finally{await client.query('DROP TRIGGER synthetic_trip_commit_refusal ON crest.travel_legs');}await noOperation(p,operation);assert.equal(await scalar('SELECT state AS value FROM crest.jobs WHERE id=$1',[p.job]),'scheduled');for(const table of ['crest.travel_legs','crest.work_intervals','crest.job_events','crest_private.audit_events'])assert.equal(await scalar('SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);assert.deepEqual(await lookup(p,operation),{state:'absent'});
});
test('two real departures serialize to one saved trip and one stale-version conflict',{timeout:20000},async()=>{
 const p=await newMobile(),peer=await sandbox.connect(restrictedTarget);await peer.query('SET ROLE crest_web');const pids=[(await web.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];let requests=[];
 try{await client.query('BEGIN');await client.query('SELECT crest_private.lock_booking_operator($1,$2)',[p.business,p.actor]);requests=[change(p,'depart',1,{body:tripBody(p)}),change(p,'depart',1,{body:tripBody(p),connection:peer})];let waiting=false;for(let i=0;i<80;i++){waiting=await scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock') AS value",[pids]);if(waiting)break;await delay(25);}assert.equal(waiting,true);await client.query('COMMIT');const results=await Promise.all(requests),saved=results.filter(x=>x.result.state==='committed'),stale=results.filter(x=>x.result.state==='conflict');assert.equal(saved.length,1);assert.equal(stale.length,1);assert.equal(stale[0].result.reason,'version');await noOperation(p,stale[0].operation);assert.equal(await scalar('SELECT count(*)::int AS value FROM crest.travel_legs WHERE business_id=$1',[p.business]),1);assert.deepEqual(await lookup(p,saved[0].operation),saved[0].result);
 }finally{await client.query('ROLLBACK');await Promise.allSettled(requests);await peer.end();}
});

test('saved work-time reader uses server time, scoped intervals and real authorization',async()=>{
 const proposal=await readFile(new URL('../../planning/proposals/job-work-time-reader.sql',import.meta.url),'utf8');
 await tx(client,()=>client.query(proposal));
 const p=await accepted();
 p.job=await book(p);
 const read=async(principal,job=p.job,auth=principal.auth())=>(await tx(web,()=>web.query(
  'SELECT crest_commands.read_job_work_time($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...auth,job]))).rows[0].value;
 const empty=parseJobWorkTime(await read(p),p.business,p.job);
 assert.equal(empty.record.jobState,'scheduled');
 assert.equal(empty.summary.elapsedMicroseconds,null);
 assert.deepEqual(await read(other),{state:'absent'});
 const invalid=p.auth();invalid[0]=randomBytes(32);
 await assert.rejects(read(p,p.job,invalid),{code:'42501'});
 assert.equal((await change(p,'direct_arrive','1')).result.state,'committed');
 assert.equal((await change(p,'pause','2',{reason:'Synthetic equipment check'})).result.state,'committed');
 const rawPaused=await read(p),paused=parseJobWorkTime(rawPaused,p.business,p.job);
 assert.equal(paused.record.jobVersion,'3');
 assert.equal(paused.summary.openInterval.kind,'pause');
 assert.equal(paused.intervals[0].endedAt,paused.intervals[1].startedAt);
 assert.equal(paused.intervals[1].pauseReason,'Synthetic equipment check');
 const closed=paused.intervals[0],original=paused.record.intervalVersions.find(row=>row.versionId===closed.replacesVersionId);
 assert(original&&original.endedAt===null&&original.changeKind==='open');
 assert.equal(paused.record.intervalVersions.length,3);
 assert.throws(()=>parseJobWorkTime({...rawPaused,intervalVersions:rawPaused.intervalVersions.filter(row=>row.versionId!==original.versionId)},p.business,p.job));
 assert.equal(paused.summary.closedActiveMicroseconds,paused.summary.observedActiveMicroseconds);
 assert.equal(paused.summary.unrecordedMicroseconds,'0');
 assert.equal((await change(p,'resume','3')).result.state,'committed');
 const resumed=parseJobWorkTime(await read(p),p.business,p.job);
 assert.equal(resumed.summary.openInterval.kind,'active');
 assert.equal(resumed.intervals.length,3);
 assert.equal(resumed.record.intervalVersions.length,5);
 assert.equal(resumed.summary.observedPauseMicroseconds,resumed.summary.closedPauseMicroseconds);
 assert(BigInt(resumed.summary.observedActiveMicroseconds)>=BigInt(paused.summary.observedActiveMicroseconds));
 const signature='crest_commands.read_job_work_time(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)';
 for(const role of ['anon','authenticated','crest_worker','crest_export']){
  assert.equal(await scalar('SELECT has_function_privilege($1,$2,$3) value',[role,signature,'EXECUTE']),false);
 }
});
