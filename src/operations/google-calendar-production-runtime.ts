import 'server-only';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {sessionCredentialHash} from '../security/session-credential.ts';
import {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import {productionCapability} from '../security/production-capabilities.ts';
import type {ProductionCapabilityConfiguration} from '../security/production-capabilities.ts';
import {createGoogleCalendarConnection} from './google-calendar-connection.ts';
import {createGoogleCalendarConsentHttp,googleCalendarConsentFailure,googleCalendarConsentPrefix} from './google-calendar-consent-http.ts';
import {productionGoogleCalendarSetupDatabase} from './google-calendar-database.ts';
import {parseGoogleCalendarJobStatus} from './google-calendar-job-status.ts';
import {cleanGoogleCalendarOAuthResponse} from './google-calendar-oauth.ts';
import {validateProductionCalendarConfiguration,validateCalendarRuntimeConnection} from '../server/production-calendar-configuration.ts';
import type {ProductionGoogleCalendarConfiguration} from '../server/production-calendar-configuration.ts';

export const googleCalendarCallbackPath='/api/google-calendar/callback';
const prefix='/api/business/google-calendar/';
type Config=Parameters<typeof createGoogleCalendarConsentHttp>[0]&ProductionCapabilityConfiguration;
type Provider=Parameters<typeof createGoogleCalendarConsentHttp>[1];
type Tokens=Parameters<typeof createGoogleCalendarConsentHttp>[2];
type Peer=Parameters<ReturnType<typeof createGoogleCalendarConsentHttp>>[1];
function require(value:unknown):asserts value{if(!value)throw Error('GOOGLE_CALENDAR_SETUP_UNVERIFIED');}
function state(value:unknown,epoch:string){
 if(exact(value,['schemaVersion','state','attemptId'])&&value.schemaVersion===1&&value.state==='authorization_pending'&&uuid(value.attemptId))return value;
 if(exact(value,['schemaVersion','state'])&&value.schemaVersion===1&&['ready','active','review'].includes(value.state as string))return value;
 require(exact(value,['schemaVersion','state','destinationId','credentialId','recoveryEpoch'])&&value.schemaVersion===1&&(value.state==='staged'||value.state==='active')&&uuid(value.destinationId)&&uuid(value.credentialId)&&value.recoveryEpoch===epoch);return value;
}
export function createProductionGoogleCalendarRuntime(config:Config,provider:Provider,tokens:Tokens,input:ProductionGoogleCalendarConfiguration){
 require(productionCapability(config,'googleCalendar')&&uuid(config.businessId));
 const calendar=validateProductionCalendarConfiguration(input,config.origin);validateCalendarRuntimeConnection(config.connectionString,calendar.connectionString);
 const origin=config.origin,businessId=config.businessId,callbackUri=origin+googleCalendarCallbackPath;
 const committedQuery=productionGoogleCalendarSetupDatabase({...config,connectionString:calendar.connectionString});
 const composition=createGoogleCalendarConnection({...calendar,callbackUri,committedQuery,request:globalThis.fetch.bind(globalThis),budgetedExchanges:true,withIdentity:true,reviewedConsent:true}).then(connection=>({connection,consent:createGoogleCalendarConsentHttp(config,provider,tokens,connection,true)}),()=>null);
 const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),sessions=createSessionLifecycle(config,provider,tokens),settings=createBusinessSettingsContextReader(config,provider,tokens);
 return async(request:Request,peer:Peer)=>{
  const url=new URL(request.url),callback=url.pathname===googleCalendarCallbackPath;
  let hash:Buffer|undefined,submitted=false;
  try{
   resolve(request,peer);const runtime=await composition;require(runtime);
   if(!callback&&url.pathname.startsWith(googleCalendarConsentPrefix))return runtime.consent(request,peer);
   const route=url.pathname.slice(prefix.length);
   if(!callback&&(!url.pathname.startsWith(prefix)||!['setup-state','connection-info','start-authorization','job-status','connection-status','disconnect','disconnect-status','revoke','abandon-authorization','reconnect-info','start-reconnect'].includes(route)||request.url!==origin+prefix+route))return googleCalendarConsentFailure(404);
   if(callback&&request.method!=='GET')return cleanGoogleCalendarOAuthResponse();
   if(!callback&&request.method!=='POST')return googleCalendarConsentFailure(405);
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);signal.throwIfAborted();
   if(!callback)protect.requireOrigin(request);
   const credential=readBrowserCookies(request.headers).session;require(credential);
   const disconnectRoute=['disconnect','disconnect-status','revoke'].includes(route);
   const body=callback?null:await readFlatJsonBody(new Request(request,{signal}),route==='start-reconnect'?['recoveryEpoch','destinationId','generation','googleOwner','confirmed']:route==='abandon-authorization'?['recoveryEpoch','attemptId','operationId','confirmed']:route==='disconnect'?['recoveryEpoch','destinationId','generation','operationId','confirmed']:route==='disconnect-status'||route==='revoke'?['recoveryEpoch','destinationId','disconnectId']:route==='start-authorization'?['recoveryEpoch','googleOwner','confirmed']:route==='job-status'?['recoveryEpoch','jobId']:['recoveryEpoch'],2048);
   if(body)require(uuid(body.recoveryEpoch));
   if(route==='start-authorization')require(body?.confirmed===true&&body.googleOwner===calendar.googleOwner);
   if(route==='job-status')require(uuid(body?.jobId));
   if(route==='abandon-authorization')require(body?.confirmed===true&&uuid(body.attemptId)&&uuid(body.operationId));
   if(route==='start-reconnect')require(body?.confirmed===true&&uuid(body.destinationId)&&version(body.generation)&&body.googleOwner===calendar.googleOwner);
   if(disconnectRoute)require(uuid(body?.destinationId));
   if(route==='disconnect')require(body?.confirmed===true&&uuid(body.operationId)&&typeof body.generation==='string');
   if(route==='disconnect-status'||route==='revoke')require(uuid(body?.disconnectId));
   const sessionId=callback?null:await csrf(request,credential,signal);
   if(!await admit(credential,'ordinary',signal))return callback?cleanGoogleCalendarOAuthResponse():googleCalendarConsentFailure(429,'GOOGLE_CALENDAR_CONSENT_LIMITED');
   const owner=await sessions.verify(credential,signal,'background',callback||route!=='job-status');require(!signal.aborted&&(callback||sessionId===owner.sessionId));
   let recoveryEpoch=body?.recoveryEpoch;
   if(callback){const context=(await settings(credential,businessId,signal)).forServer();require(context.writeState==='ready');recoveryEpoch=context.recoveryEpoch;}
   require(uuid(recoveryEpoch));hash=sessionCredentialHash(credential);
   const authority={credentialHash:hash,businessId,actorId:owner.actorId,appSessionId:owner.sessionId,recoveryEpoch,connectionGeneration:'0',authIssuer:owner.provider.issuer,authSubject:owner.provider.subject,authProviderSessionId:owner.provider.sessionId,providerValidUntil:owner.provider.expiresAt};
   if(callback){
    const connection=await runtime.connection.connectionStatus(authority,signal);
    if(connection.state==='absent')await runtime.connection.initialCreationCallback(request,authority,signal);
    else{const target=await runtime.connection.reconnectTarget(authority,signal);require(target);await runtime.connection.callback(request,{...authority,connectionGeneration:target.generation},signal);}
    return cleanGoogleCalendarOAuthResponse();
   }
   if(route==='reconnect-info'){
    const target=await runtime.connection.reconnectTarget(authority,signal);require(!signal.aborted);
    return privateJsonResponse(target?{schemaVersion:1,state:'ready',destinationId:target.destinationId,generation:target.generation,googleOwner:calendar.googleOwner}:{schemaVersion:1,state:'unavailable'});
   }
   if(route==='start-reconnect'){
    submitted=true;const redirect=await runtime.connection.startReconnect(authority,body!.destinationId as string,body!.generation as string,calendar.googleOwner,signal);
    const location=redirect.headers.get('location');require(location);const authorization=new URL(location);
    require(authorization.origin==='https://accounts.google.com'&&authorization.pathname==='/o/oauth2/v2/auth'&&!signal.aborted);
    authorization.searchParams.set('login_hint',calendar.googleOwner);return privateJsonResponse({authorizationUrl:authorization.href});
   }
   if(route==='abandon-authorization'){submitted=true;return privateJsonResponse(await runtime.connection.abandonCreation(authority,body!.attemptId as string,body!.operationId as string,signal));}
   if(route==='connection-status')return privateJsonResponse(await runtime.connection.connectionStatus(authority,signal));
   if(route==='disconnect'){submitted=true;return privateJsonResponse(await runtime.connection.beginDisconnect(authority,body!.destinationId as string,body!.generation as string,body!.operationId as string,signal));}
   if(route==='disconnect-status'||route==='revoke'){submitted=route==='revoke';return privateJsonResponse(await runtime.connection.disconnectStatus(authority,body!.destinationId as string,body!.disconnectId as string,signal,route==='revoke'));}
   if(route==='job-status'){const value=await runtime.connection.jobStatus(authority,body!.jobId as string,signal);require(!signal.aborted);return value===null?googleCalendarConsentFailure(404):privateJsonResponse(parseGoogleCalendarJobStatus(value,body!.jobId as string));}
   const current=state(await runtime.connection.setupState(authority,signal),recoveryEpoch);require(!signal.aborted);
   if(route==='connection-info')return privateJsonResponse({schemaVersion:1,mode:'production',googleOwner:calendar.googleOwner});
   if(route==='setup-state')return privateJsonResponse(current);
   require(current.state==='ready');submitted=true;
   const redirect=await runtime.connection.begin(authority,signal),location=redirect.headers.get('location');require(location);
   const authorization=new URL(location),attemptId=authorization.searchParams.get('state')?.split('.')[0];
   require(authorization.origin==='https://accounts.google.com'&&authorization.pathname==='/o/oauth2/v2/auth'&&uuid(attemptId));
   require(await runtime.connection.confirmCreation(authority,attemptId,calendar.googleOwner,true,signal)&&!signal.aborted);
   authorization.searchParams.set('login_hint',calendar.googleOwner);
   return privateJsonResponse({authorizationUrl:authorization.href});
  }catch{return callback?cleanGoogleCalendarOAuthResponse():googleCalendarConsentFailure(submitted?503:409,submitted?'GOOGLE_CALENDAR_SETUP_OUTCOME_UNKNOWN':'GOOGLE_CALENDAR_SETUP_UNAVAILABLE');}
  finally{hash?.fill(0);}
 };
}
