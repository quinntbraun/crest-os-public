import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {parseJobWorkTime} from '../../src/operations/job-work-time-contract.ts';
import {requireSyntheticWorkBoundary} from '../../scripts/synthetic-migrations.mjs';

const sql=await readFile(new URL('../../planning/proposals/job-work-boundary-correction.sql',import.meta.url),'utf8');
const kind='operations.job.work_boundary.correct';
const signature='crest_commands.correct_job_work_boundary(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)';
let sandbox,target,client,web,connectionString,login,accepted;

async function tx(connection,action){
 await connection.query('BEGIN');
 try{
  const result=await action();
  await connection.query('COMMIT');
  return result;
 }catch(error){
  await connection.query('ROLLBACK');
  throw error;
 }
}
async function value(connection,query,args=[]){
 return (await connection.query(query,args)).rows[0].value;
}
async function call(query,args,connection=web){return tx(connection,()=>value(connection,query,args));}
async function newWeb(){
 const connection=await sandbox.connect(connectionString);
 await connection.query('SET ROLE crest_web');
 return connection;
}
before(async()=>{
 sandbox=await migrationSandbox();
 target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(59))).history.length,59);
 login='crest_work_boundary_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;connectionString=url.toString();
 web=await newWeb();
 accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,"SELECT id AS value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
},{timeout:240000});
after(async()=>{
 await web?.end();
 if(login)await sandbox.admin.query('DROP ROLE '+login);
 await sandbox?.close();
});

async function job(){
 const p=await accepted();
 const q=confirmedBookingRequest(p);q.payload.fulfillmentMode='mobile';
 const saved=await call('SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
  [...p.auth(),p.epoch,q.operationId,q.jobId,q.expectedModeSequence,q.payload]);
 assert.equal(saved.state,'committed');
 return {...p,job:q.jobId};
}
async function change(p,action,expectedVersion,reason){
 const result=await call('SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) AS value',
  [...p.auth(),p.epoch,randomUUID(),p.job,expectedVersion,{action,reason}]);
 assert.equal(result.state,'committed');
 return result;
}
async function read(p){
 return parseJobWorkTime(await call('SELECT crest_commands.read_job_work_time($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',
  [...p.auth(),p.job]),p.business,p.job);
}
async function paused(){
 const p=await job();
 await change(p,'direct_arrive','1','Synthetic direct arrival');
 await client.query('SELECT pg_sleep(0.02)');
 await change(p,'pause','2','Synthetic equipment check');
 await client.query('SELECT pg_sleep(0.02)');
 return p;
}
async function shift(at,offset){
 return value(client,`SELECT to_char(($1::timestamptz+$2::interval) AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`,[at,offset]);
}
function request(snapshot,correctedAt){
 return {version:snapshot.record.jobVersion,left:snapshot.intervals[0].versionId,right:snapshot.intervals[1].versionId,
  operation:randomUUID(),body:{correctedAt,reason:'Synthetic timer correction'}};
}
async function correct(p,observed,{connection=web,auth=p.auth(),jobId=p.job}={}){
 return call('SELECT crest_commands.correct_job_work_boundary($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) AS value',
  [...auth,p.epoch,observed.operation,jobId,observed.version,observed.left,observed.right,observed.body],connection);
}
function original(p,observed){
 return {schemaVersion:1,businessId:p.business,commandType:kind,reference:{operationId:observed.operation,
  recoveryEpoch:p.epoch,jobId:p.job,expectedJobVersion:observed.version,leftVersionId:observed.left,rightVersionId:observed.right}};
}
async function lookup(p,reference){
 return call('SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...p.auth(),reference]);
}
async function absent(operation){
 for(const table of ['crest_private.operations','crest_private.audit_events','crest.work_intervals','crest.job_events']){
  assert.equal(await value(client,'SELECT count(*)::int AS value FROM '+table+' WHERE operation_id=$1',[operation]),0);
 }
}

test('rejects predecessor drift and adopts the exact reviewed correction without changing the previous migration history',async()=>{
 await assert.rejects(requireSyntheticWorkBoundary(connectionString),{message:'SYNTHETIC_WORK_BOUNDARY_MIGRATION_REQUIRED'});
 for(const mutation of [
  'ALTER FUNCTION crest_private.field_source_stamp() SET statement_timeout=\'1s\'',
  'GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb) TO PUBLIC',
 ]){
  await client.query('BEGIN');
  try{
   await client.query(mutation);
   await assert.rejects(client.query(sql),{code:'42501',message:'CREST_WORK_BOUNDARY_SOURCE_REVIEW_REQUIRED'});
  }finally{await client.query('ROLLBACK');}
 }
 const frozen=await sandbox.apply(target,await sandbox.prefix(59));
 const registered=await sandbox.prefix(60),upgraded=await sandbox.apply(target,registered);
 assert.equal(upgraded.history.length,60);
 assert.equal(upgraded.history.at(-1).version,'20261114180000');
 assert.deepEqual(upgraded.history.slice(0,59),frozen.history);
 assert.deepEqual((await sandbox.apply(target,registered)).history,upgraded.history);
 await requireSyntheticWorkBoundary(connectionString);
});

test('corrects an open pause boundary in both directions and preserves exact originals, totals and job events',async()=>{
 const p=await paused(),before=await read(p),originalAt=before.intervals[0].endedAt;
 const jobBefore=await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]);
 const earlier=request(before,await shift(originalAt,'-1 microsecond'));
 const saved=await correct(p,earlier);
 assert.equal(saved.state,'committed');
 assert.equal(saved.receipt.commandType,kind);
 assert.equal(saved.receipt.previousBoundaryAt,originalAt);
 assert.equal(saved.receipt.left.ended_at,earlier.body.correctedAt);
 assert.equal(saved.receipt.right.started_at,earlier.body.correctedAt);
 assert.equal(saved.receipt.right.ended_at,null);
 assert.equal(saved.receipt.auditIds.length,2);
 const afterEarlier=await read(p);
 const later=request(afterEarlier,await shift(originalAt,'1 microsecond'));
 assert.equal((await correct(p,later)).state,'committed');
 const afterLater=await read(p);
 assert.equal(afterLater.record.jobState,'paused');
 assert.equal(afterLater.record.jobVersion,before.record.jobVersion);
 assert.equal(afterLater.summary.unrecordedMicroseconds,'0');
 assert.equal(BigInt(afterLater.summary.closedActiveMicroseconds),BigInt(before.summary.closedActiveMicroseconds)+1n);
 assert.equal(afterLater.record.intervalVersions.length,before.record.intervalVersions.length+4);
 for(const original of before.record.intervalVersions)
  assert.deepEqual(afterLater.record.intervalVersions.find(version=>version.versionId===original.versionId),original);
 assert.deepEqual(await correct(p,earlier),saved);
 assert.deepEqual(await correct(p,{...earlier,body:{...earlier.body,reason:'Different reason'}}),{state:'conflict',reason:'operation'});
 const reference=original(p,earlier);
 const observed=await lookup(p,reference);
 assert.deepEqual(observed,{schemaVersion:1,original:reference,result:{state:'committed',receipt:{schemaVersion:1,commandType:kind,
  businessId:p.business,actorId:p.actor,operationId:earlier.operation,recoveryEpoch:p.epoch,subjectId:p.job,sourceRecordId:p.job,
  sourceVersion:earlier.version,sourceAuditIds:saved.receipt.auditIds}}});
 assert.deepEqual(await lookup(p,{...reference,reference:{...reference.reference,leftVersionId:randomUUID()}}),
  {state:'conflict',reason:'operation'});
 await assert.rejects(lookup(p,{...reference,reference:{...reference.reference,reason:'Forbidden draft content'}}),{code:'22023'});
 assert.deepEqual(await value(client,'SELECT to_jsonb(j) AS value FROM crest.jobs j WHERE id=$1',[p.job]),jobBefore);
 assert.equal(await value(client,'SELECT count(*)::int AS value FROM crest.job_events WHERE operation_id IN($1,$2)',
  [earlier.operation,later.operation]),0);
 await change(p,'resume','3',null);
 assert.deepEqual(await correct(p,earlier),saved);
 assert.deepEqual(await lookup(p,reference),observed);
});

