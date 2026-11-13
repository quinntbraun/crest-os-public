import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const validDate=(value:unknown):value is string=>customerDate(value)&&value>='1900-01-01';
const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
function range(value:unknown){
  check(exact(value,['firstCent','lastCent'])&&positive(value.firstCent)&&positive(value.lastCent)
    &&BigInt(value.firstCent)<=BigInt(value.lastCent));
  return {firstCent:value.firstCent,lastCent:value.lastCent};
}

export function parseFundApplicationReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','fundApplicationId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.fundApplicationId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,fundApplicationId:value.fundApplicationId};
}

export function parseFundApplicationInput(value:unknown){
  check(exact(value,['reference','fundLotId','receivableId','customerId','effectiveOn','firstCent','lastCent','reason'])
    &&customerUuid(value.fundLotId)&&customerUuid(value.receivableId)&&customerUuid(value.customerId)
    &&validDate(value.effectiveOn)&&financeAccountReviewReason(value.reason));
  return {reference:parseFundApplicationReference(value.reference),fundLotId:value.fundLotId,
    receivableId:value.receivableId,customerId:value.customerId,effectiveOn:value.effectiveOn,
    ...range({firstCent:value.firstCent,lastCent:value.lastCent}),reason:value.reason};
}

export function parseFundApplicationOptions(value:unknown,businessId:string,customerId:string,invoiceId:string,requestedOn:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','invoiceId','receivableId','effectiveOn',
    'availableBalanceCents','openPeriod','lots'])
    &&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&value.invoiceId===invoiceId&&customerUuid(value.receivableId)&&validDate(value.effectiveOn)
    &&(requestedOn===null||requestedOn===value.effectiveOn)&&isFinanceCents(value.availableBalanceCents)
    &&typeof value.openPeriod==='boolean'&&Array.isArray(value.lots)&&value.lots.length<=180);
  const effectiveOn=value.effectiveOn;
  const lots=value.lots.map((lot:unknown)=>{
    check(exact(lot,['fundLotId','heldOn','availableRanges'])&&customerUuid(lot.fundLotId)&&validDate(lot.heldOn)
      &&lot.heldOn<=effectiveOn&&Array.isArray(lot.availableRanges)&&lot.availableRanges.length>=1&&lot.availableRanges.length<=180);
    const availableRanges=lot.availableRanges.map(range);
    check(availableRanges.every((item,index)=>index===0||BigInt(availableRanges[index-1]!.lastCent)+1n<BigInt(item.firstCent)));
    return {fundLotId:lot.fundLotId,heldOn:lot.heldOn,availableRanges};
  });
  check(new Set(lots.map(lot=>lot.fundLotId)).size===lots.length);
  return {state:'review' as const,receivableId:value.receivableId,effectiveOn,availableBalanceCents:value.availableBalanceCents,
    openPeriod:value.openPeriod,lots};
}

export function parseFundApplicationResult(value:unknown,businessId:string,reference:ReturnType<typeof parseFundApplicationReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','fundApplicationId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.fundApplicationId===reference.fundApplicationId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{fundApplicationId:reference.fundApplicationId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check(exact(receipt,['schemaVersion','businessId','operationId','fundApplicationId','eventId','fundLotId','unapplicationId',
    'fundingOriginId','parentPartitionId','customerId','receivableId','invoiceId','arAccountId','fundsAccountId','mappingId',
    'effectiveOn','firstCent','lastCent','cents','reason'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
    &&receipt.fundApplicationId===reference.fundApplicationId&&customerUuid(receipt.eventId)&&customerUuid(receipt.fundLotId)
    &&customerUuid(receipt.unapplicationId)&&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.parentPartitionId)
    &&customerUuid(receipt.customerId)&&customerUuid(receipt.receivableId)&&customerUuid(receipt.invoiceId)
    &&customerUuid(receipt.arAccountId)&&customerUuid(receipt.fundsAccountId)&&receipt.arAccountId!==receipt.fundsAccountId
    &&customerUuid(receipt.mappingId)&&validDate(receipt.effectiveOn)&&positive(receipt.cents)&&financeAccountReviewReason(receipt.reason));
  const consumed=range({firstCent:receipt.firstCent,lastCent:receipt.lastCent});
  check(BigInt(receipt.cents)===BigInt(consumed.lastCent)-BigInt(consumed.firstCent)+1n);
  return {state:'committed' as const,receipt:{fundApplicationId:reference.fundApplicationId,eventId:receipt.eventId,
    fundLotId:receipt.fundLotId,unapplicationId:receipt.unapplicationId,fundingOriginId:receipt.fundingOriginId,
    parentPartitionId:receipt.parentPartitionId,customerId:receipt.customerId,receivableId:receipt.receivableId,invoiceId:receipt.invoiceId,
    arAccountId:receipt.arAccountId,fundsAccountId:receipt.fundsAccountId,mappingId:receipt.mappingId,effectiveOn:receipt.effectiveOn,
    ...consumed,cents:receipt.cents,reason:receipt.reason}};
}

export function fundApplicationMatchesInput(result:Extract<ReturnType<typeof parseFundApplicationResult>,{state:'committed'}>,
  input:ReturnType<typeof parseFundApplicationInput>){
  const {receipt}=result;
  return receipt.fundLotId===input.fundLotId&&receipt.receivableId===input.receivableId&&receipt.customerId===input.customerId
    &&receipt.effectiveOn===input.effectiveOn&&receipt.firstCent===input.firstCent&&receipt.lastCent===input.lastCent
    &&receipt.reason===input.reason;
}
