// Correlate an exact committed original with opaque pending identity. This is
// not authorization, current-state eligibility or financial posting approval.
import {quoteId,quoteVersion,quoteResponseLimit} from './quote-storage-contract.ts';
import {quoteReviewHash} from './quote-review-contract.ts';
import {QuoteAmendmentContractError} from './quote-amendment-contract.ts';
import {parseQuoteAmendmentAccept,parseQuoteAmendmentAcceptReference,quoteAmendmentAcceptReference} from './quote-amendment-acceptance-contract.ts';
import type {QuoteAmendmentAccept,QuoteAmendmentAcceptReference} from './quote-amendment-acceptance-contract.ts';

export type QuoteAmendmentAcceptReceipt=Readonly<{
 schemaVersion:1;action:'amendment_accept';businessId:string;familyId:string;familyVersion:string;
 revisionId:string;revisionVersion:string;contentVersion:string;contentHash:string;
 parentAgreementId:string;parentAgreementVersion:string;parentAcceptedHash:string;
 acceptanceId:string;agreementId:string;agreementVersion:string;customerId:string;approvalId:string;sendId:string;
 commercialStateVersion:string;familyAuditEventId:string;revisionAuditEventId:string;commercialStateAuditEventId:string;
 acceptanceAuditEventId:string;agreementAuditEventId:string;newEntitlementIds:readonly string[];
 entitlementVersionIds:readonly string[];newAllocationIds:readonly string[];allocationPlanIds:readonly string[];
 allocationPartIds:readonly string[];auditEventIds:readonly string[];
}>;
export type QuoteAmendmentAcceptCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:QuoteAmendmentAcceptReceipt}>;
const receiptKeys=['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','parentAgreementId','parentAgreementVersion','parentAcceptedHash','acceptanceId','agreementId','agreementVersion','customerId','approvalId','sendId','commercialStateVersion','familyAuditEventId','revisionAuditEventId','commercialStateAuditEventId','acceptanceAuditEventId','agreementAuditEventId','newEntitlementIds','entitlementVersionIds','newAllocationIds','allocationPlanIds','allocationPartIds','auditEventIds'] as const;
function check(value:unknown):asserts value{if(!value)throw new QuoteAmendmentContractError();}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
function ids(value:unknown,maximum:number):readonly string[]{
 check(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype);const descriptors=Object.getOwnPropertyDescriptors(value),length=Object.getOwnPropertyDescriptor(value,'length')?.value;
 check(Number.isSafeInteger(length)&&length>=0&&length<=maximum&&Reflect.ownKeys(descriptors).length===length+1);
 const result:string[]=[];for(let i=0;i<length;i++){const d=descriptors[String(i)];check(d&&d.enumerable&&Object.hasOwn(d,'value')&&quoteId(d.value));result.push(d.value);}
 check(new Set(result).size===result.length);return Object.freeze(result);
}
function sameIds(actual:readonly string[],expected:readonly string[]):boolean{return actual.length===expected.length&&actual.every((id,index)=>id===expected[index]);}

/** Historical originals remain valid after later agreements. Read current
 * authorized state separately before enabling another commercial action.
 * A command caller must still await database COMMIT before reporting saved. */
