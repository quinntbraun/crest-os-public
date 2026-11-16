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

const signature='crest_private.job_work_end_context(uuid,uuid,uuid)';
const writer='crest_commands.correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)';
const reader='crest_commands.read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)';
const recovery='crest_commands.lookup_work_end_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
const sql=await readFile(new URL('../../planning/proposals/job-work-end-context.sql',import.meta.url),'utf8');
const writeSql=await readFile(new URL('../../planning/proposals/job-work-end-correction.sql',import.meta.url),'utf8');
const accessSql=await readFile(new URL('../../planning/proposals/job-work-end-access.sql',import.meta.url),'utf8');
let sandbox,client,web,login,fixtures;

async function value(connection,query,args=[]){return (await connection.query(query,args)).rows[0].value;}

async function observe(p,job=p.job){
 await client.query('BEGIN READ ONLY');
 try{
  await client.query('SET LOCAL ROLE crest_booking_owner');
  await client.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true)",[p.business,p.actor]);
  return await value(client,'SELECT crest_private.job_work_end_context($1,$2,$3) AS value',[p.business,p.actor,job]);
 }finally{await client.query('ROLLBACK');}
}

async function complete(p){
 const saved=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,await fixtures.completion(p),
 ]);
 assert.equal(saved.state,'committed');
 p.version=saved.receipt.jobVersion;
 return saved.receipt;
}

