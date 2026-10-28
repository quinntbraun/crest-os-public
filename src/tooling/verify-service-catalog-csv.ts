import {createHash} from 'node:crypto';
import {readSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {parseHistoryJson,historyJsonEqual} from '../security/history-evidence-json.ts';
import {parseStoredService,parseStoredServiceContent,serviceContentDefinition,serviceId} from '../commercial/service-storage-contract.ts';
import {parseCatalogService} from '../commercial/service-catalog.ts';
// Independent inventory and reader: no collector, formatter, database or provider.
const columns={
 services:['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
 service_versions:['id','business_id','service_id','sequence','name','inclusions','exclusions','internal_guidance','range_low_cents','range_high_cents','estimated_seconds','created_at','created_by','origin','operation_id','import_row_id']
} as const;
export class CatalogSourceVerificationError extends Error{constructor(){super('CATALOG_SOURCE_VERIFICATION_REQUIRED');this.name='CatalogSourceVerificationError';}}
function require(v:unknown):asserts v{if(!v)throw new CatalogSourceVerificationError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function text(v:unknown,limit:number):string{require(typeof v==='string'&&v.length>0&&v.length<=limit&&!v.includes('\0')&&Buffer.byteLength(v)<=limit&&Buffer.from(v).toString('utf8')===v);return v;}
function json(v:unknown,limit:number){const raw=text(v,limit),value:unknown=JSON.parse(raw);require(historyJsonEqual(parseHistoryJson(raw),parseHistoryJson(JSON.stringify(value))));return value;}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const count=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(v)&&Number(v)<=1000;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function graph(serviceRows:readonly unknown[],versionRows:readonly unknown[],businessId:string){
 const services=serviceRows.map(v=>parseStoredService(object(v,columns.services),businessId)),versions=versionRows.map(v=>{const row=object(v,columns.service_versions);require(serviceId(row.service_id));return parseStoredServiceContent(row,businessId,row.service_id);}),roots=new Map(services.map(s=>[s.id,s]));
 require(roots.size===services.length&&new Set(services.map(s=>s.code)).size===services.length&&new Set(versions.map(v=>v.id)).size===versions.length&&versions.every(v=>roots.has(v.service_id)));
 for(const s of services){
  const retained=versions.filter(v=>v.service_id===s.id).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:1);
  parseCatalogService({id:s.id,code:s.code,active:s.active,revision:s.version,versions:retained.map(v=>({sequence:v.sequence,definition:serviceContentDefinition(v)}))});
  const first=retained[0]!,last=retained.at(-1)!;require(s.current_version_id===last.id&&s.created_by===first.created_by&&s.origin===first.origin&&s.import_row_id===first.import_row_id&&(s.version!=='1'||s.operation_id===first.operation_id&&s.updated_by===first.created_by));
  for(let i=1;i<retained.length;i++)require(!historyJsonEqual(serviceContentDefinition(retained[i-1]!),serviceContentDefinition(retained[i]!)));
 }
 return Object.freeze({services:Object.freeze(services),versions:Object.freeze(versions)});
}
export function readServiceCatalogCapture(raw:unknown,binding:Readonly<{businessId:string;generationId:string;observedAt:string}>){
 try{
  require(serviceId(binding.businessId)&&serviceId(binding.generationId)&&typeof binding.observedAt==='string');
  const c=object(json(raw,33554432),['formatVersion','generationId','businessId','observedAt','context','pages','metadataBytes','recordCount','catalogRegistered','completePortableExport','completeBackup']);
  require(c.formatVersion===1&&c.businessId===binding.businessId&&c.generationId===binding.generationId&&c.observedAt===binding.observedAt&&c.catalogRegistered===false&&c.completePortableExport===false&&c.completeBackup===false);
  const context=object(json(c.context,8192),['schemaVersion','scope','businessId','snapshotToken','serviceCount','versionCount']);
  require(context.schemaVersion===1&&context.scope==='service_catalog'&&context.businessId===binding.businessId&&hash(context.snapshotToken)&&count(context.serviceCount)&&count(context.versionCount));
  const p=object(c.pages,['services','versions']),rows={services:[] as unknown[],versions:[] as unknown[]};let metadataBytes=Buffer.byteLength(c.context as string);
  for(const entity of ['services','versions'] as const){
   const pages=p[entity];require(Array.isArray(pages)&&pages.length>=1&&pages.length<=51);let previous='';
   for(const [index,rawPage]of pages.entries()){
    const page=object(json(rawPage,1048576),['schemaVersion','businessId','snapshotToken',entity]);metadataBytes+=Buffer.byteLength(rawPage);require(metadataBytes<=8388608);
    require(page.schemaVersion===1&&page.businessId===binding.businessId&&page.snapshotToken===context.snapshotToken);const values=page[entity];require(Array.isArray(values)&&(index===pages.length-1?values.length<20:values.length===20));
    for(const value of values){const r=object(value,entity==='services'?columns.services:columns.service_versions);require(serviceId(r.id)&&r.id>previous);previous=r.id;rows[entity].push(r);}
   }
  }
  require(rows.services.length===Number(context.serviceCount)&&rows.versions.length===Number(context.versionCount)&&c.metadataBytes===metadataBytes&&c.recordCount===rows.services.length+rows.versions.length);
  const parsed=graph(rows.services,rows.versions,binding.businessId);return Object.freeze({...parsed,businessId:binding.businessId,snapshotToken:context.snapshotToken,serviceCount:context.serviceCount,versionCount:context.versionCount,recordCount:c.recordCount as number,metadataBytes});
 }catch{throw new CatalogSourceVerificationError();}
}
type File=Readonly<{name:string;contentType:string;content:string;bytes:number;sha256:string}>;
export function verifyServiceCatalogCsv(manifestText:unknown,files:readonly File[],expected:Readonly<{businessId:string;snapshotToken:string}>){
 try{
  const m=object(json(manifestText,1048576),['schemaVersion','profile','businessId','snapshotToken','serviceCount','versionCount','assurance','snapshotProven','sourceCompletenessProven','catalogReferenceClosureComplete','referenceClosureComplete','completeCrestExport','completeBackup','parts']);
  require(serviceId(expected.businessId)&&hash(expected.snapshotToken)&&m.schemaVersion===1&&m.profile==='crest.service-catalog.sources.v1'&&m.businessId===expected.businessId&&m.snapshotToken===expected.snapshotToken&&count(m.serviceCount)&&count(m.versionCount)&&m.assurance==='included_catalog_consistency_only'&&m.snapshotProven===false&&m.sourceCompletenessProven===false&&m.catalogReferenceClosureComplete===true&&m.referenceClosureComplete===false&&m.completeCrestExport===false&&m.completeBackup===false&&Array.isArray(m.parts)&&m.parts.length===4&&Array.isArray(files)&&files.length===4);
  const supplied=new Map(files.map(f=>[f.name,f])),used=new Set<string>();require(supplied.size===4);let total=Buffer.byteLength(manifestText as string);
  for(const part of m.parts){const d=object(part,['name','bytes','sha256']);require(typeof d.name==='string'&&!used.has(d.name));used.add(d.name);const f=supplied.get(d.name);require(f);text(f.content,8388608);require(d.bytes===f.bytes&&f.bytes===Buffer.byteLength(f.content)&&d.sha256===f.sha256&&f.sha256===sha(f.content));total+=f.bytes;require(total<=33554432);}
  function read(name:string,type:string){const f=supplied.get(name);require(f&&used.has(name)&&f.contentType===type);return f.content;}
  const escape=object(json(read('service_catalog_escape_map.json','application/json'),8388608),['schemaVersion','profile','businessId','snapshotToken','escapes']);require(escape.schemaVersion===1&&escape.profile===m.profile&&escape.businessId===expected.businessId&&escape.snapshotToken===expected.snapshotToken&&Array.isArray(escape.escapes));
  const dictionary=object(json(read('service_catalog_dictionary.json','application/json'),1048576),['schemaVersion','profile','tables','null','csv','instants','decode','privacy','completeness']);require(dictionary.schemaVersion===1&&dictionary.profile===m.profile&&dictionary.null==='\\N'&&dictionary.csv==='UTF-8 RFC4180 CRLF');const tables=object(dictionary.tables,['services','service_versions']);
  for(const entity of ['services','service_versions'] as const){const table=object(tables[entity],['columns','scalarTypes']);require(historyJsonEqual(table.columns,columns[entity]));const types=entity==='services'?{active:'boolean',version:'exact decimal string'}:{sequence:'exact decimal string',range_low_cents:'nullable exact decimal string cents',range_high_cents:'nullable exact decimal string cents',estimated_seconds:'nullable exact decimal string seconds'};require(historyJsonEqual(table.scalarTypes,types));}
  for(const key of ['instants','decode','privacy','completeness'])require(typeof dictionary[key]==='string'&&(dictionary[key] as string).length>0);
  const flags={services:[] as Record<string,unknown>[],service_versions:[] as Record<string,unknown>[]};
  for(const value of escape.escapes){const e=object(value,['entity','row_id','column','apostrophe_prefix']);require(e.entity==='services'||e.entity==='service_versions');const {entity,...flag}=e;flags[entity].push(flag);}
  const services=readSourceExportCsv(read('services.csv','text/csv; charset=utf-8'),flags.services,{columns:columns.services,booleans:['active'],maxRows:1000});
  const versions=readSourceExportCsv(read('service_versions.csv','text/csv; charset=utf-8'),flags.service_versions,{columns:columns.service_versions,maxRows:1000});
  require(services.length===Number(m.serviceCount)&&versions.length===Number(m.versionCount));return graph(services,versions,expected.businessId);
 }catch{throw new CatalogSourceVerificationError();}
}
