import {customerDisplayName,customerInstant,customerUuid,exactCustomerObject as exact,requireCustomer as check} from '../customer/customer-contract.ts';
import {jobStates} from './confirmed-booking-records.ts';
import {isSavedJobTimezone} from './confirmed-job-read-contract.ts';

export const recordJobHistoryFields=['kind','recordId','afterRecordedAt','afterEntryId','pageSize'] as const;

export function parseRecordJobHistoryRequest(value:unknown){
  check(exact(value,recordJobHistoryFields));
  const {kind,recordId,afterRecordedAt,afterEntryId,pageSize}=value;
  check((kind==='customer'||kind==='vehicle')&&customerUuid(recordId));
  check((afterRecordedAt===null&&afterEntryId===null)||(customerInstant(afterRecordedAt)&&customerUuid(afterEntryId)));
  check(typeof pageSize==='number'&&Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=50);
  return Object.freeze({kind,recordId,afterRecordedAt,afterEntryId,pageSize});
}

export function parseRecordJobHistoryPage(value:unknown,businessId:string,input:ReturnType<typeof parseRecordJobHistoryRequest>){
  const request=parseRecordJobHistoryRequest(input);
  check(customerUuid(businessId)&&exact(value,['schemaVersion','businessId','kind','recordId','jobs','hasMore']));
  check(value.schemaVersion===1&&value.businessId===businessId&&value.kind===request.kind&&value.recordId===request.recordId);
  check(Array.isArray(value.jobs)&&value.jobs.length<=request.pageSize&&typeof value.hasMore==='boolean'&&(!value.hasMore||value.jobs.length===request.pageSize));
  let after=request.afterRecordedAt,cursor=request.afterEntryId;
  const seen=new Set<string>();
  const jobs=value.jobs.map(row=>{
    check(exact(row,['jobId','jobVehicleId','state','fulfillmentMode','recordedAt','startAt','endAt','timezone','customerName','vehicleLabels']));
    const {jobId,jobVehicleId,fulfillmentMode,recordedAt,startAt,endAt,timezone,customerName,vehicleLabels}=row;
    const state=jobStates.find(state=>state===row.state);
    check(state&&customerUuid(jobId)&&!seen.has(jobId));
    check(fulfillmentMode==='mobile'||fulfillmentMode==='dropoff'||fulfillmentMode==='pickup_return');
    check(customerInstant(recordedAt)&&customerInstant(startAt)&&customerInstant(endAt)&&endAt>startAt&&isSavedJobTimezone(timezone));
    check(Array.isArray(vehicleLabels)&&vehicleLabels.every(customerDisplayName));
    if(request.kind==='vehicle'){
      check(customerUuid(jobVehicleId)&&customerDisplayName(customerName)&&vehicleLabels.length===1);
    }else{
      check(jobVehicleId===null&&customerName===null&&vehicleLabels.length>=1&&vehicleLabels.length<=3);
    }
    const entry=jobVehicleId??jobId;
    check(after===null||recordedAt<after||recordedAt===after&&cursor!==null&&entry<cursor);
    after=recordedAt;
    cursor=entry;
    seen.add(jobId);
    return Object.freeze({jobId,jobVehicleId,state,fulfillmentMode,recordedAt,startAt,endAt,timezone,customerName,vehicleLabels:Object.freeze([...vehicleLabels]) as readonly string[]});
  });
  return Object.freeze({schemaVersion:1 as const,businessId,kind:request.kind,recordId:request.recordId,jobs:Object.freeze(jobs),hasMore:value.hasMore});
}
