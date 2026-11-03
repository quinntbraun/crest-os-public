import 'server-only';
import {parseQuoteAmendmentTargetsRequest} from './quote-amendment-targets.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody,readNestedJsonBody} from '../security/private-http.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {quoteId,quoteBodyLimit} from './quote-storage-contract.ts';
import {parseQuoteAmendmentDraft,parseQuoteAmendmentDraftReference} from './quote-amendment-contract.ts';
import {parseQuoteAmendmentSend,parseQuoteAmendmentSendReference} from './quote-amendment-sharing-contract.ts';
import {parseQuoteAmendmentReadRequest,quoteAmendmentReadToWire} from './quote-amendment-read.ts';
import {createQuoteAmendmentDirectory,QuoteAmendmentDirectoryError} from './quote-amendment-directory.ts';
const prefix='/api/business/quotes/amendments/';
const fields={
 targets:['familyId','search','afterId','pageSize'],
 create:['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash','content'],
 send:['schemaVersion','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','sendId','approvalId','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash','body'],
 read:['familyId','revisionId','afterVersion','pageSize'],
 'draft-operation':['reference'],'send-operation':['reference']
} as const;
type Route=keyof typeof fields;
type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export function quoteAmendmentFailureResponse(status:400|404|405|503=400){const response=privateJsonResponse({error:'QUOTE_AMENDMENT_REQUEST_FAILED'},status);if(status===405)response.headers.set('Allow','POST');return response;}
// Separate synthetic-only opt-in, closed by default. Registered52 preparation
// uses the normal authenticated server; production activation remains refused.
export function createQuoteAmendmentHttp(config:Configuration,provider:Parameters<typeof createQuoteAmendmentDirectory>[1],tokens:Parameters<typeof createQuoteAmendmentDirectory>[2],enabled=false){
 if(!quoteId(config.businessId)||typeof enabled!=='boolean'||enabled&&config.environment==='production')throw Error('QUOTE_AMENDMENT_HTTP_CONFIGURATION_REQUIRED');
 const businessId=config.businessId,resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createQuoteAmendmentDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>):Promise<Response>=>{
  let submitted=false,workStarted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(prefix.length) as Route;if(!enabled||url.search||url.hash||!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route))return quoteAmendmentFailureResponse(404);
   if(request.method!=='POST')return quoteAmendmentFailureResponse(405);protect.requireOrigin(request);
   const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const input=route==='read'||route==='targets'?await readFlatJsonBody(bounded,fields[route]):await readNestedJsonBody(bounded,fields[route],route==='create'?quoteBodyLimit:route==='send'?65536:4096);
   const targets=route==='targets'?parseQuoteAmendmentTargetsRequest({...input,businessId}):undefined;const create=route==='create'?parseQuoteAmendmentDraft({...input,businessId}):undefined,send=route==='send'?parseQuoteAmendmentSend({...input,businessId}):undefined,read=route==='read'?parseQuoteAmendmentReadRequest({...input,businessId}):undefined,reference=route==='draft-operation'?parseQuoteAmendmentDraftReference(input.reference):route==='send-operation'?parseQuoteAmendmentSendReference(input.reference):undefined;
   await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const response=privateJsonResponse({error:'QUOTE_AMENDMENT_REQUEST_LIMITED'},429);response.headers.set('Retry-After','60');return response;}if(signal.aborted)throw Error();
   if(route==='create'||route==='send'){submitted=true;const value=(route==='create'?await directory!.create(cookie,create!,signal):await directory!.send(cookie,send!,signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value,value.state==='conflict'?409:200);}
   if(route==='targets'){const value=(await directory!.targets(cookie,targets!,signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value);}
   if(route==='read'){const value=(await directory!.read(cookie,read!,signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(quoteAmendmentReadToWire(value));}
   const value=(route==='draft-operation'?await directory!.lookupDraft(cookie,{businessId,reference},signal):await directory!.lookupSend(cookie,{businessId,reference},signal)).forServer();if(signal.aborted)throw Error();return privateJsonResponse(value);
  }catch(error){
   if(submitted&&error instanceof QuoteAmendmentDirectoryError){if(error.message==='QUOTE_AMENDMENT_NOT_SUBMITTED')return privateJsonResponse({error:error.message},503);if(error.message==='QUOTE_AMENDMENT_DENIED')return privateJsonResponse({error:error.message},403);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}
   if(submitted)return privateJsonResponse({error:'QUOTE_AMENDMENT_OUTCOME_UNKNOWN'},503);return quoteAmendmentFailureResponse(workStarted?503:400);
  }
 };
}
