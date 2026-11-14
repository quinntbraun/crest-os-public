import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const text=(value:unknown,max:number):value is string=>financeAccountReviewReason(value)&&[...value].length<=max;
const inputFields=['reference','customerId','channelId','channelVersion','actualOn','grossCents',
  'confirmation','distinctReason','externalIdentity','applications'];
const receiptFields=['schemaVersion','businessId','paymentId','eventId','customerId','channelVersionId','accountId',
  'actualOn','grossCents','fundingOriginId','moneyMovementId','externalEvidenceId','applications'];

export function parseDirectReceiptReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','paymentId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.paymentId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,paymentId:value.paymentId};
}

export function parseDirectReceiptInput(value:unknown){
  check((exact(value,inputFields)||exact(value,[...inputFields,'fundsMappingId']))
    &&customerUuid(value.customerId)&&customerUuid(value.channelId)&&customerVersion(value.channelVersion)
    &&customerDate(value.actualOn)&&positive(value.grossCents)&&financeAccountReviewReason(value.confirmation)
    &&(value.distinctReason===null||financeAccountReviewReason(value.distinctReason)));
  const external=value.externalIdentity;
  check(external===null||exact(external,['namespace','id','rawReference'])&&typeof external.namespace==='string'
    &&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(external.namespace)&&text(external.id,200)&&text(external.rawReference,1000));
  const applications=value.applications;
  check(applications!==null&&typeof applications==='object'&&!Array.isArray(applications));
  const entries=Object.entries(applications);
  const hasMapping=Object.hasOwn(value,'fundsMappingId');
  check(entries.length<=(hasMapping?179:180)&&entries.every(([id,cents])=>customerUuid(id)&&positive(cents)));
  const normalized=entries.map(([id,cents])=>[id,String(cents)] as const).sort(([a],[b])=>a.localeCompare(b));
  const remaining=BigInt(value.grossCents)-normalized.reduce((sum,[,cents])=>sum+BigInt(cents),0n);
  const fundsMappingId=value.fundsMappingId;
  check(hasMapping?customerUuid(fundsMappingId)&&remaining>0n:remaining===0n);
  return {
    reference:parseDirectReceiptReference(value.reference),customerId:value.customerId,channelId:value.channelId,
    channelVersion:value.channelVersion,actualOn:value.actualOn,grossCents:value.grossCents,confirmation:value.confirmation,
    distinctReason:value.distinctReason,externalIdentity:external,applications:Object.fromEntries(normalized),
    ...(customerUuid(fundsMappingId)?{fundsMappingId}:{}),
  };
}

export function parseDirectReceiptResult(value:unknown,businessId:string,reference:ReturnType<typeof parseDirectReceiptReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
    return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','paymentId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.paymentId===reference.paymentId&&receipt.originalEpoch===reference.recoveryEpoch&&customerUuid(receipt.reviewEpoch)
      &&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{paymentId:reference.paymentId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check((exact(receipt,receiptFields)&&receipt.schemaVersion===1
    ||exact(receipt,[...receiptFields,'heldFunds'])&&receipt.schemaVersion===2)
    &&receipt.businessId===businessId&&receipt.paymentId===reference.paymentId
    &&customerUuid(receipt.eventId)&&customerUuid(receipt.customerId)&&customerUuid(receipt.channelVersionId)
    &&customerUuid(receipt.accountId)&&customerDate(receipt.actualOn)&&positive(receipt.grossCents)
    &&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.moneyMovementId)
    &&(receipt.externalEvidenceId===null||customerUuid(receipt.externalEvidenceId))
    &&Array.isArray(receipt.applications)&&receipt.applications.length<=(receipt.schemaVersion===2?179:180));
  const applications=receipt.applications.map((item:unknown)=>{
    check(exact(item,['id','receivableId','fundingPartitionId','cents'])&&customerUuid(item.id)
      &&customerUuid(item.receivableId)&&customerUuid(item.fundingPartitionId)&&positive(item.cents));
    return {id:item.id,receivableId:item.receivableId,fundingPartitionId:item.fundingPartitionId,cents:item.cents};
  });
  check(applications.every((item,index)=>index===0||applications[index-1]!.receivableId<item.receivableId)
    &&new Set(applications.map(item=>item.id)).size===applications.length
    &&new Set(applications.map(item=>item.fundingPartitionId)).size===applications.length);
  const remaining=BigInt(receipt.grossCents)-applications.reduce((sum,item)=>sum+BigInt(item.cents),0n);
  const common={
    paymentId:reference.paymentId,eventId:receipt.eventId,customerId:receipt.customerId,channelVersionId:receipt.channelVersionId,
    accountId:receipt.accountId,actualOn:receipt.actualOn,grossCents:receipt.grossCents,fundingOriginId:receipt.fundingOriginId,
    moneyMovementId:receipt.moneyMovementId,externalEvidenceId:receipt.externalEvidenceId,applications,
  };
  if(receipt.schemaVersion===2){
    const heldFunds=receipt.heldFunds;
    check(exact(heldFunds,['lotId','fundingPartitionId','mappingId','cents'])
      &&customerUuid(heldFunds.lotId)&&customerUuid(heldFunds.fundingPartitionId)&&customerUuid(heldFunds.mappingId)
      &&positive(heldFunds.cents)&&BigInt(heldFunds.cents)===remaining
      &&applications.every(item=>item.fundingPartitionId!==heldFunds.fundingPartitionId));
    return {state:'committed' as const,receipt:{...common,schemaVersion:2 as const,heldFunds:{
      lotId:heldFunds.lotId,fundingPartitionId:heldFunds.fundingPartitionId,mappingId:heldFunds.mappingId,cents:heldFunds.cents,
    }}};
  }
  check(remaining===0n);
  return {state:'committed' as const,receipt:common};
}

