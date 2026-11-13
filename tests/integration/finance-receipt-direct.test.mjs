import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { financeReceipt78Candidate } from '../support/finance-receipt78-candidate.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupLegacy77Database, backupDatabase, connect, inventory, keyPair, privateWorkspace,
  recoveryCluster, restoreLegacy77Database, restoreDatabase } from '../support/recovery-drill.mjs';
import { captureInvoiceSource } from '../../src/bookkeeping/invoice-source.ts';
import { captureReceiptSource, formatReceiptSource, receiptSourceAddedColumns, receiptSourceCoverage } from '../../src/bookkeeping/receipt-source.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';

async function command(connection, name, values) {
  const parameters = values.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + name + '(' + parameters + ') AS value', values)).rows[0].value;
}

async function commit(connection, name, values) {
  const result = await command(connection, name, values);
  assert.equal(result.state, 'committed', JSON.stringify(result));
  return result.receipt;
}

async function issueInvoice({ admin, web, finance, makeOwner }, previous = null) {
  const service = previous?.service ?? randomUUID();
  const owner = await makeOwner(previous?.owner, { customerId: previous?.owner.customer,
    serviceVersionFor: async (principal, auth) => {
    if (!previous) {
    await commit(web, 'save_service', [...auth(), principal.epoch, randomUUID(), 1, service, '0', {
      code: 'fictional-detail', active: true,
      definition: { name: 'Fictional detail', inclusions: 'Interior', exclusions: '', internalGuidance: null,
        rangeLowCents: null, rangeHighCents: null, estimatedSeconds: null },
    }]);
    }
    return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',
      [principal.business, service])).rows[0].id;
  } });
  if (!previous) {
    await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
      SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`, [owner.business, owner.actor]);
  }
  const mutate = () => [...owner.auth(), owner.epoch, randomUUID()];
  const booking = confirmedBookingRequest(owner);
  if (previous) {
    booking.expectedModeSequence=(await admin.query(
      'SELECT max(sequence)::text AS current FROM crest.fulfillment_mode_versions WHERE business_id=$1',[owner.business])).rows[0].current;
    const appointmentDay=previous.invoice.invoiceNumber.endsWith('-1')?'2026-11-04':'2026-11-05';
    Object.assign(booking.payload.appointment,{start_at:appointmentDay+'T10:00:00.123456Z',end_at:appointmentDay+'T11:00:00.123456Z',
      local_start:appointmentDay+'T10:00:00.123456',local_end:appointmentDay+'T11:00:00.123456'});
  }
  await commit(web, 'book_job', [...owner.auth(), owner.epoch, booking.operationId, 1, booking.jobId,
    booking.expectedModeSequence, booking.payload]);
  const arrived = await commit(web, 'change_field_session', [...mutate(), 1, booking.jobId, '1',
    { action: 'direct_arrive', reason: 'Fictional arrival' }]);
  const { assignments } = await command(web, 'read_job_completion_context', [...owner.auth(), booking.jobId]);
  const scope = assignments.map(row => ({
    assignedPartId: row.assignedPartId, expectedPlanId: row.planId, expectedPlanSequence: row.planSequence,
    pieces: [{ partitionId: row.partitionId, outcome: 'completed', scopeDescription: row.scopeDescription,
      grossInclusiveCents: row.grossInclusiveCents, discountInclusiveCents: row.discountInclusiveCents,
      amountCents: row.amountCents, reason: null }],
  }));
  await commit(web, 'complete_job', [...mutate(), 1, booking.jobId, arrived.jobVersion, {
    scope, reason: 'Fictional completion', walkthrough: { state: 'done', reason: null },
    review: { reviewUrl: null, skipReason: null, additionalRequestReason: null, expectedDuplicateRequestIds: [],
      expectedCustomerVersion: '1', contactReviewReason: null },
  }]);
  const draft = randomUUID();
  const { lines } = await command(finance, 'read_invoice_preparation', [...owner.auth(), booking.jobId]);
  await commit(finance, 'save_invoice_draft', [...mutate(), draft, '0', booking.jobId, null, lines.map(line => line.outcomeId), null]);
  const district = 'Fictional ledger dispatch district';
  if (!previous) {
  await commit(finance, 'approve_finance_tax_profile', [...mutate(), district, 'service', service, '0', '2026-01-01',
    'non_taxable', null, 'Fictional evidence', 'Fictional approval']);
  for (const identity of [
    { code: '1100', accountType: 'asset', normalSide: 'debit', controlKind: 'ar', reportRole: 'ar' },
    { code: '4000', accountType: 'revenue', normalSide: 'credit', controlKind: null, reportRole: 'service_revenue' },
  ]) {
    const account = randomUUID();
    await commit(finance, 'save_finance_account', [...mutate(), 1, account, '0',
      { identity, name: 'Fictional ' + identity.reportRole, active: true, reason: null }]);
    await commit(finance, 'approve_fixed_finance_mapping',
      [...mutate(), identity.reportRole, '0', account, '2026-01-01', 'Fictional fixed account approval']);
  }
  await commit(finance, 'configure_fictional_invoice_setup',
    [...mutate(), { kind: 'invoice_series', label: 'TEST-DISPATCH', reason: 'Fictional numbering approval' }]);
  const { rows: [{ today }] } = await admin.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS today");
  await commit(finance, 'configure_fictional_invoice_setup',
    [...mutate(), { kind: 'accounting_period', startsOn: today, reason: 'Fictional period approval' }]);
  }
  const selection = Object.fromEntries(lines.map(line => [line.outcomeId, district]));
  const { reviewDigest } = await command(finance, 'prepare_reviewed_invoice_issue', [...owner.auth(), draft, '1', selection]);
  const invoice = await commit(finance, 'issue_reviewed_invoice', [...mutate(), draft, '1', selection, reviewDigest]);
  assert.equal(invoice.totalCents, '25000');
  return { owner, invoice, draft, service };
}

async function exportRead(reader, business, collect) {
  await reader.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { return await collect(business, reader); }
  finally { await reader.query('ROLLBACK'); }
}

const invoiceSource = (reader, business) => exportRead(reader, business, (id, connection) =>
  captureInvoiceSource(id, async (sql, args) => (await connection.query(sql, args)).rows[0].result));
const receiptSource = (reader, business) => exportRead(reader, business, (id, connection) =>
  captureReceiptSource(id, async (sql, args) => (await connection.query(sql, args)).rows));

async function verifyRecovery({ candidate, admin, target, owner, invoiceAfterPayments, captured, prior, original, first, retired }) {
  const directory = await privateWorkspace();
  const point = join(directory, 'point');
  let destination;
  let restored;
  let reader;
  let finance;
  try {
    await mkdir(point, { mode: 0o700 });
    const keys = await keyPair(directory);
    await assert.rejects(backupLegacy77Database(admin, target, point, keys.recipient),
      { message: 'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage' });
    const { manifest } = await backupDatabase(admin, target, point, keys.recipient);
    assert.equal(manifest.schemaVersion, 78);
    assert.equal(manifest.heldReceiptMigrationSha256, undefined);
    assert.equal(manifest.registrySha256, candidate.registrySha256);
    assert.equal(manifest.completeBackup, false);
    for (const { table } of receiptSourceCoverage) {
      const group = table.split('.')[1];
      assert.equal(manifest.rows.find(row => row.schema === 'crest' && row.name === group).rows, Number(captured.counts[group]));
    }
    destination = await recoveryCluster();
    const url = await destination.database();
    assert.notEqual(new URL(url).port, new URL(target).port);
    restored = await connect(url);
    await assert.rejects(restoreLegacy77Database(point, keys.path, url), { message: 'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest' });
    assert.deepEqual(await inventory(restored), []);
    assert.deepEqual(await restoreDatabase(point, keys.path, url), manifest);
    assert.deepEqual(await inventory(restored), manifest.rows);

    reader = await connect(url);
    await reader.query('SET ROLE crest_export');
    const received = await receiptSource(reader, owner.business);
    assert.notEqual(received.snapshotToken, captured.snapshotToken);
    assert.deepEqual(received.counts, captured.counts);
    assert.deepEqual(received.rows, captured.rows);
    assert.deepEqual(received.history, captured.history);
    assert.deepEqual((await invoiceSource(reader, owner.business)).rows, invoiceAfterPayments.rows);
    const immutableFiles = source => formatReceiptSource(source).files.filter(file =>
      file.name.endsWith('.csv') || file.name.endsWith('.ndjson'));
    assert.deepEqual(immutableFiles(received), immutableFiles(captured));

    const epoch = randomUUID(), session = randomUUID(), provider = randomUUID(), credential = randomBytes(32);
    await restored.query('BEGIN');
    try {
      await restored.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE', [owner.business]);
      await restored.query(`UPDATE crest_private.business_recovery_authorities
        SET active_epoch=$2,incident_id=$3,writes_enabled=false,version=version+1 WHERE business_id=$1`, [owner.business, epoch, randomUUID()]);
      await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
      await restored.query('DELETE FROM auth.sessions');
      await restored.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
        [provider, owner.subject]);
      await restored.query(`WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second' AS stamp)
        INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,
          authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
        SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id
        FROM crest_private.actors CROSS JOIN observed WHERE id=$2`, [session, owner.actor, provider, credential, randomBytes(32)]);
      await restored.query('COMMIT');
    } catch (error) {
      await restored.query('ROLLBACK');
      throw error;
    }
    finance = await connect(url);
    await finance.query('SET ROLE crest_finance_preview');
    const oldAuth = owner.auth();
    const fresh = [...oldAuth];
    fresh[0] = credential;
    fresh[1] = session;
    fresh[5] = provider;
    const postedOperation = captured.rows.payments.find(row => row.id === first.receipt.paymentId).operation_id;
    const lookup = (auth, operation, payment) =>
      command(finance, 'lookup_direct_fictional_receipt', [...auth, owner.epoch, operation, payment]);
    await assert.rejects(lookup(oldAuth, postedOperation, first.receipt.paymentId), { message: 'CREST_TENANT_READ_DENIED' });
    assert.deepEqual(await lookup(fresh, postedOperation, first.receipt.paymentId), first);
    assert.deepEqual(await lookup(fresh, retired.receipt.operationId, retired.receipt.paymentId), retired);
    assert.deepEqual(await command(finance, 'read_issued_invoice', [...fresh, prior.draft]), original);
    const originalInvoice = await command(finance, 'lookup_invoice_issue', [...fresh, owner.epoch,
      invoiceAfterPayments.rows.invoices.find(row => row.id === prior.invoice.invoiceId).operation_id, prior.draft, '1']);
    assert.deepEqual(originalInvoice, { state: 'committed', receipt: prior.invoice });
    await assert.rejects(command(finance, 'record_direct_fictional_receipt', [...fresh, owner.epoch, postedOperation,
      first.receipt.paymentId, owner.customer, randomUUID(), '1', first.receipt.actualOn, '10000', 'Fictional replay after recovery',
      null, null, { [prior.invoice.receivableId]: '10000' }]), { message: 'RECOVERY_REVIEW_REQUIRED' });
  } finally {
    try { await finance?.end(); }
    finally {
      try { await reader?.end(); }
      finally {
        try { await restored?.end(); }
        finally {
          try { await destination?.close(); }
          finally {
            const actual = await realpath(directory);
            assert.equal(dirname(actual), await realpath('.local/recovery-drill'));
            assert.match(basename(actual), /^case-[a-z0-9]+$/i);
            await rm(actual, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

test('registered direct receipts post reviewed allocations and preserve invoice evidence through encrypted recovery', { timeout: 180000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database();
    const admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin, target);
    await sandbox.apply(target, await sandbox.prefix(77));
    const web = await sandbox.connect(target);
    const finance = await sandbox.connect(target);
    const peer = await sandbox.connect(target);
    const exporter = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    await exporter.query('SET ROLE crest_export');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const fixture = { admin, web, finance, makeOwner };
    const prior = await issueInvoice(fixture);
    const issued = entry => command(finance, 'read_issued_invoice', [...entry.owner.auth(), entry.draft]);
    const original = await issued(prior);
    const before = await inventory(admin);
    const capture=business=>invoiceSource(exporter,business);
    const originalSource = (await capture(prior.owner.business)).rows;
    const candidate=await financeReceipt78Candidate(sandbox);
    assert((await readFile(join(candidate.directory,'supabase/migrations',candidate.file))).equals(
      await readFile(join(sandbox.root,'supabase/migrations',candidate.file))));
    const adopted=await sandbox.apply(target,sandbox.root);
    assert.equal(adopted.registrySha256,candidate.registrySha256);
    const currentInventory=await inventory(admin);
    const preserved=row=>row.schema!=='supabase_migrations'
      && !['payments','external_money_evidence','money_movements','funding_origins','funding_partitions','allocation_events',
        'financial_events','journal_lines'].includes(row.name);
    assert.deepEqual(currentInventory.filter(preserved),before.filter(preserved));
    assert.equal(currentInventory.find(row=>row.schema==='supabase_migrations'&&row.name==='schema_migrations').rows,78);
    assert.deepEqual((await capture(prior.owner.business)).rows,originalSource);
    assert.deepEqual(await issued(prior), original);
    for (const connection of [finance, web, exporter]) {
      await assert.rejects(connection.query('SELECT crest_private.verify_finance_event_posting($1,$2)',
        [prior.owner.business, randomUUID()]), { code: '42501' });
    }

    const after = await issueInvoice(fixture);
    assert.equal((await issued(after)).invoiceId, after.invoice.invoiceId);
    const { rows: [event] } = await admin.query(
      'SELECT id,group_id,period_id,effective_on,time_zone FROM crest.financial_events WHERE business_id=$1 AND invoice_id=$2',
      [after.owner.business, after.invoice.invoiceId]);
    await admin.query('SELECT crest_private.verify_finance_event_posting($1,$2)', [after.owner.business, event.id]);
    await assert.rejects(admin.query('SELECT crest_private.verify_finance_event_posting($1,$2)', [after.owner.business, randomUUID()]),
      { message: 'FINANCE_POSTING_EVENT_REQUIRED' });
    await assert.rejects(admin.query('SELECT crest_private.verify_finance_event_posting($1,$2)', [prior.owner.business, event.id]),
      { message: 'FINANCE_POSTING_EVENT_REQUIRED' });

    const insertBad = () => admin.query(`INSERT INTO crest.financial_events
      (business_id,group_id,event_sequence,invoice_id,period_id,period_generation,effective_on,time_zone,template,template_version)
      VALUES ($1,$2,2,$3,$4,0,$5,$6,'P04',1)`,
    [after.owner.business, event.group_id, after.invoice.invoiceId, event.period_id, event.effective_on, event.time_zone]);
    await assert.rejects(insertBad(), { code: '23514', constraint: 'finance_event_typed_source' });
    await admin.query('BEGIN');
    try {
      // Temporarily simulate a future template check being extended. The
      // deferred verifier still refuses unsupported events, before any commit.
      await admin.query('ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source');
      await admin.query('ALTER TABLE crest.financial_events DROP CONSTRAINT financial_events_business_id_invoice_id_key');
      await insertBad();
      await assert.rejects(admin.query('SET CONSTRAINTS ALL IMMEDIATE'), { message: 'FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED' });
    } finally { await admin.query('ROLLBACK'); }
    const { owner, invoice }=prior;
    const account=randomUUID(), channel=randomUUID();
    const change=()=>[...owner.auth(),owner.epoch,randomUUID()];
    const day=invoice.issuedOn;
    await commit(finance,'save_finance_account',[...change(),1,account,'0',{
      identity:{code:'1000',accountType:'asset',normalSide:'debit',controlKind:'bank',reportRole:'money'},
      name:'Fictional checking',active:true,reason:null,
    }]);
    const channelBody={identity:{accountId:account,kind:'bank',ownershipScope:'dedicated_business',
      providerNamespace:'fictional-bank',maskedSuffix:'1234'},label:'Fictional checking',effectiveFrom:'2026-01-01',
      ownershipEvidence:'Fictional verified business ownership',openingState:'verified_zero',openingOn:'2026-01-01',
      openingCents:'0',openingEvidence:'Fictional verified zero opening',active:true,reason:'Fictional channel review'};
    await commit(finance,'save_money_channel',[...change(),channel,'0',channelBody]);
    const options=(customer=owner.customer,connection=finance)=>command(connection,'read_direct_fictional_receipt_options',
      [...owner.auth(),customer,day]);
    await assert.rejects(options(owner.customer,web),{code:'42501'});
    assert.deepEqual(await options(randomUUID()),{state:'absent'});
    const ready=await options();
    assert.equal(ready.state,'ready');
    assert.equal(ready.channels[0].channelId,channel);
    assert.equal(ready.channels[0].version,'1');
    assert.equal(ready.receivables[0].remainingCents,'25000');
    const receipt=(cents,{operation=randomUUID(),payment=randomUUID(),identity=null,reason=null,connection=finance,
      customer=owner.customer,receivable=invoice.receivableId,applications={[receivable]:cents},
      version='1',actual=day,epoch=owner.epoch}={})=>command(connection,'record_direct_fictional_receipt',[
      ...owner.auth(),epoch,operation,payment,customer,channel,version,actual,cents,'Fictional actual credited receipt',reason,identity,applications,
    ]);
    const identity={namespace:'bank-transaction',id:'AbC-123',rawReference:'Fictional exact AbC-123'};
    await assert.rejects(receipt('1000',{connection:web}),{code:'42501'});
    await assert.rejects(receipt('1000',{epoch:randomUUID()}),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(receipt('1000',{version:'2'}),{message:'DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED'});
    await assert.rejects(receipt('1000',{actual:'9999-01-01'}),{message:'DIRECT_RECEIPT_DATE_REQUIRED'});
    await assert.rejects(receipt('1000',{applications:{[invoice.receivableId]:'900'}}),{message:'DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED'});
    await assert.rejects(receipt('1000',{receivable:after.invoice.receivableId}),{message:'DIRECT_RECEIPT_RECEIVABLE_REQUIRED'});
    await assert.rejects(receipt('1000',{customer:randomUUID()}),{message:'DIRECT_RECEIPT_RECEIVABLE_REQUIRED'});
    const key={payment:randomUUID(),operation:randomUUID(),identity};
    const lookup=(epoch=owner.epoch,operation=key.operation,payment=key.payment,connection=finance)=>
      command(connection,'lookup_direct_fictional_receipt',[...owner.auth(),epoch,operation,payment]);
    assert.deepEqual(await lookup(),{state:'absent'});
    const first=await receipt('10000',key);
    assert.equal(first.state,'committed');
    assert.equal(first.receipt.actualOn,day);
    assert.equal(first.receipt.accountId,account);
    assert.deepEqual(await lookup(),first);
    assert.deepEqual(await lookup(randomUUID()),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(owner.epoch,key.operation,randomUUID()),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookup(owner.epoch,randomUUID()),{state:'absent'});
    await assert.rejects(lookup(owner.epoch,key.operation,key.payment,web),{code:'42501'});
    assert.equal((await options()).receivables[0].remainingCents,'15000');
    const retirementKey={payment:randomUUID(),operation:randomUUID()};
    const retire=(tuple=retirementKey,epoch=owner.epoch,connection=finance)=>command(connection,'retire_direct_fictional_receipt',[
      ...owner.auth(),epoch,tuple.operation,owner.epoch,tuple.payment,'Confirmed the first attempt was absent',
    ]);
    await assert.rejects(retire(retirementKey,randomUUID()),{message:'RECOVERY_REVIEW_REQUIRED'});
    await assert.rejects(retire(retirementKey,owner.epoch,web),{code:'42501'});
    assert.deepEqual(await retire(key),first);
    const retired=await retire();
    assert.deepEqual(retired,{state:'retired',receipt:{schemaVersion:1,businessId:owner.business,
      operationId:retirementKey.operation,paymentId:retirementKey.payment,originalEpoch:owner.epoch,reviewEpoch:owner.epoch,
      reason:'Confirmed the first attempt was absent'}});
    assert.deepEqual(await retire(),retired);
    assert.deepEqual(await lookup(owner.epoch,retirementKey.operation,retirementKey.payment),retired);
    assert.deepEqual(await receipt('5000',retirementKey),{state:'conflict',reason:'operation'});
    assert.deepEqual(await receipt('10000',key),first);
    assert.deepEqual(await receipt('9999',key),{state:'conflict',reason:'operation'});
    await assert.rejects(receipt('10000',{identity}),{message:'DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED'});
    await assert.rejects(receipt('10000'),{message:'DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED'});
    assert.equal((await receipt('10000',{reason:'Confirmed independent credited transaction'})).state,'committed');
    const distinct='Two independently verified receipts reviewed';
    const parallel=await Promise.allSettled([receipt('5000',{reason:distinct}),receipt('5000',{reason:distinct,connection:peer})]);
    assert.equal(parallel.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(parallel.find(result=>result.status==='rejected').reason.message,'DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE');
    const { rows: [totals] }=await admin.query(`SELECT count(*)::int AS payments,sum(a.cents)::text AS applied
      FROM crest.allocation_events a WHERE a.business_id=$1 AND a.receivable_id=$2`,[owner.business,invoice.receivableId]);
    assert.deepEqual(totals,{payments:3,applied:'25000'});
    assert.deepEqual((await options()).receivables,[]);
    const { rows: [posting] }=await admin.query(`SELECT sum(l.debit_cents)::text AS debit,sum(l.credit_cents)::text AS credit,
      array_agg(l.purpose ORDER BY l.purpose) AS purposes FROM crest.journal_lines l
      JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
      WHERE j.business_id=$1 AND j.event_id=$2`,[owner.business,first.receipt.eventId]);
    assert.deepEqual(posting,{debit:'10000',credit:'10000',purposes:['receipt_ar','receipt_money']});
    await assert.rejects(admin.query('UPDATE crest.payments SET gross_cents=gross_cents WHERE id=$1',[first.receipt.paymentId]),{code:'55000'});
    assert.deepEqual((await capture(owner.business)).rows,originalSource);
    const secondInvoice=await issueInvoice(fixture,prior);
    const thirdInvoice=await issueInvoice(fixture,secondInvoice);
    assert.equal(secondInvoice.owner.customer,thirdInvoice.owner.customer);
    const split=await receipt('9000',{applications:{[secondInvoice.invoice.receivableId]:'4000',[thirdInvoice.invoice.receivableId]:'5000'}});
    assert.equal(split.state,'committed');
    assert.equal(split.receipt.applications.length,2);
    const { rows: [splitProof] }=await admin.query(`SELECT count(*)::int AS applications,sum(a.cents)::text AS cents
      FROM crest.allocation_events a JOIN crest.funding_partitions p ON p.business_id=a.business_id AND p.id=a.partition_id
      JOIN crest.funding_origins r ON r.business_id=p.business_id AND r.id=p.origin_id
      WHERE a.business_id=$1 AND a.event_id=$2 AND r.id=$3`,[owner.business,split.receipt.eventId,split.receipt.fundingOriginId]);
    assert.deepEqual(splitProof,{applications:2,cents:'9000'});
    assert.deepEqual((await options()).receivables.map(row=>row.remainingCents).sort(),['20000','21000']);
    await assert.rejects(admin.query(`INSERT INTO crest.payments
      (id,business_id,customer_id,channel_version_id,account_id,actual_on,gross_cents,confirmation,operation_id,created_by)
      SELECT $1,p.business_id,p.customer_id,p.channel_version_id,p.account_id,p.actual_on,1,'Forged incomplete receipt',$2,p.created_by
      FROM crest.payments p WHERE p.id=$3`,[randomUUID(),retirementKey.operation,first.receipt.paymentId]),
    {message:'DIRECT_RECEIPT_SOURCE_REQUIRED'});
    const dictionary=(await admin.query('SELECT * FROM crest_private.receipt_source_dictionary()')).rows;
    for(const group of receiptSourceCoverage){
      const fields=dictionary.find(row=>'crest.'+row.group_name===group.table).fields;
      assert.deepEqual(fields.map(field=>field.split(':')[0]),group.required);
    }
    for(const [table,columns] of Object.entries(receiptSourceAddedColumns)){
      assert.deepEqual(dictionary.find(row=>'crest.'+row.group_name===table).fields.slice(-columns.length)
        .map(field=>field.split(':')[0]),columns);
    }
    for(const connection of [web,finance]){
      await assert.rejects(command(connection,'receipt_source_snapshot_context',[owner.business]),{code:'42501'});
    }
    await assert.rejects(exporter.query('SELECT id FROM crest.payments'),{code:'42501'});
    await assert.rejects(command(exporter,'receipt_source_snapshot_context',[owner.business]),{code:'25001'});
    const invoiceAfterPayments=await capture(owner.business);
    assert.equal(invoiceAfterPayments.counts.financial_events,'3');
    assert(invoiceAfterPayments.rows.financial_events.every(event=>event.template==='P01'));

    const readSource=business=>receiptSource(exporter,business);
    const captured=await readSource(owner.business);
    assert.equal(captured.counts.payments,'4');
    assert.equal(captured.counts.external_money_evidence,'1');
    assert.equal(captured.counts.allocation_events,'5');
    assert.equal(captured.counts.journal_lines,'9');
    assert(captured.rows.financial_events.every(event=>event.template==='P03'&&event.invoice_id===null));
    assert.equal((await readSource(after.owner.business)).counts.payments,'0');
    const formatted=formatReceiptSource(captured);
    const file=name=>formatted.files.find(part=>part.name===name).content;
    for(const group of Object.keys(captured.rows)){
      const {columns}=JSON.parse(file(group+'_dictionary.json'));
      const {escapes}=JSON.parse(file(group+'_escape_map.json'));
      assert.deepEqual(readSourceExportCsv(file(group+'.csv'),escapes,{columns,maxRows:100}),captured.rows[group]);
    }
    const decodedEvidence=JSON.parse(file('operation_history.ndjson').split('\n').find(line=>line.includes(retirementKey.operation)));
    assert.equal(JSON.parse(decodedEvidence.canonical_evidence).row.command_type,'finance.receipt.retire');
    assert.equal(captured.rows.external_money_evidence[0].raw_reference,identity.rawReference);
    assert.equal(captured.rows.external_money_evidence[0].external_id,identity.id);
    assert.equal(JSON.parse(formatted.manifest).exactReceiptEffectsVerified,true);
    const damaged=structuredClone(captured);
    damaged.rows.journal_lines.find(line=>line.purpose==='receipt_ar').credit_cents='1';
    assert.throws(()=>formatReceiptSource(damaged),{message:'RECEIPT_SOURCE_REVIEW_REQUIRED'});
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assert.rejects(command(exporter,'receipt_source_snapshot_page',[owner.business,captured.snapshotToken,'payments',null,1]),
      {message:'CREST_RECEIPT_SOURCE_PAGE_REQUIRED'});
    await exporter.query('ROLLBACK');
    await verifyRecovery({candidate,admin,target,owner,invoiceAfterPayments,captured,prior,original,first,retired});
    assert.deepEqual(await issued(prior), original);
  } finally {
    try { await sandbox?.close(); }
    finally { await cluster.close(); }
  }
});
