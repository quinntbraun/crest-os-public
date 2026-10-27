// Data-only catalog boundary. No credentials or database authority.
import {customerUuid,customerVersion,customerInstant,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseServiceDefinition} from './service-catalog.ts';
import type {ServiceDefinition} from './service-catalog.ts';

export class ServiceStorageError extends Error{constructor(){super('SERVICE_STORAGE_DATA_INVALID');this.name='ServiceStorageError';}}
export function requireService(value:unknown):asserts value{if(!value)throw new ServiceStorageError();}
export const serviceId=(v:unknown):v is string=>typeof v==='string'&&v===v.trim()&&customerUuid(v);
export const serviceRevision=(v:unknown,zero=false):v is string=>typeof v==='string'&&v===v.trim()&&customerVersion(v,zero);
const instant=(v:unknown):v is string=>typeof v==='string'&&v.length===27&&customerInstant(v);
const code=(v:unknown):v is string=>typeof v==='string'&&v===v.trim()&&/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v);
export const serviceColumns=['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export const serviceContentColumns=['id','business_id','service_id','sequence','name','inclusions','exclusions','internal_guidance','range_low_cents','range_high_cents','estimated_seconds','created_at','created_by','origin','operation_id','import_row_id'] as const;
export type StoredService=Readonly<{id:string;business_id:string;code:string;current_version_id:string;active:boolean;version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export type StoredServiceContent=Readonly<{id:string;business_id:string;service_id:string;sequence:string;name:string;inclusions:string;exclusions:string;internal_guidance:string|null;range_low_cents:string|null;range_high_cents:string|null;estimated_seconds:string|null;created_at:string;created_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export type ServicePayload=Readonly<{code:string;active:boolean;definition:ServiceDefinition}>;
export type ServiceSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;serviceId:string;expectedRevision:string;payload:ServicePayload}>;
export type ServiceReceipt=Readonly<{schemaVersion:1;businessId:string;serviceId:string;serviceRevision:string;contentVersionId:string;contentSequence:string;auditEventId:string;contentAuditEventId:string|null}>;
export type ServiceCommitted=Readonly<{state:'committed';operationId:string;recoveryEpoch:string;receipt:ServiceReceipt}>;
export function parseServicePayload(v:unknown):ServicePayload{
 requireService(exact(v,['code','active','definition'])&&code(v.code)&&typeof v.active==='boolean');
 return Object.freeze({code:v.code,active:v.active,definition:parseServiceDefinition(v.definition)});
}
export function parseServiceSave(v:unknown):ServiceSave{
 requireService(exact(v,['schemaVersion','businessId','operationId','recoveryEpoch','serviceId','expectedRevision','payload'])&&v.schemaVersion===1&&serviceId(v.businessId)&&serviceId(v.operationId)&&serviceId(v.recoveryEpoch)&&serviceId(v.serviceId)&&serviceRevision(v.expectedRevision,true));
 return Object.freeze({...v,payload:parseServicePayload(v.payload)}) as ServiceSave;
}
function provenance(v:Record<string,unknown>,business:string){
 requireService(serviceId(business)&&v.business_id===business&&serviceId(v.id)&&serviceId(v.created_by)&&serviceId(v.operation_id)&&instant(v.created_at)&&['manual','import','system'].includes(v.origin as string)&&(v.import_row_id===null||serviceId(v.import_row_id)));
}
export function parseStoredService(v:unknown,business:string):StoredService{
 requireService(exact(v,serviceColumns));provenance(v,business);
 requireService(code(v.code)&&serviceId(v.current_version_id)&&typeof v.active==='boolean'&&serviceRevision(v.version)&&instant(v.updated_at)&&v.updated_at>=(v.created_at as string)&&serviceId(v.updated_by));
 return Object.freeze({...v}) as StoredService;
}
export function serviceContentDefinition(v:StoredServiceContent):ServiceDefinition{return parseServiceDefinition({name:v.name,inclusions:v.inclusions,exclusions:v.exclusions,internalGuidance:v.internal_guidance,rangeLowCents:v.range_low_cents,rangeHighCents:v.range_high_cents,estimatedSeconds:v.estimated_seconds});}
export function parseStoredServiceContent(v:unknown,business:string,service:string):StoredServiceContent{
 requireService(exact(v,serviceContentColumns));provenance(v,business);
 requireService(serviceId(service)&&v.service_id===service&&serviceRevision(v.sequence));
 const row=Object.freeze({...v}) as StoredServiceContent;serviceContentDefinition(row);return row;
}
export function parseServiceCommitted(v:unknown,business:string,operation:string):ServiceCommitted{
 requireService(serviceId(business)&&serviceId(operation)&&exact(v,['state','operationId','recoveryEpoch','receipt'])&&v.state==='committed'&&v.operationId===operation&&serviceId(v.recoveryEpoch));
 const r=v.receipt;requireService(exact(r,['schemaVersion','businessId','serviceId','serviceRevision','contentVersionId','contentSequence','auditEventId','contentAuditEventId'])&&r.schemaVersion===1&&r.businessId===business&&serviceId(r.serviceId)&&serviceRevision(r.serviceRevision)&&serviceId(r.contentVersionId)&&serviceRevision(r.contentSequence)&&BigInt(r.contentSequence)<=BigInt(r.serviceRevision)&&serviceId(r.auditEventId)&&(r.contentAuditEventId===null||serviceId(r.contentAuditEventId)&&r.contentAuditEventId!==r.auditEventId));
 requireService(r.serviceRevision!=='1'||r.contentSequence==='1'&&r.contentAuditEventId!==null);
 requireService(r.contentAuditEventId===null||r.contentSequence!=='1'||r.serviceRevision==='1');
 return Object.freeze({state:'committed',operationId:operation,recoveryEpoch:v.recoveryEpoch,receipt:Object.freeze({...r})}) as ServiceCommitted;
}
const same=(a:StoredService,b:StoredService)=>serviceColumns.every(k=>a[k]===b[k]);
function retained(a:StoredService,b:StoredService){requireService((['id','business_id','code','created_at','created_by','origin','import_row_id'] as const).every(k=>a[k]===b[k]));}
export function parseServiceDirectoryPage(v:unknown,request:Readonly<{businessId:string;afterId:string|null;includeInactive:boolean;pageSize:number}>){
 requireService(exact(v,['schemaVersion','businessId','services','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.services)&&v.services.length<=request.pageSize&&typeof v.hasMore==='boolean');
 let previous=request.afterId;
 const services=v.services.map(entry=>{
  requireService(exact(entry,['service','content']));const service=parseStoredService(entry.service,request.businessId),content=parseStoredServiceContent(entry.content,request.businessId,service.id);
  requireService((previous===null||service.id>previous)&&(request.includeInactive||service.active)&&content.id===service.current_version_id&&BigInt(content.sequence)<=BigInt(service.version));previous=service.id;
  return Object.freeze({service,content});
 });requireService(!v.hasMore||services.length===request.pageSize);
 return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,services:Object.freeze(services),hasMore:v.hasMore});
}
export function parseServiceHistoryPage(v:unknown,request:Readonly<{businessId:string;serviceId:string;afterRevision:string;pageSize:number}>){
 if(exact(v,['state'])&&v.state==='absent')return Object.freeze({state:'absent' as const});
 requireService(exact(v,['schemaVersion','businessId','service','history','hasMore'])&&v.schemaVersion===1&&v.businessId===request.businessId&&Array.isArray(v.history)&&v.history.length<=request.pageSize&&typeof v.hasMore==='boolean');
 const service=parseStoredService(v.service,request.businessId);requireService(service.id===request.serviceId);
 let revision=BigInt(request.afterRevision),last:StoredService|null=null,lastContent:StoredServiceContent|null=null;
 const history=v.history.map(event=>{
  requireService(exact(event,['revision','eventId','actorId','operationId','at','action','before','after','content'])&&serviceRevision(event.revision)&&serviceId(event.eventId)&&serviceId(event.actorId)&&serviceId(event.operationId)&&instant(event.at)&&['create','edit','archive','reopen'].includes(event.action as string));
  const after=parseStoredService(event.after,request.businessId),before=event.before===null?null:parseStoredService(event.before,request.businessId),content=parseStoredServiceContent(event.content,request.businessId,service.id);
  retained(service,after);requireService(after.id===service.id&&event.revision===after.version&&after.operation_id===event.operationId&&after.updated_by===event.actorId&&BigInt(event.revision)===revision+1n&&BigInt(event.revision)<=BigInt(service.version)&&content.id===after.current_version_id&&BigInt(content.sequence)<=BigInt(after.version));
  if(before===null){requireService(event.revision==='1'&&event.action==='create'&&content.sequence==='1');}
  else{
   retained(before,after);requireService(BigInt(before.version)+1n===BigInt(after.version)&&before.updated_at<=after.updated_at&&event.action!=='create');
   if(event.action==='edit')requireService(before.current_version_id!==after.current_version_id&&BigInt(content.sequence)>1n);
   else requireService(before.current_version_id===after.current_version_id&&before.active!==after.active&&after.active===(event.action==='reopen'));
  }
  if(event.action==='create'||event.action==='edit')requireService(content.operation_id===event.operationId&&content.created_by===event.actorId);
  if(last!==null){requireService(before!==null&&same(last,before));requireService(lastContent!==null&&(event.action==='edit'?BigInt(content.sequence)===BigInt(lastContent.sequence)+1n:serviceContentColumns.every(k=>content[k]===lastContent![k])));}
  last=after;lastContent=content;revision=BigInt(event.revision);return Object.freeze({...event,before,after,content});
 });
 const remaining=BigInt(service.version)>BigInt(request.afterRevision)?BigInt(service.version)-BigInt(request.afterRevision):0n;
 requireService(BigInt(history.length)===(remaining>BigInt(request.pageSize)?BigInt(request.pageSize):remaining)&&v.hasMore===(remaining>BigInt(request.pageSize))&&(last===null||revision!==BigInt(service.version)||same(last,service)));
 return Object.freeze({schemaVersion:1 as const,businessId:request.businessId,service,history:Object.freeze(history),hasMore:v.hasMore});
}
