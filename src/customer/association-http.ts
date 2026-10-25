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
import {createVehicleAssociationDirectory,AssociationDirectoryError} from './vehicle-association-directory.ts';
import {customerUuid as uuid,requireCustomer as check} from './customer-contract.ts';
import {parseAssociationSave} from './association-command-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/vehicle-associations/';
const bodyKeys=['action','associationId','customerId','vehicleId','effectiveAt','relationship','isBilling','evidence','reason','nextAssociationId'] as const;
const fields={context:['vehicleId'],list:['vehicleId','afterId','pageSize'],history:['associationId','afterVersion','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','expectedVersion',...bodyKeys]} as const;
type Route=keyof typeof fields;
export function associationFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'ASSOCIATION_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;
}
// Only trusted composition can select this business. All routes share the
// existing committed ordinary admission budget with authentication/settings.
export function createAssociationHttp(config:Configuration,provider:Parameters<typeof createVehicleAssociationDirectory>[1],tokens:Parameters<typeof createVehicleAssociationDirectory>[2]){
  if(!uuid(config.businessId))throw new Error('ASSOCIATION_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const directory=createVehicleAssociationDirectory(config,provider,tokens),context=createBusinessSettingsContextReader(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let submitted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
      const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
      if(url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return associationFailureResponse(404);
      if(request.method!=='POST')return associationFailureResponse(405);
      protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
      const input=await readFlatJsonBody(bounded,fields[route]);
      let command:ReturnType<typeof parseAssociationSave>|undefined;
      if(route==='save')command=parseAssociationSave({schemaVersion:input.schemaVersion,businessId,operationId:input.operationId,recoveryEpoch:input.recoveryEpoch,expectedVersion:input.expectedVersion,body:Object.fromEntries(bodyKeys.map(k=>[k,input[k]]))});
      if(route==='context')check(uuid(input.vehicleId));
      if(route==='operation')check(uuid(input.operationId));
      if(route==='list')check(uuid(input.vehicleId)&&(input.afterId===null||uuid(input.afterId))&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
      if(route==='history')check(uuid(input.associationId)&&['0','1','2'].includes(input.afterVersion as string)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=20);
      const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'ASSOCIATION_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
      if(signal.aborted)throw new Error();let result:object;
      if(route==='context'){
        // crm.manage is checked by the same fresh typed read as the directory.
        // Context is advisory: the save always rechecks the exact pinned epoch.
        await directory.list(cookie,{businessId,vehicleId:input.vehicleId as string,afterId:null,pageSize:1},signal);
        const value=(await context(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,vehicleId:input.vehicleId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.vehicle.association.edit.v1\0').update(businessId).update('\0').update(input.vehicleId as string).update('\0').update(sessionId).digest('base64url'));return response;
      }
      if(route==='save'){
        submitted=true;
        const value=(await directory.save(cookie,command!,signal)).forServer();
        if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
      }
      if(route==='operation')result=(await directory.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();
      else if(route==='history')result=(await directory.history(cookie,{businessId,associationId:input.associationId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer();
      else result=(await directory.list(cookie,{businessId,vehicleId:input.vehicleId as string,afterId:input.afterId as string|null,pageSize:input.pageSize as number},signal)).forServer();
      if(signal.aborted)throw new Error();return privateJsonResponse(result);
    }catch(error){
      if(submitted&&error instanceof AssociationDirectoryError){
        if(error.message==='ASSOCIATION_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='ASSOCIATION_SAVE_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      if(submitted)return privateJsonResponse({error:'ASSOCIATION_SAVE_OUTCOME_UNKNOWN'},503);
      return associationFailureResponse(workStarted?503:400);
    }
  };
}