async function shift(instant,interval){
 return value(client,`SELECT to_char(($1::timestamptz+$2::interval) AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[instant,interval]);
}

async function correct(p,observed,correctedAt,operation=randomUUID()){
 return value(web,'SELECT crest_commands.correct_job_work_end($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) AS value',[
  ...p.auth(),p.epoch,operation,p.job,observed.jobVersion,observed.currentWork.id,observed.completionEventId,
  {correctedAt,reason:'Synthetic completion-time correction'},
 ]);
}

async function unchangedCompletion(p,completionEvent){
 return value(client,`SELECT jsonb_build_object(
  'job',to_jsonb(j)-ARRAY['completed_at','version','operation_id','updated_by','updated_at'],
  'originalEvent',(SELECT to_jsonb(e) FROM crest.job_events e WHERE e.business_id=j.business_id AND e.id=$2),
  'scope',(SELECT jsonb_agg(o ORDER BY o.id) FROM crest.work_scope_outcomes o WHERE o.business_id=j.business_id AND o.job_id=j.id),
  'review',(SELECT jsonb_agg(r ORDER BY r.id) FROM crest.review_requests r WHERE r.business_id=j.business_id AND r.job_id=j.id),
  'messages',(SELECT jsonb_agg(m ORDER BY m.id) FROM crest.messages m WHERE m.business_id=j.business_id),
  'finalization',(SELECT jsonb_agg(f ORDER BY f.id) FROM crest.job_finalization_tasks f WHERE f.business_id=j.business_id AND f.job_id=j.id)
 ) AS value FROM crest.jobs j WHERE j.id=$1`,[p.job,completionEvent]);
}

async function assertNoCorrection(operation){
 for(const table of ['crest_private.operations','crest_private.audit_events','crest.work_intervals','crest.job_events']){
  assert.equal(await value(client,'SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);
 }
}

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(61))).history.length,61);
 await client.query(sql);
 await client.query('BEGIN');
 try{
  await client.query("ALTER FUNCTION crest_private.field_source_stamp() SET statement_timeout='1s'");
  await assert.rejects(client.query(writeSql),{code:'42501',message:'CREST_WORK_END_SOURCE_REVIEW_REQUIRED'});
 }finally{await client.query('ROLLBACK');}
 await client.query(writeSql);
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,writer]),false);
 }
 await client.query('GRANT EXECUTE ON FUNCTION '+writer+' TO crest_web');
 login='crest_work_end_'+randomBytes(8).toString('hex');
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

test('limits the held completion lookup to its private role and returns nothing before completion',async()=>{
 const p=await fixtures.fixture();
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,signature]),false);
 }
 assert.equal(await value(client,'SELECT prosecdef AS value FROM pg_proc WHERE oid=$1::regprocedure',[signature]),false);
 assert.equal(await observe(p),null);
 await fixtures.field(p,'direct_arrive');
 assert.equal(await observe(p),null);
});

test('uses the exact final pause closed by the original completion event',async()=>{
 const p=await fixtures.fixture(),other=await fixtures.fixture();
 const started=(await fixtures.field(p,'direct_arrive')).receipt;
 const paused=(await fixtures.field(p,'pause')).receipt;
 const saved=await complete(p);
 const state=await observe(p);
 assert.equal(state.jobVersion,saved.jobVersion);
 assert.equal(state.completionOutcome,saved.completionOutcome);
 assert.equal(state.firstStartedAt,started.effectiveAt);
 assert.equal(state.originalCompletedAt,saved.completedAt);
 assert.equal(state.currentWork.id,saved.closedWorkIntervalId);
 assert.equal(state.currentWork.replaces_id,paused.workIntervalId);
 assert.equal(state.currentWork.kind,'pause');
 assert.equal(state.currentWork.ended_at,saved.completedAt);
 assert.equal(await value(client,'SELECT id AS value FROM crest.job_events WHERE business_id=$1 AND operation_id=$2',[p.business,saved.operationId]),state.completionEventId);
 assert.equal(await observe(other,p.job),null);
});

test('keeps the original completion and selects the exact later version of the final active interval',async()=>{
 const p=await fixtures.fixture();
 const started=(await fixtures.field(p,'direct_arrive')).receipt;
 const saved=await complete(p),before=await observe(p);
 assert.equal(before.currentWork.id,saved.closedWorkIntervalId);
 const correctedAt=await value(client,`SELECT to_char(($1::timestamptz-interval '1 microsecond') AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[started.effectiveAt]);
 const correction=await value(web,'SELECT crest_commands.correct_job_work_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) AS value',[
  ...p.auth(),p.epoch,randomUUID(),p.job,p.version,saved.closedWorkIntervalId,null,{correctedAt,reason:'Synthetic first start refined after completion'},
 ]);
 assert.equal(correction.state,'committed');
 const revised=await observe(p);
 assert.equal(revised.firstStartedAt,correctedAt);
 assert.equal(revised.jobVersion,correction.receipt.jobVersion);
 assert.equal(revised.completionEventId,before.completionEventId);
 assert.equal(revised.originalCompletedAt,saved.completedAt);
 assert.equal(revised.currentWork.id,correction.receipt.work.id);
 assert.equal(revised.currentWork.logical_id,started.workIntervalId);
 assert.equal(revised.currentWork.started_at,correctedAt);
 assert.equal(revised.currentWork.ended_at,saved.completedAt);
});

test('adjusts the final active interval in either direction and keeps the original completion evidence',async()=>{
 const p=await fixtures.fixture(),operation=randomUUID();
 await fixtures.field(p,'direct_arrive');
 const completion=await complete(p),observed=await observe(p);
 const earlier=await shift(completion.completedAt,'-1 microsecond');
 const later=await shift(completion.completedAt,'1 microsecond');
 const immutable=await unchangedCompletion(p,observed.completionEventId);
 assert.ok(immutable.originalEvent);
 assert.ok(immutable.scope?.length);
 assert.equal(immutable.review?.length,1);
 assert.equal(immutable.finalization?.length,1);
 const saved=await correct(p,observed,earlier,operation);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 assert.equal(saved.receipt.previousCompletedAt,completion.completedAt);
 assert.equal(saved.receipt.completionEventId,observed.completionEventId);
 assert.equal(saved.receipt.completionOutcome,completion.completionOutcome);
 assert.equal(saved.receipt.auditIds.length,3);
 assert.equal(saved.receipt.work.started_at,observed.currentWork.started_at);
 assert.equal(saved.receipt.work.ended_at,earlier);
 assert.equal(saved.receipt.work.replaces_id,observed.currentWork.id);
 const latest=await observe(p);
 assert.equal(latest.jobVersion,saved.receipt.jobVersion);
 assert.equal(latest.currentWork.id,saved.receipt.work.id);
 assert.equal(latest.originalCompletedAt,completion.completedAt);
 assert.equal(latest.firstStartedAt,observed.firstStartedAt);

 const invalid=await shift(latest.currentWork.started_at,'-1 microsecond');
 for(const [attempt,at,reason] of [
  [observed,later,'version'],
  [{...latest,completionEventId:randomUUID()},later,'version'],
  [{...latest,currentWork:observed.currentWork},later,'version'],
  [latest,invalid,'boundary'],
 ]){
  const refused=randomUUID();
  assert.deepEqual(await correct(p,attempt,at,refused),{state:'conflict',reason});
  await assertNoCorrection(refused);
 }
 const moved=await correct(p,latest,later);
 assert.equal(moved.state,'committed',JSON.stringify(moved));
 assert.equal(moved.receipt.work.ended_at,later);
 assert.equal(moved.receipt.work.replaces_id,saved.receipt.work.id);
 assert.deepEqual(await correct(p,observed,earlier,operation),saved);
 assert.deepEqual(await correct(p,observed,later,operation),{state:'conflict',reason:'operation'});
 assert.deepEqual(await unchangedCompletion(p,observed.completionEventId),immutable);
});

