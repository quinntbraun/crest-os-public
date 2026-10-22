import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from './trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from './trusted-transport.ts';
import {createRequestProtection} from './request-protection.ts';
import {readBrowserCookies} from './browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from './private-http.ts';
import {createSessionCsrfVerifier} from './session-request-guard.ts';
import {createSessionRequestAdmission} from './session-request-admission.ts';
import {createBusinessNameCommand,BusinessNameCommandError} from './business-name-command.ts';
import {createBusinessSettingsContextReader} from './business-settings-context.ts';
import {createBusinessOperationLookup} from './business-operation-lookup.ts';
import type {SessionDatabaseConfiguration} from './session-database.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const paths=new Set(['/api/business/settings','/api/business/rename','/api/business/operation']);
export function businessFailureResponse(status:400|404|405|503=400):Response{
  const response=privateJsonResponse({error:'BUSINESS_REQUEST_FAILED'},status);
  if(status===405)response.headers.set('Allow','POST');return response;
}
// Only explicit trusted runtime configuration selects the provisioned business.
// No browser-selected actor, tenant, capability, timestamps or SQL callback.
export function createBusinessHttp(config:Configuration,provider:Parameters<typeof createBusinessNameCommand>[1],tokens:Parameters<typeof createBusinessNameCommand>[2]){
  if(typeof config.businessId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(config.businessId))throw new Error('BUSINESS_HTTP_CONFIGURATION_REQUIRED');
  const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
  const rename=createBusinessNameCommand(config,provider,tokens),settings=createBusinessSettingsContextReader(config,provider,tokens),lookup=createBusinessOperationLookup(config,provider,tokens);
  return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
    let renameStarted=false,workStarted=false;
    try{
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);
      if(signal.aborted)throw new Error();resolve(request,peer);const url=new URL(request.url);
      if(url.search||url.hash||!paths.has(url.pathname))return businessFailureResponse(404);
      if(request.method!=='POST')return businessFailureResponse(405);
      protect.requireOrigin(request);
      const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;
      if(!cookie)throw new Error();
      const input=await readFlatJsonBody(bounded,url.pathname==='/api/business/settings'?[]:url.pathname==='/api/business/operation'?['operationId']:
        ['schemaVersion','operationId','recoveryEpoch','expectedVersion','legalName']);
      const sessionId=await csrf(bounded,cookie,signal);
      // A separate committed reservation precedes all SDK/domain work. It is
      // shared with proof reissue/other business routes, never refunded on error.
      workStarted=true;
      if(!await admit(cookie,'ordinary',signal)){
        const response=privateJsonResponse({error:'BUSINESS_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;
      }
      if(signal.aborted)throw new Error();
      if(url.pathname==='/api/business/settings'){
        const value=(await settings(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
        const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,legalName:value.legalName,businessVersion:value.businessVersion,
          writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});
        // Non-authorizing scope marker for a per-tab pending intent. Neither a
        // credential digest nor the session UUID, and never accepted as proof.
        response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.business.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));
        return response;
      }
      if(url.pathname==='/api/business/operation'){
        const value=(await lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();if(signal.aborted)throw new Error();
        if(value.state==='absent')return privateJsonResponse({state:'absent'});
        return privateJsonResponse({state:'committed',operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
          receipt:{schemaVersion:value.receipt.schemaVersion,businessId:value.receipt.businessId,businessVersion:value.receipt.businessVersion,auditEventId:value.receipt.auditEventId}});
      }
      renameStarted=true;
      const value=(await rename(cookie,{...input,businessId} as Parameters<typeof rename>[1],signal)).forServer();if(signal.aborted)throw new Error();
      if(value.state==='conflict')return privateJsonResponse(value.reason==='version'?{state:'conflict',reason:'version',currentVersion:value.currentVersion}:{state:'conflict',reason:'operation'},409);
      return privateJsonResponse({state:'committed',operationId:value.operationId,recoveryEpoch:value.recoveryEpoch,
        receipt:{schemaVersion:value.receipt.schemaVersion,businessId:value.receipt.businessId,businessVersion:value.receipt.businessVersion,auditEventId:value.receipt.auditEventId}});
    }catch(error){
      if(error instanceof BusinessNameCommandError){
        if(error.message==='BUSINESS_RENAME_INPUT_REQUIRED')return privateJsonResponse({error:error.message},400);
        if(error.message==='BUSINESS_RENAME_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);
        if(error.message==='BUSINESS_RENAME_DENIED')return privateJsonResponse({error:error.message},403);
        if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);
      }
      // Includes post-commit projection/delivery cancellation. Never relabel a
      // possible submission as failed/not-submitted or create a replacement ID.
      if(renameStarted)return privateJsonResponse({error:'BUSINESS_RENAME_OUTCOME_UNKNOWN'},503);
      return businessFailureResponse(workStarted?503:400);
    }
  };
}
