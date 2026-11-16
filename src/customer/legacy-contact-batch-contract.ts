import {customerDisplayName,customerUuid,customerVersion,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';

export const legacyBatchMetadataLimit=8192;
export const legacyBatchRoutes=['legacy-batches/stage','legacy-batches/list','legacy-batches/read','legacy-batches/effects','legacy-batches/targets',
 'legacy-batches/read-decision','legacy-batches/save-decision','legacy-batches/review-approval','legacy-batches/approve',
 'legacy-batches/identity','legacy-batches/apply','legacy-batches/application','legacy-batches/apply-status','legacy-batches/download'] as const;
export type LegacyBatchRoute=typeof legacyBatchRoutes[number];
const digest=/^[a-f0-9]{64}$/;

export function parseLegacyBatchHeader(value:unknown){
 check(exact(value,['batchId','operationId','recoveryEpoch','sourceLabel','sourceSha256','columns'])&&
  customerUuid(value.batchId)&&customerUuid(value.operationId)&&customerUuid(value.recoveryEpoch)&&
  typeof value.sourceLabel==='string'&&value.sourceLabel===value.sourceLabel.trim()&&
  [...value.sourceLabel].length>=1&&[...value.sourceLabel].length<=160&&!/[\p{Cc}\p{Cs}]/u.test(value.sourceLabel)&&
  typeof value.sourceSha256==='string'&&digest.test(value.sourceSha256)&&
  !!value.columns&&typeof value.columns==='object'&&!Array.isArray(value.columns));
 const columns=Object.entries(value.columns);
 check(columns.length>=2&&columns.length<=15&&columns.every(([,index])=>Number.isSafeInteger(index)&&Number(index)>=0)&&
   new Set(columns.map(([,index])=>index)).size===columns.length);
 return {batchId:value.batchId,operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
  sourceLabel:value.sourceLabel,sourceSha256:value.sourceSha256,columns:Object.fromEntries(columns) as Record<string,number>};
}

export function legacyBatchReceipt(value:unknown,businessId:string){
 check(exact(value,['schemaVersion','state','batchId','businessId','sourceLabel','originalSha256','mappingVersion',
  'mappingSha256','rowsSha256','rowCount','rejectedCount','operationId'])&&value.schemaVersion===1&&value.state==='staged'&&
  value.businessId===businessId&&customerUuid(value.batchId)&&customerUuid(value.operationId)&&
  typeof value.sourceLabel==='string'&&[...value.sourceLabel].length>=1&&[...value.sourceLabel].length<=160&&
  value.mappingVersion===1&&[value.originalSha256,value.mappingSha256].every(x=>typeof x==='string'&&digest.test(x))&&
  typeof value.rowsSha256==='string'&&digest.test(value.rowsSha256)&&
  typeof value.rowCount==='number'&&Number.isSafeInteger(value.rowCount)&&value.rowCount>=1&&value.rowCount<=100000&&
  typeof value.rejectedCount==='number'&&Number.isSafeInteger(value.rejectedCount)&&value.rejectedCount>=0&&value.rejectedCount<=value.rowCount);
 return {batchId:value.batchId,sourceLabel:value.sourceLabel,rowCount:value.rowCount,rejectedCount:value.rejectedCount,
  rowsSha256:value.rowsSha256};
}

const effectCounts=['totalRows','rejectedRows','reviewRows','candidateCustomers','candidateVehicles','candidateLinks',
 'sourceConflictRows','sharedHintRows','savedContactRows','savedVehicleRows'] as const;
export const legacyFindingReasons=['customer_source_conflict','vehicle_source_conflict','shared_phone','shared_email',
 'shared_vin','saved_phone','saved_email','saved_vin'] as const;
type FindingReason=typeof legacyFindingReasons[number];
export function legacyAfterRow(value:unknown):value is number{
 return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=100001;
}
function findingReason(value:unknown):value is FindingReason{
 return (legacyFindingReasons as readonly unknown[]).includes(value);
}

export function parseLegacyTargetRequest(value:unknown){
 check(exact(value,['batchId','row','kind','afterTarget'])&&customerUuid(value.batchId)&&legacyAfterRow(value.row)&&
  value.row>=2&&(value.kind==='customer'||value.kind==='vehicle')&&(value.afterTarget===null||customerUuid(value.afterTarget)));
 return {batchId:value.batchId,row:value.row,kind:value.kind,afterTarget:value.afterTarget} as const;
}
type TargetRequest=ReturnType<typeof parseLegacyTargetRequest>;
export function legacyTargetPage(value:unknown,businessId:string,request:TargetRequest){
 check(exact(value,['state','schemaVersion','businessId','batchId','row','rowsSha256','kind','hasMore','items'])&&
  value.state==='present'&&value.schemaVersion===1&&value.businessId===businessId&&value.batchId===request.batchId&&
  value.row===request.row&&value.kind===request.kind&&typeof value.rowsSha256==='string'&&digest.test(value.rowsSha256)&&
  typeof value.hasMore==='boolean'&&Array.isArray(value.items)&&value.items.length<=10&&(!value.hasMore||value.items.length===10));
 let last=request.afterTarget;
 const allowedMatch:readonly string[]=request.kind==='customer'?['phone','email']:['vin'];
 const allowedType:readonly string[]=request.kind==='customer'?['customer']:['customer_vehicle','business_rig','other'];
 const items=value.items.map(item=>{
  check(exact(item,['id','label','version','archived','recordType','suffix','descriptor','matched'])&&customerUuid(item.id)&&
   (last===null||item.id>last)&&customerDisplayName(item.label)&&customerVersion(item.version)&&typeof item.archived==='boolean'&&
   typeof item.recordType==='string'&&allowedType.includes(item.recordType)&&
   (item.suffix===null||typeof item.suffix==='string'&&[...item.suffix].length>=1&&[...item.suffix].length<=4)&&
   (item.descriptor===null||typeof item.descriptor==='string'&&[...item.descriptor].length<=1536)&&
   Array.isArray(item.matched)&&item.matched.length>=1&&item.matched.length<=allowedMatch.length&&
   item.matched.every(reason=>typeof reason==='string'&&allowedMatch.includes(reason))&&new Set(item.matched).size===item.matched.length);
  last=item.id;
  return {id:item.id,label:item.label,version:item.version,archived:item.archived,recordType:item.recordType,
   suffix:item.suffix,descriptor:item.descriptor,matched:item.matched as ('phone'|'email'|'vin')[]};
 });
 return {hasMore:value.hasMore,rowsSha256:value.rowsSha256,items};
}
export function legacyBatchEffects(value:unknown,businessId:string,batchId:string,afterRow:number){
 check(exact(value,['state','schemaVersion','businessId','batchId','rowsSha256','findings','hasMoreFindings',...effectCounts])&&
  value.state==='present'&&value.schemaVersion===1&&value.businessId===businessId&&value.batchId===batchId&&
  typeof value.rowsSha256==='string'&&digest.test(value.rowsSha256)&&Array.isArray(value.findings)&&
  typeof value.hasMoreFindings==='boolean');
 const counts=Object.fromEntries(effectCounts.map(key=>{
  const count=value[key];check(typeof count==='number'&&Number.isSafeInteger(count)&&count>=0&&count<=100000);
  return [key,count];
 })) as Record<typeof effectCounts[number],number>;
 const {totalRows,rejectedRows,reviewRows,candidateCustomers,candidateVehicles,candidateLinks}=counts;
 const usable=totalRows-rejectedRows;
 check(totalRows>0&&usable>=0&&reviewRows<=usable&&candidateCustomers<=usable&&candidateVehicles<=candidateLinks&&
  candidateLinks<=usable&&[counts.sourceConflictRows,counts.sharedHintRows,counts.savedContactRows,counts.savedVehicleRows]
   .every(count=>count<=reviewRows)&&((usable>0)===(candidateCustomers>0)));
 const possible=reviewRows+rejectedRows;
 check(value.findings.length<=Math.min(25,possible)&&(!value.hasMoreFindings||value.findings.length===25&&possible>25)&&
  (afterRow!==1||value.findings.length===Math.min(25,possible)&&value.hasMoreFindings===(possible>25)));
 let previous=afterRow;
 const findings=value.findings.map(entry=>{
  check(exact(entry,['row','customer','vehicle','issues','reasons'])&&legacyAfterRow(entry.row)&&entry.row>previous&&entry.row<=totalRows+1&&
   (entry.customer===null||typeof entry.customer==='string'&&entry.customer.length>0)&&
   (entry.vehicle===null||typeof entry.vehicle==='string'&&entry.vehicle.length>0)&&
   Array.isArray(entry.issues)&&entry.issues.length<=3&&entry.issues.every(issue=>typeof issue==='string')&&
   Array.isArray(entry.reasons)&&entry.reasons.every(findingReason)&&new Set(entry.reasons).size===entry.reasons.length&&
   (entry.customer===null?entry.vehicle===null&&entry.issues.length>0&&entry.reasons.length===0:entry.issues.length===0&&entry.reasons.length>0));
  previous=entry.row;
  return {row:entry.row,customer:entry.customer,vehicle:entry.vehicle,issues:entry.issues as string[],reasons:entry.reasons as FindingReason[]};
 });
 return {...counts,rowsSha256:value.rowsSha256,findings,hasMoreFindings:value.hasMoreFindings};
}

export function legacyBatchRows(value:unknown,after:number,limit:number){
 check(Array.isArray(value)&&value.length<=limit);
 return value.map((entry,index)=>{
  check(exact(entry,['sourceRow','fingerprint','candidate'])&&entry.sourceRow===after+index+1&&
   typeof entry.fingerprint==='string'&&digest.test(entry.fingerprint)&&exact(entry.candidate,['customer','vehicle','issues']));
  const {customer,vehicle,issues}=entry.candidate;
  check((customer===null||typeof customer==='object'&&customer!==null&&'displayName'in customer&&typeof customer.displayName==='string')&&
   (vehicle===null||typeof vehicle==='object'&&vehicle!==null&&'label'in vehicle&&typeof vehicle.label==='string')&&
   Array.isArray(issues)&&issues.length<=3&&issues.every(issue=>typeof issue==='string'));
  return {row:after+index+1,customer:customer?.displayName??null,vehicle:vehicle?.label??null,issues:issues as string[]};
 });
}
