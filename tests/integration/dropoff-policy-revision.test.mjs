import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupLegacy68Database,connect,keyPair,privateWorkspace,recoveryCluster,restoreLegacy68Database} from '../support/recovery-drill.mjs';
import {requireSyntheticDropoffPolicyRevision} from '../../scripts/synthetic-migrations.mjs';
import {bookingFoundationEvidence} from '../support/booking-source-evidence.mjs';
import {collectAcceptedAmendmentSources} from '../support/accepted-amendment-source-fixture.mjs';
import {collectDropoffCustodySourcesInSnapshot} from '../../src/operations/dropoff-custody-source-collector.ts';
import {collectFieldSourcesInSnapshot} from '../../src/operations/field-source-collector.ts';
import {formatDropoffCustodySources} from '../../src/operations/dropoff-custody-source.ts';
import {formatFieldWorkspaceSources} from '../../src/operations/field-workspace-source.ts';

const revisionSql='SELECT crest_commands.revise_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) value';
const conflict=reason=>({state:'conflict',reason});
const value=async (connection,sql,args=[]) => (await connection.query(sql,args)).rows[0]?.value;

test('Drop-Off policy revision preserves existing bookings and atomically changes future bookings', {timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox,workspace,destinationCluster,restored;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),client=await sandbox.connect(target),web=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(client,target);
  const previous=await sandbox.apply(target,await sandbox.prefix(67));
  assert.equal(previous.history.length,67);
  await assert.rejects(requireSyntheticDropoffPolicyRevision(target),{message:'SYNTHETIC_DROPOFF_POLICY_REVISION_MIGRATION_REQUIRED'});
  await web.query('SET ROLE crest_web');
  const bootstrap=await value(client,"SELECT id value FROM crest_private.actors WHERE system_key='security_bootstrap'");
  const accepted=createConfirmedBookingFixture({client,web,bootstrap}),owner=await accepted();

  async function book(parent,sequence,hoursLater=false){
   const request=confirmedBookingRequest(parent);
   request.payload.fulfillmentMode='dropoff';
   if(hoursLater)Object.assign(request.payload.appointment,{start_at:'2026-11-03T13:00:00.123456Z',end_at:'2026-11-03T14:00:00.123456Z',
    local_start:'2026-11-03T13:00:00.123456',local_end:'2026-11-03T14:00:00.123456'});
   const saved=await value(web,'SELECT crest_commands.book_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13) value',
    [...parent.auth(),parent.epoch,request.operationId,request.jobId,sequence,request.payload]);
   assert.equal(saved.state,'committed',JSON.stringify(saved));
   return (await client.query('SELECT j.id,j.mode_version_id,v.id vehicle_id FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id WHERE j.business_id=$1 AND j.id=$2',
    [parent.business,request.jobId])).rows[0];
  }
  const before=await book(owner,'0'),firstId=randomUUID();
  const first=await value(web,'SELECT crest_commands.save_dropoff_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',
   [...owner.auth(),owner.epoch,firstId,before.mode_version_id,{acknowledgementText:'Prior instructions',conditionPhotoRequired:false}]);
  assert.equal(first.state,'committed');
  const policyFor=(job)=>value(web,'SELECT crest_commands.read_dropoff_job_custody($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
   [...owner.auth(),job.id,job.vehicle_id]);
  const beforeUpgrade=await policyFor(before);
  assert.deepEqual(beforeUpgrade.policy,{id:firstId,acknowledgementText:'Prior instructions',conditionPhotoRequired:false});
  const registered68=await sandbox.prefix(68),applied=await sandbox.apply(target,registered68);
  assert.equal(applied.history.length,68);
  assert.deepEqual(applied.history.slice(0,67),previous.history);
  assert.deepEqual((await sandbox.apply(target,registered68)).history,applied.history);
  await requireSyntheticDropoffPolicyRevision(target);
  await assert.rejects(web.query("SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261122180000'"),{code:'42501'});
  assert.deepEqual(await policyFor(before),beforeUpgrade);
  const noModeChange=await value(web,'SELECT crest_commands.save_fulfillment_modes($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) value',
   [...owner.auth(),owner.epoch,randomUUID(),'1',{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:false,reason:'Synthetic no-op'}]);
  assert.deepEqual(noModeChange,conflict('review'));

  const input={acknowledgementText:null,conditionPhotoRequired:true,reason:'Synthetic photo requirement change'};
  const revise=(id,body=input,mode=before.mode_version_id,policy=firstId,auth=owner.auth(),connection=web)=>
   value(connection,revisionSql,[...auth,owner.epoch,id,mode,policy,body]);
  const original=operationId=>({schemaVersion:1,businessId:owner.business,commandType:'operations.custody.policy.revise',
   reference:{operationId,recoveryEpoch:owner.epoch,modeVersionId:before.mode_version_id,policyId:firstId}});
  const lookup=reference=>value(web,'SELECT crest_commands.lookup_scheduling_original($1,$2,$3,$4,$5,$6,$7,$8,$9) value',
   [...owner.auth(),reference]);
  const retire=reference=>value(web,'SELECT crest_commands.retire_original_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value',
   [...owner.auth(),owner.epoch,reference,'Synthetic interrupted policy revision']);
  await assert.rejects(revise(randomUUID(),{...input,reason:'  '}),{code:'22023'});
  const invalid=owner.auth();invalid[0]=randomBytes(32);
  await assert.rejects(revise(randomUUID(),input,before.mode_version_id,firstId,invalid),{code:'42501'});
  assert.deepEqual(await revise(randomUUID(),input,randomUUID()),conflict('version'));
  assert.deepEqual(await revise(randomUUID(),input,before.mode_version_id,randomUUID()),conflict('version'));
  assert.deepEqual(await revise(randomUUID(),{...input,acknowledgementText:'Prior instructions',conditionPhotoRequired:false}),conflict('unchanged'));
  await assert.rejects(value(web,'SELECT crest_private.dropoff_policy_revision_original($1,$2,$3) value',
   [owner.business,owner.actor,firstId]),{code:'42501'});
  const retired=randomUUID();
  assert.deepEqual(await lookup(original(retired)),{state:'absent'});
  assert.equal((await retire(original(retired))).state,'retired');
  assert.deepEqual(await revise(retired),conflict('operation'));

  const competing=await sandbox.connect(target);await competing.query('SET ROLE crest_web');
  const attempts=[randomUUID(),randomUUID()];
  const results=await Promise.all([revise(attempts[0]),revise(attempts[1],input,before.mode_version_id,firstId,owner.auth(),competing)]);
  const saved=results.find(row=>row.state==='committed');
  assert(saved);
  assert.deepEqual(results.find(row=>row.state==='conflict'),conflict('version'));
  assert.equal(saved.receipt.sequence,'2');
  assert.equal(saved.receipt.priorModeVersionId,before.mode_version_id);
  assert.equal(saved.receipt.priorPolicyId,firstId);
  assert.deepEqual(saved.receipt.policy,{id:saved.operationId,modeVersionId:saved.receipt.policy.modeVersionId,
   acknowledgementText:null,conditionPhotoRequired:true});
  assert.notEqual(saved.receipt.policy.modeVersionId,before.mode_version_id);
  assert.deepEqual(await revise(saved.operationId),saved);
  assert.deepEqual(await revise(saved.operationId,{...input,reason:'Changed replay body'}),conflict('operation'));
  assert.deepEqual(await value(client,'SELECT crest_private.dropoff_policy_revision_original($1,$2,$3) value',
   [owner.business,owner.actor,saved.operationId]),saved);
  const resolved=await lookup(original(saved.operationId));
  assert.deepEqual(resolved.original,original(saved.operationId));
  assert.deepEqual(resolved.result.receipt.sourceAuditIds,[saved.receipt.modeAuditId,saved.receipt.policyAuditId]);
  assert.equal(resolved.result.receipt.sourceRecordId,saved.operationId);
  assert.equal(resolved.result.receipt.sourceVersion,'2');
  assert.equal((await retire(original(saved.operationId))).state,'original_recorded');
  const mismatched=original(saved.operationId);mismatched.reference.policyId=randomUUID();
  assert.deepEqual(await lookup(mismatched),{state:'absent'});
  assert.equal(await value(client,'SELECT count(*)::int value FROM crest_private.operations WHERE business_id=$1 AND operation_id=ANY($2::uuid[])',
   [owner.business,attempts]),1);
  const modes=(await client.query('SELECT mobile_enabled,dropoff_enabled,pickup_return_enabled FROM crest.fulfillment_mode_versions WHERE business_id=$1 ORDER BY sequence',
   [owner.business])).rows;
  assert.equal(modes.length,2);
  assert.deepEqual(modes[0],modes[1]);
  const audits=(await client.query('SELECT id,entity_kind FROM crest_private.audit_events WHERE business_id=$1 AND operation_id=$2 ORDER BY entity_kind',
   [owner.business,saved.operationId])).rows;
  assert.deepEqual(audits,[{id:saved.receipt.policyAuditId,entity_kind:'custody_authorization_configs'},
   {id:saved.receipt.modeAuditId,entity_kind:'fulfillment_modes'}]);

  const next=await book(await accepted(owner),'2',true);
  assert.equal(next.mode_version_id,saved.receipt.policy.modeVersionId);
  assert.deepEqual((await policyFor(next)).policy,{id:saved.operationId,acknowledgementText:null,conditionPhotoRequired:true});
  assert.deepEqual((await policyFor(before)).policy,{id:firstId,acknowledgementText:'Prior instructions',conditionPhotoRequired:false});

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const foundation=await bookingFoundationEvidence(client,owner.business),signal=new AbortController().signal;
   const custody=(await collectDropoffCustodySourcesInSnapshot(client,owner.business,foundation.history,signal)).forServer();
   const input={context:custody.context,rows:custody.rows,historyEvidence:foundation.history};
   assert(custody.files['custody_authorization_configs.csv'].includes(saved.operationId));
   const history=JSON.parse(custody.files['custody_source.json']).historyEvidence.records
    .filter(row=>row.kind==='audit_event').map(row=>JSON.parse(row.canonicalEvidence).row)
    .filter(row=>row.operation_id===saved.operationId);
   assert.deepEqual(history.map(row=>row.id).sort(),[saved.receipt.modeAuditId,saved.receipt.policyAuditId].sort());
   const incomplete=structuredClone(input);
   incomplete.context.expectedCounts.custody_authorization_configs='1';
   incomplete.rows.custody_authorization_configs=incomplete.rows.custody_authorization_configs.filter(row=>row.id!==firstId);
   assert.throws(()=>formatDropoffCustodySources(incomplete),/CUSTODY_SOURCE_REVIEW_REQUIRED/);

   const commercial=await collectAcceptedAmendmentSources(client,owner.business);
   const field=(await collectFieldSourcesInSnapshot(client,owner.business,signal)).forServer();
   const crm={};
   for(const [group,routine] of [['customers','customer'],['addresses','address'],['vehicles','vehicle'],['associations','association']]){
    const context=await value(client,'SELECT crest_commands.'+routine+'_snapshot_context($1) value',[owner.business]);
    const page=await value(client,'SELECT crest_commands.'+routine+'_snapshot_page($1,$2,NULL,20) value',[owner.business,context.snapshotToken]);
    assert.equal(String(page[group].length),context.rowCount);
    crm[group]={businessId:owner.business,snapshotToken:context.snapshotToken,expectedRowCount:context.rowCount,rows:page[group]};
   }
   const workspace={...foundation,commercial:{...commercial,historyEvidence:foundation.history},
    field:{...field,historyEvidence:foundation.history},crm};
   assert.throws(()=>formatFieldWorkspaceSources(workspace),/FIELD_WORKSPACE_SOURCE_REVIEW_REQUIRED/);
   const bundle=formatFieldWorkspaceSources({...workspace,custody:input});
   assert(bundle.parts.some(part=>part.name==='fulfillment_mode_versions.csv'&&part.content.includes(saved.receipt.policy.modeVersionId)));
   assert(bundle.parts.some(part=>part.name==='custody_authorization_configs.csv'&&part.content.includes(saved.operationId)));
  }finally{await client.query('ROLLBACK');}

  workspace=await privateWorkspace();
  const point=join(workspace,'point');
  await mkdir(point,{mode:0o700});
  const keys=await keyPair(workspace);
  assert.equal((await client.query('SELECT 1 FROM crest.custody_photo_attempts LIMIT 1')).rowCount,0);
  const sealed=await backupLegacy68Database(client,target,point,keys.recipient);
  assert.equal(sealed.manifest.completeBackup,false);
  assert.equal(sealed.manifest.schemaVersion,68);
  assert.equal(sealed.manifest.registrySha256,applied.registrySha256);
  destinationCluster=await recoveryCluster();
  const destination=await destinationCluster.database();
  const recovered=await restoreLegacy68Database(point,keys.path,destination);
  assert.deepEqual(recovered,sealed.manifest);
  restored=await connect(destination);
  assert.deepEqual(await value(restored,'SELECT crest_private.dropoff_policy_revision_original($1,$2,$3) value',
   [owner.business,owner.actor,saved.operationId]),saved);
  const retained=(await restored.query('SELECT id,mode_version_id FROM crest.jobs WHERE business_id=$1 ORDER BY id',[owner.business])).rows;
  assert.deepEqual(retained,[before,next].map(({id,mode_version_id})=>({id,mode_version_id})).sort((a,b)=>a.id.localeCompare(b.id)));
 }finally{
  try{await restored?.end();await destinationCluster?.close();}
  finally{try{
   if(workspace){
    const actual=await realpath(workspace);
    const root=await realpath(fileURLToPath(new URL('../../.local/recovery-drill/',import.meta.url)));
    assert.equal(dirname(actual),root);
    assert.match(basename(actual),/^case-[a-z0-9]+$/i);
    await rm(actual,{recursive:true,force:true});
   }
  }
   finally{try{await sandbox?.close();}finally{await cluster.close();}}}
 }
});
