import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupLegacy68Database,backupLegacy69Database,backupLegacy70Database,backupPickupReturnCandidateDatabase,connect,hash,inventory,keyPair,privateWorkspace,
 recoveryCluster,restoreLegacy68Database,restoreLegacy69Database,restoreLegacy70Database,restorePickupReturnCandidateDatabase} from '../support/recovery-drill.mjs';
import {requireSyntheticPickupCustody,requireSyntheticPickupReturnWorkflow} from '../../scripts/synthetic-migrations.mjs';
import {parsePickupCollectionContext} from '../../src/operations/pickup-custody-contract.ts';
import {custodyPhotoObjects} from '../support/custody-photo-objects.mjs';
import {objectDirectory,encryptor,decryptor} from '../support/object-recovery-drill.mjs';
import {createDropoffPhotoAccess,createDropoffPhotoDispatch} from '../../src/operations/dropoff-photo-workflow.ts';
import {validateImage} from '../../src/files/image-validation.ts';
import {captureObjectArchive,restoreObjectArchive} from '../../src/tooling/object-recovery.ts';
import {bookingFoundationEvidence} from '../support/booking-source-evidence.mjs';
import {collectAcceptedAmendmentSources} from '../support/accepted-amendment-source-fixture.mjs';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
import {collectPickupAndDropoffCustodyInputsInSnapshot} from '../../src/operations/dropoff-custody-source-collector.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';
import {reimportCustodySourceTables} from '../support/field-workspace-reimport.mjs';

const value=async(connection,sql,args=[])=>(await connection.query(sql,args)).rows[0]?.value;
const conflict=reason=>({state:'conflict',reason});
const body={acknowledgementText:'=Synthetic authorization "for transport" (\\N, café).',conditionPhotoRequired:false,reason:null};
const place=locationText=>({schemaVersion:1,kind:'manual',locationText,instructions:null});

async function collectWorkspace(client,business){
 const foundation=await bookingFoundationEvidence(client,business),signal=new AbortController().signal;
 const commercial=await collectAcceptedAmendmentSources(client,business);
 const field=(await collectFieldSourcesInSnapshot(client,business,signal)).forServer();
 const capture=await collectPickupAndDropoffCustodyInputsInSnapshot(client,business,foundation.history,signal);
 assert.throws(()=>JSON.stringify(capture),/CUSTODY_SOURCE_PRIVATE/);
 const crm={};
 for(const [group,routine] of [['customers','customer'],['addresses','address'],['vehicles','vehicle'],['associations','association']]){
  const context=await value(client,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[business]);
  const page=await value(client,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,NULL,20) value',[business,context.snapshotToken]);
  assert.equal(String(page[group].length),context.rowCount);
  crm[group]={businessId:business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows:page[group]};
 }
 const baseline={...foundation,commercial:{...commercial,historyEvidence:foundation.history},
  field:{...field,historyEvidence:foundation.history},crm};
 return {baseline,input:{...baseline,...capture.forServer()}};
}

async function sourcePhotoInventory(client){
 return (await client.query(`
  SELECT key,"byteSize",sha256,retention FROM (
   SELECT 'originals/'||a.business_id||'/'||a.dispatch_id key,o.byte_size "byteSize",o.sha256,'original' retention
   FROM crest.custody_photo_attempts a JOIN crest.custody_photo_originals o ON (a.business_id,a.id)=(o.business_id,o.photo_id)
   UNION ALL
   SELECT 'previews/'||a.business_id||'/'||a.dispatch_id,o.preview_byte_size,o.preview_sha256,'derivative'
   FROM crest.custody_photo_attempts a JOIN crest.custody_photo_originals o ON (a.business_id,a.id)=(o.business_id,o.photo_id)
  ) files ORDER BY key COLLATE "C"`)).rows;
}

