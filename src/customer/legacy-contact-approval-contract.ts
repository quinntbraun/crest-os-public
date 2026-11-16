import {customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacySourceNamespacePattern} from './legacy-contact-decision-contract.ts';

const digest=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]+$/.test(value);
const namespace=new RegExp('^'+legacySourceNamespacePattern+'$(?![\\s\\S])');
const sourceKey=(value:unknown):value is string=>typeof value==='string'&&namespace.test(value);
const count=(value:unknown,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const pins=['originalSha256','mappingSha256','rowsSha256','decisionsSha256','evidenceSha256'] as const;

export function parseLegacyApprovalReference(value:unknown){
 check(exact(value,['batchId'])&&customerUuid(value.batchId));
 return {batchId:value.batchId};
}
export function parseLegacyApprovalRequest(value:unknown){
 check(exact(value,['batchId','evidenceSha256','operationId','recoveryEpoch'])&&customerUuid(value.batchId)&&
  digest(value.evidenceSha256)&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch));
 return {batchId:value.batchId,evidenceSha256:value.evidenceSha256,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch};
}

function binding(value:Record<string,unknown>,businessId:string,batchId:string){
 check(value.schemaVersion===1&&value.businessId===businessId&&value.batchId===batchId&&
  count(value.rowCount,100000)&&value.rowCount>0&&count(value.skippedRows,value.rowCount));
 const {originalSha256,mappingSha256,rowsSha256,decisionsSha256,evidenceSha256}=value;
 check(digest(originalSha256)&&digest(mappingSha256)&&digest(rowsSha256)&&digest(decisionsSha256)&&digest(evidenceSha256));
 return {schemaVersion:1 as const,businessId,batchId,rowCount:value.rowCount,skippedRows:value.skippedRows,
  originalSha256,mappingSha256,rowsSha256,decisionsSha256,evidenceSha256};
}

export function legacyApprovalReceipt(value:unknown,businessId:string,batchId:string){
 check(exact(value,['schemaVersion','approvalId','businessId','batchId','sourceNamespace','rowCount','skippedRows','operationId','approvedBy',...pins])&&
  customerUuid(value.approvalId)&&customerUuid(value.operationId)&&customerUuid(value.approvedBy)&&sourceKey(value.sourceNamespace));
 return {...binding(value,businessId,batchId),approvalId:value.approvalId,operationId:value.operationId,
  approvedBy:value.approvedBy,sourceNamespace:value.sourceNamespace};
}

export function legacyApprovalEvidence(value:unknown,businessId:string,batchId:string){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent' as const};
 check(exact(value,['state','schemaVersion','businessId','batchId','sourceNamespace','rowCount','skippedRows','undecidedRows',
  'staleRows','conflictingGroups','customerCreates','customerLinks','vehicleCreates','vehicleLinks','approval',...pins])&&
  (value.state==='ready'||value.state==='blocked')&&(value.sourceNamespace===null||sourceKey(value.sourceNamespace)));
 const pinned=binding(value,businessId,batchId),{rowCount,skippedRows}=pinned;
 const {undecidedRows,staleRows,conflictingGroups,customerCreates,customerLinks,vehicleCreates,vehicleLinks}=value;
 check(count(undecidedRows,rowCount-skippedRows));
 const actionable=rowCount-undecidedRows-skippedRows;
 check(count(staleRows,actionable)&&count(conflictingGroups,2*actionable)&&count(customerCreates,actionable)&&
  count(customerLinks,actionable-customerCreates)&&count(vehicleCreates,actionable)&&count(vehicleLinks,actionable-vehicleCreates));
 const ready=undecidedRows===0&&staleRows===0&&conflictingGroups===0;
 check(ready===(value.state==='ready')&&(value.sourceNamespace!==null||undecidedRows===rowCount));
 const approval=value.approval===null?null:legacyApprovalReceipt(value.approval,businessId,batchId);
 check(!approval||ready&&approval.sourceNamespace===value.sourceNamespace&&approval.rowCount===rowCount&&
  approval.skippedRows===skippedRows&&pins.every(key=>approval[key]===pinned[key]));
 return {state:value.state,...pinned,sourceNamespace:value.sourceNamespace,undecidedRows,staleRows,conflictingGroups,
  customerCreates,customerLinks,vehicleCreates,vehicleLinks,approval} as const;
}

export function legacyApprovalOutcome(value:unknown,businessId:string,request:ReturnType<typeof parseLegacyApprovalRequest>){
 if(exact(value,['state','reason'])&&value.state==='conflict'){
  check(value.reason==='operation'||value.reason==='evidence'||value.reason==='not_ready');
  return {state:'conflict',reason:value.reason} as const;
 }
 check(exact(value,['state','receipt'])&&(value.state==='committed'||value.state==='already_approved'));
 const receipt=legacyApprovalReceipt(value.receipt,businessId,request.batchId);
 check(receipt.evidenceSha256===request.evidenceSha256&&(value.state==='already_approved'||receipt.operationId===request.operationId));
 return {state:value.state,receipt} as const;
}
