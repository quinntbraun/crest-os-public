import {customerDisplayName,customerInstant,customerUuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {isSavedJobTimezone} from '../operations/confirmed-job-read-contract.ts';

export const customerProfileFields=['customerId','afterAssociationId','pageSize'] as const;

export function parseCustomerProfileRequest(value:unknown){
  check(exact(value,customerProfileFields));
  const {customerId,afterAssociationId,pageSize}=value;
  check(customerUuid(customerId)&&(afterAssociationId===null||customerUuid(afterAssociationId)));
  check(typeof pageSize==='number'&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=25);
  return Object.freeze({customerId,afterAssociationId,pageSize});
}

function parseVisit(value:unknown,asOf:string,direction:'last'|'next'){
  if(value===null)return null;
  check(exact(value,['jobId','at','timezone'])&&customerUuid(value.jobId)&&customerInstant(value.at)&&isSavedJobTimezone(value.timezone));
  check(direction==='last'?value.at<=asOf:value.at>=asOf);
  return Object.freeze({jobId:value.jobId,at:value.at,timezone:value.timezone});
}

export function parseCustomerProfile(value:unknown,businessId:string,input:ReturnType<typeof parseCustomerProfileRequest>){
  const request=parseCustomerProfileRequest(input);
  check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','customerId','asOf','lastVisit','nextVisit','vehicles','hasMore']));
  check(value.schemaVersion===1&&value.businessId===businessId&&value.customerId===request.customerId&&customerInstant(value.asOf));
  check(Array.isArray(value.vehicles)&&value.vehicles.length<=request.pageSize&&typeof value.hasMore==='boolean'&&(!value.hasMore||value.vehicles.length===request.pageSize));
  let cursor=request.afterAssociationId;
  const vehicles=value.vehicles.map(row=>{
    check(exact(row,['associationId','vehicleId','label','relationship','billing','archived']));
    const {associationId,vehicleId,label,relationship,billing,archived}=row;
    check(customerUuid(associationId)&&customerUuid(vehicleId)&&customerDisplayName(label)&&(cursor===null||associationId>cursor));
    check((relationship==='owner'||relationship==='keeper')&&typeof billing==='boolean'&&typeof archived==='boolean');
    cursor=associationId;
    return Object.freeze({associationId,vehicleId,label,relationship,billing,archived});
  });
  const lastVisit=parseVisit(value.lastVisit,value.asOf,'last'),nextVisit=parseVisit(value.nextVisit,value.asOf,'next');
  check(!lastVisit||!nextVisit||lastVisit.jobId!==nextVisit.jobId);
  return Object.freeze({schemaVersion:1 as const,businessId,customerId:request.customerId,asOf:value.asOf,lastVisit,nextVisit,vehicles:Object.freeze(vehicles),hasMore:value.hasMore});
}
