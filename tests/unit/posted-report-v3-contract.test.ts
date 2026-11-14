import { describe, expect, it } from 'vitest';
import {
  parseFictionalJournalV3, parseFictionalTrialBalanceV3, serializeFictionalJournalV3, serializeFictionalTrialBalanceV3,
} from '../../src/bookkeeping/posted-report-v3-contract.ts';
import { parseFictionalJournalV2, parseFictionalTrialBalanceV2 } from '../../src/bookkeeping/posted-report-v2-contract.ts';

const id = (value: number) => 'ab112200-ec22-4141-a981-' + value.toString().padStart(12, '0');
const day = '2026-11-13', business = id(1), ar = id(2), funds = id(3), cents = '9007199254740993';
const context = {
  schemaVersion: 3, businessId: business, currency: 'USD', observedAt: day + 'T08:42:00.123456Z',
  throughOn: day, timeZone: 'America/Indiana/Indianapolis', coverageStart: day, postedEventCount: '2',
  coverage: { complete: false, openingBalancesIncluded: false, reconciliationVerified: false, templates: ['P01', 'P02', 'P03', 'P04', 'P05', 'P12'] },
  controls: { ledgerBalanced: true, receivablesTie: true, moneyMovementsTie: true, customerFundsTie: true },
};
const balance = {
  ...context,
  rows: [
    { accountId: ar, code: '1100', name: 'Accounts receivable', accountType: 'asset', normalSide: 'debit', active: true,
      debitCents: cents, creditCents: cents, balanceCents: '0' },
    { accountId: funds, code: '2000', name: 'Customer funds held', accountType: 'liability', normalSide: 'credit', active: false,
      debitCents: cents, creditCents: cents, balanceCents: '0' },
  ],
  totals: { debitCents: '18014398509481986', creditCents: '18014398509481986', debitBalanceCents: '0', creditBalanceCents: '0' },
};
const unapplyAr = {
  lineId: id(4), eventId: id(10), entryId: id(11), effectiveOn: day, commitSequence: '1', eventSequence: '1', entrySequence: '1',
  template: 'P05', purpose: 'unapply_ar', accountId: ar, code: '1100', name: 'Accounts receivable', debitCents: cents, creditCents: '0',
  runningBalanceCents: cents, invoiceId: null, paymentId: null, postedExpenseId: null, unapplicationId: id(12),
  fundApplicationId: null, fundLotId: null, operationId: id(13),
};
const unapplyFunds = {
  ...unapplyAr, lineId: id(5), purpose: 'unapply_funds', accountId: funds, code: '2000', name: 'Customer funds held',
  debitCents: '0', creditCents: cents, runningBalanceCents: '-' + cents, fundLotId: id(14),
};
const applyFunds = {
  ...unapplyFunds, lineId: id(6), eventId: id(15), entryId: id(16), commitSequence: '2', template: 'P04', purpose: 'apply_funds',
  debitCents: cents, creditCents: '0', runningBalanceCents: '0', unapplicationId: null, fundApplicationId: id(17), operationId: id(18),
};
const applyAr = {
  ...applyFunds, lineId: id(7), purpose: 'apply_ar', accountId: ar, code: '1100', name: 'Accounts receivable',
  debitCents: '0', creditCents: cents, fundLotId: null,
};
const journal = { ...context, rows: [unapplyAr, unapplyFunds, applyFunds, applyAr], hasMore: false, nextAfterLineId: null };
const v3 = (value: unknown = journal, account: string | null = null, cursor: string | null = null, pageSize?: number) =>
  parseFictionalJournalV3(value, business, day, account, cursor, pageSize);

