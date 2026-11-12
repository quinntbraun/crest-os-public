import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupDatabase,backupLegacy68Database,connect,hash,inventory,keyPair,privateWorkspace,recoveryCluster,restoreDatabase,
 restoreLegacy68Database} from '../support/recovery-drill.mjs';
import {requireSyntheticPickupCustody} from '../../scripts/synthetic-migrations.mjs';
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

test('pickup policies, handoffs and verified photo bytes survive encrypted recovery', {timeout:180000},async()=>{
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
  const adopted=await sandbox.apply(databaseTarget);
  assert.equal(adopted.history.length,69);
  assert.deepEqual(adopted.history.slice(0,68),predecessor.history);
  assert.deepEqual((await sandbox.apply(databaseTarget)).history,adopted.history);
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
  const {manifest}=await backupDatabase(client,databaseTarget,point,keys.recipient,undefined,{
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
  });
  assert.equal(manifest.objectArchive.inventory.length,4);
  assert.equal(manifest.objectArchive.inventory.filter(object=>object.retention==='original').length,2);
  destinationCluster=await recoveryCluster();
  const destinationUrl=await destinationCluster.database();
  await assert.rejects(restoreLegacy68Database(point,keys.path,destinationUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
  const restored=await restoreDatabase(point,keys.path,destinationUrl,archive=>
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
 }finally{
  try{await destination?.end();}finally{try{await destinationCluster?.close();}finally{
   try{if(workspace)await rm(workspace,{recursive:true,force:true});}finally{
    try{await storage?.close();}finally{try{await sandbox?.close();}finally{await cluster.close();}}
   }
  }}
 }
});
