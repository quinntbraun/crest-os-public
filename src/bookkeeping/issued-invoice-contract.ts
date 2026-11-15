import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { requireFinanceAccount as check } from './finance-account-contract.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';
import { parseInvoiceIssueReadiness, parseInvoiceIssueTaxRequest } from './invoice-issue-tax-review-contract.ts';

type ReviewRequest = ReturnType<typeof parseInvoiceIssueTaxRequest>;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const number = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,79}-[1-9][0-9]{0,18}$/.test(value);

export function parseInvoiceIssueReference(value: unknown) {
  check(exact(value, ['operationId', 'recoveryEpoch', 'draftId', 'revision'])
    && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch) && customerUuid(value.draftId)
    && customerVersion(value.revision));
  return { operationId: value.operationId, recoveryEpoch: value.recoveryEpoch, draftId: value.draftId, revision: value.revision };
}

export function parseReviewedInvoiceIssue(value: unknown, businessId: string, request: ReviewRequest) {
  check(exact(value, ['taxReview', 'accountReview', 'reviewDigest']) && digest(value.reviewDigest));
  const review = parseInvoiceIssueReadiness({ taxReview: value.taxReview, accountReview: value.accountReview }, businessId, request);
  return { ...review, reviewDigest: value.reviewDigest };
}

export function parseInvoiceIssueRequest(value: unknown) {
  check(exact(value, ['reference', 'jurisdictions', 'reviewDigest']) && digest(value.reviewDigest));
  const reference = parseInvoiceIssueReference(value.reference);
  const review = parseInvoiceIssueTaxRequest({ draftId: reference.draftId, revision: reference.revision, jurisdictions: value.jurisdictions });
  return { reference, jurisdictions: review.jurisdictions, reviewDigest: value.reviewDigest };
}

export function parseInvoiceIssueResult(value: unknown, businessId: string, reference: ReturnType<typeof parseInvoiceIssueReference>) {
  if (exact(value, ['state']) && value.state === 'absent') return { state: 'absent' } as const;
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation') {
    return { state: 'conflict', reason: 'operation' } as const;
  }
  if (exact(value, ['state', 'receipt']) && value.state === 'retired') {
    const { receipt } = value;
    check(exact(receipt,['schemaVersion','operationId','originalEpoch','reviewEpoch','draftId','draftRevision','auditEventId'])
      && receipt.schemaVersion===1 && receipt.operationId===reference.operationId && receipt.originalEpoch===reference.recoveryEpoch
      && receipt.draftId===reference.draftId && receipt.draftRevision===reference.revision
      && customerUuid(receipt.reviewEpoch) && customerUuid(receipt.auditEventId));
    return {state:'retired',receipt} as const;
  }
  check(exact(value, ['state', 'receipt']) && value.state === 'committed');
  const { receipt } = value;
  check(exact(receipt, ['schemaVersion', 'businessId', 'invoiceId', 'invoiceNumber', 'issuedOn', 'dueOn', 'totalCents',
    'eventId', 'receivableId', 'draftId', 'draftRevision'])
    && receipt.schemaVersion === 1 && receipt.businessId === businessId && customerUuid(receipt.invoiceId)
    && number(receipt.invoiceNumber) && customerDate(receipt.issuedOn) && customerDate(receipt.dueOn)
    && receipt.dueOn >= receipt.issuedOn && isFinanceCents(receipt.totalCents) && customerUuid(receipt.eventId)
    && (receipt.totalCents === '0' ? receipt.receivableId === null : customerUuid(receipt.receivableId))
    && receipt.draftId === reference.draftId && receipt.draftRevision === reference.revision);
  return { state: 'committed', receipt } as const;
}

export function parseIssuedInvoice(value: unknown, businessId: string, draftId: string) {
  if (exact(value, ['state']) && value.state === 'absent') return { state: 'absent' } as const;
  check(exact(value, ['state', 'schemaVersion', 'businessId', 'invoiceId', 'invoiceNumber', 'draftId', 'draftRevision',
    'issuedOn', 'dueOn', 'timezone', 'currency', 'totalCents', 'customer', 'location', 'lines'])
    && value.schemaVersion === 1 && value.state === 'issued' && value.businessId === businessId && value.draftId === draftId
    && customerUuid(value.invoiceId) && number(value.invoiceNumber) && customerVersion(value.draftRevision)
    && customerDate(value.issuedOn) && customerDate(value.dueOn) && value.dueOn >= value.issuedOn
    && typeof value.timezone === 'string' && value.timezone.length > 0 && value.timezone.length <= 128
    && value.currency === 'USD' && isFinanceCents(value.totalCents)
    && exact(value.customer, ['schemaVersion', 'id', 'displayName']) && value.customer.schemaVersion === 1
    && customerUuid(value.customer.id) && typeof value.customer.displayName === 'string' && value.customer.displayName.trim().length > 0
    && value.location !== null && typeof value.location === 'object' && !Array.isArray(value.location)
    && 'schemaVersion' in value.location && value.location.schemaVersion === 1
    && Array.isArray(value.lines) && value.lines.length >= 1 && value.lines.length <= 180);
  const lines = value.lines.map((line: unknown) => {
    const fields=['description', 'grossInclusiveCents', 'discountInclusiveCents', 'inclusiveCents', 'netCents', 'taxCents'];
    check((exact(line,fields) || exact(line,[...fields,'exemptionEvidenceId'])&&customerUuid(line.exemptionEvidenceId)&&line.taxCents==='0')
      && typeof line.description === 'string' && line.description.trim().length > 0 && [...line.description].length <= 2000
      && isFinanceCents(line.grossInclusiveCents) && isFinanceCents(line.discountInclusiveCents)
      && isFinanceCents(line.inclusiveCents) && isFinanceCents(line.netCents) && isFinanceCents(line.taxCents)
      && BigInt(line.grossInclusiveCents) - BigInt(line.discountInclusiveCents) === BigInt(line.inclusiveCents)
      && BigInt(line.netCents) + BigInt(line.taxCents) === BigInt(line.inclusiveCents));
    return { description: line.description, grossInclusiveCents: line.grossInclusiveCents, discountInclusiveCents: line.discountInclusiveCents,
      inclusiveCents: line.inclusiveCents, netCents: line.netCents, taxCents: line.taxCents,
      ...(customerUuid(line.exemptionEvidenceId)?{exemptionEvidenceId:line.exemptionEvidenceId}:{}) };
  });
  check(lines.reduce((sum, line) => sum + BigInt(line.inclusiveCents), 0n) === BigInt(value.totalCents));
  return { state: 'issued' as const, invoiceId:value.invoiceId, invoiceNumber:value.invoiceNumber, draftRevision:value.draftRevision,
    issuedOn:value.issuedOn, dueOn:value.dueOn, timezone:value.timezone, currency:value.currency, totalCents:value.totalCents,
    customer:{id:value.customer.id,displayName:value.customer.displayName}, location:value.location, lines };
}
