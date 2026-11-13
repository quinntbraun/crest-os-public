import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { captureInvoiceSource, formatInvoiceSource } from '../../src/bookkeeping/invoice-source.ts';
import { readSourceExportCsv } from '../../src/security/source-export-csv-reader.ts';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { financeInvoice77Candidate } from '../support/finance-invoice77-candidate.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupDatabase, backupLegacy76Database, connect, inventory, keyPair,
  privateWorkspace, recoveryCluster, restoreDatabase, restoreLegacy76Database } from '../support/recovery-drill.mjs';

const beginSnapshot = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

async function command(connection, name, values) {
  const parameters = values.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + name + '(' + parameters + ') AS value', values)).rows[0].value;
}

async function requireCommit(connection, name, values) {
  const result = await command(connection, name, values);
  assert.equal(result.state, 'committed', JSON.stringify(result));
  return result.receipt;
}

async function postTaxableInvoice({ admin, web, finance, makeOwner, prepareOwner }) {
  const service = randomUUID();
  const owner = await makeOwner(undefined, { serviceVersionFor: async (principal, auth) => {
    await requireCommit(web, 'save_service', [...auth(), principal.epoch, randomUUID(), 1, service, '0', {
      code: 'fictional-detail', active: true,
      definition: { name: 'Fictional detail', inclusions: 'Interior', exclusions: '', internalGuidance: null,
        rangeLowCents: null, rangeHighCents: null, estimatedSeconds: null },
    }]);
    const { rows } = await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',
      [principal.business, service]);
    return rows[0].id;
  } });
  await prepareOwner(owner);
  const mutate = () => [...owner.auth(), owner.epoch, randomUUID()];
  const booking = confirmedBookingRequest(owner);
  await requireCommit(web, 'book_job', [...owner.auth(), owner.epoch, booking.operationId, 1, booking.jobId,
    booking.expectedModeSequence, booking.payload]);
  const arrived = await requireCommit(web, 'change_field_session', [...mutate(), 1, booking.jobId, '1',
    { action: 'direct_arrive', reason: 'Fictional arrival' }]);
  const completion = await command(web, 'read_job_completion_context', [...owner.auth(), booking.jobId]);
  const scope = completion.assignments.map(row => ({
    assignedPartId: row.assignedPartId, expectedPlanId: row.planId, expectedPlanSequence: row.planSequence,
    pieces: [{ partitionId: row.partitionId, outcome: 'completed', scopeDescription: row.scopeDescription,
      grossInclusiveCents: row.grossInclusiveCents, discountInclusiveCents: row.discountInclusiveCents,
      amountCents: row.amountCents, reason: null }],
  }));
  await requireCommit(web, 'complete_job', [...mutate(), 1, booking.jobId, arrived.jobVersion, {
    scope, reason: 'Fictional work completed', walkthrough: { state: 'done', reason: null },
    review: { reviewUrl: null, skipReason: null, additionalRequestReason: null, expectedDuplicateRequestIds: [],
      expectedCustomerVersion: '1', contactReviewReason: null },
  }]);
  const draft = randomUUID();
  const { lines } = await command(finance, 'read_invoice_preparation', [...owner.auth(), booking.jobId]);
  assert.equal(lines.length, 2);
  await requireCommit(finance, 'save_invoice_draft',
    [...mutate(), draft, '0', booking.jobId, null, lines.map(line => line.outcomeId), null]);

  const jurisdiction = 'Fictional source export district';
  const profile = await requireCommit(finance, 'approve_finance_tax_profile', [
    ...mutate(), jurisdiction, 'service', service, '0', '2026-01-01',
    'inclusive_single', '0.1', 'Fictional source export evidence', 'Fictional tax approval',
  ]);
  const exemptDistrict = 'Fictional source export exemption district';
  const exemptProfile = await requireCommit(finance, 'approve_finance_tax_profile', [
    ...mutate(), exemptDistrict, 'service', service, '0', '2026-01-01',
    'exempt', null, 'Fictional exemption classification', 'Fictional exemption tax approval',
  ]);
  const courtesyOutcome = lines.find(line => line.inclusiveCents === '0').outcomeId;
  const exemption = await requireCommit(finance, 'approve_invoice_exemption_evidence', [
    ...mutate(), draft, '1', courtesyOutcome, exemptDistrict, exemptProfile.id, '0', '2026-01-01', '9999-12-31',
    'Fictional retained exemption reference', 'Fictional customer and transaction review',
  ]);
  async function account(identity) {
    const id = randomUUID();
    await requireCommit(finance, 'save_finance_account', [...mutate(), 1, id, '0',
      { identity, name: 'Fictional ' + identity.reportRole, active: true, reason: null }]);
    return id;
  }
  const arAccount = await account({ code: '1100', accountType: 'asset', normalSide: 'debit', controlKind: 'ar', reportRole: 'ar' });
  const revenueAccount = await account({ code: '4000', accountType: 'revenue', normalSide: 'credit', controlKind: null, reportRole: 'service_revenue' });
  const taxAccount = await account({ code: '2100', accountType: 'liability', normalSide: 'credit', controlKind: 'tax_payable', reportRole: 'tax_payable' });
  for (const [purpose, accountId] of [['ar', arAccount], ['service_revenue', revenueAccount]]) {
    await requireCommit(finance, 'approve_fixed_finance_mapping',
      [...mutate(), purpose, '0', accountId, '2026-01-01', 'Fictional fixed account approval']);
  }
  const mapping = await requireCommit(finance, 'approve_invoice_tax_payable_mapping',
    [...mutate(), jurisdiction, '0', taxAccount, '2026-01-01', 'Fictional sales tax account approval']);
  const series = await requireCommit(finance, 'configure_fictional_invoice_setup',
    [...mutate(), { kind: 'invoice_series', label: 'TEST-EXPORT', reason: 'Fictional numbering approval' }]);
  const { rows: [{ today }] } = await admin.query("SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today");
  const period = await requireCommit(finance, 'configure_fictional_invoice_setup',
    [...mutate(), { kind: 'accounting_period', startsOn: today, reason: 'Fictional opening period approval' }]);
  const selection = Object.fromEntries(lines.map(line => [line.outcomeId,
    line.outcomeId === courtesyOutcome ? exemptDistrict : jurisdiction]));
  const { reviewDigest } = await command(finance, 'prepare_reviewed_invoice_issue', [...owner.auth(), draft, '1', selection]);
  assert.match(reviewDigest, /^[a-f0-9]{64}$/);
  const issueOperation = randomUUID();
  const invoice = await requireCommit(finance, 'issue_reviewed_invoice',
    [...owner.auth(), owner.epoch, issueOperation, draft, '1', selection, reviewDigest]);
  return { owner, draft, invoice, issueOperation, series, period, today, profile, mapping, taxAccount, arAccount, jurisdiction, exemption };
}

