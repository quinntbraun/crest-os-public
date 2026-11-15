import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {createConfirmedBookingFixture} from '../support/confirmed-booking-fixture.mjs';
import {migrationSandbox} from '../support/migration-sandbox.mjs';
import {installProviderSchema} from '../support/provider-schema.mjs';
import {backupOpeningReceivablesDatabase,connect,keyPair,recoveryCluster,restoreOpeningReceivablesDatabase} from '../support/recovery-drill.mjs';

async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query(`SELECT crest_commands.${name}(${args}) AS value`,values)).rows[0].value;
}

test('registered opening receivables preserve audited revisions through independent encrypted recovery',{timeout:240000},async()=>{
 const cluster=await recoveryCluster();
 let sandbox;
 try{
  sandbox=await migrationSandbox(cluster.testDatabaseUrl);
  const target=await sandbox.database(),admin=await sandbox.connect(target);
  await sandbox.apply(target,await sandbox.prefix(0),true);
  await installProviderSchema(admin,target);
  assert.equal((await sandbox.apply(target,await sandbox.prefix(105))).history.length,105);
  const finance=await sandbox.connect(target),web=await sandbox.connect(target);
  await finance.query('SET ROLE crest_finance_preview');await web.query('SET ROLE crest_web');
  const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
  const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
  const owner=await makeOwner(),other=await makeOwner();
  await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
   SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
  const auth=()=>[...owner.auth(),owner.epoch];
  const review='review_fictional_opening_receivables';
  await assert.rejects(command(finance,review,[...auth(),'1',[owner.customer]]),{message:'OPENING_WORKSHEET_REVISION_CONFLICT'});
  const unknown={state:'unknown',evidence:null,note:'Fictional opening control remains unknown'};
  const body={cutoverOn:'2026-06-01',cutoverAt:'2026-06-01T00:00:00Z',
   source:{reference:'Fictional boundary evidence',sha256:'9'.repeat(64)},equityBasis:'Fictional incomplete worksheet',banks:[],
   controls:Object.fromEntries(['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'].map(key=>[key,unknown]))};
  const original=await command(finance,'save_fictional_opening_worksheet',[...auth(),randomUUID(),'0',body]);
  assert.equal(original.state,'committed');
  const before=(await admin.query(`SELECT
   (SELECT count(*)::int FROM crest.journal_entries) AS journals,
   (SELECT count(*)::int FROM crest.receivable_items) AS receivables,
   (SELECT count(*)::int FROM crest_private.operations) AS operations,
   (SELECT count(*)::int FROM crest_private.audit_events) AS audits`)).rows;
  assert.deepEqual(await command(finance,review,[...auth(),'1',[owner.customer]]),{
   schemaVersion:1,businessId:owner.business,revision:'1',worksheetRevisionId:original.receipt.worksheetRevisionId,cutoverOn:'2026-06-01',
  });
  await assert.rejects(command(web,review,[...auth(),'1',[owner.customer]]),{code:'42501'});
  await assert.rejects(command(finance,review,[...owner.auth(),randomUUID(),'1',[owner.customer]]),{message:'RECOVERY_REVIEW_REQUIRED'});
  await assert.rejects(command(finance,review,[...auth(),'1',[other.customer]]),{message:'OPENING_RECEIVABLES_CUSTOMER_REQUIRED'});
  await assert.rejects(command(finance,review,[...auth(),'1',[owner.customer,randomUUID()]]),{message:'OPENING_RECEIVABLES_CUSTOMER_REQUIRED'});
  await assert.rejects(command(finance,review,[...auth(),'1',[]]),{message:'OPENING_RECEIVABLES_EVIDENCE_REQUIRED'});
  assert.deepEqual((await admin.query(`SELECT
   (SELECT count(*)::int FROM crest.journal_entries) AS journals,
   (SELECT count(*)::int FROM crest.receivable_items) AS receivables,
   (SELECT count(*)::int FROM crest_private.operations) AS operations,
   (SELECT count(*)::int FROM crest_private.audit_events) AS audits`)).rows,before);
  const newRevision=await command(finance,'save_fictional_opening_worksheet',[...auth(),randomUUID(),'1',body]);
  assert.equal(newRevision.receipt.revision,'2');
  await assert.rejects(command(finance,review,[...auth(),'1',[owner.customer]]),{message:'OPENING_WORKSHEET_REVISION_CONFLICT'});

  const save='save_fictional_opening_ar_schedule',read='read_fictional_opening_ar_schedule',lookup='lookup_fictional_opening_ar_save',
   retire='retire_fictional_opening_ar_save';
  const evidence={reference:'Fictional evidence of original invoice',sha256:'1'.repeat(64)};
  const payment={kind:'payment',appliedOn:'2026-05-31',amountCents:'2450',evidence:{reference:'Fictional cleared part payment',sha256:'2'.repeat(64)}};
  const item={customerId:owner.customer,legacyReference:'LEGACY-150',scope:'Fictional recorded original service',
   chargedOn:'2026-05-15',originalDueOn:'2026-06-10',originalCents:'15000',remainingCents:'12550',chargeEvidence:evidence,
   reductions:[payment],taxEvidence:null};
  const reason='Fictional reviewed remaining receivable';
  const args=(operation,worksheet='2',expected='0',rows=[item],why=reason)=>[...auth(),operation,worksheet,expected,JSON.stringify(rows),why];
  assert.deepEqual((await command(finance,read,[...auth(),'2'])).schedule,null);
  await assert.rejects(command(web,save,args(randomUUID())),{code:'42501'});
  await assert.rejects(command(finance,save,args(randomUUID(),'1')),{message:'OPENING_WORKSHEET_REVISION_CONFLICT'});
  await assert.rejects(command(finance,save,args(randomUUID(),'2','1')),{message:'OPENING_AR_REVISION_CONFLICT'});
  await assert.rejects(command(finance,save,args(randomUUID(),'2','0',[{...item,customerId:other.customer}])),{message:'OPENING_RECEIVABLES_CUSTOMER_REQUIRED'});
  await assert.rejects(command(finance,save,args(randomUUID(),'2','0',[{...item,remainingCents:'12551'}])),{message:'OPENING_AR_BALANCE_REQUIRED'});
  await assert.rejects(command(finance,save,args(randomUUID(),'2','0',[{...item,reductions:[{...payment,appliedOn:'2026-06-01'}]}])),{message:'OPENING_AR_DATE_REQUIRED'});
  await assert.rejects(command(finance,save,args(randomUUID(),'2','0',[item,item])),{message:'OPENING_AR_DUPLICATE_EVIDENCE'});
  assert.deepEqual((await command(finance,read,[...auth(),'2'])).schedule,null);

  const firstOperation=randomUUID();
  const first=await command(finance,save,args(firstOperation));
  assert.equal(first.state,'committed');
  assert.equal(first.receipt.evidence.posted,false);
  assert.equal(first.receipt.evidence.lines[0].taxReview,'unknown');
  assert.equal(first.receipt.evidence.lines[0].originalDueOn,'2026-06-10');
  assert.equal(first.receipt.evidence.totals.remainingCents,'12550');
  assert.equal(first.receipt.worksheetRevisionId,newRevision.receipt.worksheetRevisionId);
  assert.deepEqual(await command(finance,save,args(firstOperation)),first);
  assert.deepEqual(await command(finance,lookup,[...auth(),firstOperation,owner.epoch]),first);
  assert.deepEqual(await command(finance,retire,[...auth(),firstOperation,owner.epoch,'Fictional close review']),first);
  assert.deepEqual(await command(finance,lookup,[...other.auth(),other.epoch,firstOperation,owner.epoch]),{state:'review_required'});
  assert.deepEqual(await command(finance,save,args(firstOperation,'2','0',[item],'Different evidence review')),
   {state:'conflict',reason:'operation'});
  const interrupted=randomUUID(),closeReason='Fictional original draft was unavailable';
  const retirement=[...auth(),interrupted,owner.epoch,closeReason];
  assert.deepEqual(await command(finance,lookup,[...auth(),interrupted,owner.epoch]),{state:'absent'});
  await assert.rejects(command(web,retire,retirement),{code:'42501'});
  assert.deepEqual(await command(finance,retire,retirement),{state:'retired'});
  assert.deepEqual(await command(finance,retire,retirement),{state:'retired'});
  assert.deepEqual(await command(finance,lookup,[...auth(),interrupted,owner.epoch]),{state:'retired'});
  assert.deepEqual(await command(finance,save,args(interrupted,'2','1')),{state:'retired'});
  assert.deepEqual(await command(finance,lookup,[...auth(),interrupted,randomUUID()]),{state:'conflict',reason:'operation'});
  const closedAudit=(await admin.query('SELECT action,reason FROM crest_private.audit_events WHERE operation_id=$1',[interrupted])).rows;
  assert.deepEqual(closedAudit,[{action:'retire',reason:closeReason}]);
  const revisedRows=[{...item,taxEvidence:{reference:'Fictional tax evidence subsequently found',sha256:'3'.repeat(64)}}];
  const second=await command(finance,save,args(randomUUID(),'2','1',revisedRows));
  assert.equal(second.receipt.revision,'2');
  assert.equal(second.receipt.evidence.lines[0].taxReview,'source_recorded');
  assert.deepEqual((await command(finance,read,[...auth(),'2'])).schedule,second.receipt);
  const currentAudit=(await admin.query('SELECT delta FROM crest_private.audit_events WHERE id=$1',[second.receipt.auditEventId])).rows[0].delta;
  assert.deepEqual(currentAudit,{schemaVersion:1,before:first.receipt,after:second.receipt});
  await assert.rejects(admin.query('DELETE FROM crest.opening_receivable_schedule_revisions'),{code:'55000'});
  const freshWorksheet=await command(finance,'save_fictional_opening_worksheet',[...auth(),randomUUID(),'2',body]);
  assert.equal(freshWorksheet.receipt.revision,'3');
  assert.equal((await command(finance,read,[...auth(),'3'])).schedule,null);
  assert.deepEqual((await command(finance,read,[...auth(),'2'])).schedule,second.receipt);
  assert.deepEqual(await command(finance,save,args(firstOperation)),first);
  await admin.query('BEGIN');
  try{
   await admin.query(`INSERT INTO crest.opening_receivable_schedule_revisions
    (business_id,worksheet_revision_id,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
    SELECT business_id,$2,1,$3,$4,recorded_by,evidence,evidence_sha256
    FROM crest.opening_receivable_schedule_revisions WHERE operation_id=$1`,[
    firstOperation,freshWorksheet.receipt.worksheetRevisionId,freshWorksheet.receipt.operationId,freshWorksheet.receipt.auditEventId,
   ]);
   await assert.rejects(admin.query('COMMIT'),{message:'OPENING_AR_AUDIT_REQUIRED'});
  }finally{await admin.query('ROLLBACK');}
  const competitor=await sandbox.connect(target);
  await competitor.query('SET ROLE crest_finance_preview');
  const raced=await Promise.allSettled([
   command(finance,save,args(randomUUID(),'3')),
   command(competitor,save,args(randomUUID(),'3')),
  ]);
  assert.equal(raced.filter(result=>result.status==='fulfilled'&&result.value.state==='committed').length,1);
  assert.equal(raced.filter(result=>result.status==='rejected'&&result.reason.message==='OPENING_AR_REVISION_CONFLICT').length,1);
  assert.equal((await command(finance,read,[...auth(),'3'])).schedule.revision,'1');
  assert.deepEqual((await admin.query(`SELECT
   (SELECT count(*)::int FROM crest.journal_entries) AS journals,
   (SELECT count(*)::int FROM crest.receivable_items) AS receivables`)).rows,[{journals:0,receivables:0}]);
  const snapshot='opening_receivables_source_snapshot';
  async function capture(connection,business){
   await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   try{
    await connection.query('SET LOCAL ROLE crest_export');
    return await command(connection,snapshot,[business]);
   }finally{await connection.query('ROLLBACK');}
  }
  await assert.rejects(command(finance,snapshot,[owner.business]),{code:'42501'});
  const exported=await capture(admin,owner.business);
  assert.equal(exported.revisions.length,3);
  assert.deepEqual((await capture(admin,other.business)).revisions,[]);
  const point=join(sandbox.workspace,'opening-ar-point'),keys=await keyPair(sandbox.workspace);
  await mkdir(point,{mode:0o700});
  const {manifest}=await backupOpeningReceivablesDatabase(admin,target,point,keys.recipient);
  assert.equal(manifest.schemaVersion,105);
  const recovery=await recoveryCluster();
  let restored;
  try{
   const recoveryUrl=await recovery.database();
   assert.notEqual(new URL(recoveryUrl).port,new URL(target).port);
   assert.deepEqual(await restoreOpeningReceivablesDatabase(point,keys.path,recoveryUrl),manifest);
   restored=await connect(recoveryUrl);
   assert.deepEqual(await capture(restored,owner.business),exported);
   await restored.query('SET ROLE crest_finance_preview');
   assert.deepEqual((await command(restored,read,[...auth(),'2'])).schedule,second.receipt);
  }finally{try{await restored?.end();}finally{await recovery.close();}}
 }finally{try{await sandbox?.close();}finally{await cluster.close();}}
});
