import {customerUuid,customerVersion,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {moneyChannelCents} from '../finance-money-channel-contract.ts';
import {expenseCheck as check,expenseDate} from './expense-contract.ts';
import {parseSupplierPayableReviewRequest} from './supplier-payable-review-contract.ts';

const positive=(value:unknown):value is string=>moneyChannelCents(value)&&BigInt(value)>0n;
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function text(value:unknown,max=1000):value is string{
 return typeof value==='string'&&value.length>0&&value===value.trim()&&[...value].length<=max
  &&![...value].some(character=>{const code=character.charCodeAt(0);return code<32||(code>=127&&code<=159);});
}
function duplicateIds(value:unknown):value is string[]{
 return Array.isArray(value)&&value.every((id:unknown,index)=>customerUuid(id)&&(index===0||value[index-1]<id));
}
export const supplierPostingRefusals=[
 'SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED','SUPPLIER_PAYABLE_ALREADY_POSTED','SUPPLIER_PAYABLE_REVIEW_CHANGED',
 'SUPPLIER_PAYABLE_DUPLICATE_REVIEW_REQUIRED','SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED','SUPPLIER_SETTLEMENT_PAYABLE_REQUIRED',
 'SUPPLIER_SETTLEMENT_ACTUAL_DATE_REQUIRED','SUPPLIER_SETTLEMENT_REMAINING_CHANGED','SUPPLIER_SETTLEMENT_VERIFIED_CHANNEL_REQUIRED',
 'SUPPLIER_SETTLEMENT_EXTERNAL_ID_ALREADY_RECORDED',
] as const;

export function parseSupplierOperationReference(value:unknown){
 check(exact(value,['kind','operationId','recoveryEpoch','id'])&&(value.kind==='payable'||value.kind==='settlement')
  &&customerUuid(value.id)&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch));
 return {kind:value.kind,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,id:value.id};
}
export type SupplierOperationReference=ReturnType<typeof parseSupplierOperationReference>;

export function parseSupplierAccrualRequest(value:unknown){
 check(exact(value,['reference','review','planSha256','reviewedDuplicates','distinctReason']));
 const reference=parseSupplierOperationReference(value.reference),review=parseSupplierPayableReviewRequest(value.review);
 check(reference.kind==='payable'&&review.originalId!==null&&sha(value.planSha256)&&duplicateIds(value.reviewedDuplicates)
  &&(value.reviewedDuplicates.length===0?value.distinctReason===null:text(value.distinctReason)));
 return {reference,review,planSha256:value.planSha256,reviewedDuplicates:value.reviewedDuplicates,distinctReason:value.distinctReason};
}

export function parseSupplierSettlementRequest(value:unknown){
 check(exact(value,['reference','payableId','channelId','channelVersion','actualOn','paidCents','remainingCents','evidence','confirmation']));
 const reference=parseSupplierOperationReference(value.reference),evidence=value.evidence;
 check(reference.kind==='settlement'&&customerUuid(value.payableId)&&customerUuid(value.channelId)&&customerVersion(value.channelVersion)
  &&expenseDate(value.actualOn)&&positive(value.paidCents)&&positive(value.remainingCents)&&BigInt(value.paidCents)<=BigInt(value.remainingCents)
  &&exact(evidence,['namespace','id','reference'])&&typeof evidence.namespace==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(evidence.namespace)
  &&text(evidence.id,200)&&text(evidence.reference)&&text(value.confirmation));
 return {reference,payableId:value.payableId,channelId:value.channelId,channelVersion:value.channelVersion,
  actualOn:value.actualOn,paidCents:value.paidCents,remainingCents:value.remainingCents,
  evidence:{namespace:evidence.namespace,id:evidence.id,reference:evidence.reference},confirmation:value.confirmation};
}

export function parseSupplierOperationResult(value:unknown,businessId:string,reference:SupplierOperationReference){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict' as const,reason:'operation' as const};
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const receipt=value.receipt;
 const common=['schemaVersion','businessId','operationId','payableId','eventId'];
 if(reference.kind==='payable'){
  check(exact(receipt,[...common,'billId','billRevision','originalId','grossCents','reviewSha256','duplicatePayableIds','distinctReason'])
   &&receipt.payableId===reference.id&&customerUuid(receipt.billId)&&customerVersion(receipt.billRevision)&&customerUuid(receipt.originalId)
   &&positive(receipt.grossCents)&&sha(receipt.reviewSha256)&&duplicateIds(receipt.duplicatePayableIds)
   &&(receipt.duplicatePayableIds.length===0?receipt.distinctReason===null:text(receipt.distinctReason)));
 }else{
  check(exact(receipt,[...common,'settlementId','actualOn','paidCents','remainingCents','channelVersionId','evidenceId','movementId'])
   &&receipt.settlementId===reference.id&&customerUuid(receipt.payableId)&&expenseDate(receipt.actualOn)&&positive(receipt.paidCents)
   &&moneyChannelCents(receipt.remainingCents)&&BigInt(receipt.remainingCents)>=0n&&customerUuid(receipt.channelVersionId)
   &&customerUuid(receipt.evidenceId)&&customerUuid(receipt.movementId));
 }
 check(receipt.schemaVersion===1&&receipt.businessId===businessId&&receipt.operationId===reference.operationId&&customerUuid(receipt.eventId));
 return {state:'committed' as const,receipt};
}
