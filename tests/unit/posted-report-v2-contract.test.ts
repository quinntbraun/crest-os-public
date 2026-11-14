import { describe, expect, it } from 'vitest';
import { parseFictionalJournal, parseFictionalTrialBalance } from '../../src/bookkeeping/trial-balance-contract.ts';
import {
  parseFictionalJournalV2, parseFictionalTrialBalanceV2, serializeFictionalJournalV2, serializeFictionalTrialBalanceV2,
} from '../../src/bookkeeping/posted-report-v2-contract.ts';

const id = (value: number) => 'ab112200-ec22-4141-a981-' + value.toString().padStart(12, '0');
const day = '2026-11-13', business = id(1), ar = id(2), funds = id(3);
const cents = '9007199254740993';
const legacyCoverage = { complete: false, openingBalancesIncluded: false, reconciliationVerified: false,
  templates: ['P01', 'P02', 'P03', 'P12'] };
const legacyControls = { ledgerBalanced: true, receivablesTie: true, moneyMovementsTie: true };
const context = {
  schemaVersion: 2, businessId: business, currency: 'USD', observedAt: day + 'T08:42:00.123456Z',
  throughOn: day, timeZone: 'America/Indiana/Indianapolis', coverageStart: day, postedEventCount: '1',
  coverage: { ...legacyCoverage, templates: ['P01', 'P02', 'P03', 'P05', 'P12'] },
  controls: { ...legacyControls, customerFundsTie: true },
};
const balance = {
  ...context,
  rows: [
    { accountId: ar, code: '1100', name: 'Accounts receivable', accountType: 'asset', normalSide: 'debit', active: true,
      debitCents: cents, creditCents: '0', balanceCents: cents },
    { accountId: funds, code: '2000', name: 'Customer funds held', accountType: 'liability', normalSide: 'credit', active: false,
      debitCents: '0', creditCents: cents, balanceCents: '-' + cents },
  ],
  totals: { debitCents: cents, creditCents: cents, debitBalanceCents: cents, creditBalanceCents: cents },
};
const arLine = {
  lineId: id(4), eventId: id(6), entryId: id(7), effectiveOn: day, commitSequence: '100',
  eventSequence: '1', entrySequence: '1', template: 'P05', purpose: 'unapply_ar', accountId: ar, code: '1100',
  name: 'Accounts receivable', debitCents: cents, creditCents: '0', runningBalanceCents: cents,
  invoiceId: null, paymentId: null, postedExpenseId: null, unapplicationId: id(8), fundLotId: null, operationId: id(9),
};
const fundsLine = {
  ...arLine, lineId: id(5), purpose: 'unapply_funds', accountId: funds, code: '2000', name: 'Customer funds held',
  debitCents: '0', creditCents: cents, runningBalanceCents: '-' + cents, fundLotId: id(10),
};
const journal = { ...context, rows: [arLine, fundsLine], hasMore: false, nextAfterLineId: null };

