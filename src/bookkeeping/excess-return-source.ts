import { createHash } from 'node:crypto';
import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';

const returnColumns = ['id', 'business_id', 'receipt_event_id', 'fund_lot_id', 'first_cent', 'last_cent', 'cents', 'channel_version_id',
  'account_id', 'evidence_id', 'actual_on', 'confirmation', 'reason', 'operation_id', 'created_by', 'created_at'] as const;
const groups = ['excess_receipt_returns', 'fund_lot_range_consumptions', 'financial_events', 'atomic_finance_groups',
  'journal_entries', 'journal_lines', 'money_movements', 'external_money_evidence'] as const;
type Group = typeof groups[number];
type Row = Readonly<Record<string, unknown>>;
type SourceRow = Readonly<Record<string, string | null>>;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function check(value: unknown): asserts value {
  if (!value) throw Error('EXCESS_RETURN_SOURCE_REVIEW_REQUIRED');
}

export const excessReturnSourceCoverage = Object.freeze({
  table: 'crest.excess_receipt_returns', scope: 'business' as const, required: returnColumns, excluded: [], partialEvidenceGroup: null,
});
export const excessReturnSourceAddedColumns = Object.freeze({
  'crest.financial_events': ['excess_return_id'],
  'crest.journal_lines': ['excess_return_id'],
  'crest.fund_lot_range_consumptions': ['excess_return_id'],
});

export async function captureExcessReturnSource(businessId: string, query: (sql: string, args: unknown[]) => Promise<unknown[]>) {
  check(customerUuid(businessId));
  const result = await query('SELECT crest_commands.excess_return_source_snapshot($1::uuid) AS result', [businessId]);
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
    snapshotToken: digest('crest.excess-return-source.v1:' + snapshot.historySnapshotToken) };
}

function index(rows: readonly Row[], field = 'id') {
  const indexed = new Map(rows.map(row => [row[field], row]));
  check(indexed.size === rows.length);
  return indexed;
}

function cents(value: unknown) {
  check(isFinanceCents(value));
  return BigInt(value);
}

const recordCommand = 'finance.refund.record_excess';
const retireCommand = 'finance.refund.retire_excess';
export const isExcessReturnOperation = (row: Row) =>
  (row.command_type === recordCommand || row.command_type === retireCommand) && row.state === 'committed';

function verifyRetirementHistory(history: Readonly<{ operation: readonly Row[]; audit_event: readonly Row[] }>) {
  const retired = index(history.operation.filter(row => row.command_type === retireCommand && row.state === 'committed'), 'operation_id');
  const audits = index(history.audit_event.filter(row => row.entity_kind === 'operations' && row.action === 'retire'
    && retired.has(row.operation_id)), 'operation_id');
  check(audits.size === retired.size);
  for (const [id, operation] of retired) {
    const audit = audits.get(id);
    check(audit && audit.entity_id === operation.id && audit.entity_version === '1' && audit.actor_id === operation.actor_id
      && typeof audit.delta === 'string' && typeof operation.result === 'string');
    const result: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
    check(exact(result, ['schemaVersion', 'businessId', 'operationId', 'excessReturnId', 'originalEpoch', 'reviewEpoch', 'reason'])
      && result.schemaVersion === 1 && result.businessId === operation.business_id && result.operationId === id
      && customerUuid(result.excessReturnId) && customerUuid(result.originalEpoch) && result.reviewEpoch === operation.recovery_epoch
      && typeof result.reason === 'string' && result.reason === audit.reason
      && exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
      && JSON.stringify(delta.after) === JSON.stringify(result));
  }
}

