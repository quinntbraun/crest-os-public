import {customerUuid,customerVersion,customerInstant,exactCustomerObject,requireCustomer} from './customer-contract.ts';
import {parseVehicleDraft,vehicleVinHint} from './customer-resource-contract.ts';
import type {VehicleDraft} from './customer-resource-contract.ts';
export const vehicleColumns=['id','business_id','label','year','make','model','color','vin_raw','vin_normalized','plate','kind','notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] as const;
export type Vehicle=Readonly<{id:string;business_id:string;label:string;year:number|null;make:string|null;model:string|null;color:string|null;vin_raw:string|null;vin_normalized:string|null;plate:string|null;kind:'customer_vehicle'|'business_rig'|'other';notes:string|null;archived_at:string|null;archived_reason:string|null;version:string;created_at:string;updated_at:string;created_by:string;updated_by:string;origin:'manual'|'import'|'system';operation_id:string;import_row_id:string|null}>;
export function draftFromVehicle(row:Vehicle):VehicleDraft{return parseVehicleDraft({label:row.label,year:row.year,make:row.make,model:row.model,color:row.color,vin:row.vin_raw,plate:row.plate,kind:row.kind,notes:row.notes,archived:row.archived_at!==null,archiveReason:row.archived_reason});}
export function parseVehicle(value:unknown,businessId:string):Vehicle{
 requireCustomer(exactCustomerObject(value,vehicleColumns)&&customerUuid(businessId)&&value.business_id===businessId&&customerUuid(value.id)&&customerVersion(value.version)&&customerUuid(value.created_by)&&customerUuid(value.updated_by)&&customerUuid(value.operation_id)&&(value.import_row_id===null||customerUuid(value.import_row_id))&&['manual','import','system'].includes(value.origin as string));
 const row=value as Vehicle;draftFromVehicle(row);requireCustomer(row.vin_normalized===vehicleVinHint(row.vin_raw)&&customerInstant(row.created_at)&&customerInstant(row.updated_at)&&row.updated_at>=row.created_at&&(row.archived_at===null||customerInstant(row.archived_at)));
 return Object.freeze({...row});
}
