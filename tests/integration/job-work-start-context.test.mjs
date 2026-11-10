import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {captureFieldWorkspaceFixture} from '../support/field-workspace-source-fixture.mjs';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';

const signature='crest_private.job_work_start_context(uuid,uuid,uuid)';
const sql=await readFile(new URL('../../planning/proposals/job-work-start-context.sql',import.meta.url),'utf8');
const command='crest_commands.correct_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)';
const writeSql=await readFile(new URL('../../planning/proposals/job-work-start-correction.sql',import.meta.url),'utf8');
const accessSql=await readFile(new URL('../../planning/proposals/job-work-start-access.sql',import.meta.url),'utf8');
const readCommand='crest_commands.read_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)';
let sandbox,client,web,login,fixtures;

async function value(connection,query,args=[]){
 return (await connection.query(query,args)).rows[0].value;
}

async function context(p,business=p.business,actor=p.actor,job=p.job){
 await client.query('BEGIN READ ONLY');
 try{
  await client.query('SET LOCAL ROLE crest_booking_owner');
  await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[p.business,p.actor]);
  return await value(client,'SELECT crest_private.job_work_start_context($1,$2,$3) AS value',[business,actor,job]);
 }finally{
  await client.query('ROLLBACK');
 }
}

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(60))).history.length,60);
 await client.query(sql);
 login='crest_work_start_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());
 await web.query('SET ROLE crest_web');
 const accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 fixtures=createFieldOperationFixture({client,web,accepted});
},{timeout:240000});

after(async()=>{
 await web?.end();
 if(login)await sandbox.admin.query('DROP ROLE '+login);
 await sandbox?.close();
});

test('keeps the read internal and does not fabricate a start for a scheduled job',async()=>{
 const p=await fixtures.fixture();
 for(const role of ['crest_web','anon','authenticated']){
  assert.equal(await value(client,'SELECT has_function_privilege($1,$2,\'EXECUTE\') AS value',[role,signature]),false);
 }
 assert.equal(await value(client,'SELECT prosecdef AS value FROM pg_proc WHERE oid=$1::regprocedure',[signature]),false);
 assert.equal(await context(p),null);
});

test('retains direct arrival and selects the revised first interval after a pause',async()=>{
 const p=await fixtures.fixture();
 const arrived=(await fixtures.field(p,'direct_arrive')).receipt;
 const original=await context(p);
 assert.equal(original.currentWork.id,arrived.workIntervalId);
 assert.equal(original.originalStartedAt,arrived.effectiveAt);
 assert.equal(original.currentArrivalTrip,null);
 const paused=(await fixtures.field(p,'pause')).receipt;
 const revised=await context(p);
 assert.equal(revised.jobVersion,paused.jobVersion);
 assert.equal(revised.initialEventId,original.initialEventId);
 assert.equal(revised.originalStartedAt,arrived.effectiveAt);
 assert.equal(revised.currentWork.id,paused.closedWorkIntervalId);
 assert.equal(revised.currentWork.replaces_id,arrived.workIntervalId);
 assert.equal(revised.currentWork.ended_at,paused.effectiveAt);
 assert.equal(revised.currentArrivalTrip,null);
 assert.equal(await context(p,p.business,randomUUID()),null);
 const other=await fixtures.fixture();
 assert.equal(await context(p,other.business,other.actor,other.job),null);
});

