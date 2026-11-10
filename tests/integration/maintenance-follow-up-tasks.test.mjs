import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after,before,test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {createFieldOperationFixture} from '../support/field-operation-fixture.mjs';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {amendmentSourceHistory} from '../support/amendment-source-fixture.mjs';
import {formatMaintenanceFollowUpSources} from '../../src/operations/maintenance-follow-up-source.ts';
import {collectMaintenanceFollowUpSourcesInSnapshot} from '../../src/operations/maintenance-follow-up-source-collector.ts';
import {
 maintenanceFollowUpOriginal,parseMaintenanceFollowUpAcknowledgement,parseMaintenanceFollowUpCommitted,parseMaintenanceFollowUpHistory,parseMaintenanceFollowUpList,
 parseMaintenanceFollowUpOriginal,parseMaintenanceFollowUpSave,
} from '../../src/operations/maintenance-follow-up-contract.ts';

const routines=[
 'crest_commands.save_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)',
 'crest_commands.read_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)',
 'crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid)',
 'crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)',
 'crest_commands.lookup_maintenance_follow_up_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)',
];
const migration=await readFile(new URL('../../supabase/migrations/20261120180000_maintenance_follow_up.sql',import.meta.url),'utf8');
const value=async(db,query,args=[])=>(await db.query(query,args)).rows[0].value;
const dueAt='2098-03-12T15:00:00.000000Z',snoozedUntil='2098-03-16T15:00:00.000000Z';
let sandbox,client,web,second,login,accepted,fixtures;

before(async()=>{
 sandbox=await migrationSandbox();
 const target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(65))).history.length,65);
 for(const [signature,message] of [
  ['crest_private.original_operation_reference_valid(jsonb)','CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED'],
  ['crest_commands.field_source_context(uuid)','CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED'],
 ]){
  await client.query('BEGIN');
  try{
   await client.query('ALTER FUNCTION '+signature+" SET statement_timeout='1s'");
   await assert.rejects(client.query(migration),{code:'42501',message});
  }finally{await client.query('ROLLBACK');}
  assert.equal(await value(client,"SELECT to_regclass('crest.follow_up_tasks') IS NULL value"),true);
 }
 const upgraded=await sandbox.apply(target,await sandbox.prefix(66));
 assert.equal(upgraded.history.length,66);
 assert.deepEqual((await sandbox.apply(target,await sandbox.prefix(66))).history,upgraded.history);
 for(const role of ['crest_web','anon','authenticated','crest_export'])for(const [index,routine] of routines.entries())
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') value",[role,routine]),role==='crest_web'&&index<3);
 login='crest_followup_'+randomBytes(8).toString('hex');
 const password=randomBytes(32).toString('hex');
 await sandbox.admin.query('CREATE ROLE '+login+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");
 await sandbox.admin.query('GRANT crest_web TO '+login);
 const url=new URL(target);url.username=login;url.password=password;
 web=await sandbox.connect(url.toString());await web.query('SET ROLE crest_web');
 second=await sandbox.connect(url.toString());await second.query('SET ROLE crest_web');
 const bootstrap=await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
 accepted=createConfirmedBookingFixture({client,web,bootstrap});
 fixtures=createFieldOperationFixture({client,web,accepted});
},{timeout:240000});
after(async()=>{
 await second?.end();await web?.end();
 if(login)await sandbox.admin.query('DROP ROLE '+login);
 await sandbox?.close();
});

async function completed(){
 const p=await fixtures.fixture();
 await fixtures.field(p,'direct_arrive');
 const result=await value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...p.auth(),p.epoch,randomUUID(),p.job,p.version,await fixtures.completion(p)]);
 assert.equal(result.state,'committed');
 return p;
}
function command(p,taskId,expectedVersion,body,operationId=randomUUID()){
 return {schemaVersion:1,businessId:p.business,recoveryEpoch:p.epoch,taskId,expectedVersion,body,operationId};
}
const create=(p,taskId=randomUUID(),changes={})=>command(p,taskId,'0',
 {kind:'created',customerId:p.customer,vehicleId:p.vehicle,sourceJobId:p.job,dueAt,reason:null,...changes});
const change=(p,taskId,version,kind,body={})=>command(p,taskId,version,kind==='snoozed'
 ?{kind,snoozedUntil,rebookingJobId:null,reason:null,...body}
 :{kind,snoozedUntil:null,rebookingJobId:null,reason:null,...body});
