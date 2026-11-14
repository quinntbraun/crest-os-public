import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {calculateInclusiveFinanceCharge,isFinanceCents,isFinanceDecimalRate} from './finance-inclusive-charge.ts';

const validDate=(value:unknown):value is string=>customerDate(value)&&value>='1900-01-01';
const validJurisdiction=(value:unknown):value is string=>financeAccountReviewReason(value)&&[...value].length<=200;
const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const nullableUuid=(value:unknown):value is string|null=>value===null||customerUuid(value);
const limit=180;

function range(value:unknown){
  check(exact(value,['firstCent','lastCent'])&&positive(value.firstCent)&&positive(value.lastCent)
    &&BigInt(value.firstCent)<=BigInt(value.lastCent));
  return {firstCent:value.firstCent,lastCent:value.lastCent};
}

export function parseHeldTipReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','tipRealizationId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.tipRealizationId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,tipRealizationId:value.tipRealizationId};
}

export function parseHeldTipInput(value:unknown){
  check(exact(value,['reference','fundLotId','customerId','effectiveOn','firstCent','lastCent','jurisdiction',
    'taxProfileId','revenueMappingId','taxMappingId','customerIntentEvidence','reason'])
    &&customerUuid(value.fundLotId)&&customerUuid(value.customerId)&&validDate(value.effectiveOn)
    &&validJurisdiction(value.jurisdiction)&&customerUuid(value.taxProfileId)&&customerUuid(value.revenueMappingId)
    &&nullableUuid(value.taxMappingId)&&financeAccountReviewReason(value.customerIntentEvidence)&&financeAccountReviewReason(value.reason));
  return {reference:parseHeldTipReference(value.reference),fundLotId:value.fundLotId,customerId:value.customerId,
    effectiveOn:value.effectiveOn,...range({firstCent:value.firstCent,lastCent:value.lastCent}),jurisdiction:value.jurisdiction,
    taxProfileId:value.taxProfileId,revenueMappingId:value.revenueMappingId,taxMappingId:value.taxMappingId,
    customerIntentEvidence:value.customerIntentEvidence,reason:value.reason};
}

function parseBasis(value:unknown){
  if(value===null)return null;
  check(exact(value,['taxProfileId','treatment','rate','revenueMappingId','revenueAccountId','taxMappingId','taxAccountId'])
    &&customerUuid(value.taxProfileId)&&customerUuid(value.revenueMappingId)&&customerUuid(value.revenueAccountId));
  const fixed={taxProfileId:value.taxProfileId,revenueMappingId:value.revenueMappingId,revenueAccountId:value.revenueAccountId};
  if(value.treatment==='non_taxable'){
    check(value.rate===null&&value.taxMappingId===null&&value.taxAccountId===null);
    return {...fixed,treatment:value.treatment,rate:null,taxMappingId:null,taxAccountId:null};
  }
  check(value.treatment==='inclusive_single'&&isFinanceDecimalRate(value.rate)&&value.rate!=='0'
    &&customerUuid(value.taxMappingId)&&customerUuid(value.taxAccountId)&&value.taxAccountId!==value.revenueAccountId);
  return {...fixed,treatment:value.treatment,rate:value.rate,taxMappingId:value.taxMappingId,taxAccountId:value.taxAccountId};
}

export function parseHeldTipOptions(value:unknown,businessId:string,customerId:string,requestedJurisdiction:string|null,requestedOn:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','jurisdiction','effectiveOn','openPeriod','jurisdictions','lots'])
    &&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&value.jurisdiction===requestedJurisdiction&&(value.jurisdiction===null||validJurisdiction(value.jurisdiction))
    &&validDate(value.effectiveOn)&&(requestedOn===null||requestedOn===value.effectiveOn)&&typeof value.openPeriod==='boolean'
    &&Array.isArray(value.jurisdictions)&&value.jurisdictions.length<=limit&&value.jurisdictions.every(validJurisdiction)
    &&new Set(value.jurisdictions).size===value.jurisdictions.length&&Array.isArray(value.lots)&&value.lots.length<=limit);
  const {effectiveOn,jurisdictions}=value;
  const lots=value.lots.map((lot:unknown)=>{
    check(exact(lot,['fundLotId','heldOn','availableRanges','basis'])&&customerUuid(lot.fundLotId)
      &&validDate(lot.heldOn)&&lot.heldOn<=effectiveOn&&Array.isArray(lot.availableRanges)
      &&lot.availableRanges.length>=1&&lot.availableRanges.length<=limit);
    const availableRanges=lot.availableRanges.map(range), basis=parseBasis(lot.basis);
    check(availableRanges.every((item,index)=>index===0||BigInt(availableRanges[index-1]!.lastCent)+1n<BigInt(item.firstCent))
      &&(!basis||requestedJurisdiction!==null&&jurisdictions.includes(requestedJurisdiction)));
    return {fundLotId:lot.fundLotId,heldOn:lot.heldOn,availableRanges,basis};
  });
  check(new Set(lots.map(lot=>lot.fundLotId)).size===lots.length);
  return {state:'review' as const,jurisdiction:requestedJurisdiction,effectiveOn,openPeriod:value.openPeriod,jurisdictions,lots};
}

