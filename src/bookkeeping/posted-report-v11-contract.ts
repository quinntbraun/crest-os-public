import { customerUuid } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV10PageSize, parseFictionalJournalV10 } from './posted-report-v10-contract.ts';

export const fictionalJournalV11PageSize = fictionalJournalV10PageSize;

type TipLine = { purpose: 'tip_revenue' | 'tip_tax'; tipRealizationId: string };

function projectRow(input: unknown) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const row = input as Record<string, unknown>;
  if (row.template !== 'P03' || row.purpose !== 'tip_revenue' && row.purpose !== 'tip_tax') {
    return { row, tip: null };
  }
  const { purpose, tipRealizationId, code } = row;
  check(customerUuid(tipRealizationId) && customerUuid(row.paymentId) && row.fundLotId === null
    && row.debitCents === '0' && (purpose === 'tip_revenue' ? code === '4100' : code === '2100'));
  const tip: TipLine = { purpose, tipRealizationId };
  return { row: { ...row, purpose: 'receipt_ar', tipRealizationId: null }, tip };
}

export function parseFictionalJournalV11(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV11PageSize) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  check(report.schemaVersion === 11 && Array.isArray(report.rows) && report.rows.length <= pageSize);
  const candidates = report.rows.map(projectRow);
  const prior = parseFictionalJournalV10({ ...report, schemaVersion: 10, rows: candidates.map(entry => entry.row) },
    businessId, throughOn, accountId, afterLineId, pageSize);
  const rows = prior.rows.map((row, index) => {
    const { tip } = candidates[index]!;
    if (tip === null) return row;
    check(row.template === 'P03' && customerUuid(row.paymentId));
    return { ...row, ...tip, template:'P03' as const, paymentId:row.paymentId, tipRealizationId:tip.tipRealizationId };
  });
  const events = new Map<string, { payment: string; tip: string; purposes: Set<string> }>();
  const byTip = new Map<string, string>();
  for (const row of rows) {
    if (row.template !== 'P03' || row.purpose !== 'tip_revenue' && row.purpose !== 'tip_tax') continue;
    check(customerUuid(row.paymentId) && customerUuid(row.tipRealizationId));
    const seen = events.get(row.eventId) ?? { payment: row.paymentId, tip: row.tipRealizationId, purposes: new Set<string>() };
    const eventId = byTip.get(row.tipRealizationId);
    check(seen.payment === row.paymentId && seen.tip === row.tipRealizationId && !seen.purposes.has(row.purpose)
      && (eventId === undefined || eventId === row.eventId));
    seen.purposes.add(row.purpose);
    events.set(row.eventId, seen);
    byTip.set(row.tipRealizationId, row.eventId);
  }
  return { ...prior, schemaVersion: 11 as const, rows };
}

export type FictionalJournalV11 = ReturnType<typeof parseFictionalJournalV11>;