const saveRaw=(p,input,connection=web)=>value(connection,
 'SELECT crest_commands.save_maintenance_follow_up($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
 [...p.auth(),input.recoveryEpoch,input.operationId,input.taskId,input.expectedVersion,input.body]);
async function save(p,input,connection=web){
 const request=parseMaintenanceFollowUpSave(input),value=await saveRaw(p,request,connection);
 return value.state==='committed'?parseMaintenanceFollowUpCommitted(value,request):value;
}
async function history(p,taskId,afterVersion='0'){
 return parseMaintenanceFollowUpHistory(await value(web,
  'SELECT crest_commands.read_maintenance_follow_up($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...p.auth(),taskId,afterVersion]),
 p.business,taskId,afterVersion);
}
async function list(p,scope,after=null){
 return parseMaintenanceFollowUpList(await value(web,
  'SELECT crest_commands.list_maintenance_follow_ups($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
  [...p.auth(),scope.scopeKind,scope.scopeId,scope.throughAt,after?.effectiveDueAt??null,after?.taskId??null]),
 p.business,scope,after);
}
async function original(p,reference){
 return parseMaintenanceFollowUpOriginal(await value(client,
  'SELECT crest_commands.lookup_maintenance_follow_up($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
  [...p.auth(),reference.recoveryEpoch,reference.operationId,reference.taskId,reference.expectedVersion,reference.kind]),
 {...reference,businessId:p.business});
}

test('completion creates no date and an explicit due date saves and replays the original receipt',async()=>{
 const p=await completed();
 assert.equal(await value(client,'SELECT count(*)::int value FROM crest.follow_up_tasks WHERE business_id=$1',[p.business]),0);
 const input=create(p),missing={...input,body:{...input.body,dueAt:null}};
 assert.throws(()=>parseMaintenanceFollowUpSave(missing));
 await assert.rejects(saveRaw(p,missing),{code:'22023'});
 const saved=await save(p,input);
 assert.equal(saved.state,'committed');assert.equal(saved.receipt.record.dueAt,dueAt);
 assert.equal(saved.receipt.record.state,'open');
 assert.deepEqual(await save(p,input),saved);
 assert.deepEqual(await save(p,{...input,body:{...input.body,reason:'Changed request'}}),{state:'conflict',reason:'operation'});
 const looked=await history(p,input.taskId);
 assert.deepEqual(looked.entries,[saved.receipt.record]);
 assert.deepEqual(looked.current,saved.receipt.record);
 const other=await completed();
 assert.deepEqual(await history(other,input.taskId),{state:'absent'});
 assert.deepEqual(await save(p,create(p,randomUUID(),{sourceJobId:other.job})),{state:'conflict',reason:'scope'});
 assert.deepEqual(await save(p,create(p,randomUUID(),{vehicleId:other.vehicle})),{state:'conflict',reason:'scope'});
 await assert.rejects(web.query('SELECT * FROM crest.follow_up_tasks'),{code:'42501'});
 await assert.rejects(client.query('DELETE FROM crest.follow_up_task_events WHERE task_id=$1',[input.taskId]),{code:'55000'});
});

test('retains the original date, rejects stale edits, and records reasoned dismissal',async()=>{
 const p=await completed(),input=create(p),other=create(p);
 assert.equal((await save(p,input)).state,'committed');
 assert.equal((await save(p,other)).state,'committed');
 const past=change(p,input.taskId,'1','snoozed',{snoozedUntil:'2020-01-01T00:00:00.000000Z'});
 assert.deepEqual(await save(p,past),{state:'conflict',reason:'snooze'});
 const snooze=await save(p,change(p,input.taskId,'1','snoozed',{reason:'Owner chose a later day'}));
 assert.equal(snooze.state,'committed');assert.equal(snooze.receipt.record.dueAt,dueAt);
 assert.deepEqual(await save(p,change(p,input.taskId,'1','completed')),{state:'conflict',reason:'version'});
 const invalid=change(p,input.taskId,'2','dismissed');
 assert.throws(()=>parseMaintenanceFollowUpSave(invalid));
 await assert.rejects(saveRaw(p,invalid),{code:'22023'});
 const dismissed=await save(p,change(p,input.taskId,'2','dismissed',{reason:'Customer declined follow-up'}));
 assert.equal(dismissed.state,'committed');
 assert.deepEqual(await save(p,change(p,input.taskId,'3','completed')),{state:'conflict',reason:'closed'});
 const looked=await history(p,input.taskId,'1');
 assert.deepEqual(looked.entries.map(row=>row.state),['snoozed','dismissed']);
 assert.equal(looked.current.reason,'Customer declined follow-up');
 assert.equal((await history(p,other.taskId)).current.state,'open');
 assert.deepEqual((await history(p,input.taskId,'3')).entries,[]);
});

test('rebooking only affects a deliberately linked task and refuses a different vehicle',async()=>{
 const p=await completed(),customerTask=create(p,randomUUID(),{vehicleId:null}),vehicleTask=create(p);
 assert.equal((await save(p,customerTask)).state,'committed');
 assert.equal((await save(p,vehicleTask)).state,'committed');
 const visit=await accepted(p,{customerId:p.customer}),booking=confirmedBookingRequest(visit);
 booking.expectedModeSequence='1';
 for(const key of ['start_at','end_at','local_start','local_end'])
  booking.payload.appointment[key]=booking.payload.appointment[key].replace('2026-11-03','2026-11-04');
 const booked=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...visit.auth(),visit.epoch,booking.operationId,booking.jobId,booking.expectedModeSequence,booking.payload]);
 assert.equal(booked.state,'committed',JSON.stringify(booked));
 assert.equal((await history(p,customerTask.taskId)).current.state,'open');
 assert.deepEqual(await save(p,change(p,vehicleTask.taskId,'1','completed',{rebookingJobId:booking.jobId})),
  {state:'conflict',reason:'rebooking'});
 const resolved=await save(p,change(p,customerTask.taskId,'1','completed',{rebookingJobId:booking.jobId}));
 assert.equal(resolved.state,'committed');assert.equal(resolved.receipt.record.rebookingJobId,booking.jobId);
 assert.equal((await history(p,vehicleTask.taskId)).current.state,'open');
});

