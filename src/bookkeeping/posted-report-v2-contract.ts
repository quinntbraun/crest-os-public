import { customerDate, customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountCode, financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';
import { parseFictionalTrialBalance } from './trial-balance-contract.ts';

const legacyTemplates = ['P01', 'P02', 'P03', 'P12'] as const;
const templates = ['P01', 'P02', 'P03', 'P05', 'P12'] as const;
const coverage = Object.freeze({
  complete: false, openingBalancesIncluded: false, reconciliationVerified: false, templates: Object.freeze(templates),
} as const);
const controls = Object.freeze({
  ledgerBalanced: true, receivablesTie: true, moneyMovementsTie: true, customerFundsTie: true,
} as const);
const nonnegative = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
const signed = (value: unknown): value is string => nonnegative(value) || typeof value === 'string' && /^-[1-9][0-9]{0,29}$/.test(value);
const positive = (value: unknown): value is string => nonnegative(value) && value !== '0';
const uuidOrNull = (value: unknown): value is string | null => value === null || customerUuid(value);
const reportFields = ['schemaVersion', 'businessId', 'currency', 'observedAt', 'throughOn', 'timeZone', 'coverageStart',
  'coverage', 'controls', 'postedEventCount'] as const;
const journalFields = ['lineId', 'eventId', 'entryId', 'effectiveOn', 'commitSequence', 'eventSequence', 'entrySequence',
  'template', 'purpose', 'accountId', 'code', 'name', 'debitCents', 'creditCents', 'runningBalanceCents',
  'invoiceId', 'paymentId', 'postedExpenseId', 'unapplicationId', 'fundLotId', 'operationId'] as const;

function reportContext(value: Record<string, unknown>, businessId: string, throughOn: string | null) {
  check(value.schemaVersion === 2 && value.businessId === businessId && customerUuid(businessId) && value.currency === 'USD'
    && typeof value.observedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.observedAt)
    && customerDate(value.observedAt.slice(0, 10)) && Number.isFinite(Date.parse(value.observedAt))
    && customerDate(value.throughOn) && (throughOn === null || throughOn === value.throughOn)
    && typeof value.timeZone === 'string' && /^[A-Za-z_0-9+\-/]{1,80}$/.test(value.timeZone)
    && (value.coverageStart === null || customerDate(value.coverageStart) && value.coverageStart <= value.throughOn)
    && nonnegative(value.postedEventCount) && (value.coverageStart === null) === (value.postedEventCount === '0'));
  const inputCoverage = value.coverage;
  check(exact(inputCoverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && inputCoverage.complete === false && inputCoverage.openingBalancesIncluded === false && inputCoverage.reconciliationVerified === false
    && Array.isArray(inputCoverage.templates) && inputCoverage.templates.length === templates.length
    && templates.every((template, index) => inputCoverage.templates instanceof Array && inputCoverage.templates[index] === template));
  const inputControls = value.controls;
  check(exact(inputControls, ['ledgerBalanced', 'receivablesTie', 'moneyMovementsTie', 'customerFundsTie'])
    && inputControls.ledgerBalanced === true && inputControls.receivablesTie === true
    && inputControls.moneyMovementsTie === true && inputControls.customerFundsTie === true);
  return {
    schemaVersion: 2 as const, businessId, currency: 'USD' as const, observedAt: value.observedAt, throughOn: value.throughOn,
    timeZone: value.timeZone, coverageStart: value.coverageStart, coverage, controls, postedEventCount: value.postedEventCount,
  };
}

export function parseFictionalTrialBalanceV2(value: unknown, businessId: string, throughOn: string | null) {
  check(exact(value, [...reportFields, 'rows', 'totals']));
  const context = reportContext(value, businessId, throughOn);
  // Account rows and integer totals use the same validation and meaning in both versions.
  const { rows, totals } = parseFictionalTrialBalance({
    ...context, schemaVersion: 1, coverage: { ...coverage, templates: legacyTemplates },
    controls: { ledgerBalanced: true, receivablesTie: true, moneyMovementsTie: true }, rows: value.rows, totals: value.totals,
  }, businessId, throughOn);
  check(context.postedEventCount !== '0' || rows.length === 0);
  return { ...context, rows, totals };
}

type Branch =
  | { template: 'P01' | 'P02'; purpose: 'ar' | 'discount' | 'service_revenue' | 'tax_payable';
      invoiceId: string; paymentId: null; postedExpenseId: null; unapplicationId: null; fundLotId: null }
  | { template: 'P03'; purpose: 'receipt_ar' | 'receipt_money';
      invoiceId: null; paymentId: string; postedExpenseId: null; unapplicationId: null; fundLotId: null }
  | { template: 'P05'; purpose: 'unapply_ar'; invoiceId: null; paymentId: null; postedExpenseId: null;
      unapplicationId: string; fundLotId: null }
  | { template: 'P05'; purpose: 'unapply_funds'; invoiceId: null; paymentId: null; postedExpenseId: null;
      unapplicationId: string; fundLotId: string }
  | { template: 'P12'; purpose: 'expense_cost' | 'expense_money';
      invoiceId: null; paymentId: null; postedExpenseId: string; unapplicationId: null; fundLotId: null };

function journalBranch(row: Record<string, unknown>): Branch {
  const { template, purpose, debitCents, creditCents, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId, code } = row;
  check(uuidOrNull(invoiceId) && uuidOrNull(paymentId) && uuidOrNull(postedExpenseId) && uuidOrNull(unapplicationId) && uuidOrNull(fundLotId));
  if (template === 'P01' || template === 'P02') {
    check(invoiceId !== null && paymentId === null && postedExpenseId === null && unapplicationId === null && fundLotId === null
      && (purpose === 'ar' && template === 'P01' && creditCents === '0'
        || purpose === 'discount' && creditCents === '0'
        || purpose === 'service_revenue' && debitCents === '0'
        || purpose === 'tax_payable' && template === 'P01' && debitCents === '0'));
    return { template, purpose, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId };
  }
  if (template === 'P03') {
    check(invoiceId === null && paymentId !== null && postedExpenseId === null && unapplicationId === null && fundLotId === null
      && (purpose === 'receipt_ar' && debitCents === '0' || purpose === 'receipt_money' && creditCents === '0'));
    return { template, purpose, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId };
  }
  if (template === 'P05') {
    check(invoiceId === null && paymentId === null && postedExpenseId === null && unapplicationId !== null);
    if (purpose === 'unapply_ar') {
      check(fundLotId === null && creditCents === '0' && code === '1100');
      return { template, purpose, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId };
    }
    check(purpose === 'unapply_funds' && fundLotId !== null && debitCents === '0' && code === '2000');
    return { template, purpose, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId };
  }
  check(template === 'P12' && invoiceId === null && paymentId === null && postedExpenseId !== null
    && unapplicationId === null && fundLotId === null
    && (purpose === 'expense_cost' && creditCents === '0' || purpose === 'expense_money' && debitCents === '0'));
  return { template, purpose, invoiceId, paymentId, postedExpenseId, unapplicationId, fundLotId };
}

export const fictionalJournalV2PageSize = 40;
export function parseFictionalJournalV2(value: unknown, businessId: string, throughOn: string, accountId: string | null,
  afterLineId: string | null, pageSize = fictionalJournalV2PageSize) {
  check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100 && uuidOrNull(accountId) && uuidOrNull(afterLineId));
  check(exact(value, [...reportFields, 'rows', 'hasMore', 'nextAfterLineId']) && Array.isArray(value.rows) && value.rows.length <= pageSize
    && typeof value.hasMore === 'boolean' && uuidOrNull(value.nextAfterLineId) && value.hasMore === (value.nextAfterLineId !== null));
  const context = reportContext(value, businessId, throughOn);
  const rows = value.rows.map((row: unknown) => {
    check(exact(row, journalFields) && customerUuid(row.lineId) && customerUuid(row.eventId) && customerUuid(row.entryId)
      && customerUuid(row.operationId) && customerDate(row.effectiveOn) && context.coverageStart !== null
      && row.effectiveOn >= context.coverageStart && row.effectiveOn <= context.throughOn
      && positive(row.commitSequence) && positive(row.eventSequence) && positive(row.entrySequence)
      && customerUuid(row.accountId) && (accountId === null || row.accountId === accountId) && financeAccountCode(row.code)
      && financeAccountReviewReason(row.name) && nonnegative(row.debitCents) && nonnegative(row.creditCents)
      && (row.debitCents === '0') !== (row.creditCents === '0') && signed(row.runningBalanceCents));
    return {
      lineId: row.lineId, eventId: row.eventId, entryId: row.entryId, effectiveOn: row.effectiveOn,
      commitSequence: row.commitSequence, eventSequence: row.eventSequence, entrySequence: row.entrySequence,
      accountId: row.accountId, code: row.code, name: row.name, debitCents: row.debitCents, creditCents: row.creditCents,
      runningBalanceCents: row.runningBalanceCents, operationId: row.operationId, ...journalBranch(row),
    };
  });
  const positions = new Set<string>();
  const unapplications = new Map<string, (typeof rows)[number]>();
  const running = new Map<string, bigint>();
  let previous: [string, bigint, bigint, bigint, string] | undefined;
  for (const row of rows) {
    check(row.lineId !== afterLineId && !positions.has(row.lineId));
    positions.add(row.lineId);
    const current: [string, bigint, bigint, bigint, string] = [
      row.effectiveOn, BigInt(row.commitSequence), BigInt(row.eventSequence), BigInt(row.entrySequence), row.lineId,
    ];
    if (previous) {
      const difference = current.findIndex((part, index) => part !== previous![index]);
      check(difference >= 0 && current[difference]! > previous[difference]!);
    }
    previous = current;
    if (row.template === 'P05') {
      const peer = unapplications.get(row.unapplicationId);
      if (peer) {
        check(peer.eventId === row.eventId && peer.entryId === row.entryId && peer.operationId === row.operationId
          && peer.purpose !== row.purpose && BigInt(peer.debitCents) + BigInt(peer.creditCents)
            === BigInt(row.debitCents) + BigInt(row.creditCents));
      }
      unapplications.set(row.unapplicationId, row);
    }
    const prior = running.get(row.accountId);
    const next = BigInt(row.runningBalanceCents);
    if (prior !== undefined || afterLineId === null) check(next === (prior ?? 0n) + BigInt(row.debitCents) - BigInt(row.creditCents));
    running.set(row.accountId, next);
  }
  check(!value.hasMore || rows.length === pageSize && rows.at(-1)?.lineId === value.nextAfterLineId);
  return { ...context, rows, hasMore: value.hasMore, nextAfterLineId: value.nextAfterLineId };
}

export type FictionalTrialBalanceV2 = ReturnType<typeof parseFictionalTrialBalanceV2>;
export type FictionalJournalV2 = ReturnType<typeof parseFictionalJournalV2>;

export function serializeFictionalTrialBalanceV2(report: FictionalTrialBalanceV2) {
  return JSON.stringify(parseFictionalTrialBalanceV2(report, report.businessId, report.throughOn));
}

export function serializeFictionalJournalV2(report: FictionalJournalV2, accountId: string | null, afterLineId: string | null,
  pageSize = fictionalJournalV2PageSize) {
  return JSON.stringify(parseFictionalJournalV2(report, report.businessId, report.throughOn, accountId, afterLineId, pageSize));
}
