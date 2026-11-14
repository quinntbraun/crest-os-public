import { customerDate, customerDisplayName, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV9PageSize, parseFictionalJournalV9, parseFictionalTrialBalanceV9 } from './posted-report-v9-contract.ts';

const dueFields = ['recreditEventId', 'originalEventId', 'fundLotId', 'accountId', 'customerId', 'customerName',
  'obligationType', 'recreditedOn', 'remainingCents'] as const;
const adjustmentFields = ['refundTransferAdjustmentId', 'refundTransferKind', 'priorRefundEventId', 'originalRefundEventId'] as const;
const nonnegative = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
export const fictionalJournalV10PageSize = fictionalJournalV9PageSize;

function parseRefundDue(input: unknown, throughOn: string) {
  check(exact(input, ['count', 'totalCents', 'rows']) && nonnegative(input.count) && nonnegative(input.totalCents)
    && Array.isArray(input.rows));
  const count = BigInt(input.count), shown = BigInt(input.rows.length), total = BigInt(input.totalCents);
  check(shown === (count > 100n ? 100n : count));
  let previous = '', shownTotal = 0n;
  const events = new Set<string>();
  const rows = input.rows.map((row: unknown) => {
    check(exact(row, dueFields) && customerUuid(row.recreditEventId) && customerUuid(row.originalEventId)
      && row.recreditEventId !== row.originalEventId && customerUuid(row.fundLotId) && customerUuid(row.accountId)
      && customerUuid(row.customerId) && customerDisplayName(row.customerName)
      && (row.obligationType === 'service' || row.obligationType === 'excess' || row.obligationType === 'tip_return_due')
      && customerDate(row.recreditedOn) && row.recreditedOn <= throughOn && nonnegative(row.remainingCents) && row.remainingCents !== '0');
    const position = row.recreditedOn + row.recreditEventId;
    check(position > previous && !events.has(row.recreditEventId));
    previous = position;
    events.add(row.recreditEventId);
    shownTotal += BigInt(row.remainingCents);
    const obligationType: 'service' | 'excess' | 'tip_return_due' = row.obligationType;
    return { recreditEventId: row.recreditEventId, originalEventId: row.originalEventId, fundLotId: row.fundLotId,
      accountId: row.accountId, customerId: row.customerId, customerName: row.customerName, obligationType,
      recreditedOn: row.recreditedOn, remainingCents: row.remainingCents };
  });
  check(count === shown ? total === shownTotal : total >= shownTotal + count - shown);
  return { count: input.count, totalCents: input.totalCents, rows, truncated: count > shown };
}

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const { refundDue, ...report } = input as Record<string, unknown>;
  check(report.schemaVersion === 10 && customerDate(report.throughOn));
  return { report: { ...report, schemaVersion: 9 }, refundDue: parseRefundDue(refundDue, report.throughOn) };
}

export function parseFictionalTrialBalanceV10(input: unknown, businessId: string, throughOn: string | null) {
  const projected = projectReport(input);
  const report = parseFictionalTrialBalanceV9(projected.report, businessId, throughOn);
  return { ...report, schemaVersion: 10 as const, refundDue: projected.refundDue };
}

