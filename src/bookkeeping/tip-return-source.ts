import { createHash } from 'node:crypto';
import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { creditRangeComponents } from './credit-ranges.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';

const returnFields = ['id', 'business_id', 'tip_realization_id', 'channel_version_id', 'account_id', 'evidence_id', 'actual_on',
  'cents', 'net_cents', 'tax_cents', 'confirmation', 'reason', 'operation_id', 'created_by', 'created_at'] as const;
const rangeFields = ['id', 'business_id', 'tip_realization_id', 'tip_return_id', 'first_cent', 'last_cent'] as const;
const groups = ['tip_returns', 'tip_realization_range_consumptions', 'financial_events', 'atomic_finance_groups',
  'journal_entries', 'journal_lines', 'money_movements', 'external_money_evidence'] as const;
type Group = typeof groups[number];
type Row = Readonly<Record<string, unknown>>;
type SourceRow = Readonly<Record<string, string | null>>;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const command = 'finance.refund.record_tip';
const retirement = 'finance.refund.retire_tip';

function check(value: unknown): asserts value {
  if (!value) throw Error('TIP_RETURN_SOURCE_REVIEW_REQUIRED');
}

export const tipReturnSourceCoverage = Object.freeze([
  { table: 'crest.tip_returns', scope: 'business' as const, required: returnFields, excluded: [], partialEvidenceGroup: null },
  { table: 'crest.tip_realization_range_consumptions', scope: 'business' as const, required: rangeFields, excluded: [], partialEvidenceGroup: null },
]);
export const tipReturnSourceAddedColumns = Object.freeze({
  'crest.financial_events': ['tip_return_id'],
  'crest.journal_lines': ['tip_return_id'],
});
export const isTipReturnOperation = (row: Row) => (row.command_type === command || row.command_type === retirement) && row.state === 'committed';

export async function captureTipReturnSource(businessId: string, query: (sql: string, args: unknown[]) => Promise<unknown[]>) {
  check(customerUuid(businessId));
  const result = await query('SELECT crest_commands.tip_return_source_snapshot($1::uuid) AS result', [businessId]);
  check(result.length === 1 && exact(result[0], ['result']));
  const snapshot = result[0].result;
  check(exact(snapshot, ['schemaVersion', 'businessId', 'historySnapshotToken', 'rows']) && snapshot.schemaVersion === 1
    && snapshot.businessId === businessId && typeof snapshot.historySnapshotToken === 'string' && /^[a-f0-9]{64}$/.test(snapshot.historySnapshotToken)
    && exact(snapshot.rows, groups) && Buffer.byteLength(JSON.stringify(snapshot)) <= 4 * 1024 * 1024 + 512);
  const rows = {} as Record<Group, readonly SourceRow[]>;
  let count = 0;
  for (const group of groups) {
    const page = snapshot.rows[group];
    check(Array.isArray(page));
    count += page.length;
    check(count <= 1000);
    let last = '';
    rows[group] = page.map((row: unknown) => {
      check(row !== null && typeof row === 'object' && !Array.isArray(row) && 'id' in row && customerUuid(row.id) && row.id > last
        && 'business_id' in row && row.business_id === businessId && Object.values(row).every(cell => cell === null || typeof cell === 'string'));
      last = row.id;
      return row as SourceRow;
    });
  }
  return { rows, historySnapshotToken: snapshot.historySnapshotToken,
    snapshotToken: digest('crest.tip-return-source.v1:' + snapshot.historySnapshotToken) };
}

function index(rows: readonly Row[], key = 'id') {
  const result = new Map(rows.map(row => [row[key], row]));
  check(result.size === rows.length);
  return result;
}

function cents(value: unknown) {
  check(isFinanceCents(value));
  return BigInt(value);
}

function group(rows: readonly Row[], key: string) {
  const groups = new Map<unknown, Row[]>();
  for (const row of rows) {
    const previous = groups.get(row[key]) ?? [];
    previous.push(row);
    groups.set(row[key], previous);
  }
  return groups;
}