export function bindQuoteAmendmentAcceptReceipt(value:unknown,businessId:string,pending:QuoteAmendmentAcceptReference,expectedRequest?:QuoteAmendmentAccept):QuoteAmendmentAcceptCommitted{
 try{
  const p=parseQuoteAmendmentAcceptReference(pending),outer=record(value,['state','operationId','recoveryEpoch','receipt']),r=record(outer.receipt,receiptKeys);
  check(quoteId(businessId)&&outer.state==='committed'&&outer.operationId===p.operationId&&outer.recoveryEpoch===p.recoveryEpoch);
  check(r.schemaVersion===1&&r.action==='amendment_accept'&&r.businessId===businessId&&r.familyId===p.familyId&&r.revisionId===p.revisionId&&r.familyVersion===(BigInt(p.expectedFamilyVersion)+1n).toString()&&r.revisionVersion===(BigInt(p.expectedRevisionVersion)+1n).toString()&&r.contentVersion===p.expectedContentVersion&&quoteReviewHash(r.contentHash)&&r.parentAgreementId===p.expectedParentAgreementId&&r.parentAgreementVersion===p.expectedParentAgreementVersion&&quoteReviewHash(r.parentAcceptedHash)&&r.acceptanceId===p.acceptanceId&&r.agreementId===p.agreementId&&r.agreementVersion===(BigInt(p.expectedParentAgreementVersion)+1n).toString()&&r.customerId===p.customerId&&r.sendId===p.sendId&&quoteId(r.approvalId)&&quoteVersion(r.commercialStateVersion));
  const newEntitlementIds=ids(r.newEntitlementIds,1000),entitlementVersionIds=ids(r.entitlementVersionIds,1000),newAllocationIds=ids(r.newAllocationIds,1000),allocationPlanIds=ids(r.allocationPlanIds,1000),allocationPartIds=ids(r.allocationPartIds,10000),auditEventIds=ids(r.auditEventIds,14005);
  check(entitlementVersionIds.length>0&&allocationPlanIds.length===entitlementVersionIds.length&&newEntitlementIds.length===newAllocationIds.length&&newEntitlementIds.length<=entitlementVersionIds.length&&auditEventIds.length===5+2*allocationPlanIds.length+allocationPartIds.length+2*newEntitlementIds.length);
  const namedAudits=[r.familyAuditEventId,r.revisionAuditEventId,r.commercialStateAuditEventId,r.acceptanceAuditEventId,r.agreementAuditEventId];check(namedAudits.every(quoteId)&&new Set(namedAudits).size===5&&namedAudits.every(id=>auditEventIds.includes(id as string)));
  if(expectedRequest!==undefined){
   const q=parseQuoteAmendmentAccept(expectedRequest),reference=quoteAmendmentAcceptReference(q);check(q.businessId===businessId&&(Object.keys(p) as (keyof QuoteAmendmentAcceptReference)[]).every(key=>p[key]===reference[key])&&r.contentHash===q.expectedHash&&r.parentAcceptedHash===q.expectedParentAcceptedHash);
   const created=q.scopePlans.filter(plan=>plan.expectedEntitlementVersionId===null);check(sameIds(entitlementVersionIds,q.scopePlans.map(plan=>plan.entitlementVersionId))&&sameIds(newEntitlementIds,created.map(plan=>plan.entitlementId))&&sameIds(newAllocationIds,created.map(plan=>plan.sourceAllocationId))&&allocationPlanIds.length===q.scopePlans.length&&allocationPartIds.length===q.scopePlans.reduce((count,plan)=>count+plan.parts.length,0));
  }
  const receipt=Object.freeze({...r,newEntitlementIds,entitlementVersionIds,newAllocationIds,allocationPlanIds,allocationPartIds,auditEventIds}) as QuoteAmendmentAcceptReceipt;
  const result=Object.freeze({state:'committed' as const,operationId:p.operationId,recoveryEpoch:p.recoveryEpoch,receipt});check(new TextEncoder().encode(JSON.stringify(result)).length<=quoteResponseLimit);return result;
 }catch{throw new QuoteAmendmentContractError();}
}

const conflictReasons=['operation','family','revision','version','parent','offer','send','approval','expired','confirmation','scope','allocation','assigned_scope','identity'] as const;
export type QuoteAmendmentAcceptConflict=Readonly<{state:'conflict';reason:typeof conflictReasons[number]}>;
export function parseQuoteAmendmentAcceptConflict(value:unknown):QuoteAmendmentAcceptConflict{
 try{const row=record(value,['state','reason']);check(row.state==='conflict'&&typeof row.reason==='string'&&(conflictReasons as readonly string[]).includes(row.reason));return Object.freeze(row) as QuoteAmendmentAcceptConflict;}
 catch{throw new QuoteAmendmentContractError();}
}
