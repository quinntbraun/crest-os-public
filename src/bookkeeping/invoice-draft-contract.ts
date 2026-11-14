import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason } from './finance-account-contract.ts';
import { parseInvoicePreparationLines } from './invoice-preparation-contract.ts';

export type InvoiceDraftReference = Readonly<{
  operationId: string;
  recoveryEpoch: string;
  draftId: string;
  jobId: string;
  expectedRevision: string;
}>;
export type InvoiceDraftInput = Readonly<{
  dueOn: string | null;
  outcomes: readonly string[];
  cancelReason: string | null;
}>;

const referenceFields = ['operationId', 'recoveryEpoch', 'draftId', 'jobId', 'expectedRevision'] as const;
const summaryFields = ['schemaVersion', 'draftId', 'jobId', 'customerId', 'revision', 'dueOn', 'state',
  'reason', 'auditEventId', 'lineCount', 'linesSha256'] as const;

function check(value: unknown): asserts value {
  if (!value) throw Error('INVOICE_DRAFT_REVIEW_REQUIRED');
}

export function parseInvoiceDraftReference(value: unknown): InvoiceDraftReference {
  check(exact(value, referenceFields) && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch)
    && customerUuid(value.draftId) && customerUuid(value.jobId) && customerVersion(value.expectedRevision, true)
    && BigInt(value.expectedRevision) < 9_223_372_036_854_775_807n);
  return Object.freeze(value) as InvoiceDraftReference;
}

export function parseInvoiceDraftInput(value: unknown, reference: InvoiceDraftReference): InvoiceDraftInput {
  check(exact(value, ['dueOn', 'outcomes', 'cancelReason'])
    && (value.dueOn === null || customerDate(value.dueOn))
    && Array.isArray(value.outcomes) && value.outcomes.length <= 180 && value.outcomes.every(customerUuid)
    && new Set(value.outcomes).size === value.outcomes.length
    && (value.cancelReason === null || reference.expectedRevision !== '0' && financeAccountReviewReason(value.cancelReason)
      && value.dueOn === null && value.outcomes.length === 0));
  return Object.freeze({ dueOn: value.dueOn, outcomes: Object.freeze(value.outcomes.slice()), cancelReason: value.cancelReason }) as InvoiceDraftInput;
}

export function parseInvoiceDraftSummary(value: unknown) {
  check(exact(value, summaryFields) && value.schemaVersion === 1 && customerUuid(value.draftId)
    && customerUuid(value.jobId) && customerUuid(value.customerId) && customerVersion(value.revision)
    && (value.dueOn === null || customerDate(value.dueOn))
    && (value.state === 'draft' && value.reason === null
      || value.state === 'cancelled' && financeAccountReviewReason(value.reason))
    && customerUuid(value.auditEventId) && typeof value.lineCount === 'number'
    && Number.isInteger(value.lineCount) && value.lineCount >= 0 && value.lineCount <= 180
    && typeof value.linesSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.linesSha256));
  const { draftId, jobId, customerId, revision, dueOn, state, reason, auditEventId, lineCount, linesSha256 } = value;
  return Object.freeze({ schemaVersion: 1 as const, draftId, jobId, customerId, revision, dueOn, state, reason,
    auditEventId, lineCount, linesSha256 });
}

export function parseInvoiceDraftPage(value: unknown, businessId: string, jobId: string, after: string | null) {
  check(exact(value, ['schemaVersion', 'businessId', 'jobId', 'hasMore', 'rows']) && value.schemaVersion === 1
    && value.businessId === businessId && value.jobId === jobId && typeof value.hasMore === 'boolean'
    && Array.isArray(value.rows) && value.rows.length <= 25 && (!value.hasMore || value.rows.length === 25));
  let previous = after;
  const rows = value.rows.map((row: unknown) => {
    const parsed = parseInvoiceDraftSummary(row);
    check(parsed.jobId === jobId && (previous === null || parsed.draftId > previous));
    previous = parsed.draftId;
    return parsed;
  });
  return Object.freeze({ hasMore: value.hasMore, rows: Object.freeze(rows) });
}

export function parseInvoiceDraftRead(value: unknown, draftId: string, revision: string | null) {
  if (exact(value, ['state']) && value.state === 'absent') return { state: 'absent' } as const;
  check(exact(value, ['state', 'receipt', 'lines']) && value.state === 'found');
  const receipt = parseInvoiceDraftSummary(value.receipt);
  check(receipt.draftId === draftId && (revision === null || receipt.revision === revision)
    && Array.isArray(value.lines) && value.lines.length === receipt.lineCount);
  return { state: 'found', receipt, lines: parseInvoicePreparationLines(value.lines) } as const;
}

export function parseInvoiceDraftOperation(value: unknown, reference: InvoiceDraftReference) {
  if (exact(value, ['state']) && value.state === 'absent') return { state: 'absent' } as const;
  if (exact(value, ['schemaVersion','state','operationId','recoveryEpoch','receipt']) && value.state === 'retired') {
    const { receipt } = value;
    check(value.schemaVersion === 1 && value.operationId === reference.operationId && value.recoveryEpoch === reference.recoveryEpoch
      && exact(receipt, ['schemaVersion','draftId','jobId','expectedRevision','auditEventId','reviewEpoch'])
      && receipt.schemaVersion === 1 && receipt.draftId === reference.draftId && receipt.jobId === reference.jobId
      && receipt.expectedRevision === reference.expectedRevision && customerUuid(receipt.auditEventId) && customerUuid(receipt.reviewEpoch));
    return { state: 'retired', receipt: Object.freeze(receipt) } as const;
  }
  if (exact(value, ['state', 'reason']) && value.state === 'conflict' && value.reason === 'operation')
    return { state: 'conflict', reason: 'operation' } as const;
  if (exact(value, ['state', 'reason', 'currentRevision']) && value.state === 'conflict' && value.reason === 'revision'
    && customerVersion(value.currentRevision, true))
    return { state: 'conflict', reason: 'revision', currentRevision: value.currentRevision } as const;
  check(exact(value, ['state', 'receipt']) && value.state === 'committed');
  const receipt = parseInvoiceDraftSummary(value.receipt);
  check(receipt.draftId === reference.draftId && receipt.jobId === reference.jobId
    && BigInt(receipt.revision) === BigInt(reference.expectedRevision) + 1n);
  return { state: 'committed', receipt } as const;
}
