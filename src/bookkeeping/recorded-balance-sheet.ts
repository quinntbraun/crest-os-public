import { requireFinanceAccount } from './finance-account-contract';
import type { parseFictionalTrialBalance } from './trial-balance-contract';

type TrialBalance = ReturnType<typeof parseFictionalTrialBalance>;
type Line = Pick<TrialBalance['rows'][number], 'accountId' | 'code' | 'name' | 'active'> & { cents: bigint };
const sectionTypes = new Map<string, { key: 'assets' | 'liabilities' | 'equity'; sign: bigint }>([
  ['asset', { key: 'assets', sign: 1n }],
  ['liability', { key: 'liabilities', sign: -1n }],
  ['equity', { key: 'equity', sign: -1n }],
]);
const earningsTypes = new Set(['revenue', 'contra_revenue', 'expense']);

export function recordedBalanceSheet(balance: Pick<TrialBalance, 'rows'>) {
  const sections: Record<'assets' | 'liabilities' | 'equity', { lines: Line[]; total: bigint }> = {
    assets: { lines: [], total: 0n },
    liabilities: { lines: [], total: 0n },
    equity: { lines: [], total: 0n },
  };
  let earnings = 0n;
  for (const { accountId, code, name, active, balanceCents, accountType } of balance.rows) {
    const value = BigInt(balanceCents);
    const classification = sectionTypes.get(accountType);
    if (classification) {
      const section = sections[classification.key];
      const cents = value * classification.sign;
      if (cents !== 0n) section.lines.push({ accountId, code, name, active, cents });
      section.total += cents;
    } else {
      requireFinanceAccount(earningsTypes.has(accountType));
      earnings -= value;
    }
  }
  const totalEquity = sections.equity.total + earnings;
  const liabilitiesAndEquity = sections.liabilities.total + totalEquity;
  requireFinanceAccount(sections.assets.total === liabilitiesAndEquity);
  return { schemaVersion: 1 as const, sections, earnings, totalEquity, liabilitiesAndEquity };
}
