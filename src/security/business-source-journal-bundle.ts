import 'server-only';
import {createHash} from 'node:crypto';
import type {BusinessSourceJournalCapture} from './business-foundation-collector.ts';
import {formatBusinessSourceProjection43} from './business-source-bundle.ts';
import {formatSourceExportJournalCsv} from './source-export-journal-csv.ts';
import {formatSourceLogicalFiles} from './source-export-logical-files.ts';

type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
export class BusinessSourceJournalBundleError extends Error{constructor(){super('BUSINESS_SOURCE_JOURNAL_BUNDLE_REVIEW_REQUIRED');this.name='BusinessSourceJournalBundleError';}}
function require(v:unknown):asserts v{if(!v)throw new BusinessSourceJournalBundleError();}
// Proposed joint profile only. No worker, database or authority composition.
export async function formatBusinessSourceJournalBundle(capture:BusinessSourceJournalCapture,expected:Binding){
 try{
  const b={...expected},s={...capture.forJournalServer()},keys=['formatVersion','sourceSchemaVersion','generationId','businessId','observedAt','capture','configuration','identity','history','crm','journal','metadataBytes','originalBytes','wireBytes','evidenceBytes','recordCount','completePortableExport','completeBackup'];
  require(Object.keys(s).length===keys.length&&keys.every(k=>Object.hasOwn(s,k))&&s.formatVersion===1&&s.sourceSchemaVersion===43&&s.businessId===b.businessId&&s.generationId===b.generationId&&s.capture==='single_connection_repeatable_read'&&s.completePortableExport===false&&s.completeBackup===false);
  const texts=[s.configuration,s.identity,s.history,s.crm,s.journal];require(texts.every(t=>typeof t==='string'&&t.length<=33554432)&&texts.reduce((n,t)=>n+Buffer.byteLength(t),0)===s.evidenceBytes&&s.evidenceBytes<=33554432);
  const foundation=[s.configuration,s.identity,s.history].map(t=>JSON.parse(t)),crm=JSON.parse(s.crm),journal=JSON.parse(s.journal),sourceRecords=foundation.reduce((n,g)=>n+g.records.length,0)+crm.recordCount,sourceBytes=foundation.reduce((n,g)=>n+g.evidenceBytes,0)+crm.evidenceBytes;
  const projection=formatBusinessSourceProjection43({formatVersion:1,sourceSchemaVersion:43,generationId:s.generationId,businessId:s.businessId,observedAt:s.observedAt,capture:s.capture,configuration:s.configuration,identity:s.identity,history:s.history,crm:s.crm,evidenceBytes:sourceBytes,recordCount:sourceRecords,completePortableExport:false,completeBackup:false},b).forProjection43();
  const csv=(await formatSourceExportJournalCsv(s.journal,b)).forJournalCsv();
  require(journal.observedAt===s.observedAt&&s.metadataBytes===sourceBytes+journal.metadataBytes&&s.originalBytes===journal.originalBytes&&s.wireBytes===journal.wireBytes&&s.recordCount===sourceRecords+journal.recordCount&&Number.isSafeInteger(s.recordCount)&&s.recordCount<=10000);
  const joint=JSON.stringify({formatVersion:1,profile:'crest.business-source-journal-bundle.v1',...b,observedAt:s.observedAt,captureDeclared:s.capture,assurance:'included_source_consistency_only',consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,sourceManifest:'source_projection_manifest.json',sourceManifestSha256:sha(projection.manifest),journalManifest:'journal_csv_manifest.json',journalManifestSha256:sha(csv.manifest),sourceRecordCount:sourceRecords,journalRecordCount:journal.recordCount,recordCount:s.recordCount,evidenceBytes:s.evidenceBytes,metadataBytes:s.metadataBytes,originalBytes:s.originalBytes,wireBytes:s.wireBytes})+'\n';
  const files=[...projection.parts,...csv.files,{name:'source_projection_manifest.json',contentType:'application/json' as const,content:projection.manifest},{name:'journal_csv_manifest.json',contentType:'application/json' as const,content:csv.manifest},{name:'source_journal_manifest.json',contentType:'application/json' as const,content:joint}].map(({name,contentType,content})=>({name,contentType,content}));
  const formatted=formatSourceLogicalFiles(files,b).forLogicalFiles();
  return Object.freeze({forJournalBundle:()=>formatted,toJSON():never{throw new BusinessSourceJournalBundleError();}});
 }catch{throw new BusinessSourceJournalBundleError();}
}
