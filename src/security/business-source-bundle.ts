import 'server-only';
import {createHash} from 'node:crypto';
import {formatBusinessFoundationBundle} from './business-foundation-bundle.ts';
import type {BusinessSourceCapture} from './business-foundation-collector.ts';
import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';
import {parseCustomer} from '../customer/customer-contract.ts';
import {parseCustomerAddress} from '../customer/customer-address-contract.ts';
import {parseVehicle} from '../customer/vehicle-contract.ts';
import {parseAssociation} from '../customer/vehicle-association-contract.ts';
import {parseLead,parseLeadSource} from '../customer/lead-contract.ts';
import {parseLeadEvent} from '../customer/lead-state-contract.ts';
import {parseLeadVehicle} from '../customer/lead-vehicle-contract.ts';
import {parseLeadAddress} from '../customer/lead-address-contract.ts';
import {parseLeadConversionRecord,parseConversionLink,parseLeadConversionCollection} from '../customer/lead-conversion-record.ts';
import {formatCustomerCsv} from '../customer/customer-csv.ts';
import {formatCustomerAddressCsv} from '../customer/customer-address-csv.ts';
import {formatVehicleCsv} from '../customer/vehicle-csv.ts';
import {formatVehicleAssociationCsv} from '../customer/vehicle-association-csv.ts';
import {formatLeadCsv,formatLeadSourceCsv,formatLeadEventCsv} from '../customer/lead-csv.ts';
import {formatLeadVehicleCsv} from '../customer/lead-vehicle-csv.ts';
import {formatLeadAddressCsv} from '../customer/lead-address-csv.ts';
import {formatLeadConversionCsv} from '../customer/lead-conversion-csv.ts';

type Formatted=Readonly<{csv:string;escapeMap:string;dictionary:string;manifest:string}>;
type Snapshot<T>=Readonly<{businessId:string;snapshotToken:string;expectedRowCount:string;rows:readonly T[]}>;
function formatter<T>(parse:(value:unknown,businessId:string)=>T,format:(input:Snapshot<T>)=>Formatted){
 return (input:Snapshot<unknown>)=>format({...input,rows:input.rows.map(row=>parse(row,input.businessId))});
}
const sources={
 customers:{scope:'customer_directory',field:'customers',prefix:'customers',parse:parseCustomer,format:formatter(parseCustomer,formatCustomerCsv)},
 addresses:{scope:'address_directory',field:'addresses',prefix:'addresses',parse:parseCustomerAddress,format:formatter(parseCustomerAddress,formatCustomerAddressCsv)},
 vehicles:{scope:'vehicle_directory',field:'vehicles',prefix:'vehicles',parse:parseVehicle,format:formatter(parseVehicle,formatVehicleCsv)},
 associations:{scope:'vehicle_associations',field:'associations',prefix:'associations',parse:parseAssociation,format:formatter(parseAssociation,formatVehicleAssociationCsv)},
 leadSources:{scope:'lead_source_directory',field:'lead_sources',prefix:'lead_sources',parse:parseLeadSource,format:formatter(parseLeadSource,formatLeadSourceCsv)},
 leads:{scope:'lead_directory',field:'leads',prefix:'leads',parse:parseLead,format:formatter(parseLead,formatLeadCsv)},
 leadEvents:{scope:'lead_state_events',field:'events',prefix:'lead_events',parse:parseLeadEvent,format:formatter(parseLeadEvent,formatLeadEventCsv)},
 leadVehicles:{scope:'lead_vehicle_intake',field:'leadVehicles',prefix:'lead_vehicles',parse:parseLeadVehicle,format:formatter(parseLeadVehicle,formatLeadVehicleCsv)},
 leadAddresses:{scope:'lead_address_intake',field:'leadAddresses',prefix:'lead_addresses',parse:parseLeadAddress,format:formatter(parseLeadAddress,formatLeadAddressCsv)},
 conversions:{scope:'lead_conversion',field:'conversions',prefix:'conversions',parse:parseLeadConversionRecord},
 links:{scope:'lead_conversion',field:'links',prefix:'links',parse:parseConversionLink}
} as const;
type Name=keyof typeof sources;
type Context=Readonly<{schemaVersion:1;scope:string;businessId:string;snapshotToken:string;rowCount?:string;conversionCount?:string;linkCount?:string}>;
type Part=Readonly<{name:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';content:string;bytes:number;sha256:string}>;
type Result=Readonly<{parts:readonly Part[];manifest:string}>;
export type BusinessSourceBundle=Readonly<{forServer:()=>Result;toJSON:()=>never}>;
export class BusinessSourceBundleError extends Error{constructor(){super('BUSINESS_SOURCE_BUNDLE_REVIEW_REQUIRED');this.name='BusinessSourceBundleError';}}
const names=Object.keys(sources) as Name[],contextNames=names.filter(name=>name!=='links');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/;
const maxPart=8*1024*1024,maxBytes=64*1024*1024;
function require(value:unknown):asserts value{if(!value)throw new BusinessSourceBundleError();}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function json(value:unknown,limit:number):{text:string;bytes:number;value:unknown}{
 require(typeof value==='string'&&value.length>0&&value.length<=limit&&!value.includes('\0'));
 const bytes=Buffer.byteLength(value);require(bytes<=limit&&Buffer.from(value).toString()===value);
 const decoded:unknown=JSON.parse(value);require(historyJsonEqual(parseHistoryJson(value),parseHistoryJson(JSON.stringify(decoded))));return {text:value,bytes,value:decoded};
}
function count(value:unknown):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(value)&&Number(value)<=1000;}
function references(rows:Record<Name,Record<string,unknown>[]>,businessId:string){
 const ids=Object.fromEntries(names.map(name=>[name,new Set(rows[name].map(row=>row.id))])) as Record<Name,Set<unknown>>;
 const fields:Partial<Record<Name,Record<string,Name>>>={addresses:{customer_id:'customers'},associations:{customer_id:'customers',vehicle_id:'vehicles'},leadSources:{referral_customer_id:'customers'},leads:{customer_id:'customers',source_id:'leadSources'},leadEvents:{lead_id:'leads'},leadVehicles:{lead_id:'leads',vehicle_id:'vehicles'},leadAddresses:{lead_id:'leads'},conversions:{lead_id:'leads',customer_id:'customers'},links:{conversion_id:'conversions',lead_id:'leads',lead_vehicle_id:'leadVehicles',vehicle_id:'vehicles',lead_address_id:'leadAddresses',address_id:'addresses'}};
 for(const name of names)for(const row of rows[name])for(const [field,target]of Object.entries(fields[name]??{}))require(row[field]===null||ids[target].has(row[field]));
 parseLeadConversionCollection(rows.conversions,rows.links,businessId);
 const leadVehicles=new Map(rows.leadVehicles.map(row=>[row.id,row.lead_id])),leadAddresses=new Map(rows.leadAddresses.map(row=>[row.id,row.lead_id])),addresses=new Map(rows.addresses.map(row=>[row.id,row.customer_id])),parents=new Map(rows.conversions.map(row=>[row.id,row.customer_id]));
 for(const link of rows.links)require(link.lead_vehicle_id!==null?leadVehicles.get(link.lead_vehicle_id)===link.lead_id:leadAddresses.get(link.lead_address_id)===link.lead_id&&addresses.get(link.address_id)===parents.get(link.conversion_id));
}