export function verifyTipReturnSourceClosure(read: (group: string) => readonly Row[],
  history: Readonly<{ operation: readonly Row[]; audit_event: readonly Row[] }>) {
  const returns = index(read('tip_returns')), tips = index(read('tip_realizations')), lots = index(read('customer_fund_lots'));
  const groupsById = index(read('atomic_finance_groups')), events = read('financial_events');
  const tipEvents = index(events.filter(row => row.template === 'P06'), 'tip_realization_id');
  const returnEvents = index(events.filter(row => row.template === 'P10'), 'tip_return_id');
  const ranges = read('tip_realization_range_consumptions'), rangesByReturn = group(ranges, 'tip_return_id');
  const movements = index(read('money_movements'), 'event_id'), evidence = index(read('external_money_evidence'));
  const entries = group(read('journal_entries'), 'event_id'), lines = read('journal_lines'), linesByEntry = group(lines, 'entry_id');
  const operations = index(history.operation.filter(row => row.command_type === command && row.state === 'committed'), 'operation_id');
  const audits = index(history.audit_event.filter(row => row.entity_kind === 'tip_returns' && row.action === 'record_return'), 'operation_id');
  const seen = new Set<unknown>(), usedEvidence = new Set<unknown>();
  check(returnEvents.size === returns.size && rangesByReturn.size === returns.size && operations.size === returns.size && audits.size === returns.size);
  check(events.every(row => row.template === 'P10' || row.tip_return_id === null));

  for (const [tipId, portions] of group(ranges, 'tip_realization_id')) {
    const original = tips.get(tipId);
    check(original);
    const ordered = portions.map(row => ({ first: cents(row.first_cent), last: cents(row.last_cent) })).sort((a, b) => a.first < b.first ? -1 : 1);
    creditRangeComponents({ inclusiveCents: cents(original.inclusive_cents), netCents: cents(original.net_cents),
      taxCents: cents(original.tax_cents), discountCents: 0n }, ordered);
  }

  for (const [id, saved] of returns) {
    const event = returnEvents.get(id), tip = tips.get(saved.tip_realization_id), original = tip && tipEvents.get(tip.id);
    const lot = tip && lots.get(tip.fund_lot_id), posting = event && groupsById.get(event.group_id);
    const originalPosting = original && groupsById.get(original.group_id);
    check(event && tip && original && lot && posting && originalPosting && event.event_sequence === '1' && event.template_version === '1'
      && event.invoice_id === null && event.payment_id === null && event.posted_expense_id === null && event.unapplication_id === null
      && event.fund_application_id === null && event.tip_realization_id === null && event.invoice_credit_id === null
      && event.service_refund_id === null && event.excess_return_id === null && event.zero_effect_reason === null
      && event.effective_on === saved.actual_on && typeof event.effective_on === 'string' && typeof original.effective_on === 'string'
      && event.effective_on >= original.effective_on && posting.operation_id === saved.operation_id && posting.created_by === saved.created_by
      && cents(posting.commit_sequence) > cents(originalPosting.commit_sequence));

    const rawRanges = rangesByReturn.get(id);
    check(rawRanges && rawRanges.length >= 1 && rawRanges.length <= 180 && rawRanges.every(row => row.tip_realization_id === tip.id));
    const portions = rawRanges.map(row => ({ first: cents(row.first_cent), last: cents(row.last_cent) })).sort((a, b) => a.first < b.first ? -1 : 1);
    const amounts = creditRangeComponents({ inclusiveCents: cents(tip.inclusive_cents), netCents: cents(tip.net_cents),
      taxCents: cents(tip.tax_cents), discountCents: 0n }, portions);
    check(amounts.inclusiveCents === cents(saved.cents) && amounts.netCents === cents(saved.net_cents) && amounts.taxCents === cents(saved.tax_cents));
    const movement = movements.get(event.id), proof = movement && evidence.get(movement.evidence_id);
    check(movement && proof && !usedEvidence.has(proof.id) && movement.account_id === saved.account_id && movement.evidence_id === saved.evidence_id
      && proof.external_account_id === saved.account_id && proof.confirmed_on === saved.actual_on && proof.currency === 'USD'
      && proof.normalization_rule === 'exact_case_v1' && proof.signed_cents === String(-amounts.inclusiveCents) && movement.signed_cents === proof.signed_cents);
    usedEvidence.add(proof.id);

    const journal = entries.get(event.id);
    check(journal?.length === 1 && journal[0]!.entry_sequence === '1');
    const posted = linesByEntry.get(journal[0]!.id);
    check(posted?.length === 1 + Number(amounts.netCents > 0n) + Number(amounts.taxCents > 0n)
      && posted.every(line => line.tip_return_id === id && line.tip_realization_id === null && line.invoice_item_id === null
        && line.receivable_id === null && line.tax_payable_movement_id === null && line.allocation_event_id === null
        && line.fund_lot_id === null && line.unapplication_id === null && line.fund_application_id === null
        && line.invoice_credit_id === null && line.service_refund_id === null && line.excess_return_id === null));
    const byPurpose = index(posted, 'purpose');
    const revenue = byPurpose.get('tip_return_revenue'), tax = byPurpose.get('tip_return_tax'), money = byPurpose.get('tip_return_money');
    check(money && money.account_id === saved.account_id && money.money_movement_id === movement.id && money.fixed_mapping_id === null
      && money.debit_cents === '0' && money.credit_cents === saved.cents
      && (amounts.netCents === 0n ? !revenue : revenue && revenue.account_id === tip.revenue_account_id
        && revenue.fixed_mapping_id === tip.revenue_mapping_id && revenue.debit_cents === saved.net_cents && revenue.credit_cents === '0' && revenue.money_movement_id === null)
      && (amounts.taxCents === 0n ? !tax : tax && tax.account_id === tip.tax_account_id && tax.fixed_mapping_id === null
        && tax.debit_cents === saved.tax_cents && tax.credit_cents === '0' && tax.money_movement_id === null));
    posted.forEach(line => seen.add(line.id));

    const operation = operations.get(saved.operation_id), audit = audits.get(saved.operation_id);
    check(operation && audit && operation.actor_id === saved.created_by && posting.recovery_epoch === operation.recovery_epoch
      && audit.entity_id === id && audit.entity_version === '1' && audit.actor_id === saved.created_by && audit.reason === saved.reason
      && typeof operation.result === 'string' && typeof audit.delta === 'string');
    const receipt: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
    check(exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
      && JSON.stringify(delta.after) === JSON.stringify(receipt)
      && exact(receipt, ['schemaVersion', 'businessId', 'tipReturnId', 'operationId', 'eventId', 'tipRealizationId', 'originalTipEventId',
        'fundLotId', 'fundingOriginId', 'customerId', 'revenueAccountId', 'revenueMappingId', 'taxAccountId', 'taxMappingId', 'taxProfileId',
        'moneyAccountId', 'moneyMovementId', 'moneyChannelId', 'moneyChannelVersion', 'evidenceId', 'actualOn', 'cents', 'netCents', 'taxCents',
        'confirmation', 'reason', 'ranges'])
      && receipt.schemaVersion === 1 && receipt.businessId === saved.business_id && receipt.tipReturnId === id
      && receipt.operationId === saved.operation_id && receipt.eventId === event.id && receipt.tipRealizationId === tip.id
      && receipt.originalTipEventId === original.id && receipt.fundLotId === lot.id && receipt.fundingOriginId === lot.origin_id && receipt.customerId === lot.customer_id
      && receipt.revenueAccountId === tip.revenue_account_id && receipt.revenueMappingId === tip.revenue_mapping_id
      && receipt.taxAccountId === tip.tax_account_id && receipt.taxMappingId === tip.tax_mapping_id && receipt.taxProfileId === tip.tax_profile_id
      && receipt.moneyAccountId === movement.account_id && receipt.moneyMovementId === movement.id
      && customerUuid(receipt.moneyChannelId) && cents(receipt.moneyChannelVersion) > 0n && receipt.evidenceId === proof.id
      && receipt.actualOn === saved.actual_on && receipt.cents === saved.cents && receipt.netCents === saved.net_cents && receipt.taxCents === saved.tax_cents
      && receipt.confirmation === saved.confirmation && receipt.reason === saved.reason
      && Array.isArray(receipt.ranges) && receipt.ranges.length === portions.length && receipt.ranges.every((row, position) =>
        exact(row, ['firstCent', 'lastCent']) && row.firstCent === String(portions[position]!.first) && row.lastCent === String(portions[position]!.last)));
  }
  check(lines.every(line => line.tip_return_id === null
    ? line.purpose !== 'tip_return_revenue' && line.purpose !== 'tip_return_tax' && line.purpose !== 'tip_return_money'
    : seen.has(line.id)));
  const retired = index(history.operation.filter(row => row.command_type === retirement && row.state === 'committed'), 'operation_id');
  const retirementAudits = index(history.audit_event.filter(row => row.entity_kind === 'operations' && row.action === 'retire'
    && retired.has(row.operation_id)), 'operation_id');
  check(retirementAudits.size === retired.size);
  for (const [id, operation] of retired) {
    const audit = retirementAudits.get(id);
    check(audit && audit.entity_id === operation.id && audit.entity_version === '1' && audit.actor_id === operation.actor_id
      && typeof audit.delta === 'string' && typeof operation.result === 'string');
    const result: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
    check(exact(result, ['schemaVersion', 'businessId', 'operationId', 'tipReturnId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && result.schemaVersion === 1 && result.businessId === operation.business_id && result.operationId === id
      && customerUuid(result.tipReturnId) && customerUuid(result.originalEpoch) && result.reviewEpoch === operation.recovery_epoch
      && typeof result.reason === 'string' && result.reason === audit.reason
      && exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
      && JSON.stringify(delta.after) === JSON.stringify(result));
  }
}
