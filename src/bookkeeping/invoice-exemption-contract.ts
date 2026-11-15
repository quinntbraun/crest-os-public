import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';
import { invoiceTaxJurisdiction } from './invoice-tax-payable-contract.ts';

export function parseInvoiceExemptionTarget(value: unknown) {
  check(exact(value,['draftId','draftRevision','outcomeId','jurisdiction','profileId'])
    && customerUuid(value.draftId) && customerVersion(value.draftRevision) && customerUuid(value.outcomeId)
    && invoiceTaxJurisdiction(value.jurisdiction) && customerUuid(value.profileId));
  return {draftId:value.draftId,draftRevision:value.draftRevision,outcomeId:value.outcomeId,
    jurisdiction:value.jurisdiction,profileId:value.profileId};
}
type Target = ReturnType<typeof parseInvoiceExemptionTarget>;

export function parseInvoiceExemptionApproval(value: unknown) {
  check(exact(value,['target','operationId','recoveryEpoch','expectedVersion','validFrom','validThrough','evidenceReference','reason'])
    && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch) && customerVersion(value.expectedVersion,true)
    && customerDate(value.validFrom) && customerDate(value.validThrough) && value.validThrough>=value.validFrom
    && financeAccountReviewReason(value.evidenceReference) && financeAccountReviewReason(value.reason));
  return {target:parseInvoiceExemptionTarget(value.target),operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
    expectedVersion:value.expectedVersion,validFrom:value.validFrom,validThrough:value.validThrough,
    evidenceReference:value.evidenceReference,reason:value.reason};
}

const targetFields=['draftId','draftRevision','outcomeId','jurisdiction','profileId'] as const;
const receiptFields=['schemaVersion','id','businessId',...targetFields,'customerId','version','validFrom','validThrough',
  'evidenceReference','reason','auditEventId'];
function parseEvidence(value: unknown, businessId: string, target:Target, operation = false) {
  check(exact(value,operation?[...receiptFields,'operationId']:receiptFields) && value.schemaVersion===1
    && value.businessId===businessId && targetFields.every(key=>value[key]===target[key])
    && customerUuid(value.id) && customerUuid(value.customerId) && customerVersion(value.version)
    && customerDate(value.validFrom) && customerDate(value.validThrough) && value.validThrough>=value.validFrom
    && financeAccountReviewReason(value.evidenceReference) && financeAccountReviewReason(value.reason)
    && customerUuid(value.auditEventId) && (!operation||customerUuid(value.operationId)));
  return {id:value.id,version:value.version,validFrom:value.validFrom,validThrough:value.validThrough,
    evidenceReference:value.evidenceReference,reason:value.reason,operationId:value.operationId};
}

export function parseInvoiceExemptionEditor(value: unknown, businessId:string, target:Target) {
  check(exact(value,['schemaVersion','businessId',...targetFields,'latest']) && value.schemaVersion===1
    && value.businessId===businessId && targetFields.every(key=>value[key]===target[key]));
  return value.latest===null?null:parseEvidence(value.latest,businessId,target,true);
}

export function parseInvoiceExemptionResult(value:unknown,businessId:string,approval:ReturnType<typeof parseInvoiceExemptionApproval>) {
  if (exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const receipt=parseEvidence(value.receipt,businessId,approval.target);
  check(receipt.version===String(BigInt(approval.expectedVersion)+1n) && receipt.validFrom===approval.validFrom
    && receipt.validThrough===approval.validThrough && receipt.evidenceReference===approval.evidenceReference && receipt.reason===approval.reason);
  return {state:'committed',receipt} as const;
}
