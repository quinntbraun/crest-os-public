import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {after,before,test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {
 backupDatabase,backupDropoffCandidateDatabase,connect,inventory,keyPair,privateWorkspace,
 recoveryCluster,restoreDatabase,restoreDropoffCandidateDatabase
} from '../support/recovery-drill.mjs';

const proposal=await readFile(new URL('../../planning/proposals/dropoff-custody-storage.sql',import.meta.url),'utf8');
const handoffTime='2026-11-03T09:45:00.123456Z',collectionTime='2026-11-03T11:15:00.654321Z';
let cluster,sandbox,target,client,web,accepted;

async function transaction(connection,work){
 await connection.query('BEGIN');
 try{const result=await work();await connection.query('COMMIT');return result;}
 catch(error){await connection.query('ROLLBACK');throw error;}
}
async function value(connection,query,params=[]){
 return (await connection.query(query,params)).rows[0]?.value;
}

before(async()=>{
 cluster=await recoveryCluster();
 sandbox=await migrationSandbox(cluster.testDatabaseUrl);
 target=await sandbox.database();
 client=await sandbox.connect(target);
 await sandbox.apply(target,await sandbox.prefix(0),true);
 await installProviderSchema(client,target);
 assert.equal((await sandbox.apply(target,await sandbox.prefix(66))).history.length,66);
 await transaction(client,()=>client.query(proposal));
 web=await sandbox.connect(target);
 await web.query('SET ROLE crest_web');
 const bootstrap=await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
 accepted=createConfirmedBookingFixture({client,web,bootstrap});
},{timeout:240000});
after(async()=>{
 try{await sandbox?.close();}finally{await cluster?.close();}
});

async function booking(mode='dropoff',prior){
 const p=await accepted(prior??null,prior?{customerId:prior.customer}:{});
 const request=confirmedBookingRequest(p);
 request.payload.fulfillmentMode=mode;
 if(prior){
  request.expectedModeSequence='1';
  request.payload.vehicles.push({...request.payload.vehicles[0],vehicleId:prior.vehicle});
  for(const key of ['start_at','end_at','local_start','local_end']){
   request.payload.appointment[key]=request.payload.appointment[key].replace('2026-11-03','2026-11-04');
  }
 }
 const saved=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...p.auth(),p.epoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 const vehicle=prior?.vehicle??p.vehicle;
 const jobVehicleId=await value(client,'SELECT id value FROM crest.job_vehicles WHERE business_id=$1 AND job_id=$2 AND vehicle_id=$3',
  [p.business,request.jobId,vehicle]);
 return {...p,vehicle,jobId:request.jobId,jobVehicleId,operationId:request.operationId};
}
function intake(p){
 return {businessId:p.business,caseId:randomUUID(),eventId:randomUUID(),jobId:p.jobId,jobVehicleId:p.jobVehicleId,
  vehicleId:p.vehicle,createdBy:p.actor,recoveryEpoch:p.epoch,operationId:randomUUID(),
  effectiveAt:handoffTime,person:{schemaVersion:1,displayName:'Synthetic handover'},
  location:{schemaVersion:1,kind:'manual',locationText:'Synthetic shop intake',instructions:null},
  notes:'Synthetic scuff on rear bumper',missingPhotoReason:'Synthetic condition photo unavailable'};
}
async function insertCase(connection,input){
 await connection.query("INSERT INTO crest.custody_cases(id,business_id,job_id,job_vehicle_id,vehicle_id,mode,version,state,current_event_id) VALUES($1,$2,$3,$4,$5,'dropoff',1,'held',$6)",
  [input.caseId,input.businessId,input.jobId,input.jobVehicleId,input.vehicleId,input.eventId]);
}
async function insertEvent(connection,input,version=1){
 await connection.query("INSERT INTO crest.custody_events(id,business_id,case_id,version,prior_version,action,effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,created_by,operation_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14::timestamptz,clock_timestamp()))",
  [input.eventId,input.businessId,input.caseId,version,version===1?null:1,version===1?'received':'released',input.effectiveAt,
   input.person,input.location,input.notes,input.missingPhotoReason,input.createdBy,input.operationId,input.recordedOverride??null]);
}

async function writeHandoffEvent(connection,input,version,audit='exact'){
 const payloadHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 await connection.query("INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'operations.custody.save',1,$4,$5,$3,'manual')",
  [input.businessId,input.operationId,input.createdBy,input.recoveryEpoch,payloadHash]);
 await insertEvent(connection,input,version);
 if(audit!=='missing'){
  await connection.query(`INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   SELECT e.business_id,e.operation_id,e.created_by,e.created_by,'custody_cases',c.id,e.version,e.action,e.effective_at,
    jsonb_build_object('schemaVersion',1,'before',CASE WHEN p.id IS NULL THEN 'null'::jsonb ELSE crest_private.dropoff_custody_snapshot(c,p) END,
      'after',CASE WHEN $2::boolean THEN '{}'::jsonb ELSE crest_private.dropoff_custody_snapshot(c,e) END),'manual'
   FROM crest.custody_events e JOIN crest.custody_cases c ON c.business_id=e.business_id AND c.id=e.case_id
   LEFT JOIN crest.custody_events p ON p.business_id=e.business_id AND p.case_id=e.case_id AND p.version=e.prior_version
   WHERE e.id=$1`,[input.eventId,audit==='forged']);
 }
 await connection.query("UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'caseId',$3::uuid,'eventId',$4::uuid,'version',$5::text) WHERE business_id=$1 AND operation_id=$2",
  [input.businessId,input.operationId,input.caseId,input.eventId,String(version)]);
}
function receive(input,connection=client,audit='exact'){
 return transaction(connection,async()=>{await insertCase(connection,input);await writeHandoffEvent(connection,input,1,audit);});
}
async function cancel(p){
 const operationId=randomUUID();
 const result=await value(web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
  [...p.auth(),p.epoch,operationId,p.jobId,{reason:'Synthetic visit cancelled after drop-off',
   customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
 assert.equal(result.state,'committed',JSON.stringify(result));
 return operationId;
}
function collection(input){
 return {...input,eventId:randomUUID(),operationId:randomUUID(),effectiveAt:collectionTime,
  person:{schemaVersion:1,displayName:'Synthetic collecting customer'},notes:null};
}
function release(input,connection=client){
 return transaction(connection,async()=>{
  await writeHandoffEvent(connection,input,2);
  await connection.query("UPDATE crest.custody_cases SET state='released',version=2,current_event_id=$3 WHERE business_id=$1 AND id=$2",
   [input.businessId,input.caseId,input.eventId]);
 });
}
const state=input=>value(client,'SELECT state value FROM crest.custody_cases WHERE business_id=$1 AND id=$2',[input.businessId,input.caseId]);
const queued=input=>value(client,'SELECT collection_state value FROM crest_private.dropoff_custody_collection_queue WHERE business_id=$1 AND case_id=$2',
 [input.businessId,input.caseId]);

test('custody storage is closed to every ordinary app, worker and export role',async()=>{
 const rows=(await client.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('crest.custody_cases'::regclass,'crest.custody_events'::regclass)")).rows;
 assert.deepEqual(rows,[{relrowsecurity:true,relforcerowsecurity:true},{relrowsecurity:true,relforcerowsecurity:true}]);
 for(const role of ['crest_web','crest_worker','crest_export','anon','authenticated']){
  for(const table of ['crest.custody_cases','crest.custody_events','crest_private.dropoff_custody_collection_queue']){
   assert.equal(await value(client,"SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') value",[role,table]),false);
  }
 }
 await assert.rejects(web.query('SELECT id FROM crest.custody_cases'),{code:'42501'});
});

test('intake retains exact evidence for a booked vehicle without starting work or creating travel',async()=>{
 const p=await booking(),input=intake(p);
 await receive(input);
 assert.equal(await state(input),'held');
 assert.equal(await queued(input),undefined);
 const row=(await client.query("SELECT e.person_snapshot,e.location_snapshot,e.notes,e.missing_photo_reason,to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') effective FROM crest.custody_events e WHERE id=$1",
  [input.eventId])).rows[0];
 assert.deepEqual(row,{person_snapshot:input.person,location_snapshot:input.location,notes:input.notes,
  missing_photo_reason:input.missingPhotoReason,effective:handoffTime});
 assert.deepEqual((await client.query('SELECT state,first_work_at,completed_at FROM crest.jobs WHERE id=$1',[p.jobId])).rows[0],
  {state:'scheduled',first_work_at:null,completed_at:null});
 assert.equal(await value(client,'SELECT count(*)::int value FROM crest.travel_legs WHERE business_id=$1',[p.business]),0);
 assert.equal(await value(client,'SELECT count(*)::int value FROM crest.work_intervals WHERE business_id=$1',[p.business]),0);
});

test('invalid handoff evidence or missing intake history rolls back the whole case',async()=>{
 const p=await booking(),input=intake(p);
 for(const invalid of [
  {missingPhotoReason:'   '},
  {person:{...input.person,displayName:''}},
  {location:{...input.location,kind:'unverified'}},
  {notes:'x'.repeat(1001)}
 ]){
  await assert.rejects(receive({...input,...invalid}),
   {code:'23514',message:'CREST_CUSTODY_HANDOFF_EVIDENCE_INVALID'});
 }
 const future='2098-01-01T00:00:00.000000Z';
 await assert.rejects(receive({...input,effectiveAt:future,recordedOverride:future}),{code:'23514'});
 assert.equal(await state(input),undefined);
 await assert.rejects(transaction(client,()=>insertCase(client,input)),{code:'23503'});
 assert.equal(await state(input),undefined);
});


test('intake commits only with its own operation and exact audit evidence',async()=>{
 const p=await booking(),input=intake(p);
 await assert.rejects(transaction(client,async()=>{
  await insertCase(client,input);
  await insertEvent(client,{...input,operationId:p.operationId});
 }),{code:'23514',message:'CREST_CUSTODY_AUDIT_REQUIRED'});
 for(const [audit,message] of [['missing','CREST_OPERATION_COMPLETION_REQUIRED'],['forged','CREST_CUSTODY_AUDIT_REQUIRED']]){
  await assert.rejects(receive(input,client,audit),{code:'23514',message});
  assert.equal(await state(input),undefined);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.operations WHERE operation_id=$1',[input.operationId]),0);
 }
 await receive(input);
 const audit=await value(client,"SELECT delta value FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='custody_cases'",[input.operationId]);
 assert.equal(audit.before,null);
 assert.equal(audit.after.eventId,input.eventId);
 assert.equal(audit.after.effectiveAt,handoffTime);
});

test('typed booked vehicle and Drop-Off mode are both required',async()=>{
 const p=await booking(),another=await booking(),input=intake(p);
 await assert.rejects(receive({...input,jobVehicleId:another.jobVehicleId}),{code:'23503'});
 assert.equal(await state(input),undefined);
 const mobile=intake(await booking('mobile'));
 await assert.rejects(receive(mobile),{code:'23514',message:'CREST_CUSTODY_DROP_OFF_REQUIRED'});
 assert.equal(await state(mobile),undefined);
});

test('cancellation keeps custody held until a separate valid release',async()=>{
 const p=await booking(),input=intake(p);
 await receive(input);
 await assert.rejects(release(collection(input)),{code:'23514',message:'CREST_CUSTODY_HANDOFF_EVIDENCE_REQUIRED'});
 await cancel(p);
 assert.equal(await value(client,'SELECT state value FROM crest.jobs WHERE id=$1',[p.jobId]),'cancelled');
 assert.equal(await state(input),'held');
 assert.equal(await queued(input),'return_required');
 const released=collection(input);
 await assert.rejects(release({...released,effectiveAt:'2026-11-03T09:44:59.999999Z'}),
  {code:'23514',message:'CREST_CUSTODY_HANDOFF_EVIDENCE_REQUIRED'});
 await assert.rejects(transaction(client,()=>writeHandoffEvent(client,released,2)),
  {code:'23514',message:'CREST_CUSTODY_HEAD_MISMATCH'});
 assert.equal(await state(input),'held');
 await release(released);
 assert.equal(await state(input),'released');
 assert.equal(await queued(input),undefined);
 const audit=await value(client,"SELECT delta value FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='custody_cases'",[released.operationId]);
 assert.equal(audit.before.eventId,input.eventId);
 assert.equal(audit.after.eventId,released.eventId);
 assert.equal(audit.after.effectiveAt,collectionTime);
 assert.deepEqual((await client.query('SELECT action,person_snapshot FROM crest.custody_events WHERE case_id=$1 ORDER BY version',
  [input.caseId])).rows,[{action:'received',person_snapshot:input.person},{action:'released',person_snapshot:released.person}]);
 await assert.rejects(client.query('UPDATE crest.custody_events SET notes=NULL WHERE id=$1',[input.eventId]),
  {code:'55000',message:'CREST_FIELD_HISTORY_RETAINED'});
 await assert.rejects(client.query('DELETE FROM crest.custody_cases WHERE id=$1',[input.caseId]),
  {code:'55000',message:'CREST_FIELD_HISTORY_RETAINED'});
});

test('an independent encrypted restore preserves held and released Drop-Off records',async()=>{
 const heldBooking=await booking(),releasedBooking=await booking();
 const held=intake(heldBooking),received=intake(releasedBooking),released=collection(received);
 await receive(held);await receive(received);
 await cancel(heldBooking);await cancel(releasedBooking);await release(released);
 const point=await privateWorkspace();
 let destinationCluster,restored;
 try{
  const keys=await keyPair(point);
  const candidatePath=join(point,'dropoff'),registeredPath=join(point,'registered');
  await mkdir(candidatePath,{mode:0o700});await mkdir(registeredPath,{mode:0o700});
  await assert.rejects(backupDatabase(client,target,registeredPath,keys.recipient),
   {message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
  const original=await inventory(client);
  const {manifest}=await backupDropoffCandidateDatabase(client,target,candidatePath,keys.recipient);
  assert.equal(manifest.completeBackup,false);
  assert.equal(manifest.heldDropoffProposalSha256,createHash('sha256').update(proposal).digest('hex'));
  assert.deepEqual(manifest.rows,original);

  destinationCluster=await recoveryCluster();
  const destination=await destinationCluster.database();
  await assert.rejects(restoreDatabase(candidatePath,keys.path,destination),
   {message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  assert.deepEqual(await restoreDropoffCandidateDatabase(candidatePath,keys.path,destination),manifest);
  restored=await connect(destination);
  assert.deepEqual((await restored.query('SELECT id,state,current_event_id FROM crest.custody_cases WHERE id=ANY($1::uuid[]) ORDER BY state',
   [[held.caseId,released.caseId]])).rows,[
   {id:held.caseId,state:'held',current_event_id:held.eventId},
   {id:released.caseId,state:'released',current_event_id:released.eventId}
  ]);
  assert.deepEqual((await restored.query('SELECT case_id,collection_state FROM crest_private.dropoff_custody_collection_queue WHERE case_id=ANY($1::uuid[])',
   [[held.caseId,released.caseId]])).rows,[{case_id:held.caseId,collection_state:'return_required'}]);
  const readReleaseAudit=connection=>value(connection,
   "SELECT delta value FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='custody_cases'",
   [released.operationId]);
  assert.deepEqual(await readReleaseAudit(restored),await readReleaseAudit(client));
  await restored.query('SET ROLE crest_web');
  await assert.rejects(restored.query('SELECT id FROM crest.custody_events'),{code:'42501'});
  await restored.query('RESET ROLE');
  assert.deepEqual(await inventory(client),original);
 }finally{
  try{await restored?.end();}finally{
   try{await destinationCluster?.close();}finally{await rm(point,{recursive:true,force:true});}
  }
 }
},{timeout:180000});

test('concurrent Drop-Off intake for the same physical vehicle admits only one held case',async()=>{
 const first=await booking(),second=await booking('dropoff',first);
 const a=intake(first),b=intake(second),other=await sandbox.connect(target);
 const backend=await value(other,'SELECT pg_backend_pid() value');
 let outcome;
 await client.query('BEGIN');
 try{
  await insertCase(client,a);await writeHandoffEvent(client,a,1);
  outcome=receive(b,other).then(()=>({committed:true}),error=>({error}));
  const deadline=Date.now()+4000;
  let waiting=false;
  while(!waiting&&Date.now()<deadline){
   await client.query('SELECT pg_stat_clear_snapshot()');
   waiting=await value(client,"SELECT wait_event_type='Lock' value FROM pg_stat_activity WHERE pid=$1",[backend]);
   if(!waiting)await delay(20);
  }
  assert(waiting,'the second intake must reach the unique-index lock');
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');await outcome;throw error;}
 assert.equal((await outcome).error?.constraint,'custody_one_held_case_per_vehicle');
 assert.equal(await state(a),'held');
 assert.equal(await state(b),undefined);
 await cancel(first);
 await release(collection(a));
 await receive(b);
 assert.equal(await state(a),'released');
 assert.equal(await state(b),'held');
},{timeout:15000});
