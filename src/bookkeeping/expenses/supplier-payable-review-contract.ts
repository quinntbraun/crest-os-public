import {customerDate,customerUuid,customerVersion,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {moneyChannelCents} from '../finance-money-channel-contract.ts';
import {expenseCheck as check,expenseDate} from './expense-contract.ts';
import {supplierBillCategories} from './supplier-bill-draft-contract.ts';

export const supplierPurchaseTaxTreatments=['none','verified_nonrecoverable'] as const;
export const supplierPayableReviewRefusals=['SUPPLIER_PAYABLE_DUE_DATE_REQUIRED','SUPPLIER_PAYABLE_DOCUMENT_REVIEW_REQUIRED',
 'SUPPLIER_PAYABLE_PURCHASE_TAX_REVIEW_REQUIRED','SUPPLIER_PAYABLE_CONTROL_MAPPING_REQUIRED',
 'SUPPLIER_PAYABLE_ORDINARY_COST_MAPPING_REQUIRED','ACCOUNTING_OPEN_PERIOD_REQUIRED'] as const;
const mediaTypes=['application/pdf','image/jpeg','image/png','image/heic'];
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=(value:unknown):value is string=>moneyChannelCents(value)&&BigInt(value)>0n;
function reviewText(value:unknown,limit=1000):value is string{
 return typeof value==='string'&&value.length>0&&value.trim()===value&&[...value].length<=limit&&[...value].every(character=>{
  const code=character.charCodeAt(0);return code>=32&&(code<127||code>159);
 });
}
export function parseSupplierPayableReviewRequest(value:unknown){
 check(exact(value,['billId','revision','originalId','taxTreatment','reason'])&&customerUuid(value.billId)
  &&customerVersion(value.revision)&&(value.originalId===null||customerUuid(value.originalId))
  &&(value.taxTreatment==='none'||value.taxTreatment==='verified_nonrecoverable')&&reviewText(value.reason));
 return {billId:value.billId,revision:value.revision,originalId:value.originalId,taxTreatment:value.taxTreatment,reason:value.reason};
}
export type SupplierPayableReviewRequest=ReturnType<typeof parseSupplierPayableReviewRequest>;

export function parseSupplierPayableReview(value:unknown,businessId:string,request:SupplierPayableReviewRequest){
 if(exact(value,['state'])&&(value.state==='stale'||value.state==='original_required'))return {state:value.state} as const;
 if(exact(value,['state','payableId'])&&value.state==='posted'&&customerUuid(value.payableId))return {state:value.state,payableId:value.payableId} as const;
 if(exact(value,['state','originals'])&&value.state==='select_original'){
  check(request.originalId===null&&Array.isArray(value.originals)&&value.originals.length>1);
  const originals=value.originals.map((original:unknown)=>{
   check(exact(original,['originalId','fileSha256','mediaType'])&&customerUuid(original.originalId)&&sha(original.fileSha256)
    &&typeof original.mediaType==='string'&&mediaTypes.includes(original.mediaType));
   return {originalId:original.originalId,fileSha256:original.fileSha256,mediaType:original.mediaType};
  });
  check(originals.every((original,index)=>index===0||originals[index-1]!.originalId<original.originalId));
  return {state:value.state,originals} as const;
 }
 check(exact(value,['state','originalId','plan','candidates'])&&value.state==='ready'&&customerUuid(value.originalId)
  &&(request.originalId===null||value.originalId===request.originalId)&&Array.isArray(value.candidates));
 const plan=value.plan;
 check(exact(plan,['schemaVersion','state','template','currency','businessId','billId','revision','incurredOn','dueOn','unknownDueReason',
  'vendor','documentReference','documentSha256','purchaseTaxTreatment','includedPurchaseTaxCents','reviewReason','periodId','periodGeneration',
  'approvalRequiresOriginal','totalDebitCents','totalCreditCents','lines','planSha256'])&&plan.schemaVersion===1&&plan.state==='entry_preview'
  &&plan.template==='P14'&&plan.currency==='USD'&&plan.businessId===businessId&&plan.billId===request.billId&&plan.revision===request.revision
  &&expenseDate(plan.incurredOn)&&customerDate(plan.dueOn)&&plan.unknownDueReason===null&&reviewText(plan.vendor,200)
  &&reviewText(plan.documentReference,200)&&sha(plan.documentSha256)&&plan.purchaseTaxTreatment===request.taxTreatment
  &&moneyChannelCents(plan.includedPurchaseTaxCents)&&BigInt(plan.includedPurchaseTaxCents)>=0n
  &&(plan.includedPurchaseTaxCents==='0')===(request.taxTreatment==='none')&&plan.reviewReason===request.reason
  &&customerUuid(plan.periodId)&&customerVersion(plan.periodGeneration,true)&&BigInt(plan.periodGeneration)%2n===0n&&plan.approvalRequiresOriginal===true
  &&positive(plan.totalDebitCents)&&plan.totalDebitCents===plan.totalCreditCents
  &&BigInt(plan.includedPurchaseTaxCents)<=BigInt(plan.totalDebitCents)&&sha(plan.planSha256)
  &&Array.isArray(plan.lines)&&plan.lines.length>=2&&plan.lines.length<=supplierBillCategories.length+1);
 let debit=0n,priorCategory='';
 const lines=plan.lines.map((line:unknown,index:number)=>{
  check(exact(line,['category','accountId','mappingId','debitCents','creditCents'])&&customerUuid(line.accountId)&&customerUuid(line.mappingId));
  if(index===(plan.lines as unknown[]).length-1){
   check(line.category===null&&line.debitCents==='0'&&line.creditCents===plan.totalCreditCents);
  }else{
   check(typeof line.category==='string'&&supplierBillCategories.some(category=>category===line.category)&&line.category>priorCategory
    &&positive(line.debitCents)&&line.creditCents==='0');
   priorCategory=line.category;debit+=BigInt(line.debitCents);
  }
  return {category:line.category as string|null,accountId:line.accountId,mappingId:line.mappingId,
   debitCents:line.debitCents as string,creditCents:line.creditCents as string};
 });
 check(debit===BigInt(plan.totalDebitCents)&&lines.slice(0,-1).every(line=>line.accountId!==lines.at(-1)!.accountId));
 const candidates=value.candidates.map((item:unknown)=>{
  check(exact(item,['payableId','billId','incurredOn','grossCents','sameDocumentReference','sameOriginalSha256'])
   &&customerUuid(item.payableId)&&customerUuid(item.billId)&&item.billId!==request.billId&&expenseDate(item.incurredOn)
   &&positive(item.grossCents)&&typeof item.sameDocumentReference==='boolean'&&typeof item.sameOriginalSha256==='boolean'
   &&(item.sameDocumentReference||item.sameOriginalSha256));
  return {payableId:item.payableId,billId:item.billId,incurredOn:item.incurredOn,grossCents:item.grossCents,
   sameDocumentReference:item.sameDocumentReference,sameOriginalSha256:item.sameOriginalSha256};
 });
 check(candidates.every((candidate,index)=>index===0||candidates[index-1]!.payableId<candidate.payableId));
 return {state:'ready' as const,originalId:value.originalId,plan:{vendor:plan.vendor,incurredOn:plan.incurredOn,dueOn:plan.dueOn,
  documentReference:plan.documentReference,documentSha256:plan.documentSha256,totalCents:plan.totalDebitCents,
  taxCents:plan.includedPurchaseTaxCents,sha256:plan.planSha256,lines},candidates};
}
