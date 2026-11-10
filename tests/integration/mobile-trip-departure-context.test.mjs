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

const signature='crest_private.mobile_trip_departure_context(uuid,uuid,uuid,uuid)';
const writer='crest_commands.correct_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)';
const reader='crest_commands.read_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)';
const recovery='crest_commands.lookup_mobile_departure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
const sql=await readFile(new URL('../../planning/proposals/mobile-trip-departure-context.sql',import.meta.url),'utf8');
const writeSql=await readFile(new URL('../../planning/proposals/mobile-trip-departure-correction.sql',import.meta.url),'utf8');
const accessSql=await readFile(new URL('../../planning/proposals/mobile-trip-departure-access.sql',import.meta.url),'utf8');
let sandbox,client,web,webOther,login,fixtures;
async function value(connection,query,args=[]){return (await connection.query(query,args)).rows[0].value;}

async function shift(instant,interval){
 return value(client,`SELECT to_char(($1::timestamptz+$2::interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[instant,interval]);
}

async function correct(p,context,correctedAt,operation=randomUUID(),connection=web){
 return value(connection,'SELECT crest_commands.correct_mobile_departure($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) AS value',[
  ...p.auth(),p.epoch,operation,p.job,context.jobVersion,context.currentTrip.logical_id,context.currentTrip.id,context.departureEventId,
  {correctedAt,reason:'Synthetic departure time correction'},
 ]);
}

async function noWrite(operation){
 for(const table of ['crest_private.operations','crest_private.audit_events','crest.travel_legs','crest.job_events']){
  assert.equal(await value(client,'SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);
 }
}

async function observe(p,leg,job=p.job){
 await client.query('BEGIN READ ONLY');
 try{
  await client.query('SET LOCAL ROLE crest_booking_owner');
  await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[p.business,p.actor]);
  return await value(client,'SELECT crest_private.mobile_trip_departure_context($1,$2,$3,$4) AS value',[p.business,p.actor,job,leg]);
 }finally{await client.query('ROLLBACK');}
}

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(62))).history.length,62);
 await client.query(sql);
 await client.query('BEGIN');
 try{
  await client.query("ALTER FUNCTION crest_private.field_source_stamp() SET statement_timeout='1s'");
  await assert.rejects(client.query(writeSql),{code:'42501',message:'CREST_MOBILE_DEPARTURE_SOURCE_REVIEW_REQUIRED'});
 }finally{await client.query('ROLLBACK');}
 await client.query(writeSql);
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,writer]),false);
 }
 await client.query('GRANT EXECUTE ON FUNCTION '+writer+' TO crest_web');
 login='crest_mobile_departure_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());
 await web.query('SET ROLE crest_web');
 webOther=await sandbox.connect(url.toString());
 await webOther.query('SET ROLE crest_web');
 const accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,
  "SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
 fixtures=createFieldOperationFixture({client,web,accepted});
},{timeout:240000});

after(async()=>{
 await webOther?.end();
 await web?.end();
 if(login)await sandbox.admin.query('DROP ROLE '+login);
 await sandbox?.close();
});

test('keeps departure evidence private and excludes unknown, standalone, and foreign trips',async()=>{
 const p=await fixtures.fixture(),other=await fixtures.fixture();
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,signature]),false);
 }
 assert.equal(await value(client,'SELECT prosecdef AS value FROM pg_proc WHERE oid=$1::regprocedure',[signature]),false);
 assert.equal(await observe(p,randomUUID()),null);
 const supportLeg=randomUUID();
 assert.equal((await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),supportLeg,null,fixtures.tripBody(p),
 ])).state,'committed');
 assert.equal(await observe(p,supportLeg),null);
 const departure=(await fixtures.field(p,'depart')).receipt;
 assert.equal(await observe(other,departure.travelLegId,p.job),null);
 assert.equal(await observe(p,departure.travelLegId,other.job),null);
});

test('returns the exact original departure across an open trip, arrival, and later arrival correction',async()=>{
 const p=await fixtures.fixture();
 const departure=(await fixtures.field(p,'depart')).receipt;
 const opened=await observe(p,departure.travelLegId);
 assert.equal(opened.jobVersion,departure.jobVersion);
 assert.equal(opened.originalDepartedAt,departure.effectiveAt);
 assert.equal(opened.currentTrip.id,departure.travelLegId);
 assert.equal(opened.currentTrip.state,'open');
 assert.equal(opened.currentTrip.arrived_at,null);
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const closed=await observe(p,departure.travelLegId);
 assert.equal(closed.departureEventId,opened.departureEventId);
 assert.equal(closed.currentTrip.state,'closed');
 assert.equal(closed.currentTrip.id,arrived.travelLegId);
 assert.equal(closed.currentTrip.departed_at,opened.originalDepartedAt);
 assert.equal(closed.currentTrip.arrived_at,arrived.effectiveAt);
 const correctedAt=await value(client,`SELECT to_char(($1::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[arrived.effectiveAt]);
 const revised=await value(web,'SELECT crest_commands.correct_job_work_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,arrived.workIntervalId,arrived.travelLegId,
  {correctedAt,reason:'Synthetic arrival time correction'},
 ]);
 assert.equal(revised.state,'committed');
 const latest=await observe(p,departure.travelLegId);
 assert.equal(latest.departureEventId,opened.departureEventId);
 assert.equal(latest.currentTrip.id,revised.receipt.arrival.id);
 assert.equal(latest.originalDepartedAt,opened.originalDepartedAt);
 assert.equal(latest.currentTrip.arrived_at,correctedAt);
});

