import { createHash } from 'node:crypto';
import { customerDate, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { creditRangeComponents } from './credit-ranges.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';

const failureFields = ['id', 'business_id', 'payment_id', 'original_event_id', 'kind', 'channel_version_id', 'money_account_id',
  'evidence_id', 'effective_on', 'cents', 'confirmation', 'reason', 'operation_id', 'created_by', 'created_at'] as const;
const componentFields = ['id', 'business_id', 'collection_failure_id', 'payment_id', 'allocation_id', 'fund_application_id',
  'fund_lot_id', 'tip_realization_id', 'first_cent', 'last_cent', 'root_first_cent', 'root_last_cent', 'net_cents', 'tax_cents'] as const;
const groups = ['collection_failures', 'collection_failure_components', 'fund_lot_range_consumptions', 'tip_realization_range_consumptions',
  'financial_events', 'atomic_finance_groups', 'journal_entries', 'journal_lines', 'money_movements', 'external_money_evidence'] as const;
type Group = typeof groups[number];
type Row = Readonly<Record<string, unknown>>;
type SourceRow = Readonly<Record<string, string | null>>;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const command = 'finance.collection.adjust';
const retirement = 'finance.collection.retire';

function check(value: unknown): asserts value {
  if (!value) throw Error('COLLECTION_FAILURE_SOURCE_REVIEW_REQUIRED');
}

export const collectionFailureSourceCoverage = Object.freeze([
  { table: 'crest.collection_failures', scope: 'business' as const, required: failureFields, excluded: [], partialEvidenceGroup: null },
  { table: 'crest.collection_failure_components', scope: 'business' as const, required: componentFields, excluded: [], partialEvidenceGroup: null },
]);
export const collectionFailureSourceAddedColumns = Object.freeze({
  'crest.financial_events': ['collection_failure_id'],
  'crest.journal_lines': ['collection_failure_id', 'collection_failure_component_id'],
  'crest.fund_lot_range_consumptions': ['collection_failure_component_id'],
  'crest.tip_realization_range_consumptions': ['collection_failure_component_id'],
});
export const isCollectionFailureOperation = (row: Row) => (row.command_type === command || row.command_type === retirement) && row.state === 'committed';

export async function captureCollectionFailureSource(businessId: string, query: (sql: string, args: unknown[]) => Promise<unknown[]>) {
  check(customerUuid(businessId));
  const result = await query('SELECT crest_commands.collection_failure_source_snapshot($1::uuid) AS result', [businessId]);
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
    snapshotToken: digest('crest.collection-failure-source.v1:' + snapshot.historySnapshotToken) };
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
function offsets(row: Row): Range {
  const first = cents(row.first_cent), last = cents(row.last_cent);
  check(first > 0n && first <= last);
  return { first, last };
}
const overlaps = (a: Range, b: Range) => a.first <= b.last && b.first <= a.last;

function parseHistory(operation: Row, audit: Row) {
  check(typeof operation.result === 'string' && typeof audit.delta === 'string');
  const result: unknown = JSON.parse(operation.result), delta: unknown = JSON.parse(audit.delta);
  check(exact(delta, ['schemaVersion', 'before', 'after']) && delta.schemaVersion === 1 && delta.before === null
    && JSON.stringify(delta.after) === JSON.stringify(result));
  return result;
}

type Debit = { purpose: string; accountId: unknown; cents: bigint; mappingId: unknown; lotId: unknown; receivableId: unknown };

export function verifyCollectionFailureSourceClosure(read: (table: string) => readonly Row[],
  history: Readonly<{ operation: readonly Row[]; audit_event: readonly Row[] }>) {
  const failures = index(read('collection_failures')), components = read('collection_failure_components');
  const componentsByFailure = group(components, 'collection_failure_id');
  const events = read('financial_events'), eventById = index(events), groupsById = index(read('atomic_finance_groups'));
  const failureEvents = index(events.filter(row => row.template === 'P11'), 'collection_failure_id');
  const payments = index(read('payments')), roots = index(read('funding_origins'), 'payment_id');
  const parts = index(read('funding_partitions')), allocations = index(read('allocation_events'));
  const unapplications = index(read('allocation_unapplications')), releasesByAllocation = group([...unapplications.values()], 'allocation_id');
  const applications = index(read('customer_fund_applications')), applicationEvents = index(events.filter(row => row.template === 'P04'), 'fund_application_id');
  const lots = index(read('customer_fund_lots')), unapplyEvents = index(events.filter(row => row.template === 'P05'), 'unapplication_id');
  const tips = index(read('tip_realizations')), tipEvents = index(events.filter(row => row.template === 'P06' || row.template === 'P03' && row.tip_realization_id != null), 'tip_realization_id');
  const receivables = index(read('receivable_items'));
  const funds = read('fund_lot_range_consumptions'), tipsUsed = read('tip_realization_range_consumptions');
  const fundClaims = index(funds.filter(row => row.collection_failure_component_id !== null), 'collection_failure_component_id');
  const tipClaims = index(tipsUsed.filter(row => row.collection_failure_component_id !== null), 'collection_failure_component_id');
  const fundsByLot = group(funds, 'fund_lot_id'), usedByTip = group(tipsUsed, 'tip_realization_id');
  const entries = group(read('journal_entries'), 'event_id'), lines = read('journal_lines'), linesByEntry = group(lines, 'entry_id');
  const movements = index(read('money_movements'), 'event_id'), evidence = index(read('external_money_evidence'));
  const operations = index(history.operation.filter(row => row.command_type === command && row.state === 'committed'), 'operation_id');
  const audits = index(history.audit_event.filter(row => row.entity_kind === 'collection_failures' && row.action === 'adjust_collection'), 'operation_id');
  const countedLines = new Set<unknown>(), countedClaims = new Set<unknown>(), usedEvidence = new Set<unknown>();
  check(failureEvents.size === failures.size && componentsByFailure.size === failures.size
    && operations.size === failures.size && audits.size === failures.size
    && events.every(row => row.template === 'P11' || row.collection_failure_id === null));

  for (const [paymentId, portions] of group(components, 'payment_id')) {
    const root = roots.get(paymentId);
    check(root);
    const ranges = portions.map(row => ({ first: cents(row.root_first_cent), last: cents(row.root_last_cent) }))
      .sort((a, b) => a.first < b.first ? -1 : 1);
    let previous = 0n;
    for (const range of ranges) {
      check(range.first > previous && range.last >= range.first && range.last <= cents(root.cents));
      previous = range.last;
    }
  }

  for (const [id, saved] of failures) {
    const event = failureEvents.get(id), payment = payments.get(saved.payment_id), root = roots.get(saved.payment_id);
    const original = eventById.get(saved.original_event_id), posting = event && groupsById.get(event.group_id);
    const originalPosting = original && groupsById.get(original.group_id);
    const operation = operations.get(saved.operation_id), audit = audits.get(saved.operation_id);
    check(event && payment && root && original?.template === 'P03' && original.payment_id === payment.id && posting && originalPosting
      && root.customer_id === payment.customer_id && event.event_sequence === '1' && event.template_version === '1'
      && ['invoice_id','payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id','invoice_credit_id',
        'service_refund_id','excess_return_id','tip_return_id','zero_effect_reason'].every(key => event[key] === null)
      && customerDate(saved.effective_on) && event.effective_on === saved.effective_on && customerDate(original.effective_on)
      && saved.effective_on >= original.effective_on && posting.operation_id === saved.operation_id && posting.created_by === saved.created_by
      && cents(posting.commit_sequence) > cents(originalPosting.commit_sequence)
      && operation && audit && operation.actor_id === saved.created_by && posting.recovery_epoch === operation.recovery_epoch
      && audit.entity_id === id && audit.entity_version === '1' && audit.actor_id === saved.created_by && audit.reason === saved.reason);

    const total = cents(saved.cents), movement = movements.get(event.id);
    check(total > 0n && total <= cents(root.cents));
    if (saved.kind === 'recording_error') {
      check(!movement && saved.evidence_id === null && saved.money_account_id === payment.account_id
        && saved.channel_version_id === payment.channel_version_id);
    } else {
      const proof = movement && evidence.get(movement.evidence_id);
      check(saved.kind === 'settled_failure' && movement && proof && !usedEvidence.has(proof.id)
        && movement.account_id === saved.money_account_id && movement.evidence_id === saved.evidence_id
        && proof.external_account_id === saved.money_account_id && proof.confirmed_on === saved.effective_on
        && proof.currency === 'USD' && proof.normalization_rule === 'exact_case_v1'
        && proof.signed_cents === String(-total) && movement.signed_cents === proof.signed_cents);
      usedEvidence.add(proof.id);
    }
    const journal = entries.get(event.id);
    check(journal?.length === 1 && journal[0]!.entry_sequence === '1');
    const posted = linesByEntry.get(journal[0]!.id);
    check(posted && posted.every(line => line.collection_failure_id === id
      && ['invoice_item_id','tax_payable_movement_id','allocation_event_id','unapplication_id','fund_application_id','tip_realization_id',
        'invoice_credit_id','service_refund_id','excess_return_id','tip_return_id'].every(key => line[key] === null)));
    const money = posted.filter(line => line.collection_failure_component_id === null);
    check(money.length === 1 && money[0]!.purpose === 'collection_failure_money' && money[0]!.account_id === saved.money_account_id
      && money[0]!.fixed_mapping_id === null && money[0]!.receivable_id === null && money[0]!.fund_lot_id === null
      && money[0]!.money_movement_id === (movement?.id ?? null) && money[0]!.debit_cents === '0' && money[0]!.credit_cents === saved.cents);
    countedLines.add(money[0]!.id);
    const linesByComponent = group(posted.filter(line => line.collection_failure_component_id !== null), 'collection_failure_component_id');
    const selected = componentsByFailure.get(id);
    check(selected && selected.length >= 1 && selected.length <= 180 && selected.length === linesByComponent.size);
    const retainedComponents: Record<string, unknown>[] = [];
    let selectedCents = 0n;

    for (const component of [...selected].sort((a,b) => cents(a.root_first_cent) < cents(b.root_first_cent) ? -1 : 1)) {
      const range = offsets(component);
      check(component.payment_id === payment.id && component.business_id === saved.business_id
        && [component.allocation_id,component.fund_application_id,component.fund_lot_id,component.tip_realization_id]
          .filter(source => source !== null).length === 1);
      let kind: 'allocation' | 'application' | 'funds' | 'tip';
      let sourceId: unknown, parent: Row | undefined;
      let rootRange = range;
      let net = range.last-range.first+1n, tax = 0n;
      let debits: Debit[];
      if (component.allocation_id !== null || component.fund_application_id !== null) {
        const allocation = allocations.get(component.allocation_id), application = applications.get(component.fund_application_id);
        const item = receivables.get(allocation?.receivable_id ?? application?.receivable_id);
        check(item?.customer_id === root.customer_id);
        if (component.allocation_id !== null) {
          const part = allocation && parts.get(allocation.partition_id);
          check(allocation && allocation.event_id === original.id && part?.origin_id === root.id
            && range.first >= cents(part?.first_cent) && range.last <= cents(part?.last_cent)
            && (releasesByAllocation.get(allocation.id) ?? []).every(row => !overlaps(range,offsets(row))));
          kind = 'allocation'; sourceId = allocation.id; parent = original;
        } else {
          const lot = application && lots.get(application.fund_lot_id);
          check(application && lot?.origin_id === root.id && lot?.customer_id === root.customer_id
            && range.first >= cents(application.first_cent) && range.last <= cents(application.last_cent));
          kind = 'application'; sourceId = application.id; parent = applicationEvents.get(application.id);
        }
        debits = [{purpose:'collection_failure_ar',accountId:item!.account_id,cents:net,mappingId:null,lotId:null,receivableId:item!.id}];
      } else if (component.fund_lot_id !== null) {
        const lot = lots.get(component.fund_lot_id);
        check(lot?.origin_id === root.id && lot?.customer_id === root.customer_id);
        const release = unapplications.get(lot!.unapplication_id), partition = parts.get(lot!.parent_partition_id);
        const bounds = release ?? partition;
        const claim = fundClaims.get(component.id);
        check(bounds && claim && claim.fund_lot_id === lot!.id && claim.first_cent === component.first_cent && claim.last_cent === component.last_cent
          && [claim.fund_application_id,claim.tip_realization_id,claim.service_refund_id,claim.excess_return_id].every(field => field === null)
          && range.first >= cents(bounds.first_cent) && range.last <= cents(bounds.last_cent)
          && fundsByLot.get(lot!.id)?.every(other => other.id === claim.id || !overlaps(range,offsets(other))));
        countedClaims.add(claim.id);
        kind = 'funds'; sourceId = lot!.id;
        parent = release ? unapplyEvents.get(release.id) : eventById.get(lot!.receipt_event_id);
        debits = [{purpose:'collection_failure_funds',accountId:lot!.account_id,cents:net,mappingId:lot!.mapping_id,lotId:lot!.id,receivableId:null}];
      } else {
        const tip = tips.get(component.tip_realization_id), lot = tip && lots.get(tip.fund_lot_id);
        const claim = tipClaims.get(component.id);
        check(tip && lot?.origin_id === root.id && lot?.customer_id === root.customer_id && claim && claim.tip_realization_id === tip.id
          && claim.first_cent === component.first_cent && claim.last_cent === component.last_cent && claim.tip_return_id === null
          && usedByTip.get(tip.id)?.every(other => other.id === claim.id || !overlaps(range,offsets(other))));
        countedClaims.add(claim.id);
        const split = creditRangeComponents({inclusiveCents:cents(tip.inclusive_cents),netCents:cents(tip.net_cents),
          taxCents:cents(tip.tax_cents),discountCents:0n},[range]);
        net = split.netCents; tax = split.taxCents;
        const start = cents(tip.first_cent)-1n;
        rootRange = {first:start+range.first,last:start+range.last};
        kind = 'tip'; sourceId = tip.id; parent = tipEvents.get(tip.id);
        debits = [
          {purpose:'collection_failure_tip_revenue',accountId:tip.revenue_account_id,cents:net,mappingId:tip.revenue_mapping_id,lotId:null,receivableId:null},
          {purpose:'collection_failure_tip_tax',accountId:tip.tax_account_id,cents:tax,mappingId:null,lotId:null,receivableId:null},
        ].filter(debit => debit.cents > 0n);
      }
      const parentGroup = parent && groupsById.get(parent.group_id);
      check(parentGroup && customerDate(parent?.effective_on) && parent.effective_on <= saved.effective_on
        && cents(parentGroup.commit_sequence) < cents(posting.commit_sequence)
        && cents(component.root_first_cent) === rootRange.first && cents(component.root_last_cent) === rootRange.last
        && cents(component.net_cents) === net && cents(component.tax_cents) === tax);
      const componentLines = linesByComponent.get(component.id);
      check(componentLines?.length === debits.length && debits.every(debit => componentLines.some(line =>
        line.purpose === debit.purpose && line.account_id === debit.accountId && line.fixed_mapping_id === debit.mappingId
        && line.fund_lot_id === debit.lotId && line.receivable_id === debit.receivableId && line.money_movement_id === null
        && line.debit_cents === String(debit.cents) && line.credit_cents === '0')));
      componentLines.forEach(line => countedLines.add(line.id));
      selectedCents += net+tax;
      retainedComponents.push({componentId:component.id,kind,sourceId,firstCent:component.first_cent,lastCent:component.last_cent,
        rootFirstCent:component.root_first_cent,rootLastCent:component.root_last_cent,netCents:component.net_cents,taxCents:component.tax_cents});
    }
    check(selectedCents === total);
    const receipt = parseHistory(operation,audit);
    check(exact(receipt,['schemaVersion','businessId','collectionFailureId','operationId','eventId','originalPaymentId','customerId',
      'kind','moneyAccountId','moneyChannelId','moneyChannelVersion','moneyMovementId','evidenceId','effectiveOn','cents','confirmation','reason','components'])
      && receipt.schemaVersion === 1 && receipt.businessId === saved.business_id && receipt.collectionFailureId === id
      && receipt.operationId === saved.operation_id && receipt.eventId === event.id && receipt.originalPaymentId === payment.id
      && receipt.customerId === root.customer_id && receipt.kind === saved.kind && receipt.moneyAccountId === saved.money_account_id
      && customerUuid(receipt.moneyChannelId) && cents(receipt.moneyChannelVersion) > 0n
      && receipt.moneyMovementId === (movement?.id ?? null) && receipt.evidenceId === saved.evidence_id && receipt.effectiveOn === saved.effective_on
      && receipt.cents === saved.cents && receipt.confirmation === saved.confirmation && receipt.reason === saved.reason
      && Array.isArray(receipt.components) && receipt.components.length === retainedComponents.length
      && receipt.components.every((row,position) => {
        const expected = retainedComponents[position]!;
        return exact(row,Object.keys(expected)) && Object.entries(expected).every(([key,value]) => row[key] === value);
      }));
  }

  check(countedClaims.size === fundClaims.size+tipClaims.size
    && lines.every(line => line.collection_failure_id === null
      ? line.collection_failure_component_id === null && !String(line.purpose).startsWith('collection_failure_')
      : countedLines.has(line.id)));
  const retired = index(history.operation.filter(row => row.command_type === retirement && row.state === 'committed'), 'operation_id');
  const retirementAudits = index(history.audit_event.filter(row => row.entity_kind === 'operations' && row.action === 'retire'
    && retired.has(row.operation_id)), 'operation_id');
  check(retirementAudits.size === retired.size);
  for (const [id, operation] of retired) {
    const audit = retirementAudits.get(id);
    check(audit && audit.entity_id === operation.id && audit.entity_version === '1' && audit.actor_id === operation.actor_id);
    const receipt = parseHistory(operation,audit);
    check(exact(receipt,['schemaVersion','businessId','operationId','collectionFailureId','originalEpoch','reviewEpoch','reason'])
      && receipt.schemaVersion === 1 && receipt.businessId === operation.business_id && receipt.operationId === id
      && customerUuid(receipt.collectionFailureId) && customerUuid(receipt.originalEpoch) && receipt.reviewEpoch === operation.recovery_epoch
      && typeof receipt.reason === 'string' && receipt.reason === audit.reason);
  }
}
