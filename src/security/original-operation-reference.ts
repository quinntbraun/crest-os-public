import {customerUuid as uuid,customerVersion as version,customerInstant as instant} from '../customer/customer-contract';

type Common=Readonly<{operationId:string;recoveryEpoch:string}>;
type Targets={
 'business.rename':Readonly<{expectedVersion:string}>;
 'crm.customer.save':Readonly<{customerId:string;expectedVersion:string}>;
 'crm.address.save':Readonly<{customerId:string;addressId:string;expectedVersion:string}>;
 'crm.vehicle.save':Readonly<{vehicleId:string;expectedVersion:string}>;
 'crm.vehicle.association':Readonly<{action:'open'|'close'|'transfer';associationId:string;vehicleId:string;expectedVersion:'0'|'1';nextAssociationId:string|null}>;
 'crm.lead.source.save':Readonly<{leadSourceId:string;expectedVersion:string}>;
 'crm.lead.save':Readonly<{leadId:string;expectedVersion:string}>;
 'crm.lead.state':Readonly<{leadId:string;expectedVersion:string}>;
 'crm.lead.vehicle.save':Readonly<{leadId:string;leadVehicleId:string;expectedVersion:string}>;
 'crm.lead.address.save':Readonly<{leadId:string;leadAddressId:string;expectedVersion:string}>;
 'crm.lead.convert':Readonly<{conversionId:string;leadId:string;expectedLeadVersion:string;customerId:string}>;
};
export type OriginalOperationKind=keyof Targets;
export type OriginalOperationReference={
 [K in OriginalOperationKind]:Readonly<{schemaVersion:1;businessId:string;commandType:K;reference:Common&Targets[K]}>
}[OriginalOperationKind];
export type OriginalOperationRetirement=Readonly<{schemaVersion:1;recoveryEpoch:string;original:OriginalOperationReference;reason:string}>;
export type OriginalOperationOutcome=
 |Readonly<{schemaVersion:1;state:'original_recorded';original:OriginalOperationReference}>
 |Readonly<{schemaVersion:1;state:'retired';original:OriginalOperationReference;retirement:Readonly<{operationRowId:string;auditEventId:string;recoveryEpoch:string;reason:string;recordedAt:string}>}>;

