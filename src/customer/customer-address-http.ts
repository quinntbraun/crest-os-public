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
import {createCustomerAddressDirectory,CustomerAddressDirectoryError} from './customer-address-directory.ts';
import {customerUuid,customerVersion,requireCustomer} from './customer-contract.ts';
import {parseAddressDraft} from './customer-resource-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/customers/addresses/';
const draftKeys=['line1','line2','city','region','postalCode','country','exactLocationText','instructions','latitude','longitude','geocodeSource','geocodeAccuracy','verifiedAt','archived','archiveReason'] as const;
const fields={context:['customerId'],list:['customerId','search','afterId','includeArchived','pageSize'],history:['customerId','addressId','afterVersion','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','customerId','addressId','expectedVersion',...draftKeys]} as const;

type Route=keyof typeof fields;
export function addressFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'ADDRESS_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Only trusted composition can select this business. All routes share the
// existing committed ordinary admission budget with authentication/settings.
export function createCustomerAddressHttp(config:Configuration,provider:Parameters<typeof createCustomerAddressDirectory>[1],tokens:Parameters<typeof createCustomerAddressDirectory>[2]){
  if(!customerUuid(config.businessId))throw new Error('ADDRESS_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const directory=createCustomerAddressDirectory(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let submitted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
      const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
      if(url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return addressFailureResponse(404);
      if(request.method!=='POST')return addressFailureResponse(405);
      protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
      const input=await readFlatJsonBody(bounded,fields[route]);
      let draft:ReturnType<typeof parseAddressDraft>|undefined;
      if(route==='save'){
        requireCustomer(input.schemaVersion===1&&customerUuid(input.operationId)&&customerUuid(input.customerId)&&customerUuid(input.addressId)&&customerUuid(input.recoveryEpoch)&&customerVersion(input.expectedVersion,true));
        draft=parseAddressDraft(Object.fromEntries(draftKeys.map(k=>[k,input[k]])));
      }
      if(route==='context'||route==='list'||route==='history')requireCustomer(customerUuid(input.customerId));
      if(route==='operation')requireCustomer(customerUuid(input.operationId));
      if(route==='list')requireCustomer(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||customerUuid(input.afterId))&&typeof input.includeArchived==='boolean'&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
      if(route==='history')requireCustomer(customerUuid(input.addressId)&&customerVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
      const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'ADDRESS_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
      if(signal.aborted)throw new Error();let result:object;
      if(route==='context'){
        // crm.manage is checked by the same fresh typed read as the directory.
        // Context is advisory: the save always rechecks the exact pinned epoch.
        await directory.list(cookie,{businessId,customerId:input.customerId as string,search:'',afterId:null,includeArchived:false,pageSize:1},signal);
        const value=(await context(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,customerId:input.customerId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.address.edit.v1\0').update(businessId).update('\0').update(input.customerId as string).update('\0').update(sessionId).digest('base64url'));return response;
      }
      if(route==='save'){
        submitted=true;
        const value=(await directory.save(cookie,{schemaVersion:1,businessId,operationId:input.operationId as string,customerId:input.customerId as string,addressId:input.addressId as string,recoveryEpoch:input.recoveryEpoch as string,expectedVersion:input.expectedVersion as string,draft:draft!},signal)).forServer();
        if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
      }
      if(route==='operation')result=(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();
      else if(route==='history')result=(await directory.history(cookie,{businessId,customerId:input.customerId as string,addressId:input.addressId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer();
      else result=(await directory.list(cookie,{businessId,customerId:input.customerId as string,search:input.search as string,afterId:input.afterId as string|null,includeArchived:input.includeArchived as boolean,pageSize:input.pageSize as number},signal)).forServer();
      if(signal.aborted)throw new Error();return privateJsonResponse(result);
    }catch(error){
      if(submitted&&error instanceof CustomerAddressDirectoryError){
        if(error.message==='ADDRESS_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='ADDRESS_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      if(submitted)return privateJsonResponse({error:'ADDRESS_SAVE_OUTCOME_UNKNOWN'},503);
      return addressFailureResponse(workStarted?503:400);
    }
  };
}
