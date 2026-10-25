import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadStateDraft,parseLeadEvent} from './lead-state-contract.ts';
import type {LeadStateDraft} from './lead-state-contract.ts';
export type LeadStateSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;leadId:string;expectedVersion:string;draft:LeadStateDraft}>;
export function parseLeadStateSave(value:unknown):LeadStateSave{
 check(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','leadId','expectedVersion','draft'])&&value.schemaVersion===1&&uuid(value.businessId)&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.leadId)&&version(value.expectedVersion));
 return Object.freeze({...value,draft:parseLeadStateDraft(value.draft)}) as LeadStateSave;
}
export function parseLeadStateCommitted(value:unknown,businessId:string,operationId:string){
 check(uuid(businessId)&&uuid(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&uuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','leadId','leadVersion','leadEventId','leadAuditEventId','eventAuditEventId']));
 const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&uuid(r.leadId)&&version(r.leadVersion)&&BigInt(r.leadVersion)>1n&&uuid(r.leadEventId)&&uuid(r.leadAuditEventId)&&uuid(r.eventAuditEventId)&&new Set([r.leadEventId,r.leadAuditEventId,r.eventAuditEventId]).size===3);
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r})});
}
export function parseLeadStatePage(value:unknown,businessId:string,leadId:string,afterVersion:string,pageSize:number){
 check(uuid(businessId)&&uuid(leadId)&&version(afterVersion,true)&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','leadId','leadVersion','events','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&value.leadId===leadId&&version(value.leadVersion)&&Array.isArray(value.events)&&value.events.length<=pageSize&&typeof value.hasMore==='boolean');
 let previous=BigInt(afterVersion);const ids=new Set<string>(),operations=new Set<string>();
 const events=Array.from(value.events,row=>{const event=parseLeadEvent(row,businessId);check(event.lead_id===leadId&&BigInt(event.lead_version)>previous&&BigInt(event.lead_version)<=BigInt(value.leadVersion as string)&&!ids.has(event.id)&&!operations.has(event.operation_id));ids.add(event.id);operations.add(event.operation_id);previous=BigInt(event.lead_version);return event;});
 check(!value.hasMore||events.length===pageSize&&previous<BigInt(value.leadVersion));
 return Object.freeze({state:'found' as const,schemaVersion:1 as const,businessId,leadId,leadVersion:value.leadVersion,events:Object.freeze(events),hasMore:value.hasMore});
}
