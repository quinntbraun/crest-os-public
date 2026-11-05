import {customerUuid as uuid,customerInstant as instant} from '../customer/customer-contract.ts';
export class SourceExportDownloadError extends Error{constructor(){super('SOURCE_EXPORT_DOWNLOAD_REVIEW_REQUIRED');this.name='SourceExportDownloadError';}}
function require(v:unknown):asserts v{if(!v)throw new SourceExportDownloadError();}
export function downloadObject(input:unknown,keys:readonly string[]){
 require(input!==null&&typeof input==='object'&&!Array.isArray(input)&&(Object.getPrototypeOf(input)===Object.prototype||Object.getPrototypeOf(input)===null));const d=Object.getOwnPropertyDescriptors(input);require(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&d[k]!.enumerable&&Object.hasOwn(d[k]!,'value')));return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const stamp=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(v)&&instant(v);
export function parseSourceExportDownloadPageRequest(input:unknown){const v=downloadObject(input,['exportJobId','generationId','afterOrdinal']);require(uuid(v.exportJobId)&&(v.generationId===null||uuid(v.generationId))&&integer(v.afterOrdinal,0,1023)&&(v.generationId!==null||v.afterOrdinal===0));return Object.freeze({exportJobId:v.exportJobId as string,generationId:v.generationId as string|null,afterOrdinal:v.afterOrdinal});}
export function parseSourceExportDownloadPartRequest(input:unknown){const v=downloadObject(input,['exportJobId','generationId','partId']);require(uuid(v.exportJobId)&&uuid(v.generationId)&&uuid(v.partId));return Object.freeze({exportJobId:v.exportJobId as string,generationId:v.generationId as string,partId:v.partId as string});}
export const downloadHeaderKeys=Object.freeze(['schemaVersion','businessId','exportJobId','generationId','profile','appReleaseId','sourceSchemaVersion','completedAt','expiresAt','fileCount','totalBytes','manifestSha256'] as const);
export function parseSourceExportDownloadHeader(input:unknown,businessId:string,exportJobId:string,generationId:string|null){
 const v=downloadObject(input,downloadHeaderKeys);require(v.schemaVersion===1&&uuid(businessId)&&v.businessId===businessId&&uuid(exportJobId)&&v.exportJobId===exportJobId&&uuid(v.generationId)&&(generationId===null||v.generationId===generationId));
 require(v.profile==='crest.business-source-journal-bundle.v1'&&v.sourceSchemaVersion===43&&typeof v.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(v.appReleaseId)&&hash(v.manifestSha256)&&integer(v.fileCount,2,1024)&&integer(v.totalBytes,v.fileCount,67108864));
 require(stamp(v.completedAt)&&stamp(v.expiresAt)&&Date.parse(v.expiresAt)-Date.parse(v.completedAt)===604800000&&v.completedAt.slice(19)===v.expiresAt.slice(19));
 return Object.freeze({schemaVersion:1 as const,businessId,exportJobId,generationId:v.generationId as string,profile:'crest.business-source-journal-bundle.v1' as const,appReleaseId:v.appReleaseId,sourceSchemaVersion:43 as const,completedAt:v.completedAt,expiresAt:v.expiresAt,fileCount:v.fileCount,totalBytes:v.totalBytes,manifestSha256:v.manifestSha256});
}
export function parseSourceExportDownloadFile(input:unknown){
 const v=downloadObject(input,['ordinal','partId','fileName','contentType','bytes','sha256']);require(integer(v.ordinal,1,1024)&&uuid(v.partId)&&typeof v.fileName==='string'&&/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/.test(v.fileName)&&integer(v.bytes,1,8388608)&&hash(v.sha256));
 require(v.contentType===(v.fileName.endsWith('.csv')?'text/csv; charset=utf-8':v.fileName.endsWith('.json')?'application/json':'text/plain; charset=utf-8'));
 return Object.freeze({ordinal:v.ordinal,partId:v.partId as string,fileName:v.fileName,contentType:v.contentType as 'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8',bytes:v.bytes,sha256:v.sha256});
}
export function parseSourceExportDownloadCatalogue(input:unknown,businessId:string,expected:unknown){
 const request=parseSourceExportDownloadPageRequest(expected),v=downloadObject(input,[...downloadHeaderKeys,'files','nextOrdinal']),header=parseSourceExportDownloadHeader(Object.fromEntries(downloadHeaderKeys.map(k=>[k,v[k]])),businessId,request.exportJobId,request.generationId);
 require(request.afterOrdinal<header.fileCount&&Array.isArray(v.files)&&v.files.length===Math.min(5,header.fileCount-request.afterOrdinal));
 const d=Object.getOwnPropertyDescriptors(v.files),count=v.files.length;require(Reflect.ownKeys(d).length===count+1);
 const names=new Set<string>(),ids=new Set<string>(),files=Array.from({length:count},(_,i)=>{const field=d[String(i)];require(field?.enumerable&&Object.hasOwn(field,'value'));const file=parseSourceExportDownloadFile(field.value);require(file.ordinal===request.afterOrdinal+i+1&&!names.has(file.fileName)&&!ids.has(file.partId)&&file.bytes<=header.totalBytes);names.add(file.fileName);ids.add(file.partId);return file;});
 require(files.reduce((n,f)=>n+f.bytes,0)<=header.totalBytes);const end=request.afterOrdinal+files.length;require(v.nextOrdinal===(end<header.fileCount?end:null));
 return Object.freeze({...header,files:Object.freeze(files),nextOrdinal:v.nextOrdinal as number|null});
}