test('separates the stopped trip from the later departure for a confirmed replacement visit',async()=>{
 const p=await fixtures.fixture();
 const departure=(await fixtures.field(p,'depart')).receipt;
 const opened=await observe(p,departure.travelLegId);
 const appointment=structuredClone(p.booking.payload.appointment);
 for(const key of ['start_at','end_at','local_start','local_end'])appointment[key]=appointment[key].replace('2026-11-03','2026-11-06');
 appointment.customer_confirmation={channel:'in_person',effectiveAt:new Date(Date.now()-1000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),
  evidenceNote:'Synthetic customer confirmed replacement visit'};
 const stop={schemaVersion:1,kind:'manual',locationText:'Synthetic actual stop',instructions:null};
 const body={action:'reschedule',reason:'Synthetic interrupted trip',trip:{legId:departure.travelLegId,
  expectedLegVersionId:departure.travelLegId,actualStop:stop},
  expectedAppointmentId:await value(client,'SELECT current_appointment_id AS value FROM crest.jobs WHERE id=$1',[p.job]),
  expectedModeSequence:'1',appointment,conflictReview:{expectedAppointmentIds:[],expectedUnknownTravel:false,overrideReason:null},
  customerCommunication:null,scope:await fixtures.scope(p)};
 const rescheduled=await value(web,'SELECT crest_commands.interrupt_mobile_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,body,
 ]);
 assert.equal(rescheduled.state,'committed',JSON.stringify(rescheduled));
 p.version=rescheduled.receipt.jobVersion;
 const newDeparture=(await fixtures.field(p,'depart')).receipt;
 const stopped=await observe(p,departure.travelLegId),next=await observe(p,newDeparture.travelLegId);
 assert.equal(stopped.departureEventId,opened.departureEventId);
 assert.equal(stopped.originalDepartedAt,opened.originalDepartedAt);
 assert.equal(stopped.currentTrip.id,rescheduled.receipt.closedLegVersionId);
 assert.equal(stopped.currentTrip.state,'cancelled');
 assert.deepEqual(stopped.currentTrip.destination_snapshot,stop);
 assert.notEqual(next.departureEventId,stopped.departureEventId);
 assert.equal(next.currentTrip.id,newDeparture.travelLegId);
 assert.equal(next.currentTrip.state,'open');
 const historical=await correct(p,stopped,await shift(stopped.originalDepartedAt,'-1 microsecond'));
 assert.equal(historical.state,'committed',JSON.stringify(historical));
 assert.equal(historical.receipt.leg.state,'cancelled');
 assert.deepEqual(historical.receipt.leg.destination_snapshot,stop);
 assert.equal(historical.receipt.leg.arrived_at,stopped.currentTrip.arrived_at);
 assert.deepEqual(await observe(p,newDeparture.travelLegId),next);
});