test('binds only the arrival that actually started labor after an interrupted trip',async()=>{
 const p=await fixtures.fixture();
 const departed=(await fixtures.field(p,'depart')).receipt;
 assert.equal(await context(p),null);
 const appointment=structuredClone(p.booking.payload.appointment);
 for(const key of ['start_at','end_at','local_start','local_end'])appointment[key]=appointment[key].replace('2026-11-03','2026-11-06');
 const confirmedAt=await value(client,`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`);
 appointment.customer_confirmation={channel:'in_person',effectiveAt:confirmedAt,evidenceNote:'Synthetic confirmation of a replacement visit'};
 const appointmentId=await value(client,'SELECT current_appointment_id AS value FROM crest.jobs WHERE id=$1',[p.job]);
 const modeSequence=await value(client,'SELECT sequence::text AS value FROM crest.fulfillment_mode_versions WHERE business_id=$1 ORDER BY sequence DESC LIMIT 1',[p.business]);
 const stopped=await value(web,'SELECT crest_commands.interrupt_mobile_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,{
   action:'reschedule',reason:'Synthetic interrupted outbound trip',
   trip:{legId:departed.travelLegId,expectedLegVersionId:departed.travelLegId,
    actualStop:{schemaVersion:1,kind:'manual',locationText:'Synthetic stop',instructions:null}},
   expectedAppointmentId:appointmentId,expectedModeSequence:modeSequence,
   appointment,conflictReview:{expectedAppointmentIds:[],expectedUnknownTravel:false,overrideReason:null},
   customerCommunication:null,scope:await fixtures.scope(p),
  },
 ]);
 assert.equal(stopped.state,'committed',JSON.stringify(stopped));
 assert.equal(await context(p),null);
 p.version=stopped.receipt.jobVersion;
 const replacement=(await fixtures.field(p,'depart')).receipt;
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const saved=await context(p);
 assert.equal(saved.currentArrivalTrip.id,arrived.travelLegId);
 assert.equal(saved.currentArrivalTrip.logical_id,replacement.travelLegId);
 assert.notEqual(saved.currentArrivalTrip.logical_id,departed.travelLegId);
 assert.equal(saved.currentArrivalTrip.arrived_at,saved.currentWork.started_at);
 assert.equal(saved.originalStartedAt,arrived.effectiveAt);
 assert.equal(await value(client,'SELECT state AS value FROM crest.current_travel_legs WHERE business_id=$1 AND logical_id=$2',[p.business,departed.travelLegId]),'cancelled');
});

test('can review the original start after completion without changing the completed job',async()=>{
 const p=await fixtures.fixture();
 const arrived=(await fixtures.field(p,'direct_arrive')).receipt;
 const initial=await context(p);
 const completed=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,await fixtures.completion(p),
 ]);
 assert.equal(completed.state,'committed',JSON.stringify(completed));
 const before=await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]);
 const saved=await context(p);
 assert.equal(saved.initialEventId,initial.initialEventId);
 assert.equal(saved.originalStartedAt,arrived.effectiveAt);
 assert.equal(saved.currentWork.logical_id,arrived.workIntervalId);
 assert.equal(saved.jobVersion,before.version.toString());
 assert.equal(before.state,'completed');
 assert.deepEqual(await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]),before);
});

async function changeStart(p,observed,correctedAt,operation=randomUUID()){
 return value(web,'SELECT crest_commands.correct_job_work_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) AS value',[
  ...p.auth(),p.epoch,operation,p.job,observed.jobVersion,observed.currentWork.id,observed.currentArrivalTrip?.id??null,
  {correctedAt,reason:'Synthetic reviewed first-start correction'},
 ]);
}

