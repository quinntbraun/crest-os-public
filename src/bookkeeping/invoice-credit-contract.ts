import {customerDate,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason,requireFinanceAccount as check} from './finance-account-contract.ts';
import {creditRangeComponents} from './credit-ranges.ts';
import {isFinanceCents} from './finance-inclusive-charge.ts';

const positive=(value:unknown):value is string=>isFinanceCents(value)&&value!=='0';
const validDate=(value:unknown):value is string=>customerDate(value)&&value>='1900-01-01';
const nullableUuid=(value:unknown):value is string|null=>value===null||customerUuid(value);

function range(value:unknown){
  check(exact(value,['firstCent','lastCent'])&&positive(value.firstCent)&&positive(value.lastCent)
    &&BigInt(value.lastCent)>=BigInt(value.firstCent));
  return {firstCent:value.firstCent,lastCent:value.lastCent};
}

export function parseInvoiceCreditReference(value:unknown){
  check(exact(value,['operationId','recoveryEpoch','invoiceCreditId'])&&customerUuid(value.operationId)
    &&customerUuid(value.recoveryEpoch)&&customerUuid(value.invoiceCreditId));
  return {operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,invoiceCreditId:value.invoiceCreditId};
}

export function parseInvoiceCreditInput(value:unknown){
  check(exact(value,['reference','invoiceItemId','customerId','effectiveOn','firstCent','lastCent','returnsMappingId','reason'])
    &&customerUuid(value.invoiceItemId)&&customerUuid(value.customerId)&&validDate(value.effectiveOn)
    &&customerUuid(value.returnsMappingId)&&financeAccountReviewReason(value.reason));
  return {reference:parseInvoiceCreditReference(value.reference),invoiceItemId:value.invoiceItemId,customerId:value.customerId,
    effectiveOn:value.effectiveOn,...range({firstCent:value.firstCent,lastCent:value.lastCent}),returnsMappingId:value.returnsMappingId,reason:value.reason};
}

export function parseInvoiceCreditOptions(value:unknown,businessId:string,customerId:string,invoiceId:string,requestedOn:string|null){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  check(exact(value,['state','schemaVersion','businessId','customerId','invoiceId','receivableId','issuedOn','effectiveOn',
    'openPeriod','availableBalanceCents','lines'])&&value.state==='review'&&value.schemaVersion===1
    &&value.businessId===businessId&&value.customerId===customerId&&value.invoiceId===invoiceId&&nullableUuid(value.receivableId)
    &&validDate(value.issuedOn)&&validDate(value.effectiveOn)&&value.effectiveOn>=value.issuedOn
    &&(requestedOn===null||requestedOn===value.effectiveOn)&&typeof value.openPeriod==='boolean'
    &&isFinanceCents(value.availableBalanceCents)&&Array.isArray(value.lines)&&value.lines.length>0&&value.lines.length<=180);
  const {availableBalanceCents,receivableId}=value;
  const lines=value.lines.map((line:unknown)=>{
    check(exact(line,['invoiceItemId','description','inclusiveCents','netCents','taxCents','discountCents','availableRange',
      'maximumStandaloneCents','returnsMappingId'])&&customerUuid(line.invoiceItemId)&&typeof line.description==='string'
      &&line.description.length>0&&line.description.length<=10000&&isFinanceCents(line.inclusiveCents)&&isFinanceCents(line.netCents)
      &&isFinanceCents(line.taxCents)&&isFinanceCents(line.discountCents)&&isFinanceCents(line.maximumStandaloneCents)
      &&nullableUuid(line.returnsMappingId)&&BigInt(line.inclusiveCents)===BigInt(line.netCents)+BigInt(line.taxCents));
    const availableRange=line.availableRange===null?null:range(line.availableRange);
    const available=availableRange?BigInt(availableRange.lastCent)-BigInt(availableRange.firstCent)+1n:0n;
    const maximum=BigInt(availableBalanceCents)<available?BigInt(availableBalanceCents):available;
    check((!availableRange||availableRange.lastCent===line.inclusiveCents)&&BigInt(line.maximumStandaloneCents)===maximum
      &&(maximum>0n||line.returnsMappingId===null)&&(receivableId!==null||line.inclusiveCents==='0'));
    return {invoiceItemId:line.invoiceItemId,description:line.description,inclusiveCents:line.inclusiveCents,netCents:line.netCents,
      taxCents:line.taxCents,discountCents:line.discountCents,availableRange,maximumStandaloneCents:line.maximumStandaloneCents,
      returnsMappingId:line.returnsMappingId};
  });
  check(new Set(lines.map(line=>line.invoiceItemId)).size===lines.length&&(receivableId!==null||availableBalanceCents==='0'));
  return {state:'review' as const,receivableId,issuedOn:value.issuedOn,effectiveOn:value.effectiveOn,openPeriod:value.openPeriod,
    availableBalanceCents,lines};
}

