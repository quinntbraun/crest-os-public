import 'server-only';
import {createHash} from 'node:crypto';
import {formatCurrentBusinessCsv} from './current-business-source-csv.ts';
import {formatCurrentBusinessWorkbook} from './current-business-source-workbook.ts';
import type {CurrentBusinessRows,CurrentBusinessSourceBinding} from './current-business-source.ts';
export function formatCurrentBusinessPortableSource(capture:CurrentBusinessRows,binding:CurrentBusinessSourceBinding){
 if(!binding||Object.keys(binding).sort().join(',')!=='appReleaseId,sourceSchemaVersion'||typeof binding.appReleaseId!=='string'||!/^[a-f0-9]{40}$/.test(binding.appReleaseId)||![133,134].includes(binding.sourceSchemaVersion))throw Error('CURRENT_BUSINESS_PORTABLE_SOURCE_BINDING_REQUIRED');
 const csv=formatCurrentBusinessCsv(capture),workbook=formatCurrentBusinessWorkbook(capture,binding);
 const files=Object.freeze({...csv.files,'current_business_csv_manifest.json':Buffer.from(csv.manifest),'business_records.xlsx':workbook.bytes,
  'workbook_coverage.json':Buffer.from(JSON.stringify({schemaVersion:1,sheets:workbook.sheets,sidecarReferences:workbook.sidecarReferences,values:'Exact text; empty cells are null; explicit empty strings retained. Large values are in the named CSV cells.',completePortableExport:false,completeBackup:false})+'\n')});
 const descriptors=Object.entries(files).map(([name,bytes])=>({name,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}));
 const manifest=JSON.stringify({schemaVersion:1,profile:'crest.current-business-portable-source.v1',...binding,businessId:capture.businessId,snapshotToken:capture.snapshotToken,observedAt:capture.observedAt,recordCount:capture.recordCount,
  scope:'Business-scoped required columns; all CSV and workbook source cells share one capture. Actor/global/security sources, original private bytes and owner delivery remain separate components.',
  completePortableExport:false,completeBackup:false,files:descriptors})+'\n';
 if(descriptors.reduce((total,file)=>total+file.bytes,Buffer.byteLength(manifest))>67108864)throw Error('CURRENT_BUSINESS_PORTABLE_SOURCE_LIMIT');
 return Object.freeze({manifest,files});
}