export function verifyExcessReturnSourceClosure(read: (group: string) => readonly Row[],
  history: Readonly<{ operation: readonly Row[]; audit_event: readonly Row[] }>) {
  const returns = read('excess_receipt_returns'), lots = index(read('customer_fund_lots'));
  const roots = index(read('funding_origins')), partitions = index(read('funding_partitions')), payments = index(read('payments'));
  const events = index(read('financial_events')), outflows = index(read('financial_events').filter(row => row.template === 'P09'), 'excess_return_id');
  const ranges = read('fund_lot_range_consumptions'), claims = index(ranges.filter(row => row.excess_return_id !== null), 'excess_return_id');
  const groupsById = index(read('atomic_finance_groups')), movement = index(read('money_movements'), 'event_id');
  const evidence = index(read('external_money_evidence'));
  const operations = index(history.operation.filter(row => row.command_type === recordCommand && row.state === 'committed'), 'operation_id');
  const entries = read('journal_entries'), lines = read('journal_lines'), seenLines = new Set<unknown>(), seenEvidence = new Set<unknown>();
  const audits = index(history.audit_event.filter(row => row.entity_kind === 'excess_receipt_returns' && row.action === 'record_return'), 'operation_id');
  check(outflows.size === returns.length && claims.size === returns.length && operations.size === returns.length && audits.size === returns.length);
  for (const recorded of returns) {
    const lot = lots.get(recorded.fund_lot_id), origin = lot && roots.get(lot.origin_id), partition = lot && partitions.get(lot.parent_partition_id);
    const original = events.get(recorded.receipt_event_id), payment = original && payments.get(original.payment_id);
    const claim = claims.get(recorded.id), event = outflows.get(recorded.id), group = event && groupsById.get(event.group_id);
    const originalGroup = original && groupsById.get(original.group_id);
    check(lot && origin && partition && original && payment && claim && event && group && originalGroup
      && original.template === 'P03' && original.event_sequence === '1' && original.id === lot.receipt_event_id && lot.unapplication_id === null
      && origin.payment_id === payment.id && origin.customer_id === lot.customer_id && payment.customer_id === lot.customer_id
      && partition.origin_id === origin.id && partition.last_cent === origin.cents
      && cents(partition.last_cent) - cents(partition.first_cent) + 1n === cents(lot.original_cents)
      && claim.fund_lot_id === lot.id && claim.first_cent === recorded.first_cent && claim.last_cent === recorded.last_cent
      && claim.fund_application_id === null && claim.tip_realization_id === null && claim.service_refund_id === null
      && group.operation_id === recorded.operation_id && group.created_by === recorded.created_by
      && cents(group.commit_sequence) > cents(originalGroup.commit_sequence) && typeof original.effective_on === 'string'
      && typeof event.effective_on === 'string' && event.effective_on === recorded.actual_on && event.effective_on >= original.effective_on
      && event.event_sequence === '1' && event.template_version === '1' && event.zero_effect_reason === null
      && event.invoice_id === null && event.payment_id === null && event.posted_expense_id === null && event.unapplication_id === null
      && event.fund_application_id === null && event.tip_realization_id === null && event.invoice_credit_id === null && event.service_refund_id === null);
    const first = cents(recorded.first_cent), last = cents(recorded.last_cent), amount = cents(recorded.cents);
    check(amount > 0n && amount === last - first + 1n && first >= cents(partition.first_cent) && last <= cents(partition.last_cent));
    check(ranges.every(other => other.fund_lot_id !== lot.id || other.id === claim.id || cents(other.last_cent) < first || cents(other.first_cent) > last));
    const money = movement.get(event.id), proof = money && evidence.get(money.evidence_id);
    check(money && proof && !seenEvidence.has(proof.id) && money.account_id === recorded.account_id && money.evidence_id === recorded.evidence_id
      && proof.external_account_id === recorded.account_id && proof.confirmed_on === recorded.actual_on && proof.currency === 'USD'
      && proof.normalization_rule === 'exact_case_v1' && proof.signed_cents === String(-amount) && money.signed_cents === proof.signed_cents);
    seenEvidence.add(proof.id);
    const journal = entries.filter(entry => entry.event_id === event.id);
    check(journal.length === 1 && journal[0]!.entry_sequence === '1');
    const posted = lines.filter(line => line.entry_id === journal[0]!.id);
    check(posted.length === 2 && posted.every(line => line.excess_return_id === recorded.id && line.service_refund_id === null
      && line.invoice_item_id === null && line.receivable_id === null && line.allocation_event_id === null
      && line.tax_payable_movement_id === null && line.unapplication_id === null && line.fund_application_id === null
      && line.tip_realization_id === null && line.invoice_credit_id === null));
    const debit = posted.find(line => line.purpose === 'excess_return_funds'), credit = posted.find(line => line.purpose === 'excess_return_money');
    check(debit && credit && debit.fund_lot_id === lot.id && debit.account_id === lot.account_id && debit.fixed_mapping_id === lot.mapping_id
      && debit.debit_cents === recorded.cents && debit.credit_cents === '0' && debit.money_movement_id === null
      && credit.money_movement_id === money.id && credit.account_id === money.account_id && credit.credit_cents === recorded.cents
      && credit.debit_cents === '0' && credit.fund_lot_id === null && credit.fixed_mapping_id === null && credit.account_id !== debit.account_id);
    posted.forEach(line => seenLines.add(line.id));

    const operation = operations.get(recorded.operation_id), audit = audits.get(recorded.operation_id);
    check(operation && audit && operation.actor_id === recorded.created_by && group.recovery_epoch === operation.recovery_epoch
      && audit.entity_id === recorded.id && audit.entity_version === '1' && audit.actor_id === recorded.created_by && audit.reason === recorded.reason
      && typeof operation.result === 'string' && typeof audit.delta === 'string');
    const receipt: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
    check(exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
      && JSON.stringify(delta.after) === JSON.stringify(receipt)
      && exact(receipt, ['schemaVersion', 'businessId', 'excessReturnId', 'operationId', 'eventId', 'originalPaymentId', 'originalReceiptEventId',
        'fundLotId', 'fundingOriginId', 'parentPartitionId', 'customerId', 'fundsAccountId', 'fundsMappingId', 'moneyAccountId',
        'moneyMovementId', 'moneyChannelId', 'moneyChannelVersion', 'evidenceId', 'actualOn', 'firstCent', 'lastCent', 'cents', 'confirmation', 'reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === recorded.business_id && receipt.excessReturnId === recorded.id
      && receipt.operationId === recorded.operation_id && receipt.eventId === event.id && receipt.originalPaymentId === payment.id
      && receipt.originalReceiptEventId === original.id && receipt.fundLotId === lot.id && receipt.fundingOriginId === origin.id
      && receipt.parentPartitionId === partition.id && receipt.customerId === lot.customer_id
      && receipt.fundsAccountId === lot.account_id && receipt.fundsMappingId === lot.mapping_id && receipt.moneyAccountId === money.account_id
      && receipt.moneyMovementId === money.id && customerUuid(receipt.moneyChannelId) && cents(receipt.moneyChannelVersion) > 0n
      && receipt.evidenceId === proof.id && receipt.actualOn === recorded.actual_on && receipt.firstCent === recorded.first_cent
      && receipt.lastCent === recorded.last_cent && receipt.cents === recorded.cents && receipt.confirmation === recorded.confirmation && receipt.reason === recorded.reason);
  }
  check([...events.values()].every(event => event.template === 'P09' || event.excess_return_id === null)
    && lines.every(line => line.excess_return_id === null
      ? line.purpose !== 'excess_return_funds' && line.purpose !== 'excess_return_money'
      : seenLines.has(line.id)));
  verifyRetirementHistory(history);
}
