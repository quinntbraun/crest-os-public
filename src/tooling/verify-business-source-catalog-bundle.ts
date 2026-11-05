import {createHash} from 'node:crypto';
import {verifySourceLogicalFiles} from './verify-source-logical-files.ts';
import {verifyBusinessSourceJournalBundle} from './verify-business-source-journal-bundle.ts';
import {readServiceCatalogCapture,verifyServiceCatalogCsv} from './verify-service-catalog-csv.ts';
import {parseHistoryJson,historyJsonEqual} from '../security/history-evidence-json.ts';
type Binding=Readonly<{businessId:string;generationId:string;appReleaseId:string;sourceSchemaVersion:43}>;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
export class BusinessSourceCatalogVerificationError extends Error{constructor(){super('BUSINESS_SOURCE_CATALOG_VERIFICATION_REQUIRED');this.name='BusinessSourceCatalogVerificationError';}}
function require(v:unknown):asserts v{if(!v)throw new BusinessSourceCatalogVerificationError();}
function object(v:unknown,keys:readonly string[]):Record<string,unknown>{require(v!==null&&typeof v==='object'&&!Array.isArray(v));const d=Object.getOwnPropertyDescriptors(v);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));}
function json(s:string){const value:unknown=JSON.parse(s);require(historyJsonEqual(parseHistoryJson(s),parseHistoryJson(JSON.stringify(value))));return value;}
// Offline, independent composition. No formatter, collector, provider,
// database, Ready acknowledgment, production import or download capability.
export function verifyBusinessSourceCatalogBundle(manifestText:unknown,physical:unknown,expected:Binding){
 try{
  const b={...expected},container=verifySourceLogicalFiles(manifestText,physical,b),files=new Map(container.files.map(f=>[f.name,f])),used=new Set<string>();
  function read(name:string,type='application/json'){const f=files.get(name);require(f&&!used.has(name)&&f.contentType===type);used.add(name);return f;}
  const root=object(json(read('source_catalog_manifest.json').content),['formatVersion','profile','businessId','generationId','appReleaseId','sourceSchemaVersion','registeredSourceSchemaVersion','catalogRegistered','observedAt','assurance','snapshotProven','referenceClosureComplete','completePortableExport','completeBackup','journalContainer','journalContainerSha256','catalogCapture','catalogCaptureSha256','catalogManifest','catalogManifestSha256','baseFileCount','sourceRecordCount','catalogRecordCount','recordCount','metadataBytes','evidenceBytes']);
  require(root.formatVersion===1&&root.profile==='crest.business-source-catalog-candidate.v1'&&Object.entries(b).every(([k,v])=>root[k]===v)&&root.registeredSourceSchemaVersion===43&&root.catalogRegistered===false&&typeof root.observedAt==='string'&&root.assurance==='included_source_consistency_only'&&root.snapshotProven===false&&root.referenceClosureComplete===false&&root.completePortableExport===false&&root.completeBackup===false&&root.journalContainer==='journal_container_manifest.json'&&root.catalogCapture==='catalog_capture.json'&&root.catalogManifest==='service_catalog_manifest.json');
  const base=read('journal_container_manifest.json');require(sha(base.content)===root.journalContainerSha256);
  const baseEnvelope=json(base.content) as {files:{name:string;contentType:string;bytes:number;sha256:string;parts:{name:string}[]}[]};require(Array.isArray(baseEnvelope.files)&&baseEnvelope.files.length===root.baseFileCount);
  const baseParts=new Set<string>();for(const f of baseEnvelope.files){const actual=read(f.name,f.contentType);require(actual.bytes===f.bytes&&actual.sha256===f.sha256&&Array.isArray(f.parts));for(const p of f.parts){require(typeof p.name==='string');baseParts.add(p.name);}}
  require(Array.isArray(physical));const subset=physical.filter(p=>p!==null&&typeof p==='object'&&'name'in p&&baseParts.has(p.name));
  const source=verifyBusinessSourceJournalBundle(base.content,subset,b).forJournalBundleVerification();require(source.observedAt===root.observedAt);
  const capture=read('catalog_capture.json'),catalogManifest=read('service_catalog_manifest.json');require(sha(capture.content)===root.catalogCaptureSha256&&sha(catalogManifest.content)===root.catalogManifestSha256);
  const catalog=readServiceCatalogCapture(capture.content,{businessId:b.businessId,generationId:b.generationId,observedAt:source.observedAt});
  const catalogFiles=[read('services.csv','text/csv; charset=utf-8'),read('service_versions.csv','text/csv; charset=utf-8'),read('service_catalog_escape_map.json'),read('service_catalog_dictionary.json')];
  const decoded=verifyServiceCatalogCsv(catalogManifest.content,catalogFiles,{businessId:b.businessId,snapshotToken:catalog.snapshotToken});
  require(historyJsonEqual(decoded.services,catalog.services)&&historyJsonEqual(decoded.versions,catalog.versions)&&used.size===files.size);
  const originalSource=JSON.parse(files.get('source_journal_manifest.json')!.content) as {metadataBytes:number;evidenceBytes:number};
  require(root.sourceRecordCount===source.recordCount&&root.catalogRecordCount===catalog.recordCount&&root.recordCount===source.recordCount+catalog.recordCount&&Number.isSafeInteger(root.recordCount)&&(root.recordCount as number)<=10000&&root.metadataBytes===originalSource.metadataBytes+catalog.metadataBytes&&(root.metadataBytes as number)<=8388608&&root.evidenceBytes===originalSource.evidenceBytes+Buffer.byteLength(capture.content)&&(root.evidenceBytes as number)<=33554432);
  const value=Object.freeze({...b,registeredSourceSchemaVersion:43 as const,catalogRegistered:false as const,observedAt:source.observedAt,sourceRows:source.sourceRows,journalRows:source.journalRows,catalogRows:decoded,originals:Object.freeze({...source.originals,catalog:capture.content}),recordCount:root.recordCount,assurance:'included_source_consistency_only' as const,snapshotProven:false as const,referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  return Object.freeze({forCatalogBundleVerification:()=>value,toJSON():never{throw new BusinessSourceCatalogVerificationError();}});
 }catch{throw new BusinessSourceCatalogVerificationError();}
}