test('corrects a historical closed boundary without altering the later open interval or any transition',async()=>{
 const p=await paused();
 await change(p,'resume','3',null);
 const before=await read(p),at=before.intervals[0].endedAt;
 const corrected=request(before,await shift(at,'1 microsecond'));
 assert.equal((await correct(p,corrected)).state,'committed');
 const current=await read(p);
 assert.equal(current.record.jobState,'in_progress');
 assert.deepEqual(current.intervals[2],before.intervals[2]);
 assert.equal(BigInt(current.summary.closedPauseMicroseconds),BigInt(before.summary.closedPauseMicroseconds)-1n);
 assert.equal(BigInt(current.summary.closedActiveMicroseconds),BigInt(before.summary.closedActiveMicroseconds)+1n);
 assert.equal(current.summary.firstStartedAt,before.summary.firstStartedAt);
 assert.equal(current.summary.closedThrough,before.summary.closedThrough);
});

test('an absent correction can be retired without the old timestamp or reason and cannot arrive late',async()=>{
 const p=await paused(),before=await read(p);
 const missing=request(before,await shift(before.intervals[0].endedAt,'-1 microsecond'));
 const reference=original(p,missing);
 assert.deepEqual(await lookup(p,reference),{state:'absent'});
 const retired=await call('SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',
  [...p.auth(),p.epoch,reference,'Synthetic reviewed missing save']);
 assert.equal(retired.state,'retired');
 assert.deepEqual(retired.original,reference);
 assert.deepEqual(await correct(p,missing),{state:'conflict',reason:'operation'});
 assert.deepEqual((await read(p)).intervals,before.intervals);
});

