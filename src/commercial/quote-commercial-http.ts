import 'server-only';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody,readNestedJsonBody} from '../security/private-http.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createQuoteCommercialDirectory,QuoteCommercialDirectoryError} from './quote-commercial-directory.ts';
import {parseQuoteManualSend,parseQuoteConfirmationAccept,requireQuoteCommercial as check} from './quote-commercial-contract.ts';
import {quoteId,quoteBodyLimit} from './quote-storage-contract.ts';
import {parseQuoteReplacement} from './quote-replacement-contract.ts';
import {createQuoteReplacementDirectory,QuoteReplacementDirectoryError} from './quote-replacement-directory.ts';
const prefix='/api/business/quotes/commercial/';
const common=['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash'] as const;
const fields={read:['familyId','revisionId'],send:[...common,'sendId','approvalId','body'],accept:[...common,'acceptanceId','agreementId','body'],operation:['operationId'],replacement:['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','content']} as const;
type Route=keyof typeof fields;
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function quoteCommercialFailureResponse(status:400|404|405|503=400){const response=privateJsonResponse({error:'QUOTE_COMMERCIAL_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
// Separate construction opt-in; approval is not sharing and manual confirmation
// never sends a message, signs a customer contract, or moves money.
export function createQuoteCommercialHttp(config:Configuration,provider:Parameters<typeof createQuoteCommercialDirectory>[1],tokens:Parameters<typeof createQuoteCommercialDirectory>[2],enabled=false){
 if(!quoteId(config.businessId)||typeof enabled!=='boolean')throw Error('QUOTE_COMMERCIAL_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createQuoteCommercialDirectory(config,provider,tokens):undefined,replacements=enabled?createQuoteReplacementDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let submitted=false,workStarted=false,isReplacement=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return quoteCommercialFailureResponse(404);
   isReplacement=route==='replacement';if(request.method!=='POST')return quoteCommercialFailureResponse(405);protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const input=route==='send'||route==='accept'||route==='replacement'?await readNestedJsonBody(bounded,fields[route],route==='replacement'?quoteBodyLimit:65536):await readFlatJsonBody(bounded,fields[route]);
   const replacement=route==='replacement'?parseQuoteReplacement({...input,businessId}):undefined;
   const send=route==='send'?parseQuoteManualSend({...input,businessId}):undefined,accept=route==='accept'?parseQuoteConfirmationAccept({...input,businessId}):undefined;
   if(route==='read')check(quoteId(input.familyId)&&quoteId(input.revisionId));if(route==='operation')check(quoteId(input.operationId));
   await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:isReplacement?'QUOTE_REPLACEMENT_REQUEST_LIMITED':'QUOTE_COMMERCIAL_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}if(signal.aborted)throw Error();
   if(route==='send'||route==='accept'||route==='replacement'){
    submitted=true;const value=(route==='replacement'?await replacements!.create(cookie,replacement!,signal):route==='send'?await directory!.send(cookie,send!,signal):await directory!.accept(cookie,accept!,signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
   }
   const value=(route==='read'?await directory!.read(cookie,{businessId,familyId:input.familyId as string,revisionId:input.revisionId as string},signal):await directory!.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value);
  }catch(error){
   if(submitted&&error instanceof QuoteReplacementDirectoryError){if(error.message==='QUOTE_REPLACEMENT_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='QUOTE_REPLACEMENT_DENIED')return privateJsonResponse({error:error.message},403);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}
   if(submitted&&error instanceof QuoteCommercialDirectoryError){if(error.message==='QUOTE_COMMERCIAL_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='QUOTE_COMMERCIAL_DENIED')return privateJsonResponse({error:error.message},403);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}
   if(submitted)return privateJsonResponse({error:isReplacement?'QUOTE_REPLACEMENT_OUTCOME_UNKNOWN':'QUOTE_COMMERCIAL_OUTCOME_UNKNOWN'},503);return quoteCommercialFailureResponse(workStarted?503:400);
  }
 };
}
