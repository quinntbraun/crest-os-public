import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV7PageSize, parseFictionalJournalV7, parseFictionalTrialBalanceV7 } from './posted-report-v7-contract.ts';

const priorTemplates = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P12'] as const;
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P12'] as const);
export const fictionalJournalV8PageSize = fictionalJournalV7PageSize;

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>, { coverage } = report;
  check(report.schemaVersion === 8 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template));
  return { ...report, schemaVersion: 7, coverage: { ...coverage, templates: priorTemplates } };
}

export function parseFictionalTrialBalanceV8(input: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV7(projectReport(input), businessId, throughOn);
  return { ...report, schemaVersion: 8 as const, coverage: { ...report.coverage, templates } };
}

function projectRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'tipReturnId'));
  const { tipReturnId, ...row } = input as Record<string, unknown>;
  if (row.template !== 'P10') {
    check(tipReturnId === null);
    return { row, source: null };
  }

  const { purpose, code } = row;
  check(customerUuid(tipReturnId) && row.serviceRefundId === null && row.excessReturnId === null
    && row.paymentId === null && row.invoiceId === null && row.postedExpenseId === null && row.unapplicationId === null
    && row.fundApplicationId === null && row.tipRealizationId === null && row.invoiceCreditId === null && row.fundLotId === null);
  check(purpose === 'tip_return_money' && row.debitCents === '0'
    || purpose === 'tip_return_revenue' && code === '4100' && row.creditCents === '0'
    || purpose === 'tip_return_tax' && code === '2100' && row.creditCents === '0');
  // Preserve earlier chronology, paging, and signed-balance validation. P10
  // has a separate source pair that may have one or both debit components.
  return { source: { tipReturnId, purpose }, row: { ...row, template: 'P03', paymentId: tipReturnId,
    purpose: purpose === 'tip_return_money' ? 'receipt_ar' : 'receipt_money' } };
}

export function parseFictionalJournalV8(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV8PageSize) {
  const projected = projectReport(input);
  check('rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectRow);
  const report = parseFictionalJournalV7({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const { source } = candidates[index]!;
    if (source === null) return { ...row, tipReturnId: null };
    check(row.template === 'P03');
    return { ...row, ...source, template: 'P10' as const, paymentId: null };
  });
  type TipReturnRow = Extract<(typeof rows)[number], { template: 'P10' }>;
  const byReturn = new Map<string, TipReturnRow[]>(), byEvent = new Map<string, string | null>();
  for (const row of rows) {
    const eventSource = byEvent.get(row.eventId);
    check(eventSource === undefined || eventSource === row.tipReturnId);
    byEvent.set(row.eventId, row.tipReturnId);
    if (row.template !== 'P10') continue;
    const siblings = byReturn.get(row.tipReturnId) ?? [];
    check(siblings.every(other => other.purpose !== row.purpose && other.eventId === row.eventId && other.entryId === row.entryId
      && other.operationId === row.operationId && other.effectiveOn === row.effectiveOn && other.commitSequence === row.commitSequence
      && other.eventSequence === row.eventSequence && other.entrySequence === row.entrySequence && other.accountId !== row.accountId));
    siblings.push(row);
    byReturn.set(row.tipReturnId, siblings);
  }
  if (accountId === null && afterLineId === null && !report.hasMore) {
    for (const lines of byReturn.values()) {
      check(lines.length >= 2 && lines.some(line => line.purpose === 'tip_return_money')
        && lines.reduce((sum, line) => sum + BigInt(line.debitCents) - BigInt(line.creditCents), 0n) === 0n);
    }
  }
  return { ...report, schemaVersion: 8 as const, coverage: { ...report.coverage, templates }, rows };
}

export type FictionalTrialBalanceV8 = ReturnType<typeof parseFictionalTrialBalanceV8>;
export type FictionalJournalV8 = ReturnType<typeof parseFictionalJournalV8>;
