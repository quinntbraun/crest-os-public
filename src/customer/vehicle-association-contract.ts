import {customerUuid as uuid,customerInstant as instant,exactCustomerObject as exact,requireCustomer as check} from './customer-contract.ts';
import {parseVehicleAssociation,parseVehicleAssociationClose} from './customer-resource-contract.ts';

// Data boundary for the next genuine source. This does not establish parent
// existence, authorize access or substitute for transactional DB constraints.
export const associationColumns=['id','business_id','customer_id','vehicle_id','valid_from','valid_to','relationship','is_billing','evidence','close_reason','closed_at','closed_by','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type VehicleAssociationRow=Readonly<{id:string;business_id:string;customer_id:string;vehicle_id:string;valid_from:string;valid_to:string|null;relationship:'owner'|'keeper';is_billing:boolean;evidence:string|null;close_reason:string|null;closed_at:string|null;closed_by:string|null;version:'1'|'2';created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export function parseAssociation(value:unknown,businessId:string):VehicleAssociationRow{
  check(exact(value,associationColumns)&&uuid(businessId)&&value.business_id===businessId&&uuid(value.id)&&typeof value.is_billing==='boolean'&&uuid(value.created_by)&&uuid(value.updated_by)&&uuid(value.operation_id)&&(value.import_row_id===null||uuid(value.import_row_id))&&['manual','import','system'].includes(value.origin as string));
  parseVehicleAssociation({customerId:value.customer_id,vehicleId:value.vehicle_id,validFrom:value.valid_from,relationship:value.relationship,evidence:value.evidence});
  check(instant(value.created_at)&&instant(value.updated_at)&&value.updated_at>=value.created_at);
  if(value.valid_to===null){
    check(value.version==='1'&&value.closed_at===null&&value.closed_by===null&&value.close_reason===null&&value.updated_at===value.created_at&&value.updated_by===value.created_by);
  }else{
    parseVehicleAssociationClose({associationId:value.id,validTo:value.valid_to,reason:value.close_reason});
    check(value.version==='2'&&(value.valid_to as string)>=(value.valid_from as string)&&instant(value.closed_at)&&value.closed_at===value.updated_at&&uuid(value.closed_by)&&value.closed_by===value.updated_by);
  }
  return Object.freeze({...value}) as VehicleAssociationRow;
}
const immutable=['id','business_id','customer_id','vehicle_id','valid_from','relationship','is_billing','evidence','created_at','created_by','origin','import_row_id'] as const;
export function associationClose(before:unknown,after:unknown,businessId:string){
  const previous=parseAssociation(before,businessId),closed=parseAssociation(after,businessId);
  check(previous.valid_to===null&&closed.valid_to!==null&&immutable.every(k=>previous[k]===closed[k])&&closed.operation_id!==previous.operation_id&&closed.updated_at>=previous.updated_at);
  return Object.freeze({before:previous,after:closed});
}
export function associationTransfer(before:unknown,after:unknown,next:unknown,businessId:string){
  const closed=associationClose(before,after,businessId),opened=parseAssociation(next,businessId);
  check(opened.id!==closed.before.id&&opened.valid_to===null&&opened.vehicle_id===closed.before.vehicle_id&&opened.valid_from===closed.after.valid_to&&opened.operation_id===closed.after.operation_id&&opened.created_by===closed.after.closed_by);
  return Object.freeze({closed,opened});
}
// Explicit UTC microseconds sort exactly. Never round periods through Date.
// Periods are [from,to): an atomic transfer can meet at one instant; a zero
// length closed period contains no instant and excludes no other period.
export function associationContains(value:unknown,businessId:string,at:string):boolean{
  const row=parseAssociation(value,businessId);check(instant(at));
  return row.valid_from<=at&&(row.valid_to===null||at<row.valid_to);
}
function overlap(a:VehicleAssociationRow,b:VehicleAssociationRow){
  if(a.vehicle_id!==b.vehicle_id||a.valid_from===a.valid_to||b.valid_from===b.valid_to)return false;
  return (b.valid_to===null||a.valid_from<b.valid_to)&&(a.valid_to===null||b.valid_from<a.valid_to);
}
export function ownerPeriodsOverlap(left:unknown,right:unknown,businessId:string):boolean{
  const a=parseAssociation(left,businessId),b=parseAssociation(right,businessId);
  return a.relationship==='owner'&&b.relationship==='owner'&&overlap(a,b);
}
// Billing selection is an explicit independent fact, never inferred from
// owner/keeper or directory identity. It does not create a bill or job link.
export function billingPeriodsOverlap(left:unknown,right:unknown,businessId:string):boolean{
  const a=parseAssociation(left,businessId),b=parseAssociation(right,businessId);
  return a.is_billing&&b.is_billing&&overlap(a,b);
}
