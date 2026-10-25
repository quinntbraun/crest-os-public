import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseLeadConversion} from './lead-conversion-contract.ts';
import type {LeadConversion} from './lead-conversion-contract.ts';
import {parseLeadConversionRecord,parseConversionLink} from './lead-conversion-record.ts';

export const leadConversionWireKeys=['schemaVersion','operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','selectionsJson'] as const;
export type LeadConversionReference=Readonly<{operationId:string;recoveryEpoch:string;conversionId:string;leadId:string;expectedLeadVersion:string;customerId:string}>;
export function parseLeadConversionReference(value:unknown):LeadConversionReference{
 check(exact(value,['operationId','recoveryEpoch','conversionId','leadId','expectedLeadVersion','customerId'])&&uuid(value.operationId)&&uuid(value.recoveryEpoch)&&uuid(value.conversionId)&&uuid(value.leadId)&&version(value.expectedLeadVersion)&&uuid(value.customerId));return Object.freeze({...value}) as LeadConversionReference;
}
// Preserve the existing flat HTTP envelope. Nested selections travel as bounded
// JSON text; reject duplicate keys at every depth before interpreting them.
export function parseLeadConversionWire(value:unknown,businessId:string):LeadConversion{
 check(uuid(businessId)&&exact(value,leadConversionWireKeys)&&typeof value.selectionsJson==='string'&&new TextEncoder().encode(value.selectionsJson).byteLength<=131072);
 const selections:unknown=JSON.parse(value.selectionsJson),nodes:unknown[]=[selections];let fields=0,visited=0;
 while(nodes.length){check(++visited<=50000);const node=nodes.pop();if(node&&typeof node==='object'){if(!Array.isArray(node))fields+=Object.keys(node).length;nodes.push(...Object.values(node));}}
 check((value.selectionsJson.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length===fields&&exact(selections,['customer','vehicles','addresses']));
 const {selectionsJson:ignored,...reference}=value;void ignored;
 return parseLeadConversion({...reference,businessId,...selections});
}
export function leadConversionToWire(value:LeadConversion){
 const {businessId:ignored,customer,vehicles,addresses,...reference}=parseLeadConversion(value);void ignored;
 const wire=Object.freeze({...reference,selectionsJson:JSON.stringify({customer,vehicles,addresses})});
 check(new TextEncoder().encode(JSON.stringify(wire)).byteLength<=131072);return wire;
}
export function parseLeadConversionCommitted(value:unknown,businessId:string,operationId:string){
 check(uuid(businessId)&&uuid(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&uuid(value.recoveryEpoch)
  &&exact(value.receipt,['schemaVersion','businessId','conversionId','leadId','leadVersion','customerId','auditEventId']));
 const r=value.receipt;check(r.schemaVersion===1&&r.businessId===businessId&&uuid(r.conversionId)&&uuid(r.leadId)&&version(r.leadVersion)&&uuid(r.customerId)&&uuid(r.auditEventId));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({schemaVersion:1 as const,businessId,conversionId:r.conversionId,leadId:r.leadId,leadVersion:r.leadVersion,customerId:r.customerId,auditEventId:r.auditEventId})});
}
export function bindLeadConversionCommitted(value:unknown,request:LeadConversion){
 const c=parseLeadConversion(request),result=parseLeadConversionCommitted(value,c.businessId,c.operationId);
 check(result.recoveryEpoch===c.recoveryEpoch&&result.receipt.conversionId===c.conversionId&&result.receipt.leadId===c.leadId&&result.receipt.customerId===c.customer.id&&BigInt(result.receipt.leadVersion)===BigInt(c.expectedLeadVersion)+1n);return result;
}
export function bindLeadConversionReference(value:unknown,businessId:string,reference:LeadConversionReference){
 const r=parseLeadConversionReference(reference),result=parseLeadConversionCommitted(value,businessId,r.operationId);
 check(result.recoveryEpoch===r.recoveryEpoch&&result.receipt.conversionId===r.conversionId&&result.receipt.leadId===r.leadId&&result.receipt.customerId===r.customerId&&BigInt(result.receipt.leadVersion)===BigInt(r.expectedLeadVersion)+1n);return result;
}
export function parseLeadConversionRead(value:unknown,businessId:string,leadId:string){
 check(uuid(businessId)&&uuid(leadId));if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','conversion'])&&value.schemaVersion===1&&value.businessId===businessId);
 return Object.freeze({state:'found' as const,schemaVersion:1 as const,businessId,conversion:parseLeadConversionRecord(value.conversion,businessId,leadId)});
}
export function parseLeadConversionLinkPage(value:unknown,businessId:string,leadId:string,conversionId:string,afterId:string|null,pageSize:number){
 check(uuid(businessId)&&uuid(leadId)&&uuid(conversionId)&&(afterId===null||uuid(afterId))&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=50);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 check(exact(value,['schemaVersion','businessId','conversion','links','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&Array.isArray(value.links)&&value.links.length<=pageSize&&typeof value.hasMore==='boolean');
 const parent=parseLeadConversionRecord(value.conversion,businessId,leadId);check(parent.id===conversionId);
 const expected=[...parent.request.vehicles,...parent.request.addresses].map(m=>m.linkId).filter(id=>afterId===null||id>afterId).sort();
 const links=Array.from(value.links,v=>parseConversionLink(v,businessId,parent));
 check(links.length===Math.min(pageSize,expected.length)&&links.every((v,i)=>v.id===expected[i])&&value.hasMore===(expected.length>pageSize));
 return Object.freeze({state:'found' as const,schemaVersion:1 as const,businessId,conversion:parent,links:Object.freeze(links),hasMore:value.hasMore});
}
export const leadConversionConflictReasons=['operation','lead','destination','conversion','source'] as const;
export function parseLeadConversionConflict(value:unknown){
 check(exact(value,['state','reason'])&&value.state==='conflict'&&leadConversionConflictReasons.includes(value.reason as typeof leadConversionConflictReasons[number]));
 return Object.freeze({state:'conflict' as const,reason:value.reason as typeof leadConversionConflictReasons[number]});
}
