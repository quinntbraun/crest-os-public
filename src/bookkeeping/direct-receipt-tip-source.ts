import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { customerDate, customerInstant, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason } from './finance-account-contract.ts';
import { calculateInclusiveFinanceCharge, isFinanceCents, isFinanceDecimalRate } from './finance-inclusive-charge.ts';

export const directReceiptTipSourceAddedColumns = Object.freeze({ 'crest.customer_fund_lots': ['receipt_tip_event_id'] });
const anchorFields = ['id','business_id','unapplication_id','origin_id','parent_partition_id','customer_id','account_id',
  'mapping_id','original_cents','receipt_event_id','receipt_tip_event_id'] as const;
const lineFields = ['id','event_id','tip_realization_id'] as const;
type Row = Readonly<Record<string, unknown>>;

function check(value: unknown): asserts value {
  if (!value) throw Error('DIRECT_RECEIPT_TIP_SOURCE_REVIEW_REQUIRED');
}
function cents(value: unknown) {
  check(isFinanceCents(value));
  return BigInt(value);
}
function index(rows: readonly Row[], key = 'id') {
  const found = new Map(rows.map(row => [row[key],row]));
  check(found.size === rows.length);
  return found;
}
function group(rows: readonly Row[], key: string) {
  const result = new Map<unknown, Row[]>();
  for (const row of rows) {
    const list = result.get(row[key]) ?? [];
    list.push(row);
    result.set(row[key],list);
  }
  return result;
}
function record(text: unknown): Row {
  check(typeof text === 'string');
  const value: unknown = JSON.parse(text);
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Row;
}
export function isDirectReceiptTipOperation(row: Row) {
  return row.command_type === 'finance.receipt.record' && row.state === 'committed'
    && record(row.result).schemaVersion === 3;
}

export async function captureDirectReceiptTipSource(businessId: string, snapshotToken: string,
  query: (sql: string, args: unknown[]) => Promise<unknown[]>) {
  const result = await query('SELECT crest_commands.direct_receipt_tip_source_snapshot($1::uuid) AS result',[businessId]);
  check(result.length === 1 && exact(result[0],['result']));
  const value = result[0].result;
  check(exact(value,['schemaVersion','businessId','snapshotToken','anchors','lines']) && value.schemaVersion === 1
    && value.businessId === businessId && value.snapshotToken === snapshotToken && /^[a-f0-9]{64}$/.test(snapshotToken)
    && Array.isArray(value.anchors) && value.anchors.length <= 1000 && Array.isArray(value.lines) && value.lines.length <= 2000);
  const anchors = value.anchors.map((row: unknown) => {
    check(exact(row,anchorFields) && row.business_id === businessId && row.unapplication_id === null && row.receipt_event_id === null
      && isFinanceCents(row.original_cents) && row.original_cents !== '0'
      && [row.id,row.origin_id,row.parent_partition_id,row.customer_id,row.account_id,row.mapping_id,row.receipt_tip_event_id].every(customerUuid));
    return row as Readonly<Record<string,string|null>>;
  });
  const lines = value.lines.map((row: unknown) => {
    check(exact(row,lineFields) && customerUuid(row.id) && customerUuid(row.event_id) && customerUuid(row.tip_realization_id));
    return { id:row.id,eventId:row.event_id,tipRealizationId:row.tip_realization_id };
  });
  check(index(anchors,'receipt_tip_event_id').size === anchors.length && index(lines).size === lines.length);
  return { anchors, lines, snapshotToken: createHash('sha256').update('crest.direct-receipt-tip-source.v1:' + snapshotToken).digest('hex') };
}

