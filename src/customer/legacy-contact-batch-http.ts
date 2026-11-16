import 'server-only';
import {parseLegacyApplicationPage,parseLegacyIdentityReference} from './legacy-contact-application-contract.ts';
import {parseLegacyApprovalReference,parseLegacyApprovalRequest} from './legacy-contact-approval-contract.ts';
import {PrivateHttpError,privateJsonResponse,readFlatJsonBody,readNestedJsonBody,readPrivateBytes} from '../security/private-http.ts';
import {CustomerDataError,customerUuid,requireCustomer as check} from './customer-contract.ts';
import {inspectLegacyContactFile,LegacyContactImportError,legacyContactFields,maximumLegacyCsvBytes} from './legacy-contact-import-preview.ts';
import type {LegacyContactColumnMap} from './legacy-contact-import-preview.ts';
import {legacyAfterRow,legacyBatchMetadataLimit,parseLegacyBatchHeader,parseLegacyTargetRequest} from './legacy-contact-batch-contract.ts';
import {parseLegacyDecisionReference,parseLegacyDecisionSave} from './legacy-contact-decision-contract.ts';
import type {LegacyBatchRoute} from './legacy-contact-batch-contract.ts';
import {prepareLegacyContactBatch} from './legacy-contact-batch-stage.ts';
import type {createCustomerDirectory} from './customer-directory.ts';

const headerKeys=['batchId','operationId','recoveryEpoch','sourceLabel','sourceSha256','columns'];
const businessDenied=()=>privateJsonResponse({error:'LEGACY_BATCH_UNAVAILABLE'},503);