test('two transitions at the same expected version keep one source and one audit event',async()=>{
 const p=await completed(),input=create(p);
 assert.equal((await save(p,input)).state,'committed');
 const [one,two]=await Promise.all([
  save(p,change(p,input.taskId,'1','completed')),
  save(p,change(p,input.taskId,'1','snoozed'),second),
 ]);
 assert.equal([one,two].filter(result=>result.state==='committed').length,1);
 assert.deepEqual([one,two].find(result=>result.state==='conflict'),{state:'conflict',reason:'version'});
 const looked=await history(p,input.taskId);
 assert.equal(looked.entries.length,2);
 assert.equal(await value(client,"SELECT count(*)::int value FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='follow_up_tasks' AND entity_id=$2",[p.business,input.taskId]),2);
});

test('due queue uses explicit bounds and snoozed dates while the customer and job lists retain closed tasks',async()=>{
 const p=await completed(),later=create(p),closed=create(p),open=[];
 for(let index=0;index<22;index++){
  const input=create(p);
  assert.equal((await save(p,input)).state,'committed');
  open.push(input.taskId);
 }
 assert.equal((await save(p,later)).state,'committed');
 assert.equal((await save(p,closed)).state,'committed');
 assert.equal((await save(p,change(p,later.taskId,'1','snoozed'))).state,'committed');
 assert.equal((await save(p,change(p,closed.taskId,'1','completed'))).state,'committed');
 const exact={scopeKind:'due',scopeId:null,throughAt:dueAt};
 assert.deepEqual((await list(p,exact)).entries,[]);
 const due={...exact,throughAt:snoozedUntil};
 const first=await list(p,due),last=await list(p,due,first.next);
 assert.equal(first.entries.length,20);assert.equal(last.next,null);
 assert.deepEqual([...first.entries,...last.entries].map(row=>row.record.taskId),open.sort());
 const customer={scopeKind:'customer',scopeId:p.customer,throughAt:null};
 const job={scopeKind:'job',scopeId:p.job,throughAt:null};
 const customerFirst=await list(p,customer);
 const customerLast=await list(p,customer,customerFirst.next);
 const jobFirst=await list(p,job);
 assert.deepEqual(customerFirst.entries,jobFirst.entries);
 assert([...customerFirst.entries,...customerLast.entries].some(row=>row.record.taskId===closed.taskId&&row.record.state==='completed'));
 assert(customerLast.entries.some(row=>row.record.taskId===later.taskId&&row.effectiveDueAt===snoozedUntil));
 const other=await completed();
 assert.deepEqual((await list(other,customer)).entries,[]);
 assert.deepEqual((await list(other,job)).entries,[]);
});

