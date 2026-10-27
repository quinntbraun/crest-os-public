import 'server-only';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {createRequestProtection} from './request-protection.ts';
import {readBrowserCookies} from './browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from './private-http.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createSourceExportOwnerAccess,SourceExportOwnerAccessError} from './source-export-owner-access.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {sourceExportBodyLimit,sourceExportReferenceWireKeys,sourceExportRetirementWireKeys,sourceExportStatusWireKeys,parseSourceExportReferenceWire,parseSourceExportRetirementWire,parseSourceExportStatusWire} from './source-export-http-contract.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/exports/';
function failure(status:400|404|405|503=400,error='SOURCE_EXPORT_REQUEST_FAILED'){
 const response=privateJsonResponse({error},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Private composition only, disabled by default. This does not register a
// route, adopt schema43, dispatch a worker or authorize file downloads.
export function createSourceExportHttp(config:Configuration,provider:Parameters<typeof createSourceExportOwnerAccess>[1],tokens:Parameters<typeof createSourceExportOwnerAccess>[2],enabled=false){
 if(!uuid(config.businessId)||typeof enabled!=='boolean')throw new Error('SOURCE_EXPORT_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const access=enabled?createSourceExportOwnerAccess(config,provider,tokens,businessId):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let mutation:'request'|'resolution'|undefined,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length);
   if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!['request','status','original','retire','resolution'].includes(route))return failure(404);
   if(request.method!=='POST')return failure(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
   const input=await readFlatJsonBody(bounded,route==='retire'?sourceExportRetirementWireKeys:route==='status'?sourceExportStatusWireKeys:sourceExportReferenceWireKeys,sourceExportBodyLimit);
   const retirement=route==='retire'?parseSourceExportRetirementWire(input,businessId):undefined;
   const jobId=route==='status'?parseSourceExportStatusWire(input):undefined;
   const original=jobId?undefined:retirement?.original??parseSourceExportReferenceWire(input,businessId);
   await csrf(bounded,cookie,signal);workStarted=true;
   if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'SOURCE_EXPORT_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
   if(signal.aborted)throw new Error();
   let value:object;
   if(route==='request'){mutation='request';value=(await access!.request(cookie,original,signal)).forServer();}
   else if(retirement){mutation='resolution';value=(await access!.retireRequest(cookie,retirement,signal)).forServer();}
   else if(jobId)value=(await access!.status(cookie,jobId,signal)).forServer();
   else if(route==='original')value=(await access!.lookupRequest(cookie,original,signal)).forServer();
   else value=(await access!.lookupResolution(cookie,original,signal)).forServer();
   if(signal.aborted)throw new Error();return privateJsonResponse(value);
  }catch(error){
   if(error instanceof SourceExportOwnerAccessError){
    if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:'RECOVERY_REVIEW_REQUIRED'},409);
    if(['SOURCE_EXPORT_REQUEST_NOT_SUBMITTED','SOURCE_EXPORT_REQUEST_OUTCOME_UNKNOWN','SOURCE_EXPORT_RESOLUTION_NOT_SUBMITTED','SOURCE_EXPORT_RESOLUTION_OUTCOME_UNKNOWN','SOURCE_EXPORT_READ_FAILED'].includes(error.message))return failure(503,error.message);
   }
   return failure(workStarted?503:400,mutation==='request'?'SOURCE_EXPORT_REQUEST_OUTCOME_UNKNOWN':mutation==='resolution'?'SOURCE_EXPORT_RESOLUTION_OUTCOME_UNKNOWN':'SOURCE_EXPORT_REQUEST_FAILED');
  }
 };
}
