import {customerUuid,customerVersion,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyAfterRow} from './legacy-contact-batch-contract.ts';

const fingerprintPattern=/^[a-f0-9]{64}$/;
export const legacySourceNamespacePattern='[a-z][a-z0-9_\\-]{1,63}';
const namespacePattern=new RegExp('^'+legacySourceNamespacePattern+'$(?![\\s\\S])');
const choiceKeys=['customerAction','customerId','customerVersion','vehicleAction','vehicleId','vehicleVersion'];

function choice(value:Record<string,unknown>){
 const {customerAction,customerId,customerVersion:contactVersion,vehicleAction,vehicleId,vehicleVersion}=value;
 check(customerAction==='create'||customerAction==='link'||customerAction==='skip');
 check(vehicleAction==='create'||vehicleAction==='link'||vehicleAction==='skip'||vehicleAction==='none');
 check(customerAction==='link'?customerUuid(customerId)&&customerVersion(contactVersion):customerId===null&&contactVersion===null);
 check(vehicleAction==='link'?customerUuid(vehicleId)&&customerVersion(vehicleVersion):vehicleId===null&&vehicleVersion===null);
 check(customerAction!=='skip'||vehicleAction==='none');
 return {customerAction,customerId:customerId as string|null,customerVersion:contactVersion as string|null,
  vehicleAction,vehicleId:vehicleId as string|null,vehicleVersion:vehicleVersion as string|null} as const;
}

export function parseLegacyDecisionReference(value:unknown){
 check(exact(value,['batchId','row'])&&customerUuid(value.batchId)&&legacyAfterRow(value.row)&&value.row>=2);
 return {batchId:value.batchId,row:value.row};
}
type Reference=ReturnType<typeof parseLegacyDecisionReference>;

export function parseLegacyDecisionSave(value:unknown){
 check(exact(value,['batchId','row','sourceNamespace','fingerprint','expectedRevision','operationId','recoveryEpoch',...choiceKeys]));
 const reference=parseLegacyDecisionReference({batchId:value.batchId,row:value.row});
 const {sourceNamespace,fingerprint,expectedRevision,operationId,recoveryEpoch}=value;
 check(typeof sourceNamespace==='string'&&namespacePattern.test(sourceNamespace)&&typeof fingerprint==='string'&&fingerprintPattern.test(fingerprint)&&
  typeof expectedRevision==='number'&&Number.isInteger(expectedRevision)&&expectedRevision>=0&&expectedRevision<=2147483646&&
  customerUuid(operationId)&&customerUuid(recoveryEpoch));
 return {...reference,sourceNamespace,fingerprint,expectedRevision,operationId,recoveryEpoch,...choice(value)};
}

export function legacyDecisionReceipt(value:unknown,businessId:string,reference:Reference){
 check(exact(value,['schemaVersion','decisionId','businessId','batchId','row','fingerprint','sourceNamespace','revision','operationId',...choiceKeys])&&
  value.schemaVersion===1&&customerUuid(value.decisionId)&&value.businessId===businessId&&value.batchId===reference.batchId&&value.row===reference.row&&
  typeof value.fingerprint==='string'&&fingerprintPattern.test(value.fingerprint)&&typeof value.sourceNamespace==='string'&&namespacePattern.test(value.sourceNamespace)&&
  typeof value.revision==='number'&&Number.isInteger(value.revision)&&value.revision>=1&&value.revision<=2147483647&&customerUuid(value.operationId));
 return {batchId:reference.batchId,row:reference.row,schemaVersion:1 as const,decisionId:value.decisionId,businessId,fingerprint:value.fingerprint,sourceNamespace:value.sourceNamespace,
  revision:value.revision,operationId:value.operationId,...choice(value)};
}

export function legacyDecisionState(value:unknown,businessId:string,reference:Reference){
 check(exact(value,['state','businessId','batchId','row','fingerprint','sourceNamespace','decision'])&&value.state==='present'&&
  value.businessId===businessId&&value.batchId===reference.batchId&&value.row===reference.row&&
  typeof value.fingerprint==='string'&&fingerprintPattern.test(value.fingerprint)&&
  (value.sourceNamespace===null||typeof value.sourceNamespace==='string'&&namespacePattern.test(value.sourceNamespace)));
 const decision=value.decision===null?null:legacyDecisionReceipt(value.decision,businessId,reference);
 check(!decision||decision.fingerprint===value.fingerprint&&decision.sourceNamespace===value.sourceNamespace);
 return {state:'present' as const,businessId,batchId:reference.batchId,row:reference.row,fingerprint:value.fingerprint,sourceNamespace:value.sourceNamespace,decision};
}

export function legacyDecisionOutcome(value:unknown,businessId:string,request:ReturnType<typeof parseLegacyDecisionSave>){
 if(exact(value,['state','reason'])&&value.state==='conflict'){
  check(value.reason==='operation'||value.reason==='row'||value.reason==='source'||value.reason==='target');
  return {state:'conflict',reason:value.reason} as const;
 }
 if(exact(value,['state','reason','currentRevision'])&&value.state==='conflict'){
  check(value.reason==='revision'&&(value.currentRevision===null||typeof value.currentRevision==='number'&&
   Number.isInteger(value.currentRevision)&&value.currentRevision>=1&&value.currentRevision<=2147483647));
  return {state:'conflict' as const,reason:'revision' as const,currentRevision:value.currentRevision};
 }
 check(exact(value,['state','receipt'])&&value.state==='committed');
 const receipt=legacyDecisionReceipt(value.receipt,businessId,request);
 check(receipt.operationId===request.operationId&&receipt.revision===request.expectedRevision+1&&receipt.sourceNamespace===request.sourceNamespace&&
  receipt.fingerprint===request.fingerprint&&choiceKeys.every(key=>receipt[key as keyof typeof receipt]===request[key as keyof typeof request]));
 return {state:'committed' as const,receipt};
}
