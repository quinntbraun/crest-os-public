import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { backupExcessReturnCandidateDatabase, connect, inventory, keyPair, privateWorkspace, recoveryCluster, restoreExcessReturnCandidateDatabase } from '../support/recovery-drill.mjs';
import { prepareExcessReturnCandidate } from '../support/finance-excess-return-candidate.mjs';
import { exerciseNeutralFinanceImport } from '../support/neutral-finance-import.mjs';
import { parseFictionalJournalV7, parseFictionalTrialBalanceV7 } from '../../src/bookkeeping/posted-report-v7-contract.ts';
import { captureFinanceSourceExport } from '../../src/bookkeeping/finance-source-export.ts';
import { verifyFinanceSourceExport } from '../../src/tooling/verify-finance-source-export.ts';
import { createServiceRefundSourceCollector } from '../../src/security/business-foundation-collector.ts';
import { postedFinanceProfileForSchema } from '../../src/security/posted-finance-owner-export-contract.ts';
import { parseExcessReturnInput, parseExcessReturnOptions, parseExcessReturnResult } from '../../src/bookkeeping/excess-return-contract.ts';

const name = 'record_fictional_excess_return';

async function command(connection, commandName, values) {
  const parameters = values.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + commandName + '(' + parameters + ') AS value', values)).rows[0].value;
}

async function committed(connection, commandName, values) {
  const result = await command(connection, commandName, values);
  assert.equal(result.state, 'committed', JSON.stringify(result));
  return result.receipt;
}

