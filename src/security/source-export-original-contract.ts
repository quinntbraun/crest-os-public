import {customerUuid as uuid,customerInstant as instant} from '../customer/customer-contract.ts';
import {downloadObject,parseSourceExportDownloadHeader} from './source-export-download-contract.ts';
export const exportOriginalFilePath='/api/business/exports/original-file';
export const exportOriginalKinds=Object.freeze(['expense_receipt','supplier_document','condition_photo'] as const);
export type ExportOriginalKind=typeof exportOriginalKinds[number];
const extensions:Readonly<Record<string,string>>={'image/jpeg':'jpg','image/png':'png','image/heic':'heic','application/pdf':'pdf'};
function require(value:unknown):asserts value{if(!value)throw Error('SOURCE_EXPORT_ORIGINAL_REVIEW_REQUIRED');}
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value)&&instant(value);
export function parseExportOriginalRequest(input:unknown){
 const r=downloadObject(input,['exportJobId','generationId','kind','attachmentId']);require(uuid(r.exportJobId)&&uuid(r.generationId)&&uuid(r.attachmentId)&&exportOriginalKinds.includes(r.kind as ExportOriginalKind));
 return Object.freeze({exportJobId:r.exportJobId,generationId:r.generationId,kind:r.kind as ExportOriginalKind,attachmentId:r.attachmentId});
}
export type ExportOriginalRequest=ReturnType<typeof parseExportOriginalRequest>;
export function parseExportOriginalFile(input:unknown,request:Pick<ExportOriginalRequest,'kind'|'attachmentId'>){
 const f=downloadObject(input,['kind','attachmentId','objectId','path','mediaType','byteSize','sha256','recordedAt']);
 require(f.kind===request.kind&&f.attachmentId===request.attachmentId&&uuid(f.objectId)&&typeof f.mediaType==='string'&&Object.hasOwn(extensions,f.mediaType)&&f.path===`attachments/${f.attachmentId}/${f.objectId}.${extensions[f.mediaType]}`&&typeof f.byteSize==='number'&&Number.isSafeInteger(f.byteSize)&&f.byteSize>=1&&f.byteSize<=26214400&&typeof f.sha256==='string'&&/^[a-f0-9]{64}$/.test(f.sha256)&&stamp(f.recordedAt));
 require(request.kind==='condition_photo'?f.mediaType!=='application/pdf':f.objectId===request.attachmentId);
 return Object.freeze({kind:request.kind,attachmentId:request.attachmentId,objectId:f.objectId,path:f.path as string,mediaType:f.mediaType,byteSize:f.byteSize,sha256:f.sha256,recordedAt:f.recordedAt});
}
// Source consistency only. Trusted server composition must obtain this value
// from fresh SQL authority; parsing an arbitrary JSON value grants no access.
export function parseExportOriginalPermit(input:unknown,businessId:string,actorId:string,expected:unknown){
 const request=parseExportOriginalRequest(expected),p=downloadObject(input,['profile','header','authority','indexSha256','file','object']),header=parseSourceExportDownloadHeader(p.header,businessId,request.exportJobId,request.generationId),a=downloadObject(p.authority,['currentActorId','originalActorId','recoveryEpoch','planSha256']),object=downloadObject(p.object,['domain','key']),f=parseExportOriginalFile(p.file,request);
 require(p.profile==='crest.source-export-original-permit.v1'&&header.profile==='crest.current-business-source-bundle.v1'&&(header.sourceSchemaVersion===136||header.sourceSchemaVersion===137||header.sourceSchemaVersion===138||header.sourceSchemaVersion===140)&&typeof p.indexSha256==='string'&&/^[a-f0-9]{64}$/.test(p.indexSha256)&&uuid(actorId)&&a.currentActorId===actorId&&uuid(a.originalActorId)&&uuid(a.recoveryEpoch)&&typeof a.planSha256==='string'&&/^[a-f0-9]{64}$/.test(a.planSha256)&&object.domain===request.kind&&object.key===`originals/${businessId}/${f.objectId}`&&Date.parse(header.completedAt)<=Date.now()&&Date.parse(header.expiresAt)>Date.now());
 return Object.freeze({profile:'crest.source-export-original-permit.v1' as const,header,authority:Object.freeze({currentActorId:actorId,originalActorId:a.originalActorId,recoveryEpoch:a.recoveryEpoch,planSha256:a.planSha256}),indexSha256:p.indexSha256,file:f,object:Object.freeze({domain:request.kind,key:object.key as string})});
}
export type ExportOriginalPermit=ReturnType<typeof parseExportOriginalPermit>;
export function exportOriginalAuditScope(p:ExportOriginalPermit){return Object.freeze({profile:'crest.source-export-original-scope.v1',header:p.header,indexSha256:p.indexSha256,file:p.file,currentActorId:p.authority.currentActorId,recoveryEpoch:p.authority.recoveryEpoch});}
export function parseExportOriginalAudit(input:unknown,p:ExportOriginalPermit){
 const r=downloadObject(input,['schemaVersion','state','operationId','auditEventId','recordedAt','scope']),s=downloadObject(r.scope,['profile','header','indexSha256','file','currentActorId','recoveryEpoch']),header=parseSourceExportDownloadHeader(s.header,p.header.businessId,p.header.exportJobId,p.header.generationId),f=parseExportOriginalFile(s.file,{kind:p.file.kind,attachmentId:p.file.attachmentId}),normalized={profile:s.profile,header,indexSha256:s.indexSha256,file:f,currentActorId:s.currentActorId,recoveryEpoch:s.recoveryEpoch};
 require(r.schemaVersion===1&&r.state==='authorized_handoff'&&uuid(r.operationId)&&uuid(r.auditEventId)&&stamp(r.recordedAt)&&Date.parse(r.recordedAt)>=Date.parse(p.header.completedAt)&&Date.parse(r.recordedAt)<=Date.now()&&Date.parse(r.recordedAt)<Date.parse(p.header.expiresAt)&&JSON.stringify(normalized)===JSON.stringify(exportOriginalAuditScope(p)));
 return Object.freeze({schemaVersion:1 as const,state:'authorized_handoff' as const,operationId:r.operationId,auditEventId:r.auditEventId,recordedAt:r.recordedAt,scope:exportOriginalAuditScope(p)});
}
