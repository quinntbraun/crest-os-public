import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createServiceDirectory,ServiceDirectoryError} from './service-directory.ts';
import {serviceId,serviceRevision,requireService as check,parseServiceSave} from './service-storage-contract.ts';
const prefix='/api/business/services/';
const definitionKeys=['name','inclusions','exclusions','internalGuidance','rangeLowCents','rangeHighCents','estimatedSeconds'] as const;
const fields={context:[],list:['search','afterId','includeInactive','pageSize'],history:['serviceId','afterRevision','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','serviceId','expectedRevision','code','active',...definitionKeys]} as const;
type Route=keyof typeof fields;
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function serviceFailureResponse(status:400|404|405|503=400){const r=privateJsonResponse({error:'SERVICE_REQUEST_FAILED'},status);if(status===405)r.headers.set('Allow','POST');return r;}
// Candidate construction only. No ordinary runtime route/flag selects this;
// registered catalog/source/recovery adoption must precede product exposure.
export function createServiceHttp(config:Configuration,provider:Parameters<typeof createServiceDirectory>[1],tokens:Parameters<typeof createServiceDirectory>[2],enabled=false){
 if(!serviceId(config.businessId)||typeof enabled!=='boolean')throw new Error('SERVICE_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const directory=enabled?createServiceDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let submitted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
   if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return serviceFailureResponse(404);
   if(request.method!=='POST')return serviceFailureResponse(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
   const input=await readFlatJsonBody(bounded,fields[route],route==='save'?131072:8192);
   const command=route==='save'?parseServiceSave({schemaVersion:input.schemaVersion,businessId,operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,serviceId:input.serviceId,expectedRevision:input.expectedRevision,payload:{code:input.code,active:input.active,definition:Object.fromEntries(definitionKeys.map(k=>[k,input[k]]))}}):undefined;
   if(route==='operation')check(serviceId(input.operationId));
   if(route==='list')check(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||serviceId(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
   if(route==='history')check(serviceId(input.serviceId)&&serviceRevision(input.afterRevision,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
   const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
   if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'SERVICE_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
   if(signal.aborted)throw new Error();
   if(route==='context'){
    await directory!.list(cookie,{businessId,search:'',afterId:null,includeInactive:false,pageSize:1},signal);
    const value=(await context!(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
    const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
    response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.service.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));return response;
   }
   if(route==='save'){submitted=true;const value=(await directory!.save(cookie,command!,signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);}
   const value=route==='operation'?(await directory!.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer()
    :route==='history'?(await directory!.history(cookie,{businessId,serviceId:input.serviceId as string,afterRevision:input.afterRevision as string,pageSize:input.pageSize as number},signal)).forServer()
    :(await directory!.list(cookie,{businessId,search:input.search as string,afterId:input.afterId as string|null,includeInactive:input.includeInactive as boolean,pageSize:input.pageSize as number},signal)).forServer();
   if(signal.aborted)throw new Error();return privateJsonResponse(value);
  }catch(error){
   if(submitted&&error instanceof ServiceDirectoryError){
    if(error.message==='SERVICE_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
    if(error.message==='SERVICE_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
    if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
   }
   if(submitted)return privateJsonResponse({error:'SERVICE_SAVE_OUTCOME_UNKNOWN'},503);
   return serviceFailureResponse(workStarted?503:400);
  }
 };
}
