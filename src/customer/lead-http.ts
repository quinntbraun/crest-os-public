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
import {createLeadDirectory,LeadDirectoryError} from './lead-directory.ts';
import {customerUuid as leadUuid,customerVersion as leadVersion,requireCustomer as requireLead} from './customer-contract.ts';
import {parseLeadDraft} from './lead-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/leads/';
const draftKeys=['label','customerId','sourceId','referralText','phone','email','requestedScope','availability','estimatedCents','followUpAt','notes'] as const;
const fields={context:[],list:['search','afterId','includeLost','pageSize'],history:['leadId','afterVersion','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','leadId','expectedVersion',...draftKeys]} as const;
type Route=keyof typeof fields;
export function leadFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'LEAD_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Only trusted composition can select this business. All routes share the
// existing committed ordinary admission budget with authentication/settings.
export function createLeadHttp(config:Configuration,provider:Parameters<typeof createLeadDirectory>[1],tokens:Parameters<typeof createLeadDirectory>[2]){
  if(!leadUuid(config.businessId))throw new Error('LEAD_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const directory=createLeadDirectory(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let submitted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
      const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
      if(url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return leadFailureResponse(404);
      if(request.method!=='POST')return leadFailureResponse(405);
      protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
      const input=await readFlatJsonBody(bounded,fields[route],131072);
      let draft:ReturnType<typeof parseLeadDraft>|undefined;
      if(route==='save'){
        requireLead(input.schemaVersion===1&&leadUuid(input.operationId)&&leadUuid(input.leadId)&&leadUuid(input.recoveryEpoch)&&leadVersion(input.expectedVersion,true));
        draft=parseLeadDraft(Object.fromEntries(draftKeys.map(k=>[k,input[k]])));
      }
      if(route==='operation')requireLead(leadUuid(input.operationId));
      if(route==='list')requireLead(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||leadUuid(input.afterId))&&typeof input.includeLost==='boolean'&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
      if(route==='history')requireLead(leadUuid(input.leadId)&&leadVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
      const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'LEAD_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
      if(signal.aborted)throw new Error();let result:object;
      if(route==='context'){
        // crm.manage is checked by the same fresh typed read as the directory.
        // Context is advisory: the save always rechecks the exact pinned epoch.
        await directory.list(cookie,{businessId,search:'',afterId:null,includeLost:false,pageSize:1},signal);
        const value=(await context(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.lead.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));return response;
      }
      if(route==='save'){
        submitted=true;
        const value=(await directory.save(cookie,{schemaVersion:1,businessId,operationId:input.operationId as string,leadId:input.leadId as string,recoveryEpoch:input.recoveryEpoch as string,expectedVersion:input.expectedVersion as string,draft:draft!},signal)).forServer();
        if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
      }
      if(route==='operation')result=(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();
      else if(route==='history')result=(await directory.history(cookie,{businessId,leadId:input.leadId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer();
      else result=(await directory.list(cookie,{businessId,search:input.search as string,afterId:input.afterId as string|null,includeLost:input.includeLost as boolean,pageSize:input.pageSize as number},signal)).forServer();
      if(signal.aborted)throw new Error();return privateJsonResponse(result);
    }catch(error){
      if(submitted&&error instanceof LeadDirectoryError){
        if(error.message==='LEAD_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='LEAD_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      if(submitted)return privateJsonResponse({error:'LEAD_SAVE_OUTCOME_UNKNOWN'},503);
      return leadFailureResponse(workStarted?503:400);
    }
  };
}
