import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {legacyBatchRoutes} from './legacy-contact-batch-contract.ts';
import {legacyContactBatchResponse} from './legacy-contact-batch-http.ts';
import {createLegacyContactDownloadHttp} from './legacy-contact-download-http.ts';
import {legacyContactDownloadRoute} from './legacy-contact-download-contract.ts';
import {legacyMatchBodyLimit,parseLegacyHintRequest} from './legacy-contact-match-contract.ts';
import {privateJsonResponse,readFlatJsonBody,readNestedJsonBody} from '../security/private-http.ts';
import {createLegacyCsvCsrfVerifier,createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createCustomerDirectory,CustomerDirectoryError} from './customer-directory.ts';
import {parseCustomerDraft,customerUuid,customerVersion,requireCustomer} from './customer-contract.ts';
import {customerProfileFields,parseCustomerProfileRequest} from './customer-profile-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string;recordJobHistory?:boolean;customerProfile?:boolean};
const prefix='/api/business/customers/';
const draftKeys=['displayName','phone','email','contactPreference','outreachOptOut','notes','customerSince','archived','archiveReason'] as const;
const fields={'legacy-matches':['kind','hints'],context:[],list:['search','afterId','includeArchived','pageSize'],history:['customerId','afterVersion','pageSize'],profile:customerProfileFields,operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','customerId','expectedVersion',...draftKeys]} as const;
type Route=keyof typeof fields;
export function customerFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'CUSTOMER_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Only trusted composition can select this business. All routes share the
// existing committed ordinary admission budget with authentication/settings.
export function createCustomerHttp(config:Configuration,provider:Parameters<typeof createCustomerDirectory>[1],tokens:Parameters<typeof createCustomerDirectory>[2],reviewHistoryEnabled=false,maintenanceEnabled=false,legacyBatchesEnabled=false,legacyEffectsEnabled=false,legacyTargetsEnabled=false,legacyDecisionsEnabled=false,legacyApprovalsEnabled=false,legacyApplicationsEnabled:boolean|'background'=false,legacyDownloadsEnabled=false){
  if(!customerUuid(config.businessId)||typeof reviewHistoryEnabled!=='boolean'||typeof maintenanceEnabled!=='boolean'||typeof legacyBatchesEnabled!=='boolean'||typeof legacyEffectsEnabled!=='boolean'||legacyEffectsEnabled&&!legacyBatchesEnabled||typeof legacyTargetsEnabled!=='boolean'||legacyTargetsEnabled&&!legacyEffectsEnabled||typeof legacyDecisionsEnabled!=='boolean'||legacyDecisionsEnabled&&!legacyTargetsEnabled||typeof legacyApprovalsEnabled!=='boolean'||legacyApprovalsEnabled&&!legacyDecisionsEnabled||(typeof legacyApplicationsEnabled!=='boolean'&&legacyApplicationsEnabled!=='background')||legacyApplicationsEnabled&&!legacyApprovalsEnabled||
    typeof legacyDownloadsEnabled!=='boolean'||legacyDownloadsEnabled&&legacyApplicationsEnabled!=='background'||
    (reviewHistoryEnabled||maintenanceEnabled||legacyBatchesEnabled||config.customerProfile===true)&&config.environment!=='test')throw new Error('CUSTOMER_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const csvCsrf=legacyBatchesEnabled?createLegacyCsvCsrfVerifier(config):undefined;
  const directory=createCustomerDirectory(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
  const download=legacyDownloadsEnabled?createLegacyContactDownloadHttp(directory):undefined;
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let submitted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
      const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
      const batchRoute=legacyBatchesEnabled&&legacyBatchRoutes.find(candidate=>candidate===(route as string)&&
        (candidate!=='legacy-batches/effects'||legacyEffectsEnabled)&&(candidate!=='legacy-batches/targets'||legacyTargetsEnabled)&&(!candidate.endsWith('-decision')||legacyDecisionsEnabled)&&
        (candidate!=='legacy-batches/review-approval'&&candidate!=='legacy-batches/approve'||legacyApprovalsEnabled)&&
        (candidate!=='legacy-batches/apply-status'||legacyApplicationsEnabled==='background')&&
        (candidate!==legacyContactDownloadRoute||download!==undefined)&&
        (candidate!=='legacy-batches/identity'&&candidate!=='legacy-batches/application'&&candidate!=='legacy-batches/apply'||legacyApplicationsEnabled));
      if(url.search||url.hash||!url.pathname.startsWith(prefix)||!batchRoute&&!Object.hasOwn(fields,route))return customerFailureResponse(404);
      if(route==='profile'&&config.customerProfile!==true)return customerFailureResponse(404);
      if(request.method!=='POST')return customerFailureResponse(405);
      if(batchRoute!=='legacy-batches/stage')protect.requireOrigin(request);
      const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
      if(batchRoute){
        const verify=batchRoute==='legacy-batches/stage'?csvCsrf:csrf;
        if(!verify)throw new Error();
        await verify(bounded,cookie,signal);workStarted=true;
        if(!await admit(cookie,'ordinary',signal)){
          const response=privateJsonResponse({error:'LEGACY_BATCH_LIMITED'},429);response.headers.set('Retry-After','60');return response;
        }
        if(batchRoute===legacyContactDownloadRoute&&download)return await download(bounded,cookie,businessId,signal);
        return await legacyContactBatchResponse(batchRoute,bounded,cookie,businessId,directory,signal,legacyApplicationsEnabled==='background');
      }
      const input:Readonly<Record<string,unknown>>=route==='legacy-matches'
        ?parseLegacyHintRequest(await readNestedJsonBody(bounded,fields[route],legacyMatchBodyLimit),'customer')
        :await readFlatJsonBody(bounded,fields[route]);
      let draft:ReturnType<typeof parseCustomerDraft>|undefined;
      if(route==='save'){
        requireCustomer(input.schemaVersion===1&&customerUuid(input.operationId)&&customerUuid(input.customerId)&&customerUuid(input.recoveryEpoch)&&customerVersion(input.expectedVersion,true));
        draft=parseCustomerDraft(Object.fromEntries(draftKeys.map(k=>[k,input[k]])));
      }
      if(route==='operation')requireCustomer(customerUuid(input.operationId));
      if(route==='list')requireCustomer(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||customerUuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
      if(route==='history')requireCustomer(customerUuid(input.customerId)&&customerVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
      const profile=route==='profile'?parseCustomerProfileRequest(input):null;
      const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'CUSTOMER_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
      if(signal.aborted)throw new Error();let result:object;
      if(route==='context'){
        // crm.manage is checked by the same fresh typed read as the directory.
        // Context is advisory: the save always rechecks the exact pinned epoch.
        await directory.list(cookie,{businessId,search:'',afterId:null,includeArchived:false,pageSize:1},signal);
        const value=(await context(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.customer.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));
        if(config.recordJobHistory===true)response.headers.set('X-Crest-Record-Job-History','1');
        if(config.customerProfile===true)response.headers.set('X-Crest-Customer-Profile','1');
        if(reviewHistoryEnabled)response.headers.set('X-Crest-Review-History','1');
        if(legacyBatchesEnabled)response.headers.set('X-Crest-Legacy-Contact-Batches','1');
        if(legacyEffectsEnabled)response.headers.set('X-Crest-Legacy-Contact-Effects','1');
        if(legacyTargetsEnabled)response.headers.set('X-Crest-Legacy-Contact-Targets','1');
        if(legacyDecisionsEnabled)response.headers.set('X-Crest-Legacy-Contact-Decisions','1');
        if(legacyApprovalsEnabled)response.headers.set('X-Crest-Legacy-Contact-Approvals','1');
        if(legacyApplicationsEnabled)response.headers.set('X-Crest-Legacy-Contact-Applications',legacyApplicationsEnabled==='background'?'background':'1');
        if(legacyDownloadsEnabled)response.headers.set('X-Crest-Legacy-Contact-Downloads','1');
        if(maintenanceEnabled)response.headers.set('X-Crest-Maintenance-Follow-Up','1');
        return response;
      }
      if(route==='save'){
        submitted=true;
        const value=(await directory.save(cookie,{schemaVersion:1,businessId,operationId:input.operationId as string,customerId:input.customerId as string,recoveryEpoch:input.recoveryEpoch as string,expectedVersion:input.expectedVersion as string,draft:draft!},signal)).forServer();
        if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
      }
      if(route==='legacy-matches')result=(await directory.legacyMatches(cookie,businessId,input,signal)).forServer();
      else if(route==='operation')result=(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();
      else if(route==='history')result=(await directory.history(cookie,{businessId,customerId:input.customerId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer();
      else if(profile)result=(await directory.profile(cookie,businessId,profile,signal)).forServer();
      else result=(await directory.list(cookie,{businessId,search:input.search as string,afterId:input.afterId as string|null,includeArchived:input.includeArchived as boolean,pageSize:input.pageSize as number},signal)).forServer();
      if(signal.aborted)throw new Error();return privateJsonResponse(result);
    }catch(error){
      if(submitted&&error instanceof CustomerDirectoryError){
        if(error.message==='CUSTOMER_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='CUSTOMER_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      if(submitted)return privateJsonResponse({error:'CUSTOMER_SAVE_OUTCOME_UNKNOWN'},503);
      return customerFailureResponse(workStarted?503:400);
    }
  };
}