test('only one correction wins a concurrent open-trip edit and ordinary arrival still works',async()=>{
 const p=await fixtures.fixture(),departure=(await fixtures.field(p,'depart')).receipt;
 const before=await observe(p,departure.travelLegId),job=await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]);
 const operation=randomUUID(),otherOperation=randomUUID();
 const earlier=await shift(before.originalDepartedAt,'-1 microsecond'),later=await shift(before.originalDepartedAt,'1 microsecond');
 const results=await Promise.all([correct(p,before,earlier,operation),correct(p,before,later,otherOperation,webOther)]);
 assert.equal(results.filter(result=>result.state==='committed').length,1,JSON.stringify(results));
 const first=results[0].state==='committed',saved=results[first?0:1];
 assert.deepEqual(results[first?1:0],{state:'conflict',reason:'version'});
 await noWrite(first?otherOperation:operation);
 assert.equal(saved.receipt.auditIds.length,1);
 assert.equal(saved.receipt.leg.state,'open');
 assert.equal(saved.receipt.leg.arrived_at,null);
 assert.equal(saved.receipt.leg.departed_at,first?earlier:later);
 assert.deepEqual(await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]),job);
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const latest=await observe(p,departure.travelLegId);
 assert.equal(latest.currentTrip.id,arrived.travelLegId);
 assert.equal(latest.currentTrip.replaces_id,saved.receipt.leg.id);
 assert.equal(latest.currentTrip.departed_at,saved.receipt.leg.departed_at);
 assert.equal(latest.currentTrip.arrived_at,arrived.effectiveAt);
 assert.deepEqual(await correct(p,before,first?earlier:later,first?operation:otherOperation),saved);
 assert.deepEqual(await correct(p,before,first?later:earlier,first?operation:otherOperation),{state:'conflict',reason:'operation'});
});

test('retains actual mileage and arrival while requiring review on the corrected leg version',async()=>{
 const p=await fixtures.fixture(),departure=(await fixtures.field(p,'depart')).receipt;
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const before=await observe(p,departure.travelLegId),leg=before.currentTrip;
 const savedMiles=await value(web,'SELECT crest_commands.record_mileage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,0,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),departure.travelLegId,leg.id,{source:'manual_actual',movementKind:'business_rig',actualMiles:'2.5000',
   estimateMiles:null,estimateSource:null,odometerStart:null,odometerEnd:null,notes:null,reason:null,allocationState:'unallocated',allocations:[]},
 ]);
 assert.equal(savedMiles.state,'committed',JSON.stringify(savedMiles));
 const evidence=await value(client,'SELECT to_jsonb(e) AS value FROM crest.mileage_evidence e WHERE id=$1',[savedMiles.receipt.evidenceId]);
 const refused=randomUUID();
 assert.deepEqual(await correct(p,before,await shift(arrived.effectiveAt,'1 microsecond'),refused),{state:'conflict',reason:'boundary'});
 await noWrite(refused);
 const saved=await correct(p,before,await shift(leg.departed_at,'-1 microsecond'));
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 assert.equal(saved.receipt.leg.arrived_at,arrived.effectiveAt);
 assert.equal(saved.receipt.mileageReviewRequired,true);
 assert.equal(await value(client,'SELECT distance_status AS value FROM crest.current_mileage_evidence WHERE leg_id=$1',[departure.travelLegId]),'needs_review');
 assert.deepEqual(await value(client,'SELECT to_jsonb(e) AS value FROM crest.mileage_evidence e WHERE id=$1',[savedMiles.receipt.evidenceId]),evidence);
 assert.equal(await value(client,'SELECT to_char(first_work_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS value FROM crest.jobs WHERE id=$1',[p.job]),arrived.effectiveAt);
});

test('rolls back a correction that would overlap another physical trip',async()=>{
 const p=await fixtures.fixture(),support=fixtures.tripBody(p),past=await value(client,`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`);
 support.trip.departedAt=await shift(past,'-3 seconds');
 support.trip.arrivedAt=await shift(past,'-1 second');
 assert.equal((await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),randomUUID(),null,support,
 ])).state,'committed');
 const departure=(await fixtures.field(p,'depart')).receipt;
 const before=await observe(p,departure.travelLegId),operation=randomUUID();
 assert.deepEqual(await correct(p,before,await shift(past,'-2 seconds'),operation),{state:'conflict',reason:'occupancy'});
 await noWrite(operation);
 assert.deepEqual(await observe(p,departure.travelLegId),before);
});

