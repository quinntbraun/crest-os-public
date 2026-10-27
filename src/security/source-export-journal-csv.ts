import 'server-only';
import {createHash} from 'node:crypto';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {collectJournalSources,journalSourceColumns} from './source-export-journal-collection.ts';
import {createJournalTextAssembler} from './source-export-journal-text.ts';
import type {JournalTextKind,JournalTextDescriptor} from './source-export-journal-text.ts';

type Kind=keyof typeof journalSourceColumns;
type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
type File=Readonly<{name:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';content:string;bytes:number;sha256:string}>;
const kinds=Object.keys(journalSourceColumns) as Kind[],numeric=new Set(['attempt_count','attempt_no','source_schema_version','file_count','total_bytes','ordinal','plaintext_bytes','ciphertext_bytes']);
const sha=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex'),quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
export class JournalCsvError extends Error{constructor(){super('JOURNAL_CSV_REVIEW_REQUIRED');this.name='JournalCsvError';}}
function require(v:unknown):asserts v{if(!v)throw new JournalCsvError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{
 require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
// Revalidate the complete captured envelope by replaying its fixed reader
// responses in memory. No database/provider call or capture provenance claim.
async function replay(raw:string,b:Binding){
 require(raw.length<=33554432&&Buffer.byteLength(raw)<=33554432&&!raw.includes('\0')&&Buffer.from(raw).toString('utf8')===raw);const j=object(JSON.parse(raw),['formatVersion','assurance','sourceSchemaVersion','generationId','businessId','observedAt','context','pages','originals','metadataBytes','wireBytes','originalBytes','recordCount','completePortableExport','completeBackup']);
 require(j.generationId===b.generationId&&j.businessId===b.businessId&&typeof j.observedAt==='string'&&typeof j.context==='string'&&Array.isArray(j.originals)&&j.originals.length<=10000);const pages=object(j.pages,kinds),positions=Object.fromEntries(kinds.map(k=>[k,0])) as Record<Kind,number>,originals=new Map<string,{chunks:string[];used:number}>();
 for(const kind of kinds)require(Array.isArray(pages[kind])&&(pages[kind] as unknown[]).length>=1&&(pages[kind] as unknown[]).length<=501&&(pages[kind] as unknown[]).every(p=>typeof p==='string'));
 for(const value of j.originals){const o=object(value,['kind','recordKey','chunks']);require(typeof o.kind==='string'&&['snapshot','intent','verification','completion'].includes(o.kind)&&typeof o.recordKey==='string'&&Array.isArray(o.chunks)&&o.chunks.length>=1&&o.chunks.length<=24&&o.chunks.every(c=>typeof c==='string'));const key=o.kind+':'+o.recordKey;require(!originals.has(key));originals.set(key,{chunks:o.chunks,used:0});}
 const query=async(sql:string,args:unknown[])=>{
  if(sql.includes('source_export_journal_page(')){const kind=args[2] as Kind,index=positions[kind]++;return {rows:JSON.parse((pages[kind] as string[])[index]!)};}
  require(sql.includes('source_export_journal_text_chunk('));const original=originals.get(args[2]+':'+args[3]);require(original&&args[4]===original.used&&original.used<original.chunks.length);return {rows:[{chunk:original.chunks[original.used++]!}]};
 };
 const checked=await collectJournalSources(query,()=>{},{rawContext:j.context,businessId:b.businessId,observedAt:j.observedAt,generationId:b.generationId,remainingMetadataBytes:8388608,remainingRecords:10000});
 require(checked.journal===raw&&kinds.every(k=>positions[k]===(pages[k] as unknown[]).length)&&[...originals.values()].every(o=>o.used===o.chunks.length));return {j,pages,originals};
}

// Reversible source projection only. All114 source columns remain present,
// including original request_text as text rather than a rounded JSON value.
export async function formatSourceExportJournalCsv(serialized:unknown,expected:Binding){
 try{
  const binding=object(expected,['businessId','generationId','appReleaseId','sourceSchemaVersion']);require(uuid(binding.businessId)&&uuid(binding.generationId)&&typeof binding.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(binding.appReleaseId)&&binding.sourceSchemaVersion===43&&typeof serialized==='string');
  const b=binding as Binding,{j,pages,originals}=await replay(serialized,b),context=JSON.parse(j.context as string),files:File[]=[];let total=0,totalRows=0,flags=0;
  function add(name:string,content: string,contentType:File['contentType']){const bytes=Buffer.byteLength(content);require(bytes<=33554432&&total+bytes<=67108864);total+=bytes;files.push(Object.freeze({name,contentType,content,bytes,sha256:sha(content)}));}
  const projections:Record<string,{csv:string;escapeMap:string;dictionary:string;keyColumns:readonly string[];rowCount:number}>={};
  for(const kind of kinds){
   const columns=journalSourceColumns[kind],keyColumns=kind==='job'||kind==='attempt'?['id']:kind==='intent'||kind==='verification'?['generation_id','part_id']:['generation_id'],lines=[columns.map(quote).join(',')],escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];let csvBytes=Buffer.byteLength(lines[0]!)+2,rowCount=0;
   for(const text of pages[kind] as string[])for(const source of JSON.parse(text)){
    const e=JSON.parse(source.canonical_evidence),row={...e.row} as Record<string,unknown>;
    if(e.originalText){const assembler=createJournalTextAssembler({businessId:b.businessId,snapshotToken:context.snapshotToken,kind:kind as JournalTextKind,recordKey:e.recordKey,descriptor:e.originalText as JournalTextDescriptor});try{for(const chunk of originals.get(kind+':'+e.recordKey)!.chunks)assembler.append(JSON.parse(chunk));row.request_text=assembler.finish().forServer();}finally{assembler.dispose();}}
    require(Object.keys(row).length===columns.length&&columns.every(c=>Object.hasOwn(row,c)));const line=columns.map(column=>{
     const original=row[column];if(original===null)return quote('\\N');require(typeof original==='string'||typeof original==='number');let value=String(original).replaceAll('\\','\\\\');
     if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??''))){value="'"+value;escapes.push({row_id:e.recordKey,column,apostrophe_prefix:true});flags++;require(flags<=100000);}
     return quote(value);
    }).join(',');csvBytes+=Buffer.byteLength(line)+2;require(csvBytes<=33554432);lines.push(line);rowCount++;
   }
   require(String(rowCount)===context.recordCounts[kind]);totalRows+=rowCount;const prefix='journal_'+kind,csv=prefix+'.csv',escapeMap=prefix+'_escape_map.json',dictionary=prefix+'_dictionary.json';
   add(csv,lines.join('\r\n')+'\r\n','text/csv; charset=utf-8');add(escapeMap,JSON.stringify({schemaVersion:1,scope:'source_export_journal',kind,...b,snapshotToken:context.snapshotToken,escapes})+'\n','application/json');
   add(dictionary,JSON.stringify({schemaVersion:1,scope:'source_export_journal',kind,columns,keyColumns,integerColumns:columns.filter(c=>numeric.has(c)),jsonTextColumns:columns.some(c=>c==='request_text')?['request_text']:[],exactTextColumns:columns.filter(c=>c==='version'||c==='expected_version'),null:'\\N',csv:'UTF-8 RFC4180 CRLF',decode:'Read all cells as text. Unescaped \\N is null. Remove exactly the apostrophe recorded for row_id (UUID or generation_id:part_id) and column, then decode paired backslashes. Convert only declared bounded integerColumns. Keep bigint versions, instants and original request_text as exact text; never infer JSON or numeric cell types.'})+'\n','application/json');projections[kind]={csv,escapeMap,dictionary,keyColumns,rowCount};
  }
  require(totalRows===j.recordCount);add('journal_capture.json',serialized,'application/json');add('journal_csv_readme.txt','Proposed Crest journal CSV profile1\nSix CSVs preserve all114 source columns. Use their dictionaries and per-cell formula escape maps. request_text remains exact original text. Large logical CSV/JSON files must be split/reconstructed through the proposed logical-file container before use; no physical encryption-file limit is increased.\nIncluded journal_capture.json retains original metadata evidence and chunk JSON. Independent CSV decoding must reproduce those same source rows, then actual neutral relational reconstruction/recovery remains required.\nHashes and included source consistency do not prove authenticity, capture provenance, complete relationships, authorization, Ready, download or whole-business backup.\n','text/plain; charset=utf-8');
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.source-export-journal-csv.v1',...b,observedAt:j.observedAt,snapshotToken:context.snapshotToken,assurance:'included_source_consistency_only',recordCount:totalRows,sourceCapture:'journal_capture.json',sourceCaptureSha256:sha(serialized),completePortableExport:false,completeBackup:false,referenceClosureComplete:false,projections,files:files.map(({name,contentType,bytes,sha256})=>({name,contentType,bytes,sha256}))})+'\n';require(Buffer.byteLength(manifest)<=4194304&&total+Buffer.byteLength(manifest)<=67108864);
  const result=Object.freeze({files:Object.freeze(files),manifest});return Object.freeze({forJournalCsv:()=>result,toJSON():never{throw new JournalCsvError();}});
 }catch{throw new JournalCsvError();}
}
