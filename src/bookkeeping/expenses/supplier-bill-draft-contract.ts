import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {moneyChannelCents} from '../finance-money-channel-contract.ts';
import {expenseCategories,expenseDate} from './expense-contract.ts';

export const supplierBillCategories=expenseCategories.filter(category=>category!=='equipment');
export const supplierBillDraftRefusals=[
 'SUPPLIER_BILL_DRAFT_INPUT_REQUIRED','SUPPLIER_BILL_DRAFT_INCURRED_DATE_REQUIRED','RECOVERY_REVIEW_REQUIRED',
] as const;
const fields=['incurredOn','dueOn','unknownDueReason','vendor','unknownVendorReason','documentReference',
 'grossCents','purchaseTaxCents','purpose','missingReceiptReason','splits','changeReason'] as const;

function check(value:unknown):asserts value{
 if(!value)throw Error('SUPPLIER_BILL_DRAFT_INPUT_REQUIRED');
}
function text(value:unknown,limit=1000):string{
 check(typeof value==='string'&&value.trim()===value&&value.length>0&&[...value].length<=limit
  &&![...value].some(character=>{const code=character.charCodeAt(0);return code<32||code>=127&&code<=159;}));
 return value;
}
function optionalText(value:unknown,limit=1000){
 return value===null?null:text(value,limit);
}
function positiveCents(value:unknown):value is string{
 return moneyChannelCents(value)&&BigInt(value)>0n;
}

export function parseSupplierBillDraftPayload(value:unknown){
 check(exact(value,fields)&&expenseDate(value.incurredOn)&&(value.dueOn===null||customerDate(value.dueOn))
  &&positiveCents(value.grossCents)&&(value.purchaseTaxCents===null||moneyChannelCents(value.purchaseTaxCents)
   &&BigInt(value.purchaseTaxCents)>=0n&&BigInt(value.purchaseTaxCents)<=BigInt(value.grossCents))
  &&Array.isArray(value.splits)&&value.splits.length>=1&&value.splits.length<=supplierBillCategories.length);
 const vendor=optionalText(value.vendor,200),unknownVendorReason=optionalText(value.unknownVendorReason);
 const unknownDueReason=optionalText(value.unknownDueReason);
 check((vendor===null)===(unknownVendorReason!==null)&&(value.dueOn===null)===(unknownDueReason!==null));
 const seen=new Set<string>();
 let total=0n;
 const splits=value.splits.map((row:unknown)=>{
  check(exact(row,['category','grossCents'])&&typeof row.category==='string'
   &&supplierBillCategories.some(category=>category===row.category)&&positiveCents(row.grossCents)&&!seen.has(row.category));
  seen.add(row.category);
  total+=BigInt(row.grossCents);
  return {category:row.category,grossCents:row.grossCents};
 });
 check(total===BigInt(value.grossCents));
 return {incurredOn:value.incurredOn,dueOn:value.dueOn,unknownDueReason,vendor,unknownVendorReason,
  documentReference:optionalText(value.documentReference,200),grossCents:value.grossCents,purchaseTaxCents:value.purchaseTaxCents,
  purpose:text(value.purpose),missingReceiptReason:text(value.missingReceiptReason),splits,changeReason:optionalText(value.changeReason)};
}
export type SupplierBillDraftPayload=ReturnType<typeof parseSupplierBillDraftPayload>;

export function parseSupplierBillDraftReference(value:unknown){
 check(exact(value,['billId','recoveryEpoch','operationId','expectedRevision'])&&customerUuid(value.billId)
  &&customerUuid(value.recoveryEpoch)&&customerUuid(value.operationId)&&customerVersion(value.expectedRevision,true)
  &&BigInt(value.expectedRevision)<9223372036854775807n);
 return {billId:value.billId,recoveryEpoch:value.recoveryEpoch,operationId:value.operationId,expectedRevision:value.expectedRevision};
}
export type SupplierBillDraftReference=ReturnType<typeof parseSupplierBillDraftReference>;