test('refuses foreign jobs, stale versions, invalid authority, invalid instants and unsupported boundary changes',async()=>{
 const p=await paused(),foreign=await job(),snapshot=await read(p);
 const boundary=snapshot.intervals[0].endedAt,original=request(snapshot,await shift(boundary,'-1 microsecond'));
 assert.deepEqual(await correct(foreign,original,{jobId:p.job}),{state:'conflict',reason:'job'});
 const invalid=p.auth();invalid[0]=randomBytes(32);
 await assert.rejects(correct(p,original,{auth:invalid}),{code:'42501'});
 for(const body of [{correctedAt:'2026-02-30T08:00:00.000000Z',reason:'Synthetic'},
  {correctedAt:original.body.correctedAt,reason:' '},{...original.body,extra:'unsupported'}]){
  await assert.rejects(correct(p,{...original,body}),{code:'22023'});
 }
 assert.deepEqual(await correct(p,{...original,version:'2'}),{state:'conflict',reason:'version'});
 for(const patch of [{left:original.right,right:original.left},
  {body:{...original.body,correctedAt:boundary}},
  {body:{...original.body,correctedAt:snapshot.intervals[0].startedAt}}]){
  assert.deepEqual(await correct(p,{...original,...patch}),{state:'conflict',reason:'boundary'});
 }
 await absent(original.operation);
});

test('refuses active work overlapping a real supply trip and rolls back the shortened pause',async()=>{
 const p=await paused(),before=await read(p),boundary=before.intervals[0].endedAt,rig=randomUUID();
 const vehicle={label:'Synthetic rig',year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null};
 assert.equal((await call('SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) AS value',
  [...p.auth(),p.epoch,randomUUID(),rig,vehicle])).state,'committed');
 const location={schemaVersion:1,kind:'manual',locationText:'Synthetic supply location',instructions:null};
 const trip={action:'record',reason:'Synthetic supply record',trip:{drivenVehicleId:rig,jobId:p.job,purpose:'supply',
  origin:location,destination:location,notes:null,state:'closed',departedAt:await shift(boundary,'1 microsecond'),
  arrivedAt:await shift(boundary,'4 microseconds')}};
 assert.equal((await call('SELECT crest_commands.record_support_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,NULL,$12) AS value',
  [...p.auth(),p.epoch,randomUUID(),randomUUID(),trip])).state,'committed');
 const overlap=request(before,await shift(boundary,'2 microseconds'));
 assert.deepEqual(await correct(p,overlap),{state:'conflict',reason:'occupancy'});
 await absent(overlap.operation);
 assert.deepEqual((await read(p)).intervals,before.intervals);
});

test('concurrent corrections from the same observed pair save once and refuse the stale pair',async()=>{
 const p=await paused(),before=await read(p),at=before.intervals[0].endedAt,peer=await newWeb();
 try{
  const first=request(before,await shift(at,'-1 microsecond')),second=request(before,await shift(at,'1 microsecond'));
  const results=await Promise.all([correct(p,first),correct(p,second,{connection:peer})]);
  assert.deepEqual(results.map(result=>result.state).sort(),['committed','conflict']);
  const loser=results.findIndex(result=>result.state==='conflict');
  assert.equal(results[loser].reason,'version');
  await absent([first,second][loser].operation);
 }finally{await peer.end();}
});

test('a deferred COMMIT failure leaves both current intervals and every correction record unchanged',async()=>{
 const p=await paused(),before=await read(p),changeRequest=request(before,await shift(before.intervals[0].endedAt,'-1 microsecond'));
 await client.query("CREATE FUNCTION pg_temp.work_boundary_test_refusal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P1943';END $$");
 await client.query('CREATE CONSTRAINT TRIGGER work_boundary_test_refusal AFTER INSERT ON crest.work_intervals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.work_boundary_test_refusal()');
 try{await assert.rejects(correct(p,changeRequest),{code:'P1943'});}
 finally{await client.query('DROP TRIGGER work_boundary_test_refusal ON crest.work_intervals');}
 await absent(changeRequest.operation);
 assert.deepEqual((await read(p)).intervals,before.intervals);
});

test('keeps ordinary browser, worker and export roles outside the correction command and source tables',async()=>{
 for(const role of ['anon','authenticated','crest_worker','crest_export']){
  assert.equal(await value(client,'SELECT has_function_privilege($1,$2,$3) AS value',[role,signature,'EXECUTE']),false);
 }
 for(const table of ['crest.work_intervals','crest.travel_legs','crest.operator_occupancy']){
  assert.equal(await value(client,'SELECT has_table_privilege($1,$2,$3) AS value',['crest_web',table,'INSERT,UPDATE,DELETE']),false);
 }
 assert.equal(await value(client,'SELECT count(*)::int AS value FROM supabase_migrations.schema_migrations'),60);
});
