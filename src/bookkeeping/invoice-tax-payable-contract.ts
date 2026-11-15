import { customerDate, customerUuid, customerVersion, exactCustomerObject as exact } from '../customer/customer-contract.ts';
import { financeAccountReviewReason, requireFinanceAccount as check } from './finance-account-contract.ts';

export function invoiceTaxJurisdiction(value: unknown): value is string {
  return financeAccountReviewReason(value) && [...value].length <= 200;
}

export function parseInvoiceTaxMappingApproval(value: unknown) {
  check(exact(value, ['operationId','recoveryEpoch','jurisdiction','expectedVersion','accountId','effectiveFrom','reason'])
    && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch) && invoiceTaxJurisdiction(value.jurisdiction)
    && customerVersion(value.expectedVersion, true) && (value.accountId===null || customerUuid(value.accountId))
    && customerDate(value.effectiveFrom) && financeAccountReviewReason(value.reason));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,jurisdiction:value.jurisdiction,
    expectedVersion:value.expectedVersion,accountId:value.accountId,effectiveFrom:value.effectiveFrom,reason:value.reason};
}

export function parseInvoiceTaxMappingReference(value: unknown) {
  check(exact(value,['operationId','recoveryEpoch','jurisdiction','expectedVersion'])
    && customerUuid(value.operationId) && customerUuid(value.recoveryEpoch)
    && invoiceTaxJurisdiction(value.jurisdiction) && customerVersion(value.expectedVersion,true));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,jurisdiction:value.jurisdiction,expectedVersion:value.expectedVersion};
}

const receiptFields = ['schemaVersion','id','businessId','jurisdiction','version','accountId','effectiveFrom','reason','auditEventId'];
function mappingReceipt(value: unknown, businessId: string, jurisdiction: string, includeOperation = false) {
  check(exact(value, includeOperation ? [...receiptFields,'operationId'] : receiptFields)
    && value.schemaVersion===1 && value.businessId===businessId && value.jurisdiction===jurisdiction
    && customerUuid(value.id) && customerVersion(value.version) && (value.accountId===null || customerUuid(value.accountId))
    && customerDate(value.effectiveFrom) && financeAccountReviewReason(value.reason) && customerUuid(value.auditEventId));
  return {id:value.id,businessId,jurisdiction,version:value.version,accountId:value.accountId,
    effectiveFrom:value.effectiveFrom,reason:value.reason,auditEventId:value.auditEventId,operationId:value.operationId};
}

export function parseInvoiceTaxMappingEditor(value: unknown, businessId: string, jurisdiction: string) {
  check(exact(value,['schemaVersion','businessId','jurisdiction','latest','eligibleAccount'])
    && value.schemaVersion===1 && value.businessId===businessId && value.jurisdiction===jurisdiction);
  const latest=value.latest===null ? null : mappingReceipt(value.latest,businessId,jurisdiction,true);
  check(latest===null || customerUuid(latest.operationId));
  const account=value.eligibleAccount;
  check(account===null || exact(account,['id','name','code']) && customerUuid(account.id)
    && account.code==='2100' && typeof account.name==='string' && account.name.length>0);
  return {latest, account:account===null?null:{id:account.id as string,name:account.name as string,code:'2100'}};
}

export function parseInvoiceTaxMappingResult(value: unknown, businessId: string,
  approval: ReturnType<typeof parseInvoiceTaxMappingReference>, expected?: ReturnType<typeof parseInvoiceTaxMappingApproval>) {
  if (exact(value,['state']) && value.state==='absent') return {state:'absent'} as const;
  if (exact(value,['state','reason']) && value.state==='conflict' && value.reason==='operation') return {state:'conflict'} as const;
  check(exact(value,['state','receipt']) && value.state==='committed');
  const receipt=mappingReceipt(value.receipt,businessId,approval.jurisdiction);
  check(receipt.version===String(BigInt(approval.expectedVersion)+1n) && (!expected || receipt.accountId===expected.accountId
    && receipt.effectiveFrom===expected.effectiveFrom && receipt.reason===expected.reason));
  return {state:'committed',receipt} as const;
}
