import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {isFinanceCents,isFinanceDecimalRate} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const text=(value:unknown,max:number):value is string=>financeAccountReviewReason(value)&&[...value].length<=max;
const inputFields=['reference','customerId','channelId','channelVersion','actualOn','grossCents',
  'confirmation','distinctReason','externalIdentity','applications'];
const receiptFields=['schemaVersion','businessId','paymentId','eventId','customerId','channelVersionId','accountId',
  'actualOn','grossCents','fundingOriginId','moneyMovementId','externalEvidenceId','applications'];
const tipBasisFields=['jurisdiction','taxProfileId','revenueMappingId','taxMappingId'];
const tipInputFields=[...tipBasisFields,'tipRealizationId','cents','confirmation'];

export function parseDirectReceiptTipOptions(value:unknown,businessId:string,customerId:string,actualOn:string,jurisdiction:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','actualOn','openPeriod','fundsMappingId','jurisdictions','selected'])
    &&value.state==='ready'&&value.schemaVersion===1&&value.businessId===businessId&&value.customerId===customerId
    &&customerDate(actualOn)&&value.actualOn===actualOn&&typeof value.openPeriod==='boolean'
    &&(value.fundsMappingId===null||customerUuid(value.fundsMappingId))&&Array.isArray(value.jurisdictions)
    &&value.jurisdictions.length<=180&&value.jurisdictions.every((item:unknown)=>text(item,200))
    &&new Set(value.jurisdictions).size===value.jurisdictions.length);
  const selected=value.selected;
  return {state:'ready' as const,actualOn,openPeriod:value.openPeriod,fundsMappingId:value.fundsMappingId,
    jurisdictions:value.jurisdictions as string[],selected:parseDirectReceiptTipBasis(selected,jurisdiction,value.jurisdictions)};
}

function parseDirectReceiptTipBasis(value:unknown,jurisdiction:string|null,jurisdictions:readonly string[]){
  if(value===null)return null;
  check(exact(value,[...tipBasisFields,'treatment','rate'])&&text(value.jurisdiction,200)
    &&value.jurisdiction===jurisdiction&&jurisdictions.includes(jurisdiction)
    &&customerUuid(value.taxProfileId)&&customerUuid(value.revenueMappingId));
  const common={jurisdiction:value.jurisdiction,taxProfileId:value.taxProfileId,revenueMappingId:value.revenueMappingId};
  if(value.treatment==='non_taxable'){
    check(value.rate===null&&value.taxMappingId===null);
    return {...common,treatment:value.treatment,rate:null,taxMappingId:null};
  }
  check(value.treatment==='inclusive_single'&&isFinanceDecimalRate(value.rate)&&value.rate!=='0'&&customerUuid(value.taxMappingId));
  return {...common,treatment:value.treatment,rate:value.rate,taxMappingId:value.taxMappingId};
}

function parseDirectReceiptTipInput(tip:unknown){
  check(exact(tip,tipInputFields)&&customerUuid(tip.tipRealizationId)&&positive(tip.cents)
    &&text(tip.jurisdiction,200)&&customerUuid(tip.taxProfileId)&&customerUuid(tip.revenueMappingId)
    &&(tip.taxMappingId===null||customerUuid(tip.taxMappingId))&&financeAccountReviewReason(tip.confirmation));
  return {tipRealizationId:tip.tipRealizationId,cents:tip.cents,jurisdiction:tip.jurisdiction,
    taxProfileId:tip.taxProfileId,revenueMappingId:tip.revenueMappingId,taxMappingId:tip.taxMappingId,confirmation:tip.confirmation};
}

export function parseDirectReceiptReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','paymentId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.paymentId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,paymentId:value.paymentId};
}

function parseHeldReceiptFunds(value:unknown,expectedCents:bigint){
  check(exact(value,['lotId','fundingPartitionId','mappingId','cents'])
    &&customerUuid(value.lotId)&&customerUuid(value.fundingPartitionId)&&customerUuid(value.mappingId)
    &&positive(value.cents)&&BigInt(value.cents)===expectedCents);
  return {lotId:value.lotId,fundingPartitionId:value.fundingPartitionId,mappingId:value.mappingId,cents:value.cents};
}

