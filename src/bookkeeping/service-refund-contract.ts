import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const refundDate=(value:unknown):value is string=>customerDate(value)&&value>='1900-01-01';

function parseRange(value:unknown){
  check(exact(value,['firstCent','lastCent'])&&positive(value.firstCent)&&positive(value.lastCent)
    &&BigInt(value.firstCent)<=BigInt(value.lastCent));
  return {firstCent:value.firstCent,lastCent:value.lastCent};
}

export function parseServiceRefundReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','serviceRefundId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.serviceRefundId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,serviceRefundId:value.serviceRefundId};
}

export function parseServiceRefundInput(value:unknown){
  check(exact(value,['reference','pairedCreditId','fundLotId','customerId','channelId','channelVersion',
    'actualOn','firstCent','lastCent','confirmation','reason','externalIdentity'])
    &&customerUuid(value.pairedCreditId)&&customerUuid(value.fundLotId)&&customerUuid(value.customerId)
    &&customerUuid(value.channelId)&&customerVersion(value.channelVersion)&&refundDate(value.actualOn)
    &&financeAccountReviewReason(value.confirmation)&&financeAccountReviewReason(value.reason));
  const external=value.externalIdentity;
  check(exact(external,['namespace','id','rawReference'])&&typeof external.namespace==='string'
    &&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(external.namespace)&&financeAccountReviewReason(external.id)
    &&[...external.id].length<=200&&financeAccountReviewReason(external.rawReference));
  return {
    reference:parseServiceRefundReference(value.reference),pairedCreditId:value.pairedCreditId,fundLotId:value.fundLotId,
    customerId:value.customerId,channelId:value.channelId,channelVersion:value.channelVersion,actualOn:value.actualOn,
    ...parseRange({firstCent:value.firstCent,lastCent:value.lastCent}),confirmation:value.confirmation,reason:value.reason,
    externalIdentity:{namespace:external.namespace,id:external.id,rawReference:external.rawReference},
  };
}

export function parseServiceRefundOptions(value:unknown,businessId:string,customerId:string,pairedCreditId:string,actualOn:string){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','pairedCreditId','fundLotId','actualOn',
    'openPeriod','availableRanges','channels'])&&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId
    &&value.customerId===customerId&&value.pairedCreditId===pairedCreditId&&customerUuid(value.fundLotId)
    &&refundDate(value.actualOn)&&value.actualOn===actualOn&&typeof value.openPeriod==='boolean'
    &&Array.isArray(value.availableRanges)&&value.availableRanges.length<=180
    &&Array.isArray(value.channels)&&value.channels.length<=180);
  const availableRanges=value.availableRanges.map(parseRange);
  check(availableRanges.every((range,index)=>index===0||BigInt(availableRanges[index-1]!.lastCent)+1n<BigInt(range.firstCent)));
  const channels=value.channels.map((channel:unknown)=>{
    check(exact(channel,['channelId','version','label','kind'])&&customerUuid(channel.channelId)
      &&customerVersion(channel.version)&&financeAccountReviewReason(channel.label)
      &&(channel.kind==='bank'||channel.kind==='wallet'));
    return {channelId:channel.channelId,version:channel.version,label:channel.label,kind:channel.kind};
  });
  check(new Set(channels.map(channel=>channel.channelId)).size===channels.length);
  return {state:'review' as const,fundLotId:value.fundLotId,actualOn:value.actualOn,openPeriod:value.openPeriod,availableRanges,channels};
}

export function parseServiceRefundCredits(value:unknown,businessId:string,customerId:string,invoiceId:string){
  check(exact(value,['schemaVersion','businessId','customerId','invoiceId','credits'])&&value.schemaVersion===1
    &&value.businessId===businessId&&value.customerId===customerId&&value.invoiceId===invoiceId
    &&Array.isArray(value.credits)&&value.credits.length<=180);
  const credits=value.credits.map((credit:unknown)=>{
    check(exact(credit,['pairedCreditId','creditedOn','releasedCents','availableCents'])
      &&customerUuid(credit.pairedCreditId)&&refundDate(credit.creditedOn)&&positive(credit.releasedCents)
      &&isFinanceCents(credit.availableCents)&&BigInt(credit.availableCents)<=BigInt(credit.releasedCents));
    return {pairedCreditId:credit.pairedCreditId,creditedOn:credit.creditedOn,
      releasedCents:credit.releasedCents,availableCents:credit.availableCents};
  });
  check(new Set(credits.map(credit=>credit.pairedCreditId)).size===credits.length);
  return credits;
}