// Internal formatting only. Source claims and unkeyed hashes cannot establish
// authenticity, owner authorization, durable custody or a Ready export job.
export function formatBusinessSourceBundle(capture:BusinessSourceCapture,expected:Readonly<{businessId:string;appReleaseId:string;sourceSchemaVersion:42}>):BusinessSourceBundle{
 require(expected&&expected.sourceSchemaVersion===42);
 return formatSourceProjection(capture,expected);
}
// Explicit forward43 subprofile. Never pass this projection to the schema42
// worker: it is only one component of the proposed joint journal package.
export function formatBusinessSourceProjection43(capture:ReturnType<BusinessSourceCapture['forServer']>&Readonly<{sourceSchemaVersion:43}>,expected:Readonly<{businessId:string;appReleaseId:string;sourceSchemaVersion:43}>){
 require(capture&&capture.sourceSchemaVersion===43&&expected&&expected.sourceSchemaVersion===43);
 const {sourceSchemaVersion:declared,...source}=capture;require(declared===43);
 const result=formatSourceProjection({forServer:()=>source,toJSON():never{throw new BusinessSourceBundleError();}},expected).forServer();
 return Object.freeze({forProjection43:()=>result,toJSON():never{throw new BusinessSourceBundleError();}});
}
function formatSourceProjection(capture:BusinessSourceCapture,expected:Readonly<{businessId:string;appReleaseId:string;sourceSchemaVersion:42|43}>):BusinessSourceBundle{
 try{
  const binding={businessId:expected.businessId,appReleaseId:expected.appReleaseId,sourceSchemaVersion:expected.sourceSchemaVersion},source={...capture.forServer()};
  require(typeof binding.businessId==='string'&&uuid.test(binding.businessId)&&typeof binding.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&(binding.sourceSchemaVersion===42||binding.sourceSchemaVersion===43));
  require(exact(source,['formatVersion','generationId','businessId','observedAt','capture','configuration','identity','history','crm','evidenceBytes','recordCount','completePortableExport','completeBackup'])&&source.formatVersion===1&&source.businessId===binding.businessId&&typeof source.generationId==='string'&&uuid.test(source.generationId)&&source.capture==='single_connection_repeatable_read'&&source.completePortableExport===false&&source.completeBackup===false);
  const serialized=[source.configuration,source.identity,source.history,source.crm];require(serialized.every(text=>typeof text==='string'&&text.length<=maxBytes)&&serialized.reduce((n,text)=>n+Buffer.byteLength(text),0)<=maxBytes);
  const foundation=formatBusinessFoundationBundle(source,binding).forServer(),foundationManifest=JSON.parse(foundation.manifest);
  require(foundationManifest.generationId===source.generationId&&foundationManifest.observedAt===source.observedAt);
  const raw=json(source.crm,maxBytes),crm=raw.value;
  require(exact(crm,['formatVersion','generationId','businessId','observedAt','contexts','pages','evidenceBytes','recordCount','completePortableExport','completeBackup'])&&crm.formatVersion===1&&crm.generationId===source.generationId&&crm.businessId===binding.businessId&&crm.observedAt===source.observedAt&&crm.completePortableExport===false&&crm.completeBackup===false&&exact(crm.contexts,contextNames)&&exact(crm.pages,names));
  const parts:Part[]=[];let outputBytes=0,evidenceBytes=0,recordCount=0;
  function add(name:string,content:string){
   require(/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(name)&&!parts.some(part=>part.name===name)&&parts.length<1024);
   const bytes=Buffer.byteLength(content);require(bytes<=maxPart&&outputBytes+bytes<=maxBytes);outputBytes+=bytes;
   const contentType=name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.json')?'application/json':'text/plain; charset=utf-8';
   parts.push(Object.freeze({name,contentType,content,bytes,sha256:createHash('sha256').update(content).digest('hex')}));
  }
  for(const part of foundation.parts)add(part.name,part.content);add('foundation_manifest.json',foundation.manifest);
  const contexts={} as Record<Name,Context>,rows={} as Record<Name,Record<string,unknown>[]>,sourceFiles:Record<string,{context:string;pages:string[]}>={};
  for(const name of contextNames){
   const original=json(crm.contexts[name],1048576),value=original.value,counts=name==='conversions'?['conversionCount','linkCount']:['rowCount'];
   require(exact(value,['schemaVersion','scope','businessId','snapshotToken',...counts])&&value.schemaVersion===1&&value.scope===sources[name].scope&&value.businessId===binding.businessId&&typeof value.snapshotToken==='string'&&hash.test(value.snapshotToken)&&counts.every(key=>count(value[key])));
   contexts[name]=Object.freeze({...value}) as Context;evidenceBytes+=original.bytes;require(evidenceBytes<=8*1024*1024);
   const file='crm_'+sources[name].prefix+'_context.json';add(file,original.text);sourceFiles[name]={context:file,pages:[]};
  }
  contexts.links=contexts.conversions;require(new Set(contextNames.map(name=>contexts[name].snapshotToken)).size===10);
  for(const name of names){
   const context=contexts[name],pages=crm.pages[name];require(Array.isArray(pages)&&pages.length>=1&&pages.length<=51);
   rows[name]=[];let after='';const files:string[]=[];
   for(const [index,text]of pages.entries()){
    const original=json(text,1048576),page=original.value,field=sources[name].field;
    require(exact(page,['schemaVersion','businessId','snapshotToken',field])&&page.schemaVersion===1&&page.businessId===binding.businessId&&page.snapshotToken===context.snapshotToken&&Array.isArray(page[field]));
    const values=page[field];require(values.length<=20&&(index===pages.length-1?values.length<20:values.length===20));
    for(const value of values){const row={...sources[name].parse(value,binding.businessId)};require(typeof row.id==='string'&&row.id>after);after=row.id;rows[name].push(row);}
    require(rows[name].length<=1000);evidenceBytes+=original.bytes;require(evidenceBytes<=8*1024*1024);
    const file='crm_'+sources[name].prefix+'_page_'+String(index+1).padStart(4,'0')+'.json';add(file,original.text);files.push(file);
   }
   const declared=name==='links'?context.linkCount:name==='conversions'?context.conversionCount:context.rowCount;
   require(String(rows[name].length)===declared);recordCount+=rows[name].length;
   sourceFiles[name]={context:sourceFiles[name==='links'?'conversions':name]!.context,pages:files};
  }
  require(crm.evidenceBytes===evidenceBytes&&crm.recordCount===recordCount);
  const foundationGroups=Object.values(foundationManifest.sourceCollections) as {evidenceBytes:number;recordCount:number}[];
  require(source.evidenceBytes===evidenceBytes+foundationGroups.reduce((n,g)=>n+g.evidenceBytes,0)&&Number(source.evidenceBytes)<=8*1024*1024&&source.recordCount===recordCount+foundationGroups.reduce((n,g)=>n+g.recordCount,0)&&Number(source.recordCount)<=10000);
  references(rows,binding.businessId);
  function formatted(result:Formatted,prefix:string){
   const manifest=JSON.parse(result.manifest);require(Array.isArray(manifest.parts)&&manifest.parts.length===3);
   const values=[result.csv,result.escapeMap,result.dictionary];
   for(const [index,part]of manifest.parts.entries()){
    const content=values[index]!;require(part.bytes===Buffer.byteLength(content)&&part.sha256===createHash('sha256').update(content).digest('hex'));add(part.name,content);
   }
   add('crm_'+prefix+'_manifest.json',result.manifest);
  }
  for(const name of names)if(name!=='conversions'&&name!=='links')formatted(sources[name].format({businessId:binding.businessId,snapshotToken:contexts[name].snapshotToken,expectedRowCount:contexts[name].rowCount!,rows:rows[name]}),sources[name].prefix);
  const conversions=formatLeadConversionCsv({businessId:binding.businessId,snapshotToken:contexts.conversions.snapshotToken,expectedConversionCount:contexts.conversions.conversionCount!,expectedLinkCount:contexts.conversions.linkCount!,conversions:rows.conversions.map(row=>parseLeadConversionRecord(row,binding.businessId)),links:rows.links.map(row=>parseConversionLink(row,binding.businessId))});
  const conversionManifest=JSON.parse(conversions.manifest),conversionParts=[conversions.conversions.csv,conversions.conversions.escapeMap,conversions.conversions.dictionary,conversions.links.csv,conversions.links.escapeMap,conversions.links.dictionary];
  require(conversionManifest.parts.length===6);
  for(const [index,part]of conversionManifest.parts.entries()){const content=conversionParts[index]!;require(part.bytes===Buffer.byteLength(content)&&part.sha256===createHash('sha256').update(content).digest('hex'));add(part.name,content);}
  add('crm_conversions_manifest.json',conversions.manifest);
  add('source_readme.txt','Crest implemented source bundle profile 1\nPrivate partial export, not a complete Crest export or a backup. Includes eight foundation and eleven CRM entity CSVs, dictionaries, per-cell formula escape maps and original source evidence.\nVerify every manifest-listed file by exact UTF8 length and SHA256. Read CSV columns as text and use each dictionary/escape map. Never round versions, cents, coordinates or source JSON numbers.\nUse foundation_manifest.json and foundation_readme.txt to reconstruct the three foundation collections. CRM sourceCollections maps each family to its exact context and manifest-ordered raw JSON page files. Conversion parents/links intentionally share one context. Rebuild the original CRM source envelope with the root generation/business/observation, raw contexts/pages, evidence bytes/count and incomplete flags; preserve every original raw text byte.\nApplication/schema versions are declared metadata, not authenticity. Limited included-reference checks do not establish complete tenant/source provenance. Owner authorization, encrypted custody, a verified Ready job and current download authority are separate requirements.\n');
  const manifest=JSON.stringify({formatVersion:1,profile:binding.sourceSchemaVersion===42?'crest.business-source-bundle.v1':'crest.business-source-projection.v1',generationId:source.generationId,businessId:binding.businessId,observedAt:source.observedAt,appReleaseId:binding.appReleaseId,sourceSchemaVersion:binding.sourceSchemaVersion,captureDeclared:source.capture,assurance:'internal_consistency_only',consistentCaptureProven:false,includedCrmReferencesVerified:true,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,foundationManifest:'foundation_manifest.json',evidenceBytes:source.evidenceBytes,recordCount:source.recordCount,crmEvidenceBytes:evidenceBytes,crmRecordCount:recordCount,sourceCollections:sourceFiles,parts:parts.map(({name,contentType,bytes,sha256})=>({name,contentType,bytes,sha256}))})+'\n';
  require(Buffer.byteLength(manifest)<=maxPart&&outputBytes+Buffer.byteLength(manifest)<=maxBytes);
  const value=Object.freeze({parts:Object.freeze(parts),manifest});return Object.freeze({forServer:()=>value,toJSON:()=>{throw new BusinessSourceBundleError();}});
 }catch{throw new BusinessSourceBundleError();}
}