test('uses a private signed-in observation and recovers the exact original across later arrival',async()=>{
 await client.query(accessSql);
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  for(const routine of [reader,recovery]){
   assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,routine]),false);
  }
 }
 await client.query('GRANT EXECUTE ON FUNCTION '+reader+' TO crest_web');
 const p=await fixtures.fixture(),other=await fixtures.fixture(),departed=(await fixtures.field(p,'depart')).receipt;
 const read=(who=p)=>value(web,'SELECT crest_commands.read_mobile_departure($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',[
  ...who.auth(),p.job,departed.travelLegId,
 ]);
 const lookup=(original,who=p)=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[
  ...who.auth(),original,
 ]);
 const observed=await observe(p,departed.travelLegId);
 assert.deepEqual(await read(),{schemaVersion:1,businessId:p.business,jobId:p.job,jobVersion:p.version,
  legId:departed.travelLegId,legVersionId:departed.travelLegId,departureEventId:observed.departureEventId,
  originalDepartedAt:departed.effectiveAt,departedAt:departed.effectiveAt,arrivedAt:null,legState:'open'});
 assert.deepEqual(await read(other),{state:'absent'});
 const operation=randomUUID(),original={schemaVersion:1,businessId:p.business,commandType:'operations.mobile_departure.correct',
  reference:{operationId:operation,recoveryEpoch:p.epoch,jobId:p.job,expectedJobVersion:p.version,
   legId:departed.travelLegId,legVersionId:observed.currentTrip.id,departureEventId:observed.departureEventId}};
 assert.deepEqual(await lookup(original),{state:'absent'});
 const correctedAt=await shift(departed.effectiveAt,'-1 microsecond');
 const saved=await correct(p,observed,correctedAt,operation);
 assert.equal(saved.state,'committed');
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const latest=await read();
 assert.equal(latest.originalDepartedAt,departed.effectiveAt);
 assert.equal(latest.departedAt,correctedAt);
 assert.equal(latest.arrivedAt,arrived.effectiveAt);
 assert.equal(latest.legState,'closed');
 assert.deepEqual(await lookup(original),{schemaVersion:1,original,result:{state:'committed',receipt:{schemaVersion:1,
  commandType:original.commandType,businessId:p.business,actorId:p.actor,operationId:operation,recoveryEpoch:p.epoch,
  subjectId:departed.travelLegId,sourceRecordId:saved.receipt.leg.id,sourceVersion:saved.receipt.leg.sequence,
  sourceAuditIds:saved.receipt.auditIds}}});
 for(const key of ['legId','legVersionId','departureEventId']){
  assert.deepEqual(await lookup({...original,reference:{...original.reference,[key]:randomUUID()}}),{state:'conflict',reason:'operation'});
 }
 assert.deepEqual(await lookup({...original,businessId:other.business},other),{state:'absent'});
 await assert.rejects(lookup({...original,reference:{...original.reference,reason:'Private draft'}}),
  {code:'22023',message:'CREST_MOBILE_DEPARTURE_INPUT_REQUIRED'});

 const discarded={...original,reference:{...original.reference,operationId:randomUUID(),expectedJobVersion:latest.jobVersion,
  legVersionId:latest.legVersionId}};
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[
  ...p.auth(),p.epoch,discarded,'Synthetic owner discarded an uncommitted correction',
 ]);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await correct(p,await observe(p,departed.travelLegId),departed.effectiveAt,discarded.reference.operationId),
  {state:'conflict',reason:'operation'});
 assert.deepEqual(await read(),latest);
});

test('exports both Mobile departure times, retained arrival and the original departure event',async()=>{
 const p=await fixtures.fixture(),departure=(await fixtures.field(p,'depart')).receipt;
 const arrived=(await fixtures.field(p,'arrive')).receipt;
 const before=await observe(p,departure.travelLegId),correctedAt=await shift(departure.effectiveAt,'-1 microsecond');
 const saved=await correct(p,before,correctedAt);
 assert.equal(saved.state,'committed');
 await client.query('SET ROLE crest_export');
 let source;
 try{source=await captureFieldWorkspaceFixture(client,p.business);}finally{await client.query('RESET ROLE');}
 const result=formatFieldWorkspaceSources(source),files=new Map(result.parts.map(part=>[part.name,part.content]));
 const rows=file=>{
  const [keys,...values]=readCustomerCsv(files.get(file));
  return values.map(row=>Object.fromEntries(keys.map((key,index)=>[key,row[index]])));
 };
 const legs=rows('travel_legs.csv'),events=rows('job_events.csv');
 assert.equal(legs.find(row=>row.id===departure.travelLegId)?.departed_at,departure.effectiveAt);
 assert.equal(legs.find(row=>row.id===arrived.travelLegId)?.arrived_at,arrived.effectiveAt);
 assert.equal(legs.find(row=>row.id===saved.receipt.leg.id)?.departed_at,correctedAt);
 assert.equal(legs.find(row=>row.id===saved.receipt.leg.id)?.arrived_at,arrived.effectiveAt);
 assert.equal(events.find(row=>row.id===before.departureEventId)?.effective_at,departure.effectiveAt);
 const wrong=structuredClone(source);
 wrong.field.rows.travel_legs.find(row=>row.id===saved.receipt.leg.id).departed_at=departure.effectiveAt;
 assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
});
