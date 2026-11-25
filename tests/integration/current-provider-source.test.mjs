import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {captureCurrentBusinessRows} from '../../src/security/current-business-source.ts';
import {captureCurrentIdentitySource} from '../../src/security/current-business-identity-source.ts';
import {captureCurrentSessionSource} from '../../src/security/current-business-session-source.ts';
import {formatCurrentBusinessPortableSource} from '../../src/security/current-business-portable-source.ts';
import {captureCurrentProviderSource,formatCurrentProviderSource} from '../../src/security/current-business-provider-source.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
const call=async(connection,name,args)=>(await connection.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args)).rows[0].result;
test('Registered135 upgrade: all eight scoped provider tables, exact reimport and unchanged legacy134 receipts',{timeout:120000},async()=>{
 const cluster=await recoveryCluster();let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);const database=await sandbox.database(),admin=await sandbox.connect(database);
  await sandbox.apply(database,await sandbox.prefix(0),true);await installProviderSchema(admin,database);await sandbox.apply(database,await sandbox.prefix(134));
  const web=await sandbox.connect(database);await web.query('SET ROLE crest_web');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const fixture=createConfirmedBookingFixture({client:admin,web,bootstrap}),owner=await fixture(),foreign=await fixture(),auth=owner.auth(),issuer=auth[3],subject=auth[4];
  const oldOperation=randomUUID(),oldJob=randomUUID(),release='a'.repeat(40),oldArgs=[...auth,owner.epoch,oldOperation,oldJob,release];
  const old=await call(web,'request_current_source_export_for_execution',oldArgs);assert.equal(old.state,'created');
  await sandbox.apply(database,await sandbox.prefix(135));
  assert.deepEqual(await call(web,'request_current_source_export_for_execution',oldArgs),{...old,state:'recorded'});
  assert.equal((await call(web,'stop_source_export',[...auth,owner.epoch,randomUUID(),oldJob,'1'])).state,'committed');
  const newer=await call(web,'request_current_source_export_v2_for_execution',[...auth,owner.epoch,randomUUID(),randomUUID(),release]);assert.equal(newer.state,'created');
  assert.equal(newer.result.receipt.job.source_schema_version,135);
  assert.equal((await admin.query('SELECT source_schema_version FROM crest_private.export_jobs WHERE id=$1',[oldJob])).rows[0].source_schema_version,134);
  const inventory=await sandbox.connect(database),cleanup=await sandbox.connect(database);await inventory.query('SET ROLE crest_inventory');await cleanup.query('SET ROLE crest_cleanup');
  const begin=await call(web,'begin_provider_login',[randomUUID(),randomUUID(),issuer,subject]),providerSession=randomUUID(),passwordAt=new Date(Math.floor(Date.now()/1000)*1000),expiresAt=new Date(Date.now()+60000);
  await admin.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal1',clock_timestamp(),clock_timestamp())",[providerSession,subject]);
  await call(web,'record_provider_login_target',[begin.attemptId,owner.actor,begin.securityEpoch,issuer,subject,providerSession,passwordAt,expiresAt]);
  await admin.query("UPDATE auth.sessions SET aal='aal2' WHERE id=$1",[providerSession]);
  await call(web,'issue_open_app_session',[begin.appSessionId,randomBytes(32),owner.actor,begin.securityEpoch,issuer,subject,providerSession,passwordAt,new Date(),false,randomBytes(32),'synthetic',begin.attemptId]);
  await call(web,'finish_provider_login',[begin.attemptId,owner.actor,begin.securityEpoch,issuer,subject,'registration_closed']);
  const stop=await call(web,'finish_provider_login',[begin.attemptId,owner.actor,begin.securityEpoch,issuer,subject,'stopped_review']);
  const request=await call(inventory,'request_provider_cleanup',[randomUUID(),stop.evidence.finishId,owner.actor,issuer]);await call(cleanup,'execute_provider_cleanup',[request.evidence.requestId,owner.actor,issuer]);
  for(let i=0;i<2;i++)await call(inventory,'record_provider_inventory',[randomUUID(),owner.actor,issuer,null,100]);
  // Original commands produce the source rows. Decoder/custody are tested by
  // their own suites; this synthetic metadata case proves inventory composition.
  const expenseId=randomUUID(),receiptId=randomUUID(),originalBytes=Buffer.from('Synthetic attachment inventory evidence'),previewBytes=Buffer.from([255,216,255,217]),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const expense={paidOn:'2026-11-22',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic retained receipt inventory',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
  assert.equal((await call(web,'save_expense',[...auth,owner.epoch,randomUUID(),expenseId,'0',expense])).state,'committed');
  const reserved=await call(web,'reserve_expense_receipt',[...auth,owner.epoch,randomUUID(),receiptId,expenseId,'1','image/png',originalBytes.length]),reservation=reserved.receipt.record.reservation;
  const candidate={status:'PrivateValidatedCandidate',validationVersion:imageValidationVersion,source:{sha256:sha(originalBytes),byteSize:originalBytes.length,detectedType:'image/png',width:1,height:1},original:{key:reservation.originalKey,byteSize:originalBytes.length,sha256:sha(originalBytes)},preview:{key:reservation.previewKey,byteSize:previewBytes.length,sha256:sha(previewBytes),contentType:'image/jpeg',width:1,height:1}};
  assert.equal((await call(web,'publish_expense_receipt',[...auth,owner.epoch,randomUUID(),receiptId,candidate])).state,'committed');
  const reader=await sandbox.connect(database);await reader.query('SET ROLE crest_export');
  await assert.rejects(reader.query('SELECT * FROM crest_private.provider_login_attempts'),{code:'42501'});
  const pageArgs=[owner.business,owner.actor,issuer,'crest_private.provider_inventory_observations',null,null,1];
  await assert.rejects(call(reader,'provider_source_page_v1',pageArgs),{code:'25001'});
  await assert.rejects(call(web,'provider_source_page_v1',pageArgs),{code:'42501'});
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const query=async(sql,args)=>(await reader.query(sql,args)).rows,business=await captureCurrentBusinessRows(owner.business,query,()=>{}),identity=await captureCurrentIdentitySource(business,query,()=>{}),provider=await captureCurrentProviderSource(identity,business,query,()=>{});
   assert.equal(provider.sources.length,8);assert(provider.sources.every(source=>source.rows.length>0),'every required provider source has real command-produced rows');
   for(const source of provider.sources){
    const projection=source.columns.map(column=>source.types[column]==='timestamp with time zone'?`'${column}',to_char(t."${column}" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`:`'${column}',t."${column}"::text`).join(',');
    const actual=(await admin.query('SELECT jsonb_build_object('+projection+') AS row FROM '+source.source+' t WHERE actor_id=$1 ORDER BY ARRAY['+source.primaryKey.map(column=>'t."'+column+'"::text').join(',')+'] COLLATE "C"',[owner.actor])).rows.map(value=>value.row);
    assert.deepEqual(source.rows,actual,source.source+' exact scoped source cells');
   }
   const first=await call(reader,'provider_source_page_v1',pageArgs);assert.equal(first.rows.length,1);assert(first.nextCursor);
   const second=await call(reader,'provider_source_page_v1',[...pageArgs.slice(0,4),first.snapshotToken,first.nextCursor,1]);assert.equal(second.rows.length,1);assert.notDeepEqual(first.rows,second.rows);assert.equal(second.snapshotToken,first.snapshotToken);
   const bundle=formatCurrentProviderSource(provider,identity,business);assert.equal(Object.keys(bundle.files).filter(name=>name.endsWith('.csv')).length,8);
   const sessions=await captureCurrentSessionSource(identity,business,query,()=>{}),combined=formatCurrentBusinessPortableSource(business,{appReleaseId:release,sourceSchemaVersion:135},identity,sessions,provider);
   const manifest=JSON.parse(combined.manifest);assert.equal(manifest.providerSources.length,8);assert.equal(manifest.providerRecordCount,provider.recordCount);assert.equal(manifest.completeBackup,false);
   const attachments=JSON.parse(Buffer.from(combined.files['attachment_inventory.json']).toString());assert.equal(attachments.availableCount,1);assert.equal(attachments.pendingCount,0);assert.equal(attachments.attachments[0].attachmentId,receiptId);assert.equal(attachments.attachments[0].original.sha256,sha(originalBytes));assert.equal(attachments.attachments[0].original.path,`attachments/${receiptId}/${receiptId}.png`);assert.equal(attachments.originalBytesIncluded,false);
   const neutral=await sandbox.connect(await sandbox.database());await neutral.query('SET standard_conforming_strings = off');
   const sql=Buffer.from(combined.files['business_records_reimport.txt']).toString();await neutral.query(sql);
   const imported=(await neutral.query('SELECT source_name,row_count FROM crest_portable_source._crest_export ORDER BY source_name')).rows;
   assert.equal(imported.length,179,'all business, identity, session and provider source tables are imported');
   for(const source of provider.sources){
    const rows=(await neutral.query('SELECT * FROM crest_portable_source."'+source.source.replace('.','_')+'" ORDER BY ARRAY['+source.primaryKey.map(column=>'"'+column+'"').join(',')+'] COLLATE "C"')).rows;
    assert.deepEqual(rows,source.rows,'neutral reimport preserves every provider cell');
   }
   await assert.rejects(neutral.query(sql),{code:'42P06'});await neutral.query('ROLLBACK');assert.equal((await neutral.query('SELECT count(*)::integer AS n FROM crest_portable_source._crest_export')).rows[0].n,179,'existing imported source is not overwritten');
  }finally{await reader.query('ROLLBACK');}
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await assert.rejects(call(reader,'provider_source_page_v1',[owner.business,foreign.actor,foreign.auth()[3],pageArgs[3],null,null,100]),{code:'42501'});}finally{await reader.query('ROLLBACK');}
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
