import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { parseInvoicePreparation } from '../../src/bookkeeping/invoice-preparation-contract.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { requireSyntheticFinanceAccountConfiguration } from '../../scripts/synthetic-migrations.mjs';
import { backupLegacy75Database, backupLegacy74Database, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreLegacy75Database, restoreLegacy74Database } from '../support/recovery-drill.mjs';

async function call(connection, command, args) {
  const placeholders = args.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + command + '(' + placeholders + ') AS value', args)).rows[0].value;
}

test('invoice preparation reads retained completed portions, including literal zero', { timeout:180000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database(), admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin,target);
    const prior = await sandbox.apply(target,await sandbox.prefix(74));
    assert.equal(prior.history.length,74);
    const web = await sandbox.connect(target), finance = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const fixture = createConfirmedBookingFixture({client:admin,web,bootstrap});
    const owner = await fixture(null,{paidLineDiscount:{kind:'fixed',cents:'5000'}});
    const foreign = await fixture();
    const booking = confirmedBookingRequest(owner);
    const booked = await call(web,'book_job',[...owner.auth(),owner.epoch,booking.operationId,1,booking.jobId,booking.expectedModeSequence,booking.payload]);
    assert.equal(booked.state,'committed');
    await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
      SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
    await assert.rejects(requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true,true,true),
      {message:'SYNTHETIC_FINANCE_ACCOUNT_MIGRATION_REQUIRED'});
    const before = await inventory(admin);
    const schema75 = await sandbox.prefix(75);
    const adopted = await sandbox.apply(target,schema75);
    assert.equal(adopted.history.length,75);
    assert.deepEqual(adopted.history.slice(0,74),prior.history);
    assert.deepEqual((await sandbox.apply(target,schema75)).history,adopted.history);
    const retained = rows => rows.filter(row=>row.schema!=='supabase_migrations');
    assert.deepEqual(retained(await inventory(admin)),retained(before));
    await requireSyntheticFinanceAccountConfiguration(target,owner.business,true,true,true,true);
    const read = (principal, client=finance) => call(client,'read_invoice_preparation',[...principal.auth(),booking.jobId]);
    assert.deepEqual(await read(owner),{state:'work_not_completed'});
    assert.deepEqual(await read(foreign),{state:'absent'});
    await assert.rejects(read(owner,web),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.work_scope_outcomes'),{code:'42501'});
    const restricted = await sandbox.connect(target);
    try {
      await restricted.query('SET ROLE crest_finance_account_owner');
      await assert.rejects(restricted.query('SELECT work_location_snapshot FROM crest.jobs'),{code:'42501'});
      await assert.rejects(restricted.query('SELECT customer_snapshot FROM crest.agreements'),{code:'42501'});
    } finally { await restricted.end(); }

    const start = await call(web,'change_field_session',[...owner.auth(),owner.epoch,randomUUID(),1,
      booking.jobId,'1',{action:'direct_arrive',reason:'Fictional on-site arrival'}]);
    assert.equal(start.state,'committed');
    const completion = await call(web,'read_job_completion_context',[...owner.auth(),booking.jobId]);
    const scope = completion.assignments.map(row => {
      const initial = {partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,
        grossInclusiveCents:row.grossInclusiveCents,discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null};
      const pieces = row.amountCents==='0'?[initial]:[
        {...initial,scopeDescription:'Completed fictional portion',grossInclusiveCents:'12500',discountInclusiveCents:'2500',amountCents:'10000'},
        {...initial,partitionId:randomUUID(),outcome:'unfulfilled',scopeDescription:'Unperformed fictional portion',
          grossInclusiveCents:'12500',discountInclusiveCents:'2500',amountCents:'10000',reason:'Fictional weather interruption'},
      ];
      return {assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,pieces};
    });
    const saved = await call(web,'complete_job',[...owner.auth(),owner.epoch,randomUUID(),1,booking.jobId,start.receipt.jobVersion,{
      scope,reason:'Fictional partial work',walkthrough:{state:'done',reason:null},
      review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],
        expectedCustomerVersion:'1',contactReviewReason:null},
    }]);
    assert.equal(saved.state,'committed');
    assert.equal(saved.receipt.completionOutcome,'partial');

    const beforeRead = await inventory(admin);
    const data = await read(owner);
    assert.deepEqual(await inventory(admin),beforeRead);
    const parsed = parseInvoicePreparation(data,owner.business,booking.jobId);
    assert.equal(parsed.state,'ready');
    assert.equal(parsed.customerId,owner.customer);
    assert.equal(parsed.completionOutcome,'partial');
    assert.equal(parsed.lines.length,2);
    assert(parsed.lines.every(row=>row.agreementId===owner.agreementId));
    assert.deepEqual(parsed.lines.map(row=>row.inclusiveCents).sort(),['0','10000']);
    assert.deepEqual(parsed.lines.map(row=>row.vehicleId).filter(Boolean),[owner.vehicle]);
    assert(parsed.lines.every(row=>!row.description.includes('Unperformed')));
    assert.deepEqual(await read(foreign),{state:'absent'});
    await assert.rejects(call(finance,'read_invoice_preparation',
      [...foreign.auth().slice(0,7),owner.business,booking.jobId]),{code:'42501'});
    const liveAuth=owner.auth();
    liveAuth[0]=Buffer.alloc(32);
    await assert.rejects(call(finance,'read_invoice_preparation',[...liveAuth,booking.jobId]),{code:'42501'});
    const forged = structuredClone(data);
    forged.lines[0].inclusiveCents='1';
    assert.throws(()=>parseInvoicePreparation(forged,owner.business,booking.jobId),{message:'INVOICE_PREPARATION_REVIEW_REQUIRED'});
    assert.throws(()=>parseInvoicePreparation(data,foreign.business,booking.jobId),{message:'INVOICE_PREPARATION_REVIEW_REQUIRED'});

    const directory = await privateWorkspace(), point = join(directory,'point');
    let destination, restored;
    try {
      await mkdir(point,{mode:0o700});
      const keys = await keyPair(directory);
      await assert.rejects(backupLegacy74Database(admin,target,point,keys.recipient),
        {message:'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage'});
      const {manifest} = await backupLegacy75Database(admin,target,point,keys.recipient);
      assert.equal(manifest.schemaVersion,75);
      assert.deepEqual(manifest.rows,await inventory(admin));
      destination = await recoveryCluster();
      const restoredUrl = await destination.database();
      assert.notEqual(new URL(restoredUrl).port,new URL(target).port);
      await assert.rejects(restoreLegacy74Database(point,keys.path,restoredUrl),
        {message:'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest'});
      await restoreLegacy75Database(point,keys.path,restoredUrl);
      await requireSyntheticFinanceAccountConfiguration(restoredUrl,owner.business,true,true,true,true);
      restored = await connect(restoredUrl);
      assert.deepEqual(await inventory(restored),manifest.rows);
      await restored.query('SET ROLE crest_finance_preview');
      assert.deepEqual(await read(owner,restored),data);
      assert.deepEqual(await read(foreign,restored),{state:'absent'});
    } finally {
      try { await restored?.end(); } finally {
        try { await destination?.close(); } finally {
          const actual = await realpath(directory);
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
