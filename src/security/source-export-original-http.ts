import 'server-only';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {createRequestProtection} from './request-protection.ts';
import {readBrowserCookies} from './browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from './private-http.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createSourceExportOwnerAccess} from './source-export-owner-access.ts';
import {parseExportOriginalRequest,exportOriginalFilePath} from './source-export-original-contract.ts';
import {createExportOriginalReader} from './source-export-original-reader.ts';
import type {ExportOriginalStores} from './source-export-original-reader.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import {receiptDownloadHandoff} from '../bookkeeping/expenses/receipt-download-response.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export const sourceExportOriginalPath=exportOriginalFilePath;
const keys=Object.freeze(['exportJobId','generationId','kind','attachmentId']);
export function sourceExportOriginalFailure(status=503){const response=privateJsonResponse({error:status===503?'SOURCE_EXPORT_ORIGINAL_UNAVAILABLE':'SOURCE_EXPORT_ORIGINAL_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
// Store selection comes from trusted runtime composition. Browser requests
// contain an attachment reference, never an object key, filename or business.
export function createSourceExportOriginalHttp(config:Configuration,provider:Parameters<typeof createSourceExportOwnerAccess>[1],tokens:Parameters<typeof createSourceExportOwnerAccess>[2],stores:ExportOriginalStores){
 if(!uuid(config.businessId))throw Error('SOURCE_EXPORT_ORIGINAL_CONFIGURATION_REQUIRED');
 const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),access=createSourceExportOwnerAccess(config,provider,tokens,config.businessId);
 const reader=createExportOriginalReader(config.businessId,{
  read:async(credential,request,signal)=>(await access.readOriginal(credential,request,signal)).forServer(),
  record:async(credential,request,permit,signal)=>(await access.recordOriginalAccess(credential,request,permit,signal)).forServer(),
 },stores);
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let started=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(95000)]);if(signal.aborted)throw Error();resolve(request,peer);const url=new URL(request.url);
   if(url.pathname!==sourceExportOriginalPath||url.search||url.hash)return sourceExportOriginalFailure(404);if(request.method!=='POST')return sourceExportOriginalFailure(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const input=parseExportOriginalRequest(await readFlatJsonBody(bounded,keys,16384));await csrf(bounded,cookie,signal);started=true;
   if(!await admit(cookie,'ordinary',signal)){const response=sourceExportOriginalFailure(429);response.headers.set('Retry-After','60');return response;}
   let send:(response:Response)=>void=()=>{},supplied=false;const ready=new Promise<Response>(resolve=>{send=resolve;});
   void reader.deliver(cookie,input,signal,async value=>{
    const extension=value.file.path.slice(value.file.path.lastIndexOf('.')+1),transfer=receiptDownloadHandoff(value.bytes,{name:`receipt-${value.file.attachmentId}.${extension}`,type:value.file.mediaType,byteSize:value.file.byteSize,sha256:value.file.sha256});
    supplied=true;send(transfer.response);await transfer.completion;
   }).catch(()=>{if(!supplied)send(sourceExportOriginalFailure());});
   return await ready;
  }catch{return sourceExportOriginalFailure(started?503:400);}
 };
}
