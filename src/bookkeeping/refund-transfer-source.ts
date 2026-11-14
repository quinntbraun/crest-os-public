import { createHash } from 'node:crypto';
import { customerDate, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';

const adjustmentFields = ['id', 'business_id', 'kind', 'prior_event_id', 'original_event_id', 'fund_lot_id', 'channel_version_id',
  'account_id', 'evidence_id', 'actual_on', 'cents', 'confirmation', 'reason', 'operation_id', 'created_by', 'created_at'] as const;
const rangeFields = ['id', 'business_id', 'adjustment_id', 'prior_event_id', 'first_cent', 'last_cent'] as const;
const groups = ['refund_transfer_adjustments', 'refund_transfer_adjustment_ranges', 'financial_events', 'atomic_finance_groups',
  'journal_entries', 'journal_lines', 'money_movements', 'external_money_evidence'] as const;
type Group = typeof groups[number];
type Row = Readonly<Record<string, unknown>>;
type SourceRow = Readonly<Record<string, string | null>>;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const command = 'finance.refund.adjust_transfer';
const retirement = 'finance.refund.retire_transfer';

function check(value: unknown): asserts value {
  if (!value) throw Error('REFUND_TRANSFER_SOURCE_REVIEW_REQUIRED');
}

export const refundTransferSourceCoverage = Object.freeze([
  { table: 'crest.refund_transfer_adjustments', scope: 'business' as const, required: adjustmentFields, excluded: [], partialEvidenceGroup: null },
  { table: 'crest.refund_transfer_adjustment_ranges', scope: 'business' as const, required: rangeFields, excluded: [], partialEvidenceGroup: null },
]);
export const refundTransferSourceAddedColumns = Object.freeze({
  'crest.financial_events': ['refund_transfer_adjustment_id'],
  'crest.journal_lines': ['refund_transfer_adjustment_id'],
});
export const isRefundTransferOperation = (row: Row) => (row.command_type === command || row.command_type === retirement) && row.state === 'committed';

export async function captureRefundTransferSource(businessId: string, query: (sql: string, args: unknown[]) => Promise<unknown[]>) {
  check(customerUuid(businessId));
  const result = await query('SELECT crest_commands.refund_transfer_source_snapshot($1::uuid) AS result', [businessId]);
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
    snapshotToken: digest('crest.refund-transfer-source.v1:' + snapshot.historySnapshotToken) };
}

function index(rows: readonly Row[], key = 'id') {
  const result = new Map(rows.map(row => [row[key], row]));
  check(result.size === rows.length);
  return result;
}

function group(rows: readonly Row[], key: string) {
  const result = new Map<unknown, Row[]>();
  for (const row of rows) {
    const peers = result.get(row[key]) ?? [];
    peers.push(row);
    result.set(row[key], peers);
  }
  return result;
}

function cents(value: unknown) {
  check(isFinanceCents(value));
  return BigInt(value);
}

type Range = { first: bigint; last: bigint };
const offsets = (row: Row): Range => ({ first: cents(row.first_cent), last: cents(row.last_cent) });
const obligation = { P08: 'service', P09: 'excess', P10: 'tip_return_due' } as const;

function parseHistory(operation: Row, audit: Row) {
  check(typeof operation.result === 'string' && typeof audit.delta === 'string');
  const result: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
  check(exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
    && JSON.stringify(delta.after) === JSON.stringify(result));
  return result;
}

