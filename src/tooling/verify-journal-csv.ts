import {createHash} from 'node:crypto';
import {readLogicalSourceExportCsv} from '../security/source-export-csv-reader.ts';
import {createJournalTextAssembler} from '../security/source-export-journal-text.ts';
import type {JournalTextDescriptor,JournalTextKind} from '../security/source-export-journal-text.ts';
import {parseHistoryJson,historyJsonEqual} from '../security/history-evidence-json.ts';

// Independent offline inventory. Never import the collector, CSV writer, SQL
// adapter or provider. A changed writer inventory must fail this review boundary.
const columns={
 job:['id','business_id','actor_id','profile','app_release_id','source_schema_version','recovery_epoch','request_operation_id','state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'],
 attempt:['id','business_id','export_job_id','attempt_no','recovery_epoch','leased_at','lease_until','created_at','created_by','origin','operation_id','import_row_id'],
 snapshot:['generation_id','business_id','export_job_id','lease_id','actor_id','recovery_epoch','app_release_id','source_schema_version','observed_at','plan_sha256','request_sha256','request_text','file_count','total_bytes','manifest_sha256','created_at','created_by','origin','operation_id','import_row_id'],
 intent:['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','ordinal','file_name','content_type','object_key','key_id','plaintext_bytes','plaintext_sha256','ciphertext_bytes','ciphertext_sha256','request_sha256','request_text','created_at','created_by','origin','operation_id','import_row_id'],
 verification:['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','request_sha256','request_text','verified_at','created_at','created_by','origin','operation_id','import_row_id'],
 completion:['business_id','generation_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','expected_version','request_sha256','request_text','file_count','total_bytes','manifest_sha256','completed_at','expires_at','created_at','created_by','origin','operation_id','import_row_id']
} as const;
type Kind=keyof typeof columns;
type Body=Record<string,unknown>;
type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
const kinds=Object.keys(columns) as Kind[],numeric=new Set(['attempt_count','attempt_no','source_schema_version','file_count','total_bytes','ordinal','plaintext_bytes','ciphertext_bytes']);
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export class JournalCsvVerificationError extends Error{constructor(){super('JOURNAL_CSV_VERIFICATION_REQUIRED');this.name='JournalCsvVerificationError';}}
function require(v:unknown):asserts v{if(!v)throw new JournalCsvVerificationError();}
function object(v:unknown,keys:readonly string[]):Body{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));
 const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function text(v:unknown,limit:number):string{require(typeof v==='string'&&v.length>0&&v.length<=limit&&!v.includes('\0')&&Buffer.byteLength(v)<=limit&&Buffer.from(v).toString('utf8')===v);return v;}
function json(v:unknown,limit:number){const s=text(v,limit),value:unknown=JSON.parse(s);require(historyJsonEqual(parseHistoryJson(s),parseHistoryJson(JSON.stringify(value))));return value;}
function same(a:unknown,b:unknown){require(historyJsonEqual(a,b));}
function count(v:unknown,max:number):number{require(typeof v==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(v)&&Number(v)<=max);return Number(v);}

