import {createHash} from 'node:crypto';
import {verifySourceLogicalFiles} from './verify-source-logical-files.ts';
import {verifyJournalCsv} from './verify-journal-csv.ts';
import {verifyBusinessSourceProjection43} from '../security/business-source-verifier.ts';
import {parseHistoryJson,historyJsonEqual} from '../security/history-evidence-json.ts';

type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
export class BusinessSourceJournalVerificationError extends Error{constructor(){super('BUSINESS_SOURCE_JOURNAL_VERIFICATION_REQUIRED');this.name='BusinessSourceJournalVerificationError';}}
function require(v:unknown):asserts v{if(!v)throw new BusinessSourceJournalVerificationError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{require(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)));return v as Record<string,unknown>;}
// Independent composition: no formatter, collector, database or provider import.
export function verifyBusinessSourceJournalBundle(manifestText:unknown,physical:unknown,expected:Binding){
 try{
  const b={...expected},container=verifySourceLogicalFiles(manifestText,physical,b),files=new Map(container.files.map(f=>[f.name,f])),used=new Set<string>();
  function read(name:string){const f=files.get(name);require(f&&!used.has(name));used.add(name);return f;}
  function json(text:string){const v:unknown=JSON.parse(text);require(historyJsonEqual(parseHistoryJson(text),parseHistoryJson(JSON.stringify(v))));return v;}
  const root=read('source_journal_manifest.json');require(root.contentType==='application/json'&&root.bytes<=4194304);
  const m=object(json(root.content),['formatVersion','profile','businessId','generationId','appReleaseId','sourceSchemaVersion','observedAt','captureDeclared','assurance','consistentCaptureProven','referenceClosureComplete','completePortableExport','completeBackup','sourceManifest','sourceManifestSha256','journalManifest','journalManifestSha256','sourceRecordCount','journalRecordCount','recordCount','evidenceBytes','metadataBytes','originalBytes','wireBytes']);
  require(m.formatVersion===1&&m.profile==='crest.business-source-journal-bundle.v1'&&Object.entries(b).every(([k,v])=>m[k]===v)&&m.captureDeclared==='single_connection_repeatable_read'&&m.assurance==='included_source_consistency_only'&&m.consistentCaptureProven===false&&m.referenceClosureComplete===false&&m.completePortableExport===false&&m.completeBackup===false&&m.sourceManifest==='source_projection_manifest.json'&&m.journalManifest==='journal_csv_manifest.json');
  const sourceManifest=read('source_projection_manifest.json'),journalManifest=read('journal_csv_manifest.json');require(sourceManifest.contentType==='application/json'&&journalManifest.contentType==='application/json'&&sha(sourceManifest.content)===m.sourceManifestSha256&&sha(journalManifest.content)===m.journalManifestSha256);
  const sourceJson=json(sourceManifest.content) as {parts:unknown[];recordCount:number;evidenceBytes:number},journalJson=json(journalManifest.content) as {files:unknown[]};require(Array.isArray(sourceJson.parts)&&sourceJson.parts.length<=1024&&Array.isArray(journalJson.files)&&journalJson.files.length===20);
  const sourceParts=sourceJson.parts.map(p=>{const d=object(p,['name','contentType','bytes','sha256']);require(typeof d.name==='string');const f=read(d.name);require(f.contentType===d.contentType);return {name:f.name,bytes:Buffer.from(f.content)};});
  const source=verifyBusinessSourceProjection43({manifest:Buffer.from(sourceManifest.content),parts:sourceParts},b).forProjection43();
  const journalFiles=journalJson.files.map(p=>{const d=object(p,['name','contentType','bytes','sha256']);require(typeof d.name==='string');return read(d.name);});
  const journal=verifyJournalCsv(journalManifest.content,journalFiles,b).forJournalVerification();
  require(used.size===files.size&&source.generationId===b.generationId&&source.observedAt===m.observedAt&&journal.observedAt===m.observedAt);
  const rawJournal=files.get('journal_capture.json');require(rawJournal);const j=JSON.parse(rawJournal.content);
  const bytes=[source.configuration,source.identity,source.history,source.crm,rawJournal.content].reduce((n,t)=>n+Buffer.byteLength(t),0);
  require(bytes<=33554432&&bytes===m.evidenceBytes&&m.sourceRecordCount===sourceJson.recordCount&&m.journalRecordCount===journal.recordCount&&m.recordCount===sourceJson.recordCount+journal.recordCount&&Number.isSafeInteger(m.recordCount)&&(m.recordCount as number)<=10000&&m.metadataBytes===sourceJson.evidenceBytes+j.metadataBytes&&m.originalBytes===j.originalBytes&&m.wireBytes===j.wireBytes);
  const value=Object.freeze({...b,observedAt:source.observedAt,sourceRows:source.rows,journalRows:journal.rows,recordCount:m.recordCount,assurance:'included_source_consistency_only' as const,consistentCaptureProven:false as const,referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  return Object.freeze({forJournalBundleVerification:()=>value,toJSON():never{throw new BusinessSourceJournalVerificationError();}});
 }catch{throw new BusinessSourceJournalVerificationError();}
}