async function shift(instant,by){
 return value(client,`SELECT to_char(($1::timestamptz+$2::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[instant,by]);
}

test('installs the held writer with no web capability and rejects altered predecessor settings',async()=>{
 await client.query('BEGIN');
 try{
  await client.query("ALTER FUNCTION crest_private.field_source_stamp() SET statement_timeout='1s'");
  await assert.rejects(client.query(writeSql),{code:'42501',message:'CREST_WORK_START_SOURCE_REVIEW_REQUIRED'});
 }finally{
  await client.query('ROLLBACK');
 }
 try{await client.query(writeSql);}catch(error){
  throw new Error([error.code,error.message,error.detail,error.where].filter(Boolean).join(' '),{cause:error});
 }
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[command]),false);
 // This test database alone grants execution to exercise the normal session boundary.
 await client.query('GRANT EXECUTE ON FUNCTION '+command+' TO crest_web');
});

test('corrects the direct first start on a completed job and retains the exact original result',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'direct_arrive');
 const completed=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,await fixtures.completion(p),
 ]);
 assert.equal(completed.state,'committed');
 const observed=await context(p),operation=randomUUID();
 const correctedAt=await shift(observed.originalStartedAt,'-1 microsecond');
 const before=await value(client,"SELECT to_jsonb(j)-ARRAY['first_work_at','version','operation_id','updated_at','updated_by'] AS value FROM crest.jobs j WHERE id=$1",[p.job]);
 const saved=await changeStart(p,observed,correctedAt,operation);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 assert.equal(saved.receipt.state,'completed');
 assert.equal(saved.receipt.previousStartedAt,observed.originalStartedAt);
 assert.equal(saved.receipt.work.started_at,correctedAt);
 assert.equal(saved.receipt.work.ended_at,observed.currentWork.ended_at);
 assert.equal(saved.receipt.arrival,null);
 assert.equal(saved.receipt.auditIds.length,3);
 assert.deepEqual(await value(client,"SELECT to_jsonb(j)-ARRAY['first_work_at','version','operation_id','updated_at','updated_by'] AS value FROM crest.jobs j WHERE id=$1",[p.job]),before);
 const next=await context(p),revisedAgain=await shift(correctedAt,'-1 microsecond');
 assert.equal((await changeStart(p,next,revisedAgain)).state,'committed');
 assert.deepEqual(await changeStart(p,observed,correctedAt,operation),saved);
 assert.deepEqual(await changeStart(p,observed,revisedAgain,operation),{state:'conflict',reason:'operation'});
 assert.equal((await context(p)).originalStartedAt,observed.originalStartedAt);
});

test('moves the linked arrival and active start both ways and rolls back a stale or invalid change',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'depart');
 await fixtures.field(p,'arrive');
 await fixtures.field(p,'pause');
 const observed=await context(p);
 const earlier=await shift(observed.originalStartedAt,'-1 microsecond');
 const later=await shift(observed.originalStartedAt,'1 microsecond');
 const saved=await changeStart(p,observed,earlier);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 assert.equal(saved.receipt.arrival.arrived_at,earlier);
 assert.equal(saved.receipt.arrival.departed_at,observed.currentArrivalTrip.departed_at);
 assert.equal(saved.receipt.work.started_at,earlier);
 assert.equal(saved.receipt.auditIds.length,4);
 const latest=await context(p);
 const beforeDeparture=await shift(latest.currentArrivalTrip.departed_at,'-1 microsecond');
 const afterPause=await shift(latest.currentWork.ended_at,'1 microsecond');
 for(const [bad,at,reason] of [
  [observed,later,'version'],[latest,beforeDeparture,'boundary'],[latest,afterPause,'boundary'],
 ]){
  const operation=randomUUID();
  assert.deepEqual(await changeStart(p,bad,at,operation),{state:'conflict',reason});
  for(const table of ['crest_private.operations','crest_private.audit_events','crest.work_intervals','crest.travel_legs','crest.job_events']){
   assert.equal(await value(client,'SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);
  }
 }
 assert.deepEqual(await context(p),latest);
 const moved=await changeStart(p,latest,later);
 assert.equal(moved.state,'committed',JSON.stringify(moved));
 assert.equal(moved.receipt.work.started_at,later);
 assert.equal(moved.receipt.arrival.arrived_at,later);
 assert.equal(moved.receipt.arrival.replaces_id,saved.receipt.arrival.id);
 assert.equal(moved.receipt.state,'paused');
 const zeroTrip=await changeStart(p,await context(p),latest.currentArrivalTrip.departed_at);
 assert.equal(zeroTrip.state,'committed');
 assert.equal(zeroTrip.receipt.arrival.arrived_at,zeroTrip.receipt.arrival.departed_at);
 const zeroWork=await changeStart(p,await context(p),latest.currentWork.ended_at);
 assert.equal(zeroWork.state,'committed');
 assert.equal(zeroWork.receipt.work.started_at,zeroWork.receipt.work.ended_at);
});

test('does not backdate active work into another recorded physical trip',async()=>{
 const p=await fixtures.fixture();
 const trip=fixtures.tripBody(p);
 const now=await value(client,`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`);
 trip.trip.departedAt=await shift(now,'-3 seconds');
 trip.trip.arrivedAt=await shift(now,'-1 second');
 const recorded=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),randomUUID(),null,trip,
 ]);
 assert.equal(recorded.state,'committed',JSON.stringify(recorded));
 await fixtures.field(p,'direct_arrive');
 const observed=await context(p),operation=randomUUID();
 assert.deepEqual(await changeStart(p,observed,await shift(now,'-2 seconds'),operation),{state:'conflict',reason:'occupancy'});
 assert.deepEqual(await context(p),observed);
 for(const table of ['crest_private.operations','crest_private.audit_events','crest.work_intervals','crest.travel_legs','crest.job_events']){
  assert.equal(await value(client,'SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);
 }
});

test('returns a minimal authorized observation and reconciles only the exact original',async()=>{
 await client.query(accessSql);
 assert.equal(await value(client,"SELECT has_function_privilege('crest_web',$1,'EXECUTE') AS value",[readCommand]),false);
 await client.query('GRANT EXECUTE ON FUNCTION '+readCommand+' TO crest_web');
 const p=await fixtures.fixture(),other=await fixtures.fixture();
 const read=(who=p,job=p.job)=>value(web,'SELECT crest_commands.read_job_work_start($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...who.auth(),job]);
 const lookup=(original,who=p)=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...who.auth(),original]);
 assert.deepEqual(await read(),{state:'absent'});
 const arrived=(await fixtures.field(p,'direct_arrive')).receipt;
 const observed=await read();
 assert.deepEqual(observed,{schemaVersion:1,businessId:p.business,jobId:p.job,jobVersion:arrived.jobVersion,
  originalStartedAt:arrived.effectiveAt,startedAt:arrived.effectiveAt,workVersionId:arrived.workIntervalId,workEndedAt:null,arrival:null});
 assert.deepEqual(await read(other),{state:'absent'});
 const operation=randomUUID(),original={schemaVersion:1,businessId:p.business,commandType:'operations.job.work_start.correct',
  reference:{operationId:operation,recoveryEpoch:p.epoch,jobId:p.job,expectedJobVersion:observed.jobVersion,
   workVersionId:observed.workVersionId,arrivalVersionId:null}};
 assert.deepEqual(await lookup(original),{state:'absent'});
 const moved=await changeStart(p,await context(p),await shift(observed.startedAt,'-1 microsecond'),operation);
 assert.equal(moved.state,'committed');
 const recovered=await lookup(original);
 assert.deepEqual(recovered,{schemaVersion:1,original,result:{state:'committed',receipt:{schemaVersion:1,
  commandType:original.commandType,businessId:p.business,actorId:p.actor,operationId:operation,recoveryEpoch:p.epoch,
  subjectId:p.job,sourceRecordId:p.job,sourceVersion:moved.receipt.jobVersion,sourceAuditIds:moved.receipt.auditIds}}});
 assert.deepEqual(await lookup({...original,reference:{...original.reference,workVersionId:randomUUID()}}),{state:'conflict',reason:'operation'});
 assert.deepEqual(await lookup({...original,reference:{...original.reference,arrivalVersionId:randomUUID()}}),{state:'conflict',reason:'operation'});
 assert.deepEqual(await lookup({...original,businessId:other.business},other),{state:'absent'});
 assert.equal((await read()).originalStartedAt,observed.originalStartedAt);

 const current=await context(p),retiredId=randomUUID();
 const discarded={...original,reference:{...original.reference,operationId:retiredId,expectedJobVersion:current.jobVersion,
  workVersionId:current.currentWork.id}};
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[
  ...p.auth(),p.epoch,discarded,'Synthetic owner reviewed and discarded the missing correction',
 ]);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await value(web,'SELECT crest_commands.lookup_original_operation_resolution($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[
  ...p.auth(),discarded,
 ]),retired);
 assert.deepEqual(await changeStart(p,current,await shift(current.currentWork.started_at,'-1 microsecond'),retiredId),{state:'conflict',reason:'operation'});
 assert.deepEqual(await context(p),current);
});

test('exports the linked first-start correction, its original event and its subsequent history',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'depart');
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 await fixtures.field(p,'pause');
 const before=await context(p),operation=randomUUID(),corrected=await shift(before.originalStartedAt,'-1 microsecond');
 const saved=await changeStart(p,before,corrected,operation);
 assert.equal(saved.state,'committed');
 p.version=saved.receipt.jobVersion;
 await fixtures.field(p,'resume');
 await client.query('SET ROLE crest_export');
 let source;
 try{source=await captureFieldWorkspaceFixture(client,p.business);}finally{await client.query('RESET ROLE');}
 const result=formatFieldWorkspaceSources(source);
 const files=new Map(result.parts.map(part=>[part.name,part.content]));
 const decode=(file)=>{
  const [keys,...rows]=readCustomerCsv(files.get(file));
  return rows.map(row=>Object.fromEntries(keys.map((key,index)=>[key,row[index]])));
 };
 const work=decode('work_intervals.csv'),trips=decode('travel_legs.csv'),events=decode('job_events.csv');
 assert.equal(work.find(row=>row.id===arrived.workIntervalId)?.started_at,before.originalStartedAt);
 assert.equal(work.find(row=>row.id===saved.receipt.work.id)?.started_at,corrected);
 assert.equal(trips.find(row=>row.id===arrived.travelLegId)?.arrived_at,before.originalStartedAt);
 assert.equal(trips.find(row=>row.id===saved.receipt.arrival.id)?.arrived_at,corrected);
 assert.equal(events.find(row=>row.id===before.initialEventId)?.effective_at,before.originalStartedAt);
 assert.equal(events.find(row=>row.id===saved.receipt.eventId)?.effective_at,corrected);
 assert.equal(events.find(row=>row.sequence===p.version)?.to_state,'in_progress');
 const mismatched=structuredClone(source);
 const changed=mismatched.commercial.bookings.rows.job_events.find(row=>row.id===saved.receipt.eventId);
 changed.effective_at=before.originalStartedAt;
 assert.throws(()=>formatFieldWorkspaceSources(mismatched),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
});