export function verifyDirectReceiptTipSourceClosure(read: (table: string) => readonly Row[],
  history: Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>) {
  const events = index(read('financial_events'));
  const directEvents = index([...events.values()].filter(row => row.template === 'P03' && row.tip_realization_id !== null),'tip_realization_id');
  const lots = read('customer_fund_lots'), anchors = index(lots.filter(row => row.receipt_tip_event_id !== null),'receipt_tip_event_id');
  const ordinaryHeld = index(lots.filter(row => row.receipt_event_id !== null),'receipt_event_id');
  const tips = index(read('tip_realizations')), claims = index(read('fund_lot_range_consumptions').filter(row => row.tip_realization_id !== null),'tip_realization_id');
  const roots = index(read('funding_origins')), parts = group(read('funding_partitions'),'origin_id');
  const payments = index(read('payments')), groups = index(read('atomic_finance_groups'));
  const entries = index(read('journal_entries'),'event_id'), journalLines = read('journal_lines'), linesByEntry = group(journalLines,'entry_id');
  const allocations = index(read('allocation_events'),'partition_id'), movements = index(read('money_movements'),'event_id');
  const operations = index(history.operation.filter(isDirectReceiptTipOperation),'operation_id');
  const audits = group(history.audit_event.filter(row => row.entity_kind === 'payments' && row.action === 'record'),'operation_id');
  const profiles = history.operation.filter(row => row.command_type === 'finance.tax_profile.approve' && row.state === 'committed').map(row => record(row.result));
  const mappings = history.operation.filter(row => row.command_type === 'finance.mapping.approve' && row.state === 'committed').map(row => record(row.result));
  const taxMappings = index(read('tax_payable_mapping_versions'));
  const checkedLines = new Set<unknown>();
  check(anchors.size === directEvents.size && operations.size === directEvents.size);

  for (const [tipId,event] of directEvents) {
    const tip = tips.get(tipId), lot = anchors.get(event.id), held = ordinaryHeld.get(event.id);
    const root = lot && roots.get(lot.origin_id), payment = payments.get(event.payment_id), posted = groups.get(event.group_id);
    const claim = claims.get(tipId), movement = movements.get(event.id), entry = entries.get(event.id);
    check(event.template_version === '1' && tip && lot && root && payment && posted && claim && movement && entry
      && lot.unapplication_id === null && lot.receipt_event_id === null && tip.fund_lot_id === lot.id
      && root.payment_id === payment.id && root.cents === payment.gross_cents && root.customer_id === payment.customer_id
      && lot.customer_id === payment.customer_id && lot.original_cents === tip.inclusive_cents
      && tip.operation_id === payment.operation_id && tip.created_by === payment.created_by && tip.reason === payment.confirmation
      && posted.operation_id === tip.operation_id && posted.created_by === tip.created_by
      && event.effective_on === payment.actual_on && event.event_sequence === '1' && entry.entry_sequence === '1'
      && customerDate(event.effective_on) && customerInstant(event.posted_at) && customerInstant(tip.created_at)
      && tip.created_at >= event.posted_at && financeAccountReviewReason(tip.customer_intent_evidence)
      && claim.fund_lot_id === lot.id && claim.first_cent === tip.first_cent && claim.last_cent === tip.last_cent
      && claim.fund_application_id === null && claim.service_refund_id === null && claim.excess_return_id === null
      && claim.collection_failure_component_id === null);

    const day = event.effective_on;
    const profile = profiles.find(row => row.id === tip.tax_profile_id);
    const revenue = mappings.find(row => row.id === tip.revenue_mapping_id);
    const fundsMapping = mappings.find(row => row.id === lot.mapping_id);
    check(profile?.businessId === payment.business_id && profile?.applicability === 'tip' && profile.synthetic === true
      && profile.serviceId === null && profile.jurisdiction === tip.jurisdiction && customerDate(profile.effectiveFrom)
      && profile.effectiveFrom <= day && financeAccountReviewReason(profile.verificationEvidence)
      && revenue?.purpose === 'tips_revenue' && revenue.accountId === tip.revenue_account_id && customerDate(revenue.effectiveFrom)
      && revenue.effectiveFrom <= day && fundsMapping?.purpose === 'customer_funds' && fundsMapping.accountId === lot.account_id
      && customerDate(fundsMapping.effectiveFrom) && fundsMapping.effectiveFrom <= day);
    const newest = (version: Row,candidates: Row[]) => candidates.every(candidate => !customerDate(candidate.effectiveFrom)
      || candidate.effectiveFrom <= String(version.effectiveFrom) || candidate.effectiveFrom > day);
    check(newest(profile,profiles.filter(row => row.businessId === payment.business_id && row.applicability === 'tip'
      && row.serviceId === null && row.jurisdiction === tip.jurisdiction)));
    check(newest(revenue,mappings.filter(row => row.purpose === 'tips_revenue')));
    check(newest(fundsMapping,mappings.filter(row => row.purpose === 'customer_funds')));

    let rate = '0';
    if (profile.treatment === 'inclusive_single') {
      const tax = taxMappings.get(tip.tax_mapping_id);
      check(isFinanceDecimalRate(profile.rate) && profile.rate !== '0' && tax && tax.jurisdiction === tip.jurisdiction
        && tax.account_id === tip.tax_account_id && customerDate(tax.effective_from) && tax.effective_from <= day
        && [...taxMappings.values()].every(row => row.jurisdiction !== tip.jurisdiction || !customerDate(row.effective_from)
          || row.effective_from <= String(tax.effective_from) || row.effective_from > day));
      rate = profile.rate;
    } else {
      check(profile.treatment === 'non_taxable' && profile.rate === null && tip.tax_mapping_id === null && tip.tax_account_id === null);
    }
    check(isFinanceCents(tip.inclusive_cents));
    const charge = calculateInclusiveFinanceCharge(tip.inclusive_cents,'0',rate);
    check(charge.netCents === tip.net_cents && charge.taxCents === tip.tax_cents);
    const journal = linesByEntry.get(entry.id) ?? [];
    const postedTip = journal.filter(line => line.tip_realization_id !== null);
    check(postedTip.length === Number(charge.netCents !== '0') + Number(charge.taxCents !== '0')
      && journal.every(line => line.fund_lot_id !== lot.id));
    const byPurpose = index(postedTip,'purpose');
    for (const [purpose,amount,accountId,mappingId] of [
      ['tip_revenue',charge.netCents,tip.revenue_account_id,tip.revenue_mapping_id],
      ['tip_tax',charge.taxCents,tip.tax_account_id,null],
    ] as const) {
      const line = byPurpose.get(purpose);
      if (amount === '0') {check(!line);continue;}
      check(line && line.tip_realization_id === tipId && line.account_id === accountId && line.fixed_mapping_id === mappingId
        && line.debit_cents === '0' && line.credit_cents === amount
        && ['fund_lot_id','invoice_item_id','receivable_id','tax_payable_movement_id','money_movement_id','allocation_event_id','unapplication_id',
          'fund_application_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id','collection_failure_id',
          'collection_failure_component_id','refund_transfer_adjustment_id'].every(field => line[field] === null));
      checkedLines.add(line.id);
    }
    const rootParts = (parts.get(root.id) ?? []).sort((a,b)=>Number(a.position)-Number(b.position));
    const applications = [];
    let used = 0n, foundTip = false, foundHeld = false;
    check(rootParts.length >= 1 && rootParts.length <= 180);
    for (const [i,part] of rootParts.entries()) {
      const first=cents(part.first_cent),last=cents(part.last_cent);
      check(part.position === String(i+1) && first === used+1n && last >= first);
      const length = last-first+1n;
      const allocation = allocations.get(part.id);
      if (part.id === lot.parent_partition_id) {
        check(!allocation && !foundTip && !foundHeld && part.first_cent === tip.first_cent && part.last_cent === tip.last_cent
          && length === cents(tip.inclusive_cents));
        foundTip = true;
      } else if (part.id === held?.parent_partition_id) {
        check(held && foundTip && !allocation && i === rootParts.length-1 && length === cents(held.original_cents));
        foundHeld = true;
      } else {
        check(!foundTip && allocation && allocation.event_id === event.id && cents(allocation.cents) === length);
        applications.push({id:allocation.id,receivableId:allocation.receivable_id,fundingPartitionId:part.id,cents:allocation.cents});
      }
      used=last;
    }
    check(foundTip && foundHeld === Boolean(held) && used === cents(payment.gross_cents));

    const operation = operations.get(payment.operation_id), related = audits.get(payment.operation_id);
    check(operation && operation.actor_id === payment.created_by && operation.recovery_epoch === posted.recovery_epoch
      && related?.length === 1 && related[0]!.entity_id === payment.id && related[0]!.actor_id === payment.created_by
      && related[0]!.reason === payment.confirmation);
    const expected = {
      schemaVersion:3,businessId:payment.business_id,paymentId:payment.id,eventId:event.id,customerId:payment.customer_id,
      channelVersionId:payment.channel_version_id,accountId:payment.account_id,actualOn:payment.actual_on,grossCents:payment.gross_cents,
      fundingOriginId:root.id,moneyMovementId:movement.id,externalEvidenceId:movement.evidence_id,applications,
      heldFunds:held?{lotId:held.id,fundingPartitionId:held.parent_partition_id,mappingId:held.mapping_id,cents:held.original_cents}:null,
      tip:{tipRealizationId:tip.id,fundingPartitionId:lot.parent_partition_id,firstCent:tip.first_cent,lastCent:tip.last_cent,
        inclusiveCents:tip.inclusive_cents,netCents:tip.net_cents,taxCents:tip.tax_cents,jurisdiction:tip.jurisdiction,
        taxProfileId:tip.tax_profile_id,revenueMappingId:tip.revenue_mapping_id,taxMappingId:tip.tax_mapping_id,
        confirmation:tip.customer_intent_evidence},
    };
    check(isDeepStrictEqual(record(operation.result),expected)
      && isDeepStrictEqual(record(related[0]!.delta),{schemaVersion:1,before:null,after:expected}));
  }
  const directEntryIds = new Set([...directEvents.values()].map(event=>entries.get(event.id)?.id));
  check(journalLines.every(line=>!directEntryIds.has(line.entry_id)||line.tip_realization_id===null||checkedLines.has(line.id)));
}
