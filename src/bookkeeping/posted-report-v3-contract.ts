import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV2PageSize, parseFictionalJournalV2, parseFictionalTrialBalanceV2 } from './posted-report-v2-contract.ts';

const priorTemplates = ['P01', 'P02', 'P03', 'P05', 'P12'] as const;
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P12'] as const);

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  const { coverage } = report;
  check(report.schemaVersion === 3 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template));
  return { ...report, schemaVersion: 2, coverage: { ...coverage, templates: priorTemplates } };
}

export function parseFictionalTrialBalanceV3(value: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV2(projectReport(value), businessId, throughOn);
  return { ...report, schemaVersion: 3 as const, coverage: { ...report.coverage, templates } };
}

type Application =
  | { purpose: 'apply_funds'; fundLotId: string; fundApplicationId: string }
  | { purpose: 'apply_ar'; fundLotId: null; fundApplicationId: string };

function projectJournalRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'fundApplicationId'));
  const { fundApplicationId, ...row } = input as Record<string, unknown>;
  if (row.template !== 'P04') {
    check(fundApplicationId === null);
    return { row, application: null };
  }
  const { purpose, fundLotId, code, debitCents, creditCents } = row;
  check(customerUuid(fundApplicationId) && row.invoiceId === null && row.paymentId === null
    && row.postedExpenseId === null && row.unapplicationId === null);
  let application: Application;
  if (purpose === 'apply_funds') {
    check(code === '2000' && creditCents === '0' && customerUuid(fundLotId));
    application = { purpose, fundLotId, fundApplicationId };
  } else {
    check(purpose === 'apply_ar' && code === '1100' && debitCents === '0' && fundLotId === null);
    application = { purpose, fundLotId, fundApplicationId };
  }
  // Reuse v2's line shape, money, ordering and pagination checks through
  // an internal projection with the same debit/credit directions. Restore
  // the validated P04 provenance before returning any result.
  return { application, row: { ...row, template: 'P03', purpose: purpose === 'apply_funds' ? 'receipt_money' : 'receipt_ar',
    paymentId: fundApplicationId, fundLotId: null } };
}

export const fictionalJournalV3PageSize = fictionalJournalV2PageSize;

export function parseFictionalJournalV3(value: unknown, businessId: string, throughOn: string, accountId: string | null,
  afterLineId: string | null, pageSize = fictionalJournalV3PageSize) {
  const projected = projectReport(value);
  check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
    && 'rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectJournalRow);
  const report = parseFictionalJournalV2({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const application = candidates[index]!.application;
    return application === null
      ? { ...row, fundApplicationId: null }
      : { ...row, ...application, template: 'P04' as const, invoiceId: null, paymentId: null, postedExpenseId: null, unapplicationId: null };
  });
  type ApplicationRow = Extract<(typeof rows)[number], { template: 'P04' }>;
  const applications = new Map<string, { first: ApplicationRow; complete: boolean }>();
  const sourceByEvent = new Map<string, string | null>();
  for (const row of rows) {
    const eventSource = sourceByEvent.get(row.eventId);
    check(eventSource === undefined || eventSource === row.fundApplicationId);
    sourceByEvent.set(row.eventId, row.fundApplicationId);
    if (row.template !== 'P04') continue;
    const prior = applications.get(row.fundApplicationId);
    if (!prior) {
      applications.set(row.fundApplicationId, { first: row, complete: false });
      continue;
    }
    const { first } = prior;
    check(!prior.complete && first.purpose !== row.purpose && first.eventId === row.eventId
      && first.entryId === row.entryId && first.operationId === row.operationId && first.effectiveOn === row.effectiveOn
      && first.commitSequence === row.commitSequence && first.eventSequence === row.eventSequence && first.entrySequence === row.entrySequence
      && BigInt(first.debitCents) + BigInt(first.creditCents) === BigInt(row.debitCents) + BigInt(row.creditCents));
    prior.complete = true;
  }
  if (accountId === null && afterLineId === null && !report.hasMore) {
    check([...applications.values()].every(application => application.complete));
  }
  return { ...report, schemaVersion: 3 as const, coverage: { ...report.coverage, templates }, rows };
}

export type FictionalTrialBalanceV3 = ReturnType<typeof parseFictionalTrialBalanceV3>;
export type FictionalJournalV3 = ReturnType<typeof parseFictionalJournalV3>;

export function serializeFictionalTrialBalanceV3(report: FictionalTrialBalanceV3) {
  return JSON.stringify(parseFictionalTrialBalanceV3(report, report.businessId, report.throughOn));
}

export function serializeFictionalJournalV3(report: FictionalJournalV3, accountId: string | null, afterLineId: string | null,
  pageSize = fictionalJournalV3PageSize) {
  return JSON.stringify(parseFictionalJournalV3(report, report.businessId, report.throughOn, accountId, afterLineId, pageSize));
}
