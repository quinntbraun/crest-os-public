import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {after,before,test} from 'node:test';
import sharp from 'sharp';
import {parseDropoffCustody} from '../../src/operations/dropoff-custody-contract.ts';
import {createDropoffPhotoAccess,createDropoffPhotoDispatch} from '../../src/operations/dropoff-photo-workflow.ts';
import {validateImage} from '../../src/files/image-validation.ts';
import {custodyPhotoDispatcherDatabase,sessionDatabase} from '../../src/security/session-database.ts';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {dropoff67Candidate} from '../support/dropoff67-candidate.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {custodyPhotoObjects} from '../support/custody-photo-objects.mjs';
import {amendmentSourceHistory} from '../support/amendment-source-fixture.mjs';
import {formatDropoffCustodySources} from '../../src/operations/dropoff-custody-source.ts';
import {collectDropoffCustodySourcesInSnapshot} from '../../src/operations/dropoff-custody-source-collector.ts';
import {collectAcceptedAmendmentSources} from '../support/accepted-amendment-source-fixture.mjs';
import {bookingFoundationEvidence} from '../support/booking-source-evidence.mjs';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {parseUnfulfilledCancellationContext,parseUnfulfilledCancellationSave,parseUnfulfilledCancellationCommitted,
 unfulfilledCancellationOriginal} from '../../src/operations/unfulfilled-cancellation-contract.ts';
import {objectDirectory,encryptor,decryptor} from '../support/object-recovery-drill.mjs';
import {
 backupDropoffCommandDatabase,backupDropoffPhotoAccessDatabase,backupDropoffPolicyDatabase,backupDropoffWorkDatabase,backupDropoff67CandidateDatabase,connect,inventory,keyPair,privateWorkspace,recoveryCluster,
 restoreDropoffCandidateDatabase,restoreDropoffCommandDatabase,restoreDropoffPhotoAccessDatabase,restoreDropoffPolicyDatabase,restoreDropoffWorkDatabase,restoreDropoff67CandidateDatabase
} from '../support/recovery-drill.mjs';

const receiveAt='2026-11-03T09:45:00.123456Z',releaseAt='2026-11-03T11:15:00.654321Z';
let target,client,web;
async function value(connection,sql,params=[]){
 return (await connection.query(sql,params)).rows[0]?.value;
}

async function openFixture(parts,custody67=false){
 const cluster=await recoveryCluster();
 let sandbox;
 const close=async()=>{try{await sandbox?.close();}finally{await cluster.close();}};
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),client=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);await installProviderSchema(client,target);
  assert.equal((await sandbox.apply(target,await sandbox.prefix(66))).history.length,66);
  let candidate;
  if(custody67){
   assert.deepEqual(parts,[]);candidate=await dropoff67Candidate(sandbox);
   assert.equal((await sandbox.apply(target,candidate.directory)).history.length,67);
  }
  await client.query('BEGIN');
  try{
   for(const part of parts){
    const sql=await readFile(new URL('../../planning/proposals/dropoff-custody-'+part+'.sql',import.meta.url),'utf8');
    await client.query(sql);
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const web=await sandbox.connect(target);
  await web.query('SET ROLE crest_web');
  const accepted=createConfirmedBookingFixture({client,web,bootstrap:await value(client,
   "SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'")});
  return {target,client,web,accepted,close,candidate};
 }catch(error){await close();throw error;}
}
let fixture;
before(async()=>{
 fixture=await openFixture(['storage','photos','commands','reads']);
 ({target,client,web}=fixture);
},{timeout:240000});
after(async()=>{await fixture?.close();});

