import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid,customerInstant as instant,customerVersion as version} from '../customer/customer-contract.ts';
import {parseSourceExportJob,sourceExportJobColumns} from './source-export-job-contract.ts';
import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';
import {createJournalTextAssembler} from './source-export-journal-text.ts';
import type {JournalTextDescriptor,JournalTextKind} from './source-export-journal-text.ts';

export const journalSourceColumns={
 job:sourceExportJobColumns,
 attempt:['id','business_id','export_job_id','attempt_no','recovery_epoch','leased_at','lease_until','created_at','created_by','origin','operation_id','import_row_id'],
 snapshot:['generation_id','business_id','export_job_id','lease_id','actor_id','recovery_epoch','app_release_id','source_schema_version','observed_at','plan_sha256','request_sha256','request_text','file_count','total_bytes','manifest_sha256','created_at','created_by','origin','operation_id','import_row_id'],
 intent:['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','ordinal','file_name','content_type','object_key','key_id','plaintext_bytes','plaintext_sha256','ciphertext_bytes','ciphertext_sha256','request_sha256','request_text','created_at','created_by','origin','operation_id','import_row_id'],
 verification:['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','request_sha256','request_text','verified_at','created_at','created_by','origin','operation_id','import_row_id'],
 completion:['business_id','generation_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','expected_version','request_sha256','request_text','file_count','total_bytes','manifest_sha256','completed_at','expires_at','created_at','created_by','origin','operation_id','import_row_id']
} as const;
type Kind=keyof typeof journalSourceColumns;
type Context=Readonly<{businessId:string;snapshotToken:string;observedAt:string;recordCounts:Readonly<Record<Kind,string>>;originalTextBytes:string}>;
type Query=(sql:string,values:unknown[])=>Promise<{rows:unknown[]}>;
const kinds=Object.keys(journalSourceColumns) as Kind[],textKinds=new Set(['snapshot','intent','verification','completion']);
const metadataLimit=8388608,originalLimit=16777216,wireLimit=25165824,recordLimit=10000;
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export class JournalCollectionError extends Error{constructor(){super('JOURNAL_SOURCE_COLLECTION_REVIEW_REQUIRED');this.name='JournalCollectionError';}}
function require(v:unknown):asserts v{if(!v)throw new JournalCollectionError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);
 require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function json(input:unknown,limit:number){
 require(typeof input==='string'&&input.length>0&&input.length<=limit&&!input.includes('\0')&&Buffer.byteLength(input)<=limit&&Buffer.from(input).toString('utf8')===input);const value:unknown=JSON.parse(input);require(historyJsonEqual(parseHistoryJson(input),parseHistoryJson(JSON.stringify(value))));return{raw:input,value,bytes:Buffer.byteLength(input)};
}
function decimal(value:unknown,maximum:number):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(value)&&BigInt(value)<=BigInt(maximum);}
export function journalCollectionContext(raw:unknown,businessId:string,observedAt:string):Context{
 const parsed=json(raw,8192),c=object(parsed.value,['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts','originalTextBytes']);
 require(uuid(businessId)&&c.schemaVersion===1&&c.scope==='source_export_journal'&&c.businessId===businessId&&c.observedAt===observedAt&&hash(c.snapshotToken)&&decimal(c.originalTextBytes,originalLimit));const counts=object(c.recordCounts,kinds);let total=0;for(const kind of kinds){require(decimal(counts[kind],recordLimit));total+=Number(counts[kind]);}require(total<=recordLimit);
 return Object.freeze({businessId,snapshotToken:c.snapshotToken,observedAt,recordCounts:Object.freeze(counts) as Context['recordCounts'],originalTextBytes:c.originalTextBytes});
}
function projection(input:unknown,businessId:string,kind:Kind,key:string){
 const columns=journalSourceColumns[kind].filter(c=>c!=='request_text'),row=object(input,columns);require(row.business_id===businessId&&row.origin==='manual'&&row.import_row_id===null);
 if(kind==='job')parseSourceExportJob(row,businessId);
 else for(const [name,value]of Object.entries(row)){
  if(name==='import_row_id')continue;
  if(name==='expected_version')require(version(value));
  else if(name.endsWith('_at')||name==='lease_until')require(instant(value));
  else if(name.endsWith('_sha256'))require(hash(value));
  else if(name==='app_release_id')require(typeof value==='string'&&/^[a-f0-9]{40}$/.test(value));
  else if(name==='key_id')require(typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value));
  else if(name==='id'||name.endsWith('_id')||name.endsWith('_by')||name==='recovery_epoch')require(uuid(value));
  else if(['attempt_no','ordinal','plaintext_bytes','ciphertext_bytes','file_count','total_bytes','source_schema_version'].includes(name))require(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=67108864);
  else require(typeof value==='string'&&value.length<=1024);
 }
 if(kind==='snapshot')require(row.source_schema_version===43);
 const actual=kind==='job'||kind==='attempt'?row.id:kind==='intent'||kind==='verification'?row.generation_id+':'+row.part_id:row.generation_id;require(actual===key);return row;
}