const knownRefusals={
  INVOICE_CREDIT_INPUT_REQUIRED:'invalid_input',
  INVOICE_CREDIT_ITEM_REQUIRED:'source_unavailable',
  INVOICE_CREDIT_ZERO_COMPONENT_REVIEW_REQUIRED:'zero_component_review_required',
  INVOICE_CREDIT_DATE_REQUIRED:'invalid_date',
  INVOICE_CREDIT_RANGE_UNAVAILABLE:'range_changed',
  INVOICE_CREDIT_ALREADY_RECORDED:'credit_id_conflict',
  INVOICE_CREDIT_PAIRED_UNAPPLICATION_REQUIRED:'paired_unapplication_required',
  INVOICE_CREDIT_BASIS_REQUIRED:'mapping_review_required',
  ACCOUNTING_OPEN_PERIOD_REQUIRED:'period_closed',
  FINANCE_ACCOUNT_SETUP_REQUIRED:'finance_setup_required',
  RECOVERY_REVIEW_REQUIRED:'recovery_review_required',
} as const;

export function invoiceCreditRefusal(value:unknown){
  if(typeof value!=='string'||!Object.hasOwn(knownRefusals,value))return null;
  return knownRefusals[value as keyof typeof knownRefusals];
}

export function parseInvoiceCreditResult(value:unknown,businessId:string,reference:ReturnType<typeof parseInvoiceCreditReference>){
  if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
  if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict' as const,reason:'operation' as const};
  if(exact(value,['state','receipt'])&&value.state==='retired'){
    const {receipt}=value;
    check(exact(receipt,['schemaVersion','businessId','operationId','invoiceCreditId','originalEpoch','reviewEpoch','reason'])
      &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
      &&receipt.invoiceCreditId===reference.invoiceCreditId&&receipt.originalEpoch===reference.recoveryEpoch
      &&customerUuid(receipt.reviewEpoch)&&financeAccountReviewReason(receipt.reason));
    return {state:'retired' as const,receipt:{invoiceCreditId:reference.invoiceCreditId,reviewEpoch:receipt.reviewEpoch,reason:receipt.reason}};
  }
  check(exact(value,['state','receipt'])&&value.state==='committed');
  const {receipt}=value;
  check(exact(receipt,['schemaVersion','businessId','invoiceCreditId','operationId','eventId','invoiceId','invoiceItemId','receivableId',
    'customerId','arAccountId','returnsAccountId','returnsMappingId','taxAccountId','originalTaxMovementId','discountAccountId',
    'discountMappingId','effectiveOn','firstCent','lastCent','inclusiveCents','netCents','taxCents','discountCents','returnsCents','reason'])
    &&receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId
    &&receipt.invoiceCreditId===reference.invoiceCreditId&&customerUuid(receipt.eventId)&&customerUuid(receipt.invoiceId)
    &&customerUuid(receipt.invoiceItemId)&&customerUuid(receipt.receivableId)&&customerUuid(receipt.customerId)
    &&customerUuid(receipt.arAccountId)&&customerUuid(receipt.returnsAccountId)&&customerUuid(receipt.returnsMappingId)
    &&nullableUuid(receipt.taxAccountId)&&nullableUuid(receipt.originalTaxMovementId)&&nullableUuid(receipt.discountAccountId)
    &&nullableUuid(receipt.discountMappingId)&&validDate(receipt.effectiveOn)&&positive(receipt.inclusiveCents)
    &&isFinanceCents(receipt.netCents)&&isFinanceCents(receipt.taxCents)&&isFinanceCents(receipt.discountCents)
    &&isFinanceCents(receipt.returnsCents)&&financeAccountReviewReason(receipt.reason));
  const consumed=range({firstCent:receipt.firstCent,lastCent:receipt.lastCent});
  const accounts=[receipt.arAccountId,receipt.returnsAccountId,receipt.taxAccountId,receipt.discountAccountId].filter(account=>account!==null);
  check(new Set(accounts).size===accounts.length
    &&BigInt(receipt.inclusiveCents)===BigInt(consumed.lastCent)-BigInt(consumed.firstCent)+1n
    &&BigInt(receipt.inclusiveCents)===BigInt(receipt.netCents)+BigInt(receipt.taxCents)
    &&BigInt(receipt.returnsCents)===BigInt(receipt.netCents)+BigInt(receipt.discountCents)
    &&(receipt.taxCents!=='0')===(receipt.taxAccountId!==null)&&(receipt.taxCents!=='0')===(receipt.originalTaxMovementId!==null)
    &&(receipt.discountCents!=='0')===(receipt.discountAccountId!==null)&&(receipt.discountCents!=='0')===(receipt.discountMappingId!==null));
  return {state:'committed' as const,receipt:{invoiceCreditId:reference.invoiceCreditId,eventId:receipt.eventId,invoiceId:receipt.invoiceId,
    invoiceItemId:receipt.invoiceItemId,receivableId:receipt.receivableId,customerId:receipt.customerId,arAccountId:receipt.arAccountId,
    returnsAccountId:receipt.returnsAccountId,returnsMappingId:receipt.returnsMappingId,taxAccountId:receipt.taxAccountId,
    originalTaxMovementId:receipt.originalTaxMovementId,discountAccountId:receipt.discountAccountId,discountMappingId:receipt.discountMappingId,
    effectiveOn:receipt.effectiveOn,...consumed,inclusiveCents:receipt.inclusiveCents,netCents:receipt.netCents,taxCents:receipt.taxCents,
    discountCents:receipt.discountCents,returnsCents:receipt.returnsCents,reason:receipt.reason}};
}

