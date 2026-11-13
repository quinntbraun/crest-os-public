import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,realpath,rm } from 'node:fs/promises';
import { basename,dirname,join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { requireSyntheticFinanceAccountConfiguration } from '../../scripts/synthetic-migrations.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupDatabase,backupLegacy75Database,connect,inventory,keyPair,privateWorkspace,
  recoveryCluster,restoreDatabase,restoreLegacy75Database } from '../support/recovery-drill.mjs';
import { formatFinanceAccountSource,invoiceDraftSourceColumns } from '../../src/bookkeeping/finance-account-source.ts';

async function call(connection, command, args) {
  const placeholders = args.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + command + '(' + placeholders + ') AS value', args)).rows[0].value;
}

test('invoice drafts save before completion, select retained outcomes, and cancel without posting', {timeout:120000}, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database(), admin = await sandbox.connect(target);
    await sandbox.apply(target,await sandbox.prefix(0),true);
    await installProviderSchema(admin,target);
    const previous=await sandbox.apply(target,await sandbox.prefix(75));
    assert.equal(previous.history.length,75);

    const web=await sandbox.connect(target), finance=await sandbox.connect(target), peer=await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    const bootstrap=(await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner=createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner=await makeOwner(), foreign=await makeOwner(), booking=confirmedBookingRequest(owner);
    const draft=randomUUID(), due='2027-01-10';
    assert.equal((await call(web,'book_job',[...owner.auth(),owner.epoch,booking.operationId,1,booking.jobId,
      booking.expectedModeSequence,booking.payload])).state,'committed');
    await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
      SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
    await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true,true,true,true),
      {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
    const before=await inventory(admin), schema76=await sandbox.prefix(76);
    const adopted=await sandbox.apply(target,schema76);
    assert.equal(adopted.history.length,76);
    await requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true,true,true,true);
    assert.deepEqual(adopted.history.slice(0,75),previous.history);
    assert.deepEqual((await sandbox.apply(target,schema76)).history,adopted.history);
    const after=await inventory(admin);
    const retained=rows=>rows.filter(row=>row.schema!=='supabase_migrations'&&row.name!=='invoice_draft_revisions');
    assert.deepEqual(retained(after),retained(before));
    assert.equal(after.find(row=>row.schema==='crest'&&row.name==='invoice_draft_revisions').rows,0);
    const save=(version,{operation=randomUUID(),job=booking.jobId,dueOn=null,outcomes=[],reason=null,client=finance,principal=owner}={})=>
      call(client,'save_invoice_draft',[...principal.auth(),principal.epoch,operation,draft,version,job,dueOn,outcomes,reason]);
    const read=(version=null,principal=owner,client=finance)=>call(client,'read_invoice_draft',[...principal.auth(),draft,version]);
    const lookup=(operation,version,principal=owner)=>call(finance,'lookup_invoice_draft_operation',
      [...principal.auth(),operation,principal.epoch,draft,version,booking.jobId]);
    const retire=(operation,version)=>call(finance,'retire_invoice_draft_operation',
      [...owner.auth(),owner.epoch,operation,owner.epoch,draft,version,booking.jobId,'Fictional lost draft review']);
    const list=(after=null,principal=owner)=>call(finance,'list_invoice_drafts',[...principal.auth(),booking.jobId,after]);
    assert.deepEqual((await list()).rows,[]);
    assert.deepEqual(await read(),{state:'absent'});
    await assert.rejects(read(null,owner,web),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.invoice_draft_revisions'),{code:'42501'});
    await assert.rejects(save('0',{outcomes:[randomUUID()]}),{message:'INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED'});
    const firstOperation=randomUUID(), first=await save('0',{operation:firstOperation});
    assert.equal(first.state,'committed');
    assert.equal(first.receipt.dueOn,null);
    assert.equal(first.receipt.lineCount,0);
    assert.deepEqual(await save('0',{operation:firstOperation}),first);
    assert.deepEqual(await save('0',{operation:firstOperation,dueOn:due}),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(firstOperation,'0'),first);
    assert.deepEqual(await lookup(firstOperation,'1'),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(firstOperation,'0',foreign),{state:'absent'});
    assert.deepEqual((await list()).rows,[first.receipt]);
    assert.deepEqual((await list(draft)).rows,[]);
    assert.deepEqual((await list(null,foreign)).rows,[]);
    assert.deepEqual(await read(null,foreign),{state:'absent'});
    await assert.rejects(save('0',{principal:foreign}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    const missing=randomUUID();
    assert.deepEqual(await retire(firstOperation,'0'),first);
    assert.deepEqual(await lookup(missing,'1'),{state:'absent'});
    const closed=await retire(missing,'1');
    assert.equal(closed.state,'retired');
    assert.deepEqual(await lookup(missing,'1'),closed);
    assert.deepEqual(await retire(missing,'1'),closed);
    assert.deepEqual(await save('1',{operation:missing,dueOn:due}),{state:'conflict',reason:'operation'});
    await assert.rejects(call(finance,'save_invoice_draft',[...owner.auth(),randomUUID(),firstOperation,draft,'0',booking.jobId,null,[],null]),
      {message:'RECOVERY_REVIEW_REQUIRED'});
    const started=await call(web,'change_field_session',[...owner.auth(),owner.epoch,randomUUID(),1,
      booking.jobId,'1',{action:'direct_arrive',reason:'Fictional arrival'}]);
    const context=await call(web,'read_job_completion_context',[...owner.auth(),booking.jobId]);
    const scope=context.assignments.map(row=>({
      assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,
      pieces:[{partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,
        grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null}],
    }));
    const completed=await call(web,'complete_job',[...owner.auth(),owner.epoch,randomUUID(),1,booking.jobId,started.receipt.jobVersion,{
      scope,reason:'Fictional work completed',walkthrough:{state:'done',reason:null},
      review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],
        expectedCustomerVersion:'1',contactReviewReason:null},
    }]);
    assert.equal(completed.state,'committed');
    const {lines}=await call(finance,'read_invoice_preparation',[...owner.auth(),booking.jobId]);
    assert(lines.some(line=>line.inclusiveCents==='0'));
    const outcomes=lines.map(line=>line.outcomeId);
    const raceOperation=randomUUID();
    const race=await Promise.all([save('0',{operation:raceOperation,job:booking.jobId}),retire(raceOperation,'0')]);
    assert.equal(race[1].state,'retired');
    assert.equal(race[0].state,'conflict');
    assert(['revision','operation'].includes(race[0].reason));
    assert.deepEqual(await lookup(raceOperation,'0'),race[1]);
    await assert.rejects(save('1',{outcomes:[outcomes[0],outcomes[0]]}),{message:'INVOICE_DRAFT_INPUT_REQUIRED'});
    await assert.rejects(save('1',{outcomes:[outcomes[0],randomUUID()]}),{message:'INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED'});
    const outcomesBySave=await Promise.all([save('1',{dueOn:due,outcomes}),save('1',{dueOn:due,outcomes,client:peer})]);
    assert.equal(outcomesBySave.filter(result=>result.state==='committed').length,1);
    assert.deepEqual(outcomesBySave.find(result=>result.state==='conflict'),{state:'conflict',reason:'revision',currentRevision:'2'});
    const current=await read();
    assert.equal(current.receipt.revision,'2');
    assert.equal(current.receipt.dueOn,due);
    assert.deepEqual(current.lines,lines);
    assert.deepEqual((await read('1')).receipt,first.receipt);
    const cancelled=await save('2',{reason:'Fictional duplicate draft'});
    assert.equal(cancelled.receipt.state,'cancelled');
    assert.deepEqual((await list()).rows,[cancelled.receipt]);
    assert.deepEqual(await lookup(firstOperation,'0'),first);
    assert.equal(cancelled.receipt.dueOn,due);
    assert.deepEqual((await read()).lines,lines);
    assert.deepEqual(await save('3',{dueOn:due,outcomes}),{state:'conflict',reason:'revision',currentRevision:'3'});
    await assert.rejects(admin.query('DELETE FROM crest.invoice_draft_revisions WHERE draft_id=$1',[draft]),{code:'55000'});
    assert.deepEqual(await read('3'),await read());
    assert.equal((await list()).hasMore,false);
    const count=await admin.query("SELECT count(*)::int n FROM crest_private.audit_events WHERE entity_kind='invoice_draft_revisions' AND entity_id=$1",[draft]);
    assert.equal(count.rows[0].n,3);
    const financialTables=await admin.query("SELECT to_regclass('crest.invoices') invoice, to_regclass('crest.journal_lines') journal");
    assert.deepEqual(financialTables.rows[0],{invoice:null,journal:null});
    const columnList=(await admin.query("SELECT attname FROM pg_attribute WHERE attrelid='crest.invoice_draft_revisions'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows.map(row=>row.attname);
    assert.deepEqual(columnList,[...invoiceDraftSourceColumns]);
    const readSource=async db=>(await db.query(`SELECT to_jsonb(d)||jsonb_build_object(
      'revision',revision::text,'previous_revision',previous_revision::text,
      'selected_outcomes',to_jsonb(selected_outcomes)::text,'retained_lines',retained_lines::text,
      'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS row
      FROM crest.invoice_draft_revisions d WHERE business_id=$1`,[owner.business])).rows.map(row=>row.row);
    const exported=await readSource(admin);
    const source={businessId:owner.business,snapshotToken:'a'.repeat(64),
      rows:{accounts:[],account_versions:[]},expectedCounts:{accounts:0,account_versions:0}};
    const bundle=formatFinanceAccountSource({...source,invoiceDraftSnapshot:{rows:exported,expectedCount:3}});
    const manifest=JSON.parse(bundle.manifest);
    assert.equal(manifest.recordCounts.invoice_draft_revisions,3);
    assert.equal(manifest.completePortableExport,false);
    const dictionary=bundle.files.find(file=>file.name==='invoice_draft_revisions_dictionary.json');
    assert.deepEqual(JSON.parse(dictionary.content).json,['selected_outcomes','retained_lines']);
    const altered=exported.map(row=>row.revision==='3'?{...row,due_on:null}:row);
    assert.throws(()=>formatFinanceAccountSource({...source,invoiceDraftSnapshot:{rows:altered,expectedCount:3}}),
      {message:'FINANCE_ACCOUNT_SOURCE_REVIEW_REQUIRED'});
    const directory=await privateWorkspace(),point=join(directory,'point');
    let destination,restored;
    try {
      await mkdir(point,{mode:0o700});
      const keys=await keyPair(directory);
      await assert.rejects(backupLegacy75Database(admin,target,point,keys.recipient),{message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
      const {manifest}=await backupDatabase(admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,76);
      assert.equal(manifest.rows.find(row=>row.schema==='crest'&&row.name==='invoice_draft_revisions').rows,3);
      destination=await recoveryCluster();
      const restoredUrl=await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      await assert.rejects(restoreLegacy75Database(point,keys.path,restoredUrl),{message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
      await restoreDatabase(point,keys.path,restoredUrl);
      restored=await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      assert.deepEqual(formatFinanceAccountSource({...source,invoiceDraftSnapshot:{rows:await readSource(restored),expectedCount:3}}),bundle);
      await restored.query('SET ROLE crest_finance_preview');
      assert.deepEqual(await read(null,owner,restored),await read());
      assert.deepEqual(await call(restored,'lookup_invoice_draft_operation',
        [...owner.auth(),missing,owner.epoch,draft,'1',booking.jobId]),closed);
    } finally {
      try { await restored?.end(); } finally {
        try { await destination?.close(); } finally {
          const actual=await realpath(directory);
          assert.equal(dirname(actual),await realpath('.local/recovery-drill'));
          assert.match(basename(actual),/^case-[a-z0-9]+$/i);
          await rm(actual,{recursive:true,force:true});
        }
      }
    }
  } finally {
    try { await sandbox?.close(); } finally { await cluster.close(); }
  }
});
