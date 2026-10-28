import 'server-only';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';
import {parseStoredService,parseStoredServiceContent,serviceId} from '../commercial/service-storage-contract.ts';
import type {StoredService,StoredServiceContent} from '../commercial/service-storage-contract.ts';
import {formatServiceCatalogCsv} from '../commercial/service-catalog-csv.ts';
type Query=(sql:string,args:unknown[])=>Promise<{rows:unknown[]}>;
type Context=Readonly<{businessId:string;snapshotToken:string;serviceCount:string;versionCount:string}>;
export class CatalogCollectionError extends Error{constructor(){super('CATALOG_SOURCE_COLLECTION_REVIEW_REQUIRED');this.name='CatalogCollectionError';}}
function require(v:unknown):asserts v{if(!v)throw new CatalogCollectionError();}
function json(value:unknown,limit=1048576){
 require(typeof value==='string'&&value.length>0&&value.length<=limit&&!value.includes('\0'));const bytes=Buffer.from(value);require(bytes.length<=limit&&bytes.toString('utf8')===value);
 const parsed:unknown=JSON.parse(value);require(historyJsonEqual(parseHistoryJson(value),parseHistoryJson(JSON.stringify(parsed))));return {text:value,value:parsed,bytes:bytes.length};
}
const count=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(v)&&Number(v)<=1000;
export function catalogCollectionContext(raw:unknown,businessId:string):Context{
 try{const c=json(raw,8192).value;require(serviceId(businessId)&&exact(c,['schemaVersion','scope','businessId','snapshotToken','serviceCount','versionCount'])&&c.schemaVersion===1&&c.scope==='service_catalog'&&c.businessId===businessId&&typeof c.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(c.snapshotToken)&&count(c.serviceCount)&&count(c.versionCount));return Object.freeze({businessId,snapshotToken:c.snapshotToken,serviceCount:c.serviceCount,versionCount:c.versionCount});}
 catch{throw new CatalogCollectionError();}
}
// Called only inside the collector's owned RO/RR transaction. No connection,
// authorization, COMMIT, worker, storage or browser-selected routine of its own.
export async function collectServiceCatalogSources(query:Query,check:()=>void,input:Readonly<{rawContext:unknown;businessId:string;generationId:string;observedAt:string;remainingRecords:number;remainingMetadataBytes:number}>){
 try{
  const {businessId,generationId,observedAt}=input,context=catalogCollectionContext(input.rawContext,businessId),raw=json(input.rawContext,8192);
  // Collection observation uses the foundation's original PostgreSQL UTC
  // spelling; individual service instants retain their separate six-digit Z form.
  require(serviceId(generationId)&&typeof observedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?\+00:00$/.test(observedAt)&&Number.isSafeInteger(input.remainingRecords)&&input.remainingRecords>=0&&input.remainingRecords<=10000&&Number.isSafeInteger(input.remainingMetadataBytes)&&input.remainingMetadataBytes>=0&&input.remainingMetadataBytes<=8388608);
  const expected=Number(context.serviceCount)+Number(context.versionCount);require(expected<=input.remainingRecords);let metadataBytes=raw.bytes;require(metadataBytes<=input.remainingMetadataBytes);
  const services:StoredService[]=[],versions:StoredServiceContent[]=[],pages={services:[] as string[],versions:[] as string[]};
  for(const entity of ['services','versions'] as const){
   let after:string|null=null,seen=0;const limit=Number(entity==='services'?context.serviceCount:context.versionCount);
   for(let page=0;;page++){
    require(page<=50);check();
    const response=await query(entity==='services'?'SELECT crest_commands.service_catalog_snapshot_services($1::uuid,$2::text,$3::uuid,$4::integer)::text AS page':'SELECT crest_commands.service_catalog_snapshot_versions($1::uuid,$2::text,$3::uuid,$4::integer)::text AS page',[businessId,context.snapshotToken,after,20]);
    check();require(response.rows.length===1&&exact(response.rows[0],['page']));const parsed=json(response.rows[0].page),p=parsed.value;
    require(exact(p,['schemaVersion','businessId','snapshotToken',entity])&&p.schemaVersion===1&&p.businessId===businessId&&p.snapshotToken===context.snapshotToken&&Array.isArray(p[entity])&&p[entity].length<=20);
    metadataBytes+=parsed.bytes;require(metadataBytes<=input.remainingMetadataBytes);pages[entity].push(parsed.text);
    const rows=p[entity];for(const row of rows){
     require(row!==null&&typeof row==='object'&&!Array.isArray(row)&&'id'in row&&serviceId(row.id)&&(after===null||row.id>after));after=row.id;
     if(entity==='services')services.push(parseStoredService(row,businessId));
     else {require('service_id'in row&&serviceId(row.service_id));versions.push(parseStoredServiceContent(row,businessId,row.service_id));}
     require(++seen<=limit);
    }
    if(rows.length<20)break;
   }
   require(seen===limit);
  }
  // Reuse the complete retained-content/pointer/sequence validator; never
  // truncate or accept merely individually well-formed but orphaned rows.
  formatServiceCatalogCsv({businessId,snapshotToken:context.snapshotToken,expectedServiceCount:context.serviceCount,expectedVersionCount:context.versionCount,services,versions});check();
  const catalog=JSON.stringify({formatVersion:1,generationId,businessId,observedAt,context:raw.text,pages,metadataBytes,recordCount:expected,catalogRegistered:false,completePortableExport:false,completeBackup:false});
  return Object.freeze({catalog,metadataBytes,serializedBytes:Buffer.byteLength(catalog),recordCount:expected});
 }catch{throw new CatalogCollectionError();}
}
