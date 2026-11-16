import {customerDisplayName,customerUuid as uuid,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {isLeadLabel,leadStates} from './lead-contract.ts';

export const leadContactReviewFields=['leadId','customerId','phone','email'] as const;
export const leadVehicleReviewFields=['vehicleId','vin','plate','year','make','model'] as const;

const optionalId=(value:unknown):value is string|null=>value===null||uuid(value);
function optionalHint(value:unknown,max:number):value is string|null{
  if(value===null)return true;
  if(typeof value!=='string'||value.length===0)return false;
  const points=[...value];
  return points.length<=max&&points.every(character=>{
    const point=character.codePointAt(0)!;
    return point>=32&&(point<127||point>159)&&(point<0xd800||point>0xdfff);
  });
}
function optionalYear(value:unknown):value is number|null{
  return value===null||typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647;
}

export function parseLeadContactReviewInput(value:unknown){
  check(exact(value,leadContactReviewFields));
  const {leadId,customerId,phone,email}=value;
  check(optionalId(leadId)&&optionalId(customerId)&&optionalHint(phone,512)&&optionalHint(email,512));
  return Object.freeze({leadId,customerId,phone,email});
}

export function parseLeadVehicleReviewInput(value:unknown){
  check(exact(value,leadVehicleReviewFields));
  const {vehicleId,vin,plate,year,make,model}=value;
  check(optionalId(vehicleId)&&optionalHint(vin,128)&&optionalHint(plate,128)&&optionalYear(year)&&optionalHint(make,200)&&optionalHint(model,200));
  return Object.freeze({vehicleId,vin,plate,year,make,model});
}

function matchPage<T extends {id:string}>(value:unknown,more:unknown,parse:(row:unknown)=>T){
  check(typeof more==='boolean'&&Array.isArray(value)&&value.length<=5&&(!more||value.length===5));
  const rows=value.map(parse);
  check(rows.every((row,index)=>index===0||rows[index-1]!.id<row.id));
  return Object.freeze(rows);
}

function contactEvidence(value:Record<string,unknown>){
  const {phone,email}=value;
  check(typeof phone==='boolean'&&typeof email==='boolean'&&(phone||email));
  return {phone,email};
}

export function parseLeadContactReview(value:unknown,businessId:string,input:ReturnType<typeof parseLeadContactReviewInput>){
  check(exact(value,['schemaVersion','businessId','customers','leads','moreCustomers','moreLeads'])&&value.schemaVersion===1&&uuid(businessId)&&value.businessId===businessId);
  const customers=matchPage(value.customers,value.moreCustomers,row=>{
    check(exact(row,['id','label','archived','phone','email'])&&uuid(row.id)&&row.id!==input.customerId&&customerDisplayName(row.label)&&typeof row.archived==='boolean');
    return Object.freeze({id:row.id,label:row.label,archived:row.archived,...contactEvidence(row)});
  });
  const leads=matchPage(value.leads,value.moreLeads,row=>{
    check(exact(row,['id','label','state','phone','email'])&&uuid(row.id)&&row.id!==input.leadId&&isLeadLabel(row.label));
    const state=leadStates.find(state=>state===row.state);
    check(state);
    return Object.freeze({id:row.id,label:row.label,state,...contactEvidence(row)});
  });
  return Object.freeze({schemaVersion:1,businessId,customers,leads,moreCustomers:value.moreCustomers===true,moreLeads:value.moreLeads===true});
}

export function parseLeadVehicleReview(value:unknown,businessId:string,input:ReturnType<typeof parseLeadVehicleReviewInput>){
  check(exact(value,['schemaVersion','businessId','vehicles','hasMore'])&&value.schemaVersion===1&&uuid(businessId)&&value.businessId===businessId);
  const vehicles=matchPage(value.vehicles,value.hasMore,row=>{
    check(exact(row,['id','label','archived','vin','plate','description'])&&uuid(row.id)&&row.id!==input.vehicleId&&customerDisplayName(row.label));
    const {id,label,archived,vin,plate,description}=row;
    check(typeof archived==='boolean'&&typeof vin==='boolean'&&typeof plate==='boolean'&&typeof description==='boolean'&&(vin||plate||description));
    return Object.freeze({id,label,archived,vin,plate,description});
  });
  return Object.freeze({schemaVersion:1,businessId,vehicles,hasMore:value.hasMore===true});
}
