import 'server-only';
import {createHash} from 'node:crypto';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createRequestProtection} from '../security/request-protection.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody,readNestedJsonBody} from '../security/private-http.ts';
import {createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {parseOriginalOperationLookupWire} from '../security/original-operation-http-contract.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {customerUuid,customerVersion} from '../customer/customer-contract.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import {parseSchedulingOriginal} from './scheduling-original-contract.ts';
import {createBookingDirectory,BookingDirectoryError} from './confirmed-booking-directory.ts';
import {createFulfillmentModeDirectory,FulfillmentModeDirectoryError} from './fulfillment-mode-directory.ts';
import {requireBooking as check} from './confirmed-booking-contract.ts';
import {parseBookJobCommand,parseCancelJobCommand} from './amended-booking-contract.ts';
import {parseChangeJobScheduleSave} from './confirmed-reschedule-contract.ts';
import {parseFulfillmentModeSave} from './fulfillment-mode-contract.ts';
import {parseJobListRequest,parseJobHistoryRequest} from './confirmed-job-read-contract.ts';
import {parseBookingConflictRequest} from './booking-conflict-review-contract.ts';
import {parsePendingChangesRequest} from './booking-context-contract.ts';
import {createFieldDirectory,FieldDirectoryError} from './field-directory.ts';
import {parseFieldSessionSave} from './field-session-contract.ts';
import {createCompletionDirectory,CompletionDirectoryError} from './work-completion-directory.ts';
import {parseCompletionSave} from './work-completion-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/scheduling/';
const fields={'completion-context':['jobId'],complete:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],'field-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],'slot-review':['schemaVersion','operatorId','rescheduledJobId','startAt','endAt','travelBeforeSeconds','travelAfterSeconds'],original:['originalJson'],workspace:[],agreement:['familyId'],resources:['jobId'],pending:['afterCreatedAt','afterAppointmentId','pageSize'],list:['from','until','afterStart','afterJob','pageSize'],read:['jobId'],history:['jobId','throughVersion','afterVersion','pageSize'],'mode-history':['afterSequence','pageSize'],'mode-save':['schemaVersion','operationId','recoveryEpoch','expectedSequence','payload'],book:['schemaVersion','operationId','recoveryEpoch','jobId','expectedModeSequence','payload'],cancel:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','payload'],reschedule:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','payload']} as const;
type Route=keyof typeof fields;
const mutation=(route:Route)=>['mode-save','book','cancel','reschedule','field-save','complete'].includes(route);
function failed(status:400|404|405|503){const r=privateJsonResponse({error:'SCHEDULING_REQUEST_FAILED'},status);if(status===405)r.headers.set('Allow','POST');return r;}
export function schedulingFailureResponse(status:400|404|405|503=400){return failed(status);}
// Synthetic construction only. Ordinary application composition stays closed
// until coordinated migration/source/recovery and browser release acceptance.
export function createSchedulingHttp(config:Configuration,provider:Parameters<typeof createBookingDirectory>[1],tokens:Parameters<typeof createBookingDirectory>[2],enabled=false,amendedEnabled=false,fieldEnabled=false,completionEnabled=false){
 if(typeof fieldEnabled!=='boolean'||fieldEnabled&&(!enabled||!amendedEnabled))throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof completionEnabled!=='boolean'||completionEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(!customerUuid(config.businessId)||typeof enabled!=='boolean'||typeof amendedEnabled!=='boolean'||amendedEnabled&&!enabled||enabled&&config.environment!=='test')throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createBookingDirectory(config,provider,tokens,amendedEnabled):undefined,modes=enabled?createFulfillmentModeDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined,businessId=config.businessId,fieldDirectory=fieldEnabled?createFieldDirectory(config,provider,tokens):undefined;
 const completion=completionEnabled?createCompletionDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{let workStarted=false,submitted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();resolve(request,peer);const url=new URL(request.url);
   const route=url.pathname.slice(prefix.length) as Route;if(!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route)||url.search||url.hash)return failed(404);if(request.method!=='POST')return failed(405);if(route==='field-save'&&!fieldDirectory)return failed(503);if(!directory||!modes||!context)return failed(503);
   if((route==='completion-context'||route==='complete')&&!completion)return failed(503);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const input=mutation(route)?await readNestedJsonBody(bounded,fields[route],131072):await readFlatJsonBody(bounded,fields[route],16384);
   const fieldSave=route==='field-save'?parseFieldSessionSave({...input,businessId}):undefined;
   const completionSave=route==='complete'?parseCompletionSave({...input,businessId}):undefined;
   const original=route==='original'?parseSchedulingOriginal(parseOriginalOperationLookupWire(input,businessId)):undefined;
   const book=route==='book'?parseBookJobCommand({...input,businessId}):undefined,cancel=route==='cancel'?parseCancelJobCommand({...input,businessId}):undefined,reschedule=route==='reschedule'?parseChangeJobScheduleSave({...input,businessId}):undefined,mode=route==='mode-save'?parseFulfillmentModeSave({...input,businessId}):undefined;
   if(!amendedEnabled&&(book?.schemaVersion===2||cancel?.schemaVersion===2))throw Error();
   const slotReview=route==='slot-review'?parseBookingConflictRequest({...input,businessId}):undefined;
   const list=route==='list'?parseJobListRequest({...input,businessId}):undefined,history=route==='history'?parseJobHistoryRequest({...input,businessId}):undefined,pending=route==='pending'?parsePendingChangesRequest({...input,businessId}):undefined;
   if(route==='agreement')check(customerUuid(input.familyId));if(route==='resources'||route==='read'||route==='completion-context')check(customerUuid(input.jobId));if(route==='mode-history')check(customerVersion(input.afterSequence,true)&&typeof input.pageSize==='number'&&Number.isInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);
   const sessionId=await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const r=privateJsonResponse({error:'SCHEDULING_REQUEST_LIMITED'},429);r.headers.set('Retry-After','60');return r;}check(!signal.aborted);
   if(route==='workspace'){const workspace=(await directory.workspace(cookie,businessId,signal)).forServer(),authority=(await context(cookie,businessId,signal)).forServer();check(!signal.aborted);const response=privateJsonResponse({...workspace,writeState:authority.writeState,recoveryEpoch:authority.recoveryEpoch});response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.scheduling.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));if(amendedEnabled)response.headers.set('X-Crest-Amended-Scheduling','1');if(fieldEnabled)response.headers.set('X-Crest-Field-Session','1');if(completionEnabled)response.headers.set('X-Crest-Job-Completion','1');return response;}
   let result:object;
   if(route==='field-save'){check(fieldDirectory);submitted=true;result=(await fieldDirectory.saveSession(cookie,fieldSave!,signal)).forServer();}
   else if(route==='completion-context'){check(completion);result=(await completion.context(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='complete'){check(completion&&completionSave);submitted=true;result=(await completion.complete(cookie,completionSave,signal)).forServer();}
   else if(route==='book'){submitted=true;result=(await directory.book(cookie,book!,signal)).forServer();}
   else if(route==='cancel'){submitted=true;result=(await directory.cancel(cookie,cancel!,signal)).forServer();}
   else if(route==='reschedule'){submitted=true;result=(await directory.reschedule(cookie,reschedule!,signal)).forServer();}
   else if(route==='mode-save'){submitted=true;result=(await modes.save(cookie,mode!,signal)).forServer();}
   else if(route==='original')result=(await directory.lookupOriginal(cookie,original!,signal)).forServer();
   else if(route==='slot-review')result=(await directory.reviewSlot(cookie,slotReview!,signal)).forServer();
   else if(route==='agreement')result=(await directory.agreement(cookie,{businessId,familyId:input.familyId as string},signal)).forServer();
   else if(route==='resources')result=(await directory.resources(cookie,{businessId,jobId:input.jobId as string},signal)).forServer();
   else if(route==='pending')result=(await directory.pending(cookie,pending!,signal)).forServer();
   else if(route==='list')result=(await directory.list(cookie,list!,signal)).forServer();
   else if(route==='read')result=(await directory.read(cookie,{businessId,jobId:input.jobId as string},signal)).forServer();
   else if(route==='history')result=(await directory.history(cookie,history!,signal)).forServer();
   else result=(await modes.history(cookie,{businessId,afterSequence:input.afterSequence as string,pageSize:input.pageSize as number},signal)).forServer();
   check(!signal.aborted&&Buffer.byteLength(JSON.stringify(result))<=(route==='agreement'||route==='resources'?4194304:1048576));return privateJsonResponse(result,'state' in result&&result.state==='conflict'?409:200);
  }catch(error){if(submitted&&(error instanceof BookingDirectoryError||error instanceof FulfillmentModeDirectoryError||error instanceof FieldDirectoryError||error instanceof CompletionDirectoryError)){if(error.message.endsWith('_SAVE_NOT_SUBMITTED'))return privateJsonResponse({error:'SCHEDULING_SAVE_NOT_SUBMITTED'},503);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}return submitted?privateJsonResponse({error:'SCHEDULING_SAVE_OUTCOME_UNKNOWN'},503):failed(workStarted?503:400);}
 };
}
