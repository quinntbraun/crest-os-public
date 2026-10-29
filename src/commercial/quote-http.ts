import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody,readNestedJsonBody} from '../security/private-http.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createQuoteDirectory,QuoteDirectoryError} from './quote-directory.ts';
import {quoteId,quoteVersion,quoteBodyLimit,quoteHistoryPageLimit,requireQuoteStorage as check,parseQuoteSave} from './quote-storage-contract.ts';
const prefix='/api/business/quotes/';
const fields={context:[],list:['search','afterId','pageSize'],history:['familyId','revisionId','afterVersion','pageSize'],operation:['operationId'],save:['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','content']} as const;
type Route=keyof typeof fields;
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function quoteFailureResponse(status:400|404|405|503=400){const r=privateJsonResponse({error:'QUOTE_REQUEST_FAILED'},status);if(status===405)r.headers.set('Allow','POST');return r;}
// Default closed construction. Source/recovery/adoption must precede wiring.
export function createQuoteHttp(config:Configuration,provider:Parameters<typeof createQuoteDirectory>[1],tokens:Parameters<typeof createQuoteDirectory>[2],enabled=false,reviewAvailable=false){
 if(!quoteId(config.businessId)||(typeof enabled!=='boolean'||typeof reviewAvailable!=='boolean'||reviewAvailable&&!enabled))throw Error('QUOTE_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config);
 const directory=enabled?createQuoteDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let submitted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;
   if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return quoteFailureResponse(404);
   if(request.method!=='POST')return quoteFailureResponse(405);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();
   const input=route==='save'?await readNestedJsonBody(bounded,fields.save,quoteBodyLimit):await readFlatJsonBody(bounded,fields[route]);
   const command=route==='save'?parseQuoteSave({...input,businessId}):undefined;
   if(route==='operation')check(quoteId(input.operationId));
   if(route==='list')check(typeof input.search==='string'&&[...input.search].length<=200&&(input.afterId===null||quoteId(input.afterId))&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=50);
   if(route==='history')check(quoteId(input.familyId)&&quoteId(input.revisionId)&&quoteVersion(input.afterVersion,true)&&Number.isSafeInteger(input.pageSize)&&Number(input.pageSize)>=1&&Number(input.pageSize)<=quoteHistoryPageLimit);
   const sessionId=await csrf(bounded,cookie,signal);workStarted=true;
   if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'QUOTE_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}
   if(signal.aborted)throw new Error();
   if(route==='context'){
    await directory!.list(cookie,{businessId,search:'',afterId:null,pageSize:1},signal);const value=(await context!(cookie,businessId,signal)).forServer();if(signal.aborted)throw new Error();
    const response=privateJsonResponse({schemaVersion:value.schemaVersion,businessId:value.businessId,writeState:value.writeState,recoveryEpoch:value.recoveryEpoch});if(reviewAvailable)response.headers.set('X-Crest-Quote-Review','1');response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.quote.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));return response;
   }
   if(route==='save'){submitted=true;const value=(await directory!.save(cookie,command!,signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);}
   const value=route==='operation'?(await directory!.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer()
    :route==='history'?(await directory!.history(cookie,{businessId,familyId:input.familyId as string,revisionId:input.revisionId as string,afterVersion:input.afterVersion as string,pageSize:input.pageSize as number},signal)).forServer()
    :(await directory!.list(cookie,{businessId,search:input.search as string,afterId:input.afterId as string|null,pageSize:input.pageSize as number},signal)).forServer();
   if(signal.aborted)throw new Error();return privateJsonResponse(value);
  }catch(error){
   if(submitted&&error instanceof QuoteDirectoryError){if(error.message==='QUOTE_SAVE_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='QUOTE_SAVE_DENIED')return privateJsonResponse({error:error.message},403);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}
   if(submitted)return privateJsonResponse({error:'QUOTE_SAVE_OUTCOME_UNKNOWN'},503);return quoteFailureResponse(workStarted?503:400);
  }
 };
}
