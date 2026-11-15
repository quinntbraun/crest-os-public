import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { confirmedBookingRequest } from '../fixtures/confirmed-booking.ts';
import { createConfirmedBookingFixture } from '../support/confirmed-booking-fixture.mjs';
import { migrationSandbox } from '../support/migration-sandbox.mjs';
import { installProviderSchema } from '../support/provider-schema.mjs';
import { inventory, recoveryCluster } from '../support/recovery-drill.mjs';

async function call(connection, command, values) {
  const args = values.map((_, index) => '$' + (index + 1)).join(',');
  return (await connection.query('SELECT crest_commands.' + command + '(' + args + ') AS result', values)).rows[0].result;
}

test('issue review uses the current saved draft, approved local-date tax, and retained service evidence', { timeout: 120000 }, async () => {
  const cluster = await recoveryCluster();
  let sandbox;
  try {
    sandbox = await migrationSandbox(cluster.testDatabaseUrl);
    const target = await sandbox.database();
    const admin = await sandbox.connect(target);
    await sandbox.apply(target, await sandbox.prefix(0), true);
    await installProviderSchema(admin, target);
    await sandbox.apply(target, await sandbox.prefix(76));
    const exemption = await readFile(new URL('../../planning/proposals/finance-invoice-exemption-evidence.sql', import.meta.url), 'utf8');
    const migration = await readFile(new URL('../../planning/proposals/finance-invoice-issue-tax-review.sql', import.meta.url), 'utf8');
    await admin.query('BEGIN');
    const accountReview = await readFile(new URL('../../planning/proposals/finance-invoice-issue-account-review.sql', import.meta.url), 'utf8');
    const prerequisites = await readFile(new URL('../../planning/proposals/finance-issuance-prerequisites.sql', import.meta.url), 'utf8');
    const periodFence = await readFile(new URL('../../planning/proposals/finance-issuance-period-fence.sql', import.meta.url), 'utf8');
    const issuedSource = await readFile(new URL('../../planning/proposals/finance-issued-invoice-source.sql', import.meta.url), 'utf8');
    const invoiceLedger = await readFile(new URL('../../planning/proposals/finance-invoice-ledger.sql', import.meta.url), 'utf8');
    const issueInvoice = await readFile(new URL('../../planning/proposals/finance-invoice-issue.sql', import.meta.url), 'utf8');
    try {
      for (const sql of [exemption,migration,accountReview,prerequisites,periodFence,issuedSource,invoiceLedger,issueInvoice]) await admin.query(sql);
      await admin.query('COMMIT');
    }
    catch (error) { await admin.query('ROLLBACK'); throw error; }

    const web = await sandbox.connect(target);
    const finance = await sandbox.connect(target);
    await web.query('SET ROLE crest_web');
    await finance.query('SET ROLE crest_finance_preview');
    const bootstrap = (await admin.query("SELECT id FROM crest_private.actors WHERE system_key='security_bootstrap'")).rows[0].id;
    const makeOwner = createConfirmedBookingFixture({ client: admin, web, bootstrap });
    const service = randomUUID();
    const owner = await makeOwner(undefined, { serviceVersionFor: async (principal, auth) => {
      const saved = await call(web, 'save_service', [
        ...auth(), principal.epoch, randomUUID(), 1, service, '0', {
          code: 'fictional-detail',
          active: true,
          definition: { name: 'Fictional detail', inclusions: 'Interior', exclusions: '', internalGuidance: null,
            rangeLowCents: null, rangeHighCents: null, estimatedSeconds: null },
        },
      ]);
      assert.equal(saved.state, 'committed');
      return (await admin.query('SELECT id FROM crest.service_versions WHERE business_id=$1 AND service_id=$2',
        [principal.business, service])).rows[0].id;
    } });
    const foreign = await makeOwner();
    await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) "
      + "SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1", [owner.business, owner.actor]);
    const booking = confirmedBookingRequest(owner);
    const draft = randomUUID();
    const review = (revision, jurisdictions = {}, client = finance, principal = owner) =>
      call(client, 'review_invoice_issue_tax', [...principal.auth(), draft, revision, jurisdictions]);
    const save = (revision, outcomes = [], due = null, cancel = null) =>
      call(finance, 'save_invoice_draft', [...owner.auth(), owner.epoch, randomUUID(), draft, revision, booking.jobId, due, outcomes, cancel]);
    assert.equal((await call(web, 'book_job', [...owner.auth(), owner.epoch, booking.operationId, 1, booking.jobId,
      booking.expectedModeSequence, booking.payload])).state, 'committed');
    assert.deepEqual(await review('1'), { state: 'absent' });
    assert.equal((await save('0')).state, 'committed');
    assert.deepEqual(await review('1'), { state: 'completed_scope_required' });
    const arrived = await call(web, 'change_field_session', [...owner.auth(), owner.epoch, randomUUID(), 1, booking.jobId, '1',
      { action: 'direct_arrive', reason: 'Fictional arrival' }]);
    const context = await call(web, 'read_job_completion_context', [...owner.auth(), booking.jobId]);
    const scope = context.assignments.map(row => ({
      assignedPartId: row.assignedPartId, expectedPlanId: row.planId, expectedPlanSequence: row.planSequence,
      pieces: [{ partitionId: row.partitionId, outcome: 'completed', scopeDescription: row.scopeDescription,
        grossInclusiveCents: row.grossInclusiveCents, discountInclusiveCents: row.discountInclusiveCents,
        amountCents: row.amountCents, reason: null }],
    }));
    const completed = await call(web, 'complete_job', [...owner.auth(), owner.epoch, randomUUID(), 1, booking.jobId, arrived.receipt.jobVersion, {
      scope, reason: 'Fictional work completed', walkthrough: { state: 'done', reason: null },
      review: { reviewUrl: null, skipReason: null, additionalRequestReason: null, expectedDuplicateRequestIds: [],
        expectedCustomerVersion: '1', contactReviewReason: null },
    }]);
    assert.equal(completed.state, 'committed');
    const { lines } = await call(finance, 'read_invoice_preparation', [...owner.auth(), booking.jobId]);
    assert.equal(lines.length, 2);
    assert(lines.every(line => line.serviceId === service));
    assert.equal((await save('1', lines.map(line => line.outcomeId), '2000-01-01')).state, 'committed');
    assert.deepEqual(await review('2'), { state: 'due_date_review_required' });
    assert.equal((await save('2', lines.map(line => line.outcomeId))).state, 'committed');
    assert.deepEqual(await review('2'), { state: 'stale' });
    assert.deepEqual(await review('3', {}, finance, foreign), { state: 'absent' });
    await assert.rejects(review('3', {}, web), { code: '42501' });

    const jurisdiction = 'Fictional reviewed district';
    const selected = Object.fromEntries(lines.map(line => [line.outcomeId, jurisdiction]));
    const approve = (version, effectiveFrom, treatment, rate, evidence) =>
      call(finance, 'approve_finance_tax_profile', [...owner.auth(), owner.epoch, randomUUID(), jurisdiction, 'service',
        service, version, effectiveFrom, treatment, rate, evidence, 'Fictional tax approval']);
    const first = await approve('0', '2026-01-01', 'exempt', null, 'Fictional exemption policy');
    assert.equal(first.state, 'committed');
    const exempt = await review('3', selected);
    assert(exempt.lines.every(line => line.state === 'exemption_review_required' && line.components === null));
    const second = await approve('1', '2026-01-02', 'inclusive_single', '0.1', 'Fictional approved rate');
    assert.equal(second.state, 'committed');
    assert.equal((await approve('2', '9999-01-01', 'unresolved', null, null)).state, 'committed');
    const before = await inventory(admin);
    const missing = await review('3');
    assert.equal(missing.state, 'review');
    assert(missing.lines.every(line => line.state === 'jurisdiction_required'
      && JSON.stringify(line.availableJurisdictions) === JSON.stringify([jurisdiction])));
    const wrong = await review('3', { ...selected, [lines[0].outcomeId]: 'Fictional unapproved district' });
    assert.equal(wrong.lines.find(line => line.outcomeId === lines[0].outcomeId).state, 'tax_profile_required');
    await assert.rejects(review('3', { ...selected, [randomUUID()]: jurisdiction }), { code: '22023' });
    const ready = await review('3', selected);
    assert.equal(ready.timezone, 'UTC');
    const { issue_day: issueDay } = (await admin.query("SELECT to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD') issue_day")).rows[0];
    assert.equal(ready.issueDate, issueDay);
    assert.equal(ready.dueOn, ready.issueDate);
    assert(ready.lines.every(line => line.state === 'ready' && line.profileId === second.receipt.id
      && line.profileVersion === '2' && line.profileEffectiveFrom === '2026-01-02'));
    const paid = ready.lines.find(line => line.inclusiveCents === '25000');
    assert.equal(paid.components.taxCents, '2273');
    const courtesy = ready.lines.find(line => line.inclusiveCents === '0');
    assert.equal(courtesy.complimentaryReason, 'Owner-approved complimentary work');
    assert.equal(courtesy.components.taxCents, '0');
    const reviewAccounts = (jurisdictions, client = finance, principal = owner) =>
      call(client, 'review_invoice_issue_accounts', [...principal.auth(), draft, '3', jurisdictions]);
    const withoutTax = await reviewAccounts({});
    assert.equal(withoutTax.taxReview.state, 'review');
    assert.equal(withoutTax.accountReview, null);
    assert.deepEqual(await reviewAccounts(selected, finance, foreign), { taxReview:{ state:'absent' },accountReview:null });
    await assert.rejects(reviewAccounts(selected, web), { code: '42501' });
    const { accountReview: missingAccounts } = await reviewAccounts(selected);
    assert.deepEqual(missingAccounts.missingFixedPurposes, ['ar', 'service_revenue']);
    assert.deepEqual(missingAccounts.requiredTaxJurisdictions, [jurisdiction]);
    assert.deepEqual(missingAccounts.fixedMappings, {});
    assert.deepEqual(await inventory(admin), before);
    const accountId = randomUUID();
    const receivable = await call(finance, 'save_finance_account', [
      ...owner.auth(), owner.epoch, randomUUID(), 1, accountId, '0', {
        identity: { code: '1100', accountType: 'asset', normalSide: 'debit', controlKind: 'ar', reportRole: 'ar' },
        name: 'Fictional receivable control', active: true, reason: null,
      },
    ]);
    assert.equal(receivable.state, 'committed');
    const approveMapping = (account, version, date) => call(finance, 'approve_fixed_finance_mapping',
      [...owner.auth(), owner.epoch, randomUUID(), 'ar', version, account, date, 'Fictional mapping approval']);
    const mapping = await approveMapping(accountId, '0', '2026-01-01');
    assert.equal(mapping.state, 'committed');
    const { accountReview: withMapping } = await reviewAccounts(selected);
    assert.deepEqual(withMapping.missingFixedPurposes, ['service_revenue']);
    assert.deepEqual(withMapping.fixedMappings.ar, { mappingId: mapping.receipt.id, accountId, accountCode: '1100' });
    assert.equal((await approveMapping(null, '1', '2026-01-02')).state, 'committed');
    assert.deepEqual((await reviewAccounts(selected)).accountReview.missingFixedPurposes, ['ar', 'service_revenue']);
    const sourceOperation = (await admin.query(
      'SELECT operation_id FROM crest.accounts WHERE business_id=$1 AND id=$2', [owner.business, accountId])).rows[0].operation_id;
    // The storage-only fixture supplies an existing committed operation for the FK.
    // The eventual configuration command must create and audit its own operation.
    const insertPeriod = (start, through, zone, opening) => admin.query(
      'INSERT INTO crest.accounting_periods(business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [owner.business, start, through, zone, opening, owner.actor, sourceOperation]);
    await insertPeriod('2026-10-15', '2026-10-31', 'UTC', true);
    await insertPeriod('2026-11-01', '2026-11-30', 'UTC', false);
    await assert.rejects(insertPeriod('2026-09-01','2026-09-30','UTC',false), { message:'ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED' });
    await assert.rejects(insertPeriod('2026-11-01','2026-11-30','UTC',false), { code:'23505' });
    await assert.rejects(insertPeriod('2026-12-01','2026-12-31','unknown/timezone',false), { message:'ACCOUNTING_PERIOD_TIMEZONE_REQUIRED' });
    await assert.rejects(finance.query('SELECT id FROM crest.accounting_periods'), { code:'42501' });
    await assert.rejects(finance.query('SELECT * FROM crest_private.require_open_accounting_period($1,$2,$3)',
      [owner.business,'2026-11-11','UTC']), { code:'42501' });
    const period = (await admin.query("SELECT id FROM crest.accounting_periods WHERE business_id=$1 AND starts_on='2026-11-01'",[owner.business])).rows[0].id;
    const periodReader = await sandbox.connect(target);
    await periodReader.query('SET ROLE crest_finance_account_owner');
    await periodReader.query("SELECT set_config('crest.business_id',$1,false)",[owner.business]);
    const openPeriod = (date,zone='UTC',business=owner.business) => periodReader.query(
      'SELECT * FROM crest_private.require_open_accounting_period($1,$2,$3)',[business,date,zone]).then(result=>result.rows);
    assert.deepEqual(await openPeriod('2026-11-11'),[{period_id:period,generation:'0'}]);
    await assert.rejects(openPeriod('2026-11-11','UTC',foreign.business),{message:'ACCOUNTING_PERIOD_CONTEXT_REQUIRED'});
    await assert.rejects(openPeriod('2026-11-11','America/Indianapolis'),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    await assert.rejects(openPeriod('2026-10-14'),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    await admin.query("INSERT INTO crest.accounting_period_locks(business_id,period_id,generation,state,evidence_ref,created_by,operation_id) VALUES($1,$2,1,'locked','Fictional close review',$3,$4)",
      [owner.business,period,owner.actor,sourceOperation]);
    await assert.rejects(openPeriod('2026-11-11'),{message:'ACCOUNTING_OPEN_PERIOD_REQUIRED'});
    const closureOperation = (await admin.query("SELECT operation_id FROM crest.account_mapping_versions WHERE business_id=$1 AND purpose='ar' AND version=2",[owner.business])).rows[0].operation_id;
    await admin.query("INSERT INTO crest.accounting_period_locks(business_id,period_id,generation,state,evidence_ref,created_by,operation_id) VALUES($1,$2,2,'reopened','Fictional reopen review',$3,$4)",
      [owner.business,period,owner.actor,closureOperation]);
    assert.deepEqual(await openPeriod('2026-11-11'),[{period_id:period,generation:'2'}]);
    const proposedInvoice = randomUUID();
    const issueOperation = randomUUID();
    const reserveNext = (connection,epoch=owner.epoch) => connection.query(
      'SELECT * FROM crest_private.reserve_issued_invoice_number($1,$2)',[proposedInvoice,epoch]);
    await assert.rejects(reserveNext(finance),{ code:'42501' });
    await assert.rejects(reserveNext(periodReader),{ message:'INVOICE_NUMBER_ISSUE_CONTEXT_REQUIRED' });
    const claimIssue = () => admin.query(
      "INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES($1,$2,$3,'finance.invoice.issue',1,$4,repeat('a',64),$3,'manual')",
      [owner.business,issueOperation,owner.actor,owner.epoch]);
    const becomeIssueOwner = async () => {
      await admin.query('SET LOCAL ROLE crest_finance_account_owner');
      await admin.query("SELECT set_config('crest.business_id',$1,true),set_config('crest.actor_id',$2,true),set_config('crest.operation_id',$3,true)",
        [owner.business,owner.actor,issueOperation]);
    };
    await admin.query('BEGIN');
    try {
      await claimIssue();
      await becomeIssueOwner();
      await assert.rejects(reserveNext(admin),{ message:'APPROVED_INVOICE_SERIES_REQUIRED' });
    } finally { await admin.query('ROLLBACK'); }

    const issuedSeries = randomUUID();
    await admin.query("INSERT INTO crest.invoice_series(id,business_id,label,recovery_epoch,kind,approval_reason,created_by,operation_id) VALUES($1,$2,'TEST',$3,'original','Fictional approval',$4,$5)",
      [issuedSeries,owner.business,owner.epoch,owner.actor,sourceOperation]);
    const newEpoch = randomUUID(), incident = randomUUID();
    const createRecoverySeries = label => admin.query(
      "INSERT INTO crest.invoice_series(business_id,label,recovery_epoch,kind,incident_id,approval_reason,created_by,operation_id) VALUES($1,$2,$3,'recovery',$4,'Fictional incident',$5,$6)",
      [owner.business,label,newEpoch,incident,owner.actor,sourceOperation]);
    await assert.rejects(createRecoverySeries('TEST-RECOVERY'), { code:'23514' });
    await createRecoverySeries('TEST-' + newEpoch);
    const reserve = async (number, sequence, epoch=owner.epoch) => admin.query(
      'INSERT INTO crest.invoice_number_reservations(business_id,full_number,series_id,number_sequence,issued_source_id,recovery_epoch,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [owner.business,number,issuedSeries,sequence,randomUUID(),epoch,owner.actor,closureOperation]);
    await assert.rejects(reserve('WRONG-2',2), { message:'INVOICE_NUMBER_SERIES_REQUIRED' });
    await assert.rejects(reserve('TEST-2',2,newEpoch), { code:'23503' });
    await reserve('TEST-1',1);
    await admin.query(
      'INSERT INTO crest.invoice_number_reservations(business_id,full_number,incident_id,external_evidence,recovery_epoch,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [owner.business,'TEST-2',incident,'Fictional recovered invoice',newEpoch,owner.actor,sourceOperation]);
    await assert.rejects(reserve('TEST-2',2), { code:'23505' });
    await assert.rejects(admin.query('DELETE FROM crest.invoice_number_reservations'), { code:'55000' });
    await admin.query('BEGIN');
    try {
      await claimIssue();
      await becomeIssueOwner();
      const [{ reservation_id: reservationId, invoice_number: invoiceNumber }] = (await reserveNext(admin)).rows;
      assert.match(reservationId,/^[a-f0-9-]{36}$/);
      assert.equal(invoiceNumber,'TEST-3');
      await assert.rejects(reserveNext(admin),{ code:'23505' });
    } finally { await admin.query('ROLLBACK'); }
    assert.deepEqual((await admin.query(
      'SELECT full_number FROM crest.invoice_number_reservations WHERE business_id=$1 ORDER BY full_number',[owner.business]
    )).rows.map(row=>row.full_number),['TEST-1','TEST-2']);
    assert.equal((await approveMapping(accountId,'2','2026-01-03')).state,'committed');
    const revenueAccountId = randomUUID();
    assert.equal((await call(finance,'save_finance_account',[
      ...owner.auth(),owner.epoch,randomUUID(),1,revenueAccountId,'0',{
        identity:{code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'service_revenue'},
        name:'Fictional service revenue',active:true,reason:null,
      },
    ])).state,'committed');
    assert.equal((await call(finance,'approve_fixed_finance_mapping',[
      ...owner.auth(),owner.epoch,randomUUID(),'service_revenue','0',revenueAccountId,'2026-01-01','Fictional revenue mapping',
    ])).state,'committed');
    const ledgerJurisdiction = 'Fictional non-taxable district';
    assert.equal((await call(finance,'approve_finance_tax_profile',[
      ...owner.auth(),owner.epoch,randomUUID(),ledgerJurisdiction,'service',service,'0','2026-01-03',
      'non_taxable',null,'Fictional non-taxable evidence','Fictional approval',
    ])).state,'committed');
    const postingSelection = Object.fromEntries(lines.map(line=>[line.outcomeId,ledgerJurisdiction]));
    const postingReview = await reviewAccounts(postingSelection);
    assert.deepEqual(postingReview.accountReview.missingFixedPurposes,[]);
    assert.deepEqual(postingReview.accountReview.requiredTaxJurisdictions,[]);
    const taxAccount = randomUUID();
    const taxAccountName = 'Fictional sales tax control';
    assert.equal((await call(finance,'save_finance_account',[
      ...owner.auth(),owner.epoch,randomUUID(),1,taxAccount,'0',{
        identity:{code:'2100',accountType:'liability',normalSide:'credit',controlKind:'tax_payable',reportRole:'tax_payable'},
        name:taxAccountName,active:true,reason:null,
      },
    ])).state,'committed');
    const taxMapping = (op,district,version,account,date,connection=finance,principal=owner) =>
      call(connection,'approve_invoice_tax_payable_mapping',[...principal.auth(),principal.epoch,op,district,version,account,date,'Fictional tax account approval']);
    const readTaxMapping = (district=jurisdiction,connection=finance,principal=owner) =>
      call(connection,'read_invoice_tax_payable_mapping',[...principal.auth(),district]);
    assert.deepEqual(await readTaxMapping(),{schemaVersion:1,businessId:owner.business,jurisdiction,latest:null,
      eligibleAccount:{id:taxAccount,name:taxAccountName,code:'2100'}});
    await assert.rejects(readTaxMapping(jurisdiction,web),{code:'42501'});
    assert.deepEqual(await readTaxMapping(jurisdiction,finance,foreign),{schemaVersion:1,businessId:foreign.business,jurisdiction,
      latest:null,eligibleAccount:null});
    await assert.rejects(taxMapping(randomUUID(),jurisdiction,'0',revenueAccountId,'2026-01-01'),
      {message:'INVOICE_TAX_MAPPING_ACCOUNT_REQUIRED'});
    await assert.rejects(taxMapping(randomUUID(),'Unknown district','0',taxAccount,'2026-01-01'),
      {message:'INVOICE_TAX_MAPPING_JURISDICTION_REQUIRED'});
    await assert.rejects(taxMapping(randomUUID(),jurisdiction,'0',taxAccount,'2026-01-01',web),{code:'42501'});
    const taxApprovalOperation = randomUUID();
    const lookupTaxApproval = (operation=taxApprovalOperation,epoch=owner.epoch,principal=owner,connection=finance) =>
      call(connection,'lookup_invoice_tax_payable_mapping_approval',[...principal.auth(),operation,epoch,jurisdiction,'0']);
    assert.deepEqual(await lookupTaxApproval(),{state:'absent'});
    const taxApproval = await taxMapping(taxApprovalOperation,jurisdiction,'0',taxAccount,'2026-01-01');
    assert.equal(taxApproval.state,'committed');
    assert.deepEqual(await taxMapping(taxApprovalOperation,jurisdiction,'0',taxAccount,'2026-01-01'),taxApproval);
    assert.deepEqual(await taxMapping(taxApprovalOperation,jurisdiction,'0',taxAccount,'2026-01-02'),
      {state:'conflict',reason:'operation'});
    assert.deepEqual((await readTaxMapping()).latest,{...taxApproval.receipt,operationId:taxApprovalOperation});
    assert.deepEqual(await lookupTaxApproval(),taxApproval);
    assert.deepEqual(await lookupTaxApproval(taxApprovalOperation,newEpoch),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookupTaxApproval(taxApprovalOperation,owner.epoch,foreign),{state:'absent'});
    await assert.rejects(lookupTaxApproval(taxApprovalOperation,owner.epoch,owner,web),{code:'42501'});
    await assert.rejects(taxMapping(randomUUID(),jurisdiction,'0',taxAccount,'2026-01-02'),
      {message:'INVOICE_TAX_MAPPING_VERSION_CONFLICT'});
    await assert.rejects(taxMapping(randomUUID(),jurisdiction,'1',taxAccount,'2026-01-01'),
      {message:'INVOICE_TAX_MAPPING_EFFECTIVE_ORDER_REQUIRED'});
    await assert.rejects(admin.query('DELETE FROM crest.tax_payable_mapping_versions'),{code:'55000'});
    const beforeClosure = (await call(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'3',selected])).reviewDigest;
    const closed = await taxMapping(randomUUID(),jurisdiction,'1',null,'2026-01-02');
    assert.equal(closed.state,'committed');
    assert.equal((await readTaxMapping()).latest.accountId,null);
    assert.deepEqual((await reviewAccounts(selected)).accountReview.requiredTaxJurisdictions,[jurisdiction]);
    assert.deepEqual(await lookupTaxApproval(),taxApproval);
    const reopenedTax = await taxMapping(randomUUID(),jurisdiction,'2',taxAccount,'2026-01-03');
    assert.equal(reopenedTax.state,'committed');
    assert.equal((await taxMapping(randomUUID(),jurisdiction,'3',null,'9999-01-01')).state,'committed');
    const taxablePosting = await reviewAccounts(selected);
    assert.deepEqual(taxablePosting.accountReview.requiredTaxJurisdictions,[]);
    assert.deepEqual(taxablePosting.accountReview.taxMappings,{[jurisdiction]:{
      mappingId:reopenedTax.receipt.id,accountId:taxAccount,accountCode:'2100',
    }});
    assert.equal((await readTaxMapping()).latest.accountId,null);
    await assert.rejects(finance.query('SELECT id FROM crest.invoices'),{ code:'42501' });
    await assert.rejects(finance.query('SELECT id FROM crest.journal_lines'),{ code:'42501' });
    await assert.rejects(finance.query('SELECT id FROM crest.invoice_tax_payable_movements'),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.tax_payable_mapping_versions'),{code:'42501'});
    async function writeInvoiceSource({total, omittedConsumption, alteredPartition, alteredSnapshot, omittedLedger, alteredJournal,
      taxMovementJurisdiction, omittedTaxMovement, mismatchedTaxMapping, wrongTaxJournal}) {
      const sourceReview = taxMovementJurisdiction ? taxablePosting : postingReview;
      await claimIssue();
      await becomeIssueOwner();
      const [{ reservation_id: reservationId, invoice_number: invoiceNumber }] = (await reserveNext(admin)).rows;
      await admin.query('RESET ROLE');
      await admin.query(
        `INSERT INTO crest.invoices(id,business_id,draft_id,draft_revision,job_id,customer_id,reservation_id,invoice_number,
          issued_on,due_on,time_zone,customer_snapshot,location_snapshot,total_cents,currency,created_by,operation_id)
         SELECT $1,j.business_id,$3,3,j.id,c.id,$6,$7,$8,$8,'UTC',
          jsonb_build_object('schemaVersion',1,'id',c.id,'displayName',CASE WHEN $12 THEN 'Altered customer' ELSE c.display_name END),
          j.work_location_snapshot,$9,'USD',$10,$11
         FROM crest.jobs j JOIN crest.customers c ON (c.business_id,c.id)=(j.business_id,j.customer_id)
         WHERE (j.business_id,j.id,c.id)=($2,$4,$5)`,
        [proposedInvoice,owner.business,draft,booking.jobId,owner.customer,reservationId,invoiceNumber,issueDay,total,
          owner.actor,issueOperation,alteredSnapshot??false]);
      const items = [];
      for (const [index,line] of lines.entries()) {
        const { profileId, components: charge } = sourceReview.taxReview.lines.find(row=>row.outcomeId===line.outcomeId);
        const [{ id }] = (await admin.query(
          `INSERT INTO crest.invoice_items(business_id,invoice_id,position,outcome_id,completion_part_id,partition_id,
            agreement_id,entitlement_version_id,service_version_id,tax_profile_id,gross_inclusive_cents,discount_inclusive_cents,
            gross_net_cents,discount_net_cents,net_cents,tax_cents,total_cents,description,created_by,operation_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
          [owner.business,proposedInvoice,index+1,line.outcomeId,line.completionPartId,line.partitionId,line.agreementId,
            line.entitlementVersionId,line.serviceVersionId,profileId,charge.grossInclusiveCents,charge.discountInclusiveCents,
            charge.grossNetCents,charge.discountNetCents,charge.netCents,charge.taxCents,charge.inclusiveCents,
            line.description,owner.actor,issueOperation])).rows;
        items.push({id,charge,profileId});
        if (omittedConsumption && charge.inclusiveCents==='0') continue;
        await admin.query(
          'INSERT INTO crest.billing_consumptions(business_id,invoice_item_id,partition_id,consumed_cents,created_by,operation_id) VALUES($1,$2,$3,$4,$5,$6)',
          [owner.business,id,alteredPartition?randomUUID():line.partitionId,charge.inclusiveCents,owner.actor,issueOperation]);
      }
      const receipt = {schemaVersion:1,invoiceId:proposedInvoice,invoiceNumber};
      await admin.query(`INSERT INTO crest_private.audit_events
        (business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
        VALUES($1,$2,$3,$3,'invoices',$4,1,'issue',$5,'manual')`,
        [owner.business,issueOperation,owner.actor,proposedInvoice,{schemaVersion:1,before:null,after:receipt}]);
      await admin.query(`UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=$3
        WHERE business_id=$1 AND operation_id=$2`,[owner.business,issueOperation,receipt]);
      if (!omittedLedger) {
        const ids = {group:randomUUID(),event:randomUUID(),entry:randomUUID(),ar:randomUUID()};
        await admin.query('INSERT INTO crest.atomic_finance_groups(id,business_id,commit_sequence,recovery_epoch,created_by,operation_id) VALUES($1,$2,1,$3,$4,$5)',
          [ids.group,owner.business,owner.epoch,owner.actor,issueOperation]);
        await admin.query(`INSERT INTO crest.financial_events
          (id,business_id,group_id,event_sequence,invoice_id,period_id,period_generation,effective_on,time_zone,template,template_version)
          VALUES($1,$2,$3,1,$4,$5,2,$6,'UTC','P01',1)`,[ids.event,owner.business,ids.group,proposedInvoice,period,issueDay]);
        await admin.query('INSERT INTO crest.receivable_items(id,business_id,invoice_id,account_id,customer_id,original_cents,due_on) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [ids.ar,owner.business,proposedInvoice,accountId,owner.customer,total,issueDay]);
        await admin.query('INSERT INTO crest.journal_entries(id,business_id,event_id,entry_sequence) VALUES($1,$2,$3,1)',
          [ids.entry,owner.business,ids.event]);
        for (const {id,charge,profileId} of items) {
          for (const [purpose,receivableId,debit,credit] of [
            ['ar',ids.ar,charge.inclusiveCents,'0'],
            ['service_revenue',null,'0',wrongTaxJournal&&charge.taxCents!=='0'?String(BigInt(charge.grossNetCents)+1n):charge.grossNetCents],
          ]) {
            if (debit==='0'&&credit==='0') continue;
            const {mappingId,accountId:postedAccount} = sourceReview.accountReview.fixedMappings[purpose];
            const changedDebit = alteredJournal&&debit!=='0'?String(BigInt(debit)+1n):debit;
            const changedCredit = alteredJournal&&credit!=='0'?String(BigInt(credit)+1n):credit;
            await admin.query(`INSERT INTO crest.journal_lines
              (business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [owner.business,ids.entry,id,receivableId,postedAccount,mappingId,purpose,changedDebit,changedCredit]);
          }
          if(charge.taxCents!=='0'&&!omittedTaxMovement){
            const movement=(await admin.query(`INSERT INTO crest.invoice_tax_payable_movements
              (business_id,event_id,invoice_item_id,tax_profile_id,mapping_id,account_id,jurisdiction,cents)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[owner.business,ids.event,id,profileId,
              mismatchedTaxMapping?taxApproval.receipt.id:reopenedTax.receipt.id,taxAccount,taxMovementJurisdiction,charge.taxCents])).rows[0].id;
            const credit=wrongTaxJournal?String(BigInt(charge.taxCents)-1n):charge.taxCents;
            await admin.query(`INSERT INTO crest.journal_lines
              (business_id,entry_id,invoice_item_id,account_id,tax_payable_movement_id,purpose,debit_cents,credit_cents)
              VALUES($1,$2,$3,$4,$5,'tax_payable',0,$6)`,[owner.business,ids.entry,id,taxAccount,movement,credit]);
          }
        }
      }
      await admin.query('SET CONSTRAINTS ALL IMMEDIATE');
    }
    const total = lines.reduce((amount,line)=>amount+BigInt(line.inclusiveCents),0n);
    for (const [changes,message] of [
      [{total:total+1n},'ISSUED_INVOICE_TOTAL_REQUIRED'],
      [{total,omittedConsumption:true},'ISSUED_INVOICE_SCOPE_AND_CHARGE_REQUIRED'],
      [{total,alteredPartition:true},'ISSUED_INVOICE_SCOPE_AND_CHARGE_REQUIRED'],
      [{total,alteredSnapshot:true},'ISSUED_INVOICE_SOURCE_REQUIRED'],
      [{total,omittedLedger:true},'INVOICE_POSTING_EVENT_REQUIRED'],
      [{total,alteredJournal:true},'INVOICE_JOURNAL_EFFECT_REQUIRED'],
      [{total,taxMovementJurisdiction:jurisdiction,omittedTaxMovement:true},'INVOICE_TAX_PAYABLE_EFFECT_REQUIRED'],
      [{total,taxMovementJurisdiction:ledgerJurisdiction},'INVOICE_TAX_PAYABLE_EFFECT_REQUIRED'],
      [{total,taxMovementJurisdiction:jurisdiction,mismatchedTaxMapping:true},'INVOICE_TAX_PAYABLE_EFFECT_REQUIRED'],
      [{total,taxMovementJurisdiction:jurisdiction,wrongTaxJournal:true},'INVOICE_JOURNAL_EFFECT_REQUIRED'],
    ]) {
      await admin.query('BEGIN');
      try { await assert.rejects(writeInvoiceSource(changes),{message}); }
      finally { await admin.query('ROLLBACK'); }
    }
    await admin.query('BEGIN');
    try {
      await writeInvoiceSource({total});
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM crest.billing_consumptions WHERE consumed_cents=0')).rows[0].n,1);
      await assert.rejects(admin.query('DELETE FROM crest.invoices'),{code:'55000'});
    } finally { await admin.query('ROLLBACK'); }
    const reviewDigest = async selection => {
      const {reviewDigest,...review} = await call(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'3',selection]);
      assert.match(reviewDigest,/^[a-f0-9]{64}$/);
      assert.deepEqual(review,await reviewAccounts(selection));
      return reviewDigest;
    };
    const issue = (operation,selection,digest,connection=finance) => call(connection,'issue_reviewed_invoice',
      [...owner.auth(),owner.epoch,operation,draft,'3',selection,digest]);
    const readIssued = (connection=finance,principal=owner) => call(connection,'read_issued_invoice',[...principal.auth(),draft]);
    const lookupIssue = (operation=issueOperation,epoch=owner.epoch,principal=owner) => call(finance,'lookup_invoice_issue',
      [...principal.auth(),epoch,operation,draft,'3']);
    const retireIssue = operation => call(finance,'retire_invoice_issue',
      [...owner.auth(),owner.epoch,operation,owner.epoch,draft,'3','Verified absent in fictional review']);
    const exemptDistrict = 'Fictional customer exemption district';
    const exemptionProfile=(await call(finance,'approve_finance_tax_profile',[
      ...owner.auth(),owner.epoch,randomUUID(),exemptDistrict,'service',service,'0','2026-01-01',
      'exempt',null,'Fictional exemption policy evidence','Fictional approval',
    ])).receipt.id;
    const exemptionSelection = Object.fromEntries(lines.map(line=>[line.outcomeId,exemptDistrict]));
    const paidOutcome=lines.find(line=>line.inclusiveCents==='25000').outcomeId;
    const courtesyOutcome=lines.find(line=>line.inclusiveCents==='0').outcomeId;
    const approveExemption = ({
      outcome=paidOutcome, profile=exemptionProfile, version='0', from='2026-01-01', through='9999-12-31',
      reference='Fictional exemption evidence reference', reason='Fictional customer and work reviewed',
      district=exemptDistrict, operation=randomUUID(), revision='3', principal=owner, connection=finance,
    }={}) => call(connection,'approve_invoice_exemption_evidence',[
      ...principal.auth(),principal.epoch,operation,draft,revision,outcome,district,profile,version,from,through,reference,reason,
    ]);
    const readExemption = (outcome=paidOutcome,principal=owner,connection=finance) =>
      call(connection,'read_invoice_exemption_evidence',[...principal.auth(),draft,'3',outcome,exemptDistrict,exemptionProfile]);
    assert.equal((await readExemption()).latest,null);
    await assert.rejects(readExemption(paidOutcome,owner,web),{code:'42501'});
    await assert.rejects(finance.query('SELECT id FROM crest.invoice_exemption_evidence'),{code:'42501'});
    const withoutExemption=await reviewDigest(exemptionSelection);
    await assert.rejects(issue(issueOperation,exemptionSelection,withoutExemption),{message:'INVOICE_ISSUE_REVIEW_REQUIRED'});
    await assert.rejects(approveExemption({outcome:randomUUID()}),{message:'INVOICE_EXEMPTION_SCOPE_REQUIRED'});
    await assert.rejects(approveExemption({revision:'2'}),{message:'INVOICE_EXEMPTION_SCOPE_REQUIRED'});
    await assert.rejects(approveExemption({profile:second.receipt.id}),{message:'INVOICE_EXEMPTION_SCOPE_REQUIRED'});
    await assert.rejects(approveExemption({district:jurisdiction}),{message:'INVOICE_EXEMPTION_SCOPE_REQUIRED'});
    await assert.rejects(approveExemption({principal:foreign}),{message:'FINANCE_ACCOUNT_SETUP_REQUIRED'});
    await assert.rejects(approveExemption({connection:web}),{code:'42501'});
    const expiringOperation=randomUUID();
    const expired=await approveExemption({through:'2026-02-01',operation:expiringOperation});
    assert.equal(expired.state,'committed');
    assert.equal(expired.receipt.customerId,owner.customer);
    assert.deepEqual(await approveExemption({through:'2026-02-01',operation:expiringOperation}),expired);
    assert.deepEqual(await approveExemption({through:'2026-02-01',operation:expiringOperation,reason:'Different reason'}),
      {state:'conflict',reason:'operation'});
    assert.deepEqual((await readExemption()).latest,{...expired.receipt,operationId:expiringOperation});
    assert.equal((await readExemption(paidOutcome,foreign)).latest,null);
    assert.equal((await readExemption(courtesyOutcome)).latest,null);
    assert((await review('3',exemptionSelection)).lines.every(line=>line.state==='exemption_review_required'));
    await assert.rejects(approveExemption(),{message:'INVOICE_EXEMPTION_VERSION_CONFLICT'});
    const applicable=await approveExemption({version:'1'});
    const partial=(await review('3',exemptionSelection)).lines;
    const partialPaid=partial.find(line=>line.outcomeId===paidOutcome);
    assert.equal(partialPaid.state,'ready');
    assert.equal(partialPaid.exemptionEvidenceId,applicable.receipt.id);
    assert.equal(partialPaid.exemptionEvidenceVersion,'2');
    assert.equal(partialPaid.treatment,'exempt');
    assert.equal(partialPaid.components.taxCents,'0');
    assert.equal(partialPaid.components.netCents,'25000');
    assert.equal(partial.find(line=>line.outcomeId===courtesyOutcome).state,'exemption_review_required');
    assert(!JSON.stringify(partial).includes(applicable.receipt.evidenceReference));
    const courtesyEvidence=await approveExemption({outcome:courtesyOutcome});
    const priorExemptionDigest=await reviewDigest(exemptionSelection);
    assert.equal((await approveExemption({version:'2',through:'2026-02-01'})).state,'committed');
    assert.equal((await review('3',exemptionSelection)).lines.find(line=>line.outcomeId===paidOutcome).state,
      'exemption_review_required');
    await assert.rejects(issue(issueOperation,exemptionSelection,priorExemptionDigest),{message:'INVOICE_ISSUE_REVIEW_REQUIRED'});
    const finalExemption=await approveExemption({version:'3'});
    await assert.rejects(issue(issueOperation,exemptionSelection,priorExemptionDigest),{message:'INVOICE_ISSUE_REVIEW_REQUIRED'});
    const exemptionDigest=await reviewDigest(exemptionSelection);
    await finance.query('BEGIN');
    try {
      const exemptInvoice=await issue(issueOperation,exemptionSelection,exemptionDigest);
      assert.equal(exemptInvoice.state,'committed');
      await finance.query('SET CONSTRAINTS ALL IMMEDIATE');
      assert.deepEqual(await issue(issueOperation,exemptionSelection,exemptionDigest),exemptInvoice);
      const saved=(await readIssued()).lines;
      assert.deepEqual(saved.map(line=>[line.inclusiveCents,line.taxCents,line.exemptionEvidenceId]),
        lines.map(line=>[line.inclusiveCents,'0',line.outcomeId===paidOutcome?finalExemption.receipt.id:courtesyEvidence.receipt.id]));
      await finance.query('SET CONSTRAINTS ALL DEFERRED');
      await assert.rejects(approveExemption({version:'4'}),{message:'INVOICE_DRAFT_REVISION_CONFLICT'});
    } finally { await finance.query('ROLLBACK'); }
    await assert.rejects(admin.query('DELETE FROM crest.invoice_exemption_evidence'),{code:'55000'});
    await assert.rejects(issue(issueOperation,selected,beforeClosure),{message:'INVOICE_ISSUE_REVIEW_REQUIRED'});
    const taxableDigest = await reviewDigest(selected);
    await finance.query('BEGIN');
    try {
      const taxable = await issue(issueOperation,selected,taxableDigest);
      assert.equal(taxable.state,'committed');
      assert.equal(taxable.receipt.invoiceNumber,'TEST-3');
      assert.deepEqual(await issue(issueOperation,selected,taxableDigest),taxable);
      await finance.query('SET CONSTRAINTS ALL IMMEDIATE');
      const retained = await readIssued();
      assert.equal(retained.lines.find(line=>line.inclusiveCents==='25000').taxCents,'2273');
    } finally { await finance.query('ROLLBACK'); }
    await admin.query('BEGIN');
    try {
      await writeInvoiceSource({total,taxMovementJurisdiction:jurisdiction});
      const {rows:taxRows}=await admin.query(`SELECT t.jurisdiction,t.mapping_id,t.account_id,t.tax_profile_id,
        t.cents::text,l.debit_cents::text,l.credit_cents::text
       FROM crest.invoice_tax_payable_movements t JOIN crest.journal_lines l
       ON (l.business_id,l.tax_payable_movement_id)=(t.business_id,t.id) WHERE t.business_id=$1`,[owner.business]);
      assert.deepEqual(taxRows,[{jurisdiction,mapping_id:reopenedTax.receipt.id,account_id:taxAccount,
        tax_profile_id:second.receipt.id,cents:'2273',debit_cents:'0',credit_cents:'2273'}]);
    } finally { await admin.query('ROLLBACK'); }
    const confirmedDigest = await reviewDigest(postingSelection);
    assert.deepEqual(await readIssued(),{state:'absent'});
    assert.deepEqual(await lookupIssue(),{state:'absent'});
    const absentOperation = randomUUID();
    const retired = await retireIssue(absentOperation);
    assert.equal(retired.state,'retired');
    assert.deepEqual(await lookupIssue(absentOperation),retired);
    assert.deepEqual(await issue(absentOperation,postingSelection,confirmedDigest),{state:'conflict',reason:'operation'});
    assert.deepEqual(await readIssued(),{state:'absent'});
    await assert.rejects(issue(issueOperation,postingSelection,confirmedDigest,web),{code:'42501'});
    await assert.rejects(issue(issueOperation,postingSelection,'0'.repeat(64)),{message:'INVOICE_ISSUE_REVIEW_REQUIRED'});
    const issued = await issue(issueOperation,postingSelection,confirmedDigest);
    assert.equal(issued.state,'committed');
    assert.equal(issued.receipt.invoiceNumber,'TEST-3');
    assert.equal(issued.receipt.totalCents,String(total));
    assert.deepEqual(await issue(issueOperation,postingSelection,confirmedDigest),issued);
    assert.deepEqual(await lookupIssue(),issued);
    assert.deepEqual(await retireIssue(issueOperation),issued);
    assert.deepEqual(await lookupIssue(issueOperation,newEpoch),{state:'conflict',reason:'operation'});
    assert.deepEqual(await lookupIssue(issueOperation,owner.epoch,foreign),{state:'absent'});
    const savedInvoice = await readIssued();
    assert.equal(savedInvoice.invoiceId,issued.receipt.invoiceId);
    assert.equal(savedInvoice.invoiceNumber,issued.receipt.invoiceNumber);
    assert.equal(savedInvoice.totalCents,String(total));
    assert.equal(savedInvoice.currency,'USD');
    assert.equal(savedInvoice.lines.length,lines.length);
    assert.equal(savedInvoice.customer.displayName,'Synthetic lifecycle customer');
    assert.deepEqual(await readIssued(finance,foreign),{state:'absent'});
    await assert.rejects(readIssued(web),{code:'42501'});
    assert.deepEqual(await issue(issueOperation,postingSelection,'0'.repeat(64)),{state:'conflict',reason:'operation'});
    await assert.rejects(issue(randomUUID(),postingSelection,confirmedDigest),{message:'INVOICE_ISSUE_DRAFT_REQUIRED'});
    const attemptedCancellation = await save('3', [], null, 'Fictional cancellation');
    assert.equal(attemptedCancellation.state,'conflict');
    assert.deepEqual((await admin.query(
      'SELECT sum(debit_cents)::text debits,sum(credit_cents)::text credits,count(*)::int AS n FROM crest.journal_lines WHERE business_id=$1',
      [owner.business])).rows,[{debits:String(total),credits:String(total),n:2}]);
  } finally {
    await sandbox?.close();
    await cluster.close();
  }
});
