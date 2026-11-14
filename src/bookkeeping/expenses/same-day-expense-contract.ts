import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from '../finance-account-contract.ts';
import {isFinanceCents} from '../finance-inclusive-charge.ts';
import {expenseCategories} from './expense-contract.ts';

const taxTreatment=(value:unknown):value is 'none'|'verified_nonrecoverable'=>
  value==='none'||value==='verified_nonrecoverable';
const reasonOrNull=(value:unknown):value is string|null=>value===null||financeAccountReviewReason(value);
const taxMatches=(treatment:'none'|'verified_nonrecoverable',cents:string)=>(treatment==='none')===(cents==='0');

export function parseSameDayExpenseReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','postedExpenseId'])
    &&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch)&&customerUuid(value.postedExpenseId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,postedExpenseId:value.postedExpenseId};
}

export function parseSameDayExpenseInput(value:unknown){
  check(exact(value,['reference','expenseId','expenseRevision','channelId','channelVersion','mappingId',
    'incurredOn','paidOn','purchaseTaxTreatment','purchaseTaxCents','receiptId','missingReceiptReason',
    'unknownVendorReason','reviewReason','externalIdentity'])
    &&customerUuid(value.expenseId)&&customerVersion(value.expenseRevision)
    &&customerUuid(value.channelId)&&customerVersion(value.channelVersion)&&customerUuid(value.mappingId)
    &&customerDate(value.incurredOn)&&customerDate(value.paidOn)&&value.incurredOn===value.paidOn
    &&taxTreatment(value.purchaseTaxTreatment)&&isFinanceCents(value.purchaseTaxCents)
    &&taxMatches(value.purchaseTaxTreatment,value.purchaseTaxCents)
    &&(value.receiptId===null||customerUuid(value.receiptId))&&reasonOrNull(value.missingReceiptReason)
    &&(value.receiptId===null)===(value.missingReceiptReason!==null)
    &&reasonOrNull(value.unknownVendorReason)&&financeAccountReviewReason(value.reviewReason));
  const external=value.externalIdentity;
  check(exact(external,['namespace','id','rawReference'])&&typeof external.namespace==='string'
    &&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(external.namespace)
    &&financeAccountReviewReason(external.id)&&[...external.id].length<=200
    &&financeAccountReviewReason(external.rawReference));
  return {
    reference:parseSameDayExpenseReference(value.reference),expenseId:value.expenseId,expenseRevision:value.expenseRevision,
    channelId:value.channelId,channelVersion:value.channelVersion,mappingId:value.mappingId,
    incurredOn:value.incurredOn,paidOn:value.paidOn,purchaseTaxTreatment:value.purchaseTaxTreatment,
    purchaseTaxCents:value.purchaseTaxCents,receiptId:value.receiptId,missingReceiptReason:value.missingReceiptReason,
    unknownVendorReason:value.unknownVendorReason,reviewReason:value.reviewReason,
    externalIdentity:{namespace:external.namespace,id:external.id,rawReference:external.rawReference},
  };
}

