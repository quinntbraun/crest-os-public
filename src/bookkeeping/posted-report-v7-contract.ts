import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV6PageSize, parseFictionalJournalV6, parseFictionalTrialBalanceV6 } from './posted-report-v6-contract.ts';

const priorTemplates = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P12'] as const;
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P12'] as const);
export const fictionalJournalV7PageSize = fictionalJournalV6PageSize;

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>, { coverage } = report;
  check(report.schemaVersion === 7 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template));
  return { ...report, schemaVersion: 6, coverage: { ...coverage, templates: priorTemplates } };
}

export function parseFictionalTrialBalanceV7(input: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV6(projectReport(input), businessId, throughOn);
  return { ...report, schemaVersion: 7 as const, coverage: { ...report.coverage, templates } };
}

type ExcessLine =
  | { purpose: 'excess_return_funds'; excessReturnId: string; fundLotId: string }
  | { purpose: 'excess_return_money'; excessReturnId: string; fundLotId: null };

function projectRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'excessReturnId'));
  const { excessReturnId, ...row } = input as Record<string, unknown>;
  if (row.template !== 'P09') {
    check(excessReturnId === null);
    return { row, source: null };
  }

  const { purpose, fundLotId } = row;
  check(customerUuid(excessReturnId) && row.serviceRefundId === null && row.paymentId === null
    && row.invoiceId === null && row.postedExpenseId === null && row.unapplicationId === null
    && row.fundApplicationId === null && row.tipRealizationId === null && row.invoiceCreditId === null);
  let source: ExcessLine;
  if (purpose === 'excess_return_funds') {
    check(row.code === '2000' && row.creditCents === '0' && customerUuid(fundLotId));
    source = { purpose, excessReturnId, fundLotId };
  } else {
    check(purpose === 'excess_return_money' && row.debitCents === '0' && fundLotId === null);
    source = { purpose, excessReturnId, fundLotId };
  }
  // Preserve v6 chronology, paging, and signed-balance checks. Validate
  // the P09 source pair separately from the existing service refund IDs.
  return { source, row: { ...row, template: 'P03', paymentId: excessReturnId, fundLotId: null,
    purpose: purpose === 'excess_return_funds' ? 'receipt_money' : 'receipt_ar' } };
}

export function parseFictionalJournalV7(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV7PageSize) {
  const projected = projectReport(input);
  check('rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectRow);
  const report = parseFictionalJournalV6({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const { source } = candidates[index]!;
    if (source === null) return { ...row, excessReturnId: null };
    check(row.template === 'P03');
    return { ...row, ...source, template: 'P09' as const, paymentId: null };
  });
  type ExcessRow = Extract<(typeof rows)[number], { template: 'P09' }>;
  const byReturn = new Map<string, ExcessRow[]>(), byEvent = new Map<string, string | null>();
  for (const row of rows) {
    const eventSource = byEvent.get(row.eventId);
    check(eventSource === undefined || eventSource === row.excessReturnId);
    byEvent.set(row.eventId, row.excessReturnId);
    if (row.template !== 'P09') continue;
    const siblings = byReturn.get(row.excessReturnId) ?? [];
    check(siblings.every(other => other.purpose !== row.purpose && other.eventId === row.eventId && other.entryId === row.entryId
      && other.operationId === row.operationId && other.effectiveOn === row.effectiveOn && other.commitSequence === row.commitSequence
      && other.eventSequence === row.eventSequence && other.entrySequence === row.entrySequence && other.accountId !== row.accountId
      && BigInt(other.debitCents) + BigInt(other.creditCents) === BigInt(row.debitCents) + BigInt(row.creditCents)));
    siblings.push(row);
    byReturn.set(row.excessReturnId, siblings);
  }
  if (accountId === null && afterLineId === null && !report.hasMore) {
    check([...byReturn.values()].every(lines => lines.length === 2));
  }
  return { ...report, schemaVersion: 7 as const, coverage: { ...report.coverage, templates }, rows };
}

export type FictionalTrialBalanceV7 = ReturnType<typeof parseFictionalTrialBalanceV7>;
export type FictionalJournalV7 = ReturnType<typeof parseFictionalJournalV7>;
