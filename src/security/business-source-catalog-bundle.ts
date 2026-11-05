import 'server-only';
import {createHash} from 'node:crypto';
import type {BusinessSourceCatalogCapture} from './business-foundation-collector.ts';
import {formatBusinessSourceJournalBundle} from './business-source-journal-bundle.ts';
import {formatServiceCatalogCsv} from '../commercial/service-catalog-csv.ts';
import {readServiceCatalogCapture} from '../tooling/verify-service-catalog-csv.ts';
import {verifySourceLogicalFiles} from '../tooling/verify-source-logical-files.ts';
import {formatSourceLogicalFiles} from './source-export-logical-files.ts';
type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export class BusinessSourceCatalogBundleError extends Error{constructor(){super('BUSINESS_SOURCE_CATALOG_BUNDLE_REVIEW_REQUIRED');this.name='BusinessSourceCatalogBundleError';}}
function require(v:unknown):asserts v{if(!v)throw new BusinessSourceCatalogBundleError();}
// Construction composition only, distinct from the adopted43 journal/worker.
// Schema provenance and incomplete assurance remain explicit in every layer.
export async function formatBusinessSourceCatalogBundle(capture:BusinessSourceCatalogCapture,expected:Binding){
 try{
  const s={...capture.forCatalogServer()},b={...expected},keys=['formatVersion','registeredSourceSchemaVersion','catalogRegistered','source','catalog','metadataBytes','evidenceBytes','recordCount','completePortableExport','completeBackup'];
  require(Object.keys(s).length===keys.length&&keys.every(k=>Object.hasOwn(s,k))&&s.formatVersion===1&&s.registeredSourceSchemaVersion===43&&s.catalogRegistered===false&&s.completePortableExport===false&&s.completeBackup===false);
  const catalog=readServiceCatalogCapture(s.catalog,{businessId:b.businessId,generationId:b.generationId,observedAt:s.source.observedAt});
  require(s.metadataBytes===s.source.metadataBytes+catalog.metadataBytes&&s.metadataBytes<=8388608&&s.evidenceBytes===s.source.evidenceBytes+Buffer.byteLength(s.catalog)&&s.evidenceBytes<=33554432&&s.recordCount===s.source.recordCount+catalog.recordCount&&s.recordCount<=10000);
  const base=(await formatBusinessSourceJournalBundle({forJournalServer:()=>s.source,toJSON():never{throw new BusinessSourceCatalogBundleError();}},b)).forJournalBundle(),decoded=verifySourceLogicalFiles(base.manifest,base.parts,b);
  const csv=formatServiceCatalogCsv({businessId:b.businessId,snapshotToken:catalog.snapshotToken,expectedServiceCount:catalog.serviceCount,expectedVersionCount:catalog.versionCount,services:catalog.services,versions:catalog.versions});
  const added=[
   {name:'services.csv',contentType:'text/csv; charset=utf-8' as const,content:csv.servicesCsv},
   {name:'service_versions.csv',contentType:'text/csv; charset=utf-8' as const,content:csv.versionsCsv},
   {name:'service_catalog_escape_map.json',contentType:'application/json' as const,content:csv.escapeMap},
   {name:'service_catalog_dictionary.json',contentType:'application/json' as const,content:csv.dictionary},
   {name:'service_catalog_manifest.json',contentType:'application/json' as const,content:csv.manifest},
   {name:'catalog_capture.json',contentType:'application/json' as const,content:s.catalog},
   {name:'journal_container_manifest.json',contentType:'application/json' as const,content:base.manifest}
  ];
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.business-source-catalog-candidate.v1',...b,registeredSourceSchemaVersion:43,catalogRegistered:false,observedAt:s.source.observedAt,assurance:'included_source_consistency_only',snapshotProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,journalContainer:'journal_container_manifest.json',journalContainerSha256:sha(base.manifest),catalogCapture:'catalog_capture.json',catalogCaptureSha256:sha(s.catalog),catalogManifest:'service_catalog_manifest.json',catalogManifestSha256:sha(csv.manifest),baseFileCount:decoded.files.length,sourceRecordCount:s.source.recordCount,catalogRecordCount:catalog.recordCount,recordCount:s.recordCount,metadataBytes:s.metadataBytes,evidenceBytes:s.evidenceBytes})+'\n';
  const inputs=[...decoded.files,...added,{name:'source_catalog_manifest.json',contentType:'application/json' as const,content:manifest}].map(({name,contentType,content})=>({name,contentType:contentType as 'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8',content}));
  const result=formatSourceLogicalFiles(inputs,b).forLogicalFiles();
  return Object.freeze({forCatalogBundle:()=>result,toJSON():never{throw new BusinessSourceCatalogBundleError();}});
 }catch{throw new BusinessSourceCatalogBundleError();}
}
