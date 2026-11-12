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
import {parseCollectionCursor} from './dropoff-collection-contract.ts';
import {createCompletionDirectory,CompletionDirectoryError} from './work-completion-directory.ts';
import {parseCompletionSave} from './work-completion-contract.ts';
import {createMileageDirectory,MileageDirectoryError} from './mileage-directory.ts';
import {parseMileageSave,parseMileageTripQuery} from './mileage.ts';
import {parseMileageHistoryQuery} from './mileage-history.ts';
import {createSupportTripDirectory,SupportTripDirectoryError} from './support-trip-directory.ts';
import {parseSupportTripHistoryQuery,parseSupportTripListQuery,parseSupportTripSave} from './support-trip.ts';
import {parseTripInterruptionSave} from './trip-interruption-contract.ts';
import {parseUnfulfilledCancellationSave} from './unfulfilled-cancellation-contract.ts';
import {parseWorkBoundarySave,workBoundaryKind} from './job-work-boundary-contract.ts';
import {parseWorkStartSave,workStartKind} from './job-work-start-contract.ts';
import {parseWorkEndSave,workEndKind} from './job-work-end-contract.ts';
import {parseMobileDepartureSave,mobileDepartureKind} from './mobile-departure-contract.ts';
import {parseReviewOutcomeSave,reviewOutcomeKind} from './review-message-contract.ts';

import {parseReviewHistoryQuery} from './review-message-history-contract.ts';
import {parsePickupCollectionSave,pickupCollectionKind,parsePickupPolicySave,pickupPolicyKind} from './pickup-custody-contract.ts';
import {parsePickupTripCursor,parsePickupTripSave,pickupTripKind} from './pickup-trip-contract.ts';
import {dropoffCustodyKind,dropoffPolicyKind,dropoffPolicyRevisionKind,parseDropoffCustodySave,
 parseDropoffPolicySave,parseDropoffPolicyRevision} from './dropoff-custody-contract.ts';
import {maintenanceFollowUpKind,parseMaintenanceFollowUpSave,parseMaintenanceFollowUpListQuery,
 parseMaintenanceFollowUpHistoryQuery} from './maintenance-follow-up-contract.ts';

type Configuration=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
const prefix='/api/business/scheduling/';
const fields={'mileage-trips':['jobId','afterDepartedAt','afterLegId','pageSize'],
 'support-trips':['afterDepartedAt','afterLegId','pageSize'],
 'support-trip-history':['legId','afterVersion','throughVersion','pageSize'],
 'support-trip-mileage':['legId'],
 'pickup-policy':['beforeSequence'],
 'pickup-policy-save':['schemaVersion','operationId','recoveryEpoch','expectedSequence','body'],
 'pickup-collection':['jobId','jobVehicleId'],
 'pickup-collection-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','jobVehicleId','pickupLegVersionId','policyId','body'],
 'pickup-trips':['jobId','beforeDepartedAt','beforeLegId'],
 'pickup-trip-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','legId','expectedLegVersionId','body'],
 'interrupt':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],
 'unfulfilled-context':['jobId'],
 'work-time':['jobId'],
 'work-start':['jobId'],
 'work-start-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','workVersionId','arrivalVersionId','body'],
 'work-end':['jobId'],
 'work-end-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','workVersionId','completionEventId','body'],
 'mobile-departure':['jobId','legId'],
 'mobile-departure-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','legId','legVersionId','departureEventId','body'],
 'review-outcome':['jobId'],
 'review-history':['scopeKind','scopeId','cursorSource','cursorId'],
 'custody-policy':['modeVersionId'],
 'custody-policy-save':['schemaVersion','operationId','recoveryEpoch','modeVersionId','body'],
 'custody-policy-revise':['schemaVersion','operationId','recoveryEpoch','modeVersionId','policyId','body'],
 'custody-context':['jobId','jobVehicleId'],
 'custody-collections':['afterReceivedAt','afterCaseId'],
 'custody-save':['schemaVersion','operationId','recoveryEpoch','jobVehicleId','caseId','expectedVersion','body'],
 'maintenance-list':['scopeKind','scopeId','throughAt','afterDueAt','afterTaskId'],
 'maintenance-history':['taskId','afterVersion'],
 'maintenance-save':['schemaVersion','operationId','recoveryEpoch','taskId','expectedVersion','body'],
 'review-outcome-save':['schemaVersion','operationId','recoveryEpoch','jobId','messageId','priorEventId','body'],
 'work-boundary-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','leftVersionId','rightVersionId','body'],
 'cancel-unfulfilled':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],
 'support-trip-save':['schemaVersion','operationId','recoveryEpoch','legId','expectedLegVersionId','body'],
 'mileage-history':['legId','afterVersion','throughVersion','pageSize'],
 'mileage-save':['schemaVersion','operationId','recoveryEpoch','legId','expectedLegVersionId','expectedEvidenceVersion','body'],
 'completion-context':['jobId'],complete:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],'field-save':['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','body'],'slot-review':['schemaVersion','operatorId','rescheduledJobId','startAt','endAt','travelBeforeSeconds','travelAfterSeconds'],original:['originalJson'],workspace:[],agreement:['familyId'],resources:['jobId'],pending:['afterCreatedAt','afterAppointmentId','pageSize'],list:['from','until','afterStart','afterJob','pageSize'],read:['jobId'],history:['jobId','throughVersion','afterVersion','pageSize'],'mode-history':['afterSequence','pageSize'],'mode-save':['schemaVersion','operationId','recoveryEpoch','expectedSequence','payload'],book:['schemaVersion','operationId','recoveryEpoch','jobId','expectedModeSequence','payload'],cancel:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','payload'],reschedule:['schemaVersion','operationId','recoveryEpoch','jobId','expectedJobVersion','payload']} as const;
