import 'server-only';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {createQuoteReviewDirectory,QuoteReviewDirectoryError} from './quote-review-directory.ts';
import {parseQuoteReviewSubmit,parseQuoteReviewApprove,requireQuoteReview as check} from './quote-review-contract.ts';
import {quoteId} from './quote-storage-contract.ts';
const prefix='/api/business/quotes/review/';
const common=['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash'] as const;
const fields={read:['familyId','revisionId'],submit:common,approve:[...common,'approvalId','extremeAcknowledged'],operation:['operationId']} as const;
type Route=keyof typeof fields;
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function quoteReviewFailureResponse(status:400|404|405|503=400){const response=privateJsonResponse({error:'QUOTE_REVIEW_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
// Construction stays closed until the separate review release/source gates.
export function createQuoteReviewHttp(config:Configuration,provider:Parameters<typeof createQuoteReviewDirectory>[1],tokens:Parameters<typeof createQuoteReviewDirectory>[2],enabled=false){
 if(!quoteId(config.businessId)||typeof enabled!=='boolean')throw Error('QUOTE_REVIEW_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createQuoteReviewDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let submitted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw new Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return quoteReviewFailureResponse(404);
   if(request.method!=='POST')return quoteReviewFailureResponse(405);protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw new Error();const input=await readFlatJsonBody(bounded,fields[route]);
   const submit=route==='submit'?parseQuoteReviewSubmit({...input,businessId}):undefined,approval=route==='approve'?parseQuoteReviewApprove({...input,businessId}):undefined;
   const command=submit??approval;if(command)check(BigInt(command.expectedContentVersion)<=BigInt(command.expectedRevisionVersion));
   if(route==='read')check(quoteId(input.familyId)&&quoteId(input.revisionId));if(route==='operation')check(quoteId(input.operationId));
   await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'QUOTE_REVIEW_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}if(signal.aborted)throw new Error();
   if(route==='submit'||route==='approve'){
    submitted=true;const value=(route==='submit'?await directory!.submit(cookie,submit!,signal):await directory!.approve(cookie,approval!,signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value,value.state==='conflict'?409:200);
   }
   const value=(route==='read'?await directory!.read(cookie,{businessId,familyId:input.familyId as string,revisionId:input.revisionId as string},signal):await directory!.lookup(cookie,{businessId,operationId:input.operationId as string},signal)).forServer();if(signal.aborted)throw new Error();return privateJsonResponse(value);
  }catch(error){
   if(submitted&&error instanceof QuoteReviewDirectoryError){if(error.message==='QUOTE_REVIEW_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='QUOTE_REVIEW_DENIED')return privateJsonResponse({error:error.message},403);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}
   if(submitted)return privateJsonResponse({error:'QUOTE_REVIEW_OUTCOME_UNKNOWN'},503);return quoteReviewFailureResponse(workStarted?503:400);
  }
 };
}
