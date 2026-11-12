import { customerInstant, customerUuid, exactCustomerObject } from '../customer/customer-contract.ts';
import { isFinanceCents } from './finance-inclusive-charge.ts';

const lineKeys = [
  'outcomeId', 'completionPartId', 'partitionId', 'agreementId', 'entitlementVersionId', 'quoteItemId',
  'vehicleId', 'serviceId', 'serviceVersionId', 'description', 'grossInclusiveCents', 'discountInclusiveCents', 'inclusiveCents',
] as const;
const requiredIds = ['outcomeId', 'completionPartId', 'partitionId', 'agreementId', 'entitlementVersionId', 'quoteItemId'] as const;
const readyKeys = ['schemaVersion', 'state', 'businessId', 'jobId', 'customerId', 'completionOutcome', 'completedAt', 'lines'] as const;
export const invoicePreparationExportColumns = [
  'description', 'grossInclusiveCents', 'discountInclusiveCents', 'inclusiveCents',
  'outcomeId', 'completionPartId', 'partitionId', 'agreementId', 'entitlementVersionId', 'quoteItemId',
  'vehicleId', 'serviceId', 'serviceVersionId',
] as const;
type Line = Readonly<Record<(typeof requiredIds)[number], string> & {
  vehicleId: string | null;
  serviceId: string | null;
  serviceVersionId: string | null;
  description: string;
  grossInclusiveCents: string;
  discountInclusiveCents: string;
  inclusiveCents: string;
}>;

function check(value: unknown): asserts value {
  if (!value) throw new Error('INVOICE_PREPARATION_REVIEW_REQUIRED');
}

export function parseInvoicePreparation(value: unknown, businessId: string, jobId: string) {
  if (exactCustomerObject(value, ['state']) && (value.state === 'absent' || value.state === 'work_not_completed')) {
    return { state: value.state } as const;
  }
  check(exactCustomerObject(value, readyKeys) && value.schemaVersion === 1 && value.state === 'ready'
    && value.businessId === businessId && value.jobId === jobId && customerUuid(value.customerId)
    && customerInstant(value.completedAt) && (value.completionOutcome === 'full' || value.completionOutcome === 'partial')
    && Array.isArray(value.lines) && value.lines.length >= 1 && value.lines.length <= 10000);
  const lines = value.lines.map((line: unknown) => {
    check(exactCustomerObject(line, lineKeys) && requiredIds.every(key => customerUuid(line[key]))
      && (line.vehicleId === null || customerUuid(line.vehicleId))
      && (line.serviceId === null && line.serviceVersionId === null
        || customerUuid(line.serviceId) && customerUuid(line.serviceVersionId))
      && typeof line.description === 'string' && line.description.trim().length > 0 && [...line.description].length <= 2000
      && isFinanceCents(line.grossInclusiveCents) && isFinanceCents(line.discountInclusiveCents) && isFinanceCents(line.inclusiveCents)
      && BigInt(line.grossInclusiveCents) === BigInt(line.discountInclusiveCents) + BigInt(line.inclusiveCents));
    return Object.freeze(line) as Line;
  });
  for (const key of ['outcomeId', 'completionPartId', 'partitionId'] as const) {
    check(new Set(lines.map(line => line[key])).size === lines.length);
  }
  return {
    state: 'ready', customerId: value.customerId, completedAt: value.completedAt,
    completionOutcome: value.completionOutcome, lines: Object.freeze(lines),
  } as const;
}
