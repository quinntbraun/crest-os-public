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