export function parseServiceRefundResult(value:unknown,businessId:string,reference:ReturnType<typeof parseServiceRefundReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
    return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','serviceRefundId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.serviceRefundId===reference.serviceRefundId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{serviceRefundId:reference.serviceRefundId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check(exact(receipt,['schemaVersion','businessId','serviceRefundId','operationId','eventId','pairedCreditId',
    'unapplicationId','fundLotId','fundingOriginId','parentPartitionId','customerId','fundsAccountId','fundsMappingId',
    'moneyAccountId','moneyMovementId','moneyChannelId','moneyChannelVersion','evidenceId','actualOn','firstCent',
    'lastCent','cents','confirmation','reason'])&&receipt.schemaVersion===1&&receipt.businessId===businessId
    &&receipt.serviceRefundId===reference.serviceRefundId&&receipt.operationId===reference.operationId
    &&customerUuid(receipt.eventId)&&customerUuid(receipt.pairedCreditId)&&customerUuid(receipt.unapplicationId)
    &&customerUuid(receipt.fundLotId)&&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.parentPartitionId)
    &&customerUuid(receipt.customerId)&&customerUuid(receipt.fundsAccountId)&&customerUuid(receipt.fundsMappingId)
    &&customerUuid(receipt.moneyAccountId)&&receipt.moneyAccountId!==receipt.fundsAccountId
    &&customerUuid(receipt.moneyMovementId)&&customerUuid(receipt.moneyChannelId)&&customerVersion(receipt.moneyChannelVersion)
    &&customerUuid(receipt.evidenceId)&&refundDate(receipt.actualOn)&&positive(receipt.cents)
    &&financeAccountReviewReason(receipt.confirmation)&&financeAccountReviewReason(receipt.reason));
  const range=parseRange({firstCent:receipt.firstCent,lastCent:receipt.lastCent});
  check(BigInt(receipt.cents)===BigInt(range.lastCent)-BigInt(range.firstCent)+1n);
  return {state:'committed' as const,receipt:{
    serviceRefundId:reference.serviceRefundId,eventId:receipt.eventId,pairedCreditId:receipt.pairedCreditId,
    unapplicationId:receipt.unapplicationId,fundLotId:receipt.fundLotId,fundingOriginId:receipt.fundingOriginId,
    parentPartitionId:receipt.parentPartitionId,customerId:receipt.customerId,fundsAccountId:receipt.fundsAccountId,
    fundsMappingId:receipt.fundsMappingId,moneyAccountId:receipt.moneyAccountId,moneyMovementId:receipt.moneyMovementId,
    moneyChannelId:receipt.moneyChannelId,moneyChannelVersion:receipt.moneyChannelVersion,evidenceId:receipt.evidenceId,
    actualOn:receipt.actualOn,...range,cents:receipt.cents,confirmation:receipt.confirmation,reason:receipt.reason,
  }};
}

export function serviceRefundMatchesInput(receipt:Extract<ReturnType<typeof parseServiceRefundResult>,{state:'committed'}>['receipt'],
    input:ReturnType<typeof parseServiceRefundInput>){
  return receipt.pairedCreditId===input.pairedCreditId&&receipt.fundLotId===input.fundLotId
    &&receipt.customerId===input.customerId&&receipt.moneyChannelId===input.channelId&&receipt.moneyChannelVersion===input.channelVersion
    &&receipt.actualOn===input.actualOn&&receipt.firstCent===input.firstCent&&receipt.lastCent===input.lastCent
    &&receipt.confirmation===input.confirmation&&receipt.reason===input.reason;
}

const refusals={
  SERVICE_REFUND_DATE_REQUIRED:'invalid_date',
  SERVICE_REFUND_PAIRED_CREDIT_REQUIRED:'source_unavailable',
  SERVICE_REFUND_LOT_REQUIRED:'source_unavailable',
  SERVICE_REFUND_RANGE_UNAVAILABLE:'range_changed',
  SERVICE_REFUND_ALREADY_RECORDED:'refund_id_conflict',
  SERVICE_REFUND_VERIFIED_CHANNEL_REQUIRED:'channel_review_required',
  SERVICE_REFUND_EXTERNAL_ID_ALREADY_RECORDED:'external_refund_already_recorded',
} as const;

export function serviceRefundRefusal(value:unknown){
  return typeof value==='string'&&Object.hasOwn(refusals,value)?refusals[value as keyof typeof refusals]:null;
}
