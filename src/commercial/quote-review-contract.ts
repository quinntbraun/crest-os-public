import {exactCustomerObject as exact,customerInstant} from '../customer/customer-contract.ts';
import {quoteId,quoteVersion} from './quote-storage-contract.ts';
import {prepareQuoteReviewContent} from './quote-review-content.ts';

export class QuoteReviewContractError extends Error{constructor(){super('QUOTE_REVIEW_DATA_INVALID');this.name='QuoteReviewContractError';}}
export function requireQuoteReview(value:unknown):asserts value{if(!value)throw new QuoteReviewContractError();}
const check:(value:unknown)=>asserts value=requireQuoteReview;
export const quoteReviewHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export type QuoteReviewSubmit=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;familyId:string;revisionId:string;expectedFamilyVersion:string;expectedRevisionVersion:string;expectedContentVersion:string;expectedHash:string}>;
export type QuoteReviewApprove=QuoteReviewSubmit&Readonly<{approvalId:string;extremeAcknowledged:boolean}>;
export type QuoteReviewAction='submit'|'approve';
export type QuoteReviewReceipt=Readonly<{schemaVersion:1;action:QuoteReviewAction;businessId:string;familyId:string;familyVersion:string;revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;familyAuditEventId:string;revisionAuditEventId:string;approvalId:string|null;approvalAuditEventId:string|null;presentationHash:string|null}>;
export type QuoteReviewCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:QuoteReviewReceipt}>;
const requestKeys=['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash'] as const;
function request(value:Record<string,unknown>){check(value.schemaVersion===1&&quoteId(value.businessId)&&quoteId(value.operationId)&&quoteId(value.recoveryEpoch)&&quoteId(value.familyId)&&quoteId(value.revisionId)&&quoteVersion(value.expectedFamilyVersion)&&quoteVersion(value.expectedRevisionVersion)&&quoteVersion(value.expectedContentVersion)&&BigInt(value.expectedContentVersion)<=BigInt(value.expectedRevisionVersion)&&quoteReviewHash(value.expectedHash));}
export function parseQuoteReviewSubmit(value:unknown):QuoteReviewSubmit{check(exact(value,requestKeys));request(value);return Object.freeze({...value}) as QuoteReviewSubmit;}
export function parseQuoteReviewApprove(value:unknown):QuoteReviewApprove{check(exact(value,[...requestKeys,'approvalId','extremeAcknowledged']));request(value);check(quoteId(value.approvalId)&&typeof value.extremeAcknowledged==='boolean');return Object.freeze({...value}) as QuoteReviewApprove;}
export function parseQuoteReviewCommitted(value:unknown,businessId:string,operationId:string):QuoteReviewCommitted{
 check(quoteId(businessId)&&quoteId(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&quoteId(value.recoveryEpoch));
 const r=value.receipt;check(exact(r,['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','approvalId','approvalAuditEventId','presentationHash'])&&r.schemaVersion===1&&(r.action==='submit'||r.action==='approve')&&r.businessId===businessId&&quoteId(r.familyId)&&quoteVersion(r.familyVersion)&&quoteId(r.revisionId)&&quoteVersion(r.revisionVersion)&&quoteVersion(r.contentVersion)&&BigInt(r.contentVersion)<=BigInt(r.revisionVersion)&&quoteReviewHash(r.contentHash)&&quoteId(r.familyAuditEventId)&&quoteId(r.revisionAuditEventId)&&r.familyAuditEventId!==r.revisionAuditEventId);
 check(r.action==='submit'?r.approvalId===null&&r.approvalAuditEventId===null&&r.presentationHash===null:quoteId(r.approvalId)&&quoteId(r.approvalAuditEventId)&&r.approvalAuditEventId!==r.familyAuditEventId&&r.approvalAuditEventId!==r.revisionAuditEventId&&quoteReviewHash(r.presentationHash));
 return Object.freeze({state:'committed',operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r}) as QuoteReviewReceipt});
}
type Customer=ReturnType<typeof prepareQuoteReviewContent>['customer'];
export type QuoteReviewApproval=Readonly<{id:string;contentVersion:string;contentHash:string;actorId:string;reviewedAt:string;extremeAcknowledged:boolean;templateVersion:'crest.quote.review.v2';customerRepresentation:Customer;presentationText:string;presentationHash:string;operationId:string;auditEventId:string}>;
export type QuoteReviewState=Readonly<{schemaVersion:1;businessId:string;familyId:string;revisionId:string;familyVersion:string;revisionVersion:string;contentVersion:string;contentHash:string;state:'Draft'|'Ready for Review';approval:QuoteReviewApproval|null}>;
const customerKeys=['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents'] as const;
const lineKeys=['description','inclusions','exclusions','vehicle','condition','category','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'] as const;
function same(a:unknown,b:unknown):boolean{
 if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>same(value,b[index]));
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
function customer(value:unknown):Customer{
 check(exact(value,customerKeys)&&value.schemaVersion===2&&value.currency==='USD'&&exact(value.recipient,['displayName','phone','email'])&&Array.isArray(value.lines)&&value.lines.length>0&&value.lines.length<=1000);
 // Validation-only positions supply unique local pricing keys. They never
 // enter the returned customer projection or claim stored source identities.
 const uuid='00000000-0000-0000-0000-000000000000',recipient=value.recipient;
 const lines=value.lines.map((line,index)=>{check(exact(line,lineKeys)&&(line.vehicle===null?line.condition===null:line.condition!==null&&line.category!==null));return {id:'00000000-0000-0000-0000-'+String(index+1).padStart(12,'0'),vehicleId:line.vehicle===null?null:uuid,jobWide:line.vehicle===null,vehicleLabel:line.vehicle,serviceVersionId:null,description:line.description,inclusions:line.inclusions,exclusions:line.exclusions,condition:line.condition,category:line.category,assessment:null,categoryOverrideNote:null,grossCents:line.grossCents,lineDiscount:line.lineDiscount,documentDiscountEligible:line.documentDiscountEligible,complimentaryReason:line.complimentaryReason};});
 try{const p=prepareQuoteReviewContent({schemaVersion:2,title:value.title,recipient:{customerId:uuid,leadId:null,displayName:recipient.displayName,phone:recipient.phone,email:recipient.email},workLocation:value.workLocation,terms:value.terms,timezone:value.timezone,expiryAt:value.expiryAt,proposedSchedule:value.proposedSchedule,internalNotes:null,documentDiscount:value.documentDiscount,lines});check(same(p.customer,value));return p.customer;}
 catch{throw new QuoteReviewContractError();}
}
export function parseQuoteReviewRead(value:unknown,scope:Readonly<{businessId:string;familyId:string;revisionId:string}>):QuoteReviewState|Readonly<{state:'absent'}>{
 check(exact(scope,['businessId','familyId','revisionId'])&&quoteId(scope.businessId)&&quoteId(scope.familyId)&&quoteId(scope.revisionId));
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent'});
 check(exact(value,['schemaVersion','businessId','familyId','revisionId','familyVersion','revisionVersion','contentVersion','contentHash','state','approval'])&&value.schemaVersion===1&&value.businessId===scope.businessId&&value.familyId===scope.familyId&&value.revisionId===scope.revisionId&&quoteVersion(value.familyVersion)&&quoteVersion(value.revisionVersion)&&quoteVersion(value.contentVersion)&&BigInt(value.contentVersion)<=BigInt(value.revisionVersion)&&quoteReviewHash(value.contentHash)&&(value.state==='Draft'||value.state==='Ready for Review'));
 let approval:QuoteReviewApproval|null=null;
 if(value.approval!==null){
  const a=value.approval;check(value.state==='Ready for Review'&&exact(a,['id','contentVersion','contentHash','actorId','reviewedAt','extremeAcknowledged','templateVersion','customerRepresentation','presentationText','presentationHash','operationId','auditEventId'])&&quoteId(a.id)&&a.contentVersion===value.contentVersion&&a.contentHash===value.contentHash&&quoteId(a.actorId)&&customerInstant(a.reviewedAt)&&a.reviewedAt.length===27&&typeof a.extremeAcknowledged==='boolean'&&a.templateVersion==='crest.quote.review.v2'&&typeof a.presentationText==='string'&&quoteReviewHash(a.presentationHash)&&quoteId(a.operationId)&&quoteId(a.auditEventId));
  const publicValue=customer(a.customerRepresentation),prefix='crest.quote.review.v2\n'+value.contentHash+'\n';check((!publicValue.lines.some(line=>line.condition==='Extreme')||a.extremeAcknowledged===true)&&a.presentationText.startsWith(prefix));const text=a.presentationText.slice(prefix.length);let embedded:unknown;try{embedded=JSON.parse(text);}catch{throw new QuoteReviewContractError();}const nodes:unknown[]=[embedded];let fields=0;while(nodes.length){const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
  check((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===fields&&same(publicValue,embedded));
  approval=Object.freeze({...a,customerRepresentation:publicValue}) as QuoteReviewApproval;
 }
 return Object.freeze({schemaVersion:1,businessId:scope.businessId,familyId:scope.familyId,revisionId:scope.revisionId,familyVersion:value.familyVersion,revisionVersion:value.revisionVersion,contentVersion:value.contentVersion,contentHash:value.contentHash,state:value.state,approval});
}
