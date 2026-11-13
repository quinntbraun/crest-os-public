import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';
import {invoiceCreditMatchesInput,parseInvoiceCreditInput,parseInvoiceCreditOptions,parseInvoiceCreditResult} from './invoice-credit-contract.ts';
import {allocationUnapplicationMatchesInput,parseAllocationUnapplicationInput,parseAllocationUnapplicationOptions,parseAllocationUnapplicationResult}
  from './allocation-unapplication-contract.ts';

export function parsePairedInvoiceCreditReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','invoiceCreditId','unapplicationId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.invoiceCreditId)&&customerUuid(value.unapplicationId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,invoiceCreditId:value.invoiceCreditId,unapplicationId:value.unapplicationId};
}

export function parsePairedInvoiceCreditInput(value:unknown){
  check(exact(value,['credit','release','reviewedArCents'])&&isFinanceCents(value.reviewedArCents));
  const credit=parseInvoiceCreditInput(value.credit),release=parseAllocationUnapplicationInput(value.release);
  const creditCents=BigInt(credit.lastCent)-BigInt(credit.firstCent)+1n;
  const releaseCents=BigInt(release.lastCent)-BigInt(release.firstCent)+1n;
  check(credit.reference.operationId===release.reference.operationId&&credit.reference.recoveryEpoch===release.reference.recoveryEpoch
    &&credit.customerId===release.customerId&&credit.effectiveOn===release.effectiveOn&&credit.reason===release.reason
    &&releaseCents===creditCents-BigInt(value.reviewedArCents));
  return {credit,release,reviewedArCents:value.reviewedArCents};
}

export function parsePairedInvoiceCreditOptions(value:unknown,businessId:string,customerId:string,invoiceId:string,allocationId:string,
  requestedOn:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','invoiceId','allocationId','credit','release',
    'reviewedArCents','returnsMappingId','chronologySupported'])&&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId
    &&value.customerId===customerId&&value.invoiceId===invoiceId&&value.allocationId===allocationId
    &&isFinanceCents(value.reviewedArCents)&&(value.returnsMappingId===null||customerUuid(value.returnsMappingId))
    &&typeof value.chronologySupported==='boolean');
  const credit=parseInvoiceCreditOptions(value.credit,businessId,customerId,invoiceId,requestedOn);
  check(credit.state==='review'&&credit.receivableId!==null);
  const release=parseAllocationUnapplicationOptions(value.release,businessId,customerId,allocationId,credit.effectiveOn);
  check(release.state==='review'&&credit.receivableId===release.receivableId&&credit.openPeriod===release.openPeriod
    &&BigInt(credit.availableBalanceCents)<=BigInt(value.reviewedArCents)
    &&value.chronologySupported===(value.reviewedArCents===credit.availableBalanceCents));
  return {state:'review' as const,credit,release,reviewedArCents:value.reviewedArCents,returnsMappingId:value.returnsMappingId,
    chronologySupported:value.chronologySupported};
}

export function parsePairedInvoiceCreditResolution(value:unknown,businessId:string,reference:ReturnType<typeof parsePairedInvoiceCreditReference>){
  check(customerUuid(businessId));
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
    return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','invoiceCreditId','unapplicationId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.invoiceCreditId===reference.invoiceCreditId&&receipt.unapplicationId===reference.unapplicationId
      &&receipt.originalEpoch===reference.recoveryEpoch&&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{invoiceCreditId:reference.invoiceCreditId,unapplicationId:reference.unapplicationId,
      reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['schemaVersion','credit','release'])
    &&value.receipt.schemaVersion===1);
  const {operationId,recoveryEpoch,invoiceCreditId,unapplicationId}=reference;
  const credit=parseInvoiceCreditResult({state:'committed',receipt:value.receipt.credit},businessId,{operationId,recoveryEpoch,invoiceCreditId});
  const release=parseAllocationUnapplicationResult({state:'committed',receipt:value.receipt.release},businessId,{operationId,recoveryEpoch,unapplicationId});
  check(credit.state==='committed'&&release.state==='committed'&&credit.receipt.receivableId===release.receipt.receivableId
    &&credit.receipt.customerId===release.receipt.customerId&&credit.receipt.effectiveOn===release.receipt.effectiveOn
    &&credit.receipt.arAccountId===release.receipt.arAccountId&&credit.receipt.eventId!==release.receipt.eventId&&credit.receipt.reason===release.receipt.reason
    &&BigInt(credit.receipt.inclusiveCents)>=BigInt(release.receipt.cents));
  return {state:'committed' as const,receipt:{credit:credit.receipt,release:release.receipt}};
}

export function parsePairedInvoiceCreditResult(value:unknown,businessId:string,input:ReturnType<typeof parsePairedInvoiceCreditInput>){
  const resolution=parsePairedInvoiceCreditResolution(value,businessId,{
    ...input.credit.reference,unapplicationId:input.release.reference.unapplicationId,
  });
  if(resolution.state!=='committed')return resolution;
  const {credit,release}=resolution.receipt;
  check(invoiceCreditMatchesInput({state:'committed',receipt:credit},input.credit)
    &&allocationUnapplicationMatchesInput({state:'committed',receipt:release},input.release)
    &&BigInt(credit.inclusiveCents)===BigInt(input.reviewedArCents)+BigInt(release.cents));
  return resolution;
}

const pairedRefusals={
  PAIRED_INVOICE_CREDIT_BALANCE_CHANGED:'balance_changed',
  PAIRED_INVOICE_CREDIT_EXACT_RELEASE_REQUIRED:'exact_release_required',
  PAIRED_INVOICE_CREDIT_CHRONOLOGY_REQUIRED:'chronology_review_required',
  PAIRED_INVOICE_CREDIT_ALLOCATION_REQUIRED:'allocation_unavailable',
  PAIRED_INVOICE_CREDIT_RELEASE_UNAVAILABLE:'release_range_changed',
  PAIRED_INVOICE_CREDIT_RELEASE_ALREADY_RECORDED:'release_id_conflict',
  UNAPPLICATION_FUNDS_MAPPING_REQUIRED:'funds_mapping_review_required',
} as const;

export function pairedInvoiceCreditRefusal(value:unknown){
  return typeof value==='string'&&Object.hasOwn(pairedRefusals,value)?pairedRefusals[value as keyof typeof pairedRefusals]:null;
}
