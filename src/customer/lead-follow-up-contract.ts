import {customerInstant,customerUuid,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {isLeadLabel,leadStates} from './lead-contract.ts';
import type {LeadState} from './lead-contract.ts';

export type LeadFollowUp=Readonly<{id:string;label:string;state:LeadState;followUpAt:string}>;
export type LeadFollowUpQuery=Readonly<{afterAt:string|null;afterId:string|null;pageSize:number}>;

export function parseLeadFollowUpQuery(value:unknown):LeadFollowUpQuery{
 requireCustomer(exactCustomerObject(value,['afterAt','afterId','pageSize'])
  &&(value.afterAt===null&&value.afterId===null||customerInstant(value.afterAt)&&customerUuid(value.afterId))
  &&typeof value.pageSize==='number'&&Number.isInteger(value.pageSize)&&value.pageSize>=1&&value.pageSize<=50);
 return Object.freeze({...value}) as LeadFollowUpQuery;
}

export function parseLeadFollowUpPage(value:unknown,businessId:string,query:LeadFollowUpQuery){
 requireCustomer(customerUuid(businessId)&&exactCustomerObject(value,['schemaVersion','businessId','observedAt','followUps','hasMore'])
  &&value.schemaVersion===1&&value.businessId===businessId&&customerInstant(value.observedAt)&&Array.isArray(value.followUps)
  &&value.followUps.length<=query.pageSize&&typeof value.hasMore==='boolean'
  &&(!value.hasMore||value.followUps.length===query.pageSize));
 let afterAt=query.afterAt,afterId=query.afterId;
 const ids=new Set<string>();
 const followUps=value.followUps.map((row:unknown)=>{
  requireCustomer(exactCustomerObject(row,['id','label','state','followUpAt'])&&customerUuid(row.id)
   &&isLeadLabel(row.label)&&leadStates.includes(row.state as LeadState)&&customerInstant(row.followUpAt)
   &&!ids.has(row.id)&&(afterAt===null||row.followUpAt>afterAt||row.followUpAt===afterAt&&afterId!==null&&row.id>afterId));
  afterAt=row.followUpAt;afterId=row.id;ids.add(row.id);
  return Object.freeze({...row}) as LeadFollowUp;
 });
 return Object.freeze({schemaVersion:1 as const,businessId,observedAt:value.observedAt,followUps:Object.freeze(followUps),hasMore:value.hasMore});
}
