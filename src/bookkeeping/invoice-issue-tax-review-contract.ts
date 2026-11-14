import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';
import { calculateInclusiveFinanceCharge, isFinanceCents, isFinanceDecimalRate } from './finance-inclusive-charge.ts';

export type InvoiceIssueJurisdictions = Readonly<Record<string, string>>;
type IssueReviewReference = Readonly<{ draftId: string; revision: string }>;

const reviewStops = ['absent', 'stale', 'cancelled', 'completed_scope_required', 'due_date_review_required'] as const;
const lineStates = ['complimentary_review_required', 'service_classification_required', 'jurisdiction_required',
  'tax_profile_required', 'exemption_review_required', 'ready'] as const;
const treatments = ['unresolved', 'exempt', 'non_taxable', 'inclusive_single'] as const;
const componentKeys = ['grossInclusiveCents', 'discountInclusiveCents', 'inclusiveCents', 'grossNetCents',
  'netCents', 'taxCents', 'discountNetCents'] as const;

export function parseInvoiceIssueTaxRequest(value: unknown) {
  check(exact(value, ['draftId', 'revision', 'jurisdictions']) && customerUuid(value.draftId)
    && customerVersion(value.revision) && value.jurisdictions !== null && typeof value.jurisdictions === 'object'
    && !Array.isArray(value.jurisdictions));
  const entries = Object.entries(value.jurisdictions);
  check(entries.length <= 180 && entries.every(([id, jurisdiction]) =>
    customerUuid(id) && financeAccountReviewReason(jurisdiction) && [...jurisdiction].length <= 200));
  return Object.freeze({ draftId: value.draftId, revision: value.revision,
    jurisdictions: Object.freeze(Object.fromEntries(entries)) as InvoiceIssueJurisdictions });
}

export function parseInvoiceIssueTaxReview(value: unknown, businessId: string, reference: IssueReviewReference,
  jurisdictions: InvoiceIssueJurisdictions) {
  if (exact(value, ['state'])) {
    const state = reviewStops.find(stop => stop === value.state);
    check(state);
    return { state } as const;
  }
  check(exact(value, ['schemaVersion', 'state', 'businessId', 'draftId', 'revision', 'jobId', 'issueDate', 'dueOn',
    'timezone', 'lines']) && value.schemaVersion === 1 && value.state === 'review'
    && value.businessId === businessId && value.draftId === reference.draftId && value.revision === reference.revision
    && customerUuid(value.jobId) && customerDate(value.issueDate) && customerDate(value.dueOn) && value.dueOn >= value.issueDate
    && typeof value.timezone === 'string' && value.timezone.length > 0 && value.timezone.length <= 128
    && Array.isArray(value.lines) && value.lines.length >= 1 && value.lines.length <= 180);

  const { issueDate } = value;
  const lines = value.lines.map((line: unknown) => {
    const fields=['outcomeId', 'description', 'serviceId', 'grossInclusiveCents', 'discountInclusiveCents',
      'inclusiveCents', 'complimentaryReason', 'jurisdiction', 'availableJurisdictions', 'state', 'profileId',
      'profileVersion', 'profileEffectiveFrom', 'treatment', 'rate', 'components'];
    check((exact(line,fields) || exact(line,[...fields,'exemptionEvidenceId','exemptionEvidenceVersion']))
      && customerUuid(line.outcomeId) && typeof line.description === 'string' && line.description.trim().length > 0
      && [...line.description].length <= 2000 && (line.serviceId === null || customerUuid(line.serviceId))
      && (line.complimentaryReason === null || financeAccountReviewReason(line.complimentaryReason))
      && isFinanceCents(line.grossInclusiveCents) && isFinanceCents(line.discountInclusiveCents) && isFinanceCents(line.inclusiveCents)
      && BigInt(line.grossInclusiveCents) - BigInt(line.discountInclusiveCents) === BigInt(line.inclusiveCents)
      && line.jurisdiction === (jurisdictions[line.outcomeId] ?? null)
      && Array.isArray(line.availableJurisdictions) && line.availableJurisdictions.length <= 25
      && line.availableJurisdictions.every(item => financeAccountReviewReason(item) && [...item].length <= 200)
      && new Set(line.availableJurisdictions).size === line.availableJurisdictions.length);
    const treatment = treatments.find(kind => kind === line.treatment) ?? null;
    check(line.treatment === treatment && (treatment === null
      ? line.profileId === null && line.profileVersion === null && line.profileEffectiveFrom === null
      : customerUuid(line.profileId) && customerVersion(line.profileVersion) && customerDate(line.profileEffectiveFrom)
        && line.profileEffectiveFrom <= issueDate)
      && (treatment === 'inclusive_single' ? isFinanceDecimalRate(line.rate) && line.rate !== '0' : line.rate === null));
    const hasExemption=customerUuid(line.exemptionEvidenceId)&&customerVersion(line.exemptionEvidenceVersion);
    check(hasExemption?treatment==='exempt':
      !Object.hasOwn(line,'exemptionEvidenceId')&&!Object.hasOwn(line,'exemptionEvidenceVersion'));
    const state = lineStates.find(kind => kind === line.state);
    const expectedState = line.inclusiveCents === '0' && line.complimentaryReason === null ? 'complimentary_review_required'
      : line.serviceId === null ? 'service_classification_required'
        : line.jurisdiction === null ? 'jurisdiction_required'
          : treatment === null || treatment === 'unresolved' ? 'tax_profile_required'
            : treatment === 'exempt' && !hasExemption ? 'exemption_review_required' : 'ready';
    check(state === expectedState);
    let components: ReturnType<typeof calculateInclusiveFinanceCharge> | null = null;
    if (state === 'ready') {
      const computed = calculateInclusiveFinanceCharge(line.grossInclusiveCents, line.discountInclusiveCents,
        treatment === 'inclusive_single' && typeof line.rate === 'string' ? line.rate : '0');
      const returned = line.components;
      check(exact(returned, componentKeys) && componentKeys.every(key => returned[key] === computed[key]));
      components = computed;
    } else {
      check(line.components === null);
    }
    return Object.freeze({ outcomeId: line.outcomeId, description: line.description, serviceId: line.serviceId,
      inclusiveCents: line.inclusiveCents, jurisdiction: jurisdictions[line.outcomeId] ?? null, state,
      profileId:customerUuid(line.profileId)?line.profileId:null,
      treatment, profileEffectiveFrom: line.profileEffectiveFrom as string | null,
      availableJurisdictions: Object.freeze(line.availableJurisdictions.slice()) as readonly string[], components,
      ...(hasExemption ? { exemptionEvidenceId:line.exemptionEvidenceId as string,
        exemptionEvidenceVersion:line.exemptionEvidenceVersion as string } : {}) });
  });
  const ids = new Set(lines.map(line => line.outcomeId));
  check(ids.size === lines.length && Object.keys(jurisdictions).every(id => ids.has(id)));
  return Object.freeze({ state: 'review' as const, jobId: value.jobId, issueDate: value.issueDate, dueOn: value.dueOn,
    timezone: value.timezone, lines: Object.freeze(lines) });
}

