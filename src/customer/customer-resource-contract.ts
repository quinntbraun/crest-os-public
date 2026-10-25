import {customerUuid,customerInstant,requireCustomer,exactCustomerObject} from './customer-contract.ts';

export type VehicleDraft=Readonly<{label:string;year:number|null;make:string|null;model:string|null;color:string|null;vin:string|null;plate:string|null;kind:'customer_vehicle'|'business_rig'|'other';notes:string|null;archived:boolean;archiveReason:string|null}>;
export type AddressDraft=Readonly<{line1:string|null;line2:string|null;city:string|null;region:string|null;postalCode:string|null;country:string|null;exactLocationText:string|null;instructions:string|null;latitude:string|null;longitude:string|null;geocodeSource:string|null;geocodeAccuracy:string|null;verifiedAt:string|null;archived:boolean;archiveReason:string|null}>;
export type VehicleAssociation=Readonly<{customerId:string;vehicleId:string;validFrom:string;relationship:'owner'|'keeper';evidence:string|null}>;
export type VehicleAssociationClose=Readonly<{associationId:string;validTo:string;reason:string}>;

function text(value:unknown,limit:number,empty=true,multiline=false):value is string{
  return typeof value==='string'&&[...value].length<=limit&&(empty||value.trim().length>0)&&[...value].every(c=>{const n=c.codePointAt(0)!;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&!(n<32||n===127)||multiline&&(n===9||n===10||n===13);});
}
const optional=(value:unknown,limit:number,empty=true,multiline=false):value is string|null=>value===null||text(value,limit,empty,multiline);
function archive(archived:unknown,reason:unknown){return typeof archived==='boolean'&&(archived?text(reason,1000,false,true):reason===null);}

// Search hint only: retain VIN input separately, permit shared/unusual values,
// and never use this hint as vehicle identity or a uniqueness constraint.
export function vehicleVinHint(raw:string|null):string|null{return raw===null?null:raw.replace(/[^A-Za-z0-9]/g,'').toUpperCase()||null;}

export function parseVehicleDraft(value:unknown):VehicleDraft{
  requireCustomer(exactCustomerObject(value,['label','year','make','model','color','vin','plate','kind','notes','archived','archiveReason']));
  requireCustomer(text(value.label,200,false)&&(value.year===null||typeof value.year==='number'&&Number.isInteger(value.year)&&value.year>=-2147483648&&value.year<=2147483647)
    &&optional(value.make,200,false)&&optional(value.model,200,false)&&optional(value.color,128,false)&&optional(value.vin,128,false)&&optional(value.plate,128,false)
    &&['customer_vehicle','business_rig','other'].includes(value.kind as string)&&optional(value.notes,2000,true,true)&&archive(value.archived,value.archiveReason));
  return Object.freeze({...value}) as VehicleDraft;
}

// Numeric strings preserve decimal precision for PostgreSQL NUMERIC. Never
// round through Number or accept exponent notation, NaN or Infinity.
export function resourceCoordinate(value:unknown,limit:90|180):value is string{
  if(typeof value!=='string'||value.length>128||!(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/).test(value))return false;
  const [integer,fraction='']=value.replace(/^-/,'').split('.'),whole=BigInt(integer!);
  return whole<BigInt(limit)||whole===BigInt(limit)&&!/[1-9]/.test(fraction);
}

export function parseAddressDraft(value:unknown):AddressDraft{
  requireCustomer(exactCustomerObject(value,['line1','line2','city','region','postalCode','country','exactLocationText','instructions','latitude','longitude','geocodeSource','geocodeAccuracy','verifiedAt','archived','archiveReason']));
  requireCustomer(optional(value.line1,512)&&optional(value.line2,512)&&optional(value.city,200)&&optional(value.region,200)&&optional(value.postalCode,128)&&optional(value.country,200)
    &&optional(value.exactLocationText,2000,true,true)&&optional(value.instructions,2000,true,true)&&optional(value.geocodeSource,200)&&optional(value.geocodeAccuracy,200)
    &&(value.verifiedAt===null||customerInstant(value.verifiedAt))&&archive(value.archived,value.archiveReason));
  requireCustomer(value.latitude===null&&value.longitude===null||resourceCoordinate(value.latitude,90)&&resourceCoordinate(value.longitude,180));
  const zeroSign=(coordinate:unknown)=>typeof coordinate==='string'&&/^-0(?:\.0+)?$/.test(coordinate)?coordinate.slice(1):coordinate;
  return Object.freeze({...value,latitude:zeroSign(value.latitude),longitude:zeroSign(value.longitude)}) as AddressDraft;
}

export function parseVehicleAssociation(value:unknown):VehicleAssociation{
  requireCustomer(exactCustomerObject(value,['customerId','vehicleId','validFrom','relationship','evidence'])&&customerUuid(value.customerId)&&customerUuid(value.vehicleId)
    &&customerInstant(value.validFrom)&&['owner','keeper'].includes(value.relationship as string)&&optional(value.evidence,2000,true,true));
  return Object.freeze({...value}) as VehicleAssociation;
}
export function parseVehicleAssociationClose(value:unknown):VehicleAssociationClose{
  requireCustomer(exactCustomerObject(value,['associationId','validTo','reason'])&&customerUuid(value.associationId)&&customerInstant(value.validTo)&&text(value.reason,1000,false,true));
  return Object.freeze({...value}) as VehicleAssociationClose;
}
