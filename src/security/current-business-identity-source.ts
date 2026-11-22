import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyBusinessIdentityEvidence} from './business-identity-evidence.ts';
import {readCurrentBusinessCsv} from './current-business-source-csv.ts';
import type {CurrentBusinessRows} from './current-business-source.ts';

export const currentIdentityInventory=Object.freeze([
 {kind:'actor',source:'crest_private.actors',columns:['id','kind','display_label','system_key','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']},
 {kind:'role_capability',source:'crest_private.role_capabilities',columns:['id','role','capability','created_at','created_by','origin','operation_id','import_row_id']},
 {kind:'identity_event',source:'crest_private.identity_events',columns:['id','business_id','created_at','created_by','origin','operation_id','import_row_id','entity_kind','entity_id','entity_version','action','database_principal','payload','event_hash']}
].map(value=>Object.freeze({...value,columns:Object.freeze(value.columns)})));
type Source=CurrentBusinessRows['sources'][number];
type Metadata=Readonly<{source:string;columns:readonly string[];types:Readonly<Record<string,string>>;primaryKey:readonly string[]}>;
export type CurrentBusinessIdentitySource=Readonly<{schemaVersion:1;profile:'crest.current-business-identity-source.v1';businessId:string;businessSnapshotToken:string;businessObservedAt:string;identitySnapshotToken:string;identityObservedAt:string;evidence:string;sources:readonly Source[];recordCount:number;completePortableExport:false;completeBackup:false}>;
type Binding=Pick<CurrentBusinessRows,'businessId'|'snapshotToken'|'observedAt'>;
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_BUSINESS_IDENTITY_REVIEW_REQUIRED');}
function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function currentIdentityFromEvidence(evidence:string,metadata:readonly Metadata[],binding:Binding):CurrentBusinessIdentitySource{
 const verified=verifyBusinessIdentityEvidence(evidence,{businessId:binding.businessId});
 require(/^[a-f0-9]{64}$/.test(binding.snapshotToken)&&metadata.length===3&&new Set(metadata.map(value=>value.source)).size===3);
 const sources=currentIdentityInventory.map(descriptor=>{
  const meta=metadata.find(value=>value.source===descriptor.source);require(meta&&isDeepStrictEqual([...meta.columns].sort(),[...descriptor.columns].sort())&&exact(meta.types,descriptor.columns)&&Object.values(meta.types).every(type=>typeof type==='string')&&isDeepStrictEqual(meta.primaryKey,['id']));
  const rows=verified.records.filter(row=>row.kind===descriptor.kind).map(record=>{
   const body=JSON.parse(record.canonicalEvidence) as {row:unknown};require(exact(body.row,descriptor.columns));const row=body.row;
   require(descriptor.columns.every(column=>row[column]===null||typeof row[column]==='string'&&!row[column].includes('\0')&&Buffer.from(row[column]).toString('utf8')===row[column]));
   return Object.freeze(Object.fromEntries(descriptor.columns.map(column=>[column,row[column]]))) as Readonly<Record<string,string|null>>;
  });
  return Object.freeze({source:descriptor.source,columns:descriptor.columns,types:Object.freeze({...meta.types}),primaryKey:Object.freeze([...meta.primaryKey]),rows:Object.freeze(rows)});
 });
 return Object.freeze({schemaVersion:1,profile:'crest.current-business-identity-source.v1',businessId:binding.businessId,businessSnapshotToken:binding.snapshotToken,businessObservedAt:binding.observedAt,identitySnapshotToken:verified.context.snapshotToken,identityObservedAt:verified.context.observedAt,evidence,sources:Object.freeze(sources),recordCount:sources.reduce((sum,source)=>sum+source.rows.length,0),completePortableExport:false,completeBackup:false});
}
export function verifyCurrentIdentitySource(input:CurrentBusinessIdentitySource,binding:Binding){
 require(input.businessId===binding.businessId&&input.businessSnapshotToken===binding.snapshotToken&&input.businessObservedAt===binding.observedAt);
 const checked=currentIdentityFromEvidence(input.evidence,input.sources,binding);require(isDeepStrictEqual(input,checked));return checked;
}
export async function captureCurrentIdentitySource(binding:Binding,query:(sql:string,args:unknown[])=>Promise<unknown[]>,check:()=>void){
 check();const result=await query('SELECT crest_commands.business_identity_export_context($1::uuid) AS context',[binding.businessId]);check();
 require(result.length===1&&exact(result[0],['context']));const ctx=result[0].context;
 require(exact(ctx,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts'])&&ctx.schemaVersion===1&&ctx.scope==='business_identity'&&ctx.businessId===binding.businessId&&typeof ctx.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(ctx.snapshotToken)&&exact(ctx.recordCounts,currentIdentityInventory.map(value=>value.kind)));
 const records:Record<string,unknown>[]=[],counts=ctx.recordCounts;let totalBytes=0;
 for(const descriptor of currentIdentityInventory){
  const declared=counts[descriptor.kind];require(typeof declared==='string'&&/^(0|[1-9][0-9]{0,4})$/.test(declared)&&Number(declared)<=10000);let cursor:string|null=null,count=0;
  for(;;){
   check();const page=await query('SELECT * FROM crest_commands.business_identity_export_page($1::uuid,$2::text,$3::text,$4::uuid,$5::integer)',[binding.businessId,ctx.snapshotToken,descriptor.kind,cursor,20]);check();require(page.length<=20);
   for(const raw of page){
    require(exact(raw,['record_id','representation','canonical_evidence','evidence_hash'])&&typeof raw.record_id==='string'&&/^[a-f0-9-]{36}$/.test(raw.record_id)&&(cursor===null||raw.record_id>cursor)&&raw.representation==='snapshot_projection'&&typeof raw.canonical_evidence==='string'&&typeof raw.evidence_hash==='string'&&sha(raw.canonical_evidence)===raw.evidence_hash);
    totalBytes+=Buffer.byteLength(raw.canonical_evidence);count++;require(totalBytes<=8388608&&records.length<10000&&count<=Number(declared));cursor=raw.record_id;
    records.push({kind:descriptor.kind,recordId:raw.record_id,representation:raw.representation,canonicalEvidence:raw.canonical_evidence,evidenceHash:raw.evidence_hash});
   }
   if(page.length<20)break;
  }
  require(count===Number(declared));
 }
 const evidence=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:ctx,evidenceBytes:totalBytes,records});
 const metadata=await query(`SELECT n.nspname||'.'||c.relname AS source,array_agg(a.attname::text ORDER BY a.attnum) AS columns,
 jsonb_object_agg(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod)) AS types,
 (SELECT array_agg(k.attname::text ORDER BY key.ordinality) FROM pg_catalog.pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key(attnum,ordinality) JOIN pg_catalog.pg_attribute k ON k.attrelid=c.oid AND k.attnum=key.attnum WHERE i.indrelid=c.oid AND i.indisprimary) AS "primaryKey"
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname||'.'||c.relname=ANY($1::text[]) AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped GROUP BY n.nspname,c.oid,c.relname`,[currentIdentityInventory.map(value=>value.source)]);check();
 for(const item of metadata)require(exact(item,['source','columns','types','primaryKey'])&&typeof item.source==='string'&&Array.isArray(item.columns)&&item.columns.every(column=>typeof column==='string')&&Array.isArray(item.primaryKey)&&item.primaryKey.every(column=>typeof column==='string'));
 return currentIdentityFromEvidence(evidence,metadata as Metadata[],binding);
}
export function formatCurrentIdentitySource(input:CurrentBusinessIdentitySource,binding:Binding){
 const value=verifyCurrentIdentitySource(input,binding),files:Record<string,Uint8Array>={},dictionary:Record<string,unknown>={},escapeMap:Record<string,unknown>={};const quote=(cell:string)=>'"'+cell.replaceAll('"','""')+'"';
 for(const source of value.sources){
  const flags:{row:number;column:string}[]=[],name=source.source.replace('.','_')+'.csv';
  const lines=[source.columns.map(quote).join(','),...source.rows.map((row,index)=>source.columns.map(column=>{
   const original=row[column]!;if(original===null)return quote('\\N');let cell=original.replaceAll('\\','\\\\');
   if(cell.startsWith("'")||['=','+','-','@'].includes(cell.trimStart()[0]??'')){cell="'"+cell;flags.push({row:index+1,column});}return quote(cell);
  }).join(','))];const csv=lines.join('\r\n')+'\r\n';require(isDeepStrictEqual(readCurrentBusinessCsv(csv,source.columns,flags),source.rows));
  files[name]=Buffer.from(csv);dictionary[name]={source:source.source,columns:source.columns,types:source.types,primaryKey:source.primaryKey,records:source.rows.length};escapeMap[name]=flags;
 }
 files['current_identity_dictionary.json']=Buffer.from(JSON.stringify(dictionary)+'\n');files['current_identity_escape_map.json']=Buffer.from(JSON.stringify(escapeMap)+'\n');files['business_identity_evidence.json']=Buffer.from(value.evidence);
 files['current_identity_source_manifest.json']=Buffer.from(JSON.stringify({schemaVersion:1,profile:value.profile,businessId:value.businessId,businessSnapshotToken:value.businessSnapshotToken,businessObservedAt:value.businessObservedAt,identitySnapshotToken:value.identitySnapshotToken,identityObservedAt:value.identityObservedAt,recordCount:value.recordCount,scope:'Existing reviewed business identity projection: scoped actors, global role capabilities and relevant retained identity events. Provider/session/runtime-security components remain separate.',completePortableExport:false,completeBackup:false,files:Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:sha(bytes)}))})+'\n');
 require(Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0)<=33554432);return Object.freeze({files:Object.freeze(files),identity:value});
}
