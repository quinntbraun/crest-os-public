import {customerUuid,customerVersion,exactCustomerObject as exact} from '../customer/customer-contract.ts';

export type ServiceDefinition=Readonly<{name:string;inclusions:string;exclusions:string;internalGuidance:string|null;rangeLowCents:string|null;rangeHighCents:string|null;estimatedSeconds:string|null}>;
export type ServiceVersion=Readonly<{sequence:string;definition:ServiceDefinition}>;
export type CatalogService=Readonly<{id:string;code:string;active:boolean;revision:string;versions:readonly ServiceVersion[]}>;
export type ServiceQuoteSnapshot=Readonly<{serviceId:string;serviceCode:string;serviceVersion:string;name:string;inclusions:string;exclusions:string}>;
export class ServiceCatalogError extends Error{readonly code:string;constructor(code:string){super(code);this.name='ServiceCatalogError';this.code=code;}}
const fail=(code:string):never=>{throw new ServiceCatalogError(code);};
function text(value:unknown,max:number,required=false,multiline=false):value is string{
 return typeof value==='string'&&[...value].length<=max&&(!required||value.trim().length>0)&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||multiline&&(n===9||n===10||n===13));});
}
const money=(value:unknown):value is string|null=>value===null||typeof value==='string'&&value===value.trim()&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
const definitionKeys=['name','inclusions','exclusions','internalGuidance','rangeLowCents','rangeHighCents','estimatedSeconds'] as const;
/** Data-only domain rules. This module grants no database/session authority. */
export function parseServiceDefinition(value:unknown):ServiceDefinition{
 if(!exact(value,definitionKeys)||!text(value.name,200,true)||!text(value.inclusions,4000,true,true)||!text(value.exclusions,4000,false,true)||!(value.internalGuidance===null||text(value.internalGuidance,4000,true,true)))return fail('definition');
 if(!money(value.rangeLowCents)||!money(value.rangeHighCents)||value.rangeHighCents!==null&&(value.rangeLowCents===null||BigInt(value.rangeHighCents)<BigInt(value.rangeLowCents)))return fail('range');
 if(!(value.estimatedSeconds===null||typeof value.estimatedSeconds==='string'&&value.estimatedSeconds===value.estimatedSeconds.trim()&&customerVersion(value.estimatedSeconds)))return fail('duration');
 return Object.freeze({...value}) as ServiceDefinition;
}
function sequence(value:unknown){if(typeof value!=='string'||value!==value.trim()||!customerVersion(value))return fail('version');return value;}
const next=(value:string)=>{const n=BigInt(value)+1n;return sequence(n.toString());};
export function serviceDurationInput(minutes:string,seconds:string):string|null{
 const m=minutes.trim(),s=seconds.trim();if(!m&&!s)return null;
 if(m&&!/^(0|[1-9][0-9]{0,17})$/.test(m)||s&&!/^(0|[1-9][0-9]?)$/.test(s)||BigInt(s||'0')>59n)return fail('duration');
 const value=(BigInt(m||'0')*60n+BigInt(s||'0')).toString();if(!customerVersion(value))return fail('duration');return value;
}
export function parseCatalogService(value:unknown):CatalogService{
 if(!exact(value,['id','code','active','revision','versions'])||!customerUuid(value.id)||value.id!==value.id.trim()||!text(value.code,80,true)||value.code!==value.code.trim()||! /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.code)||typeof value.active!=='boolean'||!Array.isArray(value.versions)||!value.versions.length||value.versions.length>1000)return fail('service');
 const revision=sequence(value.revision);
 const versions=value.versions.map((v,i)=>{if(!exact(v,['sequence','definition'])||v.sequence!==String(i+1))return fail('version');return Object.freeze({sequence:v.sequence,definition:parseServiceDefinition(v.definition)});});
 if(BigInt(revision)<BigInt(versions.length))return fail('version');
 return Object.freeze({id:value.id,code:value.code,active:value.active,revision,versions:Object.freeze(versions)});
}
export function createCatalogService(id:string,code:string,active:boolean,definition:ServiceDefinition):CatalogService{
 return parseCatalogService({id,code,active,revision:'1',versions:[{sequence:'1',definition}]});
}
export function reviseCatalogService(value:CatalogService,expectedRevision:string,definition:ServiceDefinition):CatalogService{
 const service=parseCatalogService(value);if(expectedRevision!==service.revision)return fail('stale');
 const draft=parseServiceDefinition(definition),current=service.versions.at(-1)!;
 if(definitionKeys.every(key=>draft[key]===current.definition[key]))return service;
 if(service.versions.length>=1000)return fail('capacity');
 return parseCatalogService({...service,revision:next(service.revision),versions:[...service.versions,{sequence:next(current.sequence),definition:draft}]});
}
export function setCatalogServiceActive(value:CatalogService,expectedRevision:string,active:boolean):CatalogService{
 const service=parseCatalogService(value);if(expectedRevision!==service.revision)return fail('stale');
 if(typeof active!=='boolean')return fail('service');
 return active===service.active?service:parseCatalogService({...service,active,revision:next(service.revision)});
}
/** Copy customer scope only. Guidance never supplies an offer amount. */
export function snapshotServiceForQuote(value:CatalogService,expectedRevision:string):ServiceQuoteSnapshot{
 const service=parseCatalogService(value);if(expectedRevision!==service.revision)return fail('stale');if(!service.active)return fail('inactive');
 const version=service.versions.at(-1)!,d=version.definition;
 return Object.freeze({serviceId:service.id,serviceCode:service.code,serviceVersion:version.sequence,name:d.name,inclusions:d.inclusions,exclusions:d.exclusions});
}
