// Owner-only source formatting. Collection/authorization, one-snapshot origin,
// audit/actor closure and recoverable custody are independent requirements.
import {createHash} from 'node:crypto';
import {exactCustomerObject} from '../customer/customer-contract.ts';
import {parseCatalogService} from './service-catalog.ts';
import {serviceColumns,serviceContentColumns,serviceContentDefinition,parseStoredService,parseStoredServiceContent,serviceId,requireService} from './service-storage-contract.ts';
import type {StoredService,StoredServiceContent} from './service-storage-contract.ts';

type Input=Readonly<{businessId:string;snapshotToken:string;expectedServiceCount:string;expectedVersionCount:string;services:readonly StoredService[];versions:readonly StoredServiceContent[]}>;
type Escape=Readonly<{entity:'services'|'service_versions';row_id:string;column:string;apostrophe_prefix:true}>;
export class ServiceCatalogCsvError extends Error{constructor(){super('SERVICE_CATALOG_CSV_REVIEW_REQUIRED');this.name='ServiceCatalogCsvError';}}
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"',hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const count=(s:unknown):s is string=>typeof s==='string'&&s===s.trim()&&/^(0|[1-9][0-9]{0,3})$/.test(s)&&Number(s)<=1000;
function table<T extends {id:string}>(entity:Escape['entity'],rows:readonly T[],columns:readonly (keyof T&string)[],escapes:Escape[]){
 const lines=[columns.map(quote).join(',')];let size=Buffer.byteLength(lines[0]!)+2;
 for(const row of rows){
  const cells=columns.map(column=>{
   const original=row[column];if(original===null)return quote('\\N');
   let text=String(original).replaceAll('\\','\\\\');
   if(typeof original==='string'&&(text.startsWith("'")||['=','+','-','@'].includes(text.trimStart()[0]??''))){text="'"+text;escapes.push({entity,row_id:row.id,column,apostrophe_prefix:true});}
   return quote(text);
  }),line=cells.join(',');size+=Buffer.byteLength(line)+2;requireService(size<=8*1024*1024);lines.push(line);
 }
 return lines.join('\r\n')+'\r\n';
}
export function formatServiceCatalogCsv(input:Input){
 try{
  requireService(exactCustomerObject(input,['businessId','snapshotToken','expectedServiceCount','expectedVersionCount','services','versions'])&&serviceId(input.businessId)
   &&typeof input.snapshotToken==='string'&&input.snapshotToken.length===64&&/^[a-f0-9]+$/.test(input.snapshotToken)
   &&count(input.expectedServiceCount)&&count(input.expectedVersionCount)&&Array.isArray(input.services)&&Array.isArray(input.versions)
   &&input.services.length===Number(input.expectedServiceCount)&&input.versions.length===Number(input.expectedVersionCount));
  const businessId=input.businessId,snapshotToken=input.snapshotToken,services=Array.from(input.services,row=>parseStoredService(row,businessId)).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const parents=new Map(services.map(row=>[row.id,row]));requireService(parents.size===services.length&&new Set(services.map(row=>row.code)).size===services.length);
  const versions=Array.from(input.versions,row=>{
   requireService(exactCustomerObject(row,serviceContentColumns)&&serviceId(row.service_id)&&parents.has(row.service_id));return parseStoredServiceContent(row,businessId,row.service_id);
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  requireService(new Set(versions.map(row=>row.id)).size===versions.length);
  for(const service of services){
   const content=versions.filter(row=>row.service_id===service.id).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:BigInt(a.sequence)>BigInt(b.sequence)?1:0);
   const catalog=parseCatalogService({id:service.id,code:service.code,active:service.active,revision:service.version,versions:content.map(row=>({sequence:row.sequence,definition:serviceContentDefinition(row)}))});
   const first=content[0]!,last=content.at(-1)!;
   requireService(service.current_version_id===last.id&&service.created_by===first.created_by&&service.origin===first.origin&&service.import_row_id===first.import_row_id);
   if(service.version==='1')requireService(service.operation_id===first.operation_id&&service.updated_by===first.created_by);
   for(let i=1;i<catalog.versions.length;i++)requireService(JSON.stringify(catalog.versions[i]!.definition)!==JSON.stringify(catalog.versions[i-1]!.definition));
  }
  const escapes:Escape[]=[],servicesCsv=table('services',services,serviceColumns,escapes),versionsCsv=table('service_versions',versions,serviceContentColumns,escapes);
  const escapeMap=JSON.stringify({schemaVersion:1,profile:'crest.service-catalog.sources.v1',businessId,snapshotToken,escapes})+'\n';
  const dictionary=JSON.stringify({schemaVersion:1,profile:'crest.service-catalog.sources.v1',tables:{services:{columns:serviceColumns,scalarTypes:{active:'boolean',version:'exact decimal string'}},service_versions:{columns:serviceContentColumns,scalarTypes:{sequence:'exact decimal string',range_low_cents:'nullable exact decimal string cents',range_high_cents:'nullable exact decimal string cents',estimated_seconds:'nullable exact decimal string seconds'}}},null:'\\N',csv:'UTF-8 RFC4180 CRLF',instants:'UTC with six fractional digits',decode:'Parse CSV as text; unescaped \\N is null. Remove exactly the apostrophe named by entity/row/column in the escape map; unescape paired backslashes. Do not guess escapes. Parse only declared boolean cells as boolean. Import integer columns as text in spreadsheet software; CSV quotes do not impose a cell type.',privacy:'Owner-only complete service definitions, including private guidance; never a customer quote projection.',completeness:'Included catalog records and retained content only. Source origin/completeness, actor/operation/audit closure, authorization and recoverable custody are not established by formatting.'})+'\n';
  const parts=[['services.csv',servicesCsv],['service_versions.csv',versionsCsv],['service_catalog_escape_map.json',escapeMap],['service_catalog_dictionary.json',dictionary]].map(([name,content])=>({name:name!,bytes:Buffer.byteLength(content!),sha256:hash(content!)}));
  requireService(parts.every(p=>p.bytes<=8*1024*1024)&&parts.reduce((n,p)=>n+p.bytes,0)<=32*1024*1024);
  const manifest=JSON.stringify({schemaVersion:1,profile:'crest.service-catalog.sources.v1',businessId,snapshotToken,serviceCount:String(services.length),versionCount:String(versions.length),assurance:'included_catalog_consistency_only',snapshotProven:false,sourceCompletenessProven:false,catalogReferenceClosureComplete:true,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false,parts})+'\n';
  return Object.freeze({servicesCsv,versionsCsv,escapeMap,dictionary,manifest});
 }catch{throw new ServiceCatalogCsvError();}
}
