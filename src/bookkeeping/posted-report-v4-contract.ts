import { customerUuid, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import {
  fictionalJournalV3PageSize, parseFictionalJournalV3, parseFictionalTrialBalanceV3,
} from './posted-report-v3-contract.ts';

const previousTemplates = ['P01', 'P02', 'P03', 'P04', 'P05', 'P12'];
const templates = Object.freeze(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P12'] as const);

function projectReport(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  const { coverage, controls } = report;
  check(report.schemaVersion === 4 && exact(coverage, ['complete', 'openingBalancesIncluded', 'reconciliationVerified', 'templates'])
    && Array.isArray(coverage.templates) && coverage.templates.length === templates.length
    && templates.every((template, index) => (coverage.templates as unknown[])[index] === template)
    && exact(controls, ['ledgerBalanced', 'receivablesTie', 'moneyMovementsTie', 'customerFundsTie', 'taxPayableTie'])
    && controls.taxPayableTie === true);
  const { ledgerBalanced, receivablesTie, moneyMovementsTie, customerFundsTie } = controls;
  const previousControls = { ledgerBalanced, receivablesTie, moneyMovementsTie, customerFundsTie };
  return { ...report, schemaVersion: 3, coverage: { ...coverage, templates: previousTemplates }, controls: previousControls };
}

export function parseFictionalTrialBalanceV4(value: unknown, businessId: string, throughOn: string | null) {
  const report = parseFictionalTrialBalanceV3(projectReport(value), businessId, throughOn);
  return { ...report, schemaVersion: 4 as const, coverage: { ...report.coverage, templates },
    controls: { ...report.controls, taxPayableTie: true as const } };
}

type TipLine = { purpose: 'tip_funds'; fundLotId: string; tipRealizationId: string }
  | { purpose: 'tip_revenue' | 'tip_tax'; fundLotId: null; tipRealizationId: string };

function projectJournalRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'tipRealizationId'));
  const { tipRealizationId, ...row } = input as Record<string, unknown>;
  if (row.template !== 'P06') {
    check(tipRealizationId === null);
    return { row, tip: null };
  }
  const { purpose, fundLotId, code, debitCents, creditCents } = row;
  check(customerUuid(tipRealizationId) && row.invoiceId === null && row.paymentId === null && row.postedExpenseId === null
    && row.unapplicationId === null && row.fundApplicationId === null);
  let tip: TipLine;
  if (purpose === 'tip_funds') {
    check(code === '2000' && creditCents === '0' && customerUuid(fundLotId));
    tip = { purpose, fundLotId, tipRealizationId };
  } else {
    check((purpose === 'tip_revenue' && code === '4100' || purpose === 'tip_tax' && code === '2100')
      && debitCents === '0' && fundLotId === null);
    tip = { purpose, fundLotId, tipRealizationId };
  }
  // Reuse the established line and running-balance validation with a temporary
  // projection that preserves each account and debit/credit direction.
  return { tip, row: { ...row, template: 'P03', purpose: purpose === 'tip_funds' ? 'receipt_money' : 'receipt_ar',
    paymentId: tipRealizationId, fundLotId: null } };
}

export const fictionalJournalV4PageSize = fictionalJournalV3PageSize;

export function parseFictionalJournalV4(value: unknown, businessId: string, throughOn: string, accountId: string | null,
  afterLineId: string | null, pageSize = fictionalJournalV4PageSize) {
  const projected = projectReport(value);
  check(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
    && 'rows' in projected && Array.isArray(projected.rows) && projected.rows.length <= pageSize);
  const candidates = projected.rows.map(projectJournalRow);
  const report = parseFictionalJournalV3({ ...projected, rows: candidates.map(candidate => candidate.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = report.rows.map((row, index) => {
    const tip = candidates[index]!.tip;
    return tip === null
      ? { ...row, tipRealizationId: null }
      : { ...row, ...tip, template: 'P06' as const, paymentId: null };
  });
  type PostedTip = Extract<(typeof rows)[number], { template: 'P06' }>;
  const byTip = new Map<string, PostedTip[]>();
  const byEvent = new Map<string, string | null>();
  for (const row of rows) {
    const source = byEvent.get(row.eventId);
    check(source === undefined || source === row.tipRealizationId);
    byEvent.set(row.eventId, row.tipRealizationId);
    if (row.template !== 'P06') continue;
    const lines = byTip.get(row.tipRealizationId) ?? [];
    check(lines.every(line => line.purpose !== row.purpose && line.eventId === row.eventId && line.entryId === row.entryId
      && line.operationId === row.operationId && line.effectiveOn === row.effectiveOn && line.commitSequence === row.commitSequence
      && line.eventSequence === row.eventSequence && line.entrySequence === row.entrySequence));
    lines.push(row);
    byTip.set(row.tipRealizationId, lines);
  }
  if (accountId === null && afterLineId === null && !report.hasMore) {
    for (const lines of byTip.values()) {
      const funds = lines.find(row => row.purpose === 'tip_funds');
      check(funds && lines.length >= 2 && BigInt(funds.debitCents) === lines.reduce((total, row) => total + BigInt(row.creditCents), 0n));
    }
  }
  return { ...report, schemaVersion: 4 as const, coverage: { ...report.coverage, templates },
    controls: { ...report.controls, taxPayableTie: true as const }, rows };
}

export type FictionalTrialBalanceV4 = ReturnType<typeof parseFictionalTrialBalanceV4>;
export type FictionalJournalV4 = ReturnType<typeof parseFictionalJournalV4>;