async function booking(mode='dropoff',scope=fixture){
 const {client,web}=scope,p=await scope.accepted(),request=confirmedBookingRequest(p);
 request.payload.fulfillmentMode=mode;
 const saved=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...p.auth(),p.epoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]);
 assert.equal(saved.state,'committed',JSON.stringify(saved));
 const row=(await client.query('SELECT j.mode_version_id,v.id FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id WHERE j.business_id=$1 AND j.id=$2 AND v.vehicle_id=$3',
  [p.business,request.jobId,p.vehicle])).rows[0];
 return {...p,jobId:request.jobId,jobVehicleId:row.id,modeVersion:row.mode_version_id};
}
async function configure(p,{acknowledgementText=null,photoRequired=false}={}){
 const configId=randomUUID();
 await client.query('INSERT INTO crest.custody_authorization_configs(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required) VALUES($1,$2,$3,$4,$5)',
  [configId,p.business,p.modeVersion,acknowledgementText,photoRequired]);
 return configId;
}
function handoff(configId,acknowledgementConfirmed=null){
 return {operation:randomUUID(),caseId:randomUUID(),expectedVersion:0,body:{
  authorizationConfigId:configId,effectiveAt:receiveAt,person:{schemaVersion:1,displayName:'Synthetic handing-over customer'},
  location:{schemaVersion:1,kind:'manual',locationText:'Synthetic Crest bay',instructions:null},
  notes:null,missingPhotoReason:'Synthetic camera unavailable',acknowledgementConfirmed
 }};
}
function save(p,input,auth=p.auth(),epoch=p.epoch,connection=web){
 return value(connection,'SELECT crest_commands.save_dropoff_handoff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14) value',
  [...auth,epoch,input.operation,p.jobVehicleId,input.caseId,input.expectedVersion,input.body]);
}
function readOriginal(p,input,auth=p.auth(),epoch=p.epoch){
 return value(web,'SELECT crest_commands.read_dropoff_handoff_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
  [...auth,epoch,input.operation,p.jobVehicleId,input.caseId,input.expectedVersion]);
}
async function cancel(p){
 const result=await value(web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
  [...p.auth(),p.epoch,randomUUID(),p.jobId,{reason:'Synthetic cancellation after intake',
   customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
 assert.equal(result.state,'committed',JSON.stringify(result));
}
const conflict=reason=>({state:'conflict',reason});
const countOriginal=input=>value(client,'SELECT count(*)::int value FROM crest_private.operations WHERE operation_id=$1',[input.operation]);

test('Drop-Off active and paused no-work cancellation retains custody until explicit return',async()=>{
 const scope=await openFixture(['storage','photos','commands','reads','policy','originals','work','completion','queue','source','cancellation','schema-compatibility']);
 try{
  for(const paused of [false,true]){
   const p=await booking('dropoff',scope),configId=randomUUID(),intake=handoff(configId);
   assert.equal((await savePolicy(p,configId,{acknowledgementText:null,conditionPhotoRequired:false},p.modeVersion,p.auth(),scope.web)).state,'committed');
   assert.equal((await save(p,intake,p.auth(),p.epoch,scope.web)).state,'committed');
   const change=(version,action,reason=null)=>value(scope.web,
    'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
    [...p.auth(),p.epoch,randomUUID(),p.jobId,version,{action,reason}]);
   assert.equal((await change(1,'start_dropoff')).state,'committed');
   if(paused)assert.equal((await change(2,'pause','Synthetic pause before any assigned work')).state,'committed');
   const custody=()=>value(scope.client,"SELECT to_jsonb(c)::text value FROM crest.custody_cases c WHERE business_id=$1 AND id=$2",[p.business,intake.caseId]);
   const held=await custody();
   const context=parseUnfulfilledCancellationContext(await value(scope.web,
    'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),p.jobId]),p.business,p.jobId);
   assert.equal(context.jobState,paused?'paused':'in_progress');
   assert.deepEqual(context.openTravelLegVersionIds,[]);
   const request=parseUnfulfilledCancellationSave({schemaVersion:1,businessId:p.business,operationId:randomUUID(),recoveryEpoch:p.epoch,
    jobId:p.jobId,expectedJobVersion:context.jobVersion,body:{reason:'Synthetic cancellation before any assigned work was performed',
     noFulfilledScopeConfirmed:true,expectedWorkIntervalId:context.workIntervalId,expectedOpenTravelLegVersionIds:context.openTravelLegVersionIds,
     scope:context.scope,customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}});
   const send=(input=request,auth=p.auth())=>value(scope.web,
    'SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
    [...auth,input.recoveryEpoch,input.operationId,input.jobId,input.expectedJobVersion,input.body]);
   const invalid=p.auth();invalid[0]=randomBytes(32);await assert.rejects(send(request,invalid),{code:'42501'});
   assert.deepEqual(await send({...request,operationId:randomUUID(),expectedJobVersion:'1'}),conflict('version'));
   assert.deepEqual(await send({...request,operationId:randomUUID(),body:{...request.body,expectedWorkIntervalId:randomUUID()}}),conflict('work'));
   await assert.rejects(send({...request,operationId:randomUUID(),body:{...request.body,noFulfilledScopeConfirmed:false}}),{code:'22023'});
   await scope.web.query('BEGIN');let saved;
   try{saved=await send();assert.equal(saved.state,'committed',JSON.stringify(saved));await scope.web.query('COMMIT');}
   catch(error){await scope.web.query('ROLLBACK');throw error;}
   assert.deepEqual(await send(),saved);
   assert.deepEqual(await send({...request,body:{...request.body,reason:'Changed request'}}),conflict('operation'));
   const original=unfulfilledCancellationOriginal(request);
   const recovered=await value(scope.web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
    [...p.auth(),original]);
   const verified=parseUnfulfilledCancellationCommitted(recovered,request);
   assert.equal(verified.result.receipt.sourceVersion,String(BigInt(context.jobVersion)+1n));
   assert.deepEqual(verified.result.receipt.sourceAuditIds,saved.receipt.sourceAuditIds);
   assert.equal(await custody(),held);
   assert.equal(await value(scope.client,'SELECT count(*)::int value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[p.business,p.jobId]),0);
   assert.equal(await value(scope.client,'SELECT count(*)::int value FROM crest.travel_legs WHERE business_id=$1 AND job_context_id=$2',[p.business,p.jobId]),0);
   assert.equal(await value(scope.client,"SELECT count(*)::int value FROM crest.work_scope_outcomes WHERE business_id=$1 AND job_id=$2 AND (outcome<>'cancelled' OR completed_cents<>0)",[p.business,p.jobId]),0);
   const job=await value(scope.client,"SELECT jsonb_build_object('state',state,'completedAt',completed_at,'outcome',completion_outcome) value FROM crest.jobs WHERE business_id=$1 AND id=$2",[p.business,p.jobId]);
   assert.deepEqual(job,{state:'cancelled',completedAt:null,outcome:null});
   const queue=await value(scope.web,'SELECT crest_commands.list_dropoff_collections($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...p.auth(),null,null]);
   assert(queue.rows.some(row=>row.caseId===intake.caseId&&row.state==='return_required'));
   await scope.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const history=await amendmentSourceHistory(scope.client,p.business);
    const archive=(await collectDropoffCustodySourcesInSnapshot(scope.client,p.business,history,new AbortController().signal)).forServer();
    assert.equal(JSON.parse(archive.manifest).sourceAuditClosureChecked,true);
    assert.equal(archive.rows.custody_cases.find(row=>row.id===intake.caseId).state,'held');
    const field=(await collectFieldSourcesInSnapshot(scope.client,p.business,new AbortController().signal)).forServer();
    assert(field.rows.work_scope_outcomes.some(row=>row.operation_id===request.operationId&&row.outcome==='cancelled'));
   }finally{await scope.client.query('ROLLBACK');}
   const returned={...intake,operation:randomUUID(),expectedVersion:1,body:{...intake.body,effectiveAt:new Date().toISOString().replace(/Z$/,'000Z')}};
   assert.equal((await save(p,returned,p.auth(),p.epoch,scope.web)).state,'committed');
   assert.equal(JSON.parse(await custody()).state,'released');
  }
 }finally{await scope.close();}
},{timeout:240000});

test('Drop-Off work starts explicitly after intake and completion leaves custody open until collection',async()=>{
 const scope=await openFixture(['storage','photos','commands','reads','policy','originals','work','completion','queue']);
 try{
  const p=await booking('dropoff',scope),configId=randomUUID();
  const change=(operation,version,action,reason=null)=>value(scope.web,
   'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...p.auth(),p.epoch,operation,p.jobId,version,{action,reason}]);
  const state=()=>value(scope.client,'SELECT jsonb_build_object(\'state\',state,\'firstWorkAt\',first_work_at) value FROM crest.jobs WHERE business_id=$1 AND id=$2',[p.business,p.jobId]);
  const startId=randomUUID();
  assert.deepEqual(await change(startId,1,'start_dropoff'),conflict('custody'));
  assert.deepEqual(await change(randomUUID(),1,'direct_arrive','Wrong mode'),conflict('state'));
  assert.equal(await value(scope.client,'SELECT count(*)::int value FROM crest_private.operations WHERE operation_id=$1',[startId]),0);
  assert.equal((await savePolicy(p,configId,{acknowledgementText:null,conditionPhotoRequired:false},p.modeVersion,p.auth(),scope.web)).state,'committed');
  const intake=handoff(configId);
  assert.equal((await save(p,intake,p.auth(),p.epoch,scope.web)).state,'committed');
  assert.deepEqual(await state(),{state:'scheduled',firstWorkAt:null});
  const started=await change(startId,1,'start_dropoff');
  assert.equal(started.state,'committed',JSON.stringify(started));
  assert.equal(started.receipt.travelOmissionRecorded,false);
  assert.equal(started.receipt.travelLegId,null);
  assert.equal(started.receipt.mileageStatus,null);
  assert.equal(started.receipt.auditIds.length,3);
  assert.equal((await state()).state,'in_progress');
  assert.equal((await change(randomUUID(),2,'pause','Synthetic pause')).receipt.state,'paused');
  assert.equal((await change(randomUUID(),3,'resume')).receipt.state,'in_progress');
  assert.deepEqual(await change(startId,1,'start_dropoff'),started);
  const original={schemaVersion:1,businessId:p.business,commandType:'operations.job.field',reference:{
   operationId:startId,recoveryEpoch:p.epoch,jobId:p.jobId,expectedJobVersion:'1',action:'start_dropoff'
  }};
  const saved=await value(scope.web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),original]);
  assert.equal(saved.result.state,'committed',JSON.stringify(saved));
  assert.equal(saved.result.receipt.sourceVersion,'2');
  assert.deepEqual(saved.result.receipt.sourceAuditIds,started.receipt.auditIds);
  const readCompletion=()=>value(scope.web,'SELECT crest_commands.read_job_completion_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),p.jobId]);
  const readCustody=()=>value(scope.web,'SELECT crest_commands.read_dropoff_job_custody($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...p.auth(),p.jobId,p.jobVehicleId]);
  const queue=(receivedAt=null,caseId=null,auth=p.auth())=>value(scope.web,
   'SELECT crest_commands.list_dropoff_collections($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...auth,receivedAt,caseId]);
  const emptyQueue={schemaVersion:1,businessId:p.business,hasMore:false,rows:[]};
  assert.deepEqual(await queue(),emptyQueue);
  await assert.rejects(queue(receiveAt),{code:'22023'});
  const invalid=p.auth();invalid[0]=randomBytes(32);
  await assert.rejects(queue(null,null,invalid),{code:'42501'});
  const release={...intake,operation:randomUUID(),expectedVersion:1,body:{...intake.body,effectiveAt:releaseAt}};
  assert.deepEqual(await save(p,release,p.auth(),p.epoch,scope.web),conflict('job'));
  const completion=await readCompletion();
  assert.equal(completion.jobState,'in_progress');
  assert.equal(completion.jobVersion,'4');
  assert(completion.assignments.length>0);
  const body={scope:completion.assignments.map(row=>({
   assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,pieces:[{
    partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,grossInclusiveCents:row.grossInclusiveCents,
    discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null
   }]
  })),reason:null,walkthrough:{state:'done',reason:null},review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,
   expectedDuplicateRequestIds:completion.duplicateRequestIds,expectedCustomerVersion:completion.customerVersion,contactReviewReason:null}};
  const endId=randomUUID();
  const complete=()=>value(scope.web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,4,$12) value',
   [...p.auth(),p.epoch,endId,p.jobId,body]);
  const ended=await complete();
  assert.equal(ended.state,'committed',JSON.stringify(ended));
  assert.equal(ended.receipt.completionOutcome,'full');
  assert(ended.receipt.reviewRequestId&&ended.receipt.finalizationTaskIds.length>0);
  const summary=await readCompletion();
  assert.equal(summary.jobState,'completed');
  assert.equal(summary.outcomes.length,completion.assignments.length);
  assert.equal(await value(scope.client,'SELECT count(*)::int value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[p.business,p.jobId]),0);
  const awaiting=await readCustody();
  assert.equal(awaiting.state,'awaiting_collection');
  assert.equal(awaiting.version,'1');
  assert.equal(awaiting.events.length,1);
  assert.deepEqual(await queue(),{...emptyQueue,rows:[{
   caseId:intake.caseId,jobId:p.jobId,jobVehicleId:p.jobVehicleId,receivedAt:receiveAt,state:'awaiting_collection',
   vehicleLabel:'Synthetic lifecycle sedan',customerName:'Synthetic lifecycle customer'
  }]});
  assert.deepEqual(await queue(receiveAt,intake.caseId),emptyQueue);
  const collected=await save(p,{...release,body:{...release.body,effectiveAt:summary.completedAt}},p.auth(),p.epoch,scope.web);
  assert.equal(collected.state,'committed',JSON.stringify(collected));
  assert.equal((await readCustody()).state,'released');
  assert.deepEqual(await queue(),emptyQueue);
  assert.deepEqual(await readCompletion(),summary);
  assert.deepEqual(await complete(),ended);
  assert.equal(await value(scope.client,'SELECT count(*)::int value FROM crest.travel_legs WHERE business_id=$1 AND job_context_id=$2',[p.business,p.jobId]),0);
 }finally{await scope.close();}
},{timeout:240000});

test('collection pages retain all 26 same-time cancelled handoffs and keep foreign records private',async()=>{
 const scope=await openFixture(['storage','photos','commands','reads','policy','originals','queue']);
 try{
  const principal=await scope.accepted(),cases=[];
  let configId;
  for(let index=0;index<26;index++){
   const p=index===0?principal:await scope.accepted(principal,{customerId:principal.customer});
   const request=confirmedBookingRequest(p);request.payload.fulfillmentMode='dropoff';
   request.expectedModeSequence=await value(scope.client,
    'SELECT coalesce(max(sequence),0)::text value FROM crest.fulfillment_mode_versions WHERE business_id=$1',[p.business]);
   const start=new Date(Date.UTC(2026,10,3+index,10)).toISOString().replace('.000Z','.123456Z');
   const end=new Date(Date.UTC(2026,10,3+index,11)).toISOString().replace('.000Z','.123456Z');
   Object.assign(request.payload.appointment,{start_at:start,end_at:end,local_start:start.slice(0,-1),local_end:end.slice(0,-1)});
   const booked=await value(scope.web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
    [...p.auth(),p.epoch,request.operationId,request.jobId,request.expectedModeSequence,request.payload]);
   assert.equal(booked.state,'committed',JSON.stringify(booked));
   const row=(await scope.client.query('SELECT j.mode_version_id,v.id FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id WHERE j.business_id=$1 AND j.id=$2',
    [p.business,request.jobId])).rows[0];
   const job={...p,jobId:request.jobId,jobVehicleId:row.id,modeVersion:row.mode_version_id};
   if(!configId){
    const configured=await savePolicy(job,randomUUID(),{acknowledgementText:null,conditionPhotoRequired:false},job.modeVersion,job.auth(),scope.web);
    assert.equal(configured.state,'committed');
    configId=await value(scope.client,'SELECT id value FROM crest.custody_authorization_configs WHERE business_id=$1 AND mode_version_id=$2',[p.business,row.mode_version_id]);
   }
   const intake=handoff(configId);cases.push(intake.caseId);
   assert.equal((await save(job,intake,job.auth(),job.epoch,scope.web)).state,'committed');
   const cancelled=await value(scope.web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
    [...job.auth(),job.epoch,randomUUID(),job.jobId,{reason:'Synthetic cancellation with vehicle held',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
   assert.equal(cancelled.state,'committed',JSON.stringify(cancelled));
  }
  const read=(auth,after=null)=>value(scope.web,
   'SELECT crest_commands.list_dropoff_collections($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...auth,after?.receivedAt??null,after?.caseId??null]);
  const first=await read(principal.auth());
  assert.equal(first.rows.length,25);assert.equal(first.hasMore,true);
  assert(first.rows.every(row=>row.state==='return_required'));
  const second=await read(principal.auth(),first.rows.at(-1));
  assert.equal(second.rows.length,1);assert.equal(second.hasMore,false);
  assert.deepEqual([...first.rows,...second.rows].map(row=>row.caseId),cases.sort());
  const foreign=await scope.accepted();
  assert.deepEqual((await read(foreign.auth())).rows,[]);
  const copied=foreign.auth();copied[7]=principal.business;
  await assert.rejects(read(copied),{code:'42501'});
  await assert.rejects(scope.web.query('SELECT * FROM crest_private.dropoff_custody_collection_queue'),{code:'42501'});
 }finally{await scope.close();}
},{timeout:300000});

test('custody source pages preserve original JSON in one private read-only snapshot',async()=>{
 const scope=await openFixture(['storage','photos','commands','reads','policy','originals','work','completion','queue','source','cancellation']);
 try{
  const p=await booking('dropoff',scope),policyOperation=randomUUID();
  assert.equal((await savePolicy(p,policyOperation,{acknowledgementText:'=Synthetic retained policy',conditionPhotoRequired:false},
   p.modeVersion,p.auth(),scope.web)).state,'committed');
  const configId=await value(scope.client,'SELECT id value FROM crest.custody_authorization_configs WHERE business_id=$1 AND mode_version_id=$2',[p.business,p.modeVersion]);
  const input=handoff(configId,true);
  assert.equal((await save(p,input,p.auth(),p.epoch,scope.web)).state,'committed');
  const context=()=>value(scope.client,'SELECT crest_commands.dropoff_custody_source_context($1) value',[p.business]);
  const page=(token,group)=>value(scope.client,'SELECT crest_commands.dropoff_custody_source_page($1,$2,$3,NULL,20) value',[p.business,token,group]);
  await assert.rejects(context(),{code:'25001'});
  await assert.rejects(value(scope.web,'SELECT crest_commands.dropoff_custody_source_context($1) value',[p.business]),{code:'42501'});
  await assert.rejects(value(scope.web,'SELECT * FROM crest_private.dropoff_custody_source_rows($1,$2) value',[p.business,'custody_events']),{code:'42501'});
  await scope.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   await assert.rejects(value(scope.client,'SELECT crest_commands.quote_amendment_accepted_source_context($1) value',[p.business]),{code:'42501'});
  }finally{await scope.client.query('ROLLBACK');}
  const compatibility=await readFile(new URL('../../planning/proposals/dropoff-custody-schema-compatibility.sql',import.meta.url),'utf8');
  for(const mutation of [
   'ALTER TABLE crest.custody_events ADD COLUMN synthetic_unreviewed boolean',
   "ALTER FUNCTION crest_commands.field_source_context(uuid) SET statement_timeout='1s'"
  ]){
   await scope.client.query('BEGIN');
   try{
    await scope.client.query(mutation);
    await assert.rejects(scope.client.query(compatibility),{code:'42501',message:'CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED'});
   }finally{await scope.client.query('ROLLBACK');}
  }
  await scope.client.query('BEGIN');
  try{
   await scope.client.query(compatibility);
   await scope.client.query('COMMIT');
  }catch(error){await scope.client.query('ROLLBACK');throw error;}
  await scope.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let first;
  try{
   first=await context();
   assert.deepEqual(first.expectedCounts,{custody_authorization_configs:'1',custody_cases:'1',custody_events:'1',custody_photo_attempts:'0',custody_photo_originals:'0'});
   const raw=await value(scope.client,'SELECT person_snapshot::text value FROM crest.custody_events WHERE business_id=$1 AND case_id=$2',[p.business,input.caseId]);
   const cancelled=await value(scope.web,'SELECT crest_commands.cancel_scheduled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
    [...p.auth(),p.epoch,randomUUID(),p.jobId,{reason:'Synthetic concurrent cancellation',customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
   assert.equal(cancelled.state,'committed');
   assert.equal((await save(p,{...input,operation:randomUUID(),expectedVersion:1,body:{...input.body,effectiveAt:releaseAt}},
    p.auth(),p.epoch,scope.web)).state,'committed');
   assert.deepEqual(await context(),first);
   const events=await page(first.snapshotToken,'custody_events'),cases=await page(first.snapshotToken,'custody_cases');
   assert.equal(events.rows.length,1);assert.equal(events.hasMore,false);
   assert.equal(events.rows[0].person_snapshot,raw);
   assert.equal(events.rows[0].effective_at,receiveAt);
   assert.equal(events.rows[0].version,'1');
   assert.equal(cases.rows[0].state,'held');
   const policy=await page(first.snapshotToken,'custody_authorization_configs');
   assert.equal(policy.rows[0].acknowledgement_text,'=Synthetic retained policy');
   for(const group of ['custody_photo_attempts','custody_photo_originals'])assert.deepEqual((await page(first.snapshotToken,group)).rows,[]);
   await scope.client.query('COMMIT');
  }catch(error){await scope.client.query('ROLLBACK');throw error;}
  await scope.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const second=await context();assert.equal(second.expectedCounts.custody_events,'2');
   assert.notEqual(second.snapshotToken,first.snapshotToken);
   assert.equal((await page(second.snapshotToken,'custody_cases')).rows[0].state,'released');
   const historyEvidence=await amendmentSourceHistory(scope.client,p.business);
   const collected=await collectDropoffCustodySourcesInSnapshot(scope.client,p.business,historyEvidence,new AbortController().signal);
   const archive=collected.forServer();
   assert.equal(JSON.parse(archive.manifest).sourceAuditClosureChecked,true);
   assert(archive.files['custody_authorization_configs.csv'].includes('"\'=Synthetic retained policy"'));
   assert.throws(()=>JSON.stringify(collected),/CUSTODY_SOURCE_PRIVATE/);
   const input={context:archive.context,rows:archive.rows,historyEvidence};
   assert.deepEqual(formatDropoffCustodySources(input),archive);
   const rewritten=structuredClone(input);
   rewritten.rows.custody_events[0].person_snapshot=JSON.stringify({schemaVersion:1,displayName:'Changed source person'});
   assert.throws(()=>formatDropoffCustodySources(rewritten),/CUSTODY_SOURCE_REVIEW_REQUIRED/);
   const missing=structuredClone(input);missing.rows.custody_events.pop();
   assert.throws(()=>formatDropoffCustodySources(missing),/CUSTODY_SOURCE_REVIEW_REQUIRED/);
   const parent=await collectAcceptedAmendmentSources(scope.client,p.business);
   const field=(await collectFieldSourcesInSnapshot(scope.client,p.business,new AbortController().signal)).forServer();
   const foundation=await bookingFoundationEvidence(scope.client,p.business),crm={};
   for(const [group,routine,fieldName] of [['customers','customer','customers'],['addresses','address','addresses'],
    ['vehicles','vehicle','vehicles'],['associations','association','associations']]){
    const context=await value(scope.client,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[p.business]);
    const records=[];let after=null,done=false;
    for(let count=0;count<10001;count++){
     const page=await value(scope.client,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,$3,20) value',[p.business,context.snapshotToken,after]);
     records.push(...page[fieldName]);
     if(page[fieldName].length<20){done=true;break;}
     after=records.at(-1).id;
    }
    assert(done);
    crm[group]={businessId:p.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows:records};
   }
   const workspace={...foundation,commercial:{...parent,historyEvidence:foundation.history},
    field:{...field,historyEvidence:foundation.history},custody:{...input,historyEvidence:foundation.history},crm};
   const combined=formatFieldWorkspaceSources(workspace);
   const manifest=JSON.parse(combined.manifest);
   assert.equal(manifest.includedCustodyReceiptAuditSetsVerified,true);
   assert.equal(manifest.includedCustodyJobVehicleReferencesVerified,true);
   assert(combined.parts.some(part=>part.name==='custody_events.csv'));
   assert(combined.parts.some(part=>part.name==='custody_source_manifest.json'));
   const prior={...workspace};delete prior.custody;
   const priorBundle=formatFieldWorkspaceSources(prior);
   assert.equal(JSON.parse(priorBundle.manifest).includedCustodyReceiptAuditSetsVerified,undefined);
   assert(!priorBundle.parts.some(part=>part.name.startsWith('custody_')));
   assert.throws(()=>formatFieldWorkspaceSources({...workspace,custody:undefined}),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   await scope.client.query('SAVEPOINT wrong_snapshot');
   await assert.rejects(page(first.snapshotToken,'custody_events'),{code:'22023'});
   await scope.client.query('ROLLBACK TO SAVEPOINT wrong_snapshot');
   await scope.client.query('SAVEPOINT wrong_group');
   await assert.rejects(page(second.snapshotToken,'jobs'),{code:'22023'});
   await scope.client.query('ROLLBACK TO SAVEPOINT wrong_group');
   await scope.client.query('SET LOCAL ROLE crest_export');
   await assert.rejects(context(),{code:'42501'});
  }finally{await scope.client.query('ROLLBACK');}
 }finally{await scope.close();}
},{timeout:240000});

test('authenticated intake and explicit collection persist with audit and recover exact save results',async()=>{
 const p=await booking(),input=handoff(await configure(p,{acknowledgementText:'Synthetic authorized handoff instruction'}),true);
 const intake=await save(p,input);
 assert.equal(intake.state,'committed',JSON.stringify(intake));
 assert.deepEqual(intake.receipt,{schemaVersion:1,caseId:input.caseId,eventId:intake.receipt.eventId,version:'1'});
 assert.deepEqual(await save(p,input),intake);
 assert.deepEqual(await save(p,{...input,body:{...input.body,notes:'Changed original payload'}}),conflict('operation'));
 const originalIntake=await readOriginal(p,input);
 assert.equal(originalIntake.state,'committed');
 assert.deepEqual(originalIntake.receipt,intake.receipt);
 assert.match(originalIntake.auditId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(await readOriginal(p,{...input,expectedVersion:1}),{state:'absent'});
 assert.deepEqual(await readOriginal(p,{...input,caseId:randomUUID()}),{state:'absent'});
 assert.deepEqual(await readOriginal(p,input,p.auth(),randomUUID()),{state:'absent'});
 const collect={...input,operation:randomUUID(),expectedVersion:1,body:{...input.body,effectiveAt:releaseAt,
  person:{schemaVersion:1,displayName:'Synthetic collecting customer'}}};
 assert.deepEqual(await save(p,collect),conflict('job'));
 assert.equal(await countOriginal(collect),0);
 await cancel(p);
 assert.equal(await value(client,'SELECT collection_state value FROM crest_private.dropoff_custody_collection_queue WHERE case_id=$1',[input.caseId]),'return_required');
 const collection=await save(p,collect);
 assert.equal(collection.state,'committed',JSON.stringify(collection));
 assert.equal(collection.receipt.version,'2');
 assert.deepEqual(await save(p,collect),collection);
 assert.deepEqual(await save(p,input),intake);
 assert.deepEqual(await readOriginal(p,input),originalIntake);
 assert.deepEqual((await readOriginal(p,collect)).receipt,collection.receipt);
 assert.equal(await value(client,'SELECT collection_state value FROM crest_private.dropoff_custody_collection_queue WHERE case_id=$1',[input.caseId]),undefined);
 const audit=await value(client,"SELECT delta value FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='custody_cases'",[collect.operation]);
 assert.equal(audit.before.eventId,intake.receipt.eventId);
 assert.equal(audit.after.eventId,collection.receipt.eventId);
 assert.equal(audit.after.effectiveAt,releaseAt);
 assert.equal(audit.after.acknowledgementConfirmed,true);
 assert.equal(audit.after.authorizationConfigId,input.body.authorizationConfigId);
 assert.equal(await countOriginal(input),1);
 assert.equal(await countOriginal(collect),1);
});

test('unconfigured, missing-acknowledgement and photo-required cases refuse without pending operations',async()=>{
 const p=await booking(),unconfigured=handoff(randomUUID());
 assert.deepEqual(await save(p,unconfigured),conflict('policy'));
 const config=await configure(p,{acknowledgementText:'Synthetic handover acknowledgement'});
 const missing=handoff(config);
 assert.deepEqual(await save(p,missing),conflict('acknowledgement'));
 const withPhoto=await booking(),photoInput=handoff(await configure(withPhoto,{photoRequired:true}));
 assert.deepEqual(await save(withPhoto,photoInput),conflict('photo'));
 for(const input of [unconfigured,missing,photoInput]){
  assert.equal(await countOriginal(input),0);
  assert.equal(await value(client,'SELECT id value FROM crest.custody_cases WHERE id=$1',[input.caseId]),undefined);
 }
});

test('invalid proof or recovery epoch cannot write or recover a committed custody original',async()=>{
 const p=await booking(),input=handoff(await configure(p));
 const invalid=p.auth();invalid[0]=randomBytes(32);
 await assert.rejects(save(p,input,invalid));
 await assert.rejects(save(p,input,p.auth(),randomUUID()));
 assert.equal(await countOriginal(input),0);
 assert.equal((await save(p,input)).state,'committed');
 await assert.rejects(save(p,input,invalid));
 await assert.rejects(save(p,input,p.auth(),randomUUID()));
 await assert.rejects(readOriginal(p,input,invalid));
});

test('another business and Mobile mode cannot use a Drop-Off policy or attach a foreign case',async()=>{
 const p=await booking(),other=await booking(),mobile=await booking('mobile');
 const policy=await configure(p),otherPolicy=await configure(other),mobilePolicy=await configure(mobile);
 const foreign=handoff(otherPolicy),mobileHandoff=handoff(mobilePolicy);
 assert.deepEqual(await save(p,foreign),conflict('policy'));
 assert.deepEqual(await save(mobile,mobileHandoff),conflict('job'));
 const exact=handoff(policy);
 assert.equal((await save(p,exact)).state,'committed');
 const wrongParent={...exact,operation:randomUUID(),body:{...exact.body,authorizationConfigId:otherPolicy}};
 assert.deepEqual(await save(other,wrongParent),conflict('version'));
 assert.deepEqual(await readOriginal(other,exact),{state:'absent'});
 for(const input of [foreign,mobileHandoff,wrongParent])assert.equal(await countOriginal(input),0);
});

test('the independent encrypted restore retains the authorized handoff and immutable policy',async()=>{
 const p=await booking(),acknowledgementText='Synthetic policy required at both handoffs';
 const configId=await configure(p,{acknowledgementText}),received=handoff(configId,true);
 const intake=await save(p,received);
 assert.equal(intake.state,'committed');
 await cancel(p);
 const collection={...received,operation:randomUUID(),expectedVersion:1,body:{...received.body,effectiveAt:releaseAt}};
 const released=await save(p,collection);
 assert.equal(released.state,'committed');

 const workspace=await privateWorkspace(),point=join(workspace,'commands');
 let destinationCluster,restored;
 try{
  await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace),original=await inventory(client);
  const {manifest}=await backupDropoffCommandDatabase(client,target,point,keys.recipient);
  assert.deepEqual(manifest.rows,original);
  assert.equal(manifest.completeBackup,false);
  destinationCluster=await recoveryCluster();
  const destination=await destinationCluster.database();
  await assert.rejects(restoreDropoffCandidateDatabase(point,keys.path,destination),
   {message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  assert.deepEqual(await restoreDropoffCommandDatabase(point,keys.path,destination),manifest);
  restored=await connect(destination);
  const config=await value(restored,'SELECT row_to_json(c) value FROM crest.custody_authorization_configs c WHERE id=$1',[configId]);
  assert.equal(config.acknowledgement_text,acknowledgementText);
  assert.equal(config.mode_version_id,p.modeVersion);
  await assert.rejects(restored.query('UPDATE crest.custody_authorization_configs SET acknowledgement_text=NULL WHERE id=$1',[configId]),
   {code:'55000',message:'CREST_FIELD_HISTORY_RETAINED'});
  const events=await restored.query('SELECT id,acknowledgement_confirmed FROM crest.custody_events WHERE case_id=$1 ORDER BY version',[received.caseId]);
  assert.deepEqual(events.rows,[{id:intake.receipt.eventId,acknowledgement_confirmed:true},
   {id:released.receipt.eventId,acknowledgement_confirmed:true}]);
  const originalReadSql='SELECT crest_private.dropoff_custody_original($1,$2,$3) value';
  const sourceOriginal=await value(client,originalReadSql,[p.business,p.actor,collection.operation]);
  assert.deepEqual(await value(restored,originalReadSql,[p.business,p.actor,collection.operation]),sourceOriginal);
  await restored.query('SET ROLE crest_web');
  await assert.rejects(restored.query('SELECT id FROM crest.custody_authorization_configs'),{code:'42501'});
  assert.deepEqual(await inventory(client),original);
 }finally{
  try{await restored?.end();}finally{
   try{await destinationCluster?.close();}finally{await rm(workspace,{recursive:true,force:true});}
  }
 }
},{timeout:180000});

test('ordinary web sessions can use only the protected custody entry point',async()=>{
 const functionName='crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)';
 for(const role of ['anon','authenticated','crest_worker','crest_export']){
  assert.equal(await value(client,'SELECT has_function_privilege($1,$2,\'EXECUTE\') value',[role,functionName]),false);
 }
 for(const table of ['crest.custody_cases','crest.custody_events','crest.custody_authorization_configs']){
  assert.equal(await value(client,"SELECT has_table_privilege('crest_web',$1,'SELECT') value",[table]),false);
  assert.equal(await value(client,"SELECT has_table_privilege('crest_web',$1,'INSERT') value",[table]),false);
 }
 assert.equal(await value(client,'SELECT has_function_privilege(\'crest_web\',$1,\'EXECUTE\') value',[functionName]),true);
});

test('private per-vehicle custody reads bind the saved job and show custody through collection',async()=>{
 const p=await booking(),other=await booking(),mobile=await booking('mobile');
 const read=(jobId=p.jobId,jobVehicleId=p.jobVehicleId,auth=p.auth())=>value(web,
  'SELECT crest_commands.read_dropoff_job_custody($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...auth,jobId,jobVehicleId]);
 const scope={businessId:p.business,jobId:p.jobId,jobVehicleId:p.jobVehicleId,vehicleId:p.vehicle};
 const readRecord=async()=>parseDropoffCustody(await read(),scope);
 const before=await readRecord();
 assert.equal(before.state,'expected');
 assert.equal(before.policy,null);
 assert.equal(before.version,'0');
 assert.deepEqual(await read(p.jobId,other.jobVehicleId),{state:'absent'});
 assert.deepEqual(await read(other.jobId,other.jobVehicleId),{state:'absent'});
 assert.deepEqual(await read(mobile.jobId,mobile.jobVehicleId,mobile.auth()),{state:'absent'});
 const invalid=p.auth();invalid[0]=randomBytes(32);
 await assert.rejects(read(p.jobId,p.jobVehicleId,invalid));
 const configId=await configure(p,{acknowledgementText:'Synthetic custody instruction'});
 const received=handoff(configId,true);
 assert.equal((await readRecord()).policy.id,configId);
 const intake=await save(p,received);
 assert.equal(intake.state,'committed');
 const held=await readRecord();
 assert.equal(held.state,'in_custody');
 assert.equal(held.events[0].eventId,intake.receipt.eventId);
 assert.equal(held.events[0].effectiveAt,receiveAt);
 assert.deepEqual(parseDropoffCustody(JSON.parse(JSON.stringify(held)),scope),held);
 await cancel(p);
 assert.equal((await readRecord()).state,'return_required');
 const collection={...received,operation:randomUUID(),expectedVersion:1,body:{...received.body,effectiveAt:releaseAt}};
 assert.equal((await save(p,collection)).state,'committed');
 const released=await readRecord();
 assert.equal(released.state,'released');
 assert.equal(released.events.length,2);
 assert.equal(released.events[1].effectiveAt,releaseAt);
 assert.equal(released.events[1].acknowledgementConfirmed,true);
});

async function installPolicyCommands(){
 if(await value(client,"SELECT to_regprocedure('crest_private.dropoff_policy_original(uuid,uuid,uuid)') IS NOT NULL value"))return;
 await client.query('BEGIN');
 try{
  for(const part of ['policy','originals']){
   const sql=await readFile(new URL('../../planning/proposals/dropoff-custody-'+part+'.sql',import.meta.url),'utf8');
   await client.query(sql);
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}
}
const savePolicy=(p,id,body,mode=p.modeVersion,auth=p.auth(),connection=web)=>value(connection,
 'SELECT crest_commands.save_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',[...auth,p.epoch,id,mode,body]);

// Privileged fixture for testing custody binding, separate from the future
// validation worker that must check actual object bytes before publication.
function reserveFixturePhoto(connection,job,id,caseId,overrides={}){
 const row={id,business:job.business,jobId:job.jobId,jobVehicleId:job.jobVehicleId,vehicle:job.vehicle,
  caseId,version:1,actor:job.actor,epoch:job.epoch,dispatch:randomUUID(),type:'image/jpeg',size:512,...overrides};
 return connection.query(`INSERT INTO crest.custody_photo_attempts
   (id,business_id,job_id,job_vehicle_id,vehicle_id,case_id,handoff_version,actor_id,recovery_epoch,dispatch_id,declared_type,byte_size)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,Object.values(row));
}
function publishFixturePhoto(connection,job,id,{type='image/jpeg',size=512,hash='a'.repeat(64),width=24,height=16,
 version='crest-image-v1-sharp-0.35.5',verifiedAt=null}={}){
 return connection.query(`INSERT INTO crest.custody_photo_originals
   (business_id,photo_id,detected_type,byte_size,sha256,validation_version,width,height,
    preview_sha256,preview_byte_size,preview_width,preview_height,verified_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,128,24,16,coalesce($10,clock_timestamp()))`,
 [job.business,id,type,size,hash,version,width,height,'b'.repeat(64),verifiedAt]);
}

test('common Save review resolves committed custody and retires an absent original before late delivery',async()=>{
 await installPolicyCommands();
 const p=await booking(),config=randomUUID(),retained=handoff(config),saved=handoff(config);
 assert.equal((await savePolicy(p,config,{acknowledgementText:null,conditionPhotoRequired:false})).state,'committed');
 const reference=input=>({schemaVersion:1,businessId:p.business,commandType:'operations.custody.save',reference:{
  operationId:input.operation,recoveryEpoch:p.epoch,jobVehicleId:p.jobVehicleId,caseId:input.caseId,expectedVersion:String(input.expectedVersion)
 }});
 const typed=original=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),original]);
 const retire=original=>value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
  [...p.auth(),p.epoch,original,'Synthetic original was not confirmed']);
 assert.deepEqual(await typed(reference(retained)),{state:'absent'});
 const retirement=await retire(reference(retained));
 assert.equal(retirement.state,'retired');
 assert.deepEqual(await save(p,retained),conflict('operation'));
 assert.equal(await value(client,'SELECT count(*)::int value FROM crest.custody_events WHERE operation_id=$1',[retained.operation]),0);
 const savedResult=await save(p,saved);
 assert.equal(savedResult.state,'committed');
 const original=reference(saved),resolved=await typed(original);
 assert.equal(resolved.result.state,'committed');
 assert.equal(resolved.result.receipt.sourceRecordId,savedResult.receipt.eventId);
 assert.equal(resolved.result.receipt.sourceVersion,'1');
 assert.equal(resolved.result.receipt.subjectId,saved.caseId);
 assert.equal(resolved.result.receipt.sourceAuditIds.length,1);
 assert.equal((await retire(original)).state,'original_recorded');
 assert.deepEqual(await typed({...original,reference:{...original.reference,jobVehicleId:randomUUID()}}),{state:'absent'});
 await assert.rejects(typed({...original,reference:{...original.reference,expectedVersion:'2'}}),{code:'22023'});
});

test('an owner records one policy per exact saved Drop-Off arrangement with retained original evidence',async()=>{
 await installPolicyCommands();
 const p=await booking(),other=await booking(),id=randomUUID();
 const body={acknowledgementText:'Synthetic handoff instructions reviewed by the owner',conditionPhotoRequired:true};
 const read=(mode=p.modeVersion)=>value(web,'SELECT crest_commands.read_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),mode]);
 assert.deepEqual(await read(),{state:'absent'});
 assert.deepEqual(await read(other.modeVersion),{state:'absent'});
 assert.deepEqual(await savePolicy(p,randomUUID(),body,other.modeVersion),conflict('mode'));
 const invalid=p.auth();invalid[0]=randomBytes(32);
 await assert.rejects(savePolicy(p,id,body,p.modeVersion,invalid),{code:'42501'});
 await assert.rejects(client.query('INSERT INTO crest.custody_authorization_configs(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required) VALUES($1,$2,$3,NULL,false)',
  [randomUUID(),p.business,p.modeVersion]),{code:'23514',message:'CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED'});
 const originalFor=operationId=>({schemaVersion:1,businessId:p.business,commandType:'operations.custody.policy.save',
  reference:{operationId,recoveryEpoch:p.epoch,modeVersionId:p.modeVersion}});
 const retiredId=randomUUID();
 const retired=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
  [...p.auth(),p.epoch,originalFor(retiredId),'Synthetic missing policy save']);
 assert.equal(retired.state,'retired');
 assert.deepEqual(await savePolicy(p,retiredId,body),conflict('operation'));
 const saved=await savePolicy(p,id,body);
 assert.equal(saved.state,'committed');
 assert.deepEqual(saved.policy,{id,modeVersionId:p.modeVersion,...body});
 assert.deepEqual(await savePolicy(p,id,body),saved);
 assert.deepEqual(await savePolicy(p,id,{...body,acknowledgementText:null}),conflict('operation'));
 assert.deepEqual(await savePolicy(p,randomUUID(),body),conflict('configured'));
 assert.deepEqual(await read(),saved.policy);
 const original=originalFor(id);
 const resolved=await value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...p.auth(),original]);
 assert.equal(resolved.result.receipt.subjectId,p.modeVersion);
 assert.equal(resolved.result.receipt.sourceRecordId,id);
 assert.deepEqual(resolved.result.receipt.sourceAuditIds,[saved.auditId]);
 assert.deepEqual(await save(p,handoff(id,true)),conflict('photo'));
});

test('encrypted custody recovery restores the owner policy, bound handoff and condition photo metadata',async()=>{
 const source=await openFixture(['storage','photos','commands','reads','policy','originals']);
 let destinationCluster,restored,workspace;
 try{
  const p=await booking('dropoff',source),id=randomUUID();
  const body={acknowledgementText:'Synthetic owner-configured policy',conditionPhotoRequired:true};
  const policy=await savePolicy(p,id,body,p.modeVersion,p.auth(),source.web);
  assert.equal(policy.state,'committed');
  const input=handoff(id,true),photo=randomUUID();
  input.body={...input.body,missingPhotoReason:null,conditionPhotoId:photo};
  await reserveFixturePhoto(source.client,p,photo,input.caseId);
  await publishFixturePhoto(source.client,p,photo);
  const intake=await save(p,input,p.auth(),p.epoch,source.web);
  assert.equal(intake.state,'committed');
  workspace=await privateWorkspace();
  const point=join(workspace,'policy');await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace),original=await inventory(source.client);
  const {manifest}=await backupDropoffPolicyDatabase(source.client,source.target,point,keys.recipient);
  assert.deepEqual(manifest.rows,original);
  destinationCluster=await recoveryCluster();const destination=await destinationCluster.database();
  await assert.rejects(restoreDropoffCommandDatabase(point,keys.path,destination),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  assert.deepEqual(await restoreDropoffPolicyDatabase(point,keys.path,destination),manifest);
  restored=await connect(destination);
  const restoredPolicy=await value(restored,'SELECT crest_private.dropoff_policy_original($1,$2,$3) value',[p.business,p.actor,id]);
  assert.deepEqual(restoredPolicy.policy,policy.policy);
  assert.equal(restoredPolicy.auditId,policy.auditId);
  assert.equal(await value(restored,'SELECT authorization_config_id value FROM crest.custody_cases WHERE id=$1',[intake.receipt.caseId]),id);
  assert.equal(await value(restored,'SELECT condition_photo_id value FROM crest.custody_events WHERE id=$1',[intake.receipt.eventId]),photo);
  assert.equal(await value(restored,'SELECT sha256 value FROM crest.custody_photo_originals WHERE photo_id=$1',[photo]),'a'.repeat(64));
  await restored.query('SET ROLE crest_web');
  await assert.rejects(restored.query('SELECT id FROM crest.custody_authorization_configs'),{code:'42501'});
  assert.deepEqual(await inventory(source.client),original);
 }finally{
  try{await restored?.end();}finally{
   try{await destinationCluster?.close();}finally{
    try{if(workspace)await rm(workspace,{recursive:true,force:true});}finally{await source.close();}
   }
  }
 }
},{timeout:240000});

test('condition photos require verified originals for the same business, booked vehicle, case, handoff and epoch',async()=>{
 const job=await booking(),other=await booking(),id=randomUUID(),caseId=randomUUID();
 const attempt=overrides=>reserveFixturePhoto(client,job,id,caseId,overrides);
 const verify=(params=[job.business,id,job.jobVehicleId,caseId,1,job.epoch],connection=client)=>
  value(connection,'SELECT crest_private.verified_dropoff_photo($1,$2,$3,$4,$5,$6) value',params);
 const original=overrides=>publishFixturePhoto(client,job,id,overrides);

 await assert.rejects(attempt({jobVehicleId:other.jobVehicleId}),{code:'23503'});
 await assert.rejects(attempt({vehicle:other.vehicle}),{code:'23503'});
 await assert.rejects(attempt({actor:other.actor}),{code:'23503'});
 await assert.rejects(attempt({type:'application/pdf'}),{code:'23514'});
 await assert.rejects(attempt({size:26214401}),{code:'23514'});
 await assert.rejects(original(),{code:'23503'});
 await attempt();
 assert.equal(await verify(),false,'an upload reservation is not verified evidence');
 await assert.rejects(original({type:'image/png'}),{code:'23503'});
 await assert.rejects(original({size:513}),{code:'23503'});
 await assert.rejects(original({hash:'unknown'}),{code:'23514'});
 await assert.rejects(original({version:'unknown'}),{code:'23514'});
 await assert.rejects(original({width:10000,height:10000}),{code:'23514'});
 await original();
 assert.equal(await verify(),true);
 for(const params of [
  [other.business,id,job.jobVehicleId,caseId,1,job.epoch],
  [job.business,randomUUID(),job.jobVehicleId,caseId,1,job.epoch],
  [job.business,id,other.jobVehicleId,caseId,1,job.epoch],
  [job.business,id,job.jobVehicleId,randomUUID(),1,job.epoch],
  [job.business,id,job.jobVehicleId,caseId,2,job.epoch],
  [job.business,id,job.jobVehicleId,caseId,1,randomUUID()]
 ]) assert.equal(await verify(params),false);

 await assert.rejects(original(),{code:'23505'});
 await assert.rejects(client.query('UPDATE crest.custody_photo_originals SET preview_sha256=sha256'),{code:'55000'});
 await assert.rejects(client.query('DELETE FROM crest.custody_photo_attempts'),{code:'55000'});
 for(const table of ['custody_photo_attempts','custody_photo_originals'])
  await assert.rejects(web.query('SELECT 1 FROM crest.'+table),{code:'42501'});
 await assert.rejects(verify(undefined,web),{code:'42501'});
});

test('required condition photo is checked before intake and release and retained in the exact audit',async()=>{
 await installPolicyCommands();
 const job=await booking(),config=randomUUID();
 assert.equal((await savePolicy(job,config,{acknowledgementText:null,conditionPhotoRequired:true})).state,'committed');
 const base=handoff(config),photo=randomUUID(),input={...base,body:{...base.body,missingPhotoReason:null,conditionPhotoId:photo}};
 assert.deepEqual(await save(job,base),conflict('photo'));
 await assert.rejects(save(job,{...input,body:{...input.body,missingPhotoReason:'Both supplied'}}),{code:'22023'});
 await reserveFixturePhoto(client,job,photo,input.caseId);
 assert.deepEqual(await save(job,input),conflict('photo'));
 assert.equal(await countOriginal(input),0);
 await publishFixturePhoto(client,job,photo);
 assert.deepEqual(await save(job,{...input,caseId:randomUUID()}),conflict('photo'));
 const intake=await save(job,input);
 assert.equal(intake.state,'committed');
 assert.deepEqual(await save(job,input),intake);
 assert.deepEqual(await save(job,base),conflict('operation'));
 await cancel(job);
 const release={...input,operation:randomUUID(),expectedVersion:1,body:{...input.body,effectiveAt:releaseAt}};
 assert.deepEqual(await save(job,release),conflict('photo'));
 const releasePhoto=randomUUID();
 await reserveFixturePhoto(client,job,releasePhoto,input.caseId,{version:2});
 await publishFixturePhoto(client,job,releasePhoto);
 release.body.conditionPhotoId=releasePhoto;
 const saved=await save(job,release);
 assert.equal(saved.state,'committed');
 const audit=await value(client,"SELECT delta value FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='custody_cases'",[release.operation]);
 assert.equal(audit.before.conditionPhotoId,photo);
 assert.equal(audit.after.conditionPhotoId,releasePhoto);
 assert.equal(audit.after.missingPhotoReason,null);
 const read=await value(web,'SELECT crest_commands.read_dropoff_job_custody($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
  [...job.auth(),job.jobId,job.jobVehicleId]);
 assert.deepEqual(parseDropoffCustody(read,{businessId:job.business,jobId:job.jobId,jobVehicleId:job.jobVehicleId})
  .events.map(event=>event.conditionPhotoId),[photo,releasePhoto]);
});

async function installPhotoCommands(){
 await installPolicyCommands();
 if(await value(client,"SELECT to_regrole('crest_custody_photo_dispatch') IS NOT NULL value"))return;
 await client.query('BEGIN');
 try{
  for(const part of ['commands','access'])await client.query(
   await readFile(new URL('../../planning/proposals/dropoff-custody-photo-'+part+'.sql',import.meta.url),'utf8'));
  await client.query('COMMIT');
 }
 catch(error){await client.query('ROLLBACK');throw error;}
}

test('photo authority reserves, issues a bounded upload window and publishes only from the dispatcher role',async()=>{
 await installPhotoCommands();
 const job=await booking(),config=randomUUID(),photo=randomUUID(),input=handoff(config);
 const other=await booking();
 assert.equal((await savePolicy(job,config,{acknowledgementText:null,conditionPhotoRequired:true})).state,'committed');
 const reserve=(id=photo,booked=job.jobVehicleId,size=512)=>value(web,
  'SELECT crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14) value',
  [...job.auth(),job.epoch,id,booked,input.caseId,'image/jpeg',size]);
 const read=(connection=web,auth=job.auth())=>value(connection,
  'SELECT crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...auth,photo]);
 const upload=(epoch=job.epoch)=>value(web,
  'SELECT crest_commands.check_dropoff_photo_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[...job.auth(),epoch,photo]);
 const candidate={detected_type:'image/jpeg',byte_size:512,sha256:'a'.repeat(64),validation_version:'crest-image-v1-sharp-0.35.5',
  width:24,height:16,display_width:null,display_height:null,bit_depth:null,preview_sha256:'b'.repeat(64),
  preview_byte_size:128,preview_width:24,preview_height:16};
 const publish=(connection,metadata=candidate,epoch=job.epoch)=>value(connection,
  'SELECT crest_commands.publish_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',[...job.auth(),epoch,photo,metadata]);
 const audit=(connection=web,{booked=job.jobVehicleId,digest=candidate.sha256,size=candidate.byte_size,epoch=job.epoch}={})=>
  value(connection,'SELECT crest_commands.record_dropoff_original_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
   [...job.auth(),epoch,booked,photo,digest,size]);
 const worker=await connect(target);
 try{
  await worker.query('SET ROLE crest_custody_photo_dispatch');
  await assert.rejects(reserve(photo,other.jobVehicleId),{code:'23514',message:'CREST_CUSTODY_PHOTO_SLOT_UNAVAILABLE'});
  const attempt=await reserve();
  assert.equal(attempt.id,photo);
  assert.deepEqual(await reserve(),attempt);
  await assert.rejects(reserve(photo,job.jobVehicleId,513),{message:'CREST_CUSTODY_PHOTO_RESERVATION_CHANGED'});
  assert.deepEqual(await read(),{reservation:attempt,original:null,linked:false});
  await assert.rejects(audit(),{code:'42501'});
  assert.equal(await read(web,other.auth()),null);
  const seconds=await upload();
  assert(seconds>=1&&seconds<=600);
  await assert.rejects(upload(randomUUID()),{code:'P0001',message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(publish(web),{code:'42501'});
  await assert.rejects(worker.query('SELECT 1 FROM crest.custody_photo_originals'),{code:'42501'});
  await assert.rejects(publish(worker,{...candidate,byte_size:513}),{code:'23503'});
  const original=await publish(worker);
  assert.equal(original.sha256,candidate.sha256);
  assert.deepEqual(await publish(worker),original);
  await assert.rejects(publish(worker,{...candidate,sha256:'f'.repeat(64)}),{message:'CREST_CUSTODY_PHOTO_ORIGINAL_CHANGED'});
  await assert.rejects(upload(),{message:'CREST_CUSTODY_PHOTO_NOT_PENDING'});
  const before=await read();
  assert.equal(before.linked,false);
  await assert.rejects(audit(),{code:'42501'});
  const saved=await save(job,{...input,body:{...input.body,missingPhotoReason:null,conditionPhotoId:photo}});
  assert.equal(saved.state,'committed');
  assert.deepEqual(await read(),{reservation:attempt,original,linked:true});
  await assert.rejects(audit(worker),{code:'42501'});
  await assert.rejects(audit(web,{booked:other.jobVehicleId}),{code:'42501'});
  await assert.rejects(audit(web,{digest:'c'.repeat(64)}),{code:'42501'});
  await assert.rejects(audit(web,{size:513}),{code:'42501'});
  await assert.rejects(audit(web,{epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
  const access=await audit(),again=await audit();
  assert.deepEqual(access.scope,{photoId:photo,jobVehicleId:job.jobVehicleId,caseId:input.caseId,
   handoffEventId:saved.receipt.eventId,sha256:candidate.sha256,byteSize:512,contentType:'image/jpeg'});
  assert.notEqual(access.operationId,again.operationId);
  const accessRows=await client.query("SELECT action,delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='custody_photo_accesses'",[job.business]);
  assert.equal(accessRows.rowCount,2);
  for(const row of accessRows.rows)assert.deepEqual(row,{action:'authorized_handoff',delta:{schemaVersion:1,before:null,after:access.scope}});
  const events=(await client.query("SELECT action FROM crest_private.audit_events WHERE entity_kind='custody_photos' AND entity_id=$1 ORDER BY entity_version",[photo])).rows;
  assert.deepEqual(events,[{action:'reserve'},{action:'publish'}]);
 }finally{await worker.end();}
});

for(const profile of ['photo','work','candidate67']){
 const withWork=profile!=='photo',custody67=profile==='candidate67';
 test(custody67?'schema67 custody candidate restores cancelled work, held vehicles and photo evidence independently':
 withWork?'Drop-Off work sources, condition-photo bytes and exact work receipts survive encrypted restore':
 'generated condition-photo bytes and authorized original access survive encrypted restore',async()=>{
 const source=await openFixture(custody67?[]:['storage','photos','commands','reads','policy','originals','photo-commands','photo-access',
  ...withWork?['work','completion','queue']:[]],custody67);
 let storage,workspace,destinationCluster,destination;
 try{
 const {target,client,web}=source;
 const job=await booking('dropoff',source),config=randomUUID(),photoId=randomUUID(),input=handoff(config);
 assert.equal((await savePolicy(job,config,{acknowledgementText:null,conditionPhotoRequired:true},job.modeVersion,job.auth(),web)).state,'committed');
 const image=await sharp({create:{width:64,height:32,channels:3,background:'#654a28'}})
  .withExif({IFD0:{Copyright:'Fictional generated image'}}).png().toBuffer();
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const signal=AbortSignal.timeout(30000),subject={businessId:job.business,jobVehicleId:job.jobVehicleId,photoId};
 const credential='fictional-port-credential';
 const assertScope=(incoming,scope)=>{assert.equal(incoming,credential);assert.deepEqual(scope,subject);};
 const read=(session,scope)=>{
  assertScope(session,scope);
  return value(web,'SELECT crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...job.auth(),scope.photoId]);
 };
 const writable=(session,scope,epoch)=>{
  assertScope(session,scope);
  return value(web,'SELECT crest_commands.check_dropoff_photo_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...job.auth(),epoch,scope.photoId]);
 };
 const login='crest_photo_test_'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
 const workerUrl=new URL(target);
 workerUrl.username=login;workerUrl.password=password;
 const configuration={connectionString:workerUrl.toString(),environment:'test'};
 storage=await custodyPhotoObjects();
  await client.query(`CREATE ROLE "${login}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await client.query(`GRANT crest_custody_photo_dispatch TO "${login}"`);
  const worker=custodyPhotoDispatcherDatabase(configuration);
  await assert.rejects(sessionDatabase(configuration)('SELECT 1 AS result',[],signal),{message:'SESSION_DATABASE_FAILED'});
  const publish=(session,scope,epoch,metadata)=>{
   assertScope(session,scope);
   return worker.commandTransaction(query=>query(
    'SELECT crest_commands.publish_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
    [...job.auth(),epoch,scope.photoId,metadata]),signal);
  };
  const access=createDropoffPhotoAccess({read,writable},storage.store);
  // Native decoder runs only on generated test bytes here. The real isolated
  // worker remains a separate end-to-end deployment gate.
  const dispatch=createDropoffPhotoDispatch({read,writable,publish},storage.store,{validate:validateImage});
  const reservation=await value(web,'SELECT crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14) value',
   [...job.auth(),job.epoch,photoId,job.jobVehicleId,input.caseId,'image/png',image.length]);
  await assert.rejects(access.download(credential,subject,'original',signal),{message:'DROPOFF_PHOTO_UNCONFIRMED'});
  const upload=await access.upload(credential,subject,signal);
  assert.throws(()=>JSON.stringify(upload));
  const capability=upload.forUpload();
  assert(capability.expiresInSeconds<=600&&capability.expiresInSeconds>=1);
  const put=await fetch(capability.url,{method:capability.method,headers:capability.headers,body:image,signal});
  assert.equal(put.status,200);
  storage.loseNextOriginal();
  const published=await dispatch(credential,subject,signal);
  assert.equal(published.sha256,hash(image));
  assert.deepEqual(await dispatch(credential,subject,signal),published);
  const originalKey=`originals/${job.business}/${reservation.dispatch_id}`;
  assert.equal(storage.requests.filter(request=>request.key===originalKey&&request.method==='PUT').length,1);
  await assert.rejects(access.download(credential,subject,'preview',signal),{message:'DROPOFF_PHOTO_UNCONFIRMED'});
  const saved=await save(job,{...input,body:{...input.body,missingPhotoReason:null,conditionPhotoId:photoId}},job.auth(),job.epoch,web);
  assert.equal(saved.state,'committed');
  const original=await access.download(credential,subject,'original',signal);
  assert.equal(original.contentType,'image/png');
  assert.deepEqual(original.bytes,image);
  const accessReceipt=await value(web,'SELECT crest_commands.record_dropoff_original_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
   [...job.auth(),job.epoch,job.jobVehicleId,photoId,original.sha256,original.bytes.length]);
  assert.equal(accessReceipt.scope.handoffEventId,saved.receipt.eventId);
  const preview=await access.download(credential,subject,'preview',signal);
  const metadata=await sharp(preview.bytes).metadata();
  assert.equal(metadata.format,'jpeg');
  assert.equal(metadata.exif,undefined);
  assert.equal(hash(preview.bytes),published.preview_sha256);
  const retained=storage.objects.get(originalKey);
  storage.objects.set(originalKey,{...retained,bytes:Buffer.alloc(image.length)});
  await assert.rejects(access.download(credential,subject,'original',signal),{code:'OBJECT_BYTES_MISMATCH'});
  storage.objects.set(originalKey,retained);
  let denyRead=false;
  const guarded=createDropoffPhotoAccess({writable,read:(...args)=>denyRead?Promise.resolve(null):read(...args)},storage.store);
  storage.onRead(()=>{denyRead=true;});
  await assert.rejects(guarded.download(credential,subject,'original',signal),{message:'DROPOFF_PHOTO_UNCONFIRMED'});
  storage.onRead(()=>{});
  await client.query(`DROP ROLE "${login}"`);

  const workOperation=withWork?randomUUID():null;
  const workResult=withWork?await value(web,
   'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,1,$12) value',
   [...job.auth(),job.epoch,workOperation,job.jobId,{action:'start_dropoff',reason:null}]):null;
  if(withWork)assert.equal(workResult.state,'committed',JSON.stringify(workResult));
  let cancellationOperation,cancellationResult;
  if(custody67){
   const context=await value(web,'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...job.auth(),job.jobId]);
   cancellationOperation=randomUUID();
   cancellationResult=await value(web,'SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
    [...job.auth(),job.epoch,cancellationOperation,job.jobId,context.jobVersion,{reason:'Synthetic cancellation before assigned work',
     noFulfilledScopeConfirmed:true,expectedWorkIntervalId:context.workIntervalId,expectedOpenTravelLegVersionIds:context.openTravelLegVersionIds,
     scope:context.scope,customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}}]);
   assert.equal(cancellationResult.state,'committed',JSON.stringify(cancellationResult));
  }
  workspace=await privateWorkspace();
  const point=join(workspace,'point');await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace),vault=await objectDirectory(join(workspace,'vault'));
  const recovered=await objectDirectory(join(workspace,'recovered'));
  const before=await inventory(client);
  const sourceInventory=async database=>(await database.query(`
   SELECT key,"byteSize",sha256,retention FROM (
    SELECT 'originals/'||a.business_id||'/'||a.dispatch_id key,o.byte_size "byteSize",o.sha256,'original' retention
    FROM crest.custody_photo_attempts a JOIN crest.custody_photo_originals o ON (a.business_id,a.id)=(o.business_id,o.photo_id)
    UNION ALL
    SELECT 'previews/'||a.business_id||'/'||a.dispatch_id,o.preview_byte_size,o.preview_sha256,'derivative'
    FROM crest.custody_photo_attempts a JOIN crest.custody_photo_originals o ON (a.business_id,a.id)=(o.business_id,o.photo_id)
   ) files ORDER BY key COLLATE "C"`)).rows;
  const backup=custody67?backupDropoff67CandidateDatabase.bind(null,source.candidate):withWork?backupDropoffWorkDatabase:backupDropoffPhotoAccessDatabase;
  const restore=custody67?restoreDropoff67CandidateDatabase.bind(null,source.candidate):withWork?restoreDropoffWorkDatabase:restoreDropoffPhotoAccessDatabase;
  const {manifest}=await backup(client,target,point,keys.recipient,{
   inventory:sourceInventory,
   capture:objects=>captureObjectArchive(randomUUID(),objects,{
    readSource:(key,byteSize,abort)=>{
     const object=objects.find(item=>item.key===key);
     assert.equal(object?.byteSize,byteSize);
     return storage.store.readVerifiedCandidate({key,byteSize,sha256:object.sha256,
      contentType:object.retention==='original'?'image/png':'image/jpeg'},abort);
    },seal:encryptor(keys.recipient),putVault:vault.put,readVault:vault.read
   })
  });
  destinationCluster=await recoveryCluster();const destinationUrl=await destinationCluster.database();
  await assert.rejects(restoreDropoffPolicyDatabase(point,keys.path,destinationUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  if(withWork)await assert.rejects(restoreDropoffPhotoAccessDatabase(point,keys.path,destinationUrl,()=>{}),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  const restored=await restore(point,keys.path,destinationUrl,archive=>restoreObjectArchive(archive.receipt,
   archive.inventory,{readVault:vault.read,unseal:decryptor(keys.path),putDestination:recovered.put,readDestination:recovered.read}));
  assert.deepEqual(restored,manifest);
  destination=await connect(destinationUrl);
  if(withWork){
   assert.deepEqual(await value(destination,'SELECT crest_private.field_session_result($1,$2,$3) value',
    [job.business,job.actor,workOperation]),workResult);
   if(!custody67)await destination.query('SELECT crest_private.check_field_session_graph($1,$2,$3)',[job.business,job.jobId,workOperation]);
   assert.equal(await value(destination,'SELECT state value FROM crest.jobs WHERE business_id=$1 AND id=$2',[job.business,job.jobId]),custody67?'cancelled':'in_progress');
   if(custody67){
    assert.deepEqual(await value(destination,'SELECT crest_private.unfulfilled_job_result($1,$2,$3) value',
     [job.business,job.actor,cancellationOperation]),cancellationResult);
    await destination.query('SELECT crest_private.check_unfulfilled_job_graph($1,$2,$3)',[job.business,job.jobId,cancellationOperation]);
    assert.equal(await value(destination,'SELECT state value FROM crest.custody_cases WHERE business_id=$1 AND id=$2',[job.business,input.caseId]),'held');
    assert.equal(await value(destination,'SELECT count(*)::int value FROM crest.current_work_intervals WHERE business_id=$1 AND job_id=$2 AND ended_at IS NULL',[job.business,job.jobId]),0);
   }
   if(!custody67){await destination.query('BEGIN');
   try{
    await destination.query(await readFile(new URL('../../planning/proposals/dropoff-custody-source.sql',import.meta.url),'utf8'));
    await destination.query('COMMIT');
   }catch(error){await destination.query('ROLLBACK');throw error;}}
   await destination.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const context=await value(destination,'SELECT crest_commands.dropoff_custody_source_context($1) value',[job.business]);
    const source=group=>value(destination,'SELECT crest_commands.dropoff_custody_source_page($1,$2,$3,NULL,20) value',
     [job.business,context.snapshotToken,group]);
    const attempts=await source('custody_photo_attempts'),originals=await source('custody_photo_originals');
    assert.equal(attempts.rows.length,1);assert.equal(originals.rows.length,1);
    assert.equal(attempts.rows[0].id,photoId);
    assert.equal(attempts.rows[0].dispatch_id,reservation.dispatch_id);
    assert.equal(originals.rows[0].photo_id,photoId);
    assert.equal(originals.rows[0].sha256,hash(image));
    assert.equal(originals.rows[0].byte_size,image.length);
    assert.equal(originals.rows[0].preview_sha256,hash(preview.bytes));
    assert.equal(originals.rows[0].preview_byte_size,preview.bytes.length);
    assert.match(originals.rows[0].verified_at,/\.\d{6}Z$/);
    const history=await amendmentSourceHistory(destination,job.business);
    const bundle=(await collectDropoffCustodySourcesInSnapshot(destination,job.business,history,new AbortController().signal)).forServer();
    assert.equal(JSON.parse(bundle.manifest).sourceAuditClosureChecked,true);
    const selected=JSON.parse(bundle.files['custody_source.json']).historyEvidence.records;
    assert(selected.some(record=>JSON.parse(record.canonicalEvidence).row.entity_kind==='custody_photo_accesses'));
    const changed={context:bundle.context,rows:structuredClone(bundle.rows),historyEvidence:history};
    changed.rows.custody_photo_originals[0].sha256='f'.repeat(64);
    assert.throws(()=>formatDropoffCustodySources(changed),/CUSTODY_SOURCE_REVIEW_REQUIRED/);
    const wrongMetadata={context:bundle.context,rows:structuredClone(bundle.rows),historyEvidence:history};
    wrongMetadata.rows.custody_photo_originals[0].bit_depth=8;
    assert.throws(()=>formatDropoffCustodySources(wrongMetadata),/CUSTODY_SOURCE_REVIEW_REQUIRED/);
   }finally{await destination.query('ROLLBACK');}
  }
  assert.deepEqual(await sourceInventory(destination),manifest.objectArchive.inventory);
  assert.equal(await value(destination,'SELECT condition_photo_id value FROM crest.custody_events WHERE id=$1',[saved.receipt.eventId]),photoId);
  assert.deepEqual(await value(destination,'SELECT delta value FROM crest_private.audit_events WHERE id=$1',[accessReceipt.auditEventId]),
   {schemaVersion:1,before:null,after:accessReceipt.scope});
  const restoredOriginal=await recovered.read(originalKey,image.length,AbortSignal.timeout(30000));
  assert.deepEqual(restoredOriginal,image);
  const restoredPreview=await recovered.read(`previews/${job.business}/${reservation.dispatch_id}`,preview.bytes.length,AbortSignal.timeout(30000));
  assert.deepEqual(restoredPreview,preview.bytes);
  assert.deepEqual(await inventory(client),before);
 if(custody67){
  await mkdir('.local/dropoff67-recovery',{recursive:true});
  await writeFile('.local/dropoff67-recovery/result.json',JSON.stringify({schemaVersion:67,
   registrySha256:manifest.registrySha256,migrationSha256:manifest.heldCustody67MigrationSha256,tableCount:manifest.rows.length,
   independentDatabase:true,encryptedDumpAndObjects:true,rowAndSchemaHashesMatched:true,cancelledWorkAndHeldCustodyRetained:true,
   originalAndPreviewBytesMatched:true,sourceAuditClosureVerified:true,olderProfileRefused:true,
   completeBackup:false,registered:false,ownerPreviewChanged:false},null,2)+'\n');
 }
 }finally{
  try{await destination?.end();}finally{try{await destinationCluster?.close();}finally{
   try{if(workspace)await rm(workspace,{recursive:true,force:true});}finally{
    try{await storage?.close();}finally{await source.close();}
   }
  }}
 }
},{timeout:240000});
}