describe('held posted report version 2', () => {
  it('serializes exact cents, archived accounts, customer funds controls, and observation precision', () => {
    const result = parseFictionalTrialBalanceV2(balance, business, day);
    const wire = serializeFictionalTrialBalanceV2(result);
    expect(JSON.parse(wire)).toEqual(balance);
    expect(wire).toContain('"9007199254740993"');
    expect(result.observedAt).toBe(context.observedAt);
  });

  it('keeps version 1 input and returned bytes stable while rejecting mixed versions', () => {
    const v1 = { ...balance, schemaVersion: 1, coverage: legacyCoverage, controls: legacyControls };
    const original = JSON.stringify(parseFictionalTrialBalance(v1, business, day));
    expect(() => parseFictionalTrialBalance(balance, business, day)).toThrow();
    expect(() => parseFictionalTrialBalanceV2(v1, business, day)).toThrow();
    expect(JSON.stringify(parseFictionalTrialBalance(v1, business, day))).toBe(original);
    const fields = Object.fromEntries(Object.entries(arLine).filter(([key]) => key !== 'unapplicationId' && key !== 'fundLotId'));
    const v1Journal = { ...context, schemaVersion: 1, coverage: legacyCoverage, controls: legacyControls,
      rows: [{ ...fields, template: 'P01', purpose: 'ar', invoiceId: id(12) }], hasMore: false, nextAfterLineId: null };
    expect(parseFictionalJournal(v1Journal, business, day, ar, null).rows[0]?.invoiceId).toBe(id(12));
    expect(() => parseFictionalJournalV2(v1Journal, business, day, ar, null)).toThrow();
  });

  it('refuses uncertain customer funds or falsely complete coverage and rejects inexact controls and totals', () => {
    const bad = [
      { ...balance, controls: legacyControls },
      { ...balance, controls: { ...context.controls, customerFundsTie: false } },
      { ...balance, coverage: { ...context.coverage, complete: true } },
      { ...balance, coverage: { ...context.coverage, templates: legacyCoverage.templates } },
      { ...balance, observedAt: day + 'T08:42:00.123Z' },
      { ...balance, totals: { ...balance.totals, debitCents: '9007199254740992' } },
      { ...balance, rows: [balance.rows[0], { ...balance.rows[1], balanceCents: cents }] },
    ];
    for (const candidate of bad) expect(() => parseFictionalTrialBalanceV2(candidate, business, day)).toThrow();
    expect(() => parseFictionalTrialBalanceV2(balance, id(20), day)).toThrow();
  });

  it('round-trips the two typed P05 lines and refuses forged source references, amounts, or ordering', () => {
    const parsed = parseFictionalJournalV2(journal, business, day, null, null);
    expect(JSON.parse(serializeFictionalJournalV2(parsed, null, null))).toEqual(journal);
    expect(parsed.rows[1]?.fundLotId).toBe(id(10));
    for (const rows of [
      [{ ...arLine, fundLotId: id(10) }, fundsLine],
      [arLine, { ...fundsLine, unapplicationId: null }],
      [arLine, { ...fundsLine, paymentId: id(19) }],
      [arLine, { ...fundsLine, fundLotId: null }],
      [arLine, { ...fundsLine, code: '1000' }],
      [arLine, { ...fundsLine, eventId: id(18) }],
      [arLine, { ...fundsLine, creditCents: '1', runningBalanceCents: '-1' }],
      [arLine, { ...fundsLine, debitCents: cents, creditCents: '0' }],
      [arLine, { ...fundsLine, runningBalanceCents: '-1' }],
      [fundsLine, arLine],
      [arLine, { ...fundsLine, lineId: arLine.lineId }],
    ]) expect(() => parseFictionalJournalV2({ ...journal, rows }, business, day, null, null)).toThrow();
    expect(() => parseFictionalJournalV2(journal, business, day, ar, null)).toThrow();
  });

  it('binds the cursor to the requested page and checks running balance on every visible account line after its first', () => {
    const first = { ...journal, rows: [arLine], hasMore: true, nextAfterLineId: arLine.lineId };
    expect(parseFictionalJournalV2(first, business, day, ar, null, 1).nextAfterLineId).toBe(arLine.lineId);
    expect(() => parseFictionalJournalV2({ ...first, nextAfterLineId: id(99) }, business, day, ar, null, 1)).toThrow();
    const other = { ...fundsLine, lineId: id(11), unapplicationId: id(13), eventId: id(14), entryId: id(15),
      operationId: id(16), fundLotId: id(17), commitSequence: '101', creditCents: '1', runningBalanceCents: '-9007199254740994' };
    const next = { ...journal, rows: [fundsLine, other] };
    expect(parseFictionalJournalV2(next, business, day, funds, arLine.lineId).rows).toHaveLength(2);
    expect(() => parseFictionalJournalV2({ ...next, rows: [fundsLine, { ...other, runningBalanceCents: '-1' }] },
      business, day, funds, arLine.lineId)).toThrow();
  });
});