const invoiceAccounts = { ar: '1100', discount: '4900', service_revenue: '4000' } as const;
export type InvoiceFixedPurpose = keyof typeof invoiceAccounts;

export function parseInvoiceIssueReadiness(value: unknown, businessId: string, request: ReturnType<typeof parseInvoiceIssueTaxRequest>) {
  check(exact(value, ['taxReview', 'accountReview']));
  const tax = parseInvoiceIssueTaxReview(value.taxReview, businessId, request, request.jurisdictions);
  if (tax.state !== 'review' || tax.lines.some(line => !line.components)) {
    check(value.accountReview === null);
    return { tax, accounts: null } as const;
  }
  if (value.accountReview === null) return { tax, accounts: null } as const;
  const accounts = value.accountReview;
  const fields = ['fixedMappings', 'missingFixedPurposes', 'requiredTaxJurisdictions'];
  check((exact(accounts, fields) || exact(accounts, [...fields, 'taxMappings']))
    && accounts.fixedMappings !== null && typeof accounts.fixedMappings === 'object' && !Array.isArray(accounts.fixedMappings)
    && Array.isArray(accounts.missingFixedPurposes) && Array.isArray(accounts.requiredTaxJurisdictions));

  const required = new Set<InvoiceFixedPurpose>(), taxJurisdictions = new Set<string>();
  for (const line of tax.lines) {
    const amounts = line.components!;
    if (amounts.inclusiveCents !== '0') required.add('ar');
    if (amounts.discountNetCents !== '0') required.add('discount');
    if (amounts.grossNetCents !== '0') required.add('service_revenue');
    if (amounts.taxCents !== '0' && line.jurisdiction) taxJurisdictions.add(line.jurisdiction);
  }
  for (const [purpose, mapping] of Object.entries(accounts.fixedMappings)) {
    check(Object.hasOwn(invoiceAccounts, purpose) && required.delete(purpose as InvoiceFixedPurpose)
      && exact(mapping, ['mappingId', 'accountId', 'accountCode'])
      && customerUuid(mapping.mappingId) && customerUuid(mapping.accountId)
      && mapping.accountCode === invoiceAccounts[purpose as InvoiceFixedPurpose]);
  }
  const missing = accounts.missingFixedPurposes as InvoiceFixedPurpose[];
  const jurisdictions = accounts.requiredTaxJurisdictions as string[];
  const taxMappings = new Map<string, Readonly<{ mappingId: string; accountId: string }>>();
  if (Object.hasOwn(accounts, 'taxMappings')) {
    check(accounts.taxMappings !== null && typeof accounts.taxMappings === 'object' && !Array.isArray(accounts.taxMappings));
    const entries = Object.entries(accounts.taxMappings);
    check(entries.length > 0);
    for (const [jurisdiction, mapping] of entries) {
      check(taxJurisdictions.delete(jurisdiction)
        && exact(mapping, ['mappingId', 'accountId', 'accountCode']) && mapping.accountCode === '2100'
        && customerUuid(mapping.mappingId) && customerUuid(mapping.accountId));
      taxMappings.set(jurisdiction, Object.freeze({ mappingId: mapping.mappingId, accountId: mapping.accountId }));
    }
  }
  check(missing.every(purpose => required.delete(purpose)) && required.size === 0
    && jurisdictions.every(jurisdiction => taxJurisdictions.delete(jurisdiction)) && taxJurisdictions.size === 0);
  return { tax, accounts: { missing: Object.freeze(missing.slice()), jurisdictions: Object.freeze(jurisdictions.slice()),
    ...(taxMappings.size ? { taxMappings } : {}) } } as const;
}
