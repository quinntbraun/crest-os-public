import { expect, it } from 'vitest';
import { recordedBalanceSheet } from '../../src/bookkeeping/recorded-balance-sheet';

type Row = Parameters<typeof recordedBalanceSheet>[0]['rows'][number];
function account(code: string, accountType: Row['accountType'], balance: bigint, active = true): Row {
  return {
    accountId: code, code, name: code, active, accountType,
    normalSide: 'debit', balanceCents: String(balance),
    debitCents: String(balance > 0n ? balance : 0n),
    creditCents: String(balance < 0n ? -balance : 0n),
  };
}

it('includes historical earnings once and reduces assets and equity for contra balances', () => {
  const sheet = recordedBalanceSheet({ rows: [
    account('1000', 'asset', 1000n),
    account('1010', 'asset', -175n),
    account('1500', 'asset', 500n),
    account('1590', 'asset', -100n, false),
    account('2000', 'liability', -75n),
    account('2100', 'liability', -25n),
    account('3000', 'equity', -850n),
    account('3200', 'equity', 125n),
    account('4000', 'revenue', -600n),
    account('4100', 'revenue', -50n),
    account('4900', 'contra_revenue', 100n),
    account('4910', 'contra_revenue', 25n),
    account('5000', 'expense', 125n),
  ] });
  expect(sheet.sections.assets.total).toBe(1225n);
  expect(sheet.sections.assets.lines.find(line => line.code === '1590')).toMatchObject({ cents: -100n, active: false });
  expect(sheet.sections.liabilities.total).toBe(100n);
  expect(sheet.sections.equity.total).toBe(725n);
  expect(sheet.earnings).toBe(400n);
  expect(sheet.totalEquity).toBe(1125n);
  expect(sheet.liabilitiesAndEquity).toBe(1225n);
});

it('preserves negative balances and cents above the safe integer range', () => {
  const amount = 9007199254740993n;
  const sheet = recordedBalanceSheet({ rows: [account('1000', 'asset', -amount), account('5000', 'expense', amount)] });
  expect(sheet.earnings).toBe(-amount);
  expect(sheet.sections.assets.lines[0]?.cents).toBe(-amount);
  expect(sheet.liabilitiesAndEquity).toBe(-amount);
});

it('returns zero for an empty snapshot and fails closed for an unbalanced input', () => {
  expect(recordedBalanceSheet({ rows: [] }).liabilitiesAndEquity).toBe(0n);
  expect(() => recordedBalanceSheet({ rows: [account('1000', 'asset', 1n)] })).toThrow('FINANCE_ACCOUNT_REVIEW_REQUIRED');
});