export function directReceiptMatchesInput(result:Extract<ReturnType<typeof parseDirectReceiptResult>,{state:'committed'}>,
  input:ReturnType<typeof parseDirectReceiptInput>){
  const {receipt}=result;
  return receipt.customerId===input.customerId&&receipt.actualOn===input.actualOn&&receipt.grossCents===input.grossCents
    &&(receipt.externalEvidenceId===null)===(input.externalIdentity===null)
    &&('heldFunds' in receipt?receipt.heldFunds.mappingId===input.fundsMappingId:input.fundsMappingId===undefined)
    &&receipt.applications.length===Object.keys(input.applications).length
    &&receipt.applications.every(item=>input.applications[item.receivableId]===item.cents);
}

export function parseDirectReceiptOptions(value:unknown,businessId:string,customerId:string,date:string|null,excessReceipts=false){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  const fields=['state','schemaVersion','businessId','customerId','actualOn','channels','receivables'];
  check(exact(value,excessReceipts?[...fields,'fundsMappingId']:fields)
    &&value.state==='ready'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&customerDate(value.actualOn)&&(date===null||date===value.actualOn)
    &&(!excessReceipts||value.fundsMappingId===null||customerUuid(value.fundsMappingId))
    &&Array.isArray(value.channels)&&value.channels.length<=180&&Array.isArray(value.receivables)&&value.receivables.length<=180);
  const actualOn=value.actualOn;
  const channels=value.channels.map((row:unknown)=>{
    check(exact(row,['channelId','channelVersionId','version','accountId','label','kind'])
      &&customerUuid(row.channelId)&&customerUuid(row.channelVersionId)&&customerVersion(row.version)
      &&customerUuid(row.accountId)&&text(row.label,200)&&(row.kind==='bank'||row.kind==='wallet'||row.kind==='cash'||row.kind==='checks'));
    return {channelId:row.channelId,channelVersionId:row.channelVersionId,version:row.version,
      accountId:row.accountId,label:row.label,kind:row.kind};
  });
  const receivables=value.receivables.map((row:unknown)=>{
    check(exact(row,['receivableId','invoiceId','invoiceNumber','issuedOn','dueOn','remainingCents'])
      &&customerUuid(row.receivableId)&&customerUuid(row.invoiceId)
      &&typeof row.invoiceNumber==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,79}-[1-9][0-9]{0,18}$/.test(row.invoiceNumber)
      &&customerDate(row.issuedOn)&&customerDate(row.dueOn)&&row.issuedOn<=actualOn
      &&row.dueOn>=row.issuedOn&&positive(row.remainingCents));
    return {receivableId:row.receivableId,invoiceId:row.invoiceId,invoiceNumber:row.invoiceNumber,
      issuedOn:row.issuedOn,dueOn:row.dueOn,remainingCents:row.remainingCents};
  });
  check(new Set(channels.map(row=>row.channelId)).size===channels.length
    &&new Set(receivables.map(row=>row.receivableId)).size===receivables.length);
  const fundsMappingId=excessReceipts?value.fundsMappingId as string|null:undefined;
  return {state:'ready' as const,actualOn,channels,receivables,...(fundsMappingId!==undefined?{fundsMappingId}:{})};
}

export const directReceiptRefusals=[
  'DIRECT_RECEIPT_INPUT_REQUIRED','DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED','DIRECT_RECEIPT_DATE_REQUIRED',
  'DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED','DIRECT_RECEIPT_ALREADY_RECORDED','DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED',
  'DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED','DIRECT_RECEIPT_RECEIVABLE_REQUIRED','DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE',
  'DIRECT_RECEIPT_OPTIONS_LIMIT','DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED','ACCOUNTING_OPEN_PERIOD_REQUIRED',
] as const;
