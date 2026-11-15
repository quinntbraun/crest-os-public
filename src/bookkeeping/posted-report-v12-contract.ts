import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { fictionalJournalV11PageSize, parseFictionalJournalV11 } from './posted-report-v11-contract.ts';

export const fictionalJournalV12PageSize = fictionalJournalV11PageSize;

export function parseFictionalJournalV12(input: unknown, businessId: string, throughOn: string,
  accountId: string | null, afterLineId: string | null, pageSize = fictionalJournalV12PageSize) {
  check(input !== null && typeof input === 'object' && !Array.isArray(input));
  const report = input as Record<string, unknown>;
  check(report.schemaVersion === 12);
  const prior = parseFictionalJournalV11({ ...report, schemaVersion: 11 }, businessId, throughOn,
    accountId, afterLineId, pageSize, true);
  return { ...prior, schemaVersion: 12 as const };
}

export type FictionalJournalV12 = ReturnType<typeof parseFictionalJournalV12>;
