import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {custodyFixture} from '../support/source-export-custody-fixture.mjs';
import {createCurrentBusinessSourceCollector} from '../../src/security/business-foundation-collector.ts';
import {createCurrentBusinessExportWorker} from '../../src/security/business-source-export-worker.ts';
import {createExportOriginalReader} from '../../src/security/source-export-original-reader.ts';
import {prepareCurrentOriginalSources} from '../support/current-original-sources.mjs';
import {custodyPhotoObjects} from '../support/custody-photo-objects.mjs';
import sharp from 'sharp';
const call=async(connection,name,args)=>(await connection.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args)).rows[0].result;
test('Registered136-to137 original-export access: mixed-kind upgrade, Ready snapshots, private reads and audit',{timeout:180000},async()=>{
 const cluster=await recoveryCluster();let sandbox,custody,originalObjects,exportLogin;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);const database=await sandbox.database(),admin=await sandbox.connect(database);await sandbox.apply(database,await sandbox.prefix(0),true);await installProviderSchema(admin,database);await sandbox.apply(database,await sandbox.prefix(136));
  const web=await sandbox.connect(database);await web.query('SET ROLE crest_web');const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id,owner=await createConfirmedBookingFixture({client:admin,web,bootstrap})(),auth=owner.auth();
  const bytes=await sharp({create:{width:1,height:1,channels:3,background:'#304b68'}}).png().toBuffer(),preview=await sharp(bytes).jpeg().toBuffer(),sha=value=>createHash('sha256').update(value).digest('hex');
  const {expenseId,receiptId,reservation,candidate,supplierId,supplierReservation,photoId,attempt}=await prepareCurrentOriginalSources({sandbox,database,admin,web,owner,bytes,preview});
  originalObjects=await custodyPhotoObjects({bucket:'crest-synthetic-export-originals'});
  for(const key of[reservation.originalKey,supplierReservation.originalKey,`originals/${owner.business}/${attempt.dispatch_id}`])originalObjects.objects.set(key,{bytes:Buffer.from(bytes),type:'image/png'});
  const jobId=randomUUID(),release='a'.repeat(40);await call(web,'request_current_source_export_v3_for_execution',[...auth,owner.epoch,randomUUID(),jobId,release]);
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,randomUUID(),'expense_receipt',receiptId]),{code:'42501'},'queued jobs grant no original access');
  const leaseId=randomUUID(),claimed=await call(web,'claim_source_export',[...auth,owner.epoch,randomUUID(),jobId,'1',leaseId]);
  exportLogin='crest_original_export_'+randomBytes(8).toString('hex');const password=randomBytes(32).toString('hex');await sandbox.admin.query('CREATE ROLE '+exportLogin+" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '"+password+"'");await sandbox.admin.query('GRANT crest_export TO '+exportLogin+' WITH INHERIT FALSE, SET TRUE');
  const connection=new URL(database);connection.username=exportLogin;connection.password=password;const registry=JSON.parse(await readFile(new URL('../../supabase/migration-checksums.json',import.meta.url),'utf8')),migrationIdentity=registry.migrations.slice(0,136).map(entry=>({version:entry.version,name:entry.file.slice(15,-4)}));
  custody=await custodyFixture(async()=>{});const stages={authorize:'authorize_source_export_worker',snapshot:'record_source_export_snapshot',intent:'record_source_export_part_intent',verified:'record_source_export_part_verified',ready:'record_source_export_ready'},readyOperation=randomUUID();
  const jobs=Object.fromEntries(Object.entries(stages).map(([stage,name])=>[stage,request=>call(web,name,[...auth,owner.epoch,...stage==='ready'?[readyOperation,claimed.receipt.job.version]:[],JSON.stringify(request)])]));
  const worker=createCurrentBusinessExportWorker({businessId:owner.business,appReleaseId:release,sourceSchemaVersion:136},createCurrentBusinessSourceCollector({environment:'test',businessId:owner.business,connectionString:connection.toString(),migrationIdentity}),custody.store,jobs);
  const result=(await worker.run({formatVersion:1,profile:'crest.current-business-source-bundle.v1',businessId:owner.business,actorId:owner.actor,exportJobId:jobId,recoveryEpoch:owner.epoch,leaseId},new AbortController().signal)).forServer();
  const args=[...auth,jobId,result.generationId,'expense_receipt',receiptId],permit=await call(web,'read_source_export_original',args);
  assert.equal(permit.profile,'crest.source-export-original-permit.v1');assert.equal(permit.file.sha256,sha(bytes));assert.equal(permit.file.byteSize,bytes.length);assert.equal(permit.file.path,`attachments/${receiptId}/${receiptId}.png`);assert.equal(permit.object.key,reservation.originalKey);assert.equal(permit.header.exportJobId,jobId);assert.equal(permit.header.sourceSchemaVersion,136);
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,'supplier_document',supplierId]),{code:'42804'},'frozen136 reproduces the mixed integer/bigint record-plan failure on this reused connection');
  await sandbox.apply(database,await sandbox.prefix(137));
  assert.equal((await admin.query("SELECT proowner::regrole::text AS owner FROM pg_proc WHERE oid='crest_private.current_source_export_original(uuid,text,uuid)'::regprocedure")).rows[0].owner,'crest_business_source_owner');
  assert.equal((await admin.query("SELECT has_function_privilege('crest_web','crest_private.current_source_export_original(uuid,text,uuid)','EXECUTE') AS granted")).rows[0].granted,false);
  const stored=JSON.parse((await admin.query('SELECT request_text FROM crest_private.export_job_snapshots WHERE business_id=$1 AND export_job_id=$2',[owner.business,jobId])).rows[0].request_text).plan.originals;
  assert.deepEqual(stored.files.filter(file=>file.kind==='expense_receipt'),[permit.file],'original permission requires exact membership of the committed worker plan');assert.equal(permit.indexSha256,stored.inventorySha256);
  assert.equal((await admin.query('SELECT crest_private.source_export_original_index_valid($1::jsonb) AS valid',[JSON.stringify({...stored,files:[{...permit.file,recordedAt:'2099-01-01T00:00:00.123456Z'}]})])).rows[0].valid,true,'source timestamps are retained data, not a clock-based membership test');
  const receipt=await call(web,'record_source_export_original_access',[...args,JSON.stringify(permit)]);assert.equal(receipt.state,'authorized_handoff');assert.equal(receipt.scope.profile,'crest.source-export-original-scope.v1');assert.deepEqual(receipt.scope.file,permit.file);
  const operation=(await admin.query('SELECT state,command_type,payload_hash,result FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[owner.business,receipt.operationId])).rows[0];assert.equal(operation.state,'committed');assert.equal(operation.command_type,'export.download_access');assert.deepEqual(operation.result,receipt);
  const audit=(await admin.query('SELECT entity_kind,action,delta FROM crest_private.audit_events WHERE business_id=$1 AND id=$2',[owner.business,receipt.auditEventId])).rows[0];assert.equal(audit.entity_kind,'export_accesses');assert.equal(audit.action,'authorized_handoff');assert.deepEqual(audit.delta.after,receipt.scope);
  let committedAudit;
  const access={read:async(_credential,request)=>({actorId:owner.actor,record:await call(web,'read_source_export_original',[...auth,request.exportJobId,request.generationId,request.kind,request.attachmentId])}),record:async(_credential,request,p)=>{committedAudit=await call(web,'record_source_export_original_access',[...auth,request.exportJobId,request.generationId,request.kind,request.attachmentId,JSON.stringify(p)]);return committedAudit;}};
  const copies=[],readOriginal=async(input,signal)=>{const value=await originalObjects.receipts.intakeStore.readVerifiedCandidate(input,signal);copies.push(value);return value;},readPhoto=async(input,signal)=>{const value=await originalObjects.store.readVerifiedCandidate(input,signal);copies.push(value);return value;};
  const reader=createExportOriginalReader(owner.business,access,{expense_receipt:readOriginal,condition_photo:readPhoto,supplier_document:readOriginal}),permits=[];
  for(const[kind,attachmentId]of[['expense_receipt',receiptId],['supplier_document',supplierId],['condition_photo',photoId]]){
   const current=await call(web,'read_source_export_original',[...auth,jobId,result.generationId,kind,attachmentId]);permits.push(current.file);assert.equal(current.indexSha256,stored.inventorySha256);if(kind==='condition_photo'){assert.equal(current.file.objectId,attempt.dispatch_id);assert.notEqual(current.file.objectId,photoId);}
   let delivered=false;await reader.deliver('native-authority-port',{exportJobId:jobId,generationId:result.generationId,kind,attachmentId},new AbortController().signal,async value=>{assert(committedAudit);assert.equal((await admin.query('SELECT state FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',[owner.business,committedAudit.operationId])).rows[0].state,'committed','handoff follows actual audit commit');assert.deepEqual(Buffer.from(value.bytes),bytes);assert.equal(value.file.kind,kind);delivered=true;});assert(delivered);
  }
  assert.deepEqual(permits.sort((a,b)=>a.attachmentId.localeCompare(b.attachmentId)),stored.files);assert.equal(originalObjects.requests.filter(value=>value.method==='GET').length,3);assert(copies.every(value=>value.every(byte=>byte===0)),'owned original bytes are cleared after handoff');
  await assert.rejects(call(web,'record_source_export_original_access',[...args,JSON.stringify({...permit,file:{...permit.file,sha256:'f'.repeat(64)}})]),{code:'42501'});
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,'expense_receipt',randomUUID()]),{code:'42501'});
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,'arbitrary_source',receiptId]),{code:'22023'});
  await assert.rejects(web.query('SELECT crest_private.current_source_export_original($1,$2,$3)',[owner.business,'expense_receipt',receiptId]),{code:'42501'});
  for(const kind of['condition_photo','supplier_document'])await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,kind,randomUUID()]),error=>error.code==='42501'&&error.message==='CREST_ORIGINAL_OUTSIDE_SNAPSHOT','fixed source branch has only scoped source-reader access');
  const laterReceipt=randomUUID(),laterReserved=await call(web,'reserve_expense_receipt',[...auth,owner.epoch,randomUUID(),laterReceipt,expenseId,'1','image/png',bytes.length]);
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,'expense_receipt',laterReceipt]),{code:'42501'},'pending originals are unavailable');
  const laterReservation=laterReserved.receipt.record.reservation,laterCandidate={...candidate,original:{...candidate.original,key:laterReservation.originalKey},preview:{...candidate.preview,key:laterReservation.previewKey}};
  await call(web,'publish_expense_receipt',[...auth,owner.epoch,randomUUID(),laterReceipt,laterCandidate]);
  await assert.rejects(call(web,'read_source_export_original',[...auth,jobId,result.generationId,'expense_receipt',laterReceipt]),error=>error.code==='42501'&&error.message==='CREST_ORIGINAL_OUTSIDE_SNAPSHOT','later publications cannot enter an older export');
  const foreignAuth=[...auth];foreignAuth[7]=randomUUID();await assert.rejects(call(web,'read_source_export_original',[...foreignAuth,jobId,result.generationId,'expense_receipt',receiptId]),{code:'42501'});
  // A fresh137 export includes the later publication, while the original136
  // package continues to refuse it. Exercise the current default worker too.
  originalObjects.objects.set(laterReservation.originalKey,{bytes:Buffer.from(bytes),type:'image/png'});
  const nextJob=randomUUID(),nextLease=randomUUID();await call(web,'request_current_source_export_v4_for_execution',[...auth,owner.epoch,randomUUID(),nextJob,release]);
  const nextClaim=await call(web,'claim_source_export',[...auth,owner.epoch,randomUUID(),nextJob,'1',nextLease]),nextReadyOperation=randomUUID();
  const nextJobs=Object.fromEntries(Object.entries(stages).map(([stage,name])=>[stage,request=>call(web,name,[...auth,owner.epoch,...stage==='ready'?[nextReadyOperation,nextClaim.receipt.job.version]:[],JSON.stringify(request)])]));
  const nextCollector=createCurrentBusinessSourceCollector({environment:'test',businessId:owner.business,connectionString:connection.toString(),migrationIdentity:registry.migrations.map(entry=>({version:entry.version,name:entry.file.slice(15,-4)}))}),nextWorker=createCurrentBusinessExportWorker({businessId:owner.business,appReleaseId:release},nextCollector,custody.store,nextJobs);
  const next=(await nextWorker.run({formatVersion:1,profile:'crest.current-business-source-bundle.v1',businessId:owner.business,actorId:owner.actor,exportJobId:nextJob,recoveryEpoch:owner.epoch,leaseId:nextLease},new AbortController().signal)).forServer();
  for(const[kind,attachmentId]of[['supplier_document',supplierId],['expense_receipt',laterReceipt],['condition_photo',photoId],['expense_receipt',receiptId]]){
   let delivered=false;await reader.deliver('native-authority-port',{exportJobId:nextJob,generationId:next.generationId,kind,attachmentId},new AbortController().signal,async value=>{assert.equal(value.header.sourceSchemaVersion,137);assert.deepEqual(Buffer.from(value.bytes),bytes);delivered=true;});assert(delivered);
  }
  assert.equal(originalObjects.requests.filter(value=>value.method==='GET').length,7);assert(copies.every(value=>value.every(byte=>byte===0)));
 }finally{try{await originalObjects?.close();}finally{try{await custody?.close();}finally{try{if(exportLogin)await sandbox?.admin.query('DROP ROLE '+exportLogin);await sandbox?.close();}finally{await cluster.close();}}}}
});
