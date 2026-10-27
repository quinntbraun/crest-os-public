import 'server-only';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {parseExportPartBinding} from './export-part-crypto.ts';
import {parseExportPartIntent} from '../files/export-part-store.ts';
import {downloadObject,parseSourceExportDownloadPartRequest,parseSourceExportDownloadHeader,parseSourceExportDownloadFile,SourceExportDownloadError} from './source-export-download-contract.ts';
// Data evidence only. Each use must reacquire current authority; a copied
// permit, previous page or original Ready receipt never authorizes bytes.
export function parseSourceExportDownloadPermit(input:unknown,businessId:string,currentActorId:string,expected:unknown){
 try{
  const request=parseSourceExportDownloadPartRequest(expected),v=downloadObject(input,['header','authority','file','intent']),header=parseSourceExportDownloadHeader(v.header,businessId,request.exportJobId,request.generationId),a=downloadObject(v.authority,['currentActorId','originalActorId','recoveryEpoch','planSha256']),file=parseSourceExportDownloadFile(v.file);
  if(a.currentActorId!==currentActorId||!uuid(currentActorId)||!uuid(a.originalActorId)||!uuid(a.recoveryEpoch)||typeof a.planSha256!=='string'||!/^[a-f0-9]{64}$/.test(a.planSha256)||file.partId!==request.partId||file.ordinal>header.fileCount||file.bytes>header.totalBytes)throw Error();
  const binding=parseExportPartBinding({businessId,actorId:a.originalActorId,exportJobId:header.exportJobId,generationId:header.generationId,recoveryEpoch:a.recoveryEpoch,partId:file.partId,fileName:file.fileName,contentType:file.contentType}),intent=parseExportPartIntent(downloadObject(v.intent,['formatVersion','objectKey','keyId','plaintextBytes','plaintextSha256','ciphertextBytes','ciphertextSha256']),binding);
  if(intent.plaintextBytes!==file.bytes||intent.plaintextSha256!==file.sha256||Date.parse(header.expiresAt)<=Date.now()||Date.parse(header.completedAt)>Date.now())throw Error();
  return Object.freeze({header,currentActorId,originalActorId:a.originalActorId as string,recoveryEpoch:a.recoveryEpoch as string,planSha256:a.planSha256,file,binding,intent});
 }catch{throw new SourceExportDownloadError();}
}

export function sourceExportDownloadPermitRecord(p:ReturnType<typeof parseSourceExportDownloadPermit>){
 return {header:p.header,authority:{currentActorId:p.currentActorId,originalActorId:p.originalActorId,recoveryEpoch:p.recoveryEpoch,planSha256:p.planSha256},file:p.file,intent:p.intent};
}
export function parseSourceExportDownloadHandoff(input:unknown,businessId:string,currentActorId:string,expected:unknown){
 const p=downloadObject(input,['header','currentActorId','originalActorId','recoveryEpoch','planSha256','file','binding','intent']);
 const value=parseSourceExportDownloadPermit({header:p.header,authority:{currentActorId:p.currentActorId,originalActorId:p.originalActorId,recoveryEpoch:p.recoveryEpoch,planSha256:p.planSha256},file:p.file,intent:p.intent},businessId,currentActorId,expected);
 const binding=downloadObject(p.binding,['businessId','actorId','exportJobId','generationId','recoveryEpoch','partId','fileName','contentType']);
 if(JSON.stringify(parseExportPartBinding(binding))!==JSON.stringify(value.binding))throw new SourceExportDownloadError();return value;
}
export function sourceExportDownloadAccessScope(p:ReturnType<typeof parseSourceExportDownloadPermit>){return Object.freeze({header:p.header,file:p.file,currentActorId:p.currentActorId,recoveryEpoch:p.recoveryEpoch});}
export function parseSourceExportDownloadAccessReceipt(input:unknown,p:ReturnType<typeof parseSourceExportDownloadPermit>){
 const r=downloadObject(input,['schemaVersion','state','operationId','auditEventId','recordedAt','scope']),s=downloadObject(r.scope,['header','file','currentActorId','recoveryEpoch']);
 const header=parseSourceExportDownloadHeader(s.header,p.header.businessId,p.header.exportJobId,p.header.generationId),file=parseSourceExportDownloadFile(s.file),scope={header,file,currentActorId:s.currentActorId,recoveryEpoch:s.recoveryEpoch};
 if(r.schemaVersion!==1||r.state!=='authorized_handoff'||!uuid(r.operationId)||!uuid(r.auditEventId)||typeof r.recordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(r.recordedAt)||!Number.isFinite(Date.parse(r.recordedAt))||Date.parse(r.recordedAt)>Date.now()||Date.parse(r.recordedAt)<Date.parse(header.completedAt)||Date.parse(r.recordedAt)>=Date.parse(header.expiresAt)||JSON.stringify(scope)!==JSON.stringify(sourceExportDownloadAccessScope(p)))throw new SourceExportDownloadError();
 return Object.freeze({schemaVersion:1 as const,state:'authorized_handoff' as const,operationId:r.operationId as string,auditEventId:r.auditEventId as string,recordedAt:r.recordedAt,scope:Object.freeze(scope)});
}
