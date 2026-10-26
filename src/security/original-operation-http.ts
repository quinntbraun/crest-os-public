import 'server-only';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {createRequestProtection} from './request-protection.ts';
import {readBrowserCookies} from './browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from './private-http.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createOriginalOperationDirectory,OriginalOperationDirectoryError} from './original-operation-directory.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {originalOperationBodyLimit,originalOperationLookupWireKeys,originalOperationRetirementWireKeys,parseOriginalOperationLookupWire,parseOriginalOperationRetirementWire} from './original-operation-http-contract.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/original-operations/';
function failure(status:400|404|405|503=400,error='ORIGINAL_OPERATION_REQUEST_FAILED'){
 const response=privateJsonResponse({error},status);if(status===405)response.headers.set('Allow','POST');return response;
}
export {failure as originalOperationFailureResponse};
// Trusted composition must explicitly opt in; browser input cannot. The
// ordinary application entry point keeps this unavailable by default.
export function createOriginalOperationHttp(config:Configuration,provider:Parameters<typeof createOriginalOperationDirectory>[1],tokens:Parameters<typeof createOriginalOperationDirectory>[2],enabled=false){
 if(!uuid(config.businessId)||typeof enabled!=='boolean')throw new Error('ORIGINAL_OPERATION_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const directory=enabled?createOriginalOperationDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let retirementStarted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length);
   if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!['retire','resolution'].includes(route))return failure(404);
   if(request.method!=='POST')return failure(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
   const input=await readFlatJsonBody(bounded,route==='retire'?originalOperationRetirementWireKeys:originalOperationLookupWireKeys,originalOperationBodyLimit);
   const retirement=route==='retire'?parseOriginalOperationRetirementWire(input,businessId):undefined;
   const original=retirement?.original??parseOriginalOperationLookupWire(input,businessId);
   await csrf(bounded,cookie,signal);
   workStarted=true;
   if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'ORIGINAL_OPERATION_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
   if(signal.aborted)throw new Error();
   if(retirement){retirementStarted=true;const value=(await directory!.retire(cookie,retirement,signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value);}
   const value=(await directory!.lookup(cookie,original,signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value);
  }catch(error){
   if(error instanceof OriginalOperationDirectoryError){
    if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:'RECOVERY_REVIEW_REQUIRED'},409);
    if(['ORIGINAL_OPERATION_NOT_SUBMITTED','ORIGINAL_OPERATION_OUTCOME_UNKNOWN','ORIGINAL_OPERATION_READ_FAILED'].includes(error.message))return failure(503,error.message);
   }
   return failure(workStarted?503:400,retirementStarted?'ORIGINAL_OPERATION_OUTCOME_UNKNOWN':'ORIGINAL_OPERATION_REQUEST_FAILED');
  }
 };
}
