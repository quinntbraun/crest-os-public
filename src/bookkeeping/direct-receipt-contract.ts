import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const text=(value:unknown,max:number):value is string=>financeAccountReviewReason(value)&&[...value].length<=max;

export function parseDirectReceiptReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','paymentId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.paymentId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,paymentId:value.paymentId};
}

export function parseDirectReceiptInput(value:unknown){
  check(exact(value,['reference','customerId','channelId','channelVersion','actualOn','grossCents',
    'confirmation','distinctReason','externalIdentity','applications'])
    &&customerUuid(value.customerId)&&customerUuid(value.channelId)&&customerVersion(value.channelVersion)
    &&customerDate(value.actualOn)&&positive(value.grossCents)&&financeAccountReviewReason(value.confirmation)
    &&(value.distinctReason===null||financeAccountReviewReason(value.distinctReason)));
  const external=value.externalIdentity;
  check(external===null||exact(external,['namespace','id','rawReference'])&&typeof external.namespace==='string'
    &&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(external.namespace)&&text(external.id,200)&&text(external.rawReference,1000));
  const applications=value.applications;
  check(applications!==null&&typeof applications==='object'&&!Array.isArray(applications));
  const entries=Object.entries(applications);
  check(entries.length>=1&&entries.length<=180&&entries.every(([id,cents])=>customerUuid(id)&&positive(cents)));
  const normalized=entries.map(([id,cents])=>[id,String(cents)] as const).sort(([a],[b])=>a.localeCompare(b));
  check(normalized.reduce((sum,[,cents])=>sum+BigInt(cents),0n)===BigInt(value.grossCents));
  return {
    reference:parseDirectReceiptReference(value.reference),customerId:value.customerId,channelId:value.channelId,
    channelVersion:value.channelVersion,actualOn:value.actualOn,grossCents:value.grossCents,confirmation:value.confirmation,
    distinctReason:value.distinctReason,externalIdentity:external,applications:Object.fromEntries(normalized),
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
  check(exact(receipt,['schemaVersion','businessId','paymentId','eventId','customerId','channelVersionId','accountId',
    'actualOn','grossCents','fundingOriginId','moneyMovementId','externalEvidenceId','applications'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.paymentId===reference.paymentId
    &&customerUuid(receipt.eventId)&&customerUuid(receipt.customerId)&&customerUuid(receipt.channelVersionId)
    &&customerUuid(receipt.accountId)&&customerDate(receipt.actualOn)&&positive(receipt.grossCents)
    &&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.moneyMovementId)
    &&(receipt.externalEvidenceId===null||customerUuid(receipt.externalEvidenceId))
    &&Array.isArray(receipt.applications)&&receipt.applications.length>=1&&receipt.applications.length<=180);
  const applications=receipt.applications.map((item:unknown)=>{
    check(exact(item,['id','receivableId','fundingPartitionId','cents'])&&customerUuid(item.id)
      &&customerUuid(item.receivableId)&&customerUuid(item.fundingPartitionId)&&positive(item.cents));
    return {id:item.id,receivableId:item.receivableId,fundingPartitionId:item.fundingPartitionId,cents:item.cents};
  });
  check(applications.every((item,index)=>index===0||applications[index-1]!.receivableId<item.receivableId)
    &&new Set(applications.map(item=>item.id)).size===applications.length
    &&new Set(applications.map(item=>item.fundingPartitionId)).size===applications.length
    &&applications.reduce((sum,item)=>sum+BigInt(item.cents),0n)===BigInt(receipt.grossCents));
  return {state:'committed' as const,receipt:{
    paymentId:reference.paymentId,eventId:receipt.eventId,customerId:receipt.customerId,channelVersionId:receipt.channelVersionId,
    accountId:receipt.accountId,actualOn:receipt.actualOn,grossCents:receipt.grossCents,fundingOriginId:receipt.fundingOriginId,
    moneyMovementId:receipt.moneyMovementId,externalEvidenceId:receipt.externalEvidenceId,applications,
  }};
}

export function directReceiptMatchesInput(result:Extract<ReturnType<typeof parseDirectReceiptResult>,{state:'committed'}>,
  input:ReturnType<typeof parseDirectReceiptInput>){
  const {receipt}=result;
  return receipt.customerId===input.customerId&&receipt.actualOn===input.actualOn&&receipt.grossCents===input.grossCents
    &&(receipt.externalEvidenceId===null)===(input.externalIdentity===null)
    &&receipt.applications.length===Object.keys(input.applications).length
    &&receipt.applications.every(item=>input.applications[item.receivableId]===item.cents);
}

export function parseDirectReceiptOptions(value:unknown,businessId:string,customerId:string,date:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','actualOn','channels','receivables'])
    &&value.state==='ready'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&customerDate(value.actualOn)&&(date===null||date===value.actualOn)
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
  return {state:'ready' as const,actualOn,channels,receivables};
}

export const directReceiptRefusals=[
  'DIRECT_RECEIPT_INPUT_REQUIRED','DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED','DIRECT_RECEIPT_DATE_REQUIRED',
  'DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED','DIRECT_RECEIPT_ALREADY_RECORDED','DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED',
  'DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED','DIRECT_RECEIPT_RECEIVABLE_REQUIRED','DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE',
  'DIRECT_RECEIPT_OPTIONS_LIMIT','ACCOUNTING_OPEN_PERIOD_REQUIRED',
] as const;