export function verifyRefundTransferSourceClosure(read: (table: string) => readonly Row[],
  history: Readonly<{ operation: readonly Row[]; audit_event: readonly Row[] }>) {
  const adjustments = index(read('refund_transfer_adjustments')), ranges = read('refund_transfer_adjustment_ranges');
  const rangesByAdjustment = group(ranges, 'adjustment_id');
  const events = read('financial_events'), eventById = index(events), groupsById = index(read('atomic_finance_groups'));
  const adjustmentEvents = index(events.filter(row => row.refund_transfer_adjustment_id !== null), 'refund_transfer_adjustment_id');
  const serviceRefunds = index(read('service_credit_refunds')), excessReturns = index(read('excess_receipt_returns'));
  const tips = index(read('tip_realizations')), tipReturns = index(read('tip_returns'));
  const tipRanges = group(read('tip_realization_range_consumptions').filter(row => row.tip_return_id !== null), 'tip_return_id');
  const lots = index(read('customer_fund_lots')), roots = index(read('funding_origins'));
  const lines = read('journal_lines'), linesByEntry = group(lines, 'entry_id'), entries = group(read('journal_entries'), 'event_id');
  const movements = index(read('money_movements'), 'event_id'), evidence = index(read('external_money_evidence'));
  const operations = index(history.operation.filter(row => row.command_type === command && row.state === 'committed'), 'operation_id');
  const audits = index(history.audit_event.filter(row => row.entity_kind === 'refund_transfer_adjustments'
    && row.action === 'adjust_refund_transfer'), 'operation_id');
  const counted = new Set<unknown>(), usedEvidence = new Set<unknown>();
  check(adjustmentEvents.size === adjustments.size && rangesByAdjustment.size === adjustments.size
    && operations.size === adjustments.size && audits.size === adjustments.size);
  check(events.every(row => row.template_version === (row.refund_transfer_adjustment_id === null ? '1' : '2')));

  for (const portions of group(ranges, 'prior_event_id').values()) {
    let previous = 0n;
    for (const range of portions.map(offsets).sort((a,b) => a.first < b.first ? -1 : 1)) {
      check(range.first > previous && range.last >= range.first);
      previous = range.last;
    }
  }
  for (const [id, saved] of adjustments) {
    const event = adjustmentEvents.get(id), prior = eventById.get(saved.prior_event_id), original = eventById.get(saved.original_event_id);
    const posting = event && groupsById.get(event.group_id), priorPosting = prior && groupsById.get(prior.group_id);
    const lot = lots.get(saved.fund_lot_id), root = lot && roots.get(lot.origin_id);
    const operation = operations.get(saved.operation_id), audit = audits.get(saved.operation_id);
    check(event && prior && original && posting && priorPosting && lot && root && root.customer_id === lot.customer_id
      && event.template_version === '2' && original.template_version === '1' && event.template === prior.template
      && event.template === original.template && (event.template === 'P08' || event.template === 'P09' || event.template === 'P10')
      && event.event_sequence === '1' && event.effective_on === saved.actual_on && customerDate(saved.actual_on)
      && customerDate(prior.effective_on) && saved.actual_on >= prior.effective_on
      && posting.operation_id === saved.operation_id && posting.created_by === saved.created_by
      && cents(posting.commit_sequence) > cents(priorPosting.commit_sequence)
      && ['invoice_id','payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id',
        'invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id','zero_effect_reason']
        .every(field => event[field] === null)
      && (saved.kind === 'recredit' || saved.kind === 'retry')
      && operation && audit && operation.actor_id === saved.created_by && posting.recovery_epoch === operation.recovery_epoch
      && audit.entity_id === id && audit.entity_version === '1' && audit.actor_id === saved.created_by && audit.reason === saved.reason);

    let priorRanges: Range[];
    if (prior.template_version === '1') {
      check(saved.kind === 'recredit' && prior.id === original.id);
      if (prior.template === 'P10') {
        const refund = tipReturns.get(prior.tip_return_id), tip = refund && tips.get(refund.tip_realization_id);
        check(refund && tip && tip.fund_lot_id === lot.id);
        const start = cents(tip.first_cent) - 1n;
        const consumed = tipRanges.get(refund.id);
        check(consumed?.length);
        priorRanges = consumed.map(row => ({first:start+cents(row.first_cent),last:start+cents(row.last_cent)}));
      } else {
        const refund = prior.template === 'P08' ? serviceRefunds.get(prior.service_refund_id) : excessReturns.get(prior.excess_return_id);
        check(refund?.fund_lot_id === lot.id);
        priorRanges = [offsets(refund!)];
      }
    } else {
      const predecessor = adjustments.get(prior.refund_transfer_adjustment_id);
      check(predecessor && predecessor.kind !== saved.kind && predecessor.original_event_id === original.id && predecessor.fund_lot_id === lot.id);
      const consumed = rangesByAdjustment.get(predecessor.id);
      check(consumed?.length);
      priorRanges = consumed.map(offsets);
    }
    const selected = rangesByAdjustment.get(id);
    check(selected && selected.length >= 1 && selected.length <= 180 && selected.every(row => row.prior_event_id === prior.id));
    const portions = selected.map(offsets).sort((a,b) => a.first < b.first ? -1 : 1);
    const total = portions.reduce((sum,row)=>sum+row.last-row.first+1n,0n);
    check(total > 0n && total === cents(saved.cents) && portions.every(row => row.last <= cents(root.cents)
      && priorRanges.some(source => row.first >= source.first && row.last <= source.last)));

    const movement = movements.get(event.id), proof = movement && evidence.get(movement.evidence_id);
    const amount = saved.kind === 'recredit' ? total : -total;
    check(movement && proof && !usedEvidence.has(proof.id) && movement.account_id === saved.account_id
      && movement.evidence_id === saved.evidence_id && proof.external_account_id === saved.account_id
      && proof.confirmed_on === saved.actual_on && proof.currency === 'USD' && proof.normalization_rule === 'exact_case_v1'
      && proof.signed_cents === String(amount) && movement.signed_cents === proof.signed_cents);
    usedEvidence.add(proof.id);
    const journal = entries.get(event.id);
    check(journal?.length === 1 && journal[0]!.entry_sequence === '1');
    const posted = linesByEntry.get(journal[0]!.id);
    check(posted?.length === 2 && posted.every(line => line.refund_transfer_adjustment_id === id
      && ['invoice_item_id','receivable_id','tax_payable_movement_id','allocation_event_id','unapplication_id','fund_application_id',
        'tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id',
        'collection_failure_component_id'].every(field => line[field] === null)));
    const cash = posted.find(line => line.purpose === 'refund_transfer_money'), funds = posted.find(line => line.purpose === 'refund_transfer_funds');
    const debit = amount > 0n ? saved.cents : '0', credit = amount < 0n ? saved.cents : '0';
    check(cash && funds && cash.account_id === saved.account_id && cash.money_movement_id === movement.id
      && cash.fixed_mapping_id === null && cash.fund_lot_id === null && cash.debit_cents === debit && cash.credit_cents === credit
      && funds.account_id === lot.account_id && funds.fixed_mapping_id === lot.mapping_id && funds.fund_lot_id === lot.id
      && funds.money_movement_id === null && funds.debit_cents === credit && funds.credit_cents === debit);
    posted.forEach(line => counted.add(line.id));

    const receipt = parseHistory(operation,audit);
    check(exact(receipt,['schemaVersion','businessId','refundTransferAdjustmentId','operationId','eventId','originalEventId','priorEventId',
      'originalTemplate','obligationType','kind','fundLotId','fundingOriginId','customerId','fundsAccountId','fundsMappingId',
      'moneyAccountId','moneyChannelId','moneyChannelVersion','moneyMovementId','evidenceId','actualOn','cents','confirmation','reason','ranges'])
      && receipt.schemaVersion === 1 && receipt.businessId === saved.business_id && receipt.refundTransferAdjustmentId === id
      && receipt.operationId === saved.operation_id && receipt.eventId === event.id && receipt.originalEventId === original.id
      && receipt.priorEventId === prior.id && receipt.originalTemplate === event.template && receipt.obligationType === obligation[event.template]
      && receipt.kind === saved.kind && receipt.fundLotId === lot.id && receipt.fundingOriginId === root.id && receipt.customerId === lot.customer_id
      && receipt.fundsAccountId === lot.account_id && receipt.fundsMappingId === lot.mapping_id && receipt.moneyAccountId === saved.account_id
      && customerUuid(receipt.moneyChannelId) && cents(receipt.moneyChannelVersion) > 0n
      && receipt.moneyMovementId === movement.id && receipt.evidenceId === proof.id && receipt.actualOn === saved.actual_on
      && receipt.cents === saved.cents && receipt.confirmation === saved.confirmation && receipt.reason === saved.reason
      && Array.isArray(receipt.ranges) && receipt.ranges.length === portions.length
      && receipt.ranges.every((row,position) => exact(row,['firstCent','lastCent'])
        && row.firstCent === String(portions[position]!.first) && row.lastCent === String(portions[position]!.last)));
  }

  check(lines.every(line => line.refund_transfer_adjustment_id === null
    ? line.purpose !== 'refund_transfer_money' && line.purpose !== 'refund_transfer_funds' : counted.has(line.id)));
  const retired = index(history.operation.filter(row => row.command_type === retirement && row.state === 'committed'), 'operation_id');
  const retirementAudits = index(history.audit_event.filter(row => row.entity_kind === 'operations'
    && row.action === 'retire' && retired.has(row.operation_id)), 'operation_id');
  check(retirementAudits.size === retired.size);
  for (const [id, operation] of retired) {
    const audit = retirementAudits.get(id);
    check(audit && audit.entity_id === operation.id && audit.entity_version === '1' && audit.actor_id === operation.actor_id);
    const receipt = parseHistory(operation,audit);
    check(exact(receipt,['schemaVersion','businessId','operationId','refundTransferAdjustmentId','originalEpoch','reviewEpoch','reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === operation.business_id && receipt.operationId === id
      && customerUuid(receipt.refundTransferAdjustmentId) && customerUuid(receipt.originalEpoch) && receipt.reviewEpoch === operation.recovery_epoch
      && typeof receipt.reason === 'string' && receipt.reason === audit.reason);
  }
}