function projectRow(input: unknown, includeRefundTransferFees: boolean) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input)
    && adjustmentFields.every(field => Object.hasOwn(input, field)));
  const { refundTransferAdjustmentId, refundTransferKind, priorRefundEventId, originalRefundEventId, ...row } =
    input as Record<string, unknown>;
  if (refundTransferAdjustmentId === null) {
    check(refundTransferKind === null && priorRefundEventId === null && originalRefundEventId === null);
    return { row, adjustment: null };
  }

  const { template, purpose, fundLotId, code, debitCents, creditCents } = row;
  check(customerUuid(refundTransferAdjustmentId) && customerUuid(priorRefundEventId) && customerUuid(originalRefundEventId)
    && row.eventId !== priorRefundEventId && row.eventId !== originalRefundEventId
    && (refundTransferKind === 'recredit' || refundTransferKind === 'retry')
    && (template === 'P08' || template === 'P09' || template === 'P10')
    && ['paymentId', 'invoiceId', 'postedExpenseId', 'unapplicationId', 'fundApplicationId', 'tipRealizationId',
      'invoiceCreditId', 'serviceRefundId', 'excessReturnId', 'tipReturnId', 'collectionFailureId', 'collectionFailureComponentId',
      'collectionFailureKind', 'originalPaymentId'].every(field => row[field] === null));
  if (purpose === 'refund_transfer_money') {
    check(fundLotId === null && (refundTransferKind === 'recredit' ? creditCents === '0' : debitCents === '0'));
  } else if (purpose === 'refund_transfer_fee') {
    check(includeRefundTransferFees && refundTransferKind === 'recredit' && fundLotId === null
      && code === '5300' && debitCents !== '0' && creditCents === '0');
  } else {
    check(purpose === 'refund_transfer_funds' && customerUuid(fundLotId) && code === '2000'
      && (refundTransferKind === 'recredit' ? debitCents === '0' : creditCents === '0'));
  }
  const adjustment = { refundTransferAdjustmentId, refundTransferKind, priorRefundEventId, originalRefundEventId,
    template, purpose, fundLotId };
  return { adjustment, row: { ...row, template: 'P03', paymentId: refundTransferAdjustmentId, fundLotId: null,
    purpose: debitCents === '0' ? 'receipt_ar' : 'receipt_money' } };
}

export function parseFictionalJournalV10(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV10PageSize, includeRefundTransferFees = false) {
  const projected = projectReport(input);
  const { report: raw } = projected;
  check('rows' in raw && Array.isArray(raw.rows) && raw.rows.length <= pageSize);
  const candidates = raw.rows.map(row => projectRow(row, includeRefundTransferFees));
  const report = parseFictionalJournalV9({ ...raw, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const { adjustment } = candidates[index]!;
    if (adjustment === null) return { ...row, refundTransferAdjustmentId: null, refundTransferKind: null,
      priorRefundEventId: null, originalRefundEventId: null };
    check(row.template === 'P03');
    return { ...row, ...adjustment, paymentId: null };
  });
  type TransferRow = Extract<(typeof rows)[number], { refundTransferAdjustmentId: string }>;
  const transfers = new Map<string, TransferRow[]>();
  const events = new Map<string, string | null>();
  for (const row of rows) {
    const previous = events.get(row.eventId);
    check(previous === undefined || previous === row.refundTransferAdjustmentId);
    events.set(row.eventId, row.refundTransferAdjustmentId);
    if (row.refundTransferAdjustmentId === null) continue;
    const peers = transfers.get(row.refundTransferAdjustmentId) ?? [];
    const peer = peers[0];
    check(!peers.some(line => line.purpose === row.purpose));
    if (peer) {
      check(peer.eventId === row.eventId && peer.entryId === row.entryId && peer.operationId === row.operationId
        && peer.effectiveOn === row.effectiveOn && peer.commitSequence === row.commitSequence
        && peer.eventSequence === row.eventSequence && peer.entrySequence === row.entrySequence
        && peer.template === row.template && peer.refundTransferKind === row.refundTransferKind
        && peer.priorRefundEventId === row.priorRefundEventId && peer.originalRefundEventId === row.originalRefundEventId);
    }
    peers.push(row);
    transfers.set(row.refundTransferAdjustmentId, peers);
  }
  const entireReport = accountId === null && afterLineId === null && !report.hasMore;
  for (const lines of transfers.values()) {
    const hasFee = lines.some(line => line.purpose === 'refund_transfer_fee');
    if (entireReport || !includeRefundTransferFees && lines.length === 2 || lines.length === 3) {
      check(lines.length === (hasFee ? 3 : 2)
        && lines.reduce((net, line) => net + BigInt(line.debitCents) - BigInt(line.creditCents), 0n) === 0n);
    }
  }
  return { ...report, schemaVersion: 10 as const, rows, refundDue: projected.refundDue };
}

export type FictionalTrialBalanceV10 = ReturnType<typeof parseFictionalTrialBalanceV10>;
export type FictionalJournalV10 = ReturnType<typeof parseFictionalJournalV10>;
