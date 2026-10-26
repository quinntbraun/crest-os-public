import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseOriginalOperationReference,parseOriginalOperationRetirement,OriginalOperationReferenceError} from './original-operation-reference.ts';
import type {OriginalOperationReference,OriginalOperationRetirement} from './original-operation-reference.ts';

export const originalOperationLookupWireKeys=Object.freeze(['originalJson'] as const);
export const originalOperationRetirementWireKeys=Object.freeze(['schemaVersion','recoveryEpoch','originalJson','reason'] as const);
export const originalOperationBodyLimit=16384;
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw new OriginalOperationReferenceError();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).length!==keys.length||!keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')))throw new OriginalOperationReferenceError();
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
function originalJson(value:unknown,businessId:string):OriginalOperationReference{
 try{
  if(!uuid(businessId)||typeof value!=='string'||new TextEncoder().encode(value).byteLength>2048)throw new Error();
  const raw:unknown=JSON.parse(value),original=parseOriginalOperationReference(raw);
  // The strict contract has exactly two objects, with scalar reference values.
  // Count decoded fields against raw separators to reject duplicate/escaped
  // duplicate keys at either level before interpreting the original identity.
  const fields=Object.keys(original).length+Object.keys(original.reference).length;
  if(original.businessId!==businessId||(value.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==fields)throw new Error();
  return original;
 }catch{throw new OriginalOperationReferenceError();}
}
export function parseOriginalOperationLookupWire(value:unknown,businessId:string){
 const row=object(value,originalOperationLookupWireKeys);
 return originalJson(row.originalJson,businessId);
}
export function parseOriginalOperationRetirementWire(value:unknown,businessId:string){
 const row=object(value,originalOperationRetirementWireKeys);
 return parseOriginalOperationRetirement({schemaVersion:row.schemaVersion,recoveryEpoch:row.recoveryEpoch,original:originalJson(row.originalJson,businessId),reason:row.reason});
}
export function originalOperationLookupToWire(value:OriginalOperationReference){
 const original=parseOriginalOperationReference(value);
 return Object.freeze({originalJson:JSON.stringify(original)});
}
export function originalOperationRetirementToWire(value:OriginalOperationRetirement){
 const input=parseOriginalOperationRetirement(value),wire=Object.freeze({schemaVersion:1,recoveryEpoch:input.recoveryEpoch,originalJson:JSON.stringify(input.original),reason:input.reason});
 if(new TextEncoder().encode(JSON.stringify(wire)).byteLength>originalOperationBodyLimit)throw new OriginalOperationReferenceError();
 return wire;
}