export function parseSupplierBillDraftRevision(value:unknown,businessId:string){
 check(exact(value,['businessId','billId','revision','operationId','actorId','recordedAt','payload'])
  &&customerUuid(businessId)&&value.businessId===businessId&&customerUuid(value.billId)&&customerVersion(value.revision)
  &&customerUuid(value.operationId)&&customerUuid(value.actorId)&&customerInstant(value.recordedAt));
 const payload=parseSupplierBillDraftPayload(value.payload);
 check((value.revision==='1')===(payload.changeReason===null));
 return {businessId,billId:value.billId,revision:value.revision,operationId:value.operationId,actorId:value.actorId,
  recordedAt:value.recordedAt,payload};
}
export type SupplierBillDraftRevision=ReturnType<typeof parseSupplierBillDraftRevision>;

export function parseSupplierBillDraftResult(value:unknown,businessId:string,reference:SupplierBillDraftReference,payload?:SupplierBillDraftPayload){
 if(exact(value,['state'])&&value.state==='absent'){check(!payload);return {state:'absent'} as const;}
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict',reason:'operation'} as const;
 if(exact(value,['state','reason','currentRevision'])&&value.state==='conflict'&&value.reason==='revision'&&customerVersion(value.currentRevision,true))
  return {state:'conflict',reason:'revision',currentRevision:value.currentRevision} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed'&&exact(value.receipt,['schemaVersion','draft'])
  &&value.receipt.schemaVersion===1);
 const draft=parseSupplierBillDraftRevision(value.receipt.draft,businessId);
 check(draft.billId===reference.billId&&draft.operationId===reference.operationId
  &&draft.revision===String(BigInt(reference.expectedRevision)+1n)
  &&(!payload||JSON.stringify(draft.payload)===JSON.stringify(payload)));
 return {state:'committed',draft} as const;
}

export function parseSupplierBillDraftPage(value:unknown,businessId:string,after:string|null){
 check(exact(value,['schemaVersion','businessId','hasMore','drafts'])&&value.schemaVersion===1&&value.businessId===businessId
  &&typeof value.hasMore==='boolean'&&Array.isArray(value.drafts)&&value.drafts.length<=8&&(!value.hasMore||value.drafts.length===8));
 let prior=after??'';
 const drafts=value.drafts.map(row=>{
  const draft=parseSupplierBillDraftRevision(row,businessId);
  check(draft.billId>prior);prior=draft.billId;
  return draft;
 });
 return {hasMore:value.hasMore,drafts};
}

export function parseSupplierBillDraftReview(value:unknown,billId:string,revision:string){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 if(exact(value,['state','reason','currentRevision'])&&value.state==='conflict'&&value.reason==='revision'&&customerVersion(value.currentRevision))
  return {state:'conflict',currentRevision:value.currentRevision} as const;
 check(exact(value,['schemaVersion','state','billId','revision','vendorUnknown','dueTermsUnknown','purchaseTaxAmountUnknown',
  'missingDocument','sameSupplierDrafts','moreSameSupplierDrafts'])&&value.schemaVersion===1&&value.state==='review_required'
  &&value.billId===billId&&value.revision===revision&&typeof value.vendorUnknown==='boolean'&&typeof value.dueTermsUnknown==='boolean'
  &&typeof value.purchaseTaxAmountUnknown==='boolean'&&value.missingDocument===true&&Array.isArray(value.sameSupplierDrafts)
  &&value.sameSupplierDrafts.length<=50&&typeof value.moreSameSupplierDrafts==='boolean');
 let prior='';
 const candidates=value.sameSupplierDrafts.map((candidate:unknown)=>{
  check(exact(candidate,['billId','revision','sameDocumentReference','sameIncurredDateAndGross'])&&customerUuid(candidate.billId)
   &&candidate.billId!==billId&&candidate.billId>prior&&customerVersion(candidate.revision)
   &&typeof candidate.sameDocumentReference==='boolean'&&typeof candidate.sameIncurredDateAndGross==='boolean'
   &&(candidate.sameDocumentReference||candidate.sameIncurredDateAndGross));
  prior=candidate.billId;
  return {billId:candidate.billId,revision:candidate.revision,sameDocumentReference:candidate.sameDocumentReference,
   sameIncurredDateAndGross:candidate.sameIncurredDateAndGross};
 });
 return {state:'review_required',vendorUnknown:value.vendorUnknown,dueTermsUnknown:value.dueTermsUnknown,
  purchaseTaxUnknown:value.purchaseTaxAmountUnknown,missingDocument:true,candidates,moreCandidates:value.moreSameSupplierDrafts} as const;
}