test('opaque original identity returns the exact committed result after later actions and refuses mismatched references',async()=>{
 const p=await completed(),input=create(p,randomUUID(),{reason:'Synthetic private reason'});
 const first=await save(p,input);
 assert.equal(first.state,'committed');
 assert.equal((await save(p,change(p,input.taskId,'1','completed'))).state,'committed');
 const reference={recoveryEpoch:p.epoch,operationId:input.operationId,taskId:input.taskId,expectedVersion:'0',kind:'created'};
 assert(!JSON.stringify(reference).includes(input.body.reason));
 assert.deepEqual(await original(p,reference),first);
 assert.deepEqual(await original(p,{...reference,taskId:randomUUID()}),{state:'absent'});
 assert.deepEqual(await original(p,{...reference,recoveryEpoch:randomUUID()}),{state:'absent'});
 assert.deepEqual(await original(p,{...reference,expectedVersion:'1',kind:'completed'}),{state:'absent'});
 const other=await completed();
 assert.deepEqual(await original(other,reference),{state:'absent'});
});

const originalEnvelope=maintenanceFollowUpOriginal;
const lookup=(p,original)=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
 [...p.auth(),original]);
const retire=(p,original,connection=web)=>value(connection,
 'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
 [...p.auth(),p.epoch,original,'Synthetic owner chose to retire the unconfirmed reminder action']);

test('generic original lookup is opaque and retirement prevents a delayed create',async()=>{
 const p=await completed(),input=create(p,randomUUID(),{reason:'Synthetic private scheduling note'});
 const envelope=originalEnvelope(input);
 assert(!JSON.stringify(envelope).includes(input.body.reason));
 assert.deepEqual(await lookup(p,envelope),{state:'absent'});
 const saved=await save(p,input);
 assert.equal(saved.state,'committed');
 const exact=await lookup(p,envelope);
 assert.deepEqual(parseMaintenanceFollowUpAcknowledgement(exact,input),exact);
 assert.equal(exact.result.receipt.subjectId,input.taskId);
 assert.equal(exact.result.receipt.sourceRecordId,saved.receipt.record.eventId);
 assert.equal(exact.result.receipt.sourceVersion,'1');
 assert.deepEqual(exact.result.receipt.sourceAuditIds,[saved.receipt.auditId]);
 assert(!JSON.stringify(exact).includes(input.body.reason));
 assert.deepEqual(await retire(p,envelope),{schemaVersion:1,state:'original_recorded',original:envelope});
 const absent=create(p),absentEnvelope=originalEnvelope(absent);
 const retired=await retire(p,absentEnvelope);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await retire(p,absentEnvelope),retired);
 assert.deepEqual(await save(p,absent),{state:'conflict',reason:'operation'});
 assert.deepEqual(await history(p,absent.taskId),{state:'absent'});
 const wrong={...envelope,reference:{...envelope.reference,expectedVersion:'0',action:'completed'}};
 await assert.rejects(lookup(p,wrong),{code:'22023'});
});

test('a create racing retirement has exactly one durable outcome',async()=>{
 const p=await completed(),input=create(p),envelope=originalEnvelope(input);
 const [saved,decision]=await Promise.all([save(p,input),retire(p,envelope,second)]);
 if(saved.state==='committed'){
  assert.equal(decision.state,'original_recorded');
  assert.equal((await lookup(p,envelope)).result.receipt.sourceRecordId,saved.receipt.record.eventId);
 }else{
  assert.deepEqual(saved,{state:'conflict',reason:'operation'});
  assert.equal(decision.state,'retired');
  assert.deepEqual(await history(p,input.taskId),{state:'absent'});
 }
 assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',
  [p.business,input.operationId]),1);
});

