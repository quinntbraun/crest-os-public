// P08 operating modes, shared data boundary only. This grants no booking,
// custody or transport authority. Initial policy is the canonical owner decision.
import {customerInstant,customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';

export const fulfillmentModes=['mobile','dropoff','pickup_return'] as const;
export type FulfillmentMode=typeof fulfillmentModes[number];
export type FulfillmentModePayload=Readonly<{mobileEnabled:boolean;dropoffEnabled:boolean;pickupReturnEnabled:boolean;reason:string|null}>;
export const initialFulfillmentModes:FulfillmentModePayload=Object.freeze({mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:false,reason:null});
export const fulfillmentModeColumns=['id','business_id','sequence','replaces_sequence','mobile_enabled','dropoff_enabled','pickup_return_enabled','reason','created_at','created_by','operation_id','origin'] as const;
export type FulfillmentModeVersion=Readonly<{id:string;business_id:string;sequence:string;replaces_sequence:string|null;mobile_enabled:boolean;dropoff_enabled:boolean;pickup_return_enabled:boolean;reason:string|null;created_at:string;created_by:string;operation_id:string;origin:'manual'}>;
export type FulfillmentModeSave=Readonly<{schemaVersion:1;businessId:string;operationId:string;recoveryEpoch:string;expectedSequence:string;payload:FulfillmentModePayload}>;
export class FulfillmentModeDataError extends Error{constructor(){super('FULFILLMENT_MODE_DATA_INVALID');this.name='FulfillmentModeDataError';}}
function requireMode(value:unknown):asserts value{if(!value)throw new FulfillmentModeDataError();}
function reason(value:unknown):value is string{
 return typeof value==='string'&&[...value].length>=1&&[...value].length<=1000&&value.trim().length>0&&[...value].every(character=>{const n=character.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);});
}
export function parseFulfillmentModePayload(value:unknown):FulfillmentModePayload{
 requireMode(exact(value,['mobileEnabled','dropoffEnabled','pickupReturnEnabled','reason']));
 requireMode(typeof value.mobileEnabled==='boolean'&&typeof value.dropoffEnabled==='boolean'&&typeof value.pickupReturnEnabled==='boolean'&&(value.reason===null||reason(value.reason)));
 return Object.freeze({...value}) as FulfillmentModePayload;
}
function initial(value:FulfillmentModePayload){return value.mobileEnabled&&value.dropoffEnabled&&!value.pickupReturnEnabled&&value.reason===null;}
export function parseFulfillmentModeSave(value:unknown):FulfillmentModeSave{
 requireMode(exact(value,['schemaVersion','businessId','operationId','recoveryEpoch','expectedSequence','payload'])&&value.schemaVersion===1&&[value.businessId,value.operationId,value.recoveryEpoch].every(customerUuid)&&customerVersion(value.expectedSequence,true)&&BigInt(value.expectedSequence)<9223372036854775807n);
 const payload=parseFulfillmentModePayload(value.payload);
 requireMode(value.expectedSequence==='0'?initial(payload):payload.reason!==null);
 return Object.freeze({...value,payload}) as FulfillmentModeSave;
}
export function parseFulfillmentModeVersion(value:unknown,businessId:string):FulfillmentModeVersion{
 requireMode(exact(value,fulfillmentModeColumns)&&customerUuid(businessId)&&value.business_id===businessId&&[value.id,value.created_by,value.operation_id].every(customerUuid)&&customerVersion(value.sequence)&&customerInstant(value.created_at)&&value.origin==='manual');
 const payload=parseFulfillmentModePayload({mobileEnabled:value.mobile_enabled,dropoffEnabled:value.dropoff_enabled,pickupReturnEnabled:value.pickup_return_enabled,reason:value.reason});
 requireMode(value.sequence==='1'?value.replaces_sequence===null&&initial(payload):customerVersion(value.replaces_sequence)&&BigInt(value.replaces_sequence)+1n===BigInt(value.sequence)&&payload.reason!==null);
 return Object.freeze({...value}) as FulfillmentModeVersion;
}
export function enabledFulfillmentModes(value:FulfillmentModePayload):readonly FulfillmentMode[]{
 const p=parseFulfillmentModePayload(value);
 return Object.freeze(fulfillmentModes.filter(mode=>mode==='mobile'?p.mobileEnabled:mode==='dropoff'?p.dropoffEnabled:p.pickupReturnEnabled));
}
export function parseFulfillmentModeCommitted(value:unknown,businessId:string,operationId:string){
 requireMode(customerUuid(businessId)&&customerUuid(operationId)&&exact(value,['state','operationId','recoveryEpoch','receipt'])&&value.state==='committed'&&value.operationId===operationId&&customerUuid(value.recoveryEpoch)&&exact(value.receipt,['schemaVersion','businessId','sequence','versionId','auditEventId']));
 const r=value.receipt;requireMode(r.schemaVersion===1&&r.businessId===businessId&&customerVersion(r.sequence)&&customerUuid(r.versionId)&&customerUuid(r.auditEventId));
 return Object.freeze({state:'committed' as const,operationId,recoveryEpoch:value.recoveryEpoch,receipt:Object.freeze({...r}) as Readonly<{schemaVersion:1;businessId:string;sequence:string;versionId:string;auditEventId:string}>});
}
export function parseFulfillmentModeHistory(value:unknown,businessId:string,afterSequence:string,pageSize:number){
 requireMode(customerUuid(businessId)&&customerVersion(afterSequence,true)&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=20);
 if(exact(value,['state'])&&value.state==='absent')return Object.freeze({state:'absent' as const});
 requireMode(exact(value,['schemaVersion','businessId','currentSequence','versions','hasMore'])&&value.schemaVersion===1&&value.businessId===businessId&&customerVersion(value.currentSequence)&&Array.isArray(value.versions)&&typeof value.hasMore==='boolean');
 let prior=BigInt(afterSequence);
 const versions=value.versions.map(row=>{const v=parseFulfillmentModeVersion(row,businessId);requireMode(BigInt(v.sequence)===prior+1n&&BigInt(v.sequence)<=BigInt(value.currentSequence as string));prior=BigInt(v.sequence);return v;});
 const remaining=BigInt(value.currentSequence)>BigInt(afterSequence)?BigInt(value.currentSequence)-BigInt(afterSequence):0n;
 requireMode(BigInt(versions.length)===(remaining>BigInt(pageSize)?BigInt(pageSize):remaining)&&value.hasMore===(remaining>BigInt(pageSize)));
 return Object.freeze({schemaVersion:1 as const,businessId,currentSequence:value.currentSequence,versions:Object.freeze(versions),hasMore:value.hasMore});
}
