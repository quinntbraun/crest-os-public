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
import {customerUuid,customerVersion} from '../customer/customer-contract.ts';
import {createHoldDirectory,HoldDirectoryError} from './appointment-hold-directory.ts';
import {holdPayloadKeys,parseHoldSave,requireHold as check} from './appointment-hold-contract.ts';
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/appointment-holds/';
const fields={context:[],list:['afterId','pageSize'],history:['holdId','afterSequence','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','holdId','expectedSequence',...holdPayloadKeys]} as const;
type Route=keyof typeof fields;
export function holdFailureResponse(status:400|404|405|503=400){const r=privateJsonResponse({error:'HOLD_REQUEST_FAILED'},status);if(status===405)r.headers.set('Allow','POST');return r;}
// Explicit trusted synthetic composition only, pending coordinated source adoption.
export function createHoldHttp(config:Configuration,provider:Parameters<typeof createHoldDirectory>[1],tokens:Parameters<typeof createHoldDirectory>[2],enabled=false){
 if(!customerUuid(config.businessId)||typeof enabled!=='boolean'||enabled&&config.environment!=='test')throw Error('HOLD_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createHoldDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{let submitted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();resolve(request,peer);const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
   if(url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return holdFailureResponse(404);if(request.method!=='POST')return holdFailureResponse(405);if(!directory||!context)return holdFailureResponse(503);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();const input=await readFlatJsonBody(bounded,fields[route],32768);
   const command=route==='save'?parseHoldSave({schemaVersion:input.schemaVersion,businessId,operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,holdId:input.holdId,expectedSequence:input.expectedSequence,payload:Object.fromEntries(holdPayloadKeys.map(k=>[k,input[k]]))}):undefined;
   if(route==='operation')check(customerUuid(input.operationId));if(route==='list')check((input.afterId===null||customerUuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);if(route==='history')check(customerUuid(input.holdId)&&customerVersion(input.afterSequence,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
   const sessionId=await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const r=privateJsonResponse({error:'HOLD_REQUEST_LIMITED'},429);r.headers.set('Retry-After','60');return r;}if(signal.aborted)throw Error();
   if(route==='context'){await directory.list(cookie,{businessId,afterId:null,pageSize:1},signal);const v=(await context(cookie,businessId,signal)).forServer();check(!signal.aborted);const r=privateJsonResponse({schemaVersion:v.schemaVersion,businessId:v.businessId,writeState:v.writeState,recoveryEpoch:v.recoveryEpoch});r.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.appointment-hold.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));return r;}
   if(route==='save'){submitted=true;const v=(await directory.save(cookie,command!,signal)).forServer();check(!signal.aborted);return privateJsonResponse(v,v.state==='conflict'?409:200);}
   const v=route==='operation'?(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer():route==='history'?(await directory.history(cookie,{businessId,holdId:input.holdId as string,afterSequence:input.afterSequence as string,pageSize:input.pageSize as number},signal)).forServer():(await directory.list(cookie,{businessId,afterId:input.afterId as string|null,pageSize:input.pageSize as number},signal)).forServer();check(!signal.aborted);return privateJsonResponse(v);
  }catch(error){if(submitted&&error instanceof HoldDirectoryError){if(error.message==='HOLD_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}return submitted?privateJsonResponse({error:'HOLD_SAVE_OUTCOME_UNKNOWN'},503):holdFailureResponse(workStarted?503:400);}
 };
}
