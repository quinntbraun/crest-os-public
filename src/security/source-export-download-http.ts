import 'server-only';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {createRequestProtection} from './request-protection.ts';
import {readBrowserCookies} from './browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from './private-http.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createSourceExportOwnerAccess} from './source-export-owner-access.ts';
import {createSourceExportDownloadReader} from './source-export-download-reader.ts';
import {sourceExportDownloadResponse} from '../server/source-export-download-response.ts';
import {parseSourceExportDownloadPageRequest,parseSourceExportDownloadPartRequest} from './source-export-download-contract.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';
import type {createEncryptedExportPartStore} from '../files/export-part-store.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const cataloguePath='/api/business/exports/downloads',filePath='/api/business/exports/file';
const pageKeys=Object.freeze(['exportJobId','generationId','afterOrdinal']),partKeys=Object.freeze(['exportJobId','generationId','partId']);
function failure(status=503){const response=privateJsonResponse({error:status===503?'SOURCE_EXPORT_DOWNLOAD_UNAVAILABLE':'SOURCE_EXPORT_DOWNLOAD_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
export function sourceExportDownloadFailureResponse(status=503){return failure(status);}
// Trusted composition only, closed by default. A real one-attempt private store
// is supplied explicitly by the server; no environment activation switch.
export function createSourceExportDownloadHttp(config:Configuration,provider:Parameters<typeof createSourceExportOwnerAccess>[1],tokens:Parameters<typeof createSourceExportOwnerAccess>[2],store:Pick<Awaited<ReturnType<typeof createEncryptedExportPartStore>>,'readVerified'>|undefined,enabled=false){
 if(!uuid(config.businessId)||typeof enabled!=='boolean'||enabled&&typeof store?.readVerified!=='function')throw Error('SOURCE_EXPORT_DOWNLOAD_HTTP_CONFIGURATION_REQUIRED');
 const scope=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),access=enabled?createSourceExportOwnerAccess(config,provider,tokens,scope):undefined,reader=access?createSourceExportDownloadReader(scope,access,store!):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let started=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(60000)]);if(signal.aborted)throw Error();resolve(request,peer);const url=new URL(request.url);
   if(!enabled||url.search||url.hash||![cataloguePath,filePath].includes(url.pathname))return failure(404);if(request.method!=='POST')return failure(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const file=url.pathname===filePath,input=await readFlatJsonBody(bounded,file?partKeys:pageKeys,16384),page=file?undefined:parseSourceExportDownloadPageRequest(input),part=file?parseSourceExportDownloadPartRequest(input):undefined;
   await csrf(bounded,cookie,signal);started=true;
   if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'SOURCE_EXPORT_DOWNLOAD_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
   if(signal.aborted)throw Error();
   if(page){const value=(await access!.downloadCatalogue(cookie,page,signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value);}
   let send:(response:Response)=>void=()=>{},supplied=false;const ready=new Promise<Response>(resolve=>{send=resolve;});
   void reader!.deliver(cookie,part,signal,async(value,deliverySignal)=>{const transfer=sourceExportDownloadResponse(value,deliverySignal);supplied=true;send(transfer.response);await transfer.completion;}).catch(()=>{if(!supplied)send(failure());});
   return await ready;
  }catch{return failure(started?503:400);}
 };
}
