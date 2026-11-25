// Shared private-screen boundary. Saving source evidence never posts money.
import {customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {normalizeOpeningFundsEvidence,OpeningFundsEvidenceError} from './opening-funds-contract.ts';
import type {OpeningFundsInput} from './opening-funds-contract.ts';

function check(value:unknown):asserts value{if(!value)throw new OpeningFundsEvidenceError();}
export type OpeningFundsEvidence=ReturnType<typeof normalizeOpeningFundsEvidence>;

export function parseOpeningFundsEvidence(value:unknown):OpeningFundsEvidence{
 check(exact(value,['schemaVersion','cutoverOn','state','posted','currency','reason','totals','roots','refundAuthorized','fullSourceClosureVerified'])
  &&value.schemaVersion===1&&value.state==='evidence_prepared'&&value.posted===false&&value.currency==='USD'
  &&value.refundAuthorized===false&&value.fullSourceClosureVerified===false&&Array.isArray(value.roots)&&value.roots.length<=200
  &&typeof value.cutoverOn==='string');
 const originalRoots=value.roots;
 const roots=originalRoots.map((root:unknown)=>{
  check(exact(root,['rootId','sourceNamespace','externalId','receivedOn','receivedCents','receiptEvidence','reductions','items','heldCents','openingRootCents','refundableCeilingCents'])&&Array.isArray(root.items)&&root.items.length<=200);
  const {heldCents,openingRootCents,refundableCeilingCents,items,...input}=root;
  void heldCents;void openingRootCents;void refundableCeilingCents;
  return {...input,items:items.map((item:unknown)=>{
   check(exact(item,['itemId','customerId','heldCents','obligationEvidence','refundableCeilingCents','refundEvidence','refundCeilingState']));
   check(item.refundCeilingState===(item.refundableCeilingCents===null?'needs_review':'evidenced'));
   const {refundCeilingState,...raw}=item;void refundCeilingState;return raw;
  })};
 });
 const evidence=normalizeOpeningFundsEvidence({schemaVersion:1,reason:value.reason,roots},value.cutoverOn);
 check(exact(value.totals,['heldCents','refundableCeilingCents','rootCount','itemCount','allItemRefundCeilingsKnown']));
 for(const key of ['heldCents','refundableCeilingCents','rootCount','itemCount','allItemRefundCeilingsKnown'] as const)check(value.totals[key]===evidence.totals[key]);
 evidence.roots.forEach((root,index)=>{
  const original=originalRoots[index] as Record<string,unknown>;
  check(original.heldCents===root.heldCents&&original.openingRootCents===root.openingRootCents&&original.refundableCeilingCents===root.refundableCeilingCents);
 });
 return evidence;
}

export function parseOpeningFundsSave(value:unknown,cutoverOn:string){
 check(exact(value,['worksheetRevision','expectedRevision','input'])&&customerVersion(value.worksheetRevision)
  &&customerVersion(value.expectedRevision,true)&&BigInt(value.expectedRevision)<9223372036854775807n);
 normalizeOpeningFundsEvidence(value.input,cutoverOn);
 // Copy only after full validation; caller changes cannot alter the save payload.
 return {worksheetRevision:value.worksheetRevision,expectedRevision:value.expectedRevision,input:structuredClone(value.input) as OpeningFundsInput};
}

function receipt(value:unknown,businessId:string,worksheetRevisionId?:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','scheduleRevisionId','worksheetRevisionId','revision','operationId','auditEventId','recordedBy','recordedAt','evidenceSha256','evidence'])
  &&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.scheduleRevisionId)&&customerUuid(value.worksheetRevisionId)
  &&(worksheetRevisionId===undefined||value.worksheetRevisionId===worksheetRevisionId)&&customerVersion(value.revision)
  &&customerUuid(value.operationId)&&customerUuid(value.auditEventId)&&customerUuid(value.recordedBy)&&customerInstant(value.recordedAt)
  &&typeof value.evidenceSha256==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceSha256));
 const evidence=parseOpeningFundsEvidence(value.evidence);
 return {schemaVersion:1 as const,businessId,scheduleRevisionId:value.scheduleRevisionId,worksheetRevisionId:value.worksheetRevisionId,
  revision:value.revision,operationId:value.operationId,auditEventId:value.auditEventId,recordedBy:value.recordedBy,
  recordedAt:value.recordedAt,evidenceSha256:value.evidenceSha256,evidence};
}
export type OpeningFundsReceipt=ReturnType<typeof receipt>;

export function openingFundsDraftFromEvidence(value:unknown):OpeningFundsInput{
 const evidence=parseOpeningFundsEvidence(value);
 return {schemaVersion:1,reason:evidence.reason,roots:evidence.roots.map(root=>({
  rootId:root.rootId,sourceNamespace:root.sourceNamespace,externalId:root.externalId,receivedOn:root.receivedOn,
  receivedCents:root.receivedCents,receiptEvidence:structuredClone(root.receiptEvidence),reductions:structuredClone(root.reductions),
  items:root.items.map(item=>({itemId:item.itemId,customerId:item.customerId,heldCents:item.heldCents,
   obligationEvidence:structuredClone(item.obligationEvidence),refundableCeilingCents:item.refundableCeilingCents,refundEvidence:structuredClone(item.refundEvidence)})),
 }))};
}

export function parseOpeningFundsStored(value:unknown,businessId:string){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','worksheetRevisionId','schedule'])
  &&value.schemaVersion===1&&value.businessId===businessId&&customerUuid(value.worksheetRevisionId));
 return {worksheetRevisionId:value.worksheetRevisionId,schedule:value.schedule===null?null:receipt(value.schedule,businessId,value.worksheetRevisionId)};
}

export function parseOpeningFundsOperation(value:unknown,businessId:string,operationId:string){
 check(customerUuid(businessId)&&customerUuid(operationId));
 if(exact(value,['state'])&&(value.state==='absent'||value.state==='review_required'||value.state==='retired'))return {state:value.state} as const;
 if(exact(value,['state','reason'])&&value.state==='conflict'&&value.reason==='operation')return {state:'conflict'} as const;
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const stored=receipt(value.receipt,businessId);check(stored.operationId===operationId);
 return {state:'committed',receipt:stored} as const;
}