// Called only through the surrounding collector's OWNED snapshot query and
// deadline. No connection, authentication, output file or dispatch of its own.
export async function collectJournalSources(query:Query,check:()=>void,input:Readonly<{rawContext:string;businessId:string;observedAt:string;generationId:string;remainingMetadataBytes:number;remainingRecords:number}>){
 const ctx=journalCollectionContext(input.rawContext,input.businessId,input.observedAt);require(uuid(input.generationId)&&Number.isSafeInteger(input.remainingMetadataBytes)&&input.remainingMetadataBytes>=0&&input.remainingMetadataBytes<=metadataLimit&&Number.isSafeInteger(input.remainingRecords)&&input.remainingRecords>=0&&input.remainingRecords<=recordLimit);
 const declared=Object.values(ctx.recordCounts).reduce((n,c)=>n+Number(c),0);require(declared<=input.remainingRecords);let metadataBytes=Buffer.byteLength(input.rawContext),wireBytes=0,originalBytes=0,recordCount=0;
 require(metadataBytes<=input.remainingMetadataBytes);const pages={} as Record<Kind,string[]>,originals:{kind:JournalTextKind;recordKey:string;chunks:readonly string[]}[]=[];
 for(const kind of kinds){pages[kind]=[];let cursor:string|null=null,count=0;
  for(;;){check();const page=await query('SELECT * FROM crest_commands.source_export_journal_page($1::uuid,$2::text,$3::text,$4::text,$5::integer)',[ctx.businessId,ctx.snapshotToken,kind,cursor,20]);check();require(Array.isArray(page.rows)&&page.rows.length<=20);
   const safeRows=page.rows.map(value=>{const r=object(value,['record_key','canonical_evidence','evidence_hash']);require(typeof r.record_key==='string'&&r.record_key.length<=73&&typeof r.canonical_evidence==='string'&&r.canonical_evidence.length<=8192&&hash(r.evidence_hash));return r;});
   const pageText=JSON.stringify(safeRows);metadataBytes+=Buffer.byteLength(pageText);require(metadataBytes<=input.remainingMetadataBytes);pages[kind].push(pageText);
   for(const r of safeRows){require(typeof r.record_key==='string'&&(cursor===null||r.record_key>cursor));const body=json(r.canonical_evidence,8192);require(sha(body.raw)===r.evidence_hash);const e=object(body.value,['schemaVersion','scope','kind','businessId','recordKey','row','originalText']);require(e.schemaVersion===1&&e.scope==='source_export_journal'&&e.kind===kind&&e.businessId===ctx.businessId&&e.recordKey===r.record_key);const row=projection(e.row,ctx.businessId,kind,r.record_key);count++;recordCount++;require(count<=Number(ctx.recordCounts[kind])&&recordCount<=input.remainingRecords);
    if(textKinds.has(kind)){
     const descriptor=object(e.originalText,['column','bytes','sha256','chunkBytes','chunks']);require(descriptor.sha256===row.request_sha256&&typeof descriptor.bytes==='number');originalBytes+=descriptor.bytes;require(originalBytes<=Number(ctx.originalTextBytes)&&originalBytes<=originalLimit);
     const typed=descriptor as JournalTextDescriptor,assembler=createJournalTextAssembler({businessId:ctx.businessId,snapshotToken:ctx.snapshotToken,kind:kind as JournalTextKind,recordKey:r.record_key,descriptor:typed}),chunks:string[]=[];
     try{for(let index=0;index<typed.chunks;index++){check();const result=await query('SELECT crest_commands.source_export_journal_text_chunk($1::uuid,$2::text,$3::text,$4::text,$5::integer)::text AS chunk',[ctx.businessId,ctx.snapshotToken,kind,r.record_key,index]);check();require(Array.isArray(result.rows)&&result.rows.length===1);const raw=json(object(result.rows[0],['chunk']).chunk,1048576);wireBytes+=raw.bytes;require(wireBytes<=wireLimit);assembler.append(raw.value);chunks.push(raw.raw);}assembler.finish();check();}
     finally{assembler.dispose();}originals.push(Object.freeze({kind:kind as JournalTextKind,recordKey:r.record_key,chunks:Object.freeze(chunks)}));
    }else require(e.originalText===null);
    cursor=r.record_key;
   }
   if(page.rows.length<20)break;
  }require(String(count)===ctx.recordCounts[kind]);
 }
 require(recordCount===declared&&String(originalBytes)===ctx.originalTextBytes);check();const journal=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',sourceSchemaVersion:43,generationId:input.generationId,businessId:ctx.businessId,observedAt:ctx.observedAt,context:input.rawContext,pages,originals,metadataBytes,wireBytes,originalBytes,recordCount,completePortableExport:false,completeBackup:false});require(Buffer.byteLength(journal)<=input.remainingMetadataBytes+wireLimit);check();
 return Object.freeze({journal,metadataBytes,wireBytes,originalBytes,recordCount,serializedBytes:Buffer.byteLength(journal)});
}