test('corrects the final pause without changing its reason or earlier active time',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'direct_arrive');
 await fixtures.field(p,'pause');
 const completed=await complete(p),before=await observe(p);
 const saved=await correct(p,before,before.currentWork.started_at);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 assert.equal(saved.receipt.work.kind,'pause');
 assert.equal(saved.receipt.work.pause_reason,before.currentWork.pause_reason);
 assert.equal(saved.receipt.work.ended_at,saved.receipt.work.started_at);
 assert.equal(saved.receipt.previousCompletedAt,completed.completedAt);
 assert.equal((await observe(p)).firstStartedAt,before.firstStartedAt);
});

test('rolls back a completion correction that would overlap later physical travel',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'direct_arrive');
 const completed=await complete(p),observed=await observe(p);
 const trip=fixtures.tripBody(p);
 trip.trip.departedAt=await shift(completed.completedAt,'1 microsecond');
 trip.trip.arrivedAt=await shift(completed.completedAt,'3 microseconds');
 const recorded=await value(web,'SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',[
  ...p.auth(),p.epoch,randomUUID(),randomUUID(),null,trip,
 ]);
 assert.equal(recorded.state,'committed',JSON.stringify(recorded));
 const operation=randomUUID();
 assert.deepEqual(await correct(p,observed,await shift(completed.completedAt,'2 microseconds'),operation),{state:'conflict',reason:'occupancy'});
 await assertNoCorrection(operation);
 assert.deepEqual(await observe(p),observed);
});