export function parseSameDayExpenseResult(value:unknown,businessId:string,reference:ReturnType<typeof parseSameDayExpenseReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')
    return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','postedExpenseId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.postedExpenseId===reference.postedExpenseId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{postedExpenseId:reference.postedExpenseId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  return {state:'committed' as const,receipt:parsePostedExpenseReceipt(value.receipt,businessId,reference.postedExpenseId)};
}

function parsePostedExpenseReceipt(receipt:unknown,businessId:string,expectedPostedExpenseId?:string){
  check(exact(receipt,['schemaVersion','businessId','postedExpenseId','expenseId','expenseRevision','eventId',
    'incurredOn','paidOn','grossCents','purchaseTaxCents','purchaseTaxTreatment','mappingId','expenseAccountId',
    'channelVersionId','moneyAccountId','externalEvidenceId','moneyMovementId','receiptId','receiptRevision',
    'missingReceiptReason','unknownVendorReason'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&customerUuid(receipt.postedExpenseId)
    &&(expectedPostedExpenseId===undefined||receipt.postedExpenseId===expectedPostedExpenseId)
    &&customerUuid(receipt.expenseId)&&customerVersion(receipt.expenseRevision)&&customerUuid(receipt.eventId)
    &&customerDate(receipt.incurredOn)&&customerDate(receipt.paidOn)&&receipt.incurredOn===receipt.paidOn
    &&isFinanceCents(receipt.grossCents)&&receipt.grossCents!=='0'&&isFinanceCents(receipt.purchaseTaxCents)
    &&BigInt(receipt.purchaseTaxCents)<=BigInt(receipt.grossCents)&&taxTreatment(receipt.purchaseTaxTreatment)
    &&taxMatches(receipt.purchaseTaxTreatment,receipt.purchaseTaxCents)
    &&customerUuid(receipt.mappingId)&&customerUuid(receipt.expenseAccountId)&&customerUuid(receipt.channelVersionId)
    &&customerUuid(receipt.moneyAccountId)&&customerUuid(receipt.externalEvidenceId)&&customerUuid(receipt.moneyMovementId)
    &&(receipt.receiptId===null||customerUuid(receipt.receiptId))
    &&(receipt.receiptId===null?receipt.receiptRevision===null:receipt.receiptRevision==='2')
    &&reasonOrNull(receipt.missingReceiptReason)&&(receipt.receiptId===null)===(receipt.missingReceiptReason!==null)
    &&reasonOrNull(receipt.unknownVendorReason));
  return {
    postedExpenseId:receipt.postedExpenseId,expenseId:receipt.expenseId,expenseRevision:receipt.expenseRevision,
    eventId:receipt.eventId,incurredOn:receipt.incurredOn,paidOn:receipt.paidOn,grossCents:receipt.grossCents,
    purchaseTaxCents:receipt.purchaseTaxCents,purchaseTaxTreatment:receipt.purchaseTaxTreatment,mappingId:receipt.mappingId,
    expenseAccountId:receipt.expenseAccountId,channelVersionId:receipt.channelVersionId,moneyAccountId:receipt.moneyAccountId,
    externalEvidenceId:receipt.externalEvidenceId,moneyMovementId:receipt.moneyMovementId,receiptId:receipt.receiptId,
    receiptRevision:receipt.receiptRevision,missingReceiptReason:receipt.missingReceiptReason,unknownVendorReason:receipt.unknownVendorReason,
  };
}

export function parseSameDayExpenseOptions(value:unknown,businessId:string,expenseId:string){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state'])&&value.state==='voided')return {state:'voided' as const};
  if(exact(value,['state','receipt'])&&value.state==='posted'){
    const receipt=parsePostedExpenseReceipt(value.receipt,businessId);
    check(receipt.expenseId===expenseId);
    return {state:'posted' as const,receipt};
  }
  check(exact(value,['state','schemaVersion','businessId','expenseId','expenseRevision','retainedPaidOn','grossCents',
    'category','description','vendor','mapping','channels','validatedReceipts','openPeriod'])
    &&value.state==='review'&&value.schemaVersion===1&&value.businessId===businessId&&value.expenseId===expenseId
    &&customerVersion(value.expenseRevision)&&customerDate(value.retainedPaidOn)&&isFinanceCents(value.grossCents)&&value.grossCents!=='0'
    &&typeof value.category==='string'&&expenseCategories.some(category=>category===value.category)
    &&typeof value.description==='string'&&value.description.length>0&&value.description.length<=2000
    &&(value.vendor===null||typeof value.vendor==='string'&&value.vendor.length>0&&value.vendor.length<=600)
    &&typeof value.openPeriod==='boolean'&&Array.isArray(value.channels)&&value.channels.length<=180
    &&Array.isArray(value.validatedReceipts)&&value.validatedReceipts.length<=180);
  const {mapping}=value;
  let approved:Readonly<{mappingId:string;accountId:string;accountCode:string;purpose:string}>|null=null;
  if(mapping!==null){
    check(exact(mapping,['mappingId','accountId','accountCode','purpose'])&&customerUuid(mapping.mappingId)
      &&customerUuid(mapping.accountId)&&typeof mapping.accountCode==='string'&&mapping.accountCode.length<=32
      &&typeof mapping.purpose==='string'&&mapping.purpose.length<=200);
    approved={mappingId:mapping.mappingId,accountId:mapping.accountId,accountCode:mapping.accountCode,purpose:mapping.purpose};
  }
  const channels=value.channels.map((row:unknown)=>{
    check(exact(row,['channelId','channelVersionId','version','accountId','label','kind'])&&customerUuid(row.channelId)
      &&customerUuid(row.channelVersionId)&&customerVersion(row.version)&&customerUuid(row.accountId)
      &&financeAccountReviewReason(row.label)&&(row.kind==='bank'||row.kind==='wallet'));
    return {channelId:row.channelId,channelVersionId:row.channelVersionId,version:row.version,
      accountId:row.accountId,label:row.label,kind:row.kind};
  });
  const validatedReceipts=value.validatedReceipts.map((row:unknown)=>{
    check(exact(row,['receiptId','revision'])&&customerUuid(row.receiptId)&&row.revision==='2');
    return {receiptId:row.receiptId,revision:row.revision};
  });
  check(new Set(channels.map(row=>row.channelId)).size===channels.length
    &&new Set(validatedReceipts.map(row=>row.receiptId)).size===validatedReceipts.length);
  return {state:'review' as const,expenseId,expenseRevision:value.expenseRevision,retainedPaidOn:value.retainedPaidOn,
    grossCents:value.grossCents,category:value.category,description:value.description,vendor:value.vendor,
    openPeriod:value.openPeriod,mapping:approved,channels,validatedReceipts};
}

export function sameDayExpenseMatchesInput(result:Extract<ReturnType<typeof parseSameDayExpenseResult>,{state:'committed'}>,
  input:ReturnType<typeof parseSameDayExpenseInput>){
  const {receipt}=result;
  return receipt.expenseId===input.expenseId&&receipt.expenseRevision===input.expenseRevision&&receipt.paidOn===input.paidOn
    &&receipt.mappingId===input.mappingId&&receipt.purchaseTaxTreatment===input.purchaseTaxTreatment
    &&receipt.purchaseTaxCents===input.purchaseTaxCents&&receipt.receiptId===input.receiptId
    &&receipt.missingReceiptReason===input.missingReceiptReason&&receipt.unknownVendorReason===input.unknownVendorReason;
}

export const sameDayExpenseRefusals=[
  'PAID_EXPENSE_INPUT_REQUIRED','PAID_EXPENSE_SAME_DATE_REQUIRED','PAID_EXPENSE_CURRENT_REVISION_REQUIRED',
  'PAID_EXPENSE_PURCHASE_TAX_REVIEW_REQUIRED','PAID_EXPENSE_EVIDENCE_REQUIRED','PAID_EXPENSE_ALREADY_POSTED',
  'PAID_EXPENSE_ORDINARY_MAPPING_REQUIRED','PAID_EXPENSE_VERIFIED_CHANNEL_REQUIRED',
  'PAID_EXPENSE_EXTERNAL_ID_ALREADY_RECORDED','ACCOUNTING_OPEN_PERIOD_REQUIRED',
] as const;
