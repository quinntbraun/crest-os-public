import { expenseDollars } from '../../../bookkeeping/expenses/expense-contract';
import { recordedBalanceSheet } from '../../../bookkeeping/recorded-balance-sheet';
import type { parseFictionalTrialBalance } from '../../../bookkeeping/trial-balance-contract';
import { downloadFinanceHistory } from '../../../client/finance-accounts';
import styles from './screen.module.css';

const usd = (cents: bigint) => cents < 0n ? '-$' + expenseDollars(String(-cents)) : '$' + expenseDollars(String(cents));
const coverage = 'Fictional posted records only. Opening balances, reconciliation and some costs are incomplete.';
const basis = 'Operational books · invoice-issued recognition';
const supplierBasis = 'Operational books · revenue at invoice issue and supplier costs when incurred';
const labels = { assets: 'Assets', liabilities: 'Liabilities', equity: 'Posted equity' } as const;

export function RecordedBalanceSheet({ balance, journalBusy, selectJournalAccount }: {
  balance: ReturnType<typeof parseFictionalTrialBalance>;
  journalBusy: boolean;
  selectJournalAccount: (id: string) => void;
}) {
  const sheet = recordedBalanceSheet(balance);
  const reportBasis = 'schemaVersion' in balance && balance.schemaVersion === 11 ? supplierBasis : basis;
  const sections = (Object.keys(labels) as (keyof typeof labels)[]).map(key => ({
    label: labels[key], ...sheet.sections[key],
  }));
  function download() {
    downloadFinanceHistory('crest-fictional-balance-sheet-' + balance.throughOn + '.csv', [
      ['Through date', 'Timezone', 'Currency', 'Observed UTC', 'Report version', 'First posting', 'Posted events', 'Basis', 'Coverage'],
      [balance.throughOn, balance.timeZone, balance.currency, balance.observedAt, String(sheet.schemaVersion),
        balance.coverageStart ?? '', balance.postedEventCount, reportBasis, coverage],
      [],
      ['Section', 'Account code', 'Account', 'Status', 'Balance cents'],
      ...sections.flatMap(({ label, lines, total }) => [
        ...lines.map(row => [label, row.code, row.name, row.active ? 'Active' : 'Archived', row.cents]),
        [label, '', 'Subtotal', '', total],
      ]),
      ['Equity', '', 'Accumulated recorded-book earnings', '', sheet.earnings],
      ['Equity', '', 'Total equity', '', sheet.totalEquity],
      ['Liabilities and equity', '', 'Total liabilities and equity', '', sheet.liabilitiesAndEquity],
    ]);
  }
  return <details className="review-card">
    <summary>Balance sheet</summary>
    <section aria-label="Recorded balance sheet">
      <h3>Recorded balance sheet</h3>
      <p>Through {balance.throughOn} · USD · {balance.timeZone}</p>
      <p>{reportBasis}. {coverage}</p>
      {balance.coverageStart && <p>First included posting {balance.coverageStart}.</p>}
      <p className="field-help">Same snapshot as the trial balance. Select an account to review its journal entries.</p>
      <div className={styles.balanceScroll} role="region" aria-label="Balance sheet accounts" tabIndex={0}>
        <table className={styles.balanceTable}>
          <thead><tr><th scope="col">Account</th><th scope="col">Balance</th></tr></thead>
          {sections.map(({ label, lines, total }) => <tbody key={label}>
            <tr><th colSpan={2} scope="rowgroup">{label}</th></tr>
            {lines.map(row => <tr key={row.accountId}>
              <th scope="row">
                <button type="button" className="secondary" disabled={journalBusy} onClick={() => selectJournalAccount(row.accountId)}>
                  {row.code} · {row.name}
                </button>
                {!row.active && <small>Archived</small>}
              </th>
              <td>{usd(row.cents)}</td>
            </tr>)}
            <tr><th scope="row">Total {label.toLowerCase()}</th><td>{usd(total)}</td></tr>
          </tbody>)}
          <tfoot>
            <tr><th scope="row">Accumulated recorded-book earnings</th><td>{usd(sheet.earnings)}</td></tr>
            <tr><th scope="row">Total equity</th><td>{usd(sheet.totalEquity)}</td></tr>
            <tr><th scope="row">Total liabilities and equity</th><td>{usd(sheet.liabilitiesAndEquity)}</td></tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="secondary" onClick={download}>Download balance sheet CSV</button>
    </section>
  </details>;
}
