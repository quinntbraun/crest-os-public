import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseExportRequestReference,parseExportRequestRetirement} from './source-export-request-resolution.ts';

export const sourceExportBodyLimit=16384;
export const sourceExportReferenceWireKeys=Object.freeze(['originalJson'] as const);
export const sourceExportStatusWireKeys=Object.freeze(['exportJobId'] as const);
export const sourceExportRetirementWireKeys=Object.freeze(['schemaVersion','recoveryEpoch','originalJson','reason'] as const);
export class SourceExportWireError extends Error{constructor(){super('SOURCE_EXPORT_REQUEST_INPUT_REQUIRED');this.name='SourceExportWireError';}}
function require(value:unknown):asserts value{if(!value)throw new SourceExportWireError();}
function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
 const descriptors=Object.getOwnPropertyDescriptors(value);require(Reflect.ownKeys(descriptors).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&descriptors[key]!.enumerable&&Object.hasOwn(descriptors[key]!,'value')));
 return Object.fromEntries(keys.map(key=>[key,descriptors[key]!.value]));
}
function originalJson(value:unknown,businessId:string){
 try{
  require(uuid(businessId)&&typeof value==='string'&&new TextEncoder().encode(value).byteLength<=2048);
  const original=parseExportRequestReference(JSON.parse(value));
  // Two closed objects containing scalar fields. Raw separators must match
  // decoded fields, including escaped duplicate names at either level.
  require(original.businessId===businessId&&(value.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length===Object.keys(original).length+Object.keys(original.reference).length);
  return original;
 }catch{throw new SourceExportWireError();}
}
export function parseSourceExportReferenceWire(input:unknown,businessId:string){return originalJson(object(input,sourceExportReferenceWireKeys).originalJson,businessId);}
export function parseSourceExportStatusWire(input:unknown){const row=object(input,sourceExportStatusWireKeys);require(uuid(row.exportJobId));return row.exportJobId as string;}
export function parseSourceExportRetirementWire(input:unknown,businessId:string){
 try{const row=object(input,sourceExportRetirementWireKeys);return parseExportRequestRetirement({schemaVersion:row.schemaVersion,recoveryEpoch:row.recoveryEpoch,original:originalJson(row.originalJson,businessId),reason:row.reason});}catch{throw new SourceExportWireError();}
}
export function sourceExportReferenceToWire(input:unknown){try{return Object.freeze({originalJson:JSON.stringify(parseExportRequestReference(input))});}catch{throw new SourceExportWireError();}}
export function sourceExportRetirementToWire(input:unknown){
 try{const r=parseExportRequestRetirement(input),wire=Object.freeze({schemaVersion:1,recoveryEpoch:r.recoveryEpoch,originalJson:JSON.stringify(r.original),reason:r.reason});require(new TextEncoder().encode(JSON.stringify(wire)).byteLength<=sourceExportBodyLimit);return wire;}catch{throw new SourceExportWireError();}
}