test('registered P09 returns only selected original P03 excess with exact settled evidence and double entry', { timeout: 240000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database();
    const admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin, target);
    assert.equal((await sandbox.apply(target, await sandbox.prefix(92))).history.length, 92);
    const web = await sandbox.connect(target);
    const finance = await sandbox.connect(target);
    const peer = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    await peer.query('SET ROLE crest_finance_preview');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const owner = await makeOwner();
    const foreign = await makeOwner();
    const mutate = () => [...owner.auth(), owner.epoch, randomUUID()];
    const { today, yesterday } = (await admin.query(
      "SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today, ((statement_timestamp() AT TIME ZONE 'UTC')::date-1)::text AS yesterday",
    )).rows[0];
    await admin.query(
      "INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",
      [owner.business, owner.actor],
    );
    const depositBank = randomUUID(), depositChannel = randomUUID();
    const returnBank = randomUUID(), returnChannel = randomUUID(), funds = randomUUID();
    for (const [account, channel, code, suffix] of [[depositBank, depositChannel, '1000', '9182'], [returnBank, returnChannel, '1001', '4726']]) {
      await committed(finance, 'save_finance_account', [...mutate(), 1, account, '0', {
        identity: { code, accountType: 'asset', normalSide: 'debit', controlKind: 'bank', reportRole: 'money' },
        name: 'Fictional bank ' + suffix, active: true, reason: null,
      }]);
      await committed(finance, 'save_money_channel', [...mutate(), channel, '0', {
        identity: { accountId: account, kind: 'bank', ownershipScope: 'dedicated_business', providerNamespace: 'fictional-bank', maskedSuffix: suffix },
        label: 'Fictional bank ' + suffix, effectiveFrom: '2026-01-01', ownershipEvidence: 'Fictional verified ownership',
        openingState: 'verified_zero', openingOn: '2026-01-01', openingCents: '0', openingEvidence: 'Fictional opening',
        active: true, reason: 'Fictional review',
      }]);
    }
    await committed(finance, 'save_finance_account', [...mutate(), 1, funds, '0', {
      identity: { code: '2000', accountType: 'liability', normalSide: 'credit', controlKind: 'customer_funds', reportRole: 'customer_funds' },
      name: 'Fictional customer funds', active: true, reason: null,
    }]);
    await committed(finance, 'approve_fixed_finance_mapping', [...mutate(), 'customer_funds', '0', funds, '2026-01-01', 'Fictional review']);
    await committed(finance, 'configure_fictional_invoice_setup', [...mutate(), { kind: 'accounting_period', startsOn: yesterday, reason: 'Fictional opening' }]);
    const mapping = (await admin.query("SELECT id FROM crest.account_mapping_versions WHERE business_id=$1 AND purpose='customer_funds'", [owner.business])).rows[0].id;
    const receive = async (cents) => committed(finance, 'record_direct_fictional_receipt_with_funds', [
      ...mutate(), randomUUID(), owner.customer, depositChannel, '1', today, cents, 'Fictional receipt verified', null,
      { namespace: 'ledger', id: randomUUID(), rawReference: 'Fictional inflow' }, {}, mapping,
    ]);
    const original = await receive('4100');
    const other = await receive('1100');
    const lot = original.heldFunds.lotId;
    const originalSource = (await admin.query('SELECT to_jsonb(l) AS lot FROM crest.customer_fund_lots l WHERE id=$1', [lot])).rows[0].lot;
    const candidate = await prepareExcessReturnCandidate(sandbox);
    assert.equal((await sandbox.apply(target, candidate)).history.length, 93);

    const optionsName = 'read_fictional_excess_return_options';
    const returnOptions = async (principal = owner, date = today) => parseExcessReturnOptions(
      await command(finance, optionsName, [...principal.auth(), owner.customer, date]), principal.business, owner.customer, date);
    const initial = await returnOptions();
    assert.equal(initial.openPeriod, true);
    assert.deepEqual(initial.lots.find(item => item.fundLotId === lot), {
      fundLotId: lot, originalPaymentId: original.paymentId, receivedOn: today, availableRanges: [{ firstCent: '1', lastCent: '4100' }],
    });
    assert.deepEqual(initial.channels.map(item => item.channelId).sort(), [depositChannel, returnChannel].sort());
    assert.deepEqual((await returnOptions(foreign)).lots, []);
    assert.deepEqual((await returnOptions(owner, yesterday)).lots, []);
    await assert.rejects(command(web, optionsName, [...owner.auth(), owner.customer, today]), { code: '42501' });

    const evidence = (id) => ({ namespace: 'ledger', id, rawReference: 'Fictional settled debit' });
    const args = ({
      operation = randomUUID(), record = randomUUID(), payment = original.paymentId, fundLot = lot, customer = owner.customer,
      channel = returnChannel, version = '1', date = today, first = '201', last = '500', external = evidence(randomUUID()),
      confirmation = 'Verified settled debit', reason = 'Customer requested return of unused funds',
      verifiedCents = (BigInt(last) - BigInt(first) + 1n).toString(),
    } = {}) => [...owner.auth(), owner.epoch, operation, record, payment, fundLot, customer, channel, version, date, first, last, confirmation, reason, external, verifiedCents];
    await assert.rejects(command(web, name, args()), { code: '42501' });
    await assert.rejects(command(finance, name, args({ payment: randomUUID() })), { message: 'EXCESS_RETURN_ORIGINAL_PAYMENT_REQUIRED' });
    await assert.rejects(command(finance, name, args({ payment: other.paymentId })), { message: 'EXCESS_RETURN_LOT_REQUIRED' });
    await assert.rejects(command(finance, name, args({ customer: foreign.customer })), { message: 'EXCESS_RETURN_LOT_REQUIRED' });
    await assert.rejects(command(finance, name, args({ date: yesterday })), { message: 'EXCESS_RETURN_DATE_REQUIRED' });
    await assert.rejects(command(finance, name, args({ first: '4100', last: '4101' })), { message: 'EXCESS_RETURN_RANGE_UNAVAILABLE' });
    await assert.rejects(command(finance, name, args({ version: '2' })), { message: 'EXCESS_RETURN_VERIFIED_CHANNEL_REQUIRED' });
    await assert.rejects(command(finance, name, args({ external: null })), { message: 'EXCESS_RETURN_INPUT_REQUIRED' });
    await assert.rejects(command(finance, name, args({ verifiedCents: '301' })), { message: 'EXCESS_RETURN_VERIFIED_AMOUNT_REQUIRED' });

    const external = evidence(randomUUID());
    const input = args({ external });
    const reference = { operationId: input[9], recoveryEpoch: owner.epoch, excessReturnId: input[10] };
    const parsedInput = parseExcessReturnInput({
      reference, originalPaymentId: input[11], fundLotId: input[12], customerId: input[13],
      channelId: input[14], channelVersion: input[15], actualOn: input[16], firstCent: input[17], lastCent: input[18],
      confirmation: input[19], reason: input[20], externalIdentity: input[21], verifiedCents: input[22],
    });
    assert.equal(parsedInput.verifiedCents, '300');
    const saved = await command(finance, name, input);
    assert.equal(saved.state, 'committed');
    assert.deepEqual(parseExcessReturnResult(saved, owner.business, reference), saved);
    assert.deepEqual((await returnOptions()).lots.find(item => item.fundLotId === lot).availableRanges, [
      { firstCent: '1', lastCent: '200' }, { firstCent: '501', lastCent: '4100' },
    ]);
    assert.deepEqual(await command(finance, name, input), saved);
    const changed = [...input];
    changed[18] = '501';
    changed[22] = '301';
    assert.deepEqual(await command(finance, name, changed), { state: 'conflict', reason: 'operation' });
    assert.deepEqual(saved.receipt, {
      schemaVersion: 1, businessId: owner.business, excessReturnId: input[10], operationId: input[9],
      eventId: saved.receipt.eventId, originalPaymentId: original.paymentId, originalReceiptEventId: original.eventId,
      fundLotId: lot, fundingOriginId: original.fundingOriginId, parentPartitionId: original.heldFunds.fundingPartitionId,
      customerId: owner.customer, fundsAccountId: funds, fundsMappingId: mapping,
      moneyAccountId: returnBank, moneyMovementId: saved.receipt.moneyMovementId,
      moneyChannelId: returnChannel, moneyChannelVersion: '1', evidenceId: saved.receipt.evidenceId,
      actualOn: today, firstCent: '201', lastCent: '500', cents: '300', confirmation: input[19], reason: input[20],
    });
    const lines = (await admin.query(
      'SELECT purpose,account_id,debit_cents::text,credit_cents::text FROM crest.journal_lines WHERE excess_return_id=$1 ORDER BY purpose', [input[10]],
    )).rows;
    assert.deepEqual(lines, [
      { purpose: 'excess_return_funds', account_id: funds, debit_cents: '300', credit_cents: '0' },
      { purpose: 'excess_return_money', account_id: returnBank, debit_cents: '0', credit_cents: '300' },
    ]);
    const movement = (await admin.query('SELECT signed_cents::text,account_id,evidence_id FROM crest.money_movements WHERE id=$1', [saved.receipt.moneyMovementId])).rows[0];
    assert.deepEqual(movement, { signed_cents: '-300', account_id: returnBank, evidence_id: saved.receipt.evidenceId });
    const audit = (await admin.query("SELECT delta FROM crest_private.audit_events WHERE entity_kind='excess_receipt_returns' AND entity_id=$1", [input[10]])).rows[0].delta;
    assert.deepEqual(audit, { schemaVersion: 1, before: null, after: saved.receipt });
    assert.deepEqual((await admin.query('SELECT to_jsonb(l) AS lot FROM crest.customer_fund_lots l WHERE id=$1', [lot])).rows[0].lot, originalSource);
    assert.equal((await admin.query('SELECT template FROM crest.financial_events WHERE id=$1', [saved.receipt.eventId])).rows[0].template, 'P09');
    await assert.rejects(admin.query('DELETE FROM crest.excess_receipt_returns WHERE id=$1', [input[10]]), { code: '55000' });
    await assert.rejects(command(finance, name, args({ first: '501', last: '700', external })), { message: 'EXCESS_RETURN_EXTERNAL_ID_ALREADY_RECORDED' });
    const lookupName = 'lookup_fictional_excess_return';
    const lookup = (principal = owner, id = input[10], epoch = owner.epoch) => command(finance, lookupName, [...principal.auth(), epoch, input[9], id]);
    assert.deepEqual(await lookup(), saved);
    assert.deepEqual(await lookup(owner, randomUUID()), { state: 'conflict', reason: 'operation' });
    assert.deepEqual(await lookup(foreign), { state: 'absent' });
    await assert.rejects(command(web, lookupName, [...owner.auth(), owner.epoch, input[9], input[10]]), { code: '42501' });
    await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1', [owner.business]);
    try {
      await assert.rejects(command(finance, name, input), { message: 'RECOVERY_REVIEW_REQUIRED' });
      await assert.rejects(command(finance, name, args()), { message: 'RECOVERY_REVIEW_REQUIRED' });
      assert.deepEqual(await lookup(), saved);
    } finally {
      await admin.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1', [owner.business]);
    }

    const delayed = args({ first: '501', last: '700' });
    const delayedReference = { operationId: delayed[9], recoveryEpoch: owner.epoch, excessReturnId: delayed[10] };
    const lookupDelayed = (returnId = delayed[10]) => command(finance, lookupName, [...owner.auth(), owner.epoch, delayed[9], returnId]);
    const retireName = 'retire_fictional_excess_return';
    const reason = 'Verified the original request was absent before retiring it';
    const retireArgs = (operationId = delayed[9], returnId = delayed[10]) =>
      [...owner.auth(), owner.epoch, operationId, owner.epoch, returnId, reason];
    assert.deepEqual(await lookupDelayed(), { state: 'absent' });
    await assert.rejects(command(web, retireName, retireArgs()), { code: '42501' });
    const retired = await command(finance, retireName, retireArgs());
    assert.equal(retired.state, 'retired');
    assert.deepEqual(parseExcessReturnResult(retired, owner.business, delayedReference), {
      state: 'retired', receipt: { excessReturnId: delayed[10], reviewEpoch: owner.epoch, reason },
    });
    assert.deepEqual(await lookupDelayed(), retired);
    assert.deepEqual(await command(finance, retireName, retireArgs()), retired);
    assert.deepEqual(await lookupDelayed(randomUUID()), { state: 'conflict', reason: 'operation' });
    assert.deepEqual(await command(finance, retireName, retireArgs(input[9], input[10])), saved);
    assert.deepEqual(await command(finance, name, delayed), { state: 'conflict', reason: 'operation' });
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.excess_receipt_returns WHERE operation_id=$1 OR id=$2', [delayed[9], delayed[10]])).rows[0].n, 0);
    const retirementAudit = (await admin.query("SELECT delta FROM crest_private.audit_events WHERE operation_id=$1 AND entity_kind='operations' AND action='retire'", [delayed[9]])).rows[0].delta;
    assert.deepEqual(retirementAudit, { schemaVersion: 1, before: null, after: retired.receipt });

    const overlap = await Promise.allSettled([
      command(finance, name, args({ first: '701', last: '900' })),
      command(peer, name, args({ first: '800', last: '1000' })),
    ]);
    assert.equal(overlap.filter(result => result.status === 'fulfilled' && result.value.state === 'committed').length, 1);
    assert.equal(overlap.find(result => result.status === 'rejected')?.reason.message, 'EXCESS_RETURN_RANGE_UNAVAILABLE');
    const { consumed, remaining } = (await admin.query(
      'SELECT (SELECT sum(last_cent-first_cent+1)::text FROM crest.fund_lot_range_consumptions WHERE fund_lot_id=$1) AS consumed, sum(credit_cents-debit_cents)::text AS remaining FROM crest.journal_lines WHERE fund_lot_id=$1', [lot],
    )).rows[0];
    assert.equal(BigInt(consumed) + BigInt(remaining), 4100n);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM crest_private.operations WHERE command_type='finance.refund.record_excess'")).rows[0].n, 2);

    await admin.query('BEGIN');
    try {
      const orphanId = randomUUID();
      const operationId = randomUUID();
      const evidenceId = randomUUID();
      await admin.query("SELECT set_config('crest.business_id',$1,true)", [owner.business]);
      await admin.query(`INSERT INTO crest_private.operations
        (business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
        VALUES ($1,$2,$3,'finance.refund.record_excess',1,$4,repeat('0',64),$3,'manual')`,
      [owner.business, operationId, owner.actor, owner.epoch]);
      await admin.query(`INSERT INTO crest.external_money_evidence
        (id,business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,normalization_rule,confirmed_on,signed_cents,currency)
        VALUES ($1,$2,'fictional-bank',$3,'ledger',$4,'Fictional orphan','exact_case_v1',$5,-1,'USD')`,
      [evidenceId, owner.business, returnBank, randomUUID(), today]);
      await admin.query(`INSERT INTO crest.excess_receipt_returns
        (id,business_id,receipt_event_id,fund_lot_id,first_cent,last_cent,channel_version_id,account_id,evidence_id,actual_on,confirmation,reason,operation_id,created_by)
        SELECT $1,business_id,receipt_event_id,fund_lot_id,4000,4000,channel_version_id,account_id,$2,actual_on,confirmation,reason,$3,created_by
        FROM crest.excess_receipt_returns WHERE id=$4`, [orphanId, evidenceId, operationId, input[10]]);
      await assert.rejects(admin.query('SET CONSTRAINTS crest.excess_return_complete IMMEDIATE'), { message: 'EXCESS_RETURN_SOURCE_REQUIRED' });
    } finally {
      await admin.query('ROLLBACK');
    }

    const reportArgs = [...owner.auth(), today];
    const trial = parseFictionalTrialBalanceV7(await command(finance, 'read_fictional_trial_balance_v7', reportArgs), owner.business, today);
    assert.equal(trial.postedEventCount, '4');
    assert(trial.coverage.templates.includes('P09'));
    assert.equal(trial.controls.customerFundsTie, true);
    assert.equal(trial.controls.moneyMovementsTie, true);
    const journalName = 'read_fictional_journal_v7';
    const readJournal = (account = null, after = null, size = 100) => command(finance, journalName, [...reportArgs, account, after, size]);
    const raw = await readJournal();
    const report = parseFictionalJournalV7(raw, owner.business, today, null, null, 100);
    const returnLines = report.rows.filter(row => row.excessReturnId === input[10]);
    assert.deepEqual(returnLines.map(row => [row.template, row.purpose, row.accountId, row.debitCents, row.creditCents]).sort(), [
      ['P09', 'excess_return_funds', funds, '300', '0'],
      ['P09', 'excess_return_money', returnBank, '0', '300'],
    ]);
    assert(report.rows.some(row => row.template === 'P03' && row.purpose === 'receipt_funds' && row.excessReturnId === null));
    assert.throws(() => parseFictionalJournalV7({ ...raw, rows: raw.rows.map(row => row.template === 'P09' && row.purpose === 'excess_return_money'
      ? { ...row, excessReturnId: randomUUID() } : row) }, owner.business, today, null, null, 100));
    assert.throws(() => parseFictionalJournalV7({ ...raw, rows: raw.rows.map(row => row.template === 'P09' && row.purpose === 'excess_return_money'
      ? { ...row, serviceRefundId: input[10] } : row) }, owner.business, today, null, null, 100));
    const bankPage = parseFictionalJournalV7(await readJournal(returnBank, null, 1), owner.business, today, returnBank, null, 1);
    assert.equal(bankPage.rows[0].excessReturnId, input[10]);
    assert.equal(bankPage.hasMore, true);
    const bankNext = parseFictionalJournalV7(await readJournal(returnBank, bankPage.nextAfterLineId, 1), owner.business, today, returnBank, bankPage.nextAfterLineId, 1);
    assert.equal(bankNext.rows[0].purpose, 'excess_return_money');
    assert.equal(bankNext.hasMore, false);
    const held = await command(finance, 'read_fictional_customer_funds', reportArgs);
    assert.equal(held.rows.find(row => row.lotId === lot).heldCents, remaining);
    const aging = await command(finance, 'read_fictional_receivable_aging', reportArgs);
    assert.equal(aging.totalCents, '0');
    assert.deepEqual(aging.rows, []);
    await assert.rejects(command(finance, 'read_fictional_trial_balance_v6', reportArgs), { message: 'FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED' });
    await assert.rejects(command(web, journalName, [...reportArgs, null, null, 100]), { code: '42501' });

    const beforeReturn = parseFictionalTrialBalanceV7(await command(finance, 'read_fictional_trial_balance_v7', [...owner.auth(), yesterday]), owner.business, yesterday);
    assert.equal(beforeReturn.postedEventCount, '0');
    assert.deepEqual(beforeReturn.rows, []);

    const exporter = await sandbox.connect(target);
    await exporter.query('SET ROLE crest_export');
    await assert.rejects(command(exporter, 'excess_return_source_snapshot', [owner.business]), { code: '25001' });
    await assert.rejects(command(finance, 'excess_return_source_snapshot', [owner.business]), { code: '42501' });
    const options = {
      includeCorrections: true, includeFundApplications: true, includeTips: true, includeCredits: true,
      includePairedCredits: true, includeServiceRefunds: true, includeExcessReceipts: true, includeExcessReturns: true,
    };
    const capture = (connection, includeExcessReturns = true) => captureFinanceSourceExport(owner.business,
      async (sql, args) => (await connection.query(sql, args)).rows, { ...options, includeExcessReturns });
    let archive;
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const foreignRows = (await command(exporter, 'excess_return_source_snapshot', [foreign.business])).rows;
      assert(Object.values(foreignRows).every(rows => rows.length === 0));
      await assert.rejects(capture(exporter, false), { message: 'FINANCE_SOURCE_EXPORT_REVIEW_REQUIRED' });
      archive = (await capture(exporter)).forServer();
      const { manifest, files } = archive;
      const verified = verifyFinanceSourceExport(manifest, files, owner.business);
      assert.equal(verified.profile, 'crest.posted-finance-source.v9');
      assert.equal(verified.balancedJournalEntries, 4);
      assert.equal(verified.completeBackup, false);
      assert(files.find(file => file.name === 'excess_receipt_returns.csv').content.includes(input[10]));
    } finally {
      await exporter.query('ROLLBACK');
    }
    const neutral = await sandbox.connect(await sandbox.database());
    const independent = await exerciseNeutralFinanceImport(neutral, archive.files, owner.business, options);
    assert.equal(independent.tables, 31);
    assert.equal(independent.entries, 4);
    assert.equal(independent.debit, independent.credit);

    const role = 'crest_test_p09_export_' + randomBytes(8).toString('hex');
    assert.match(role, /^crest_test_p09_export_[a-f0-9]{16}$/);
    const password = randomBytes(32).toString('hex');
    await admin.query('CREATE ROLE ' + role + " LOGIN NOINHERIT PASSWORD '" + password + "'");
    try {
      await admin.query('GRANT crest_export TO ' + role + ' WITH INHERIT FALSE, SET TRUE');
      const exporterUrl = new URL(target);
      exporterUrl.username = role;
      exporterUrl.password = password;
      const collector = createServiceRefundSourceCollector({
        businessId: owner.business, environment: 'test', connectionString: exporterUrl.href,
      }, true, true);
      const collected = (await collector(AbortSignal.timeout(15000))).forFinanceServer();
      const profile = postedFinanceProfileForSchema(93);
      assert.equal(profile, 'crest.posted-finance-source.v9');
      assert.equal(postedFinanceProfileForSchema(92), 'crest.posted-finance-source.v8');
      assert.equal(postedFinanceProfileForSchema(90), 'crest.posted-finance-source.v7');
      assert.equal(collected.profile, profile);
      assert.deepEqual(collected.files, archive.files);
      const authorized = await command(web, 'authorize_posted_finance_export', owner.auth());
      assert.deepEqual(authorized, { schemaVersion: 1, businessId: owner.business, actorId: owner.actor, recoveryEpoch: owner.epoch });
      const digest = createHash('sha256').update(collected.manifest).digest('hex');
      const observedAt = JSON.parse(collected.manifest).observedAt;
      const handoff = await command(web, 'record_posted_finance_export_access', [
        ...owner.auth(), owner.epoch, 93, 'a'.repeat(40), observedAt, digest, 'b'.repeat(64), 1000,
      ]);
      assert.equal(handoff.state, 'authorized_handoff');
      assert.equal(handoff.scope.profile, profile);
      assert.equal(handoff.scope.sourceSchemaVersion, 93);
      assert.equal(handoff.scope.manifestSha256, digest);
      const audit = (await admin.query('SELECT delta FROM crest_private.audit_events WHERE id=$1', [handoff.auditEventId])).rows[0].delta;
      assert.deepEqual(audit.after, handoff.scope);
    } finally {
      await admin.query('DROP ROLE ' + role);
    }

    // The audited handoff itself appends history, so capture the exact
    // committed evidence again for the encrypted restore comparison.
    await exporter.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      archive = (await capture(exporter)).forServer();
    } finally {
      await exporter.query('ROLLBACK');
    }

    const directory = await privateWorkspace();
    let destination, restored;
    try {
      const point = join(directory, 'point');
      await mkdir(point, { mode: 0o700 });
      const keys = await keyPair(directory);
      const { manifest } = await backupExcessReturnCandidateDatabase(candidate, admin, target, point, keys.recipient);
      assert.equal(manifest.schemaVersion, 93);
      assert.match(manifest.heldExcessReturnMigrationSha256, /^[a-f0-9]{64}$/);
      destination = await recoveryCluster();
      const restoredUrl = await destination.database();
      assert.notEqual(new URL(restoredUrl).port, new URL(target).port);
      assert.deepEqual(await restoreExcessReturnCandidateDatabase(candidate, point, keys.path, restoredUrl), manifest);
      restored = await connect(restoredUrl);
      assert.deepEqual(await inventory(restored), manifest.rows);
      await restored.query('SET ROLE crest_export');
      await restored.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const replay = (await capture(restored)).forServer();
        assert.deepEqual(replay.files, archive.files);
        assert.equal(verifyFinanceSourceExport(replay.manifest, replay.files, owner.business).profile, 'crest.posted-finance-source.v9');
      } finally {
        await restored.query('ROLLBACK');
      }
      await restored.query('RESET ROLE; SET ROLE crest_finance_preview');
      assert.deepEqual(await command(restored, lookupName, [...owner.auth(), owner.epoch, input[9], input[10]]), saved);
      assert.deepEqual(await command(restored, lookupName, [...owner.auth(), owner.epoch, delayed[9], delayed[10]]), retired);
      assert.equal((await command(restored, 'read_fictional_customer_funds', reportArgs)).rows.find(row => row.lotId === lot).heldCents, remaining);
    } finally {
      try { await restored?.end(); } finally {
        try { await destination?.close(); } finally {
          const actual = await realpath(directory);
          assert.equal(actual, directory);
          await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
      }
    }
  } finally {
    try {
      await sandbox?.close();
    } finally {
      await cluster.close();
    }
  }
});
