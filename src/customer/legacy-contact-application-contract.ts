import {customerDisplayName,customerUuid,customerVersion,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {legacyAfterRow} from './legacy-contact-batch-contract.ts';
import {legacySourceNamespacePattern} from './legacy-contact-decision-contract.ts';
import type {parseLegacyApprovalRequest} from './legacy-contact-approval-contract.ts';

const pageSize=25;
const digest=(value:unknown):value is string=>typeof value==='string'&&value.length===64&&/^[a-f0-9]+$/.test(value);
const namespacePattern=new RegExp('^'+legacySourceNamespacePattern+'$(?![\\s\\S])');
export const legacyIdentitySourceKey=(value:unknown):value is string=>typeof value==='string'&&namespacePattern.test(value);
const count=(value:unknown,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;

export function parseLegacyApplicationPage(value:unknown){
 check(exact(value,['batchId','afterRow'])&&customerUuid(value.batchId)&&legacyAfterRow(value.afterRow));
 return {batchId:value.batchId,afterRow:value.afterRow};
}
export function parseLegacyIdentityReference(value:unknown){
 check(exact(value,['batchId','row','sourceNamespace','kind'])&&customerUuid(value.batchId)&&legacyAfterRow(value.row)&&value.row>=2&&
  legacyIdentitySourceKey(value.sourceNamespace)&&(value.kind==='customer'||value.kind==='vehicle'));
 return {batchId:value.batchId,row:value.row,sourceNamespace:value.sourceNamespace,kind:value.kind} as const;
}

export function legacyIdentityResult(value:unknown,businessId:string,request:ReturnType<typeof parseLegacyIdentityReference>){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 check(exact(value,['state','schemaVersion','businessId','batchId','row','sourceNamespace','kind','fingerprint','target'])&&
  value.state==='present'&&value.schemaVersion===1&&value.businessId===businessId&&value.batchId===request.batchId&&
  value.row===request.row&&value.sourceNamespace===request.sourceNamespace&&value.kind===request.kind&&digest(value.fingerprint));
 let target=null;
 if(value.target!==null){
  const record=value.target;
  check(exact(record,['id','version','label','archived','recordType'])&&customerUuid(record.id)&&customerVersion(record.version)&&
   customerDisplayName(record.label)&&typeof record.archived==='boolean'&&typeof record.recordType==='string'&&
   (request.kind==='customer'?record.recordType==='customer':
    record.recordType==='customer_vehicle'||record.recordType==='business_rig'||record.recordType==='other'));
  target={id:record.id,version:record.version,label:record.label,archived:record.archived,recordType:record.recordType};
 }
 return {state:'present',fingerprint:value.fingerprint,businessId,schemaVersion:1,...request,target} as const;
}

export function legacyApplyRequestStatus(value:unknown){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 check(exact(value,['state','operationId'])&&customerUuid(value.operationId)&&
  (value.state==='queued'||value.state==='committed'||value.state==='already_applied'||value.state==='approval'||
   value.state==='applied'||value.state==='operation'||value.state==='authority'||value.state==='review'));
 return {state:value.state,operationId:value.operationId} as const;
}

export function legacyApplyAdmission(value:unknown){
 if(exact(value,['state','reason'])&&value.state==='conflict'){
  check(value.reason==='approval'||value.reason==='operation');
  return {state:'conflict',reason:value.reason} as const;
 }
 const status=legacyApplyRequestStatus(value);
 check(status.state!=='absent');
 return status;
}

type ApplyRequest=ReturnType<typeof parseLegacyApprovalRequest>;
export function legacyApplicationReceipt(value:unknown,businessId:string,batchId:string){
 check(exact(value,['schemaVersion','businessId','batchId','approvalId','evidenceSha256','sourceNamespace','operationId',
  'rowCount','skippedRows','customersCreated','vehiclesCreated','rowsWithVehiclePair'])&&
  value.schemaVersion===1&&value.businessId===businessId&&value.batchId===batchId&&customerUuid(value.approvalId)&&
  digest(value.evidenceSha256)&&legacyIdentitySourceKey(value.sourceNamespace)&&customerUuid(value.operationId)&&
  count(value.rowCount,100000)&&value.rowCount>0&&count(value.skippedRows,value.rowCount));
 const eligible=value.rowCount-value.skippedRows;
 check(count(value.rowsWithVehiclePair,eligible)&&count(value.customersCreated,eligible)&&count(value.vehiclesCreated,value.rowsWithVehiclePair));
 return {schemaVersion:1,businessId,batchId,approvalId:value.approvalId,evidenceSha256:value.evidenceSha256,
  sourceNamespace:value.sourceNamespace,operationId:value.operationId,rowCount:value.rowCount,skippedRows:value.skippedRows,
  customersCreated:value.customersCreated,vehiclesCreated:value.vehiclesCreated,rowsWithVehiclePair:value.rowsWithVehiclePair} as const;
}

export function legacyApplicationOutcome(value:unknown,businessId:string,request:ApplyRequest){
 if(exact(value,['state','reason'])&&value.state==='conflict'){
  check(value.reason==='operation'||value.reason==='approval'||value.reason==='applied');
  return {state:'conflict',reason:value.reason} as const;
 }
 check(exact(value,['state','receipt'])&&(value.state==='committed'||value.state==='already_applied'));
 const result=legacyApplicationReceipt(value.receipt,businessId,request.batchId);
 check(result.evidenceSha256===request.evidenceSha256&&(value.state==='already_applied'||result.operationId===request.operationId));
 return {state:value.state,receipt:result} as const;
}

export function legacyApplicationPage(value:unknown,businessId:string,request:ReturnType<typeof parseLegacyApplicationPage>){
 if(exact(value,['state'])&&value.state==='absent')return {state:'absent'} as const;
 check(exact(value,['state','receipt','rows','hasMore'])&&value.state==='present'&&Array.isArray(value.rows)&&typeof value.hasMore==='boolean');
 const stored=legacyApplicationReceipt(value.receipt,businessId,request.batchId),remaining=Math.max(0,stored.rowCount+1-request.afterRow);
 check(value.rows.length===Math.min(pageSize,remaining)&&value.hasMore===(remaining>pageSize));
 const rows=value.rows.map((row,index)=>legacyApplicationRow(row,request.afterRow+index+1));
 return {state:'present',receipt:stored,rows,hasMore:value.hasMore} as const;
}

export function legacyApplicationRow(row:unknown,expectedRow:number){
  check(exact(row,['row','decisionRevision','customerAction','customerId','customerVersion','vehicleAction','vehicleId','vehicleVersion'])&&
   legacyAfterRow(expectedRow)&&expectedRow>=2&&row.row===expectedRow&&count(row.decisionRevision,2147483647)&&row.decisionRevision>0);
  const {customerAction,customerId,customerVersion:contactVersion,vehicleAction,vehicleId,vehicleVersion}=row;
  check((customerAction==='create'||customerAction==='link'||customerAction==='skip')&&
   (vehicleAction==='create'||vehicleAction==='link'||vehicleAction==='skip'||vehicleAction==='none')&&
   (customerAction==='skip'?customerId===null&&contactVersion===null&&vehicleAction==='none':customerUuid(customerId)&&customerVersion(contactVersion))&&
   (vehicleAction==='create'||vehicleAction==='link'?customerUuid(vehicleId)&&customerVersion(vehicleVersion):vehicleId===null&&vehicleVersion===null)&&
   (customerAction!=='create'||contactVersion==='1')&&(vehicleAction!=='create'||vehicleVersion==='1'));
  return {row:expectedRow,decisionRevision:row.decisionRevision,customerAction,customerId:customerId as string|null,
   customerVersion:contactVersion as string|null,vehicleAction,vehicleId:vehicleId as string|null,vehicleVersion:vehicleVersion as string|null} as const;
}