async function openExportLogin(admin, url) {
  const role = 'crest_invoice_probe_' + randomBytes(8).toString('hex');
  const password = randomBytes(32).toString('hex');
  await admin.query(
    `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  let connection;
  try {
    await admin.query(`GRANT crest_export TO ${role} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE`);
    const target = new URL(url);
    target.username = role;
    target.password = password;
    connection = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 5000,
      statement_timeout: 5000, options: '-c role=crest_export' });
    await connection.connect();
    assert.deepEqual((await connection.query('SELECT current_user,session_user')).rows[0],
      { current_user: 'crest_export', session_user: role });
    return { connection, async close() { await connection.end(); await admin.query(`DROP ROLE ${role}`); } };
  } catch (error) {
    await connection?.end();
    await admin.query(`DROP ROLE ${role}`);
    throw error;
  }
}

async function sourceAndHistory(reader, business) {
  await reader.query(beginSnapshot);
  try {
    const capture = await captureInvoiceSource(business,
      async (sql, parameters) => (await reader.query(sql, parameters)).rows[0].result);
    const formatted = formatInvoiceSource(capture);
    const file = name => formatted.files.find(part => part.name === name).content;
    const decoded = Object.fromEntries(Object.keys(capture.counts).map(group => {
      const dictionary = JSON.parse(file(group + '_dictionary.json'));
      const { escapes } = JSON.parse(file(group + '_escape_map.json'));
      return [group, readSourceExportCsv(file(group + '.csv'), escapes,
        { columns: dictionary.columns, booleans: dictionary.booleanColumns, maxRows: 100 })];
    }));
    const historyContext = await command(reader, 'business_history_export_context', [business]);
    assert.equal(capture.historySnapshotToken, historyContext.snapshotToken);
    const history = {};
    for (const kind of ['operation', 'audit_event']) {
      const records = [];
      let after = null;
      while (true) {
        const { rows } = await reader.query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',
          [business, capture.historySnapshotToken, kind, after]);
        if (!rows.length) break;
        records.push(...rows);
        after = rows.at(-1).record_id;
        assert(records.length <= Number(historyContext.recordCounts[kind]));
      }
      assert.equal(String(records.length), historyContext.recordCounts[kind]);
      history[kind] = records;
    }
    await reader.query('COMMIT');
    return { snapshotToken: capture.snapshotToken, counts: capture.counts, decoded, history };
  } catch (error) {
    await reader.query('ROLLBACK');
    throw error;
  }
}

async function verifyRecovery({ candidate, admin, target, reader, finance, owner, draft, invoice, issueOperation }) {
  const directory = await privateWorkspace();
  const point = join(directory, 'point');
  let destination;
  let restored;
  let restoredReader;
  let restoredFinance;
  try {
    await mkdir(point, { mode: 0o700 });
    const keys = await keyPair(directory);
    const original = await sourceAndHistory(reader, owner.business);
    const read = (connection, auth = owner.auth()) => command(connection, 'read_issued_invoice', [...auth, draft]);
    const lookup = (connection, auth = owner.auth()) => command(connection, 'lookup_invoice_issue',
      [...auth, owner.epoch, issueOperation, draft, '1']);
    const originalInvoice = await read(finance);
    const originalReceipt = await lookup(finance);
    assert.equal(originalInvoice.invoiceId, invoice.invoiceId);
    assert.deepEqual(originalReceipt, { state: 'committed', receipt: invoice });
    await assert.rejects(backupLegacy76Database(admin, target, point, keys.recipient),
      { message: 'SYNTHETIC_RECOVERY_BACKUP_FAILED:coverage' });
    const { manifest, receipt } = await backupDatabase(admin, target, point, keys.recipient);
    assert.equal(manifest.schemaVersion, 77);
    assert.equal(manifest.registrySha256, candidate.registrySha256);
    assert.equal(manifest.heldInvoiceMigrationSha256, undefined);
    assert.equal(manifest.completeBackup, false);
    assert.match(receipt.dump.sha256, /^[a-f0-9]{64}$/);
    for (const [table, count] of Object.entries(original.counts)) {
      const entry = manifest.rows.find(row => row.schema === 'crest' && row.name === table);
      assert.equal(entry.rows, Number(count) + (table === 'invoice_series' ? 1 : 0));
    }
    destination = await recoveryCluster();
    const restoredUrl = await destination.database();
    assert.notEqual(new URL(restoredUrl).port, new URL(target).port);
    restored = await connect(restoredUrl);
    await assert.rejects(restoreLegacy76Database(point, keys.path, restoredUrl),
      { message: 'SYNTHETIC_RECOVERY_RESTORE_FAILED:manifest' });
    assert.deepEqual(await inventory(restored), []);
    const recoveredManifest = await restoreDatabase(point, keys.path, restoredUrl);
    assert.deepEqual(recoveredManifest, manifest);
    assert.deepEqual(await inventory(restored), manifest.rows);
    restoredReader = await openExportLogin(restored, restoredUrl);
    const recovered = await sourceAndHistory(restoredReader.connection, owner.business);
    assert.notEqual(recovered.snapshotToken, original.snapshotToken);
    assert.deepEqual(recovered.counts, original.counts);
    assert.deepEqual(recovered.decoded, original.decoded);
    assert.deepEqual(recovered.history, original.history);
    await assert.rejects(restored.query('UPDATE crest.invoices SET total_cents=total_cents WHERE id=$1', [invoice.invoiceId]),
      { code: '55000' });

    // Exercise the owner read after fencing the disposable restore and replacing
    // its synthetic session. This fixture never activates restored writes.
    const provider = randomUUID(), session = randomUUID(), credential = randomBytes(32);
    await restored.query('BEGIN');
    try {
      await restored.query('SELECT id FROM crest_private.business_recovery_authorities WHERE business_id=$1 FOR UPDATE', [owner.business]);
      await restored.query(`UPDATE crest_private.business_recovery_authorities
        SET active_epoch=$2,incident_id=$3,writes_enabled=false,version=version+1 WHERE business_id=$1`,
      [owner.business, randomUUID(), randomUUID()]);
      await restored.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE revoked_at IS NULL');
      await restored.query('DELETE FROM auth.sessions');
      await restored.query("INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at) VALUES($1,$2,'aal2',clock_timestamp(),clock_timestamp())",
        [provider, owner.subject]);
      await restored.query(`WITH observed AS MATERIALIZED (SELECT clock_timestamp()-interval '1 second' AS stamp)
        INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,
          created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by)
        SELECT $1,id,$3,$4,current_security_epoch,stamp,stamp,stamp,stamp+interval '12 hours',false,$5,'synthetic',id,id
        FROM crest_private.actors CROSS JOIN observed WHERE id=$2`,
      [session, owner.actor, provider, credential, randomBytes(32)]);
      await restored.query('COMMIT');
    } catch (error) {
      await restored.query('ROLLBACK');
      throw error;
    }
    restoredFinance = await connect(restoredUrl);
    await restoredFinance.query('SET ROLE crest_finance_preview');
    await assert.rejects(read(restoredFinance), { message: 'CREST_TENANT_READ_DENIED' });
    const freshAuth = owner.auth();
    freshAuth[0] = credential;
    freshAuth[1] = session;
    freshAuth[5] = provider;
    assert.deepEqual(await read(restoredFinance, freshAuth), originalInvoice);
    assert.deepEqual(await lookup(restoredFinance, freshAuth), originalReceipt);
  } finally {
    try { await restoredFinance?.end(); }
    finally {
      try { await restoredReader?.close(); }
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

test('private invoice posting, snapshot export, and independent encrypted recovery preserve original evidence', { timeout: 180000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  let exportLogin;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database();
    const admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin, target);
    const candidate = await financeInvoice77Candidate(sandbox);
    await sandbox.apply(target, candidate.directory);

    const web = await sandbox.connect(target);
    const finance = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    exportLogin = await openExportLogin(sandbox.admin, target);
    const reader = exportLogin.connection;
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const prepareOwner = principal => admin.query(
      "INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)"
      + " SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",
      [principal.business, principal.actor]);
    const { owner, draft, invoice, issueOperation, series, period, today, profile, mapping, taxAccount, arAccount, jurisdiction, exemption } =
      await postTaxableInvoice({ admin, web, finance, makeOwner, prepareOwner });
    const foreign = await makeOwner();
    await prepareOwner(foreign);
    const foreignSeries = await requireCommit(finance, 'configure_fictional_invoice_setup',
      [...foreign.auth(), foreign.epoch, randomUUID(), { kind: 'invoice_series', label: 'FOREIGN-EXPORT', reason: 'Fictional other business' }]);

    const context = (business = owner.business, connection = reader) =>
      command(connection, 'invoice_source_snapshot_context', [business]);
    const page = (token, group, after = null, limit = 20, business = owner.business, connection = reader) =>
      command(connection, 'invoice_source_snapshot_page', [business, token, group, after, limit]);
    await assert.rejects(context(owner.business, web), { code: '42501' });
    await assert.rejects(context(owner.business, finance), { code: '42501' });
    await assert.rejects(page('0'.repeat(64), 'invoices', null, 20, owner.business, web), { code: '42501' });
    await assert.rejects(context(), { code: '25001' });
    await assert.rejects(reader.query('SELECT id FROM crest.invoices'), { code: '42501' });
    await assert.rejects(reader.query('SELECT token_hash FROM crest_private.app_sessions'), { code: '42501' });
    await assert.rejects(reader.query('SET ROLE crest_export_owner'), { code: '42501' });

    await reader.query(beginSnapshot);
    const observed = await context();
    assert.deepEqual(observed, {
      schemaVersion: 1, scope: 'invoice_posting_sources', businessId: owner.business,
      snapshotToken: observed.snapshotToken, historySnapshotToken: observed.historySnapshotToken,
      counts: {
        invoice_series: '1', invoice_number_reservations: '1', accounting_periods: '1', accounting_period_locks: '0',
        tax_payable_mapping_versions: '1', invoice_exemption_evidence: '1', invoices: '1', invoice_items: '2',
        billing_consumptions: '2', atomic_finance_groups: '1', financial_events: '1', receivable_items: '1',
        invoice_tax_payable_movements: '1', journal_entries: '1', journal_lines: '3',
      },
    });
    assert.match(observed.snapshotToken, /^[a-f0-9]{64}$/);
    assert.match(observed.historySnapshotToken, /^[a-f0-9]{64}$/);
    assert.deepEqual(await context(), observed);
    const foreignContext = await context(foreign.business);
    assert.equal(foreignContext.counts.invoices, '0');
    assert.equal(foreignContext.counts.invoice_series, '1');
    assert.notEqual(foreignContext.snapshotToken, observed.snapshotToken);
    assert.equal((await page(foreignContext.snapshotToken, 'invoice_series', null, 20, foreign.business)).rows[0].id,
      foreignSeries.record.id);
    for (const [name, action] of [
      ['tenant', () => page(observed.snapshotToken, 'invoices', null, 20, foreign.business)],
      ['group', () => page(observed.snapshotToken, 'invoices; SELECT token_hash FROM crest_private.app_sessions')],
      ['limit', () => page(observed.snapshotToken, 'invoices', null, 21)],
    ]) {
      await reader.query('SAVEPOINT invalid_' + name);
      await assert.rejects(action(), { message: 'CREST_INVOICE_SOURCE_PAGE_REQUIRED' });
      await reader.query('ROLLBACK TO SAVEPOINT invalid_' + name);
    }

    const sources = {};
    for (const [group, count] of Object.entries(observed.counts)) {
      const rows = [];
      let after = null;
      for (let index = 0; index < Number(count) + 1; index++) {
        const part = await page(observed.snapshotToken, group, after, 1);
        assert.deepEqual(part, {
          schemaVersion: 1, businessId: owner.business, snapshotToken: observed.snapshotToken, group,
          rows: part.rows, hasMore: rows.length + part.rows.length < Number(count),
        });
        assert(part.rows.every(row => row.business_id === owner.business && (after === null || row.id > after)));
        rows.push(...part.rows);
        if (!part.hasMore) break;
        after = rows.at(-1).id;
      }
      assert.equal(String(rows.length), count);
      sources[group] = rows;
    }

    const [source] = sources.invoices;
    const { rows: [original] } = await admin.query(
      `SELECT customer_snapshot::text,location_snapshot::text,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM crest.invoices WHERE id=$1`, [invoice.invoiceId]);
    assert.equal(source.id, invoice.invoiceId);
    assert.equal(source.draft_revision, '1');
    assert.equal(source.operation_id, issueOperation);
    assert.equal(source.invoice_number, 'TEST-EXPORT-1');
    assert.equal(source.total_cents, '25000');
    assert.equal(source.customer_snapshot, original.customer_snapshot);
    assert.equal(source.location_snapshot, original.location_snapshot);
    assert.match(source.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    assert.equal(source.created_at, original.created_at);
    assert.equal(sources.invoice_series[0].id, series.record.id);
    assert.equal(sources.invoice_series[0].incident_id, null);
    assert.equal(sources.invoice_number_reservations[0].id, source.reservation_id);
    assert.equal(sources.invoice_number_reservations[0].number_sequence, '1');
    assert.equal(sources.invoice_number_reservations[0].issued_source_id, source.id);
    const [sourcePeriod] = sources.accounting_periods;
    assert.equal(sourcePeriod.id, period.record.id);
    assert.equal(sourcePeriod.starts_on, today);
    assert.equal(sourcePeriod.month_start, today.slice(0, 7) + '-01');
    assert.equal(sourcePeriod.opening_boundary, true);
    const taxable = sources.invoice_items.find(row => row.tax_cents === '2273');
    const courtesy = sources.invoice_items.find(row => row.total_cents === '0');
    assert.equal(taxable.tax_profile_id, profile.id);
    assert.equal(taxable.exemption_evidence_id, null);
    assert.equal(courtesy.tax_cents, '0');
    assert.equal(courtesy.exemption_evidence_id, exemption.id);
    assert.equal(sources.invoice_exemption_evidence[0].id, exemption.id);
    assert.equal(sources.invoice_exemption_evidence[0].customer_id, source.customer_id);
    assert.equal(sources.billing_consumptions.find(row => row.invoice_item_id === courtesy.id).consumed_cents, '0');
    const [event] = sources.financial_events;
    assert.equal(event.group_id, sources.atomic_finance_groups[0].id);
    assert.equal(event.period_id, sourcePeriod.id);
    assert.equal(event.period_generation, '0');
    assert.equal(event.reopened_generation, null);
    const [receivable] = sources.receivable_items;
    assert.equal(receivable.account_id, arAccount);
    assert.equal(receivable.original_cents, '25000');
    const [taxMovement] = sources.invoice_tax_payable_movements;
    assert.equal(taxMovement.mapping_id, mapping.id);
    assert.equal(taxMovement.invoice_item_id, taxable.id);
    assert.equal(taxMovement.account_id, taxAccount);
    assert.equal(taxMovement.cents, '2273');
    assert.equal(sources.tax_payable_mapping_versions[0].previous_version, null);
    const [entry] = sources.journal_entries;
    assert.equal(entry.event_id, event.id);
    assert(sources.journal_lines.every(row => row.entry_id === entry.id));
    assert.equal(sources.journal_lines.find(row => row.tax_payable_movement_id === taxMovement.id).credit_cents, '2273');
    assert.equal(sources.journal_lines.find(row => row.receivable_id === receivable.id).debit_cents, '25000');
    const sum = column => sources.journal_lines.reduce((cents, row) => cents + BigInt(row[column]), 0n);
    assert.equal(sum('debit_cents'), sum('credit_cents'));

    const captured = await captureInvoiceSource(owner.business,
      async (sql, parameters) => (await reader.query(sql, parameters)).rows[0].result);
    assert.deepEqual(captured, { businessId: owner.business, snapshotToken: observed.snapshotToken,
      historySnapshotToken: observed.historySnapshotToken, counts: observed.counts, rows: sources });
    const formatted = formatInvoiceSource(captured);
    const file = name => formatted.files.find(part => part.name === name).content;
    const dictionary = JSON.parse(file('journal_lines_dictionary.json'));
    const { escapes } = JSON.parse(file('journal_lines_escape_map.json'));
    const csvJournal = readSourceExportCsv(file('journal_lines.csv'), escapes,
      { columns: dictionary.columns, maxRows: 20 });
    assert.deepEqual(csvJournal, sources.journal_lines);
    assert.equal(csvJournal.find(row => row.receivable_id === receivable.id).debit_cents, '25000');
    assert.equal(csvJournal.find(row => row.tax_payable_movement_id === taxMovement.id).credit_cents, '2273');
    assert.equal(JSON.parse(formatted.manifest).historySnapshotToken, observed.historySnapshotToken);

    const history = await command(reader, 'business_history_export_context', [owner.business]);
    assert.equal(history.snapshotToken, observed.historySnapshotToken);
    for (const kind of ['operation', 'audit_event']) {
      let after = null;
      let found;
      for (let index = 0; index < 5; index++) {
        const { rows } = await reader.query(
          'SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',
          [owner.business, observed.historySnapshotToken, kind, after]);
        if (!rows.length) break;
        found = rows.map(row => JSON.parse(row.canonical_evidence).row).find(row => row.operation_id === issueOperation);
        if (found) break;
        after = rows.at(-1).record_id;
      }
      assert.equal(found?.business_id, owner.business);
      assert.equal(kind === 'operation' ? found.command_type : found.entity_id,
        kind === 'operation' ? 'finance.invoice.issue' : invoice.invoiceId);
    }

    const closure = await requireCommit(finance, 'approve_invoice_tax_payable_mapping',
      [...owner.auth(), owner.epoch, randomUUID(), jurisdiction, '1', null, '9999-01-01', 'Fictional mapping closure']);
    assert.equal((await context()).counts.tax_payable_mapping_versions, '1');
    assert.deepEqual((await page(observed.snapshotToken, 'tax_payable_mapping_versions')).rows, sources.tax_payable_mapping_versions);
    await reader.query('COMMIT');
    await reader.query(beginSnapshot);
    const later = await context();
    assert.equal(later.counts.tax_payable_mapping_versions, '2');
    const newMapping = (await page(later.snapshotToken, 'tax_payable_mapping_versions')).rows.find(row => row.id === closure.id);
    assert.equal(newMapping.account_id, null);
    assert.equal(newMapping.previous_version, '1');
    assert.notEqual(later.snapshotToken, observed.snapshotToken);
    await assert.rejects(page(observed.snapshotToken, 'invoices'), { message: 'CREST_INVOICE_SOURCE_PAGE_REQUIRED' });
    await reader.query('ROLLBACK');

    await verifyRecovery({ candidate, admin, target, reader, finance, owner, draft, invoice, issueOperation });

    await admin.query('ALTER TABLE crest.invoices ADD COLUMN fixture_private_value text');
    await reader.query(beginSnapshot);
    await assert.rejects(context(), { message: 'CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED' });
    await reader.query('ROLLBACK');
  } finally {
    try {
      await exportLogin?.close();
    } finally {
      try { await sandbox?.close(); }
      finally { await cluster.close(); }
    }
  }
});
