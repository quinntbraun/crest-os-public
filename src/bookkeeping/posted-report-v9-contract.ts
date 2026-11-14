import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV8PageSize, parseFictionalJournalV8, parseFictionalTrialBalanceV8 } from './posted-report-v8-contract.ts';

const priorTemplates = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P12'] as const;
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12'] as const);
const collectionFields = ['collectionFailureId', 'collectionFailureComponentId', 'collectionFailureKind', 'originalPaymentId'] as const;
export const fictionalJournalV9PageSize = fictionalJournalV8PageSize;

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>, { coverage } = report;
  check(report.schemaVersion === 9 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template));
  return { ...report, schemaVersion: 8, coverage: { ...coverage, templates: priorTemplates } };
}

export function parseFictionalTrialBalanceV9(input: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV8(projectReport(input), businessId, throughOn);
  return { ...report, schemaVersion: 9 as const, coverage: { ...report.coverage, templates } };
}

type CollectionSource = {
  collectionFailureId: string;
  collectionFailureKind: 'recording_error' | 'settled_failure';
  originalPaymentId: string;
};
type CollectionLine = CollectionSource & (
  | { purpose: 'collection_failure_money'; collectionFailureComponentId: null; fundLotId: null }
  | { purpose: 'collection_failure_funds'; collectionFailureComponentId: string; fundLotId: string }
  | { purpose: 'collection_failure_ar' | 'collection_failure_tip_revenue' | 'collection_failure_tip_tax';
      collectionFailureComponentId: string; fundLotId: null }
);

function projectRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input)
    && collectionFields.every(field => Object.hasOwn(input, field)));
  const { collectionFailureId, collectionFailureComponentId, collectionFailureKind, originalPaymentId, ...row } =
    input as Record<string, unknown>;
  if (row.template !== 'P11') {
    check([collectionFailureId, collectionFailureComponentId, collectionFailureKind, originalPaymentId].every(field => field === null));
    return { row, collection: null };
  }

  check(customerUuid(collectionFailureId) && customerUuid(originalPaymentId)
    && (collectionFailureKind === 'recording_error' || collectionFailureKind === 'settled_failure')
    && row.paymentId === null && row.invoiceId === null && row.postedExpenseId === null && row.unapplicationId === null
    && row.fundApplicationId === null && row.tipRealizationId === null && row.invoiceCreditId === null
    && row.serviceRefundId === null && row.excessReturnId === null && row.tipReturnId === null);

  const { purpose, fundLotId, code, debitCents, creditCents } = row;
  const source: CollectionSource = { collectionFailureId, collectionFailureKind, originalPaymentId };
  let collection: CollectionLine;
  if (purpose === 'collection_failure_money') {
    check(collectionFailureComponentId === null && fundLotId === null && debitCents === '0');
    collection = { ...source, purpose, collectionFailureComponentId, fundLotId };
  } else if (purpose === 'collection_failure_funds') {
    check(customerUuid(collectionFailureComponentId) && customerUuid(fundLotId) && code === '2000' && creditCents === '0');
    collection = { ...source, purpose, collectionFailureComponentId, fundLotId };
  } else {
    check(customerUuid(collectionFailureComponentId) && fundLotId === null && creditCents === '0'
      && (purpose === 'collection_failure_ar' && code === '1100'
        || purpose === 'collection_failure_tip_revenue' && code === '4100'
        || purpose === 'collection_failure_tip_tax' && code === '2100'));
    collection = { ...source, purpose, collectionFailureComponentId, fundLotId };
  }

  // Reuse date order, source row shape, cursor and running account checks.
  // P11's original payment and per-component roles are checked above.
  return { collection, row: { ...row, template: 'P03', paymentId: collectionFailureId, fundLotId: null,
    purpose: purpose === 'collection_failure_money' ? 'receipt_ar' : 'receipt_money' } };
}

export function parseFictionalJournalV9(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV9PageSize) {
  const projected = projectReport(input);
  check('rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectRow);
  const report = parseFictionalJournalV8({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const { collection } = candidates[index]!;
    if (collection === null) {
      return { ...row, collectionFailureId: null, collectionFailureComponentId: null,
        collectionFailureKind: null, originalPaymentId: null };
    }
    check(row.template === 'P03');
    return { ...row, ...collection, template: 'P11' as const, paymentId: null };
  });

  type FailureRow = Extract<(typeof rows)[number], { template: 'P11' }>;
  const byFailure = new Map<string, FailureRow[]>(), byEvent = new Map<string, string | null>();
  const byComponent = new Map<string, FailureRow>();
  for (const row of rows) {
    const eventSource = byEvent.get(row.eventId);
    check(eventSource === undefined || eventSource === row.collectionFailureId);
    byEvent.set(row.eventId, row.collectionFailureId);
    if (row.template !== 'P11') continue;
    const lines = byFailure.get(row.collectionFailureId) ?? [];
    const first = lines[0];
    if (first) {
      check(first.eventId === row.eventId && first.entryId === row.entryId && first.operationId === row.operationId
        && first.effectiveOn === row.effectiveOn && first.commitSequence === row.commitSequence
        && first.eventSequence === row.eventSequence && first.entrySequence === row.entrySequence
        && first.originalPaymentId === row.originalPaymentId && first.collectionFailureKind === row.collectionFailureKind);
    }
    if (row.collectionFailureComponentId === null) {
      check(!lines.some(line => line.collectionFailureComponentId === null));
    } else {
      const peer = byComponent.get(row.collectionFailureComponentId);
      if (peer) {
        check(peer.collectionFailureId === row.collectionFailureId
          && (peer.purpose === 'collection_failure_tip_revenue' && row.purpose === 'collection_failure_tip_tax'
            || peer.purpose === 'collection_failure_tip_tax' && row.purpose === 'collection_failure_tip_revenue')
          && lines.filter(line => line.collectionFailureComponentId === row.collectionFailureComponentId).length === 1);
      }
      byComponent.set(row.collectionFailureComponentId, row);
    }
    lines.push(row);
    byFailure.set(row.collectionFailureId, lines);
  }

  if (accountId === null && afterLineId === null && !report.hasMore) {
    for (const lines of byFailure.values()) {
      check(lines.length >= 2 && lines.some(line => line.purpose === 'collection_failure_money')
        && lines.reduce((sum, line) => sum + BigInt(line.debitCents) - BigInt(line.creditCents), 0n) === 0n);
    }
  }
  return { ...report, schemaVersion: 9 as const, coverage: { ...report.coverage, templates }, rows };
}

export type FictionalTrialBalanceV9 = ReturnType<typeof parseFictionalTrialBalanceV9>;
export type FictionalJournalV9 = ReturnType<typeof parseFictionalJournalV9>;
