import 'server-only';
import {currentBusinessBindingMatches} from './current-business-source-inventory.ts';
import {createHash} from 'node:crypto';
import {formatCurrentBusinessCsv} from './current-business-source-csv.ts';
import {formatCurrentBusinessWorkbook} from './current-business-source-workbook.ts';
import {formatCurrentBusinessReimport,currentBusinessReimportReadme} from './current-business-source-reimport.ts';
import {formatCurrentIdentitySource} from './current-business-identity-source.ts';
import type {CurrentBusinessIdentitySource} from './current-business-identity-source.ts';
import {formatCurrentSessionSource} from './current-business-session-source.ts';
import type {CurrentBusinessSessionSource} from './current-business-session-source.ts';
import {formatCurrentProviderSource} from './current-business-provider-source.ts';
import type {CurrentBusinessProviderSource} from './current-business-provider-source.ts';
import {formatCurrentAttachmentInventory} from './current-attachment-inventory.ts';
import {createExportOriginalIndex} from './source-export-original-index.ts';
import type {CurrentBusinessRows,CurrentBusinessSourceBinding} from './current-business-source.ts';
export function formatCurrentBusinessPortableSource(capture:CurrentBusinessRows,binding:CurrentBusinessSourceBinding,identity?:CurrentBusinessIdentitySource,sessions?:CurrentBusinessSessionSource,provider?:CurrentBusinessProviderSource){
 if(!binding||Object.keys(binding).sort().join(',')!=='appReleaseId,sourceSchemaVersion'||typeof binding.appReleaseId!=='string'||!/^[a-f0-9]{40}$/.test(binding.appReleaseId)||!currentBusinessBindingMatches(capture.profile,binding.sourceSchemaVersion))throw Error('CURRENT_BUSINESS_PORTABLE_SOURCE_BINDING_REQUIRED');
 const csv=formatCurrentBusinessCsv(capture),workbook=formatCurrentBusinessWorkbook(capture,binding),identityBundle=identity?formatCurrentIdentitySource(identity,capture):undefined;
 if((sessions||provider)&&!identityBundle)throw Error('CURRENT_BUSINESS_PORTABLE_SOURCE_BINDING_REQUIRED');
 const sessionBundle=sessions?formatCurrentSessionSource(sessions,identityBundle!.identity,capture):undefined;
 const providerBundle=provider?formatCurrentProviderSource(provider,identityBundle!.identity,capture):undefined;
 const attachmentBundle=formatCurrentAttachmentInventory(capture);
 const files=Object.freeze({...csv.files,...identityBundle?.files,...sessionBundle?.files,...providerBundle?.files,...attachmentBundle.files,'current_business_csv_manifest.json':Buffer.from(csv.manifest),'business_records.xlsx':workbook.bytes,
  'business_records_reimport.txt':formatCurrentBusinessReimport(capture,binding,identityBundle?.identity,sessionBundle?.session,providerBundle?.provider),'business_records_reimport_readme.txt':Buffer.from(currentBusinessReimportReadme),
  'workbook_coverage.json':Buffer.from(JSON.stringify({schemaVersion:1,sheets:workbook.sheets,sidecarReferences:workbook.sidecarReferences,values:'Exact text; empty cells are null; explicit empty strings retained. Large values are in the named CSV cells.',completePortableExport:false,completeBackup:false})+'\n')});
 const descriptors=Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}));
 const manifest=JSON.stringify({schemaVersion:1,profile:'crest.current-business-portable-source.v1',...binding,businessId:capture.businessId,snapshotToken:capture.snapshotToken,observedAt:capture.observedAt,recordCount:capture.recordCount,
  scope:'Business-scoped required columns and the listed identity/session/provider components use one read-only transaction when captured together. Other instance runtime-security sources and original private bytes remain separate.',
  identitySources:identityBundle?.identity.sources.map(source=>source.source)??[],identityRecordCount:identityBundle?.identity.recordCount??0,
  sessionSource:sessionBundle?.session.source.source??null,sessionRecordCount:sessionBundle?.session.recordCount??0,
  providerSources:providerBundle?.provider.sources.map(source=>source.source)??[],providerRecordCount:providerBundle?.provider.recordCount??0,
  attachments:{inventory:'attachment_inventory.json',available:attachmentBundle.inventory.availableCount,pending:attachmentBundle.inventory.pendingCount,originalBytesIncluded:false,originalFilenamesRetained:false},
  completePortableExport:false,completeBackup:false,files:descriptors})+'\n';
 if(descriptors.reduce((total,file)=>total+file.bytes,Buffer.byteLength(manifest))>67108864)throw Error('CURRENT_BUSINESS_PORTABLE_SOURCE_LIMIT');
 return Object.freeze({manifest,files,originalIndex:createExportOriginalIndex(attachmentBundle.inventory,attachmentBundle.files['attachment_inventory.json'])});
}