// Input is the reconstructed logical files, after the separate container check.
// Success proves included CSV/source consistency, never source authenticity,
// complete relational recovery, owner permission, Ready or download authority.
export function verifyJournalCsv(manifestText:unknown,input:unknown,expected:Binding){
 try{
  const b=object(expected,['businessId','generationId','appReleaseId','sourceSchemaVersion']);require(uuid(b.businessId)&&uuid(b.generationId)&&typeof b.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(b.appReleaseId)&&b.sourceSchemaVersion===43);
  const m=object(json(manifestText,4194304),['formatVersion','profile','businessId','generationId','appReleaseId','sourceSchemaVersion','observedAt','snapshotToken','assurance','recordCount','sourceCapture','sourceCaptureSha256','completePortableExport','completeBackup','referenceClosureComplete','projections','files']);
  require(m.formatVersion===1&&m.profile==='crest.source-export-journal-csv.v1'&&Object.entries(b).every(([k,v])=>m[k]===v)&&typeof m.observedAt==='string'&&digest(m.snapshotToken)&&m.assurance==='included_source_consistency_only'&&m.completePortableExport===false&&m.completeBackup===false&&m.referenceClosureComplete===false&&m.sourceCapture==='journal_capture.json'&&digest(m.sourceCaptureSha256));
  require(Array.isArray(input)&&input.length===20&&Array.isArray(m.files)&&m.files.length===20);const files=new Map<string,Body>();let total=Buffer.byteLength(manifestText as string);
  for(const raw of input){const f=object(raw,['name','contentType','content','bytes','sha256']);require(typeof f.name==='string'&&!files.has(f.name));const s=text(f.content,33554432);require(f.bytes===Buffer.byteLength(s)&&f.sha256===sha(s));total+=f.bytes as number;require(total<=67108864);files.set(f.name,f);}
  const used=new Set<string>();
  function read(name:string,contentType:string){const f=files.get(name);require(f&&f.contentType===contentType&&!used.has(name));used.add(name);return f.content as string;}
  const listed=new Set<string>();for(const raw of m.files){const f=object(raw,['name','contentType','bytes','sha256']);require(typeof f.name==='string'&&!listed.has(f.name));listed.add(f.name);const actual=files.get(f.name);require(actual);same(f,{name:actual.name,contentType:actual.contentType,bytes:actual.bytes,sha256:actual.sha256});}
  const captured=read('journal_capture.json','application/json');require(sha(captured)===m.sourceCaptureSha256);
  // Outer JSON holds raw source strings; canonical round-trip rejects duplicate
  // envelope keys without parsing or normalizing original request_text values.
  const j=object(JSON.parse(captured),['formatVersion','assurance','sourceSchemaVersion','generationId','businessId','observedAt','context','pages','originals','metadataBytes','wireBytes','originalBytes','recordCount','completePortableExport','completeBackup']);
  require(JSON.stringify(j)===captured&&j.formatVersion===1&&j.assurance==='snapshot_bytes_only'&&j.sourceSchemaVersion===43&&j.generationId===b.generationId&&j.businessId===b.businessId&&j.observedAt===m.observedAt&&j.completePortableExport===false&&j.completeBackup===false);
  const c=object(json(j.context,8192),['schemaVersion','scope','businessId','snapshotToken','observedAt','recordCounts','originalTextBytes']);require(c.schemaVersion===1&&c.scope==='source_export_journal'&&c.businessId===b.businessId&&c.snapshotToken===m.snapshotToken&&c.observedAt===m.observedAt);
  const counts=object(c.recordCounts,kinds),pages=object(j.pages,kinds),projections=object(m.projections,kinds),originals=new Map<string,Body>();let declared=0;
  for(const k of kinds)declared+=count(counts[k],10000);require(declared<=10000&&declared===m.recordCount&&declared===j.recordCount);
  require(Array.isArray(j.originals)&&j.originals.length<=declared);for(const raw of j.originals){const o=object(raw,['kind','recordKey','chunks']);require(typeof o.kind==='string'&&['snapshot','intent','verification','completion'].includes(o.kind)&&typeof o.recordKey==='string'&&Array.isArray(o.chunks)&&o.chunks.length>=1&&o.chunks.length<=24);const key=o.kind+':'+o.recordKey;require(!originals.has(key));originals.set(key,o);}
  let metadata=Buffer.byteLength(j.context as string),wire=0,originalBytes=0,records=0;const rows={} as Record<Kind,readonly Readonly<Body>[]>;
  for(const kind of kinds){
   const schema:readonly string[]=columns[kind],keyColumns=kind==='job'||kind==='attempt'?['id']:kind==='intent'||kind==='verification'?['generation_id','part_id']:['generation_id'],integerColumns=schema.filter(k=>numeric.has(k)),prefix='journal_'+kind;
   const p=object(projections[kind],['csv','escapeMap','dictionary','keyColumns','rowCount']);same(p,{csv:prefix+'.csv',escapeMap:prefix+'_escape_map.json',dictionary:prefix+'_dictionary.json',keyColumns,rowCount:Number(counts[kind])});
   const d=object(json(read(prefix+'_dictionary.json','application/json'),4194304),['schemaVersion','scope','kind','columns','keyColumns','integerColumns','jsonTextColumns','exactTextColumns','null','csv','decode']);
   require(d.schemaVersion===1&&d.scope==='source_export_journal'&&d.kind===kind&&d.null==='\\N'&&d.csv==='UTF-8 RFC4180 CRLF'&&typeof d.decode==='string');same(d.columns,schema);same(d.keyColumns,keyColumns);same(d.integerColumns,integerColumns);same(d.jsonTextColumns,schema.some(k=>k==='request_text')?['request_text']:[]);same(d.exactTextColumns,schema.filter(k=>k==='version'||k==='expected_version'));
   const e=object(json(read(prefix+'_escape_map.json','application/json'),16777216),['schemaVersion','scope','kind','businessId','generationId','appReleaseId','sourceSchemaVersion','snapshotToken','escapes']);require(e.schemaVersion===1&&e.scope==='source_export_journal'&&e.kind===kind&&Object.entries(b).every(([k,v])=>e[k]===v)&&e.snapshotToken===m.snapshotToken);
   const decoded=readLogicalSourceExportCsv(read(prefix+'.csv','text/csv; charset=utf-8'),e.escapes,{columns:schema,keyColumns,integers:integerColumns,maxRows:10000});
   const source:Body[]=[];require(Array.isArray(pages[kind])&&(pages[kind] as unknown[]).length>=1&&(pages[kind] as unknown[]).length<=501);let prior='';
   for(const [index,raw]of (pages[kind] as unknown[]).entries()){
    const page=json(raw,8388608);require(Array.isArray(page)&&page.length<=20&&(index===(pages[kind] as unknown[]).length-1?page.length<20:page.length===20));metadata+=Buffer.byteLength(raw as string);require(metadata<=8388608);
    for(const entry of page){
     const r=object(entry,['record_key','canonical_evidence','evidence_hash']);require(typeof r.record_key==='string'&&r.record_key>prior&&typeof r.canonical_evidence==='string'&&sha(r.canonical_evidence)===r.evidence_hash);prior=r.record_key;
     const evidence=object(json(r.canonical_evidence,8192),['schemaVersion','scope','kind','businessId','recordKey','row','originalText']);require(evidence.schemaVersion===1&&evidence.scope==='source_export_journal'&&evidence.kind===kind&&evidence.businessId===b.businessId&&evidence.recordKey===prior);
     const row=object(evidence.row,schema.filter(k=>k!=='request_text'));require(row.business_id===b.businessId);const key=keyColumns.map(k=>row[k]).join(':');require(key===prior&&keyColumns.every(k=>uuid(row[k])));
     for(const [k,v]of Object.entries(row))require(v===null||typeof v==='string'||integerColumns.includes(k)&&typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=67108864);
     if(kind==='job'||kind==='attempt')require(evidence.originalText===null);
     else{
      const descriptor=object(evidence.originalText,['column','bytes','sha256','chunkBytes','chunks']),o=originals.get(kind+':'+prior);require(o&&Array.isArray(o.chunks)&&o.chunks.length===descriptor.chunks&&descriptor.sha256===row.request_sha256);
      const assembler=createJournalTextAssembler({businessId:b.businessId as string,snapshotToken:m.snapshotToken as string,kind:kind as JournalTextKind,recordKey:prior,descriptor:descriptor as JournalTextDescriptor});
      try{for(const chunk of o.chunks){wire+=Buffer.byteLength(text(chunk,1048576));require(wire<=25165824);assembler.append(json(chunk,1048576));}row.request_text=assembler.finish().forServer();}finally{assembler.dispose();}
      originalBytes+=Buffer.byteLength(row.request_text as string);require(originalBytes<=16777216);originals.delete(kind+':'+prior);
     }
     source.push(row);records++;require(records<=declared);
    }
   }
   require(source.length===Number(counts[kind]));same(decoded,source);rows[kind]=decoded;
  }
  require(originals.size===0&&records===declared&&metadata===j.metadataBytes&&wire===j.wireBytes&&originalBytes===j.originalBytes&&originalBytes===count(c.originalTextBytes,16777216));
  read('journal_csv_readme.txt','text/plain; charset=utf-8');require(used.size===files.size);
  const value=Object.freeze({...b,observedAt:m.observedAt,recordCount:records,rows:Object.freeze(rows),assurance:'included_source_consistency_only' as const,referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  return Object.freeze({forJournalVerification:()=>value,toJSON():never{throw new JournalCsvVerificationError();}});
 }catch{throw new JournalCsvVerificationError();}
}
