import {customerUuid as uuid,customerVersion as version,customerInstant as instant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadAddressDraft} from './lead-resource-contract.ts';
import type {LeadAddressDraft} from './lead-resource-contract.ts';
import {leadAddressColumns,parseLeadAddress} from './lead-address-contract.ts';
import type {LeadAddress} from './lead-address-contract.ts';

export type LeadAddressSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;leadId:string;leadAddressId:string;expectedVersion:string;draft:LeadAddressDraft}>;
export function parseLeadAddressSave(value:unknown):LeadAddressSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','leadId','leadAddressId','expectedVersion','draft'])&&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.leadId)&&uuid(value.leadAddressId)&&version(value.expectedVersion,true));
 return Object.freeze({...value,draft:parseLeadAddressDraft(value.draft)}) as LeadAddressSave;
}
export function parseLeadAddressCommitted(value:unknown,businessId:string,operationId:string){
 check(uuid(businessId)&&uuid(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&uuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','leadId','leadAddressId','leadAddressVersion','auditEventId']));
 const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&uuid(r.leadId)&&uuid(r.leadAddressId)&&version(r.leadAddressVersion)&&uuid(r.auditEventId));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,businessId,leadId:r.leadId,leadAddressId:r.leadAddressId,leadAddressVersion:r.leadAddressVersion,auditEventId:r.auditEventId})});
}
export function parseLeadAddressPage(value:unknown,businessId:string,leadId:string,afterId:string|null,includeArchived:boolean,pageSize:number){
 check(uuid(businessId)&&uuid(leadId)&&(afterId===null||uuid(afterId))&&typeof includeArchived==='boolean'&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','leadId','leadVersion','leadAddresses','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&value.leadId===leadId&&version(value.leadVersion)&&Array.isArray(value.leadAddresses)&&value.leadAddresses.length<=pageSize&&typeof value.hasMore==='boolean');
 let previous=afterId;const rows=Array.from(value.leadAddresses,row=>{const parsed=parseLeadAddress(row,businessId,leadId);check((previous===null||parsed.id>previous)&&(includeArchived||parsed.archived_at===null));previous=parsed.id;return parsed;});check(!value.hasMore||rows.length===pageSize);
 return Object.freeze({state:'found' as const,schemaVersion:1 as const,businessId,leadId,leadVersion:value.leadVersion,leadAddresses:Object.freeze(rows),hasMore:value.hasMore});
}
export function sameLeadAddress(a:LeadAddress,b:LeadAddress){
 return leadAddressColumns.every(key=>a[key]===b[key]);
}
export function parseLeadAddressHistory(value:unknown,businessId:string,leadId:string,leadAddressId:string,afterVersion:string,pageSize:number){
 check(uuid(businessId)&&uuid(leadId)&&uuid(leadAddressId)&&version(afterVersion,true)&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=20);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','leadAddress','history','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&Array.isArray(value.history)&&value.history.length<=pageSize&&typeof value.hasMore==='boolean');
 const current=parseLeadAddress(value.leadAddress,businessId,leadId);check(current.id===leadAddressId);let previous=BigInt(afterVersion),last:LeadAddress|null=null;const ids=new Set<string>(),operations=new Set<string>();
 const history=Array.from(value.history,event=>{
  check(exact(event,['version','eventId','actorId','operationId','at','action','before','after'])&&version(event.version)&&uuid(event.eventId)&&uuid(event.actorId)&&uuid(event.operationId)&&instant(event.at)&&!ids.has(event.eventId)&&!operations.has(event.operationId));ids.add(event.eventId);operations.add(event.operationId);
  const after=parseLeadAddress(event.after,businessId,leadId),before=event.before===null?null:parseLeadAddress(event.before,businessId,leadId);
  check(after.id===leadAddressId&&after.version===event.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.version)===previous+1n&&BigInt(event.version)<=BigInt(current.version));
  if(before===null)check(event.action==='create'&&event.version==='1');
  else{
   check(before.id===after.id&&BigInt(before.version)+1n===BigInt(after.version));
   for(const key of ['created_at','created_by','origin','import_row_id'] as const)check(before[key]===after[key]);
   const action=before.archived_at===null&&after.archived_at!==null?'archive':before.archived_at!==null&&after.archived_at===null?'reopen':'edit';check(event.action===action);
   if(before.archived_at!==null&&after.archived_at!==null)check(before.archived_at===after.archived_at);
  }
  check(last===null||before!==null&&sameLeadAddress(last,before));previous=BigInt(event.version);last=after;return Object.freeze({version:event.version,eventId:event.eventId,actorId:event.actorId,operationId:event.operationId,at:event.at,action:event.action as 'create'|'edit'|'archive'|'reopen',before,after});
 });
 check(value.hasMore?history.length===pageSize&&previous<BigInt(current.version):BigInt(afterVersion)>=BigInt(current.version)?history.length===0:last!==null&&sameLeadAddress(last,current));
 return Object.freeze({state:'found' as const,schemaVersion:1 as const,businessId,leadAddress:current,history:Object.freeze(history),hasMore:value.hasMore});
}