test('only exposes the signed-in final interval and recovers the exact original correction',async()=>{
 await client.query(accessSql);
 for(const role of ['crest_web','anon','authenticated','crest_export']){
  for(const routine of [reader,recovery]){
   assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') AS value",[role,routine]),false);
  }
 }
 await client.query('GRANT EXECUTE ON FUNCTION '+reader+' TO crest_web');
 const p=await fixtures.fixture(),other=await fixtures.fixture();
 const read=(who=p,job=p.job)=>value(web,'SELECT crest_commands.read_job_work_end($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...who.auth(),job]);
 const lookup=(original,who=p)=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...who.auth(),original]);
 assert.deepEqual(await read(),{state:'absent'});
 await fixtures.field(p,'direct_arrive');
 assert.deepEqual(await read(),{state:'absent'});
 const completed=await complete(p),observed=await observe(p);
 assert.deepEqual(await read(),{schemaVersion:1,businessId:p.business,jobId:p.job,jobVersion:observed.jobVersion,
  completionEventId:observed.completionEventId,workVersionId:observed.currentWork.id,
  originalCompletedAt:completed.completedAt,completedAt:completed.completedAt,
  finalIntervalStartedAt:observed.currentWork.started_at,finalIntervalKind:'active'});
 assert.deepEqual(await read(other),{state:'absent'});
 const operation=randomUUID(),original={schemaVersion:1,businessId:p.business,commandType:'operations.job.work_end.correct',
  reference:{operationId:operation,recoveryEpoch:p.epoch,jobId:p.job,expectedJobVersion:observed.jobVersion,
   workVersionId:observed.currentWork.id,completionEventId:observed.completionEventId}};
 assert.deepEqual(await lookup(original),{state:'absent'});
 const first=await correct(p,observed,await shift(completed.completedAt,'-1 microsecond'),operation);
 assert.equal(first.state,'committed');
 const current=await observe(p);
 const second=await correct(p,current,await shift(completed.completedAt,'1 microsecond'));
 assert.equal(second.state,'committed');
 assert.equal((await read()).originalCompletedAt,completed.completedAt);
 assert.equal((await read()).completedAt,second.receipt.correctedAt);
 assert.deepEqual(await lookup(original),{schemaVersion:1,original,result:{state:'committed',receipt:{schemaVersion:1,
  commandType:original.commandType,businessId:p.business,actorId:p.actor,operationId:operation,recoveryEpoch:p.epoch,
  subjectId:p.job,sourceRecordId:p.job,sourceVersion:first.receipt.jobVersion,sourceAuditIds:first.receipt.auditIds}}});
 for(const key of ['completionEventId','workVersionId']){
  assert.deepEqual(await lookup({...original,reference:{...original.reference,[key]:randomUUID()}}),{state:'conflict',reason:'operation'});
 }
 assert.deepEqual(await lookup({...original,businessId:other.business},other),{state:'absent'});
 await assert.rejects(lookup({...original,reference:{...original.reference,reason:'Not part of a recovery reference'}}),
  {code:'22023',message:'CREST_WORK_END_INPUT_REQUIRED'});

 const latest=await observe(p),discarded={...original,reference:{...original.reference,operationId:randomUUID(),
  expectedJobVersion:latest.jobVersion,workVersionId:latest.currentWork.id}};
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[
  ...p.auth(),p.epoch,discarded,'Synthetic owner discarded an uncommitted correction',
 ]);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await correct(p,latest,completed.completedAt,discarded.reference.operationId),{state:'conflict',reason:'operation'});
 assert.deepEqual(await observe(p),latest);
});

test('exports the original completion and append-only correction with their exact recorded times',async()=>{
 const p=await fixtures.fixture();
 await fixtures.field(p,'direct_arrive');
 const completed=await complete(p),observed=await observe(p);
 const correctedAt=await shift(completed.completedAt,'-1 microsecond');
 const saved=await correct(p,observed,correctedAt);
 assert.equal(saved.state,'committed');
 await client.query('SET ROLE crest_export');
 let source;
 try{source=await captureFieldWorkspaceFixture(client,p.business);}finally{await client.query('RESET ROLE');}
 const result=formatFieldWorkspaceSources(source),files=new Map(result.parts.map(part=>[part.name,part.content]));
 const rows=file=>{
  const [keys,...values]=readCustomerCsv(files.get(file));
  return values.map(row=>Object.fromEntries(keys.map((key,index)=>[key,row[index]])));
 };
 const intervals=rows('work_intervals.csv'),events=rows('job_events.csv');
 assert.equal(intervals.find(row=>row.id===completed.closedWorkIntervalId)?.ended_at,completed.completedAt);
 assert.equal(intervals.find(row=>row.id===saved.receipt.work.id)?.ended_at,correctedAt);
 assert.equal(events.find(row=>row.id===observed.completionEventId)?.effective_at,completed.completedAt);
 assert.equal(events.find(row=>row.id===saved.receipt.eventId)?.effective_at,correctedAt);
 assert.equal(rows('jobs.csv').find(row=>row.id===p.job)?.completed_at,correctedAt);
 const wrong=structuredClone(source);
 wrong.commercial.bookings.rows.job_events.find(row=>row.id===saved.receipt.eventId).effective_at=completed.completedAt;
 assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
});