export function invoiceCreditMatchesInput(result:Extract<ReturnType<typeof parseInvoiceCreditResult>,{state:'committed'}>,
  input:ReturnType<typeof parseInvoiceCreditInput>){
  const {receipt}=result;
  return receipt.invoiceItemId===input.invoiceItemId&&receipt.customerId===input.customerId&&receipt.effectiveOn===input.effectiveOn
    &&receipt.firstCent===input.firstCent&&receipt.lastCent===input.lastCent&&receipt.returnsMappingId===input.returnsMappingId
    &&receipt.reason===input.reason;
}

export function calculateInvoiceCreditReview(original:Readonly<{inclusiveCents:string;netCents:string;taxCents:string;discountCents:string}>,
  firstCent:string,lastCent:string){
  check(positive(original.inclusiveCents)&&isFinanceCents(original.netCents)&&isFinanceCents(original.taxCents)&&isFinanceCents(original.discountCents));
  const selected=range({firstCent,lastCent});
  const result=creditRangeComponents({inclusiveCents:BigInt(original.inclusiveCents),netCents:BigInt(original.netCents),
    taxCents:BigInt(original.taxCents),discountCents:BigInt(original.discountCents)},
  [{first:BigInt(selected.firstCent),last:BigInt(selected.lastCent)}]);
  return {inclusiveCents:String(result.inclusiveCents),netCents:String(result.netCents),taxCents:String(result.taxCents),
    discountCents:String(result.discountCents),returnsCents:String(result.netCents+result.discountCents)};
}
