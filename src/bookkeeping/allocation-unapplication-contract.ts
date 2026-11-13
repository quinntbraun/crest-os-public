import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const date=(value:unknown):value is string=>customerDate(value)&&value>='1900-01-01';
const invoiceNumber=(value:unknown):value is string=>typeof value==='string'
  &&/^[A-Za-z0-9][A-Za-z0-9-]{0,79}-[1-9][0-9]{0,18}$/.test(value);

function parseRange(value:unknown){
  check(exact(value,['firstCent','lastCent'])&&positive(value.firstCent)&&positive(value.lastCent)
    &&BigInt(value.firstCent)<=BigInt(value.lastCent));
  return {firstCent:value.firstCent,lastCent:value.lastCent};
}

export function parseAllocationUnapplicationReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','unapplicationId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.unapplicationId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,unapplicationId:value.unapplicationId};
}

export function parseAllocationUnapplicationInput(value:unknown){
  check(exact(value,['reference','allocationId','customerId','fundsMappingId','effectiveOn','firstCent','lastCent','reason'])
    &&customerUuid(value.allocationId)&&customerUuid(value.customerId)&&customerUuid(value.fundsMappingId)
    &&date(value.effectiveOn)&&financeAccountReviewReason(value.reason));
  return {reference:parseAllocationUnapplicationReference(value.reference),allocationId:value.allocationId,
    customerId:value.customerId,fundsMappingId:value.fundsMappingId,effectiveOn:value.effectiveOn,
    ...parseRange({firstCent:value.firstCent,lastCent:value.lastCent}),reason:value.reason};
}

export function parseInvoicePaymentAllocations(value:unknown,businessId:string,customerId:string,invoiceId:string){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','invoiceId','allocations'])
    &&value.state==='ready'&&value.schemaVersion===1&&value.businessId===businessId
    &&value.customerId===customerId&&value.invoiceId===invoiceId&&Array.isArray(value.allocations)&&value.allocations.length<=180);
  const allocations=value.allocations.map((row:unknown)=>{
    check(exact(row,['allocationId','paymentId','paidOn','appliedCents','availableCents'])&&customerUuid(row.allocationId)
      &&customerUuid(row.paymentId)&&date(row.paidOn)&&positive(row.appliedCents)&&isFinanceCents(row.availableCents)
      &&BigInt(row.availableCents)<=BigInt(row.appliedCents));
    return {allocationId:row.allocationId,paymentId:row.paymentId,paidOn:row.paidOn,
      appliedCents:row.appliedCents,availableCents:row.availableCents};
  });
  check(new Set(allocations.map(row=>row.allocationId)).size===allocations.length);
  return {state:'ready' as const,allocations};
}

export function parseAllocationUnapplicationOptions(value:unknown,businessId:string,customerId:string,allocationId:string,requestedOn:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','allocationId','paymentId','receivableId',
    'invoiceNumber','paidOn','effectiveOn','fundsMappingId','openPeriod','availableRanges'])
    &&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&value.allocationId===allocationId&&customerUuid(value.paymentId)&&customerUuid(value.receivableId)&&invoiceNumber(value.invoiceNumber)
    &&date(value.paidOn)&&date(value.effectiveOn)&&value.effectiveOn>=value.paidOn
    &&(requestedOn===null||requestedOn===value.effectiveOn)&&(value.fundsMappingId===null||customerUuid(value.fundsMappingId))
    &&typeof value.openPeriod==='boolean'&&Array.isArray(value.availableRanges)&&value.availableRanges.length<=180);
  const availableRanges=value.availableRanges.map(parseRange);
  check(availableRanges.every((range,index)=>index===0||BigInt(availableRanges[index-1]!.lastCent)+1n<BigInt(range.firstCent)));
  return {state:'review' as const,paymentId:value.paymentId,receivableId:value.receivableId,invoiceNumber:value.invoiceNumber,
    paidOn:value.paidOn,effectiveOn:value.effectiveOn,fundsMappingId:value.fundsMappingId,
    openPeriod:value.openPeriod,availableRanges};
}

export function parseAllocationUnapplicationResult(value:unknown,businessId:string,reference:ReturnType<typeof parseAllocationUnapplicationReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','unapplicationId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.unapplicationId===reference.unapplicationId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{unapplicationId:reference.unapplicationId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check(exact(receipt,['schemaVersion','businessId','operationId','unapplicationId','allocationId','eventId','fundLotId',
    'fundingOriginId','parentPartitionId','customerId','receivableId','arAccountId','fundsAccountId','mappingId',
    'effectiveOn','firstCent','lastCent','cents','reason'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
    &&receipt.unapplicationId===reference.unapplicationId&&customerUuid(receipt.allocationId)&&customerUuid(receipt.eventId)
    &&customerUuid(receipt.fundLotId)&&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.parentPartitionId)
    &&customerUuid(receipt.customerId)&&customerUuid(receipt.receivableId)&&customerUuid(receipt.arAccountId)
    &&customerUuid(receipt.fundsAccountId)&&receipt.arAccountId!==receipt.fundsAccountId&&customerUuid(receipt.mappingId)
    &&date(receipt.effectiveOn)&&positive(receipt.cents)&&financeAccountReviewReason(receipt.reason));
  const range=parseRange({firstCent:receipt.firstCent,lastCent:receipt.lastCent});
  check(BigInt(receipt.cents)===BigInt(range.lastCent)-BigInt(range.firstCent)+1n);
  return {state:'committed' as const,receipt:{unapplicationId:reference.unapplicationId,allocationId:receipt.allocationId,
    eventId:receipt.eventId,fundLotId:receipt.fundLotId,fundingOriginId:receipt.fundingOriginId,parentPartitionId:receipt.parentPartitionId,
    customerId:receipt.customerId,receivableId:receipt.receivableId,arAccountId:receipt.arAccountId,fundsAccountId:receipt.fundsAccountId,
    mappingId:receipt.mappingId,effectiveOn:receipt.effectiveOn,...range,cents:receipt.cents,reason:receipt.reason}};
}

export function allocationUnapplicationMatchesInput(result:Extract<ReturnType<typeof parseAllocationUnapplicationResult>,{state:'committed'}>,
  input:ReturnType<typeof parseAllocationUnapplicationInput>){
  const {receipt}=result;
  return receipt.allocationId===input.allocationId&&receipt.customerId===input.customerId&&receipt.mappingId===input.fundsMappingId
    &&receipt.effectiveOn===input.effectiveOn&&receipt.firstCent===input.firstCent&&receipt.lastCent===input.lastCent
    &&receipt.reason===input.reason;
}