export async function legacyContactBatchResponse(route:LegacyBatchRoute,request:Request,cookie:string,businessId:string,
 directory:ReturnType<typeof createCustomerDirectory>,signal:AbortSignal,backgroundApply:boolean){
 let submitted=false;
 try{
  if(route==='legacy-batches/stage'){
   if(request.headers.get('content-type')!=='application/octet-stream')return privateJsonResponse({error:'LEGACY_BATCH_INVALID'},400);
   const bytes=await readPrivateBytes(request,signal,maximumLegacyCsvBytes+legacyBatchMetadataLimit+1);
   const boundary=bytes.subarray(0,legacyBatchMetadataLimit+1).indexOf(10);
   check(boundary>0&&bytes.byteLength>boundary+1);
   const metadataRequest=new Request(request.url,{method:'POST',body:bytes.slice(0,boundary),
    headers:{'Content-Type':'application/json'},signal});
   const header=parseLegacyBatchHeader(await readNestedJsonBody(metadataRequest,headerKeys,legacyBatchMetadataLimit));
   const file=bytes.subarray(boundary+1),{headers}=inspectLegacyContactFile(file);
   const mapping=Object.fromEntries(Object.entries(header.columns).map(([field,index])=>{
    check((legacyContactFields as readonly string[]).includes(field)&&index<headers.length);
    return [field,headers[index]];
   })) as LegacyContactColumnMap;
   const draft=await prepareLegacyContactBatch(file,mapping,businessId,header.sourceLabel);
   check(draft.originalSha256===header.sourceSha256);
   signal.throwIfAborted();submitted=true;
   const result=(await directory.stageLegacyBatch(cookie,businessId,header,draft,signal)).forServer();
   return privateJsonResponse(result,result.state==='conflict'?409:200);
  }
  if(route==='legacy-batches/list'){
   const input=await readFlatJsonBody(request,['beforeBatch']);
   check(input.beforeBatch===null||customerUuid(input.beforeBatch));
   return privateJsonResponse((await directory.listLegacyBatches(cookie,businessId,input.beforeBatch,signal)).forServer());
  }
  if(route==='legacy-batches/effects'){
   const input=await readFlatJsonBody(request,['batchId','afterRow']);
   check(customerUuid(input.batchId)&&legacyAfterRow(input.afterRow));
   return privateJsonResponse((await directory.reviewLegacyBatch(cookie,businessId,input.batchId,input.afterRow,signal)).forServer());
  }
  if(route==='legacy-batches/targets'){
   const input=parseLegacyTargetRequest(await readFlatJsonBody(request,['batchId','row','kind','afterTarget']));
   return privateJsonResponse((await directory.legacyImportTargets(cookie,businessId,input,signal)).forServer());
  }
  if(route==='legacy-batches/read-decision'){
   const input=parseLegacyDecisionReference(await readFlatJsonBody(request,['batchId','row']));
   return privateJsonResponse((await directory.readLegacyDecision(cookie,businessId,input,signal)).forServer());
  }
  if(route==='legacy-batches/save-decision'){
   const input=parseLegacyDecisionSave(await readFlatJsonBody(request,['batchId','row','sourceNamespace','fingerprint','expectedRevision',
    'operationId','recoveryEpoch','customerAction','customerId','customerVersion','vehicleAction','vehicleId','vehicleVersion']));
   submitted=true;
   const result=(await directory.saveLegacyDecision(cookie,businessId,input,signal)).forServer();
   return privateJsonResponse(result,result.state==='conflict'?409:200);
  }
  if(route==='legacy-batches/review-approval'){
   const input=parseLegacyApprovalReference(await readFlatJsonBody(request,['batchId']));
   return privateJsonResponse((await directory.reviewLegacyApproval(cookie,businessId,input,signal)).forServer());
  }
  if(route==='legacy-batches/identity'){
   const input=parseLegacyIdentityReference(await readFlatJsonBody(request,['batchId','row','sourceNamespace','kind']));
   return privateJsonResponse((await directory.legacyContactIdentity(cookie,businessId,input,signal)).forServer());
  }
  if(route==='legacy-batches/application'){
   const input=parseLegacyApplicationPage(await readFlatJsonBody(request,['batchId','afterRow']));
   return privateJsonResponse((await directory.readLegacyApplication(cookie,businessId,input,signal)).forServer());
  }
  if(route==='legacy-batches/apply-status'){
   const {batchId}=parseLegacyApprovalReference(await readFlatJsonBody(request,['batchId']));
   return privateJsonResponse((await directory.readLegacyApplyRequest(cookie,businessId,batchId,signal)).forServer());
  }
  if(route==='legacy-batches/approve'||route==='legacy-batches/apply'){
   const input=parseLegacyApprovalRequest(await readFlatJsonBody(request,['batchId','evidenceSha256','operationId','recoveryEpoch']));
   signal.throwIfAborted();submitted=true;
   if(route==='legacy-batches/apply'&&backgroundApply){
    const result=(await directory.requestLegacyApplication(cookie,businessId,input,signal)).forServer();
    return privateJsonResponse(result,result.state==='conflict'?409:result.state==='queued'?202:200);
   }
   const saved=route==='legacy-batches/approve'?await directory.approveLegacyBatch(cookie,businessId,input,signal):
    await directory.applyLegacyBatch(cookie,businessId,input,signal);
   const result=saved.forServer();
   return privateJsonResponse(result,result.state==='conflict'?409:200);
  }
  const input=await readFlatJsonBody(request,['batchId','afterRow']);
  check(customerUuid(input.batchId)&&legacyAfterRow(input.afterRow));
  return privateJsonResponse((await directory.readLegacyBatch(cookie,businessId,input.batchId,input.afterRow,signal)).forServer());
 }catch(error){
  if(submitted){
   const code=route==='legacy-batches/apply'?'LEGACY_APPLICATION_UNKNOWN':route==='legacy-batches/approve'?'LEGACY_APPROVAL_UNKNOWN':
    route==='legacy-batches/save-decision'?'LEGACY_DECISION_SAVE_UNKNOWN':'LEGACY_BATCH_SAVE_UNKNOWN';
   return privateJsonResponse({error:code},503);
  }
  if(error instanceof LegacyContactImportError||error instanceof CustomerDataError||error instanceof PrivateHttpError)
   return privateJsonResponse({error:'LEGACY_BATCH_INVALID'},400);
  return businessDenied();
 }
}
