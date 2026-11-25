import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,customerInstant,exactCustomerObject} from '../customer/customer-contract.ts';
import {currentBusinessSourceInventory,currentBusinessSourceInventory140} from './current-business-source-inventory.ts';

type Row=Readonly<Record<string,string|null>>;
type Source=Readonly<{source:string;columns:readonly string[];types:Readonly<Record<string,string>>;primaryKey:readonly string[];rows:readonly Row[]}>;
export type CurrentBusinessSourceBinding=Readonly<{appReleaseId:string;sourceSchemaVersion:133|134|135|136|137|138|140}>;
export type CurrentBusinessRows=Readonly<{schemaVersion:1;profile:'crest.current-business-rows.v1'|'crest.current-business-rows.v2';businessId:string;snapshotToken:string;observedAt:string;sources:readonly Source[];recordCount:number;completePortableExport:false;completeBackup:false}>;
type Query=(sql:string,args:unknown[])=>Promise<unknown[]>;
const statement='SELECT crest_commands.business_source_page_v1($1::uuid,$2::text,$3::text,$4::text[],$5::integer) AS page';
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_SOURCE_REVIEW_REQUIRED');}
const exact=exactCustomerObject;
export function compareSourceKeys(a:readonly string[],b:readonly string[]){
 for(let index=0;index<Math.min(a.length,b.length);index++){const order=Buffer.compare(Buffer.from(a[index]!),Buffer.from(b[index]!));if(order)return order;}
 return a.length-b.length;
}
async function captureRows(businessId:string,query:Query,check:()=>void,version:1|2){
 const inventory=version===1?currentBusinessSourceInventory:currentBusinessSourceInventory140;
 const selected=version===1?statement:statement.replace('business_source_page_v1','business_source_page_v2');
 require(customerUuid(businessId));
 const sources:Source[]=[];let snapshotToken:string|null=null,observedAt:string|null=null,recordCount=0,bytes=0;
 for(const descriptor of inventory){
  let cursor:string[]|null=null,prior:string[]|null=null,types:Record<string,string>|undefined,primaryKey:string[]|undefined;
  const rows:Row[]=[];
  for(;;){
   check();const result=await query(selected,[businessId,descriptor.source,snapshotToken,cursor,100]);check();
   require(result.length===1&&exact(result[0],['page']));const page=result[0].page;
   require(exact(page,['schemaVersion','businessId','source','snapshotToken','observedAt','columns','types','primaryKey','rows','nextCursor'])&&page.schemaVersion===1&&page.businessId===businessId&&page.source===descriptor.source);
   require(typeof page.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(page.snapshotToken)&&customerInstant(page.observedAt)&&isDeepStrictEqual(page.columns,descriptor.columns));
   require(exact(page.types,descriptor.columns)&&descriptor.columns.every(column=>typeof (page.types as Record<string,unknown>)[column]==='string'));
   require(Array.isArray(page.primaryKey)&&page.primaryKey.length>0&&page.primaryKey.length<=16&&new Set(page.primaryKey).size===page.primaryKey.length&&page.primaryKey.every(key=>typeof key==='string'&&descriptor.columns.includes(key)));
   if(snapshotToken===null){snapshotToken=page.snapshotToken;observedAt=page.observedAt;}
   require(page.snapshotToken===snapshotToken&&page.observedAt===observedAt);
   if(types)require(isDeepStrictEqual(types,page.types)&&isDeepStrictEqual(primaryKey,page.primaryKey));
   else{types=Object.freeze({...page.types}) as Record<string,string>;primaryKey=[...page.primaryKey] as string[];}
   require(Array.isArray(page.rows)&&page.rows.length<=100);
   for(const row of page.rows){
    require(exact(row,descriptor.columns)&&descriptor.columns.every(column=>row[column]===null||typeof row[column]==='string'&&!row[column].includes('\0')&&Buffer.from(row[column]).toString('utf8')===row[column]));
    require(descriptor.source==='crest.businesses'?row.id===businessId:row.business_id===businessId);
    const key=primaryKey!.map(column=>row[column]);require(key.every(value=>typeof value==='string'));
    const current=key as string[];require(prior===null||compareSourceKeys(prior,current)<0);prior=current;
    bytes+=Buffer.byteLength(JSON.stringify(row));recordCount++;require(bytes<=33554432&&recordCount<=100000);
    rows.push(Object.freeze({...row}) as Row);
   }
   if(page.nextCursor===null)break;
   require(page.rows.length===100&&Array.isArray(page.nextCursor)&&isDeepStrictEqual(page.nextCursor,prior));cursor=[...page.nextCursor] as string[];
  }
  sources.push(Object.freeze({source:descriptor.source,columns:descriptor.columns,types:types!,primaryKey:Object.freeze(primaryKey!),rows:Object.freeze(rows)}));
 }
 require(snapshotToken!==null&&observedAt!==null);
 return Object.freeze({schemaVersion:1,profile:version===1?'crest.current-business-rows.v1':'crest.current-business-rows.v2',businessId,snapshotToken,observedAt,sources:Object.freeze(sources),recordCount,completePortableExport:false,completeBackup:false}) as CurrentBusinessRows;
}

export function captureCurrentBusinessRows(businessId:string,query:Query,check:()=>void){return captureRows(businessId,query,check,1);}
export function captureCurrentBusinessRows140(businessId:string,query:Query,check:()=>void){return captureRows(businessId,query,check,2);}
