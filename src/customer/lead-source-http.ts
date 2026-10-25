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
import {createLeadSourceDirectory,LeadSourceDirectoryError} from './lead-source-directory.ts';
import {customerUuid as leadSourceUuid,customerVersion as leadSourceVersion,requireCustomer as requireLeadSource} from './customer-contract.ts';
import {parseLeadSourceDraft} from './lead-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/lead-sources/';
const draftKeys=['label','kind','active','referralCustomerId'] as const;
const fields={context:[],list:['search','afterId','includeInactive','pageSize'],history:['leadSourceId','afterVersion','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','leadSourceId','expectedVersion',...draftKeys]} as const;
type Route=keyof typeof fields;
export function leadSourceFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'LEAD_SOURCE_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Only trusted composition can select this business. All routes share the
// existing committed ordinary admission budget with authentication/settings.
export function createLeadSourceHttp(config:Configuration,provider:Parameters<typeof createLeadSourceDirectory>[1],tokens:Parameters<typeof createLeadSourceDirectory>[2]){
  if(!leadSourceUuid(config.businessId))throw new Error('LEAD_SOURCE_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const directory=createLeadSourceDirectory(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let submitted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
      const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
      if(url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return leadSourceFailureResponse(404);
      if(request.method!=='POST')return leadSourceFailureResponse(405);
      protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
      const input=await readFlatJsonBody(bounded,fields[route]);
      let draft:ReturnType<typeof parseLeadSourceDraft>|undefined;
      if(route==='save'){
        requireLeadSource(input.schemaVersion===1&&leadSourceUuid(input.operationId)&&leadSourceUuid(input.leadSourceId)&&leadSourceUuid(input.recoveryEpoch)&&leadSourceVersion(input.expectedVersion,true));
        draft=parseLeadSourceDraft(Object.fromEntries(draftKeys.map(k=>[k,input[k]])));
      }
      if(route==='operation')requireLeadSource(leadSourceUuid(input.operationId));
      if(route==='list')requireLeadSource(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||leadSourceUuid(input.afterId))&&typeof input.includeInactive==='boolean'&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
      if(route==='history')requireLeadSource(leadSourceUuid(input.leadSourceId)&&leadSourceVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
      const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'LEAD_SOURCE_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
      if(signal.aborted)throw new Error();let result:object;
      if(route==='context'){
        // crm.manage is checked by the same fresh typed read as the directory.
        // Context is advisory: the save always rechecks the exact pinned epoch.
        await directory.list(cookie,{businessId,search:'',afterId:null,includeInactive:false,pageSize:1},signal);
        const value=(await context(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.lead.source.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));return response;
      }
      if(route==='save'){
        submitted=true;
        const value=(await directory.save(cookie,{schemaVersion:1,businessId,operationId:input.operationId as string,leadSourceId:input.leadSourceId as string,recoveryEpoch:input.recoveryEpoch as string,expectedVersion:input.expectedVersion as string,draft:draft!},signal)).forServer();
        if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
      }
      if(route==='operation')result=(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();
      else if(route==='history')result=(await directory.history(cookie,{businessId,leadSourceId:input.leadSourceId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer();
      else result=(await directory.list(cookie,{businessId,search:input.search as string,afterId:input.afterId as string|null,includeInactive:input.includeInactive as boolean,pageSize:input.pageSize as number},signal)).forServer();
      if(signal.aborted)throw new Error();return privateJsonResponse(result);
    }catch(error){
      if(submitted&&error instanceof LeadSourceDirectoryError){
        if(error.message==='LEAD_SOURCE_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='LEAD_SOURCE_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      if(submitted)return privateJsonResponse({error:'LEAD_SOURCE_SAVE_OUTCOME_UNKNOWN'},503);
      return leadSourceFailureResponse(workStarted?503:400);
    }
  };
}