test('private maintenance source pages preserve both tables in one bounded snapshot',async()=>{
 const p=await completed(),other=await completed(),request=create(p,randomUUID(),{reason:'=Synthetic source note'});
 assert.equal((await save(p,request)).state,'committed');
 assert.equal((await save(p,change(p,request.taskId,'1','snoozed'))).state,'committed');
 assert.equal((await save(other,create(other))).state,'committed');
 const contextName='crest_commands.maintenance_follow_up_source_context(uuid)';
 const pageName='crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer)';
 for(const role of ['crest_web','anon','authenticated','crest_export'])for(const fn of [contextName,pageName])
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') value",[role,fn]),role==='crest_export');
 const load=(business=p.business)=>value(client,'SELECT crest_commands.maintenance_follow_up_source_context($1) value',[business]);
 const page=(business,token,kind,after=null)=>value(client,
  'SELECT crest_commands.maintenance_follow_up_source_page($1,$2,$3,$4,1) value',[business,token,kind,after]);
 await assert.rejects(load(),{code:'25001'});
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await client.query('SET LOCAL ROLE crest_export');
  const context=await load(),otherContext=await load(other.business);
  assert.notEqual(context.snapshotToken,otherContext.snapshotToken);
  assert.match(context.historySnapshotToken,/^[a-f0-9]{64}$/);
  assert.deepEqual(context.expectedCounts,{follow_up_tasks:'1',follow_up_task_events:'2'});
  const roots=await page(p.business,context.snapshotToken,'follow_up_tasks');
  assert.equal(roots.hasMore,false);
  assert.deepEqual(roots.rows.map(row=>[row.id,row.business_id,row.customer_id,row.source_job_id,row.vehicle_id,row.due_at]),
   [[request.taskId,p.business,p.customer,p.job,p.vehicle,dueAt]]);
  const first=await page(p.business,context.snapshotToken,'follow_up_task_events');
  assert.equal(first.hasMore,true);
  const second=await page(p.business,context.snapshotToken,'follow_up_task_events',first.rows[0].id);
  assert.equal(second.hasMore,false);
  const events=[...first.rows,...second.rows].sort((a,b)=>Number(a.version)-Number(b.version));
  assert.deepEqual(events.map(e=>[e.business_id,e.task_id,e.version,e.prior_version,e.kind,e.reason,e.snoozed_until]),[
   [p.business,request.taskId,'1',null,'created','=Synthetic source note',null],
   [p.business,request.taskId,'2','1','snoozed',null,snoozedUntil],
  ]);
  const input={context,rows:{follow_up_tasks:roots.rows,follow_up_task_events:[...first.rows,...second.rows]},
   historyEvidence:await amendmentSourceHistory(client,p.business)};
  const archive=formatMaintenanceFollowUpSources(input);
  assert.equal(JSON.parse(archive.manifest).sourceAuditClosureChecked,true);
  assert.equal(JSON.parse(archive.manifest).completeBackup,false);
  assert(archive.files['follow_up_task_events.csv'].includes("\"'=Synthetic source note\""));
  const portable=JSON.parse(archive.files['maintenance_follow_up_source.json']);
  assert.deepEqual(portable.rows,input.rows);
  assert.equal(portable.historyEvidence.records.length,4);
  assert(portable.historyEvidence.records.every(record=>record.kind==='operation'?
   JSON.parse(record.canonicalEvidence).row.command_type==='operations.follow_up.save':
   JSON.parse(record.canonicalEvidence).row.entity_kind==='follow_up_tasks'));
  const collected=await collectMaintenanceFollowUpSourcesInSnapshot(client,p.business,input.historyEvidence,new AbortController().signal);
  assert.deepEqual(collected.forServer(),archive);
  assert.throws(()=>JSON.stringify(collected),/MAINTENANCE_SOURCE_PRIVATE/);
  const tampered=structuredClone(input);tampered.rows.follow_up_task_events[0].reason='Rewritten note';
  assert.throws(()=>formatMaintenanceFollowUpSources(tampered),/MAINTENANCE_SOURCE_REVIEW_REQUIRED/);
  assert.equal((await page(other.business,otherContext.snapshotToken,'follow_up_tasks')).rows[0].business_id,other.business);
  await assert.rejects(page(other.business,context.snapshotToken,'follow_up_tasks'),{code:'22023'});
 }finally{await client.query('ROLLBACK');}
});

test('reviewed maintenance schema preserves exact scheduling and field export guards',async()=>{
 const p=await completed();
 const routine='crest_commands.field_source_context(uuid)';
 for(const role of ['crest_web','anon','authenticated','crest_export'])
  assert.equal(await value(client,"SELECT has_function_privilege($1,$2,'EXECUTE') value",[role,routine]),role==='crest_export');
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await client.query('SET LOCAL ROLE crest_export');
  const context=await value(client,'SELECT crest_commands.field_source_context($1) value',[p.business]);
  assert.equal(context.businessId,p.business);
  assert.equal(context.profile,'crest.field-sources.v1');
 }finally{await client.query('ROLLBACK');}
});