type Route=keyof typeof fields;
const mutation=(route:Route)=>['mode-save','book','cancel','reschedule','field-save','complete','mileage-save','support-trip-save','pickup-trip-save','pickup-collection-save','pickup-policy-save','interrupt','cancel-unfulfilled','work-boundary-save','work-start-save','work-end-save','mobile-departure-save','review-outcome-save','maintenance-save','custody-save','custody-policy-save','custody-policy-revise'].includes(route);
function failed(status:400|404|405|503){const r=privateJsonResponse({error:'SCHEDULING_REQUEST_FAILED'},status);if(status===405)r.headers.set('Allow','POST');return r;}
export function schedulingFailureResponse(status:400|404|405|503=400){return failed(status);}
// Synthetic construction only. Ordinary application composition stays closed
// until coordinated migration/source/recovery and browser release acceptance.
export function createSchedulingHttp(config:Configuration,provider:Parameters<typeof createBookingDirectory>[1],tokens:Parameters<typeof createBookingDirectory>[2],enabled=false,amendedEnabled=false,fieldEnabled=false,completionEnabled=false,mileageEnabled=false,supportTripsEnabled=false,unfulfilledCancellationEnabled=false,workTimeEnabled=false,workBoundaryEnabled=false,workStartEnabled=false,workEndEnabled=false,mobileDepartureEnabled=false,reviewOutcomeEnabled=false,reviewHistoryEnabled=false,maintenanceEnabled=false,custodyEnabled=false,policyRevisionEnabled=false,pickupTripsEnabled=false,pickupCollectionEnabled=false,pickupPolicyEnabled=false,pickupPhotosEnabled=false){
 if(typeof pickupPhotosEnabled!=='boolean'||pickupPhotosEnabled&&!pickupPolicyEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof pickupPolicyEnabled!=='boolean'||pickupPolicyEnabled&&!pickupCollectionEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof pickupCollectionEnabled!=='boolean'||pickupCollectionEnabled&&!pickupTripsEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof pickupTripsEnabled!=='boolean'||pickupTripsEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof fieldEnabled!=='boolean'||fieldEnabled&&(!enabled||!amendedEnabled))throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof completionEnabled!=='boolean'||completionEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof mileageEnabled!=='boolean'||mileageEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof supportTripsEnabled!=='boolean'||supportTripsEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof unfulfilledCancellationEnabled!=='boolean'||unfulfilledCancellationEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof workTimeEnabled!=='boolean'||workTimeEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof workBoundaryEnabled!=='boolean'||workBoundaryEnabled&&!workTimeEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof workStartEnabled!=='boolean'||workStartEnabled&&!workBoundaryEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof workEndEnabled!=='boolean'||workEndEnabled&&(!workStartEnabled||!completionEnabled))throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof mobileDepartureEnabled!=='boolean'||mobileDepartureEnabled&&(!workEndEnabled||!mileageEnabled))throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof reviewOutcomeEnabled!=='boolean'||reviewOutcomeEnabled&&!completionEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof reviewHistoryEnabled!=='boolean'||reviewHistoryEnabled&&!reviewOutcomeEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof custodyEnabled!=='boolean'||custodyEnabled&&!fieldEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof policyRevisionEnabled!=='boolean'||policyRevisionEnabled&&!custodyEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(typeof maintenanceEnabled!=='boolean'||maintenanceEnabled&&!completionEnabled)throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 if(!customerUuid(config.businessId)||typeof enabled!=='boolean'||typeof amendedEnabled!=='boolean'||amendedEnabled&&!enabled||enabled&&config.environment!=='test')throw Error('SCHEDULING_HTTP_CONFIGURATION_REQUIRED');
 const resolve=createTrustedTransport(config),protect=createRequestProtection(config),csrf=createSessionCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=enabled?createBookingDirectory(config,provider,tokens,amendedEnabled):undefined,modes=enabled?createFulfillmentModeDirectory(config,provider,tokens):undefined,context=enabled?createBusinessSettingsContextReader(config,provider,tokens):undefined,businessId=config.businessId,fieldDirectory=fieldEnabled?createFieldDirectory(config,provider,tokens):undefined;
 const completion=completionEnabled?createCompletionDirectory(config,provider,tokens):undefined;
 const mileage=mileageEnabled?createMileageDirectory(config,provider,tokens):undefined;
 const supportTrips=supportTripsEnabled?createSupportTripDirectory(config,provider,tokens):undefined;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{let workStarted=false,submitted=false;
  try{
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);if(signal.aborted)throw Error();resolve(request,peer);const url=new URL(request.url);
   const route=url.pathname.slice(prefix.length) as Route;if(!url.pathname.startsWith(prefix)||!Object.hasOwn(fields,route)||url.search||url.hash)return failed(404);if(request.method!=='POST')return failed(405);if(route==='field-save'&&!fieldDirectory)return failed(503);if(!directory||!modes||!context)return failed(503);
   if((route==='completion-context'||route==='complete')&&!completion)return failed(503);
   if(route.startsWith('mileage-')&&!mileage)return failed(503);
   if(route.startsWith('support-trip')&&!supportTrips)return failed(503);
   if(route.startsWith('pickup-policy')&&!pickupPolicyEnabled)return failed(503);
   if(route.startsWith('pickup-collection')&&!pickupCollectionEnabled)return failed(503);
   if(route.startsWith('pickup-trip')&&!pickupTripsEnabled)return failed(503);
   if(route==='support-trip-mileage'&&!mileage)return failed(503);
   if(route==='interrupt'&&(!fieldDirectory||!mileage))return failed(503);
   if(route==='work-time'&&!workTimeEnabled)return failed(503);
   if(route==='work-boundary-save'&&!workBoundaryEnabled)return failed(503);
   if((route==='work-start'||route==='work-start-save')&&!workStartEnabled)return failed(503);
   if((route==='work-end'||route==='work-end-save')&&!workEndEnabled)return failed(503);
   if((route==='mobile-departure'||route==='mobile-departure-save')&&!mobileDepartureEnabled)return failed(503);
   if((route==='review-outcome'||route==='review-outcome-save')&&!reviewOutcomeEnabled)return failed(503);
   if(route==='review-history'&&!reviewHistoryEnabled)return failed(503);
   if(route.startsWith('custody-')&&!custodyEnabled)return failed(503);
   if(route==='custody-policy-revise'&&!policyRevisionEnabled)return failed(503);
   if(route.startsWith('maintenance-')&&!maintenanceEnabled)return failed(503);
   if((route==='unfulfilled-context'||route==='cancel-unfulfilled')&&!unfulfilledCancellationEnabled)return failed(503);
   protect.requireOrigin(request);const bounded=new Request(request,{signal}),cookie=readBrowserCookies(bounded.headers).session;if(!cookie)throw Error();
   const input=mutation(route)?await readNestedJsonBody(bounded,fields[route],131072):await readFlatJsonBody(bounded,fields[route],16384);
   const fieldSave=route==='field-save'?parseFieldSessionSave({...input,businessId}):undefined;
   if(fieldSave?.body.action==='start_dropoff'&&!custodyEnabled)return failed(503);
   const interruption=route==='interrupt'?parseTripInterruptionSave({...input,businessId}):undefined;
   const unfulfilled=route==='cancel-unfulfilled'?parseUnfulfilledCancellationSave({...input,businessId}):undefined;
   const boundary=route==='work-boundary-save'?parseWorkBoundarySave({...input,businessId}):undefined;
   const start=route==='work-start-save'?parseWorkStartSave({...input,businessId}):undefined;
   const end=route==='work-end-save'?parseWorkEndSave({...input,businessId}):undefined;
   const departure=route==='mobile-departure-save'?parseMobileDepartureSave({...input,businessId}):undefined;
   const reviewOutcome=route==='review-outcome-save'?parseReviewOutcomeSave({...input,businessId}):undefined;
   if(route==='custody-context'||route==='pickup-collection')check(customerUuid(input.jobId)&&customerUuid(input.jobVehicleId));
   const collections=route==='custody-collections'?parseCollectionCursor(input):undefined;
   if(route==='review-outcome')check(customerUuid(input.jobId));
   const reviewHistory=route==='review-history'?parseReviewHistoryQuery(input):undefined;
   const maintenanceList=route==='maintenance-list'?parseMaintenanceFollowUpListQuery(input):undefined;
   const maintenanceHistory=route==='maintenance-history'?parseMaintenanceFollowUpHistoryQuery(input):undefined;
   if(route==='custody-policy')check(customerUuid(input.modeVersionId));
   const policySave=route==='custody-policy-save'?parseDropoffPolicySave({...input,businessId}):undefined;
   const policyRevision=route==='custody-policy-revise'?parseDropoffPolicyRevision({...input,businessId}):undefined;
   const custodySave=route==='custody-save'?parseDropoffCustodySave({...input,businessId}):undefined;
   const maintenanceSave=route==='maintenance-save'?parseMaintenanceFollowUpSave({...input,businessId}):undefined;
   if(route==='mobile-departure')check(customerUuid(input.jobId)&&customerUuid(input.legId));
   if(route==='unfulfilled-context'||route==='work-time'||route==='work-start'||route==='work-end')check(customerUuid(input.jobId));
   const completionSave=route==='complete'?parseCompletionSave({...input,businessId}):undefined;
   const mileageTrips=route==='mileage-trips'?parseMileageTripQuery({businessId,jobId:input.jobId,pageSize:input.pageSize,
    after:input.afterDepartedAt===null&&input.afterLegId===null?null:{departedAt:input.afterDepartedAt,legId:input.afterLegId}}):undefined;
   const mileageHistory=route==='mileage-history'?parseMileageHistoryQuery({...input,businessId}):undefined;
   const mileageSave=route==='mileage-save'?parseMileageSave({...input,businessId}):undefined;
   const supportList=route==='support-trips'?parseSupportTripListQuery({businessId,pageSize:input.pageSize,
    after:input.afterDepartedAt===null&&input.afterLegId===null?null:{departedAt:input.afterDepartedAt,legId:input.afterLegId}}):undefined;
   const supportHistory=route==='support-trip-history'?parseSupportTripHistoryQuery({...input,businessId}):undefined;
   const supportSave=route==='support-trip-save'?parseSupportTripSave({...input,businessId}):undefined;
   if(route==='pickup-policy')check(input.beforeSequence===null||customerVersion(input.beforeSequence));
   const pickupPolicySave=route==='pickup-policy-save'?parsePickupPolicySave({...input,businessId}):undefined;
   const pickupCollectionSave=route==='pickup-collection-save'?parsePickupCollectionSave({...input,businessId}):undefined;
   const pickupSave=route==='pickup-trip-save'?parsePickupTripSave({...input,businessId}):undefined;
   if(pickupCollectionSave?.body.conditionPhotoId&&!pickupPhotosEnabled)return failed(503);
   const pickupCursor=route==='pickup-trips'?parsePickupTripCursor({beforeDepartedAt:input.beforeDepartedAt,beforeLegId:input.beforeLegId}):undefined;
   if(pickupCursor)check(customerUuid(input.jobId));
   if(route==='support-trip-mileage')check(customerUuid(input.legId));
   const original=route==='original'?parseSchedulingOriginal(parseOriginalOperationLookupWire(input,businessId)):undefined;
   if(original?.commandType===pickupPolicyKind&&!pickupPolicyEnabled)return failed(503);
   if(original?.commandType===pickupCollectionKind&&!pickupCollectionEnabled)return failed(503);
   if(original?.commandType===pickupTripKind&&!pickupTripsEnabled)return failed(503);
   if(original?.commandType===workBoundaryKind&&!workBoundaryEnabled)return failed(503);
   if(original?.commandType===workStartKind&&!workStartEnabled)return failed(503);
   if(original?.commandType===workEndKind&&!workEndEnabled)return failed(503);
   if(original?.commandType===mobileDepartureKind&&!mobileDepartureEnabled)return failed(503);
   if(original?.commandType===reviewOutcomeKind&&!reviewOutcomeEnabled)return failed(503);
   if((original?.commandType===dropoffCustodyKind||original?.commandType===dropoffPolicyKind)&&!custodyEnabled)return failed(503);
   if(original?.commandType===dropoffPolicyRevisionKind&&!policyRevisionEnabled)return failed(503);
   if(original?.commandType===maintenanceFollowUpKind&&!maintenanceEnabled)return failed(503);
   const book=route==='book'?parseBookJobCommand({...input,businessId}):undefined,cancel=route==='cancel'?parseCancelJobCommand({...input,businessId}):undefined,reschedule=route==='reschedule'?parseChangeJobScheduleSave({...input,businessId}):undefined,mode=route==='mode-save'?parseFulfillmentModeSave({...input,businessId}):undefined;
   if(!amendedEnabled&&(book?.schemaVersion===2||cancel?.schemaVersion===2))throw Error();
   const slotReview=route==='slot-review'?parseBookingConflictRequest({...input,businessId}):undefined;
   const list=route==='list'?parseJobListRequest({...input,businessId}):undefined,history=route==='history'?parseJobHistoryRequest({...input,businessId}):undefined,pending=route==='pending'?parsePendingChangesRequest({...input,businessId}):undefined;
   if(route==='agreement')check(customerUuid(input.familyId));if(route==='resources'||route==='read'||route==='completion-context')check(customerUuid(input.jobId));if(route==='mode-history')check(customerVersion(input.afterSequence,true)&&typeof input.pageSize==='number'&&Number.isInteger(input.pageSize)&&input.pageSize>=1&&input.pageSize<=20);
   const sessionId=await csrf(bounded,cookie,signal);workStarted=true;if(!await admit(cookie,'ordinary',signal)){const r=privateJsonResponse({error:'SCHEDULING_REQUEST_LIMITED'},429);r.headers.set('Retry-After','60');return r;}check(!signal.aborted);
   if(route==='workspace'){const workspace=(await directory.workspace(cookie,businessId,signal)).forServer(),authority=(await context(cookie,businessId,signal)).forServer();check(!signal.aborted);const response=privateJsonResponse({...workspace,writeState:authority.writeState,recoveryEpoch:authority.recoveryEpoch});response.headers.set('X-Crest-Edit-Binding',createHash('sha256').update('crest.scheduling.edit.v1\0').update(businessId).update('\0').update(sessionId).digest('base64url'));if(amendedEnabled)response.headers.set('X-Crest-Amended-Scheduling','1');if(fieldEnabled)response.headers.set('X-Crest-Field-Session','1');if(completionEnabled)response.headers.set('X-Crest-Job-Completion','1');if(mileageEnabled)response.headers.set('X-Crest-Job-Mileage','1');if(supportTripsEnabled)response.headers.set('X-Crest-Support-Trips','1');if(unfulfilledCancellationEnabled)response.headers.set('X-Crest-Unfulfilled-Cancellation','1');if(workTimeEnabled)response.headers.set('X-Crest-Work-Time','1');if(workBoundaryEnabled)response.headers.set('X-Crest-Work-Boundary','1');if(workStartEnabled)response.headers.set('X-Crest-Work-Start','1');if(workEndEnabled)response.headers.set('X-Crest-Work-End','1');if(mobileDepartureEnabled)response.headers.set('X-Crest-Mobile-Departure','1');if(reviewOutcomeEnabled)response.headers.set('X-Crest-Review-Outcome','1');if(reviewHistoryEnabled)response.headers.set('X-Crest-Review-History','1');if(maintenanceEnabled)response.headers.set('X-Crest-Maintenance-Follow-Up','1');if(custodyEnabled)response.headers.set('X-Crest-Dropoff-Custody','1');if(policyRevisionEnabled)response.headers.set('X-Crest-Dropoff-Policy-Revision','1');if(pickupTripsEnabled)response.headers.set('X-Crest-Pickup-Trips','1');if(pickupCollectionEnabled)response.headers.set('X-Crest-Pickup-Collection','1');if(pickupPolicyEnabled)response.headers.set('X-Crest-Pickup-Policy','1');if(pickupPhotosEnabled)response.headers.set('X-Crest-Pickup-Photos','1');return response;}
   let result:object;
   if(route==='field-save'){check(fieldDirectory);submitted=true;result=(await fieldDirectory.saveSession(cookie,fieldSave!,signal)).forServer();}
   else if(route==='interrupt'){check(fieldDirectory&&interruption);submitted=true;result=(await fieldDirectory.interrupt(cookie,interruption,signal)).forServer();}
   else if(route==='work-time'){check(fieldDirectory);result=(await fieldDirectory.jobWorkTime(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='work-boundary-save'){check(fieldDirectory&&boundary);submitted=true;result=(await fieldDirectory.correctWorkBoundary(cookie,boundary,signal)).forServer();}
   else if(route==='work-start'){check(fieldDirectory);result=(await fieldDirectory.jobWorkStart(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='work-start-save'){check(fieldDirectory&&start);submitted=true;result=(await fieldDirectory.correctWorkStart(cookie,start,signal)).forServer();}
   else if(route==='work-end'){check(fieldDirectory);result=(await fieldDirectory.jobWorkEnd(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='work-end-save'){check(fieldDirectory&&end);submitted=true;result=(await fieldDirectory.correctWorkEnd(cookie,end,signal)).forServer();}
   else if(route==='mobile-departure'){check(fieldDirectory);result=(await fieldDirectory.mobileDeparture(cookie,businessId,input.jobId as string,input.legId as string,signal)).forServer();}
   else if(route==='custody-policy-save'){check(fieldDirectory&&policySave);submitted=true;result=(await fieldDirectory.saveCustodyPolicy(cookie,policySave,signal)).forServer();}
   else if(route==='custody-policy-revise'){check(fieldDirectory&&policyRevision);submitted=true;result=(await fieldDirectory.reviseCustodyPolicy(cookie,policyRevision,signal)).forServer();}
   else if(route==='custody-policy'){check(fieldDirectory);result=(await fieldDirectory.dropoffPolicy(cookie,businessId,input.modeVersionId as string,signal)).forServer();}
   else if(route==='custody-save'){check(fieldDirectory&&custodySave);submitted=true;result=(await fieldDirectory.saveCustody(cookie,custodySave,signal)).forServer();}
   else if(route==='custody-context'){check(fieldDirectory);result=(await fieldDirectory.dropoffCustody(cookie,businessId,input.jobId as string,input.jobVehicleId as string,signal)).forServer();}
   else if(route==='custody-collections'){check(fieldDirectory&&collections);result=(await fieldDirectory.dropoffCollections(cookie,businessId,collections,signal)).forServer();}
   else if(route==='review-history'){check(fieldDirectory&&reviewHistory);result=(await fieldDirectory.reviewHistory(cookie,businessId,reviewHistory,signal)).forServer();}
   else if(route==='maintenance-list'){check(fieldDirectory&&maintenanceList);result=(await fieldDirectory.maintenanceList(cookie,businessId,maintenanceList,signal)).forServer();}
   else if(route==='maintenance-history'){check(fieldDirectory&&maintenanceHistory);result=(await fieldDirectory.maintenanceHistory(cookie,businessId,maintenanceHistory,signal)).forServer();}
   else if(route==='maintenance-save'){check(fieldDirectory&&maintenanceSave);submitted=true;result=(await fieldDirectory.saveMaintenance(cookie,maintenanceSave,signal)).forServer();}
   else if(route==='review-outcome'){check(fieldDirectory);result=(await fieldDirectory.reviewOutcome(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='review-outcome-save'){check(fieldDirectory&&reviewOutcome);submitted=true;result=(await fieldDirectory.recordReviewOutcome(cookie,reviewOutcome,signal)).forServer();}
   else if(route==='mobile-departure-save'){check(fieldDirectory&&departure);submitted=true;result=(await fieldDirectory.correctMobileDeparture(cookie,departure,signal)).forServer();}
   else if(route==='unfulfilled-context'){check(fieldDirectory);result=(await fieldDirectory.cancellationContext(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='cancel-unfulfilled'){check(fieldDirectory&&unfulfilled);submitted=true;result=(await fieldDirectory.cancelUnfulfilled(cookie,unfulfilled,signal)).forServer();}
   else if(route==='completion-context'){check(completion);result=(await completion.context(cookie,businessId,input.jobId as string,signal)).forServer();}
   else if(route==='complete'){check(completion&&completionSave);submitted=true;result=(await completion.complete(cookie,completionSave,signal)).forServer();}
   else if(route==='mileage-trips'){check(mileage&&mileageTrips);result=(await mileage.trips(cookie,mileageTrips,signal)).forServer();}
   else if(route==='mileage-history'){check(mileage&&mileageHistory);result=(await mileage.history(cookie,mileageHistory,signal)).forServer();}
   else if(route==='mileage-save'){check(mileage&&mileageSave);submitted=true;result=(await mileage.save(cookie,mileageSave,signal)).forServer();}
   else if(route==='support-trips'){check(supportTrips&&supportList);result=(await supportTrips.list(cookie,supportList,signal)).forServer();}
   else if(route==='support-trip-history'){check(supportTrips&&supportHistory);result=(await supportTrips.history(cookie,supportHistory,signal)).forServer();}
   else if(route==='support-trip-mileage'){check(supportTrips);result=(await supportTrips.mileage(cookie,businessId,input.legId as string,signal)).forServer();}
   else if(route==='support-trip-save'){check(supportTrips&&supportSave);submitted=true;result=(await supportTrips.save(cookie,supportSave,signal)).forServer();}
   else if(route==='pickup-policy'){check(fieldDirectory);result=(await fieldDirectory.pickupPolicy(cookie,businessId,input.beforeSequence as string|null,signal)).forServer();}
   else if(route==='pickup-policy-save'){check(fieldDirectory&&pickupPolicySave);submitted=true;result=(await fieldDirectory.savePickupPolicy(cookie,pickupPolicySave,signal)).forServer();}
   else if(route==='pickup-collection'){check(fieldDirectory);result=(await fieldDirectory.pickupCollection(cookie,businessId,input.jobId as string,input.jobVehicleId as string,signal)).forServer();}
   else if(route==='pickup-collection-save'){check(fieldDirectory&&pickupCollectionSave);submitted=true;result=(await fieldDirectory.savePickupCollection(cookie,pickupCollectionSave,signal)).forServer();}
   else if(route==='pickup-trips'){check(fieldDirectory&&pickupCursor);result=(await fieldDirectory.pickupTrips(cookie,businessId,input.jobId as string,pickupCursor,signal)).forServer();}
   else if(route==='pickup-trip-save'){check(fieldDirectory&&pickupSave);submitted=true;result=(await fieldDirectory.savePickupTrip(cookie,pickupSave,signal)).forServer();}
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
   check(!signal.aborted&&Buffer.byteLength(JSON.stringify(result))<=(route==='agreement'||route==='resources'||route==='mileage-history'?4194304:1048576));return privateJsonResponse(result,'state' in result&&result.state==='conflict'?409:200);
  }catch(error){if(submitted&&(error instanceof BookingDirectoryError||error instanceof FulfillmentModeDirectoryError||error instanceof FieldDirectoryError||error instanceof CompletionDirectoryError||error instanceof MileageDirectoryError||error instanceof SupportTripDirectoryError)){if(error.message.endsWith('_SAVE_NOT_SUBMITTED'))return privateJsonResponse({error:'SCHEDULING_SAVE_NOT_SUBMITTED'},503);if(error.message==='RECOVERY_REVIEW_REQUIRED')return privateJsonResponse({error:error.message},409);}return submitted?privateJsonResponse({error:'SCHEDULING_SAVE_OUTCOME_UNKNOWN'},503):failed(workStarted?503:400);}
 };
}