describe('posted report V3 P04 customer-funds application', () => {
  it('round-trips the exact SQL coverage, cent strings, exclusive source links and running balances', () => {
    const parsedBalance = parseFictionalTrialBalanceV3(balance, business, day);
    const parsedJournal = v3();
    expect(JSON.parse(serializeFictionalTrialBalanceV3(parsedBalance))).toEqual(balance);
    expect(JSON.parse(serializeFictionalJournalV3(parsedJournal, null, null))).toEqual(journal);
    expect(parsedJournal.rows[2]).toMatchObject({ template: 'P04', purpose: 'apply_funds', code: '2000',
      debitCents: cents, fundApplicationId: id(17), fundLotId: id(14), paymentId: null });
    expect(parsedJournal.rows[3]).toMatchObject({ template: 'P04', purpose: 'apply_ar', code: '1100',
      creditCents: cents, fundApplicationId: id(17), fundLotId: null, invoiceId: null });
  });

  it('keeps v2 coverage and journal fields exact, and rejects incorrect v3 coverage, controls, dates and totals', () => {
    const prior = { ...context, schemaVersion: 2, coverage: { ...context.coverage, templates: ['P01', 'P02', 'P03', 'P05', 'P12'] } };
    const v2Balance = { ...balance, ...prior };
    const stripApplication = (line: typeof unapplyAr | typeof unapplyFunds) => {
      const { fundApplicationId: ignored, ...row } = line;
      void ignored;
      return row;
    };
    const v2Journal = { ...journal, ...prior, rows: [stripApplication(unapplyAr), stripApplication(unapplyFunds)] };
    expect(parseFictionalTrialBalanceV2(v2Balance, business, day).schemaVersion).toBe(2);
    expect(parseFictionalJournalV2(v2Journal, business, day, null, null).rows[0]?.template).toBe('P05');
    expect(() => v3(v2Journal)).toThrow();
    expect(() => parseFictionalTrialBalanceV2(balance, business, day)).toThrow();
    for (const candidate of [
      v2Balance,
      { ...balance, coverage: prior.coverage },
      { ...balance, coverage: { ...context.coverage, templates: [...context.coverage.templates].reverse() } },
      { ...balance, controls: { ...context.controls, customerFundsTie: false } },
      { ...balance, totals: { ...balance.totals, creditCents: cents } },
      { ...balance, observedAt: day + 'T08:42:00.123Z' },
    ]) expect(() => parseFictionalTrialBalanceV3(candidate, business, day)).toThrow();
    expect(() => parseFictionalTrialBalanceV3(balance, id(99), day)).toThrow();
    expect(() => parseFictionalTrialBalanceV3(balance, business, '2026-11-12')).toThrow();
  });

  it('rejects incorrect P04 posting directions, accounts, source links and inconsistent pairs', () => {
    const changeFunds = (patch: object) => [unapplyAr, unapplyFunds, { ...applyFunds, ...patch }, applyAr];
    const changeAr = (patch: object) => [unapplyAr, unapplyFunds, applyFunds, { ...applyAr, ...patch }];
    const { fundApplicationId: ignored, ...missingSource } = applyFunds;
    void ignored;
    for (const rows of [
      changeFunds({ code: '1100' }), changeAr({ code: '2000' }),
      changeFunds({ debitCents: '0', creditCents: cents }), changeAr({ creditCents: '0', debitCents: cents }),
      changeFunds({ fundLotId: null }), changeAr({ fundLotId: id(14) }),
      changeFunds({ paymentId: id(31) }), changeAr({ invoiceId: id(32) }),
      changeFunds({ unapplicationId: id(12) }), changeAr({ postedExpenseId: id(33) }),
      changeFunds({ fundApplicationId: null }), changeAr({ fundApplicationId: id(41) }),
      changeAr({ eventId: id(39) }), changeAr({ entryId: id(39) }), changeAr({ operationId: id(39) }),
      changeAr({ eventSequence: '2' }), changeAr({ entrySequence: '2' }),
      changeAr({ creditCents: '1', runningBalanceCents: '9007199254740992' }),
      changeAr({ runningBalanceCents: '-1' }),
      [unapplyAr, unapplyFunds, missingSource, applyAr],
      [{ ...unapplyAr, fundApplicationId: id(17) }, unapplyFunds, applyFunds, applyAr],
      [unapplyAr, unapplyFunds, applyFunds, { ...applyAr, lineId: applyFunds.lineId }],
      [unapplyAr, unapplyFunds, applyAr, applyFunds],
      [unapplyAr, unapplyFunds, applyFunds],
      [...journal.rows, { ...applyAr, lineId: id(90), runningBalanceCents: '-' + cents }],
    ]) expect(() => v3({ ...journal, rows })).toThrow();
  });

  it('supports split pairs and account-specific pages while enforcing cursor and within-account balances', () => {
    const first = { ...journal, rows: [unapplyAr, unapplyFunds, applyFunds], hasMore: true, nextAfterLineId: applyFunds.lineId };
    expect(v3(first, null, null, 3).nextAfterLineId).toBe(applyFunds.lineId);
    expect(v3({ ...journal, rows: [applyAr] }, null, applyFunds.lineId, 3).rows).toHaveLength(1);
    expect(v3({ ...journal, rows: [unapplyAr, applyAr] }, ar).rows[1]?.runningBalanceCents).toBe('0');
    expect(() => v3(first, null, null, 2)).toThrow();
    expect(() => v3({ ...first, nextAfterLineId: applyAr.lineId }, null, null, 3)).toThrow();
    expect(() => v3({ ...journal, rows: [applyAr] }, null, applyAr.lineId)).toThrow();
    expect(() => v3(journal, ar)).toThrow();
  });
});