test('pickup, return and the custody queue retain exact history through encrypted recovery', {timeout:180000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox,storage,workspace,destinationCluster,destination;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const databaseTarget=await sandbox.database(),client=await sandbox.connect(databaseTarget),web=await sandbox.connect(databaseTarget);
  await sandbox.apply(databaseTarget,await sandbox.prefix(0),true);
  await installProviderSchema(client,databaseTarget);
  const predecessor=await sandbox.apply(databaseTarget,await sandbox.prefix(68));
  assert.equal(predecessor.history.length,68);
  await assert.rejects(requireSyntheticPickupCustody(databaseTarget),{message:'SYNTHETIC_PICKUP_CUSTODY_MIGRATION_REQUIRED'});
  await web.query('SET ROLE crest_web');
  const bootstrap=await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
  const fixture=createConfirmedBookingFixture({client,web,bootstrap});
  const predecessorOwner=await fixture(),dropoffRequest=confirmedBookingRequest(predecessorOwner);
  dropoffRequest.payload.fulfillmentMode='dropoff';
  const bookBefore=(request,sequence)=>value(web,
   'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...predecessorOwner.auth(),predecessorOwner.epoch,request.operationId,request.jobId,sequence,request.payload]);
  assert.equal((await bookBefore(dropoffRequest,'0')).state,'committed');
  const beforeJob=(await client.query('SELECT j.mode_version_id,v.id FROM crest.jobs j JOIN crest.job_vehicles v ON (j.business_id,j.id)=(v.business_id,v.job_id) WHERE j.id=$1',
   [dropoffRequest.jobId])).rows[0];
  const priorPolicy=randomUUID(),priorCase=randomUUID();
  assert.equal((await value(web,'SELECT crest_commands.save_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...predecessorOwner.auth(),predecessorOwner.epoch,priorPolicy,beforeJob.mode_version_id,
    {acknowledgementText:null,conditionPhotoRequired:false}])).state,'committed');
  const previousHandoff=await value(web,'SELECT crest_commands.save_dropoff_handoff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,0,$13) value',
   [...predecessorOwner.auth(),predecessorOwner.epoch,randomUUID(),beforeJob.id,priorCase,
    {effectiveAt:'2026-11-03T09:45:00.123456Z',person:{schemaVersion:1,displayName:'Fictional prior owner'},
     location:place('Fictional prior shop'),notes:null,missingPhotoReason:'Synthetic pre-upgrade intake',
     authorizationConfigId:priorPolicy,acknowledgementConfirmed:null}]);
  assert.equal(previousHandoff.state,'committed');
  const historicalPickup=confirmedBookingRequest(await fixture(predecessorOwner));
  historicalPickup.payload.fulfillmentMode='pickup_return';
  historicalPickup.payload.vehicles[0].pickupLocation=place('Fictional prior pickup');
  historicalPickup.payload.vehicles[0].returnLocation=place('Fictional prior return');
  const appointment=historicalPickup.payload.appointment;
  for(const key of ['start_at','end_at','local_start','local_end'])appointment[key]=appointment[key].replace('2026-11-03','2026-11-05');
  assert.equal((await value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...predecessorOwner.auth(),predecessorOwner.epoch,randomUUID(),'1',
    {mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:true,reason:'Historical fictional enablement'}])).state,'committed');
  assert.equal((await bookBefore(historicalPickup,'2')).state,'committed');
  const readPrior=()=>value(web,'SELECT crest_commands.read_dropoff_job_custody($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...predecessorOwner.auth(),dropoffRequest.jobId,beforeJob.id]);
  const beforeCustody=await readPrior(),before=await inventory(client);

  const registered69=await sandbox.prefix(69),adopted=await sandbox.apply(databaseTarget,registered69);
  assert.equal(adopted.history.length,69);
  assert.deepEqual(adopted.history.slice(0,68),predecessor.history);
  assert.deepEqual((await sandbox.apply(databaseTarget,registered69)).history,adopted.history);
  await assert.rejects(requireSyntheticPickupReturnWorkflow(databaseTarget),{message:'SYNTHETIC_PICKUP_RETURN_WORKFLOW_MIGRATION_REQUIRED'});
  await requireSyntheticPickupCustody(databaseTarget);
  const oldTables=new Set(before.map(({schema,name})=>schema+'.'+name));
  const businessTables=rows=>rows.filter(({schema})=>schema==='crest'||schema==='crest_private');
  assert.equal(businessTables(before).length,87);
  assert.deepEqual(businessTables(await inventory(client)).filter(({schema,name})=>oldTables.has(schema+'.'+name)),businessTables(before));
  assert.deepEqual(await readPrior(),beforeCustody);
  assert.equal(await value(client,'SELECT dropoff_case_id value FROM crest_private.vehicle_custody_claims WHERE business_id=$1 AND vehicle_id=$2',
   [predecessorOwner.business,predecessorOwner.vehicle]),priorCase);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.pickup_job_policies WHERE job_id=$1',[historicalPickup.jobId]),0);
  await assert.rejects(web.query('SELECT * FROM crest_private.vehicle_custody_claims'),{code:'42501'});
  const owner=await fixture(),other=await fixture();
  const save=(operation,version,input,principal=owner)=>value(web,
   'SELECT crest_commands.save_pickup_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...principal.auth(),principal.epoch,operation,version,input]);
  const read=(principal=owner,before=null)=>value(web,
   'SELECT crest_commands.read_pickup_policy($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...principal.auth(),before]);
  const settings=await read();
  assert.deepEqual(settings,{schemaVersion:1,businessId:owner.business,currentSequence:'0',versions:[],hasMore:false});
  assert.deepEqual(await save(randomUUID(),'0',body),conflict('arrangements'));
  const mode=(version,enabled)=>value(web,
   'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...owner.auth(),owner.epoch,randomUUID(),version,{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:enabled,
    reason:version==='0'?null:'Explicit fictional enablement'}]);
  assert.equal((await mode('0',false)).state,'committed');
  assert.deepEqual(await mode('1',true),conflict('pickup_policy'));
  const bookingRequest=(principal,day)=>{
   const booking=confirmedBookingRequest(principal);
   booking.payload.fulfillmentMode='pickup_return';
   booking.payload.vehicles[0].pickupLocation=place('Synthetic pickup stop');
   booking.payload.vehicles[0].returnLocation=place('Synthetic return stop');
   if(day){
    const appointment=booking.payload.appointment;
    for(const key of ['start_at','end_at','local_start','local_end'])appointment[key]=appointment[key].replace('2026-11-03',day);
   }
   return booking;
  };
  const firstJob=bookingRequest(owner);
  const book=(job,sequence)=>value(web,
   'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,job.operationId,job.jobId,sequence,job.payload]);
  const firstId=randomUUID();
  await assert.rejects(save(firstId,'0',{...body,acknowledgementText:'  '}),{code:'22023'});
  const first=await save(firstId,'0',body);
  assert.equal(first.state,'committed');
  assert.equal(first.receipt.policy.id,firstId);
  assert.equal(first.receipt.policy.sequence,'1');
  assert.equal(first.receipt.policy.acknowledgementText,body.acknowledgementText);
  assert.deepEqual(await save(firstId,'0',body),first);
  assert.deepEqual(await save(firstId,'0',{...body,acknowledgementText:null}),conflict('operation'));
  assert.deepEqual(await book(firstJob,'1'),conflict('mode_disabled'));
  assert.equal((await mode('1',true)).state,'committed');
  assert.equal((await book(firstJob,'2')).state,'committed');
  assert.equal(await value(client,'SELECT policy_id value FROM crest_private.pickup_job_policies WHERE business_id=$1 AND job_id=$2',
   [owner.business,firstJob.jobId]),firstId);
  assert.deepEqual(await save(randomUUID(),'0',body),conflict('version'));
  assert.deepEqual(await save(randomUUID(),'1',{...body,reason:'Repeated details'}),conflict('unchanged'));
  await assert.rejects(save(randomUUID(),'1',{...body,conditionPhotoRequired:true}),{code:'22023'});
  const secondId=randomUUID(),revision={acknowledgementText:null,conditionPhotoRequired:true,reason:'Preserve verified condition photos'};
  const second=await save(secondId,'1',revision);
  assert.equal(second.state,'committed');
  const nextJob=bookingRequest(await fixture(owner),'2026-11-05');
  assert.equal((await book(nextJob,'2')).state,'committed');
  assert.equal(await value(client,'SELECT policy_id value FROM crest_private.pickup_job_policies WHERE business_id=$1 AND job_id=$2',
   [owner.business,nextJob.jobId]),secondId);
  assert.equal(await value(client,'SELECT policy_id value FROM crest_private.pickup_job_policies WHERE business_id=$1 AND job_id=$2',
   [owner.business,firstJob.jobId]),firstId);
  assert.equal(await value(client,'SELECT max(sequence)::text value FROM crest.fulfillment_mode_versions WHERE business_id=$1',[owner.business]),'2');
  assert.deepEqual((await read()).versions,[second.receipt.policy,first.receipt.policy]);
  assert.deepEqual((await read(owner,'2')).versions,[first.receipt.policy]);
  assert.deepEqual((await read(other)).versions,[]);
  const original={schemaVersion:1,businessId:owner.business,commandType:'operations.pickup_custody.policy.save',
   reference:{operationId:firstId,recoveryEpoch:owner.epoch,expectedSequence:'0'}};
  const lookup=ref=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),ref]);
  assert.equal((await lookup(original)).result.receipt.sourceRecordId,firstId);
  await assert.rejects(lookup({...original,reference:{...original.reference,expectedSequence:'1'}}),{code:'23514'});
  const retiredPolicy={...original,reference:{...original.reference,operationId:randomUUID(),expectedSequence:'2'}};
  const retirePolicy=()=>value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),owner.epoch,retiredPolicy,'Fictional policy save requires review']);
  const retired=await retirePolicy();
  assert.equal(retired.state,'retired');
  assert.deepEqual(await retirePolicy(),retired);
  assert.deepEqual(await save(retiredPolicy.reference.operationId,'2',{...body,reason:'Fictional policy correction'}),conflict('operation'));
  assert.deepEqual(await lookup(retiredPolicy),{state:'absent'});
  assert.equal((await read()).currentSequence,'2');
  await assert.rejects(web.query('SELECT * FROM crest_private.pickup_job_policies'),{code:'42501'});
  await assert.rejects(web.query('SELECT * FROM crest_private.pickup_custody_policies'),{code:'42501'});
  await assert.rejects(client.query('UPDATE crest_private.pickup_job_policies SET policy_id=$1 WHERE job_id=$2',[secondId,firstJob.jobId]),{code:'55000'});
  const rig=randomUUID();
  assert.equal((await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',
   [...owner.auth(),owner.epoch,randomUUID(),rig,{label:'Synthetic transport rig',year:null,make:null,model:null,color:null,vin:null,
    plate:null,kind:'business_rig',notes:null,archived:false,archiveReason:null}])).state,'committed');
  const target=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[nextJob.jobId]);
  const firstTarget=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[firstJob.jobId]);
  const leg=randomUUID(),collection=randomUUID(),photo=randomUUID();
  const trip=(version,input)=>value(web,'SELECT crest_commands.record_pickup_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...owner.auth(),owner.epoch,randomUUID(),nextJob.jobId,'1',leg,version,input]);
  assert.equal((await trip(null,{action:'depart',reason:null,trip:{jobVehicleIds:[target],drivenVehicleId:rig,
   origin:place('Synthetic shop'),etaAt:null,notes:null}})).state,'committed');
  const arrived=await trip(leg,{action:'arrive',reason:null,trip:null});
  assert.equal(arrived.state,'committed');
  const image=await sharp({create:{width:64,height:32,channels:3,background:'#654a28'}})
   .withExif({IFD0:{Copyright:'Fictional generated image'}}).png().toBuffer();
  const dropoffImage=await sharp({create:{width:32,height:24,channels:3,background:'#243a4e'}}).png().toBuffer();
  const arrival=arrived.receipt.leg.id,worker=await sandbox.connect(databaseTarget);
  await worker.query('SET ROLE crest_custody_photo_dispatch');
  const reserve=(options={})=>value(web,'SELECT crest_commands.reserve_pickup_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) value',
   [...(options.owner??owner).auth(),(options.owner??owner).epoch,options.photo??photo,options.target??target,options.collection??collection,
    options.arrival??arrival,options.policy??secondId,options.version??'1','image/png',image.length]);
  await assert.rejects(reserve({target:firstTarget}),{code:'23514'});
  await assert.rejects(reserve({arrival:leg}),{code:'23514'});
  await assert.rejects(reserve({policy:firstId}),{code:'23514'});
  await assert.rejects(reserve({version:'2'}),{code:'23514'});
  await assert.rejects(reserve({owner:other}),{code:'23514'});
  const reserved=await reserve();
  assert.equal(reserved.case_id,collection);
  assert.deepEqual(await reserve(),reserved);
  await assert.rejects(reserve({collection:randomUUID()}),{code:'23514'});
  const pendingPhoto=randomUUID();
  assert.equal((await reserve({photo:pendingPhoto})).id,pendingPhoto);
  // The PostgreSQL JSON projection drops trailing fractional zeroes; the
  // receipt and portable row must still preserve all six digits.
  const at=new Date(Date.parse(arrived.receipt.leg.arrived_at)+1).toISOString().replace('Z','000Z');
  const noPhoto={effectiveAt:at,person:{schemaVersion:1,displayName:'Synthetic collector'},
   location:place('Synthetic pickup stop'),notes:null,missingPhotoReason:null,acknowledgementConfirmed:null};
  const handoff={...noPhoto,conditionPhotoId:photo};
  const collect=(operation=collection,input=handoff)=>value(web,
   'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
   [...owner.auth(),owner.epoch,operation,nextJob.jobId,'1',target,arrival,secondId,input]);
  assert.deepEqual(await collect(collection,{...noPhoto,missingPhotoReason:'Synthetic missing image'}),conflict('photo'));
  assert.deepEqual(await collect(),conflict('photo'));
  const publish=(connection,photoId,metadata,epoch=owner.epoch)=>value(connection,
   'SELECT crest_commands.publish_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),epoch,photoId,metadata]);
  const readPhoto=(principal=owner,photoId=photo)=>value(web,
   'SELECT crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[...principal.auth(),photoId]);
  const authority={
   read:(_credential,scope)=>readPhoto(owner,scope.photoId),
   writable:(_credential,scope,epoch)=>value(web,
    'SELECT crest_commands.check_dropoff_photo_upload($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
    [...owner.auth(),epoch,scope.photoId]),
   publish:(_credential,scope,epoch,metadata)=>publish(worker,scope.photoId,metadata,epoch)
  };
  storage=await custodyPhotoObjects();
  const photoAccess=createDropoffPhotoAccess(authority,storage.store);
  const dispatch=createDropoffPhotoDispatch(authority,storage.store,{validate:validateImage});
  const upload=async(jobVehicleId,photoId,bytes)=>{
   const credential='fictional-port-credential',subject={businessId:owner.business,jobVehicleId,photoId};
   const signal=AbortSignal.timeout(30000);
   const capability=(await photoAccess.upload(credential,subject,signal)).forUpload();
   const response=await fetch(capability.url,{method:capability.method,headers:capability.headers,body:bytes,signal});
   assert.equal(response.status,200);
   const original=await dispatch(credential,subject,signal);
   assert.equal(original.photo_id,photoId);
   assert.equal(original.sha256,hash(bytes));
   return original;
  };
  const {business_id,photo_id,verified_at,...metadata}=await upload(target,photo,image);
  assert.equal(business_id,owner.business);
  assert.equal(photo_id,photo);
  assert(verified_at);
  await assert.rejects(publish(web,photo,metadata),{code:'42501'});
  assert.equal((await readPhoto()).linked,false);
  assert.equal(await readPhoto(other),null);
  assert.deepEqual(await collect(randomUUID()),conflict('photo'));
  const access=()=>value(web,
   'SELECT crest_commands.record_dropoff_original_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,target,photo,metadata.sha256,metadata.byte_size]);
  await assert.rejects(access(),{code:'42501'});
  const saved=await collect();
  assert.equal(saved.state,'committed');
  assert.equal(saved.receipt.collection.condition_photo_id,photo);
  assert.deepEqual(await collect(),saved);
  assert.equal((await readPhoto()).linked,true);
  assert.equal((await access()).scope.handoffEventId,collection);
  await assert.rejects(reserve({photo:randomUUID(),collection:randomUUID()}),{code:'23514'});
  await assert.rejects(publish(worker,pendingPhoto,metadata),{code:'23514',message:'CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'});
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.pickup_photo_slots'),2);

  const dropoff=bookingRequest(await fixture(owner),'2026-11-06');
  dropoff.payload.fulfillmentMode='dropoff';
  dropoff.payload.vehicles[0].pickupLocation=null;
  dropoff.payload.vehicles[0].returnLocation=null;
  assert.equal((await book(dropoff,'2')).state,'committed');
  const dropoffTarget=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[dropoff.jobId]);
  const dropoffMode=await value(client,'SELECT mode_version_id value FROM crest.jobs WHERE id=$1',[dropoff.jobId]);
  const dropoffPolicy=randomUUID(),dropoffCase=randomUUID(),dropoffPhoto=randomUUID();
  assert.equal((await value(web,'SELECT crest_commands.save_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...owner.auth(),owner.epoch,dropoffPolicy,dropoffMode,{acknowledgementText:null,conditionPhotoRequired:true}])).state,'committed');
  const reserveLegacy=jobVehicleId=>value(web,
   'SELECT crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14) value',
   [...owner.auth(),owner.epoch,dropoffPhoto,jobVehicleId,dropoffCase,'image/png',dropoffImage.length]);
  await assert.rejects(reserveLegacy(firstTarget),{code:'23514'});
  const dropoffReservation=await reserveLegacy(dropoffTarget);
  assert.equal(dropoffReservation.id,dropoffPhoto);
  const dropoffOriginal=await upload(dropoffTarget,dropoffPhoto,dropoffImage);
  const received=await value(web,'SELECT crest_commands.save_dropoff_handoff($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,0,$13) value',
   [...owner.auth(),owner.epoch,randomUUID(),dropoffTarget,dropoffCase,{...noPhoto,authorizationConfigId:dropoffPolicy,conditionPhotoId:dropoffPhoto}]);
  assert.equal(received.state,'committed');
  assert.equal((await value(web,'SELECT crest_commands.record_dropoff_original_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,dropoffTarget,dropoffPhoto,dropoffOriginal.sha256,dropoffOriginal.byte_size])).scope.handoffEventId,received.receipt.eventId);
  const modesOfEvidence=await value(client,
   "SELECT jsonb_object_agg(entity_id,delta->'after' ? 'pickup') value FROM crest_private.audit_events WHERE entity_kind='custody_photos' AND entity_version=1");
  assert.deepEqual(modesOfEvidence,{[photo]:true,[pendingPhoto]:true,[dropoffPhoto]:false});

  const source='SELECT crest_commands.pickup_custody_source_context($1) value';
  await assert.rejects(value(web,source,[owner.business]),{code:'42501'});
  await assert.rejects(value(client,source,[owner.business]),{code:'25001'});
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   await client.query('SET LOCAL ROLE crest_booking_integrity_owner');
   const snapshot=await value(client,source,[owner.business]);
   assert.equal(snapshot.profile,'crest.pickup-custody-source.v1');
   assert.deepEqual(snapshot.expectedCounts,{pickup_custody_policies:'2',pickup_job_policies:'2',pickup_custody_collections:'1',
    pickup_photo_slots:'2',vehicle_custody_claims:'2'});
   const page=(group,after=null,limit=20,token=snapshot.snapshotToken,business=owner.business)=>value(client,
    'SELECT crest_commands.pickup_custody_source_page($1,$2,$3,$4,$5) value',[business,token,group,after,limit]);
   const firstPage=await page('pickup_custody_policies',null,1);
   assert.equal(firstPage.hasMore,true);
   const revisionAfterSnapshot=await save(randomUUID(),'2',{acknowledgementText:null,conditionPhotoRequired:false,reason:'Synthetic later revision'});
   assert.equal(revisionAfterSnapshot.state,'committed');
   const lastPage=await page('pickup_custody_policies',firstPage.rows[0].id,1);
   assert.equal(lastPage.hasMore,false);
   assert.deepEqual([firstPage.rows[0].sequence,lastPage.rows[0].sequence].sort(),['1','2']);
   assert.deepEqual((await page('pickup_job_policies')).rows.find(row=>row.job_id===nextJob.jobId),
    {business_id:owner.business,job_id:nextJob.jobId,policy_id:secondId});
   const collected=(await page('pickup_custody_collections')).rows[0];
   assert.equal(collected.condition_photo_id,photo);
   assert.equal(collected.effective_at,at);
   assert.deepEqual(JSON.parse(collected.person_snapshot),handoff.person);
   assert.deepEqual((await page('pickup_photo_slots')).rows.map(row=>[row.photo_id,row.arrival_version_id]).sort(),
    [[photo,arrival],[pendingPhoto,arrival]].sort());
   assert.equal((await page('vehicle_custody_claims')).rows.find(row=>row.pickup_collection_id)?.pickup_collection_id,collection);
   for(const input of [['pickup_photo_slots',null,20,'a'.repeat(64)],['unknown'],['pickup_photo_slots',null,20,snapshot.snapshotToken,other.business]]){
    await client.query('SAVEPOINT invalid_pickup_page');
    await assert.rejects(page(...input),{code:'22023'});
    await client.query('ROLLBACK TO SAVEPOINT invalid_pickup_page');
    await client.query('RELEASE SAVEPOINT invalid_pickup_page');
   }
  }finally{await client.query('ROLLBACK');}
  assert.equal((await read()).currentSequence,'3');

  let sourceBundle,sourceFiles;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {baseline,input}=await collectWorkspace(client,owner.business);
   assert.throws(()=>formatFieldWorkspaceSources(baseline),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   const bundle=formatFieldWorkspaceSources(input),files=new Map(bundle.parts.map(part=>[part.name,part.content]));
   sourceBundle=bundle;
   sourceFiles=files;
   const portable=JSON.parse(files.get('pickup_custody_source.json'));
   assert.equal(portable.rows.pickup_custody_collections[0].condition_photo_id,photo);
   assert.equal(portable.rows.pickup_job_policies.length,2);
   assert.equal(portable.rows.vehicle_custody_claims.length,2);
   assert.equal(portable.historyEvidence.records.length,8);
   const handoffAudit=portable.historyEvidence.records.map(entry=>JSON.parse(entry.canonicalEvidence).row)
    .find(row=>row.entity_kind==='pickup_custody_collections');
   assert.match(handoffAudit.effective_at,/(\.\d{1,3})?\+00:00$/);
   assert.equal(JSON.parse(handoffAudit.payload).effectiveAt,at);
   assert(files.get('pickup_custody_collections.csv').includes('Synthetic collector'));
   assert(files.get('pickup_photo_slots.csv').includes(pendingPhoto));
   const shared=JSON.parse(files.get('custody_source.json'));
   assert.deepEqual(shared.rows.custody_photo_originals.map(row=>row.photo_id).sort(),[photo,dropoffPhoto].sort());
   assert(shared.rows.custody_photo_attempts.some(row=>row.id===pendingPhoto));
   assert.equal(JSON.parse(bundle.manifest).includedPickupCustodyReferencesVerified,true);
   assert.equal(JSON.parse(bundle.manifest).completeBackup,false);
   const wrong=structuredClone(input);
   wrong.pickupCustody.rows.pickup_photo_slots.find(row=>row.photo_id===photo).arrival_version_id=randomUUID();
   assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   const omitted=structuredClone(input);
   omitted.pickupCustody.rows.pickup_job_policies=omitted.pickupCustody.rows.pickup_job_policies.filter(row=>row.job_id!==nextJob.jobId);
   omitted.pickupCustody.context.expectedCounts.pickup_job_policies='1';
   assert.throws(()=>formatFieldWorkspaceSources(omitted),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   const swapped=structuredClone(input);
   swapped.custody.rows.custody_photo_attempts.find(row=>row.id===photo).case_id=dropoffCase;
   assert.throws(()=>formatFieldWorkspaceSources(swapped),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
  }finally{await client.query('ROLLBACK');}
  workspace=await privateWorkspace();
  const point=join(workspace,'pickup');await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace),vault=await objectDirectory(join(workspace,'vault'));
  const recovered=await objectDirectory(join(workspace,'recovered'));
  const readSource=(object,signal)=>storage.store.readVerifiedCandidate({
   key:object.key,byteSize:object.byteSize,sha256:object.sha256,
   contentType:object.retention==='original'?'image/png':'image/jpeg'
  },signal);
  await assert.rejects(backupLegacy68Database(client,databaseTarget,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
  const capturePhotos={
   inventory:sourcePhotoInventory,
   capture:objects=>{
    const byKey=new Map(objects.map(object=>[object.key,object]));
    return captureObjectArchive(randomUUID(),objects,{
     readSource:(key,byteSize,signal)=>{
      const object=byKey.get(key);
      assert.equal(object?.byteSize,byteSize);
      return readSource(object,signal);
     },
     seal:encryptor(keys.recipient),putVault:vault.put,readVault:vault.read
    });
   }
  };
  const {manifest}=await backupLegacy69Database(client,databaseTarget,point,keys.recipient,undefined,capturePhotos);
  assert.equal(manifest.objectArchive.inventory.length,4);
  assert.equal(manifest.objectArchive.inventory.filter(object=>object.retention==='original').length,2);
  destinationCluster=await recoveryCluster();
  const destinationUrl=await destinationCluster.database();
  await assert.rejects(restoreLegacy68Database(point,keys.path,destinationUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  const restored=await restoreLegacy69Database(point,keys.path,destinationUrl,archive=>
   restoreObjectArchive(archive.receipt,archive.inventory,{
    readVault:vault.read,unseal:decryptor(keys.path),putDestination:recovered.put,readDestination:recovered.read
   }));
  assert.deepEqual(restored,manifest);
  destination=await connect(destinationUrl);
  assert.deepEqual(await sourcePhotoInventory(destination),manifest.objectArchive.inventory);
  const originals=new Map([
   ['originals/'+owner.business+'/'+reserved.dispatch_id,image],
   ['originals/'+owner.business+'/'+dropoffReservation.dispatch_id,dropoffImage]
  ]);
  for(const object of manifest.objectArchive.inventory){
   const signal=AbortSignal.timeout(10000),bytes=await recovered.read(object.key,object.byteSize,signal);
   assert.equal(hash(bytes),object.sha256);
   assert.deepEqual(bytes,object.retention==='original'?originals.get(object.key):await readSource(object,signal));
  }
  assert.deepEqual(await value(destination,'SELECT crest_private.pickup_collection_original($1,$2,$3) - \'request\' value',
   [owner.business,owner.actor,collection]),saved);
  assert.deepEqual(await value(destination,'SELECT crest_private.pickup_policy_original($1,$2,$3) - \'request\' value',
   [owner.business,owner.actor,firstId]),first);
  await destination.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {input}=await collectWorkspace(destination,owner.business);
   const restoredFiles=new Map(formatFieldWorkspaceSources(input).parts.map(part=>[part.name,part.content]));
   for(const name of sourceFiles.keys()){
    if(name.endsWith('.csv'))assert.equal(restoredFiles.get(name),sourceFiles.get(name),name);
   }
   for(const name of ['pickup_custody_source.json','custody_source.json']){
    const original=JSON.parse(sourceFiles.get(name)),afterRestore=JSON.parse(restoredFiles.get(name));
    assert.deepEqual(afterRestore.rows,original.rows);
    assert.equal(afterRestore.historyEvidence.schemaVersion,original.historyEvidence.schemaVersion);
    assert.deepEqual(afterRestore.historyEvidence.records,original.historyEvidence.records);
   }
  }finally{await destination.query('ROLLBACK');}
  const neutral=await connect(await destinationCluster.database());
  try{
   await reimportCustodySourceTables(neutral,sourceBundle);
   const linked=(await neutral.query(`
    SELECT c.id collection,p.policy_id policy,s.arrival_version_id arrival,o.sha256,o.preview_sha256
    FROM public.restored_pickup_custody_collections c
    JOIN public.restored_pickup_job_policies p ON (p.business_id,p.job_id,p.policy_id)=(c.business_id,c.job_id,c.policy_id)
    JOIN public.restored_vehicle_custody_claims v ON (v.business_id,v.vehicle_id,v.pickup_collection_id)=(c.business_id,c.vehicle_id,c.id)
    JOIN public.restored_pickup_photo_slots s ON (s.business_id,s.job_id,s.job_vehicle_id,s.collection_id,s.arrival_version_id,s.policy_id,s.photo_id)
     =(c.business_id,c.job_id,c.job_vehicle_id,c.id,c.pickup_leg_version_id,c.policy_id,c.condition_photo_id)
    JOIN public.restored_custody_photo_attempts a ON (a.business_id,a.id,a.case_id)=(s.business_id,s.photo_id,c.id)
    JOIN public.restored_custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)`)).rows;
   assert.deepEqual(linked,[{collection,policy:secondId,arrival,sha256:metadata.sha256,preview_sha256:metadata.preview_sha256}]);

  }finally{await neutral.end();}

  const olderSlots=(await destination.query('SELECT to_jsonb(s) value FROM crest_private.pickup_photo_slots s ORDER BY photo_id')).rows;
  await destination.query('BEGIN');
  try{
   await destination.query(await readFile(new URL('../../supabase/migrations/20261124180000_pickup_return_workflow.sql',import.meta.url),'utf8'));
   await destination.query('COMMIT');
  }catch(error){await destination.query('ROLLBACK');throw error;}
  const afterUpgrade=await inventory(destination),tableName=row=>row.schema+'.'+row.name;
  const beforeTables=new Set(manifest.rows.map(tableName));
  const existing=rows=>rows.filter(row=>beforeTables.has(tableName(row))&&tableName(row)!=='crest_private.pickup_photo_slots');
  assert.deepEqual(existing(afterUpgrade),existing(manifest.rows));
  assert.deepEqual(afterUpgrade.filter(row=>!beforeTables.has(tableName(row))).map(tableName),
   ['crest_private.pickup_custody_releases','crest_private.pickup_return_failures']);
  assert.deepEqual((await destination.query("SELECT to_jsonb(s)-'return_collection_id' value FROM crest_private.pickup_photo_slots s ORDER BY photo_id")).rows,olderSlots);
  assert.deepEqual(await sourcePhotoInventory(destination),manifest.objectArchive.inventory);
  await assert.rejects(requireSyntheticPickupReturnWorkflow(destinationUrl),{message:'SYNTHETIC_PICKUP_RETURN_WORKFLOW_MIGRATION_REQUIRED'});

  await client.query('BEGIN');
  try{
   await client.query(await readFile(new URL('../../planning/proposals/pickup-worksite-transport.sql',import.meta.url),'utf8'));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  await client.query('BEGIN');
  try{
   await client.query(await readFile(new URL('../../planning/proposals/pickup-work-session.sql',import.meta.url),'utf8'));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const field=(operation,version,action,principal=owner,jobId=nextJob.jobId)=>value(web,
   'SELECT crest_commands.change_field_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...principal.auth(),principal.epoch,operation,jobId,version,{action,reason:action==='pause'?'Fictional pause':null}]);
  assert.deepEqual(await field(randomUUID(),'1','start_pickup'),conflict('custody'));
  assert.deepEqual(await field(randomUUID(),'1','start_dropoff'),conflict('state'));
  assert.deepEqual(await field(randomUUID(),'1','start_pickup',other),conflict('job'));
  const transportBody=jobVehicleIds=>({action:'depart',reason:null,
   trip:{jobVehicleIds,drivenVehicleId:rig,origin:place('Synthetic collected stop'),etaAt:null,notes:null,purpose:'to_work_site'}});
  const transport=(operation,legId,legVersion,input,scope={})=>value(web,
   'SELECT crest_commands.record_pickup_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...(scope.principal??owner).auth(),(scope.principal??owner).epoch,operation,scope.job??nextJob.jobId,
    scope.version??'1',legId,legVersion,input]);
  const worksiteTrips=(job=nextJob.jobId)=>value(web,
   'SELECT crest_commands.read_pickup_trips($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',[...owner.auth(),job,null,null]);
  assert.deepEqual((await worksiteTrips(firstJob.jobId)).worksiteVehicleIds,[]);
  assert.deepEqual((await worksiteTrips()).worksiteVehicleIds,[target]);
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,transportBody([firstTarget]),{job:firstJob.jobId}),conflict('custody'));
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,transportBody([target,firstTarget])),conflict('custody'));
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,transportBody([target]),{version:'2'}),conflict('job_version'));
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,transportBody([target]),{principal:other}),conflict('job'));
  const returnBody=targets=>{const body=transportBody(targets);body.trip.purpose='return_to_customer';return body;};
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,returnBody([target])),conflict('state'));
  const departedWorksiteId=randomUUID(),stoppedLeg=randomUUID(),departure=transportBody([target]);
  const started=await transport(departedWorksiteId,stoppedLeg,null,departure);
  assert.equal(started.state,'committed');
  assert.equal(started.receipt.leg.purpose,'to_work_site');
  assert.deepEqual(started.receipt.leg.destination_snapshot,nextJob.payload.workLocation);
  assert.deepEqual(await transport(departedWorksiteId,stoppedLeg,null,departure),started);
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,departure),conflict('occupancy'));
  const stop=await transport(randomUUID(),stoppedLeg,stoppedLeg,
   {action:'cancel',reason:'Synthetic road closure',trip:{actualStop:place('Synthetic safe stop')}});
  assert.equal(stop.state,'committed');
  assert.equal(stop.receipt.leg.state,'cancelled');
  assert.deepEqual((await worksiteTrips()).worksiteVehicleIds,[target]);
  const resumedLeg=randomUUID();
  assert.equal((await transport(randomUUID(),resumedLeg,null,{...departure,trip:{...departure.trip,origin:place('Synthetic safe stop')}})).state,'committed');
  const arrivalOperation=randomUUID();
  const delivered=await transport(arrivalOperation,resumedLeg,resumedLeg,{action:'arrive',reason:null,trip:null});
  assert.equal(delivered.state,'committed');
  assert.equal(delivered.receipt.leg.state,'closed');
  assert.equal(delivered.receipt.leg.purpose,'to_work_site');
  assert.deepEqual(await value(web,'SELECT crest_commands.lookup_pickup_trip_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),arrivalOperation]),delivered);
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,departure),conflict('already_at_work_site'));
  const updatedTrips=await worksiteTrips();
  assert.equal(updatedTrips.activeLegId,null);
  assert.deepEqual(updatedTrips.worksiteVehicleIds,[]);
  assert.equal(updatedTrips.worksiteReady,true);
  assert.equal(updatedTrips.trips.filter(trip=>trip.leg.purpose==='to_work_site').length,2);
  assert.equal(await value(client,'SELECT state value FROM crest.jobs WHERE id=$1',[nextJob.jobId]),'scheduled');
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest.work_intervals WHERE job_id=$1',[nextJob.jobId]),0);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[collection]),1);
  const startId=randomUUID();
  const startedWork=await field(startId,'1','start_pickup');
  assert.equal(startedWork.state,'committed');
  assert.equal(startedWork.receipt.state,'in_progress');
  assert.equal(startedWork.receipt.auditIds.length,3);
  assert.deepEqual(await field(startId,'1','start_pickup'),startedWork);
  const startReference={schemaVersion:1,businessId:owner.business,commandType:'operations.job.field',
   reference:{operationId:startId,recoveryEpoch:owner.epoch,jobId:nextJob.jobId,expectedJobVersion:'1',action:'start_pickup'}};
  const lookupStart=()=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),startReference]);
  assert.equal((await lookupStart()).result.receipt.sourceVersion,'2');
  assert.equal((await field(randomUUID(),'2','pause')).receipt.state,'paused');
  assert.equal((await field(randomUUID(),'3','resume')).receipt.state,'in_progress');
  const readCompletion=()=>value(web,'SELECT crest_commands.read_job_completion_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),nextJob.jobId]);
  const completion=await readCompletion();
  assert.equal(completion.jobState,'in_progress');
  const cancellation=await value(web,'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),nextJob.jobId]);
  assert.equal(cancellation.jobState,'in_progress');
  const completionBody={scope:completion.assignments.map(row=>({
   assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,pieces:[{
    partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,grossInclusiveCents:row.grossInclusiveCents,
    discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null
   }]
  })),reason:null,walkthrough:{state:'done',reason:null},review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,
   expectedDuplicateRequestIds:completion.duplicateRequestIds,expectedCustomerVersion:completion.customerVersion,contactReviewReason:null}};
  const endId=randomUUID();
  const complete=()=>value(web,'SELECT crest_commands.complete_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,4,$12) value',
   [...owner.auth(),owner.epoch,endId,nextJob.jobId,completionBody]);
  const ended=await complete();
  assert.equal(ended.state,'committed');
  assert.equal(ended.receipt.completionOutcome,'full');
  assert(ended.receipt.reviewRequestId&&ended.receipt.finalizationTaskIds.length>0);
  assert.deepEqual(await complete(),ended);
  assert.equal((await readCompletion()).jobState,'completed');
  assert.equal((await lookupStart()).result.receipt.sourceVersion,'2');
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest.current_work_intervals WHERE job_id=$1 AND ended_at IS NULL',[nextJob.jobId]),0);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[collection]),1);
  assert.equal((await value(web,'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...owner.auth(),nextJob.jobId,target])).state,'awaiting_return');
  const returnScope={version:ended.receipt.jobVersion};
  assert.deepEqual((await worksiteTrips()).returnVehicleIds,[target]);
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,returnBody([target,firstTarget]),returnScope),conflict('custody'));
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,returnBody([target]),{...returnScope,principal:other}),conflict('job'));
  const returnLeg=randomUUID(),returnOperation=randomUUID();
  const returnedTrip=await transport(returnOperation,returnLeg,null,returnBody([target]),returnScope);
  assert.equal(returnedTrip.state,'committed');
  assert.equal(returnedTrip.receipt.leg.purpose,'return_to_customer');
  assert.deepEqual(returnedTrip.receipt.leg.destination_snapshot,nextJob.payload.vehicles[0].returnLocation);
  assert.deepEqual(await transport(returnOperation,returnLeg,null,returnBody([target]),returnScope),returnedTrip);
  const returnArrivalId=randomUUID();
  const returnArrival=await transport(returnArrivalId,returnLeg,returnLeg,{action:'arrive',reason:null,trip:null},returnScope);
  assert.equal(returnArrival.receipt.leg.state,'closed');
  assert.deepEqual(await transport(returnArrivalId,returnLeg,returnLeg,{action:'arrive',reason:null,trip:null},returnScope),returnArrival);
  assert.deepEqual((await worksiteTrips()).returnVehicleIds,[]);
  assert.deepEqual(await transport(randomUUID(),randomUUID(),null,returnBody([target]),returnScope),conflict('already_at_return'));
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[collection]),1);
  const firstScope={job:firstJob.jobId},pickupLeg=randomUUID();
  const firstDeparture=transportBody([firstTarget]);
  delete firstDeparture.trip.purpose;
  assert.equal((await transport(randomUUID(),pickupLeg,null,firstDeparture,firstScope)).state,'committed');
  const firstArrival=await transport(randomUUID(),pickupLeg,pickupLeg,{action:'arrive',reason:null,trip:null},firstScope);
  assert.equal(firstArrival.state,'committed');
  const cancelledCollection=randomUUID();
  const firstCollection=await value(web,'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
   [...owner.auth(),owner.epoch,cancelledCollection,firstJob.jobId,'1',firstTarget,firstArrival.receipt.leg.id,firstId,
    {effectiveAt:firstArrival.receipt.leg.arrived_at,person:{schemaVersion:1,displayName:'Fictional handoff'},
     location:place('Synthetic pickup stop'),notes:null,missingPhotoReason:'Fictional optional photo',acknowledgementConfirmed:true}]);
  assert.equal(firstCollection.state,'committed');
  const firstTransport=randomUUID();
  assert.equal((await transport(randomUUID(),firstTransport,null,transportBody([firstTarget]),firstScope)).state,'committed');
  assert.equal((await transport(randomUUID(),firstTransport,firstTransport,{action:'arrive',reason:null,trip:null},firstScope)).state,'committed');
  assert.equal((await field(randomUUID(),'1','start_pickup',owner,firstJob.jobId)).state,'committed');
  assert.equal((await field(randomUUID(),'2','pause',owner,firstJob.jobId)).state,'committed');
  const cancellationContext=await value(web,'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),firstJob.jobId]);
  assert.equal(cancellationContext.jobState,'paused');
  const cancelId=randomUUID(),cancelBody={reason:'Fictional cancellation before assigned work',noFulfilledScopeConfirmed:true,
   expectedWorkIntervalId:cancellationContext.workIntervalId,expectedOpenTravelLegVersionIds:cancellationContext.openTravelLegVersionIds,
   scope:cancellationContext.scope,customerCommunication:{state:'not_sent',channel:null,effectiveAt:null,evidenceNote:null}};
  const cancel=()=>value(web,'SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,cancelId,firstJob.jobId,cancellationContext.jobVersion,cancelBody]);
  const cancelled=await cancel();
  assert.equal(cancelled.state,'committed');
  assert.deepEqual(await cancel(),cancelled);
  assert.equal(await value(client,'SELECT state value FROM crest.jobs WHERE id=$1',[firstJob.jobId]),'cancelled');
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest.current_work_intervals WHERE job_id=$1 AND ended_at IS NULL',[firstJob.jobId]),0);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[cancelledCollection]),1);
  assert.equal((await value(web,'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...owner.auth(),firstJob.jobId,firstTarget])).state,'return_required');
  const cancelledScope={...firstScope,version:cancelled.receipt.jobVersion},cancelledReturn=randomUUID();
  assert.deepEqual((await worksiteTrips(firstJob.jobId)).returnVehicleIds,[firstTarget]);
  assert.equal((await transport(randomUUID(),cancelledReturn,null,returnBody([firstTarget]),cancelledScope)).state,'committed');
  const stoppedReturn=await transport(randomUUID(),cancelledReturn,cancelledReturn,
   {action:'cancel',reason:'Fictional recipient unavailable',trip:{actualStop:place('Synthetic safe stop')}},cancelledScope);
  assert.equal(stoppedReturn.receipt.leg.state,'cancelled');
  assert.deepEqual((await worksiteTrips(firstJob.jobId)).returnVehicleIds,[firstTarget]);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[cancelledCollection]),1);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {input}=await collectWorkspace(client,owner.business);
   const bundle=formatFieldWorkspaceSources(input);
   const travel=bundle.parts.find(part=>part.name==='travel_legs.csv').content;
   for(const id of [resumedLeg,returnLeg,cancelledReturn])assert(travel.includes(id));
  }finally{await client.query('ROLLBACK');}

  await client.query('BEGIN');
  try{
   await client.query(await readFile(new URL('../../planning/proposals/pickup-custody-release.sql',import.meta.url),'utf8'));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  await client.query('BEGIN');
  try{
   await client.query(await readFile(new URL('../../planning/proposals/pickup-return-source.sql',import.meta.url),'utf8'));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const releaseBody=effectiveAt=>({effectiveAt,person:{schemaVersion:1,displayName:'Fictional recipient'},
   location:place('Synthetic return stop'),notes:'=Fictional handoff café \\N',missingPhotoReason:'Optional photo declined',acknowledgementConfirmed:true});
  const release=(operation,arrival,body,options={})=>value(options.connection??web,
   'SELECT crest_commands.release_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...(options.principal??owner).auth(),(options.principal??owner).epoch,operation,
    options.job??firstJob.jobId,options.version??cancelledScope.version,options.collection??cancelledCollection,arrival,body]);
  const held=()=>value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[cancelledCollection]);
  assert.deepEqual(await release(randomUUID(),stoppedReturn.receipt.leg.id,releaseBody(stoppedReturn.receipt.leg.arrived_at)),conflict('arrival'));
  assert.equal(await held(),1);
  const replacementReturn=randomUUID(),recordArrival={action:'arrive',reason:null,trip:null};
  assert.equal((await transport(randomUUID(),replacementReturn,null,returnBody([firstTarget]),cancelledScope)).state,'committed');
  const arrivedReturn=await transport(randomUUID(),replacementReturn,replacementReturn,recordArrival,cancelledScope);
  assert.equal(arrivedReturn.receipt.leg.state,'closed');
  assert.equal(await held(),1);
  const releaseId=randomUUID(),handoffBody=releaseBody(arrivedReturn.receipt.leg.arrived_at),arrivalVersion=arrivedReturn.receipt.leg.id;
  const readScope={businessId:owner.business,jobId:firstJob.jobId,jobVehicleId:firstTarget};
  const readCollection=principal=>value(web,'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...principal.auth(),firstJob.jobId,firstTarget]);
  const ready=parsePickupCollectionContext(await readCollection(owner),readScope);
  assert.equal(ready.state,'ready_to_release');
  assert.deepEqual(ready.returnArrival,{versionId:arrivalVersion,arrivedAt:handoffBody.effectiveAt});
  assert.deepEqual(await release(randomUUID(),arrivalVersion,handoffBody,{version:'1'}),conflict('job_version'));
  assert.deepEqual(await release(randomUUID(),arrivalVersion,handoffBody,{principal:other}),conflict('job'));
  assert.deepEqual(await release(randomUUID(),arrivalVersion,{...handoffBody,acknowledgementConfirmed:null}),conflict('acknowledgement'));
  await assert.rejects(release(randomUUID(),arrivalVersion,{...handoffBody,missingPhotoReason:null}),{code:'22023'});
  assert.deepEqual(await release(randomUUID(),arrivalVersion,{...handoffBody,effectiveAt:firstArrival.receipt.leg.arrived_at}),conflict('arrival'));
  assert.deepEqual(await release(randomUUID(),returnArrival.receipt.leg.id,handoffBody),conflict('arrival'));
  assert.deepEqual(await release(randomUUID(),returnArrival.receipt.leg.id,{...releaseBody(returnArrival.receipt.leg.arrived_at),acknowledgementConfirmed:null},
   {job:nextJob.jobId,version:returnScope.version,collection}),conflict('photo'));
  assert.equal(await held(),1);

  await web.query('BEGIN');
  try{
   assert.equal((await release(releaseId,arrivalVersion,handoffBody)).state,'committed');
   assert.equal(await held(),1,'a separate transaction retains custody before commit');
  }finally{await web.query('ROLLBACK');}
  assert.equal(await held(),1,'rollback restores custody and erases the pending handoff');
  const competing=await sandbox.connect(databaseTarget);
  await competing.query('SET ROLE crest_web');
  const [released,replay]=await Promise.all([
   release(releaseId,arrivalVersion,handoffBody),release(releaseId,arrivalVersion,handoffBody,{connection:competing})
  ]);
  assert.equal(released.state,'committed');
  assert.deepEqual(replay,released);
  assert.equal(released.receipt.release.collection_id,cancelledCollection);
  assert.equal(released.receipt.release.return_leg_version_id,arrivalVersion);
  assert.deepEqual(released.receipt.release.person_snapshot,handoffBody.person);
  assert.equal(await held(),0);
  assert.deepEqual(await release(releaseId,arrivalVersion,{...handoffBody,notes:'Changed'}),conflict('operation'));
  assert.deepEqual(await release(randomUUID(),arrivalVersion,handoffBody),conflict('released'));
  const releasedView=await readCollection(owner);
  assert.equal(releasedView.state,'released');
  assert.equal(releasedView.collection.id,cancelledCollection);
  assert.deepEqual(releasedView.release,released.receipt.release);
  const parsedRelease=parsePickupCollectionContext(releasedView,readScope);
  assert.equal(parsedRelease.release.id,releaseId);
  assert.deepEqual(parsedRelease.release.body.person,handoffBody.person);
  assert.throws(()=>parsePickupCollectionContext({...releasedView,release:{...releasedView.release,collection_id:randomUUID()}},readScope));
  assert.throws(()=>parsePickupCollectionContext({...releasedView,state:'held'},readScope));
  assert.deepEqual(await readCollection(other),{state:'absent'});
  const photoReleaseId=randomUUID(),returnPhoto=randomUUID(),returnPhotoArrival=returnArrival.receipt.leg.id;
  const reserveReturn=(options={})=>value(web,'SELECT crest_commands.reserve_pickup_return_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) value',
   [...(options.owner??owner).auth(),(options.owner??owner).epoch,options.photo??returnPhoto,options.target??target,
    options.release??photoReleaseId,options.collection??collection,options.arrival??returnPhotoArrival,options.version??returnScope.version,
    'image/png',image.length]);
  await assert.rejects(reserveReturn({owner:other}),{code:'23514'});
  await assert.rejects(reserveReturn({arrival:arrivalVersion}),{code:'23514'});
  await assert.rejects(reserveReturn({version:'1'}),{code:'23514'});
  await assert.rejects(reserveReturn({photo}),{code:'23514'});
  const returnReservation=await reserveReturn();
  assert.equal(returnReservation.handoff_version,2);
  assert.equal(returnReservation.case_id,photoReleaseId);
  assert.deepEqual(await reserveReturn(),returnReservation);
  await assert.rejects(reserveReturn({release:randomUUID()}),{code:'23514'});
  const requiredScope={job:nextJob.jobId,version:returnScope.version,collection};
  const photoBody={...releaseBody(returnArrival.receipt.leg.arrived_at),acknowledgementConfirmed:null,
   missingPhotoReason:null,conditionPhotoId:returnPhoto};
  assert.deepEqual(await release(photoReleaseId,returnPhotoArrival,photoBody,requiredScope),conflict('photo'));
  const returnOriginal=await upload(target,returnPhoto,image);
  assert.equal((await readPhoto(owner,returnPhoto)).linked,false);
  const returnPhotoScope={businessId:owner.business,jobVehicleId:target,photoId:returnPhoto};
  const downloadReturn=(variant,scope=returnPhotoScope)=>photoAccess.download('fictional-port-credential',scope,variant,AbortSignal.timeout(30000));
  await assert.rejects(downloadReturn('preview'),/DROPOFF_PHOTO_UNCONFIRMED/);
  assert.equal(await readPhoto(other,returnPhoto),null);
  const accessReturn=()=>value(web,'SELECT crest_commands.record_dropoff_original_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,target,returnPhoto,returnOriginal.sha256,returnOriginal.byte_size]);
  await assert.rejects(accessReturn(),{code:'42501'});
  assert.deepEqual(await release(randomUUID(),returnPhotoArrival,photoBody,requiredScope),conflict('photo'));
  assert.deepEqual(await release(photoReleaseId,returnPhotoArrival,{...photoBody,conditionPhotoId:photo},requiredScope),conflict('photo'));
  const photoReleased=await release(photoReleaseId,returnPhotoArrival,photoBody,requiredScope);
  assert.equal(photoReleased.state,'committed');
  assert.equal(photoReleased.receipt.release.condition_photo_id,returnPhoto);
  assert.deepEqual(await release(photoReleaseId,returnPhotoArrival,photoBody,requiredScope),photoReleased);
  assert.equal((await readPhoto(owner,returnPhoto)).linked,true);
  assert.equal((await accessReturn()).scope.handoffEventId,photoReleaseId);
  assert.deepEqual(Buffer.from((await downloadReturn('original')).bytes),image);
  assert.equal(hash((await downloadReturn('preview')).bytes),returnOriginal.preview_sha256);
  await assert.rejects(downloadReturn('original',{...returnPhotoScope,jobVehicleId:firstTarget}),/DROPOFF_PHOTO_UNCONFIRMED/);
  assert.equal((await readPhoto()).linked,true,'collection evidence stays readable after release');
  const releaseReference={schemaVersion:1,businessId:owner.business,commandType:'operations.pickup_custody.release',
   reference:{operationId:photoReleaseId,recoveryEpoch:owner.epoch,jobId:nextJob.jobId,expectedJobVersion:returnScope.version,
    collectionId:collection,returnLegVersionId:returnPhotoArrival}};
  const lookupRelease=reference=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),reference]);
  const originalRelease=await lookupRelease(releaseReference);
  assert.deepEqual(originalRelease.result.receipt.sourceAuditIds,[photoReleased.receipt.auditId]);
  assert.equal(originalRelease.result.receipt.sourceRecordId,photoReleaseId);
  assert(!JSON.stringify(originalRelease).includes(photoBody.person.displayName));
  assert(!JSON.stringify(originalRelease).includes(returnPhoto));
  await assert.rejects(lookupRelease({...releaseReference,reference:{...releaseReference.reference,returnLegVersionId:arrivalVersion}}),{code:'23514'});
  await assert.rejects(lookupRelease({...releaseReference,reference:{...releaseReference.reference,person:photoBody.person}}),{code:'22023'});
  const unusedRelease={...releaseReference,reference:{...releaseReference.reference,operationId:randomUUID()}};
  assert.deepEqual(await lookupRelease(unusedRelease),{state:'absent'});
  const retiredRelease=await value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),owner.epoch,unusedRelease,'Fictional interrupted handoff review']);
  assert.equal(retiredRelease.state,'retired');
  assert.deepEqual(await release(unusedRelease.reference.operationId,returnPhotoArrival,photoBody,requiredScope),conflict('operation'));
  const returnView=await value(web,'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...owner.auth(),nextJob.jobId,target]);
  const parsedPhoto=parsePickupCollectionContext(returnView,{businessId:owner.business,jobId:nextJob.jobId,jobVehicleId:target});
  assert.equal(parsedPhoto.release.body.conditionPhotoId,returnPhoto);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[collection]),0);
  await assert.rejects(reserveReturn({photo:randomUUID()}),{code:'23514'});
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.audit_events WHERE operation_id=$1',[releaseId]),1);
  await assert.rejects(web.query('SELECT * FROM crest_private.pickup_custody_releases'),{code:'42501'});
  await assert.rejects(client.query('UPDATE crest_private.pickup_custody_releases SET notes=$1 WHERE id=$2',['Changed',releaseId]),{code:'55000'});
  let returnBundle;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {input}=await collectWorkspace(client,owner.business);
   returnBundle=formatFieldWorkspaceSources(input);
   const files=new Map(returnBundle.parts.map(part=>[part.name,part.content]));
   const portable=JSON.parse(files.get('pickup_custody_source.json'));
   assert.equal(portable.context.schemaVersion,2);
   assert.equal(portable.context.profile,'crest.pickup-custody-source.v2');
   const releases=portable.rows.pickup_custody_releases;
   assert.deepEqual(releases.map(row=>row.id).sort(),[photoReleaseId,releaseId].sort());
   assert.equal(releases.find(row=>row.id===releaseId).notes,handoffBody.notes);
   assert.equal(releases.find(row=>row.id===releaseId).condition_photo_id,null);
   const returned=releases.find(row=>row.id===photoReleaseId);
   assert.equal(returned.condition_photo_id,returnPhoto);
   assert.equal(returned.return_leg_version_id,returnPhotoArrival);
   assert.equal(returned.effective_at,photoBody.effectiveAt);
   assert.equal(portable.rows.pickup_photo_slots.find(row=>row.photo_id===photo).return_collection_id,null);
   assert.equal(portable.rows.pickup_photo_slots.find(row=>row.photo_id===returnPhoto).return_collection_id,collection);
   assert(!portable.rows.vehicle_custody_claims.some(row=>[collection,cancelledCollection].includes(row.pickup_collection_id)));
   assert(files.get('pickup_custody_releases.csv').includes(returnPhoto));
   assert.equal(JSON.parse(returnBundle.manifest).completeBackup,false);
   for(const corrupt of [
    wrong=>{wrong.pickupCustody.rows.pickup_custody_releases.pop();wrong.pickupCustody.context.expectedCounts.pickup_custody_releases='1';},
    wrong=>{wrong.pickupCustody.rows.pickup_photo_slots.find(row=>row.photo_id===returnPhoto).return_collection_id=cancelledCollection;},
    wrong=>{wrong.pickupCustody.rows.pickup_custody_releases.find(row=>row.id===photoReleaseId).return_leg_version_id=arrivalVersion;},
    wrong=>{
     const claims=wrong.pickupCustody.rows.vehicle_custody_claims;
     claims.push({business_id:owner.business,vehicle_id:returned.vehicle_id,dropoff_case_id:null,pickup_collection_id:collection});
     claims.sort((a,b)=>a.vehicle_id.localeCompare(b.vehicle_id));
     wrong.pickupCustody.context.expectedCounts.vehicle_custody_claims=String(claims.length);
    },
   ]){
    const wrong=structuredClone(input);corrupt(wrong);
    assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   }
  }finally{await client.query('ROLLBACK');}
  const returnNeutral=await connect(await destinationCluster.database());
  try{
   await reimportCustodySourceTables(returnNeutral,returnBundle);
   const linked=(await returnNeutral.query(`
    SELECT r.collection_id,r.return_leg_version_id,s.photo_id,o.sha256,o.preview_sha256
    FROM public.restored_pickup_custody_releases r
    JOIN public.restored_pickup_photo_slots s ON
     (s.business_id,s.collection_id,s.return_collection_id,s.arrival_version_id,s.photo_id)
      =(r.business_id,r.id,r.collection_id,r.return_leg_version_id,r.condition_photo_id)
    JOIN public.restored_custody_photo_originals o ON (o.business_id,o.photo_id)=(s.business_id,s.photo_id)
    WHERE r.id=$1`,[photoReleaseId])).rows;
   assert.deepEqual(linked,[{collection_id:collection,return_leg_version_id:returnPhotoArrival,photo_id:returnPhoto,
    sha256:returnOriginal.sha256,preview_sha256:returnOriginal.preview_sha256}]);
  }finally{await returnNeutral.end();}

  const returnPoint=join(workspace,'pickup-return');await mkdir(returnPoint,{mode:0o700});
  await assert.rejects(backupLegacy69Database(client,databaseTarget,returnPoint,keys.recipient,undefined,capturePhotos),
   {message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
  const {manifest:returnManifest}=await backupPickupReturnCandidateDatabase(client,databaseTarget,returnPoint,keys.recipient,capturePhotos);
  assert.equal(returnManifest.objectArchive.inventory.length,6);
  assert.equal(returnManifest.rows.find(row=>row.schema==='crest_private'&&row.name==='pickup_custody_releases').rows,2);
  const returnDestinationUrl=await destinationCluster.database();
  await assert.rejects(restoreLegacy70Database(returnPoint,keys.path,returnDestinationUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  const returnRecovered=await objectDirectory(join(workspace,'return-recovered'));
  const returnRestored=await restorePickupReturnCandidateDatabase(returnPoint,keys.path,returnDestinationUrl,archive=>
   restoreObjectArchive(archive.receipt,archive.inventory,{
    readVault:vault.read,unseal:decryptor(keys.path),putDestination:returnRecovered.put,readDestination:returnRecovered.read
   }));
  assert.deepEqual(returnRestored,returnManifest);
  const returnDestination=await connect(returnDestinationUrl);
  try{
   assert.deepEqual(await sourcePhotoInventory(returnDestination),returnManifest.objectArchive.inventory);
   for(const object of returnManifest.objectArchive.inventory){
    const signal=AbortSignal.timeout(10000),bytes=await returnRecovered.read(object.key,object.byteSize,signal);
    assert.equal(hash(bytes),object.sha256);
    assert.deepEqual(bytes,await readSource(object,signal));
   }
   const dispatch=await value(returnDestination,'SELECT dispatch_id value FROM crest.custody_photo_attempts WHERE id=$1',[returnPhoto]);
   assert.deepEqual(await returnRecovered.read('originals/'+owner.business+'/'+dispatch,returnOriginal.byte_size,AbortSignal.timeout(10000)),image);
   for(const [operation,receipt]of [[releaseId,released],[photoReleaseId,photoReleased]]){
    assert.deepEqual(await value(returnDestination,'SELECT crest_private.pickup_release_original($1,$2,$3) - \'request\' value',
     [owner.business,owner.actor,operation]),receipt);
   }
   await returnDestination.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const {input}=await collectWorkspace(returnDestination,owner.business);
    const restoredBundle=formatFieldWorkspaceSources(input),before=new Map(returnBundle.parts.map(part=>[part.name,part.content]));
    for(const part of restoredBundle.parts)if(part.name.endsWith('.csv'))assert.equal(part.content,before.get(part.name),part.name);
    for(const name of ['pickup_custody_source.json','custody_source.json']){
     const after=JSON.parse(restoredBundle.parts.find(part=>part.name===name).content),original=JSON.parse(before.get(name));
     assert.deepEqual(after.rows,original.rows);
     assert.deepEqual(after.historyEvidence.records,original.historyEvidence.records);
    }
   }finally{await returnDestination.query('ROLLBACK');}
  }finally{await returnDestination.end();}

  await client.query('BEGIN');
  try{
   for(const part of ['pickup-return-failure','pickup-return-queue']){
    await client.query(await readFile(new URL('../../planning/proposals/'+part+'.sql',import.meta.url),'utf8'));
   }
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  const queue=(principal=owner,after=null,businessId=principal.business,connection=web)=>value(connection,
   'SELECT crest_commands.list_pickup_returns($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...principal.auth().slice(0,7),businessId,after?.receivedAt??null,after?.caseId??null]);
  assert.deepEqual(await queue(),{schemaVersion:1,businessId:owner.business,rows:[],hasMore:false});
  await assert.rejects(queue(other,null,owner.business),{code:'42501'});
  await assert.rejects(queue(owner,{caseId:randomUUID()}),{code:'22023'});
  await assert.rejects(queue(owner,null,owner.business,worker),{code:'42501'});
  const failedJob=bookingRequest(await fixture(owner),'2026-11-07');
  const optionalPolicy=randomUUID();
  assert.equal((await save(optionalPolicy,'3',{...body,reason:'Fictional optional condition photo'})).state,'committed');
  assert.equal((await book(failedJob,'2')).state,'committed');
  const failedTarget=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[failedJob.jobId]);
  const failedJobScope={job:failedJob.jobId},failPickupLeg=randomUUID(),failedCollection=randomUUID();
  assert.equal((await transport(randomUUID(),failPickupLeg,null,{...firstDeparture,
   trip:{...firstDeparture.trip,jobVehicleIds:[failedTarget]}},failedJobScope)).state,'committed');
  const failPickupArrival=await transport(randomUUID(),failPickupLeg,failPickupLeg,recordArrival,failedJobScope);
  const pickedUp=await value(web,'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
   [...owner.auth(),owner.epoch,failedCollection,failedJob.jobId,'1',failedTarget,failPickupArrival.receipt.leg.id,optionalPolicy,
    {...releaseBody(failPickupArrival.receipt.leg.arrived_at),location:place('Fictional pickup stop')}]);
  assert.equal(pickedUp.state,'committed');
  assert.deepEqual((await queue()).rows,[]);
  const failedWorksite=randomUUID();
  assert.equal((await transport(randomUUID(),failedWorksite,null,transportBody([failedTarget]),failedJobScope)).state,'committed');
  assert.equal((await transport(randomUUID(),failedWorksite,failedWorksite,recordArrival,failedJobScope)).state,'committed');
  assert.equal((await field(randomUUID(),'1','start_pickup',owner,failedJob.jobId)).state,'committed');
  const failedCancelContext=await value(web,'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),failedJob.jobId]);
  const failedCancel=await value(web,'SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,randomUUID(),failedJob.jobId,failedCancelContext.jobVersion,{...cancelBody,
    expectedWorkIntervalId:failedCancelContext.workIntervalId,expectedOpenTravelLegVersionIds:failedCancelContext.openTravelLegVersionIds,
    scope:failedCancelContext.scope}]);
  assert.equal(failedCancel.state,'committed');
  const failedScope={...failedJobScope,version:failedCancel.receipt.jobVersion};
  const expectedQueueRow={caseId:failedCollection,jobId:failedJob.jobId,jobVehicleId:failedTarget,
   receivedAt:failPickupArrival.receipt.leg.arrived_at,vehicleLabel:'Synthetic lifecycle sedan',customerName:'Synthetic lifecycle customer'};
  const queued=async state=>assert.deepEqual((await queue()).rows,[{...expectedQueueRow,state}]);
  await queued('awaiting_return');
  const failedTrip=randomUUID(),failedOp=randomUUID(),failureReason='Fictional recipient unavailable at the stop';
  const fail=(operation,arrival,options={})=>value(options.connection??web,
   'SELECT crest_commands.fail_pickup_return($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...(options.principal??owner).auth(),(options.principal??owner).epoch,operation,failedJob.jobId,
    options.version??failedScope.version,failedCollection,arrival,options.body??{reason:failureReason}]);
  assert.equal((await transport(randomUUID(),failedTrip,null,returnBody([failedTarget]),failedScope)).state,'committed');
  await queued('returning');
  assert.deepEqual(await fail(failedOp,failedTrip),conflict('arrival'));
  const failedArrival=await transport(randomUUID(),failedTrip,failedTrip,recordArrival,failedScope);
  const failedArrivalId=failedArrival.receipt.leg.id;
  await queued('ready_for_handoff');
  assert.deepEqual(await fail(failedOp,failedArrivalId,{principal:other}),conflict('job'));
  assert.deepEqual(await fail(failedOp,failedArrivalId,{version:'1'}),conflict('job_version'));
  await assert.rejects(fail(failedOp,failedArrivalId,{body:{reason:'  '}}),{code:'22023'});
  const failReference={schemaVersion:1,businessId:owner.business,commandType:'operations.pickup_custody.fail_return',
   reference:{operationId:failedOp,recoveryEpoch:owner.epoch,jobId:failedJob.jobId,expectedJobVersion:failedScope.version,
    collectionId:failedCollection,returnLegVersionId:failedArrivalId}};
  const competingFailure=await sandbox.connect(databaseTarget);await competingFailure.query('SET ROLE crest_web');
  const [failed,competed]=await Promise.all([fail(failedOp,failedArrivalId),fail(randomUUID(),failedArrivalId,{connection:competingFailure})]);
  const recordedFailure=failed.state==='committed'?failed:competed;
  assert.equal(recordedFailure.state,'committed');
  assert.deepEqual(failed.state==='committed'?competed:failed,conflict('failed'));
  const savedFailureId=recordedFailure.receipt.failure.id;
  assert.deepEqual(await fail(savedFailureId,failedArrivalId),recordedFailure);
  assert.deepEqual(await fail(savedFailureId,failedArrivalId,{body:{reason:'Changed fictional reason'}}),conflict('operation'));
  const minimized=await lookup({...failReference,reference:{...failReference.reference,operationId:savedFailureId}});
  assert.equal(minimized.result.receipt.sourceRecordId,savedFailureId);
  assert(!JSON.stringify(minimized).includes(failureReason));
  const missed=()=>value(web,'SELECT crest_commands.read_pickup_collection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...owner.auth(),failedJob.jobId,failedTarget]);
  assert.equal((await missed()).state,'return_failed');
  assert.equal((await missed()).returnFailure.reason,failureReason);
  await queued('return_failed');
  assert.deepEqual((await worksiteTrips(failedJob.jobId)).returnVehicleIds,[failedTarget]);
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id=$1',[failedCollection]),1);
  assert.equal(await value(client,'SELECT state value FROM crest.current_travel_legs WHERE id=$1',[failedArrivalId]),'closed');
  assert.deepEqual(await release(randomUUID(),failedArrivalId,releaseBody(failedArrival.receipt.leg.arrived_at),
   {job:failedJob.jobId,version:failedScope.version,collection:failedCollection}),conflict('arrival'));
  await assert.rejects(reserveReturn({photo:randomUUID(),target:failedTarget,release:randomUUID(),collection:failedCollection,
   arrival:failedArrivalId,version:failedScope.version}),{code:'23514'});
  const nextReturn=randomUUID();
  assert.equal((await transport(randomUUID(),nextReturn,null,returnBody([failedTarget]),failedScope)).state,'committed');
  const nextArrival=await transport(randomUUID(),nextReturn,nextReturn,recordArrival,failedScope);
  assert.equal((await missed()).state,'ready_to_release');
  assert.equal((await missed()).returnFailure.id,savedFailureId);
  const laterRelease=await release(randomUUID(),nextArrival.receipt.leg.id,releaseBody(nextArrival.receipt.leg.arrived_at),
   {job:failedJob.jobId,version:failedScope.version,collection:failedCollection});
  assert.equal(laterRelease.state,'committed');
  assert.equal((await missed()).state,'released');
  assert.deepEqual((await queue()).rows,[]);
  assert.equal((await missed()).returnFailure.id,savedFailureId);
  assert.deepEqual(await fail(savedFailureId,failedArrivalId),recordedFailure);
  await assert.rejects(web.query('SELECT * FROM crest_private.pickup_return_failures'),{code:'42501'});
  await assert.rejects(client.query('UPDATE crest_private.pickup_return_failures SET reason=$1 WHERE id=$2',['Changed',savedFailureId]),{code:'55000'});
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {input}=await collectWorkspace(client,owner.business);
   assert.equal(input.pickupCustody.context.schemaVersion,2);
   assert.throws(()=>formatFieldWorkspaceSources(input),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
  }finally{await client.query('ROLLBACK');}
  await client.query('BEGIN');
  try{
   await client.query(await readFile(new URL('../../planning/proposals/pickup-return-failure-source.sql',import.meta.url),'utf8'));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}
  let failedBundle;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const {input}=await collectWorkspace(client,owner.business);
   failedBundle=formatFieldWorkspaceSources(input);
   const files=new Map(failedBundle.parts.map(part=>[part.name,part.content]));
   const exported=JSON.parse(files.get('pickup_custody_source.json'));
   assert.equal(exported.context.profile,'crest.pickup-custody-source.v3');
   assert.deepEqual(exported.rows.pickup_return_failures,[recordedFailure.receipt.failure]);
   assert(files.get('pickup_return_failures.csv').includes(failureReason));
   const wrong=structuredClone(input);
   wrong.pickupCustody.rows.pickup_return_failures[0].return_leg_version_id=nextArrival.receipt.leg.id;
   assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   wrong.pickupCustody.rows.pickup_return_failures=[];
   wrong.pickupCustody.context.expectedCounts.pickup_return_failures='0';
   assert.throws(()=>formatFieldWorkspaceSources(wrong),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
  }finally{await client.query('ROLLBACK');}
  const failedNeutral=await connect(await destinationCluster.database());
  try{await reimportCustodySourceTables(failedNeutral,failedBundle);}finally{await failedNeutral.end();}

  const failedPoint=join(workspace,'pickup-failed-return');await mkdir(failedPoint,{mode:0o700});
  await assert.rejects(backupPickupReturnCandidateDatabase(client,databaseTarget,failedPoint,keys.recipient,capturePhotos),
   {message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
  const {manifest:failedManifest}=await backupPickupReturnCandidateDatabase(client,databaseTarget,failedPoint,keys.recipient,capturePhotos,{failures:true});
  assert.equal(failedManifest.rows.find(row=>row.name==='pickup_return_failures').rows,1);
  const failedDestinationUrl=await destinationCluster.database(),failedRecovered=await objectDirectory(join(workspace,'failed-return-recovered'));
  const restoreFailedPhotos=archive=>restoreObjectArchive(archive.receipt,archive.inventory,{
   readVault:vault.read,unseal:decryptor(keys.path),putDestination:failedRecovered.put,readDestination:failedRecovered.read
  });
  await assert.rejects(restorePickupReturnCandidateDatabase(failedPoint,keys.path,failedDestinationUrl,restoreFailedPhotos),
   {message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  assert.deepEqual(await restorePickupReturnCandidateDatabase(failedPoint,keys.path,failedDestinationUrl,restoreFailedPhotos,{failures:true}),failedManifest);
  const failedDestination=await connect(failedDestinationUrl);
  try{
   assert.deepEqual(await value(failedDestination,"SELECT crest_private.pickup_return_failure_original($1,$2,$3) - 'request' value",
    [owner.business,owner.actor,savedFailureId]),recordedFailure);
   assert.deepEqual(await value(failedDestination,"SELECT crest_private.pickup_release_original($1,$2,$3) - 'request' value",
    [owner.business,owner.actor,laterRelease.receipt.release.id]),laterRelease);
   const archived=await sourcePhotoInventory(failedDestination);
   assert.deepEqual(archived,failedManifest.objectArchive.inventory);
   for(const object of archived){
    const signal=AbortSignal.timeout(10000);
    assert.deepEqual(await failedRecovered.read(object.key,object.byteSize,signal),await readSource(object,signal));
   }
   await failedDestination.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    const {input}=await collectWorkspace(failedDestination,owner.business);
    const restoredFailure=formatFieldWorkspaceSources(input),before=new Map(failedBundle.parts.map(part=>[part.name,part.content]));
    for(const part of restoredFailure.parts)if(part.name.endsWith('.csv'))assert.equal(part.content,before.get(part.name),part.name);
    const name='pickup_custody_source.json';
    const actual=JSON.parse(restoredFailure.parts.find(part=>part.name===name).content),expected=JSON.parse(before.get(name));
    assert.deepEqual(actual.rows,expected.rows);
    assert.deepEqual(actual.historyEvidence.records,expected.historyEvidence.records);
   }finally{await failedDestination.query('ROLLBACK');}
  }finally{await failedDestination.end();}

  // A single shared pickup arrival gives every collected vehicle the exact
  // same timestamp. Only the stable second cursor key separates these rows.
  const fleet=bookingRequest(await fixture(owner),'2026-12-01'),fleetScope={job:fleet.jobId};
  for(let number=2;number<=26;number++){
   const vehicleId=randomUUID();
   assert.equal((await value(web,'SELECT crest_commands.save_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,0,$12) value',
    [...owner.auth(),owner.epoch,randomUUID(),vehicleId,{label:'Fictional fleet vehicle '+number,year:null,make:null,model:null,color:null,
     vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null}])).state,'committed');
   fleet.payload.vehicles.push({...fleet.payload.vehicles[0],vehicleId});
  }
  assert.equal((await book(fleet,'2')).state,'committed');
  const fleetTargets=(await client.query('SELECT id FROM crest.job_vehicles WHERE job_id=$1 ORDER BY id',[fleet.jobId])).rows.map(row=>row.id);
  const fleetPickup=randomUUID();
  assert.equal((await transport(randomUUID(),fleetPickup,null,{...firstDeparture,
   trip:{...firstDeparture.trip,jobVehicleIds:fleetTargets}},fleetScope)).state,'committed');
  const fleetArrival=await transport(randomUUID(),fleetPickup,fleetPickup,recordArrival,fleetScope);
  for(const fleetTarget of fleetTargets){
   const collected=await value(web,'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
    [...owner.auth(),owner.epoch,randomUUID(),fleet.jobId,'1',fleetTarget,fleetArrival.receipt.leg.id,optionalPolicy,
     {...releaseBody(fleetArrival.receipt.leg.arrived_at),location:place('Fictional fleet pickup stop')}]);
   assert.equal(collected.state,'committed');
  }
  const fleetWorksite=randomUUID();
  assert.equal((await transport(randomUUID(),fleetWorksite,null,transportBody(fleetTargets),fleetScope)).state,'committed');
  assert.equal((await transport(randomUUID(),fleetWorksite,fleetWorksite,recordArrival,fleetScope)).state,'committed');
  assert.equal((await field(randomUUID(),'1','start_pickup',owner,fleet.jobId)).state,'committed');
  const fleetCancellation=await value(web,'SELECT crest_commands.read_unfulfilled_cancellation_context($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),fleet.jobId]);
  const fleetCancelled=await value(web,'SELECT crest_commands.cancel_unfulfilled_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...owner.auth(),owner.epoch,randomUUID(),fleet.jobId,fleetCancellation.jobVersion,{...cancelBody,
    expectedWorkIntervalId:fleetCancellation.workIntervalId,expectedOpenTravelLegVersionIds:fleetCancellation.openTravelLegVersionIds,
    scope:fleetCancellation.scope}]);
  assert.equal(fleetCancelled.state,'committed');
  const fleetReturnScope={...fleetScope,version:fleetCancelled.receipt.jobVersion};
  const pageOne=await queue(),pageTwo=await queue(owner,pageOne.rows.at(-1));
  assert.deepEqual([pageOne.hasMore,pageOne.rows.length,pageTwo.hasMore,pageTwo.rows.length],[true,25,false,1]);
  const all=[...pageOne.rows,...pageTwo.rows];
  assert.deepEqual(all.map(row=>row.caseId),all.map(row=>row.caseId).sort());
  assert.deepEqual(all.map(row=>row.jobVehicleId).sort(),fleetTargets);
  assert(all.every(row=>row.jobId===fleet.jobId&&row.state==='awaiting_return'&&row.receivedAt===fleetArrival.receipt.leg.arrived_at));
  const [one,two]=all,stoppedFleetLeg=randomUUID();
  assert.equal((await transport(randomUUID(),stoppedFleetLeg,null,returnBody([one.jobVehicleId]),fleetReturnScope)).state,'committed');
  assert.equal((await transport(randomUUID(),stoppedFleetLeg,stoppedFleetLeg,
   {action:'cancel',reason:'Fictional road closure',trip:{actualStop:place('Fictional safe stop')}},fleetReturnScope)).state,'committed');
  assert.equal((await queue()).rows[0].state,'return_stopped');
  const fleetReturn=randomUUID();
  assert.equal((await transport(randomUUID(),fleetReturn,null,returnBody([one.jobVehicleId,two.jobVehicleId]),fleetReturnScope)).state,'committed');
  const reached=await transport(randomUUID(),fleetReturn,fleetReturn,recordArrival,fleetReturnScope);
  const blocked=await value(web,'SELECT crest_commands.fail_pickup_return($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...owner.auth(),owner.epoch,randomUUID(),fleet.jobId,fleetReturnScope.version,one.caseId,reached.receipt.leg.id,{reason:failureReason}]);
  assert.equal(blocked.state,'committed');
  assert.deepEqual((await queue()).rows.slice(0,3).map(row=>row.state),['return_failed','ready_for_handoff','awaiting_return']);
  assert.deepEqual((await queue(other)).rows,[]);
 }finally{
  try{await destination?.end();}finally{try{await destinationCluster?.close();}finally{
   try{if(workspace)await rm(workspace,{recursive:true,force:true});}finally{
    try{await storage?.close();}finally{try{await sandbox?.close();}finally{await cluster.close();}}
   }
  }}
 }
});


test('registered schema 70 upgrades a held pickup and independently restores the registered result', {timeout:150000},async()=>{
 const source=await recoveryCluster();
 let sandbox,destination,workspace,restored;
 try{
  sandbox=await migrationSandbox(source.testDatabaseUrl);
  const target=await sandbox.database(),client=await sandbox.connect(target),web=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(client,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(69));
  assert.equal(previous.history.length,69);
  await assert.rejects(requireSyntheticPickupReturnWorkflow(target),{message:'SYNTHETIC_PICKUP_RETURN_WORKFLOW_MIGRATION_REQUIRED'});
  await web.query('SET ROLE crest_web');
  const bootstrap=await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
  const owner=await createConfirmedBookingFixture({client,web,bootstrap})(),session=owner.auth();
  const mode=(version,enabled)=>value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...session,owner.epoch,randomUUID(),version,{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:enabled,
    reason:enabled?'Explicit fictional setup':null}]);
  assert.equal((await mode('0',false)).state,'committed');
  const policy=randomUUID();
  assert.equal((await value(web,'SELECT crest_commands.save_pickup_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...session,owner.epoch,policy,'0',{acknowledgementText:null,conditionPhotoRequired:false,reason:null}])).state,'committed');
  assert.equal((await mode('1',true)).state,'committed');
  const booking=confirmedBookingRequest(owner);
  booking.payload.fulfillmentMode='pickup_return';
  Object.assign(booking.payload.vehicles[0],{pickupLocation:place('Fictional pickup stop'),returnLocation:place('Fictional return stop')});
  assert.equal((await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
   [...session,owner.epoch,booking.operationId,booking.jobId,'2',booking.payload])).state,'committed');
  const vehicle=await value(client,'SELECT id value FROM crest.job_vehicles WHERE job_id=$1',[booking.jobId]),leg=randomUUID();
  const trip=(version,input)=>value(web,'SELECT crest_commands.record_pickup_trip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15) value',
   [...session,owner.epoch,randomUUID(),booking.jobId,'1',leg,version,input]);
  assert.equal((await trip(null,{action:'depart',reason:null,trip:{
   jobVehicleIds:[vehicle],drivenVehicleId:owner.vehicle,origin:place('Fictional Crest base'),etaAt:null,notes:null
  }})).state,'committed');
  const arrived=await trip(leg,{action:'arrive',reason:null,trip:null}),collection=randomUUID();
  const saved=await value(web,'SELECT crest_commands.collect_pickup_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) value',
   [...session,owner.epoch,collection,booking.jobId,'1',vehicle,arrived.receipt.leg.id,policy,{
    effectiveAt:arrived.receipt.leg.arrived_at,person:{schemaVersion:1,displayName:'Fictional owner'},
    location:place('Fictional pickup stop'),notes:null,missingPhotoReason:'Fictional optional photo',acknowledgementConfirmed:null
   }]);
  assert.equal(saved.state,'committed');
  const before=await inventory(client),schema70=await sandbox.prefix(70),adopted=await sandbox.apply(target,schema70);
  assert.equal(adopted.history.length,70);
  assert.deepEqual(adopted.history.slice(0,69),previous.history);
  assert.deepEqual((await sandbox.apply(target,schema70)).history,adopted.history);
  await requireSyntheticPickupReturnWorkflow(target);
  const after=await inventory(client);
  assert.equal(after.length,before.length+2);
  const inherited=(rows)=>rows.filter(row=>before.some(old=>old.schema===row.schema&&old.name===row.name)&&row.schema!=='supabase_migrations');
  assert.deepEqual(inherited(after),inherited(before));
  const queue='SELECT crest_commands.list_pickup_returns($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL) value';
  assert.deepEqual(await value(web,queue,session),{schemaVersion:1,businessId:owner.business,rows:[],hasMore:false});
  for(const table of ['pickup_custody_releases','pickup_return_failures']){
   await assert.rejects(web.query('SELECT 1 FROM crest_private.'+table),{code:'42501'});
  }
  workspace=await privateWorkspace();
  const point=join(workspace,'registered70');await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace),backup=await backupLegacy70Database(client,target,point,keys.recipient);
  assert.equal(backup.manifest.schemaVersion,70);
  destination=await recoveryCluster();
  const recoveryTarget=await destination.database();
  await assert.rejects(restoreLegacy69Database(point,keys.path,recoveryTarget),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  assert.deepEqual(await restoreLegacy70Database(point,keys.path,recoveryTarget),backup.manifest);
  await requireSyntheticPickupReturnWorkflow(recoveryTarget);
  restored=await connect(recoveryTarget);
  assert.deepEqual(await value(restored,"SELECT crest_private.pickup_collection_original($1,$2,$3) - 'request' value",
   [owner.business,owner.actor,collection]),saved);
  assert.equal(await value(restored,'SELECT pickup_collection_id value FROM crest_private.vehicle_custody_claims WHERE vehicle_id=$1',
   [owner.vehicle]),collection);
 }finally{
  try{await restored?.end();}finally{try{await destination?.close();}finally{
   try{if(workspace)await rm(workspace,{recursive:true,force:true});}finally{
    try{await sandbox?.close();}finally{await source.close();}
   }
  }}
 }
});
