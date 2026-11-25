import {customerDate,customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseOpeningPayablesReceipt} from './opening-payables-schedule-contract.ts';
import {parseOpeningAllocationsOperation} from './opening-allocations-schedule-contract.ts';
export type OpeningSourceKind='payables'|'allocations';
export type OpeningSourceCursor=Readonly<{recordedAt:string;id:string}>;
function check(value:unknown):asserts value{if(!value)throw Error('OPENING_SOURCE_HISTORY_REVIEW_REQUIRED');}
export function parseOpeningSourceCursor(value:unknown):OpeningSourceCursor|null{
 if(value===null)return null;check(exact(value,['recordedAt','id'])&&customerInstant(value.recordedAt)&&customerUuid(value.id));return {recordedAt:value.recordedAt,id:value.id};
}
export function parseOpeningSourceHistory(value:unknown,businessId:string,kind:OpeningSourceKind){
 check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','kind','entries','nextCursor'])&&value.schemaVersion===1&&value.businessId===businessId&&value.kind===kind&&Array.isArray(value.entries)&&value.entries.length<=20);
 const ids=new Set<string>(),entries=value.entries.map(entry=>{
  check(exact(entry,['revisionId','worksheetRevision','revision','cutoverOn','recordedAt','itemCount'])&&customerUuid(entry.revisionId)&&!ids.has(entry.revisionId)&&customerVersion(entry.worksheetRevision)&&customerVersion(entry.revision)&&customerDate(entry.cutoverOn)&&customerInstant(entry.recordedAt)&&Number.isInteger(entry.itemCount)&&(entry.itemCount as number)>=0&&(entry.itemCount as number)<=(kind==='payables'?200:1000));ids.add(entry.revisionId);
  return {revisionId:entry.revisionId,worksheetRevision:entry.worksheetRevision,revision:entry.revision,cutoverOn:entry.cutoverOn,recordedAt:entry.recordedAt,itemCount:entry.itemCount as number};
 });
 const nextCursor=parseOpeningSourceCursor(value.nextCursor),last=entries.at(-1);check(!nextCursor||last&&nextCursor.id===last.revisionId&&nextCursor.recordedAt===last.recordedAt);
 return {entries,nextCursor};
}
export function parseOpeningPayablesHistorical(value:unknown,businessId:string,revisionId:string){
 check(customerUuid(revisionId)&&exact(value,['schemaVersion','businessId','schedule'])&&value.schemaVersion===1&&value.businessId===businessId);
 if(value.schedule===null)return null;const saved=parseOpeningPayablesReceipt(value.schedule,businessId);check(saved.scheduleRevisionId===revisionId);return saved;
}
export function parseOpeningAllocationsHistorical(value:unknown,businessId:string,revisionId:string){
 check(customerUuid(revisionId)&&exact(value,['schemaVersion','businessId','schedule','supplierSchedule'])&&value.schemaVersion===1&&value.businessId===businessId);
 if(value.schedule===null){check(value.supplierSchedule===null);return null;}
 check(exact(value.schedule,['schemaVersion','businessId','allocationRevisionId','payablesRevision','worksheetRevisionId','revision','operationId','auditEventId','recordedBy','recordedAt','evidenceSha256','evidence']));
 const parsed=parseOpeningAllocationsOperation({state:'committed',receipt:value.schedule,supplierSchedule:value.supplierSchedule},businessId,value.schedule.operationId as string);check(parsed.state==='committed'&&parsed.receipt.allocationRevisionId===revisionId);return {receipt:parsed.receipt,supplierSchedule:parsed.supplierSchedule};
}