export class OriginalOperationReferenceError extends Error{constructor(){super('ORIGINAL_OPERATION_REVIEW_REQUIRED');this.name='OriginalOperationReferenceError';}}
function require(value:unknown):asserts value{if(!value)throw new OriginalOperationReferenceError();}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 require(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
 const descriptors=Object.getOwnPropertyDescriptors(value);
 require(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
const fields={
 'business.rename':['expectedVersion'],
 'crm.customer.save':['customerId','expectedVersion'],
 'crm.address.save':['customerId','addressId','expectedVersion'],
 'crm.vehicle.save':['vehicleId','expectedVersion'],
 'crm.vehicle.association':['action','associationId','vehicleId','expectedVersion','nextAssociationId'],
 'crm.lead.source.save':['leadSourceId','expectedVersion'],
 'crm.lead.save':['leadId','expectedVersion'],
 'crm.lead.state':['leadId','expectedVersion'],
 'crm.lead.vehicle.save':['leadId','leadVehicleId','expectedVersion'],
 'crm.lead.address.save':['leadId','leadAddressId','expectedVersion'],
 'crm.lead.convert':['conversionId','leadId','expectedLeadVersion','customerId']
} as const satisfies Record<OriginalOperationKind,readonly string[]>;
export const originalOperationKinds=Object.freeze(Object.keys(fields) as OriginalOperationKind[]);
function reason(value:unknown):asserts value is string{
 require(typeof value==='string'&&value.length<=4000&&[...value].length<=2000&&value.trim().length>0);
 require([...value].every(c=>{const n=c.codePointAt(0)!;return n!==0&&!(n>=0xd800&&n<=0xdfff)&&!(n<32||n===127)||n===9||n===10||n===13;}));
}

// Original IDs/versions only. No draft reconstruction, credentials, permission,
// sign-in binding, caller-supplied actor, financial command or replacement ID.
// This is a pure contract: no storage, database, network or retirement action.
export function parseOriginalOperationReference(value:unknown):OriginalOperationReference{
 try{
  const row=object(value,['schemaVersion','businessId','commandType','reference']);
  require(row.schemaVersion===1&&uuid(row.businessId)&&typeof row.commandType==='string'&&Object.hasOwn(fields,row.commandType));
  const kind=row.commandType as OriginalOperationKind,keys=['operationId','recoveryEpoch',...fields[kind]],ref=object(row.reference,keys);
  require(uuid(ref.operationId)&&uuid(ref.recoveryEpoch));
  for(const key of fields[kind]){
   if(key==='expectedVersion')require(version(ref[key],kind!=='business.rename'&&kind!=='crm.lead.state'));
   else if(key==='expectedLeadVersion')require(version(ref[key]));
   else if(key!=='action'&&key!=='nextAssociationId')require(uuid(ref[key]));
  }
  if(kind==='crm.vehicle.association')require(['open','close','transfer'].includes(ref.action as string)&&ref.expectedVersion===(ref.action==='open'?'0':'1')&&(ref.action==='transfer'?uuid(ref.nextAssociationId)&&ref.nextAssociationId!==ref.associationId:ref.nextAssociationId===null));
  return Object.freeze({schemaVersion:1,businessId:row.businessId,commandType:kind,reference:Object.freeze(ref)}) as OriginalOperationReference;
 }catch{throw new OriginalOperationReferenceError();}
}
export function parseOriginalOperationRetirement(value:unknown):OriginalOperationRetirement{
 try{
  const row=object(value,['schemaVersion','recoveryEpoch','original','reason']);
  require(row.schemaVersion===1&&uuid(row.recoveryEpoch));reason(row.reason);
  // The fresh authority epoch is separate from the retained original epoch.
  return Object.freeze({schemaVersion:1,recoveryEpoch:row.recoveryEpoch,original:parseOriginalOperationReference(row.original),reason:row.reason});
 }catch{throw new OriginalOperationReferenceError();}
}
export function parseOriginalOperationOutcome(value:unknown,expected:OriginalOperationReference):OriginalOperationOutcome{
 try{
  require(value!==null&&typeof value==='object'&&Object.hasOwn(value,'state'));
  const descriptor=Object.getOwnPropertyDescriptor(value,'state');require(descriptor&&Object.hasOwn(descriptor,'value'));
  const retired=descriptor.value==='retired',row=object(value,retired?['schemaVersion','state','original','retirement']:['schemaVersion','state','original']);
  require(row.schemaVersion===1&&(retired||row.state==='original_recorded'));
  const original=parseOriginalOperationReference(row.original),pinned=parseOriginalOperationReference(expected);
  require(JSON.stringify(original)===JSON.stringify(pinned));
  // This observation alone NEVER authorizes clearing the original reference.
  // Its existing typed domain lookup must still verify the original receipt.
  if(!retired)return Object.freeze({schemaVersion:1,state:'original_recorded',original});
  const receipt=object(row.retirement,['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']);
  require(uuid(receipt.operationRowId)&&uuid(receipt.auditEventId)&&uuid(receipt.recoveryEpoch)&&instant(receipt.recordedAt));reason(receipt.reason);
  return Object.freeze({schemaVersion:1,state:'retired',original,retirement:Object.freeze(receipt)}) as OriginalOperationOutcome;
 }catch{throw new OriginalOperationReferenceError();}
}
export function bindOriginalOperationRetirement(value:unknown,input:OriginalOperationRetirement):OriginalOperationOutcome{
 const intent=parseOriginalOperationRetirement(input),outcome=parseOriginalOperationOutcome(value,intent.original);
 if(outcome.state==='retired')require(outcome.retirement.recoveryEpoch===intent.recoveryEpoch&&outcome.retirement.reason===intent.reason);
 return outcome;
}
