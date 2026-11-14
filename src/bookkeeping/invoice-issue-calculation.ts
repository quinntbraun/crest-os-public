import { customerDate, customerUuid } from '../customer/customer-contract.ts';
import { calculateInclusiveFinanceCharge, isFinanceCents, isFinanceDecimalRate } from './finance-inclusive-charge.ts';

type Treatment =
  | Readonly<{ kind: 'inclusive_single'; rate: string }>
  | Readonly<{ kind: 'non_taxable' | 'exempt'; rate: null }>;
type VerifiedTax = Treatment & Readonly<{
  profileId: string;
  jurisdiction: string;
  effectiveFrom: string;
  exemptionEvidenceId?: string;
}>;
type InvoiceCharge = Readonly<{
  itemId: string;
  grossInclusiveCents: string;
  discountInclusiveCents: string;
  complimentaryReason: string | null;
  tax: VerifiedTax;
}>;
type Purpose = 'ar' | 'discount' | 'service_revenue' | 'tax_payable';
type Mapping = Readonly<{ accountId: string; versionId: string }>;
type Posting = Readonly<{
  itemId: string;
  purpose: Purpose;
  mapping: Mapping;
  debitCents: string;
  creditCents: string;
}>;

function requireInvoice(condition: unknown): asserts condition {
  if (!condition) throw new Error('INVOICE_POSTING_REVIEW_REQUIRED');
}

/** ACCOUNTING §4–5, P01 and P02. The issue transaction must independently verify
 * the approved profile, mappings, source, authority, periods and unique consumption.
 * This calculation prepares the expected amounts without making any writes.
 */
export function calculateInvoiceIssue(input: Readonly<{
  issueDate: string;
  dueDate?: string | null;
  items: readonly InvoiceCharge[];
  accounts: Readonly<Partial<Record<Exclude<Purpose, 'tax_payable'>, Mapping>>>;
  taxAccounts: ReadonlyMap<string, Mapping>;
}>) {
  const { issueDate, items, accounts, taxAccounts } = input;
  const dueDate = input.dueDate ?? issueDate;
  requireInvoice(customerDate(issueDate) && customerDate(dueDate) && dueDate >= issueDate && items.length > 0);
  requireInvoice(new Set(items.map(item => item.itemId)).size === items.length);

  const entries: Posting[] = [];
  function add(itemId: string, purpose: Purpose, mapping: Mapping | undefined, amount: string, side: 'debit' | 'credit') {
    if (amount === '0') return;
    requireInvoice(mapping && customerUuid(mapping.accountId) && customerUuid(mapping.versionId));
    entries.push(Object.freeze({
      itemId, purpose, mapping: Object.freeze({ accountId: mapping.accountId, versionId: mapping.versionId }),
      debitCents: side === 'debit' ? amount : '0',
      creditCents: side === 'credit' ? amount : '0',
    }));
  }

  let invoiceTotal = 0n;
  const components = items.map(item => {
    const tax = item.tax;
    requireInvoice(customerUuid(item.itemId) && customerUuid(tax.profileId)
      && typeof tax.jurisdiction === 'string' && tax.jurisdiction.trim() === tax.jurisdiction && tax.jurisdiction.length > 0
      && customerDate(tax.effectiveFrom) && tax.effectiveFrom <= issueDate
      && (tax.kind === 'inclusive_single' && isFinanceDecimalRate(tax.rate) && tax.rate !== '0'
        || (tax.kind === 'non_taxable' || tax.kind === 'exempt') && tax.rate === null)
      && (tax.kind === 'exempt' ? customerUuid(tax.exemptionEvidenceId) : tax.exemptionEvidenceId === undefined));

    const charge = calculateInclusiveFinanceCharge(item.grossInclusiveCents, item.discountInclusiveCents, tax.rate ?? '0');
    requireInvoice(charge.inclusiveCents !== '0'
      || typeof item.complimentaryReason === 'string' && item.complimentaryReason.trim().length > 0);
    invoiceTotal += BigInt(charge.inclusiveCents);
    add(item.itemId, 'ar', accounts.ar, charge.inclusiveCents, 'debit');
    add(item.itemId, 'discount', accounts.discount, charge.discountNetCents, 'debit');
    add(item.itemId, 'service_revenue', accounts.service_revenue, charge.grossNetCents, 'credit');
    add(item.itemId, 'tax_payable', taxAccounts.get(tax.jurisdiction), charge.taxCents, 'credit');
    return Object.freeze({ itemId: item.itemId, taxProfileId: tax.profileId, ...charge });
  });

  const totalCents = String(invoiceTotal);
  requireInvoice(isFinanceCents(totalCents));
  const debit = entries.reduce((sum, line) => sum + BigInt(line.debitCents), 0n);
  const credit = entries.reduce((sum, line) => sum + BigInt(line.creditCents), 0n);
  requireInvoice(debit === credit);
  return Object.freeze({
    issueDate, dueDate, totalCents, verifiedZeroEvent: entries.length === 0,
    components: Object.freeze(components), entries: Object.freeze(entries),
  });
}
