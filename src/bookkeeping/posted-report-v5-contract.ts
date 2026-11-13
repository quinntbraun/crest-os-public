import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import {
  fictionalJournalV4PageSize, parseFictionalJournalV4, parseFictionalTrialBalanceV4,
} from './posted-report-v4-contract.ts';

const previousTemplates = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P12'];
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P12'] as const);

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  const { coverage, controls } = report;
  check(report.schemaVersion === 5 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template)
    && exact(controls, ['ledgerBalanced', 'receivablesTie', 'moneyMovementsTie', 'customerFundsTie', 'taxPayableTie'])
    && controls.taxPayableTie === true);
  return { ...report, schemaVersion: 4, coverage: { ...coverage, templates: previousTemplates } };
}

export function parseFictionalTrialBalanceV5(value: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV4(projectReport(value), businessId, throughOn);
  return { ...report, schemaVersion: 5 as const, coverage: { ...report.coverage, templates },
    controls: { ...report.controls, taxPayableTie: true as const } };
}

type CreditLine = { purpose: 'credit_ar' | 'credit_discount' | 'credit_returns' | 'credit_tax'; invoiceCreditId: string };

function projectJournalRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'invoiceCreditId'));
  const { invoiceCreditId, ...row } = input as Record<string, unknown>;
  if (row.template !== 'P07') {
    check(invoiceCreditId === null);
    return { row, credit: null };
  }
  const { purpose, code, debitCents, creditCents } = row;
  check(customerUuid(invoiceCreditId) && row.invoiceId === null && row.paymentId === null && row.postedExpenseId === null
    && row.unapplicationId === null && row.fundApplicationId === null && row.fundLotId === null && row.tipRealizationId === null);
  const debit=purpose==='credit_returns'||purpose==='credit_tax';
  check(debit
    ? (purpose==='credit_returns'?code==='4910':code==='2100')&&creditCents==='0'
    : (purpose==='credit_ar'&&code==='1100'||purpose==='credit_discount'&&code==='4900')&&debitCents==='0');
  check(purpose==='credit_ar'||purpose==='credit_discount'||purpose==='credit_returns'||purpose==='credit_tax');
  const credit:CreditLine={purpose,invoiceCreditId};
  // Reuse established exact chronology, paging and running-balance validation.
  return { credit, row: { ...row, template: 'P03', purpose: debit ? 'receipt_money' : 'receipt_ar',
    paymentId: invoiceCreditId } };
}

export const fictionalJournalV5PageSize = fictionalJournalV4PageSize;

export function parseFictionalJournalV5(value: unknown, businessId: string, throughOn: string, accountId: string | null,
  afterLineId: string | null, pageSize = fictionalJournalV5PageSize) {
  const projected = projectReport(value);
  check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
    && 'rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectJournalRow);
  const report = parseFictionalJournalV4({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const credit = candidates[index]!.credit;
    return credit === null
      ? { ...row, invoiceCreditId: null }
      : { ...row, ...credit, template: 'P07' as const, paymentId: null };
  });
  type PostedCredit = Extract<(typeof rows)[number], { template: 'P07' }>;
  const byCredit = new Map<string, PostedCredit[]>();
  const byEvent = new Map<string, string | null>();
  for (const row of rows) {
    const source = byEvent.get(row.eventId);
    check(source === undefined || source === row.invoiceCreditId);
    byEvent.set(row.eventId, row.invoiceCreditId);
    if (row.template !== 'P07') continue;
    const lines = byCredit.get(row.invoiceCreditId) ?? [];
    check(lines.every(line => line.purpose !== row.purpose && line.eventId === row.eventId && line.entryId === row.entryId
      && line.operationId === row.operationId && line.effectiveOn === row.effectiveOn && line.commitSequence === row.commitSequence
      && line.eventSequence === row.eventSequence && line.entrySequence === row.entrySequence));
    lines.push(row);
    byCredit.set(row.invoiceCreditId, lines);
  }
  if (accountId === null && afterLineId === null && !report.hasMore) {
    for (const lines of byCredit.values()) {
      check(lines.some(row=>row.purpose==='credit_ar')&&lines.length>=2
        &&lines.reduce((total,row)=>total+BigInt(row.debitCents)-BigInt(row.creditCents),0n)===0n);
    }
  }
  return { ...report, schemaVersion: 5 as const, coverage: { ...report.coverage, templates },
    controls: { ...report.controls, taxPayableTie: true as const }, rows };
}

export type FictionalTrialBalanceV5 = ReturnType<typeof parseFictionalTrialBalanceV5>;
export type FictionalJournalV5 = ReturnType<typeof parseFictionalJournalV5>;