export function parseHeldTipResult(value:unknown,businessId:string,reference:ReturnType<typeof parseHeldTipReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','tipRealizationId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.tipRealizationId===reference.tipRealizationId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{tipRealizationId:reference.tipRealizationId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check(exact(receipt,['schemaVersion','businessId','tipRealizationId','operationId','eventId','fundLotId','unapplicationId',
    'fundingOriginId','parentPartitionId','customerId','fundsAccountId','fundsMappingId','revenueAccountId','revenueMappingId',
    'taxAccountId','taxMappingId','taxProfileId','jurisdiction','effectiveOn','firstCent','lastCent','inclusiveCents','netCents',
    'taxCents','customerIntentEvidence','reason'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
    &&receipt.tipRealizationId===reference.tipRealizationId&&customerUuid(receipt.eventId)&&customerUuid(receipt.fundLotId)
    &&customerUuid(receipt.unapplicationId)&&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.parentPartitionId)
    &&customerUuid(receipt.customerId)&&customerUuid(receipt.fundsAccountId)&&customerUuid(receipt.fundsMappingId)
    &&customerUuid(receipt.revenueAccountId)&&customerUuid(receipt.revenueMappingId)&&receipt.fundsAccountId!==receipt.revenueAccountId
    &&nullableUuid(receipt.taxAccountId)&&nullableUuid(receipt.taxMappingId)&&customerUuid(receipt.taxProfileId)
    &&validJurisdiction(receipt.jurisdiction)&&validDate(receipt.effectiveOn)&&positive(receipt.inclusiveCents)
    &&isFinanceCents(receipt.netCents)&&isFinanceCents(receipt.taxCents)&&financeAccountReviewReason(receipt.customerIntentEvidence)
    &&financeAccountReviewReason(receipt.reason));
  const consumed=range({firstCent:receipt.firstCent,lastCent:receipt.lastCent});
  check(BigInt(receipt.inclusiveCents)===BigInt(consumed.lastCent)-BigInt(consumed.firstCent)+1n
    &&BigInt(receipt.inclusiveCents)===BigInt(receipt.netCents)+BigInt(receipt.taxCents)
    &&(receipt.taxMappingId===null)===(receipt.taxAccountId===null)
    &&(receipt.taxMappingId!==null||receipt.taxCents==='0')
    &&receipt.taxAccountId!==receipt.fundsAccountId&&receipt.taxAccountId!==receipt.revenueAccountId);
  return {state:'committed' as const,receipt:{tipRealizationId:reference.tipRealizationId,eventId:receipt.eventId,fundLotId:receipt.fundLotId,
    unapplicationId:receipt.unapplicationId,fundingOriginId:receipt.fundingOriginId,parentPartitionId:receipt.parentPartitionId,
    customerId:receipt.customerId,fundsAccountId:receipt.fundsAccountId,fundsMappingId:receipt.fundsMappingId,
    revenueAccountId:receipt.revenueAccountId,revenueMappingId:receipt.revenueMappingId,taxAccountId:receipt.taxAccountId,
    taxMappingId:receipt.taxMappingId,taxProfileId:receipt.taxProfileId,jurisdiction:receipt.jurisdiction,effectiveOn:receipt.effectiveOn,
    ...consumed,inclusiveCents:receipt.inclusiveCents,netCents:receipt.netCents,taxCents:receipt.taxCents,
    customerIntentEvidence:receipt.customerIntentEvidence,reason:receipt.reason}};
}

export function heldTipMatchesInput(result:Extract<ReturnType<typeof parseHeldTipResult>,{state:'committed'}>,
  input:ReturnType<typeof parseHeldTipInput>){
  const {receipt}=result;
  return receipt.fundLotId===input.fundLotId&&receipt.customerId===input.customerId&&receipt.effectiveOn===input.effectiveOn
    &&receipt.firstCent===input.firstCent&&receipt.lastCent===input.lastCent&&receipt.jurisdiction===input.jurisdiction
    &&receipt.taxProfileId===input.taxProfileId&&receipt.revenueMappingId===input.revenueMappingId&&receipt.taxMappingId===input.taxMappingId
    &&receipt.customerIntentEvidence===input.customerIntentEvidence&&receipt.reason===input.reason;
}

export function calculateHeldTipReview(firstCent:string,lastCent:string,rate:string|null){
  const selected=range({firstCent,lastCent});
  return calculateInclusiveFinanceCharge(String(BigInt(selected.lastCent)-BigInt(selected.firstCent)+1n),'0',rate??'0');
}