export function parseDirectReceiptInput(value:unknown){
  check((exact(value,inputFields)||exact(value,[...inputFields,'fundsMappingId'])||exact(value,[...inputFields,'fundsMappingId','tip']))
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
  check(entries.length<=180&&entries.every(([id,cents])=>customerUuid(id)&&positive(cents)));
  const normalized=entries.map(([id,cents])=>[id,String(cents)] as const).sort(([a],[b])=>a.localeCompare(b));
  const tip=Object.hasOwn(value,'tip')?parseDirectReceiptTipInput(value.tip):null;
  const remaining=BigInt(value.grossCents)-normalized.reduce((sum,[,cents])=>sum+BigInt(cents),0n)-(tip?BigInt(tip.cents):0n);
  const fundsMappingId=value.fundsMappingId;
  check(remaining>=0n&&entries.length+(tip?1:0)+(remaining>0n?1:0)<=180
    &&(tip||remaining>0n?hasMapping&&customerUuid(fundsMappingId):!hasMapping));
  return {
    reference:parseDirectReceiptReference(value.reference),customerId:value.customerId,channelId:value.channelId,
    channelVersion:value.channelVersion,actualOn:value.actualOn,grossCents:value.grossCents,confirmation:value.confirmation,
    distinctReason:value.distinctReason,externalIdentity:external,applications:Object.fromEntries(normalized),
    ...(customerUuid(fundsMappingId)?{fundsMappingId}:{}),
    ...(tip?{tip}:{}),
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
    ||exact(receipt,[...receiptFields,'heldFunds'])&&receipt.schemaVersion===2
    ||exact(receipt,[...receiptFields,'heldFunds','tip'])&&receipt.schemaVersion===3)
    &&receipt.businessId===businessId&&receipt.paymentId===reference.paymentId
    &&customerUuid(receipt.eventId)&&customerUuid(receipt.customerId)&&customerUuid(receipt.channelVersionId)
    &&customerUuid(receipt.accountId)&&customerDate(receipt.actualOn)&&positive(receipt.grossCents)
    &&customerUuid(receipt.fundingOriginId)&&customerUuid(receipt.moneyMovementId)
    &&(receipt.externalEvidenceId===null||customerUuid(receipt.externalEvidenceId))
    &&Array.isArray(receipt.applications)&&receipt.applications.length<=(receipt.schemaVersion===1?180:179));
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
  if(receipt.schemaVersion===3){
    const {tip}=receipt;
    check(exact(tip,[...tipBasisFields,'tipRealizationId','fundingPartitionId','firstCent','lastCent',
      'inclusiveCents','netCents','taxCents','confirmation'])
      &&customerUuid(tip.tipRealizationId)&&customerUuid(tip.fundingPartitionId)&&positive(tip.firstCent)
      &&positive(tip.lastCent)&&positive(tip.inclusiveCents)&&isFinanceCents(tip.netCents)&&isFinanceCents(tip.taxCents)
      &&text(tip.jurisdiction,200)&&customerUuid(tip.taxProfileId)&&customerUuid(tip.revenueMappingId)
      &&(tip.taxMappingId===null||customerUuid(tip.taxMappingId))&&(tip.taxMappingId!==null||tip.taxCents==='0')
      &&financeAccountReviewReason(tip.confirmation)
      &&BigInt(tip.inclusiveCents)===BigInt(tip.netCents)+BigInt(tip.taxCents)
      &&BigInt(tip.inclusiveCents)===BigInt(tip.lastCent)-BigInt(tip.firstCent)+1n
      &&BigInt(tip.firstCent)===BigInt(receipt.grossCents)-remaining+1n
      &&BigInt(tip.lastCent)<=BigInt(receipt.grossCents)&&applications.every(item=>item.fundingPartitionId!==tip.fundingPartitionId));
    const remainder=remaining-BigInt(tip.inclusiveCents);
    const heldFunds=receipt.heldFunds===null?null:parseHeldReceiptFunds(receipt.heldFunds,remainder);
    check(heldFunds===null?remainder===0n:applications.length<=178&&heldFunds.fundingPartitionId!==tip.fundingPartitionId
      &&applications.every(item=>item.fundingPartitionId!==heldFunds.fundingPartitionId));
    return {state:'committed' as const,receipt:{...common,schemaVersion:3 as const,heldFunds,tip:{
      tipRealizationId:tip.tipRealizationId,fundingPartitionId:tip.fundingPartitionId,firstCent:tip.firstCent,lastCent:tip.lastCent,
      inclusiveCents:tip.inclusiveCents,netCents:tip.netCents,taxCents:tip.taxCents,jurisdiction:tip.jurisdiction,taxProfileId:tip.taxProfileId,
      revenueMappingId:tip.revenueMappingId,taxMappingId:tip.taxMappingId,confirmation:tip.confirmation,
    }}};
  }
  if(receipt.schemaVersion===2){
    const heldFunds=parseHeldReceiptFunds(receipt.heldFunds,remaining);
    check(applications.every(item=>item.fundingPartitionId!==heldFunds.fundingPartitionId));
    return {state:'committed' as const,receipt:{...common,schemaVersion:2 as const,heldFunds}};
  }
  check(remaining===0n);
  return {state:'committed' as const,receipt:common};
}

export function directReceiptMatchesInput(result:Extract<ReturnType<typeof parseDirectReceiptResult>,{state:'committed'}>,
  input:ReturnType<typeof parseDirectReceiptInput>){
  const {receipt}=result;
  const tip='tip' in receipt?receipt.tip:null;
  const held='heldFunds' in receipt?receipt.heldFunds:null;
  return receipt.customerId===input.customerId&&receipt.actualOn===input.actualOn&&receipt.grossCents===input.grossCents
    &&(receipt.externalEvidenceId===null)===(input.externalIdentity===null)
    &&(held?held.mappingId===input.fundsMappingId:input.tip!==undefined||input.fundsMappingId===undefined)
    &&(tip===null?input.tip===undefined:input.tip!==undefined&&tip.tipRealizationId===input.tip.tipRealizationId
      &&tip.inclusiveCents===input.tip.cents&&tip.jurisdiction===input.tip.jurisdiction&&tip.taxProfileId===input.tip.taxProfileId
      &&tip.revenueMappingId===input.tip.revenueMappingId&&tip.taxMappingId===input.tip.taxMappingId&&tip.confirmation===input.tip.confirmation)
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
  'DIRECT_RECEIPT_TIP_INPUT_REQUIRED','DIRECT_RECEIPT_TIP_AMOUNT_REQUIRED','DIRECT_RECEIPT_TIP_BASIS_REQUIRED',
] as const;
