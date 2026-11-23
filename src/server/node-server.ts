import {financePostingSchema} from '../bookkeeping/finance-posting-schema.ts';
import {productionCapability,productionCapabilitiesBelongTo,productionReleaseAccepted} from '../security/production-capabilities.ts';
import {withWorkspaceRuntimeMode} from './workspace-runtime-mode.ts';
import compatibility from '../../release/compatibility.json' with {type:'json'};
import {isRenderIngress} from '../security/render-ingress.ts';
import type {ProductionCapabilities,ProductionCapability} from '../security/production-capabilities.ts';
import {validateFinanceRuntimeFeatures,validateFinanceRuntimeConnection,validateFinanceRuntimeDependencies} from '../bookkeeping/finance-runtime-configuration.ts';
import type {ProductionFinanceConfiguration} from '../bookkeeping/finance-runtime-configuration.ts';
import {createHoldHttp,holdFailureResponse} from '../operations/appointment-hold-http.ts';
import 'server-only';
import {legacyContactDownloadLimit,legacyContactDownloadRoute} from '../customer/legacy-contact-download-contract.ts';
import {discardLegacyContactDownload,isLegacyContactDownloadResponse} from '../customer/legacy-contact-download-http.ts';
import {createSchedulingHttp,schedulingFailureResponse} from '../operations/scheduling-http.ts';
import {createSyntheticGoogleCalendarRuntime,googleCalendarRuntimePrefix,googleCalendarConsentFailure} from '../operations/google-calendar-runtime.ts';
import {createProductionGoogleCalendarRuntime,googleCalendarCallbackPath} from '../operations/google-calendar-production-runtime.ts';
import {cleanGoogleCalendarOAuthResponse} from '../operations/google-calendar-oauth.ts';
import {validateProductionCalendarConfiguration,validateCalendarRuntimeConnection} from './production-calendar-configuration.ts';
import type {ProductionGoogleCalendarConfiguration} from './production-calendar-configuration.ts';
import type {SyntheticGoogleCalendarConfiguration} from '../operations/google-calendar-runtime.ts';
import {isReceiptDownloadResponse,writeReceiptDownloadResponse} from '../bookkeeping/expenses/receipt-download-response.ts';
import {createReceiptHttp,receiptFailure,receiptPrefix} from '../bookkeeping/expenses/receipt-http.ts';
import type {ExpenseReceiptRuntime,SyntheticExpenseReceiptRuntime} from '../bookkeeping/expenses/receipt-http.ts';
import {createSupplierBillOriginalHttp,supplierOriginalFailure,supplierOriginalPrefix} from '../bookkeeping/expenses/supplier-bill-original-http.ts';
import type {SupplierOriginalRuntime,SyntheticSupplierOriginalRuntime} from '../bookkeeping/expenses/supplier-bill-original-http.ts';
import {createDropoffPhotoHttp,dropoffPhotoFailure,dropoffPhotoPrefix} from '../operations/dropoff-photo-http.ts';
import type {DropoffPhotoRuntime,SyntheticDropoffPhotoRuntime} from '../operations/dropoff-photo-http.ts';
import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {Readable} from 'node:stream';
import type {Socket} from 'node:net';
import {browserFailureResponse} from '../security/browser-http.ts';
import {createAuthenticationHttp,settleAuthenticationResponse} from '../security/authentication-http.ts';
import {transportFromIncomingMessage} from '../security/trusted-transport.ts';
import {createBusinessHttp,businessFailureResponse} from '../security/business-http.ts';
import {createServiceHttp,serviceFailureResponse} from '../commercial/service-http.ts';
import {createQuoteHttp,quoteFailureResponse} from '../commercial/quote-http.ts';
import {createQuoteReviewHttp} from '../commercial/quote-review-http.ts';
import {createQuoteCommercialHttp} from '../commercial/quote-commercial-http.ts';
import {createQuoteAmendmentHttp,quoteAmendmentFailureResponse} from '../commercial/quote-amendment-http.ts';
import {createExpenseHttp,expenseFailureResponse} from '../bookkeeping/expenses/expense-http.ts';
import {createFinanceAccountHttp,financeAccountFailure,financeAccountPrefix} from '../bookkeeping/finance-account-http.ts';
import {quoteResponseLimit} from '../commercial/quote-storage-contract.ts';
import {createCustomerHttp,customerFailureResponse} from '../customer/customer-http.ts';
import {createCustomerAddressHttp,addressFailureResponse} from '../customer/customer-address-http.ts';

import {createVehicleHttp,vehicleFailureResponse} from '../customer/vehicle-http.ts';
import {createAssociationHttp,associationFailureResponse} from '../customer/association-http.ts';
import {createLeadHttp,leadFailureResponse} from '../customer/lead-http.ts';
import {createLeadSourceHttp,leadSourceFailureResponse} from '../customer/lead-source-http.ts';
import {createOriginalOperationHttp,originalOperationFailureResponse} from '../security/original-operation-http.ts';
import {createSourceExportHttp,sourceExportFailureResponse} from '../security/source-export-http.ts';
import {createSourceExportDownloadHttp,sourceExportDownloadFailureResponse} from '../security/source-export-download-http.ts';
import {sourceExportCatalogueBatchPath} from '../security/source-export-download-contract.ts';
import {createSourceExportOriginalHttp,sourceExportOriginalPath} from '../security/source-export-original-http.ts';
import {createPostedFinanceOwnerExportHttp,discardPostedFinanceExport,postedFinanceExportFailure} from '../security/posted-finance-owner-export-http.ts';
import {postedFinanceExportLimit,postedFinanceExportPath} from '../security/posted-finance-owner-export-contract.ts';
import {isSourceExportDownloadResponse,writeSourceExportDownloadResponse,discardSourceExportDownloadResponse} from './source-export-download-response.ts';

export type AuthenticationConfiguration=Readonly<{
  configuration:Omit<Parameters<typeof createAuthenticationHttp>[0],'origin'|'environment'>;
  provider:Parameters<typeof createAuthenticationHttp>[1];tokens:Parameters<typeof createAuthenticationHttp>[2];
}>;
export type SourceExportConfiguration=Readonly<{appReleaseId:string;store:NonNullable<Parameters<typeof createSourceExportDownloadHttp>[3]>}>;
import {getServerBuildIdentity} from './build-identity.ts';
import {validateFinanceExportConnection} from './production-finance-export-configuration.ts';
import type {ProductionFinanceExportConfiguration} from './production-finance-export-configuration.ts';
import {sourceExportRuntimeBelongsTo} from './production-source-export-runtime.ts';
import type {ProductionSourceExportRuntime} from './production-source-export-runtime.ts';
export type NodeConfiguration=Readonly<{productionSourceExports?:ProductionSourceExportRuntime;productionFinanceExports?:ProductionFinanceExportConfiguration;productionGoogleCalendar?:ProductionGoogleCalendarConfiguration;productionSupplierOriginals?:SupplierOriginalRuntime;productionDropoffPhotos?:DropoffPhotoRuntime;productionExpenseReceipts?:ExpenseReceiptRuntime;productionFinance?:ProductionFinanceConfiguration;productionCapabilities?:ProductionCapabilities;catalog?:boolean;origin:string;environment:'production'|'test';tls?:Readonly<{key:Buffer;cert:Buffer}>;authentication?:AuthenticationConfiguration;business?:Readonly<{businessId:string}>;customers?:boolean;syntheticLegacyContactBatches?:boolean;syntheticLegacyContactEffects?:boolean;syntheticLegacyContactTargets?:boolean;syntheticLegacyContactDecisions?:boolean;syntheticLegacyContactApprovals?:boolean;syntheticLegacyContactApplications?:boolean|'background';syntheticLegacyContactDownloads?:boolean;syntheticLegacyContactImportWorker?:Readonly<{connectionString:string}>;vehicles?:boolean;associations?:boolean;leads?:boolean;leadFollowUps?:boolean;leadMatchReview?:boolean;leadConversions?:boolean;operationResolution?:boolean;syntheticCatalog?:boolean;syntheticQuotes?:boolean;syntheticQuoteReview?:boolean;syntheticQuoteCommercial?:boolean;syntheticQuoteAmendments?:boolean;syntheticQuoteAmendmentAcceptance?:boolean;syntheticAppointmentHolds?:boolean;syntheticExpenses?:boolean;syntheticExpenseReceipts?:SyntheticExpenseReceiptRuntime;syntheticFinanceAccounts?:Readonly<{connectionString:string;fixedMappings?:boolean;mappingHistoryEvidence?:boolean;historyEvidence?:boolean;taxProfiles?:boolean;categoryMappings?:boolean;moneyChannels?:boolean;invoicePreparation?:boolean;invoiceDrafts?:boolean;invoiceIssueTaxReview?:boolean;invoiceIssue?:boolean;invoiceOutstanding?:boolean;directReceipts?:boolean;sameDayExpenses?:boolean;trialBalance?:boolean;paymentCorrections?:boolean;fundApplications?:boolean;heldTips?:boolean;invoiceCredits?:boolean;paidInvoiceCredits?:boolean;serviceRefunds?:boolean;receivableAging?:boolean;customerFundsReport?:boolean;excessReceipts?:boolean;excessReturns?:boolean;tipReturns?:boolean;collectionFailures?:boolean;refundTransfers?:boolean;directReceiptTips?:boolean;refundTransferFees?:boolean;collectionFailureRecredits?:boolean;collectionFailureGroupedRecredits?:boolean;collectionFailureTipReinstatements?:boolean;openingWorksheet?:boolean;openingArPreview?:boolean;statementStaging?:boolean;statementMatchReview?:boolean;statementMatchDrafts?:boolean;supplierBillDrafts?:boolean;supplierPayableReview?:boolean;supplierPayablePosting?:boolean;recordedIncomeStatement?:boolean}>;syntheticScheduling?:boolean;syntheticRecordJobHistory?:boolean;syntheticCustomerProfile?:boolean;syntheticFieldSessions?:boolean;syntheticJobCompletion?:boolean;syntheticJobMileage?:boolean;syntheticSupportTrips?:boolean;syntheticUnfulfilledCancellation?:boolean;syntheticWorkTime?:boolean;syntheticWorkBoundary?:boolean;syntheticWorkStart?:boolean;syntheticWorkEnd?:boolean;syntheticMobileDeparture?:boolean;syntheticReviewOutcome?:boolean;syntheticReviewHistory?:boolean;syntheticMaintenanceFollowUp?:boolean;syntheticDropoffCustody?:boolean;syntheticDropoffPolicyRevision?:boolean;syntheticPickupTrips?:boolean;syntheticPickupCollection?:boolean;syntheticPickupPolicy?:boolean;syntheticPickupPhotos?:boolean;syntheticPickupWork?:boolean;syntheticPickupRelease?:boolean;syntheticPickupReturnFailure?:boolean;syntheticDropoffPhotos?:SyntheticDropoffPhotoRuntime;syntheticSupplierOriginals?:SyntheticSupplierOriginalRuntime;syntheticGoogleCalendar?:SyntheticGoogleCalendarConfiguration;sourceExports?:SourceExportConfiguration;syntheticPostedFinanceExport?:Readonly<{connectionString:string;appReleaseId:string;sourceSchemaVersion:number}>}>;
export type PageHandler=(request:IncomingMessage,response:ServerResponse)=>Promise<void>;

export function createBoundedNodeServer(tls?:NodeConfiguration['tls']):Server{
  const options={maxHeaderSize:16384,requestTimeout:10000,headersTimeout:5000,keepAliveTimeout:5000,connectionsCheckingInterval:1000};
  const server=tls?createTlsServer({...options,key:tls.key,cert:tls.cert,minVersion:'TLSv1.2',handshakeTimeout:5000}):createServer(options);
  // Capture every header inside the byte cap; reject excess instead of silently
  // truncating a late duplicate Origin/cookie/CSRF header.
  const sockets=new Set<Socket>();server.maxHeadersCount=0;server.maxRequestsPerSocket=100;
  server.setTimeout(45000,socket=>socket.destroy());
  server.on('connection',socket=>{
    if(sockets.size>=128){socket.destroy();return;}
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
  });
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('upgrade',(_request,socket)=>socket.destroy());
  return server;
}

export function requestTarget(raw:string|undefined,origin:string):Readonly<{url:URL;authentication:boolean;business:boolean}>{
  if(!raw||raw.length>8192||!raw.startsWith('/')||raw.startsWith('//')||/[\\#]/.test(raw)
    ||Array.from(raw).some(char=>char.charCodeAt(0)<=32||char.charCodeAt(0)===127))throw new Error('REQUEST_TARGET_INVALID');
  const url=new URL(raw,origin);
  if(url.origin!==origin||url.pathname+url.search!==raw)throw new Error('REQUEST_TARGET_INVALID');
  // Reserve encoded aliases as well: they must never fall through to Next.
  const decoded=decodeURIComponent(url.pathname);
  return Object.freeze({url,authentication:decoded==='/api/auth'||decoded.startsWith('/api/auth/'),business:decoded==='/api/business'||decoded.startsWith('/api/business/')||decoded==='/api/google-calendar'||decoded.startsWith('/api/google-calendar/')});
}

export async function writeAuthenticationResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,8192);
}
export async function writeCustomerResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,1048576);
}
export async function writeQuoteResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,quoteResponseLimit);
}
// Expense history admits6MiB of retained JSON; its existing client accepts8MiB
// including the response envelope. Customer/quote limits remain independent.
export async function writeExpenseResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,8388608);
}
export async function writeSchedulingResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,4194304);
}
export async function writeOriginalOperationResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal):Promise<void>{
  return writePrivateResponse(outgoing,response,signal,16384);
}
// Metadata keeps the16KiB private cap. Only a genuine one-use file handoff
// uses the separately verified8MiB binary writer and its settlement/wipe path.
export async function writeSourceExportResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal,fileEndpoint=false):Promise<void>{
 if(isSourceExportDownloadResponse(response)){
  if(!fileEndpoint){discardSourceExportDownloadResponse(response);outgoing.destroy();throw Error('SOURCE_EXPORT_DELIVERY_FAILED');}
  return writeSourceExportDownloadResponse(outgoing,response,signal);
 }
 return writePrivateResponse(outgoing,response,signal,16384);
}
async function writePrivateResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal,limit:number,sensitive=false,deliveryTimeoutMs=5000):Promise<void>{
  let finished=false,body:Buffer|undefined;
  const chunks:Uint8Array[]=[];
  try{
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
    const reader=response.body?.getReader();let size=0;
    try{
      if(reader)while(true){
        const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
          const abort=()=>reject(new Error('AUTHENTICATION_DELIVERY_FAILED'));
          if(bounded.aborted){abort();return;}
          bounded.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>bounded.removeEventListener('abort',abort));
        });
        if(part.done)break;
        if(!part.value.byteLength||(size+=part.value.byteLength)>limit)throw new Error();chunks.push(part.value);
      }
    }finally{if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
    body=Buffer.concat(chunks);
    if(signal.aborted||outgoing.destroyed)throw new Error();
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(fail,deliveryTimeoutMs);timer.unref();
      function clean(){clearTimeout(timer);outgoing.off('finish',finish);outgoing.off('close',fail);outgoing.off('error',fail);signal.removeEventListener('abort',fail);}
      function finish(){finished=true;clean();resolve();}
      function fail(){clean();reject(new Error('AUTHENTICATION_DELIVERY_FAILED'));}
      outgoing.once('finish',finish);outgoing.once('close',fail);outgoing.once('error',fail);signal.addEventListener('abort',fail,{once:true});
      try{
        if(signal.aborted)throw new Error();
        for(const [key,value]of response.headers)if(key!=='set-cookie')outgoing.setHeader(key,value);
        const cookies=response.headers.getSetCookie();if(cookies.length)outgoing.setHeader('Set-Cookie',cookies);
        outgoing.writeHead(response.status);outgoing.end(body);
      }catch{fail();}
    });
  }finally{
    if(!finished)outgoing.destroy();
    if(sensitive){for(const chunk of chunks)chunk.fill(0);body?.fill(0);}
    try{await settleAuthenticationResponse(response,finished);}catch{console.error('AUTHENTICATION_DELIVERY_CLEANUP_FAILED');}
  }
}

export function bindApplicationHandler(server:Server,config:NodeConfiguration,pages:PageHandler):void{
  const {origin,environment,authentication,business,customers,syntheticLegacyContactBatches,syntheticLegacyContactEffects,syntheticLegacyContactTargets,syntheticLegacyContactDecisions,syntheticLegacyContactApprovals,syntheticLegacyContactApplications,syntheticLegacyContactDownloads,vehicles,associations,leads,leadFollowUps,leadMatchReview,leadConversions,operationResolution,sourceExports,syntheticPostedFinanceExport,syntheticCatalog,syntheticQuotes,syntheticQuoteReview,syntheticQuoteCommercial,syntheticQuoteAmendments,syntheticQuoteAmendmentAcceptance,syntheticAppointmentHolds,syntheticExpenses,syntheticExpenseReceipts,syntheticFinanceAccounts,syntheticScheduling,syntheticFieldSessions,syntheticJobCompletion,syntheticJobMileage,syntheticSupportTrips,syntheticUnfulfilledCancellation,syntheticWorkTime,syntheticWorkBoundary,syntheticWorkStart,syntheticWorkEnd,syntheticMobileDeparture,syntheticReviewOutcome,syntheticReviewHistory,syntheticMaintenanceFollowUp,syntheticDropoffCustody,syntheticDropoffPolicyRevision,syntheticPickupTrips,syntheticPickupCollection,syntheticPickupPolicy,syntheticPickupPhotos,syntheticPickupWork,syntheticPickupRelease,syntheticPickupReturnFailure,syntheticDropoffPhotos,syntheticSupplierOriginals,syntheticGoogleCalendar}=config;
  const url=new URL(origin);
  const {syntheticRecordJobHistory,syntheticCustomerProfile}=config;
  if(config.productionCapabilities!==undefined&&(environment!=='production'||!authentication||!business||!productionCapabilitiesBelongTo(config.productionCapabilities,business.businessId)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const productionScope=config.productionCapabilities?{productionCapabilities:config.productionCapabilities}:{};
  const production=(capability:ProductionCapability)=>Boolean(business&&productionCapability({environment,businessId:business.businessId,...productionScope},capability));
  let productionFinance:ProductionFinanceConfiguration|undefined;
  if(config.productionFinance!==undefined){
   if(environment!=='production'||!production('finance')||!authentication||!business||syntheticFinanceAccounts!==undefined||!config.productionFinance||typeof config.productionFinance!=='object'||Array.isArray(config.productionFinance)||typeof config.productionFinance.connectionString!=='string')throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
   try{
    validateFinanceRuntimeConnection(authentication.configuration.connectionString,config.productionFinance.connectionString);
    const features=validateFinanceRuntimeFeatures(config.productionFinance.features);validateFinanceRuntimeDependencies(features,production);
    productionFinance=Object.freeze({connectionString:config.productionFinance.connectionString,features});
   }catch{throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');}
  }
  if(production('finance')&&!productionFinance)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const productionExportIdentity=config.productionFinanceExports?getServerBuildIdentity():null;
  if(config.productionFinanceExports!==undefined){
   if(environment!=='production'||!production('financeExports')||!authentication||!business||!productionFinance||syntheticPostedFinanceExport!==undefined||!productionExportIdentity)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
   validateFinanceExportConnection(authentication.configuration.connectionString,config.productionFinanceExports,productionFinance.connectionString);
  }
  if(production('financeExports')&&!config.productionFinanceExports)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const postedFinanceExport=config.productionFinanceExports&&productionExportIdentity?{...config.productionFinanceExports,appReleaseId:productionExportIdentity.appReleaseId,sourceSchemaVersion:productionExportIdentity.sourceSchemaVersion}:syntheticPostedFinanceExport;
  const productionReceipts=config.productionExpenseReceipts;
  if(productionReceipts!==undefined&&(environment!=='production'||!production('expenseReceipts')||!authentication||!business||syntheticExpenseReceipts!==undefined||!productionReceipts||!productionReceipts.objects||typeof productionReceipts.dispatch!=='function'||typeof productionReceipts.stagingOrigin!=='string'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(production('expenseReceipts')&&!productionReceipts)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const receipts=productionReceipts??syntheticExpenseReceipts;
  const productionPhotos=config.productionDropoffPhotos;
  if(productionPhotos!==undefined&&(environment!=='production'||!production('dropoffPhotos')||!authentication||!business||syntheticDropoffPhotos!==undefined||!productionPhotos||!productionPhotos.objects||typeof productionPhotos.dispatch!=='function'||typeof productionPhotos.stagingOrigin!=='string'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(production('dropoffPhotos')&&!productionPhotos)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const photos=productionPhotos??syntheticDropoffPhotos;
  const productionOriginals=config.productionSupplierOriginals;
  if(productionOriginals!==undefined&&(environment!=='production'||!production('supplierOriginals')||!productionFinance?.features.supplierPayableReview||!authentication||!business||syntheticSupplierOriginals!==undefined||!productionOriginals||!productionOriginals.objects||typeof productionOriginals.dispatch!=='function'||typeof productionOriginals.stagingOrigin!=='string'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(production('supplierOriginals')&&!productionOriginals)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const originals=productionOriginals??syntheticSupplierOriginals;
  const originalsFinance=productionFinance?.connectionString??syntheticFinanceAccounts?.connectionString;
  let productionCalendar:ProductionGoogleCalendarConfiguration|undefined;
  if(config.productionGoogleCalendar!==undefined){
   if(environment!=='production'||!production('googleCalendar')||!authentication||!business||syntheticGoogleCalendar!==undefined)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
   productionCalendar=validateProductionCalendarConfiguration(config.productionGoogleCalendar,origin);validateCalendarRuntimeConnection(authentication.configuration.connectionString,productionCalendar.connectionString);
  }
  if(production('googleCalendar')&&!productionCalendar)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const catalog=config.catalog;
  if(catalog!==undefined&&(typeof catalog!=='boolean'||catalog&&(!production('catalog')||!authentication||!business)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const operations={catalog:syntheticCatalog===true||production('catalog'),quotes:syntheticQuotes===true||production('quotes'),review:syntheticQuoteReview===true||production('quoteReview'),commercial:syntheticQuoteCommercial===true||production('quoteCommercial'),
   holds:syntheticAppointmentHolds===true||production('appointmentHolds'),scheduling:syntheticScheduling===true||production('scheduling'),amendments:syntheticQuoteAmendments===true||production('quoteAmendments'),acceptance:syntheticQuoteAmendmentAcceptance===true||production('quoteAmendmentAcceptance'),history:syntheticRecordJobHistory===true||production('recordJobHistory')};
  if(syntheticCustomerProfile!==undefined&&(typeof syntheticCustomerProfile!=='boolean'||syntheticCustomerProfile&&(environment!=='test'||syntheticRecordJobHistory!==true||customers!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticRecordJobHistory!==undefined&&(typeof syntheticRecordJobHistory!=='boolean'||syntheticRecordJobHistory&&(environment!=='test'||syntheticScheduling!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFieldSessions!==undefined&&(typeof syntheticFieldSessions!=='boolean'||syntheticFieldSessions&&(environment!=='test'||syntheticQuoteAmendmentAcceptance!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticJobCompletion!==undefined&&(typeof syntheticJobCompletion!=='boolean'||syntheticJobCompletion&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticJobMileage!==undefined&&(typeof syntheticJobMileage!=='boolean'||syntheticJobMileage&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticSupportTrips!==undefined&&(typeof syntheticSupportTrips!=='boolean'||syntheticSupportTrips&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticUnfulfilledCancellation!==undefined&&(typeof syntheticUnfulfilledCancellation!=='boolean'||syntheticUnfulfilledCancellation&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticWorkStart!==undefined&&(typeof syntheticWorkStart!=='boolean'||syntheticWorkStart&&(environment!=='test'||syntheticWorkBoundary!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticWorkEnd!==undefined&&(typeof syntheticWorkEnd!=='boolean'||syntheticWorkEnd&&(environment!=='test'||syntheticWorkStart!==true||syntheticJobCompletion!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticReviewOutcome!==undefined&&(typeof syntheticReviewOutcome!=='boolean'||syntheticReviewOutcome&&(environment!=='test'||syntheticJobCompletion!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactApplications!==undefined&&((typeof syntheticLegacyContactApplications!=='boolean'&&syntheticLegacyContactApplications!=='background')||syntheticLegacyContactApplications&&!syntheticLegacyContactApprovals))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactApprovals!==undefined&&(typeof syntheticLegacyContactApprovals!=='boolean'||syntheticLegacyContactApprovals&&!syntheticLegacyContactDecisions))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactDecisions!==undefined&&(typeof syntheticLegacyContactDecisions!=='boolean'||syntheticLegacyContactDecisions&&!syntheticLegacyContactTargets))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactTargets!==undefined&&(typeof syntheticLegacyContactTargets!=='boolean'||syntheticLegacyContactTargets&&!syntheticLegacyContactEffects))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactEffects!==undefined&&(typeof syntheticLegacyContactEffects!=='boolean'||syntheticLegacyContactEffects&&!syntheticLegacyContactBatches))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticLegacyContactBatches!==undefined&&(typeof syntheticLegacyContactBatches!=='boolean'||syntheticLegacyContactBatches&&(environment!=='test'||customers!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticReviewHistory!==undefined&&(typeof syntheticReviewHistory!=='boolean'||syntheticReviewHistory&&(environment!=='test'||syntheticReviewOutcome!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticDropoffCustody!==undefined&&(typeof syntheticDropoffCustody!=='boolean'||syntheticDropoffCustody&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticMaintenanceFollowUp!==undefined&&(typeof syntheticMaintenanceFollowUp!=='boolean'||syntheticMaintenanceFollowUp&&(environment!=='test'||syntheticJobCompletion!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticMobileDeparture!==undefined&&(typeof syntheticMobileDeparture!=='boolean'||syntheticMobileDeparture&&(environment!=='test'||syntheticWorkEnd!==true||syntheticJobMileage!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticWorkBoundary!==undefined&&(typeof syntheticWorkBoundary!=='boolean'||syntheticWorkBoundary&&(environment!=='test'||syntheticWorkTime!==true||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticWorkTime!==undefined&&(typeof syntheticWorkTime!=='boolean'||syntheticWorkTime&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuoteAmendmentAcceptance!==undefined&&(typeof syntheticQuoteAmendmentAcceptance!=='boolean'||syntheticQuoteAmendmentAcceptance&&(environment!=='test'||syntheticQuoteAmendments!==true||syntheticScheduling!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuoteAmendments!==undefined&&(typeof syntheticQuoteAmendments!=='boolean'||syntheticQuoteAmendments&&(environment!=='test'||!authentication||!business||customers!==true||vehicles!==true||operationResolution!==true||syntheticQuoteCommercial!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticScheduling!==undefined&&(typeof syntheticScheduling!=='boolean'||syntheticScheduling&&(environment!=='test'||!authentication||!business||customers!==true||vehicles!==true||associations!==true||operationResolution!==true||syntheticQuoteCommercial!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts!==undefined&&(!syntheticFinanceAccounts||typeof syntheticFinanceAccounts.connectionString!=='string'||(syntheticFinanceAccounts.fixedMappings!==undefined&&typeof syntheticFinanceAccounts.fixedMappings!=='boolean')||(syntheticFinanceAccounts.historyEvidence!==undefined&&typeof syntheticFinanceAccounts.historyEvidence!=='boolean')||(syntheticFinanceAccounts.mappingHistoryEvidence!==undefined&&(typeof syntheticFinanceAccounts.mappingHistoryEvidence!=='boolean'||syntheticFinanceAccounts.mappingHistoryEvidence&&!syntheticFinanceAccounts.fixedMappings))||(syntheticFinanceAccounts.taxProfiles!==undefined&&typeof syntheticFinanceAccounts.taxProfiles!=='boolean')||(syntheticFinanceAccounts.categoryMappings!==undefined&&typeof syntheticFinanceAccounts.categoryMappings!=='boolean')||(syntheticFinanceAccounts.moneyChannels!==undefined&&typeof syntheticFinanceAccounts.moneyChannels!=='boolean')||(syntheticFinanceAccounts.invoicePreparation!==undefined&&typeof syntheticFinanceAccounts.invoicePreparation!=='boolean')||(syntheticFinanceAccounts.invoiceDrafts!==undefined&&typeof syntheticFinanceAccounts.invoiceDrafts!=='boolean')||(syntheticFinanceAccounts.invoiceIssueTaxReview!==undefined&&typeof syntheticFinanceAccounts.invoiceIssueTaxReview!=='boolean')||(syntheticFinanceAccounts.invoiceIssue!==undefined&&typeof syntheticFinanceAccounts.invoiceIssue!=='boolean')||(syntheticFinanceAccounts.directReceipts!==undefined&&typeof syntheticFinanceAccounts.directReceipts!=='boolean')||(syntheticFinanceAccounts.directReceipts===true&&!(syntheticFinanceAccounts.invoiceIssue===true&&syntheticFinanceAccounts.moneyChannels===true))||(syntheticFinanceAccounts.invoiceIssue===true&&!(syntheticFinanceAccounts.invoiceIssueTaxReview===true&&syntheticFinanceAccounts.fixedMappings===true))||(syntheticFinanceAccounts.invoiceIssueTaxReview===true&&!(syntheticFinanceAccounts.invoiceDrafts===true&&syntheticFinanceAccounts.taxProfiles===true))||(syntheticFinanceAccounts.invoiceDrafts===true&&syntheticFinanceAccounts.invoicePreparation!==true)||(syntheticFinanceAccounts.invoicePreparation===true&&syntheticJobCompletion!==true)||(syntheticFinanceAccounts.categoryMappings===true&&syntheticFinanceAccounts.fixedMappings!==true)||environment!=='test'||!authentication||!business))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticExpenses!==undefined&&(typeof syntheticExpenses!=='boolean'||syntheticExpenses&&(environment!=='test'||!authentication||!business||customers!==true||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticAppointmentHolds!==undefined&&(typeof syntheticAppointmentHolds!=='boolean'||syntheticAppointmentHolds&&(environment!=='test'||!authentication||!business||customers!==true||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticCatalog!==undefined&&(typeof syntheticCatalog!=='boolean'||syntheticCatalog&&(environment!=='test'||!authentication||!business)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuotes!==undefined&&(typeof syntheticQuotes!=='boolean'||syntheticQuotes&&(environment!=='test'||!authentication||!business)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuoteReview!==undefined&&(typeof syntheticQuoteReview!=='boolean'||syntheticQuoteReview&&(environment!=='test'||!authentication||!business||syntheticQuotes!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuoteCommercial!==undefined&&(typeof syntheticQuoteCommercial!=='boolean'||syntheticQuoteCommercial&&(environment!=='test'||!authentication||!business||syntheticQuotes!==true||syntheticQuoteReview!==true||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(sourceExports!==undefined&&(environment!=='test'||!sourceExports||typeof sourceExports!=='object'||Array.isArray(sourceExports)||!business||!authentication||typeof sourceExports.appReleaseId!=='string'||!/^([a-f0-9]{40})$/.test(sourceExports.appReleaseId)||typeof sourceExports.store?.readVerified!=='function'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(operationResolution!==undefined&&typeof operationResolution!=='boolean'||operationResolution&&(!business||!authentication))throw new Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(url.origin!==origin||url.username||url.password||!['http:','https:'].includes(url.protocol)||!['production','test'].includes(environment)
    ||business&&!authentication||customers!==undefined&&typeof customers!=='boolean'||customers&&(!business||!authentication)||vehicles!==undefined&&typeof vehicles!=='boolean'||vehicles&&(!business||!authentication)||associations!==undefined&&typeof associations!=='boolean'||associations&&(!business||!authentication)||leadConversions!==undefined&&typeof leadConversions!=='boolean'||leadConversions&&!leads||leadFollowUps!==undefined&&typeof leadFollowUps!=='boolean'||leadFollowUps&&!leads||leadMatchReview!==undefined&&typeof leadMatchReview!=='boolean'||leadMatchReview&&!leads||leads!==undefined&&typeof leads!=='boolean'||leads&&(!business||!authentication)||authentication&&environment==='production'&&!config.tls&&!isRenderIngress(authentication.configuration?.ingress)||server.listenerCount('request'))throw new Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatch=authentication?createAuthenticationHttp({...authentication.configuration,origin,environment},authentication.provider,authentication.tokens):undefined;
  if(syntheticGoogleCalendar!==undefined&&(environment!=='test'||!business||!authentication))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchBusiness=business&&authentication?createBusinessHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,syntheticGoogleCalendar!==undefined||productionCalendar!==undefined):undefined;
  const dispatchGoogleCalendar=productionCalendar&&business&&authentication?createProductionGoogleCalendarRuntime({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,productionCalendar):syntheticGoogleCalendar&&business&&authentication?createSyntheticGoogleCalendarRuntime({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,syntheticGoogleCalendar):undefined;
  if(syntheticDropoffPolicyRevision!==undefined&&(typeof syntheticDropoffPolicyRevision!=='boolean'||syntheticDropoffPolicyRevision&&(environment!=='test'||syntheticDropoffCustody!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticDropoffPhotos&&(environment!=='test'||syntheticDropoffCustody!==true||!authentication||!business))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupPhotos!==undefined&&(typeof syntheticPickupPhotos!=='boolean'||syntheticPickupPhotos&&(environment!=='test'||syntheticPickupPolicy!==true||!syntheticDropoffPhotos)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupReturnFailure!==undefined&&(typeof syntheticPickupReturnFailure!=='boolean'||syntheticPickupReturnFailure&&
   (environment!=='test'||syntheticPickupRelease!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupRelease!==undefined&&(typeof syntheticPickupRelease!=='boolean'||syntheticPickupRelease&&
   (environment!=='test'||syntheticPickupWork!==true||syntheticPickupPhotos!==true||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchPhotos=photos&&business&&authentication?createDropoffPhotoHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,photos,(syntheticPickupPhotos===true||production('pickupPhotos')),(syntheticPickupRelease===true||production('pickupRelease'))):undefined;
  if(syntheticPickupWork!==undefined&&(typeof syntheticPickupWork!=='boolean'||syntheticPickupWork&&(environment!=='test'||
    syntheticPickupCollection!==true||syntheticJobCompletion!==true||syntheticUnfulfilledCancellation!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupPolicy!==undefined&&(typeof syntheticPickupPolicy!=='boolean'||syntheticPickupPolicy&&(environment!=='test'||syntheticPickupCollection!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupCollection!==undefined&&(typeof syntheticPickupCollection!=='boolean'||syntheticPickupCollection&&(environment!=='test'||syntheticPickupTrips!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticPickupTrips!==undefined&&(typeof syntheticPickupTrips!=='boolean'||syntheticPickupTrips&&(environment!=='test'||syntheticFieldSessions!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchScheduling=operations.scheduling&&business&&authentication?createSchedulingHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope,recordJobHistory:operations.history},authentication.provider,authentication.tokens,true,operations.acceptance,(syntheticFieldSessions===true||production("fieldSessions")),(syntheticJobCompletion===true||production("jobCompletion")),(syntheticJobMileage===true||production("jobMileage")),(syntheticSupportTrips===true||production("supportTrips")),(syntheticUnfulfilledCancellation===true||production("unfulfilledCancellation")),(syntheticWorkTime===true||production("workTime")),(syntheticWorkBoundary===true||production("workBoundary")),(syntheticWorkStart===true||production("workStart")),(syntheticWorkEnd===true||production("workEnd")),(syntheticMobileDeparture===true||production("mobileDeparture")),(syntheticReviewOutcome===true||production("reviewOutcome")),(syntheticReviewHistory===true||production("reviewHistory")),(syntheticMaintenanceFollowUp===true||production("maintenanceFollowUp")),(syntheticDropoffCustody===true||production("dropoffCustody")),(syntheticDropoffPolicyRevision===true||production("dropoffPolicyRevision")),(syntheticPickupTrips===true||production('pickupTrips')),(syntheticPickupCollection===true||production('pickupCollection')),(syntheticPickupPolicy===true||production('pickupPolicy')),(syntheticPickupPhotos===true||production('pickupPhotos')),(syntheticPickupWork===true||production('pickupWork')),(syntheticPickupRelease===true||production('pickupRelease')),(syntheticPickupReturnFailure===true||production('pickupReturnFailure')),(syntheticFinanceAccounts?.invoicePreparation===true||productionFinance?.features.invoicePreparation===true),(syntheticFinanceAccounts?.invoiceDrafts===true||productionFinance?.features.invoiceDrafts===true),dispatchGoogleCalendar!==undefined):undefined;
  if(syntheticExpenseReceipts!==undefined&&(!syntheticExpenseReceipts||environment!=='test'||syntheticExpenses!==true||
   !syntheticExpenseReceipts.objects||typeof syntheticExpenseReceipts.dispatch!=='function'||typeof syntheticExpenseReceipts.stagingOrigin!=='string'))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.sameDayExpenses!==undefined&&(typeof syntheticFinanceAccounts.sameDayExpenses!=='boolean'||syntheticFinanceAccounts.sameDayExpenses&&!(syntheticExpenses===true&&syntheticFinanceAccounts.directReceipts===true&&syntheticFinanceAccounts.categoryMappings===true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.trialBalance!==undefined&&(typeof syntheticFinanceAccounts.trialBalance!=='boolean'||syntheticFinanceAccounts.trialBalance&&syntheticFinanceAccounts.sameDayExpenses!==true))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.paymentCorrections!==undefined&&(typeof syntheticFinanceAccounts.paymentCorrections!=='boolean'||syntheticFinanceAccounts.paymentCorrections&&syntheticFinanceAccounts.trialBalance!==true))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.fundApplications!==undefined&&(typeof syntheticFinanceAccounts.fundApplications!=='boolean'||syntheticFinanceAccounts.fundApplications&&syntheticFinanceAccounts.paymentCorrections!==true))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.heldTips!==undefined&&(typeof syntheticFinanceAccounts.heldTips!=='boolean'||syntheticFinanceAccounts.heldTips&&(!syntheticFinanceAccounts.fundApplications||!syntheticFinanceAccounts.taxProfiles)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.invoiceCredits!==undefined&&(typeof syntheticFinanceAccounts.invoiceCredits!=='boolean'||syntheticFinanceAccounts.invoiceCredits&&syntheticFinanceAccounts.heldTips!==true))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.paidInvoiceCredits!==undefined&&(typeof syntheticFinanceAccounts.paidInvoiceCredits!=='boolean'||syntheticFinanceAccounts.paidInvoiceCredits&&syntheticFinanceAccounts.invoiceCredits!==true))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.serviceRefunds!==undefined&&(typeof syntheticFinanceAccounts.serviceRefunds!=='boolean'||syntheticFinanceAccounts.serviceRefunds&&(!syntheticFinanceAccounts.paidInvoiceCredits||!syntheticFinanceAccounts.directReceipts)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.excessReturns!==undefined&&(typeof syntheticFinanceAccounts.excessReturns!=='boolean'||
   syntheticFinanceAccounts.excessReturns&&(!syntheticFinanceAccounts.excessReceipts||!syntheticFinanceAccounts.trialBalance
    ||(syntheticPostedFinanceExport?.sourceSchemaVersion??0)<93)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const restoredTips=syntheticFinanceAccounts?.collectionFailureTipReinstatements;
  const sourceSchema=postedFinanceExport?.sourceSchemaVersion;
  // Migrations110–122 add readers and operations without changing the reviewed109 finance posting capabilities.
  const exportSchema=financePostingSchema(sourceSchema);
  const postedFinanceSchema=(exportSchema===102||exportSchema===103||exportSchema===104||exportSchema===105||exportSchema===106||exportSchema===107||exportSchema===108||exportSchema===109)?101:exportSchema;
  if(syntheticFinanceAccounts?.openingArPreview&&exportSchema!==105&&exportSchema!==106&&exportSchema!==107&&exportSchema!==108&&exportSchema!==109)
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(restoredTips!==undefined&&(typeof restoredTips!=='boolean'||restoredTips&&!syntheticFinanceAccounts?.collectionFailureGroupedRecredits))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.collectionFailureGroupedRecredits!==undefined&&
   (typeof syntheticFinanceAccounts.collectionFailureGroupedRecredits!=='boolean'||syntheticFinanceAccounts.collectionFailureGroupedRecredits&&
    (!syntheticFinanceAccounts.collectionFailureRecredits||postedFinanceSchema!==(restoredTips?101:100))))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.collectionFailureRecredits!==undefined&&(typeof syntheticFinanceAccounts.collectionFailureRecredits!=='boolean'||
   syntheticFinanceAccounts.collectionFailureRecredits&&(!syntheticFinanceAccounts.refundTransferFees||!syntheticFinanceAccounts.collectionFailures
    ||!syntheticFinanceAccounts.fundApplications||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:99))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.tipReturns!==undefined&&(typeof syntheticFinanceAccounts.tipReturns!=='boolean'||
   syntheticFinanceAccounts.tipReturns&&(!syntheticFinanceAccounts.excessReturns||!syntheticFinanceAccounts.heldTips
    ||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:syntheticFinanceAccounts.collectionFailureRecredits?99:syntheticFinanceAccounts.refundTransferFees?98:syntheticFinanceAccounts.directReceiptTips?97:syntheticFinanceAccounts.refundTransfers?96:syntheticFinanceAccounts.collectionFailures?95:94))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.collectionFailures!==undefined&&(typeof syntheticFinanceAccounts.collectionFailures!=='boolean'||
   syntheticFinanceAccounts.collectionFailures&&(!syntheticFinanceAccounts.tipReturns||!syntheticFinanceAccounts.trialBalance
    ||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:syntheticFinanceAccounts.collectionFailureRecredits?99:syntheticFinanceAccounts.refundTransferFees?98:syntheticFinanceAccounts.directReceiptTips?97:syntheticFinanceAccounts.refundTransfers?96:95))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.refundTransfers!==undefined&&(typeof syntheticFinanceAccounts.refundTransfers!=='boolean'||
   syntheticFinanceAccounts.refundTransfers&&(!syntheticFinanceAccounts.collectionFailures||!syntheticFinanceAccounts.serviceRefunds
    ||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:syntheticFinanceAccounts.collectionFailureRecredits?99:syntheticFinanceAccounts.refundTransferFees?98:syntheticFinanceAccounts.directReceiptTips?97:96))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.directReceiptTips!==undefined&&(typeof syntheticFinanceAccounts.directReceiptTips!=='boolean'||
   syntheticFinanceAccounts.directReceiptTips&&(!syntheticFinanceAccounts.refundTransfers||!syntheticFinanceAccounts.excessReceipts
    ||!syntheticFinanceAccounts.taxProfiles||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:syntheticFinanceAccounts.collectionFailureRecredits?99:syntheticFinanceAccounts.refundTransferFees?98:97))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.refundTransferFees!==undefined&&(typeof syntheticFinanceAccounts.refundTransferFees!=='boolean'||
   syntheticFinanceAccounts.refundTransferFees&&(!syntheticFinanceAccounts.directReceiptTips||!syntheticFinanceAccounts.refundTransfers
    ||postedFinanceSchema!==(restoredTips?101:syntheticFinanceAccounts.collectionFailureGroupedRecredits?100:syntheticFinanceAccounts.collectionFailureRecredits?99:98))))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.statementStaging!==undefined&&(typeof syntheticFinanceAccounts.statementStaging!=='boolean'||
   syntheticFinanceAccounts.statementStaging&&(!syntheticFinanceAccounts.moneyChannels||exportSchema!==103&&exportSchema!==104&&exportSchema!==105&&exportSchema!==106&&exportSchema!==107&&exportSchema!==108&&exportSchema!==109)))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.recordedIncomeStatement!==undefined&&(typeof syntheticFinanceAccounts.recordedIncomeStatement!=='boolean'||
   syntheticFinanceAccounts.recordedIncomeStatement&&(!syntheticFinanceAccounts.trialBalance||!syntheticFinanceAccounts.refundTransfers||exportSchema!==104&&exportSchema!==105&&exportSchema!==106&&exportSchema!==107&&exportSchema!==108&&exportSchema!==109)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.supplierBillDrafts!==undefined&&(typeof syntheticFinanceAccounts.supplierBillDrafts!=='boolean'||
   syntheticFinanceAccounts.supplierBillDrafts&&(!syntheticFinanceAccounts.moneyChannels||exportSchema!==108&&exportSchema!==109)))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.statementMatchDrafts!==undefined&&(typeof syntheticFinanceAccounts.statementMatchDrafts!=='boolean'||
   syntheticFinanceAccounts.statementMatchDrafts&&(!syntheticFinanceAccounts.statementMatchReview||exportSchema!==107&&exportSchema!==108&&exportSchema!==109)))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.statementMatchReview!==undefined&&(typeof syntheticFinanceAccounts.statementMatchReview!=='boolean'||
   syntheticFinanceAccounts.statementMatchReview&&(!syntheticFinanceAccounts.statementStaging||exportSchema!==106&&exportSchema!==107&&exportSchema!==108&&exportSchema!==109)))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticFinanceAccounts?.supplierPayablePosting&&exportSchema!==109)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticSupplierOriginals&&(!syntheticFinanceAccounts?.supplierPayableReview||!business||!authentication||exportSchema!==109))
   throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchSupplierOriginals=originals&&originalsFinance&&business&&authentication
   ?createSupplierBillOriginalHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},
    authentication.provider,authentication.tokens,originalsFinance,originals):undefined;
  if(syntheticFinanceAccounts?.invoiceOutstanding!==undefined&&(typeof syntheticFinanceAccounts.invoiceOutstanding!=='boolean'||syntheticFinanceAccounts.invoiceOutstanding&&!syntheticFinanceAccounts.invoiceIssue))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const financeConnection=productionFinance?.connectionString??syntheticFinanceAccounts?.connectionString;
  const financeFeatures=productionFinance?.features??syntheticFinanceAccounts;
  const dispatchFinanceAccounts=financeConnection&&financeFeatures&&business&&authentication?createFinanceAccountHttp(
   {...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},financeConnection,
   authentication.provider,authentication.tokens,{...financeFeatures,supplierOriginalUploads:!!dispatchSupplierOriginals}):undefined;
  const dispatchReceipts=receipts&&business&&authentication
   ?createReceiptHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},
    authentication.provider,authentication.tokens,receipts.objects,receipts.dispatch,true,receipts.stagingOrigin):undefined;
  const dispatchExpenses=(syntheticExpenses===true||production('expenses'))&&business&&authentication?createExpenseHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true):undefined;
  const dispatchHolds=operations.holds&&business&&authentication?createHoldHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true):undefined;
  const dispatchServices=operations.catalog&&business&&authentication?createServiceHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true):undefined;
  const dispatchDraftQuotes=operations.quotes&&business&&authentication?createQuoteHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true,operations.review,operations.commercial,operations.acceptance):undefined;
  const dispatchQuoteReview=operations.review&&business&&authentication?createQuoteReviewHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true):undefined;
  const dispatchQuoteCommercial=operations.commercial&&business&&authentication?createQuoteCommercialHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true):undefined;
  const dispatchQuoteAmendments=operations.amendments&&business&&authentication?createQuoteAmendmentHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope},authentication.provider,authentication.tokens,true,operations.acceptance):undefined;
  const dispatchQuotes=dispatchDraftQuotes?(request:Request,peer:Parameters<NonNullable<typeof dispatchDraftQuotes>>[1])=>{const path=decodeURIComponent(new URL(request.url).pathname);if(path.startsWith('/api/business/quotes/amendments/'))return dispatchQuoteAmendments?dispatchQuoteAmendments(request,peer):Promise.resolve(quoteAmendmentFailureResponse(404));if(path.startsWith('/api/business/quotes/commercial/'))return dispatchQuoteCommercial?dispatchQuoteCommercial(request,peer):Promise.resolve(quoteFailureResponse(404));if(path.startsWith('/api/business/quotes/review/'))return dispatchQuoteReview?dispatchQuoteReview(request,peer):Promise.resolve(quoteFailureResponse(404));return dispatchDraftQuotes(request,peer);}:undefined;
  if(syntheticLegacyContactDownloads!==undefined&&(typeof syntheticLegacyContactDownloads!=='boolean'||syntheticLegacyContactDownloads&&syntheticLegacyContactApplications!=='background'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchCustomers=customers&&business&&authentication?createCustomerHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope,recordJobHistory:operations.history,customerProfile:syntheticCustomerProfile===true||production('customerProfiles')},authentication.provider,authentication.tokens,(syntheticReviewHistory===true||production("reviewHistory")),(syntheticMaintenanceFollowUp===true||production("maintenanceFollowUp")),syntheticLegacyContactBatches===true,syntheticLegacyContactEffects===true,syntheticLegacyContactTargets===true,syntheticLegacyContactDecisions===true,syntheticLegacyContactApprovals===true,syntheticLegacyContactApplications,syntheticLegacyContactDownloads===true):undefined;
  const dispatchAddresses=customers&&business&&authentication?createCustomerAddressHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchVehicles=vehicles&&business&&authentication?createVehicleHttp({...authentication.configuration,origin,environment,businessId:business.businessId,recordJobHistory:operations.history},authentication.provider,authentication.tokens):undefined;
  const dispatchAssociations=associations&&business&&authentication?createAssociationHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchLeads=leads&&business&&authentication?createLeadHttp({...authentication.configuration,origin,environment,businessId:business.businessId,leadFollowUps:leadFollowUps===true,leadMatchReview:leadMatchReview===true},authentication.provider,authentication.tokens,leadConversions===true):undefined;
  const dispatchLeadSources=leads&&business&&authentication?createLeadSourceHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchOriginalOperations=operationResolution===true&&business&&authentication?createOriginalOperationHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,true):undefined;
  if(syntheticPostedFinanceExport!==undefined&&(environment!=='test'||!business||!authentication||!syntheticPostedFinanceExport))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatchPostedFinance=postedFinanceExport&&business&&authentication?createPostedFinanceOwnerExportHttp({
   ...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope,exportConnectionString:postedFinanceExport.connectionString,
   appReleaseId:postedFinanceExport.appReleaseId,sourceSchemaVersion:postedFinanceExport.sourceSchemaVersion,
  },authentication.provider,authentication.tokens):undefined;
  const productionExports=config.productionSourceExports;
  if(productionExports!==undefined&&(environment!=='production'||!production('businessExports')||!authentication||!business||sourceExports!==undefined||!sourceExportRuntimeBelongsTo(productionExports,business.businessId,getServerBuildIdentity()?.appReleaseId??'')))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(production('businessExports')&&!productionExports)throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const selectedSourceExports=productionExports?{appReleaseId:productionExports.appReleaseId,store:productionExports.forDownloads()}:sourceExports;
  const dispatchExports=selectedSourceExports&&business&&authentication?createSourceExportHttp({...authentication.configuration,origin,environment,businessId:business.businessId,...productionScope,appReleaseId:selectedSourceExports.appReleaseId},authentication.provider,authentication.tokens,true,productionExports):undefined;
  const dispatchExportParts=selectedSourceExports&&business&&authentication?createSourceExportDownloadHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,selectedSourceExports.store,true):undefined;
  const dispatchExportOriginals=selectedSourceExports&&business&&authentication&&receipts&&originals&&photos?createSourceExportOriginalHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,{
   expense_receipt:(input,signal)=>receipts.objects.intakeStore.readVerifiedCandidate(input,signal),
   supplier_document:(input,signal)=>originals.objects.intakeStore.readVerifiedCandidate(input,signal),
   condition_photo:(input,signal)=>photos.objects.readVerifiedCandidate(input,signal),
  }):undefined;
  const dispatchExportDownloads=dispatchExportParts?(request:Request,peer:Parameters<typeof dispatchExportParts>[1])=>new URL(request.url).pathname.startsWith(sourceExportOriginalPath)?dispatchExportOriginals?dispatchExportOriginals(request,peer):Promise.resolve(sourceExportDownloadFailureResponse(404)):dispatchExportParts(request,peer):undefined;
  let activeProtected=0,activePhotoFiles=0,activeLegacyUploads=0;
  server.on('request',(incoming,outgoing)=>{void (async()=>{
    const controller=new AbortController();
    const abort=()=>controller.abort();incoming.once('aborted',abort);
    outgoing.once('close',()=>{if(!outgoing.writableFinished)abort();});
    let reserved=false,photoFileReserved=false,legacyUploadReserved=false,businessRequest=false,serviceRequest=false,quoteRequest=false,holdRequest=false,expenseRequest=false,receiptRequest=false,financeAccountRequest=false,supplierOriginalRequest=false,schedulingRequest=false,photoRequest=false,customerRequest=false,addressRequest=false,vehicleRequest=false,associationRequest=false,leadRequest=false,leadSourceRequest=false,originalOperationRequest=false,exportRequest=false,postedFinanceExportRequest=false,exportDownloadRequest=false,googleCalendarRequest=false;
    try{
      if(incoming.rawHeaders.length>256)throw new Error();
      const target=requestTarget(incoming.url,origin);
      businessRequest=target.business;
      const decoded=decodeURIComponent(target.url.pathname);customerRequest=target.business&&(decoded==='/api/business/customers'||decoded.startsWith('/api/business/customers/'));
      serviceRequest=target.business&&(decoded==='/api/business/services'||decoded.startsWith('/api/business/services/'));
      schedulingRequest=target.business&&(decoded==='/api/business/scheduling'||decoded.startsWith('/api/business/scheduling/'));
      photoRequest=schedulingRequest&&decoded.startsWith(dropoffPhotoPrefix);
      supplierOriginalRequest=target.business&&(decoded===supplierOriginalPrefix.slice(0,-1)||decoded.startsWith(supplierOriginalPrefix));
      financeAccountRequest=target.business&&(decoded===financeAccountPrefix.slice(0,-1)||decoded.startsWith(financeAccountPrefix));
      receiptRequest=target.business&&(decoded===receiptPrefix.slice(0,-1)||decoded.startsWith(receiptPrefix));
      expenseRequest=target.business&&(decoded==='/api/business/expenses'||decoded.startsWith('/api/business/expenses/'));
      holdRequest=target.business&&(decoded==='/api/business/appointment-holds'||decoded.startsWith('/api/business/appointment-holds/'));
      quoteRequest=target.business&&(decoded==='/api/business/quotes'||decoded.startsWith('/api/business/quotes/'));
      addressRequest=customerRequest&&(decoded==='/api/business/customers/addresses'||decoded.startsWith('/api/business/customers/addresses/'));
      vehicleRequest=target.business&&(decoded==='/api/business/vehicles'||decoded.startsWith('/api/business/vehicles/'));
      associationRequest=target.business&&(decoded==='/api/business/vehicle-associations'||decoded.startsWith('/api/business/vehicle-associations/'));
      leadRequest=target.business&&(decoded==='/api/business/leads'||decoded.startsWith('/api/business/leads/'));
      leadSourceRequest=target.business&&(decoded==='/api/business/lead-sources'||decoded.startsWith('/api/business/lead-sources/'));
      originalOperationRequest=target.business&&(decoded==='/api/business/original-operations'||decoded.startsWith('/api/business/original-operations/'));
      exportRequest=target.business&&(decoded==='/api/business/exports'||decoded.startsWith('/api/business/exports/'));
      postedFinanceExportRequest=exportRequest&&(decoded===postedFinanceExportPath||decoded.startsWith(postedFinanceExportPath+'/'));
      exportDownloadRequest=exportRequest&&(decoded===sourceExportCatalogueBatchPath||decoded.startsWith(sourceExportCatalogueBatchPath+'/')||decoded==='/api/business/exports/downloads'||decoded.startsWith('/api/business/exports/downloads/')||decoded==='/api/business/exports/file'||decoded.startsWith('/api/business/exports/file/')||decoded===sourceExportOriginalPath||decoded.startsWith(sourceExportOriginalPath+'/'));
      googleCalendarRequest=target.business&&(decoded===googleCalendarRuntimePrefix.slice(0,-1)||decoded.startsWith(googleCalendarRuntimePrefix)||decoded==='/api/google-calendar'||decoded.startsWith('/api/google-calendar/'));
      if(googleCalendarRequest&&decoded===googleCalendarCallbackPath&&!productionCalendar){await writeAuthenticationResponse(outgoing,cleanGoogleCalendarOAuthResponse(),controller.signal);return;}
      const exportFileRequest=decoded==='/api/business/exports/file';
      if(!target.authentication&&!target.business){await withWorkspaceRuntimeMode(environment==='production'&&authentication&&business&&productionReleaseAccepted(compatibility)?'production':'test',()=>pages(incoming,outgoing));return;}
      const handler=googleCalendarRequest?dispatchGoogleCalendar:supplierOriginalRequest?dispatchSupplierOriginals:photoRequest?dispatchPhotos:schedulingRequest?dispatchScheduling:financeAccountRequest?dispatchFinanceAccounts:receiptRequest?dispatchReceipts:expenseRequest?dispatchExpenses:holdRequest?dispatchHolds:quoteRequest?dispatchQuotes:serviceRequest?dispatchServices:exportRequest?(postedFinanceExportRequest?dispatchPostedFinance:exportDownloadRequest?dispatchExportDownloads:dispatchExports):originalOperationRequest?dispatchOriginalOperations:leadSourceRequest?dispatchLeadSources:leadRequest?dispatchLeads:associationRequest?dispatchAssociations:vehicleRequest?dispatchVehicles:addressRequest?dispatchAddresses:customerRequest?dispatchCustomers:target.business?dispatchBusiness:dispatch,failure=googleCalendarRequest?googleCalendarConsentFailure:supplierOriginalRequest?supplierOriginalFailure:photoRequest?dropoffPhotoFailure:schedulingRequest?schedulingFailureResponse:financeAccountRequest?financeAccountFailure:receiptRequest?receiptFailure:expenseRequest?expenseFailureResponse:holdRequest?holdFailureResponse:quoteRequest?quoteFailureResponse:serviceRequest?serviceFailureResponse:exportRequest?(postedFinanceExportRequest?postedFinanceExportFailure:exportDownloadRequest?sourceExportDownloadFailureResponse:sourceExportFailureResponse):originalOperationRequest?originalOperationFailureResponse:leadSourceRequest?leadSourceFailureResponse:leadRequest?leadFailureResponse:associationRequest?associationFailureResponse:vehicleRequest?vehicleFailureResponse:addressRequest?addressFailureResponse:customerRequest?customerFailureResponse:target.business?businessFailureResponse:browserFailureResponse;
      if(receiptRequest&&!handler){await writeAuthenticationResponse(outgoing,receiptFailure(404),controller.signal);return;}
      if(!handler||activeProtected>=32){await writeAuthenticationResponse(outgoing,failure(503),controller.signal);return;}
      if(decoded===sourceExportOriginalPath||photoRequest&&target.url.pathname===dropoffPhotoPrefix+'file'||supplierOriginalRequest&&decoded===supplierOriginalPrefix+'preview'||
       receiptRequest&&(decoded===receiptPrefix+'upload-file'||decoded===receiptPrefix+'download')){
       if(activePhotoFiles>=2){await writeAuthenticationResponse(outgoing,(receiptRequest?receiptFailure:supplierOriginalRequest?supplierOriginalFailure:dropoffPhotoFailure)(429),controller.signal);return;}
       activePhotoFiles++;photoFileReserved=true;
      }
      if(syntheticLegacyContactBatches&&customerRequest&&decoded==='/api/business/customers/legacy-batches/stage'){
       if(activeLegacyUploads>=2){await writeAuthenticationResponse(outgoing,customerFailureResponse(503),controller.signal);return;}
       activeLegacyUploads++;legacyUploadReserved=true;
      }
      activeProtected++;reserved=true;
      const peer=transportFromIncomingMessage(incoming),headers=new Headers();
      for(let i=0;i<incoming.rawHeaders.length;i+=2)headers.append(incoming.rawHeaders[i]!,incoming.rawHeaders[i+1]!);
      const request=new Request(target.url,{method:incoming.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method??'')?{body:Readable.toWeb(incoming),duplex:'half'}:{})} as RequestInit);
      const response=await handler(request,peer);
      if(dispatchPhotos&&target.url.pathname==='/api/business/scheduling/custody-context'&&response.ok)response.headers.set('X-Crest-Dropoff-Photos','1');
      if(dispatchGoogleCalendar&&target.url.pathname==='/api/business/settings'&&response.ok){response.headers.set('X-Crest-Calendar-Mode',productionCalendar?'production':'test');response.headers.set('X-Crest-Google-Calendar-Setup','1');}
      if(dispatchFinanceAccounts&&target.url.pathname==='/api/business/settings'&&response.ok)response.headers.set('X-Crest-Finance-Accounts','1');
      if(dispatchReceipts&&expenseRequest&&decoded==='/api/business/expenses/context'&&response.ok)response.headers.set('X-Crest-Receipt-Uploads','1');
      if((decoded===sourceExportOriginalPath||supplierOriginalRequest||receiptRequest&&decoded===receiptPrefix+'download')&&photoFileReserved&&response.ok){
       if(!isReceiptDownloadResponse(response))throw Error('SUPPLIER_ORIGINAL_DELIVERY_REQUIRED');
       await writeReceiptDownloadResponse(outgoing,response,controller.signal);
      }else if(photoRequest&&photoFileReserved&&response.ok){
       const preview=response.headers.get('content-disposition')?.endsWith('-preview.jpg"');
       await writePrivateResponse(outgoing,response,controller.signal,(preview?8:25)*1024*1024,true);
      }
      else if(receiptRequest)await writePrivateResponse(outgoing,response,controller.signal,1048576);
      else if(financeAccountRequest)await writePrivateResponse(outgoing,response,controller.signal,(decoded===financeAccountPrefix+'trial-balance'||decoded===financeAccountPrefix+'recorded-income-statement'||decoded===financeAccountPrefix+'statement-match-review')?2097152:(decoded===financeAccountPrefix+'invoice-preparation'||decoded===financeAccountPrefix+'invoice-draft-read'||decoded===financeAccountPrefix+'invoice-issue-tax-review'||decoded===financeAccountPrefix+'invoice-issue-prepare'||decoded===financeAccountPrefix+'invoice-issue-read'||decoded===financeAccountPrefix+'receipt-options'||decoded===financeAccountPrefix+'expense-post-options'||decoded===financeAccountPrefix+'fund-application-options'||decoded===financeAccountPrefix+'held-tip-options'||decoded===financeAccountPrefix+'invoice-credit-options'||decoded===financeAccountPrefix+'paid-invoice-credit-options')?1048576:196608);
      else if(customerRequest&&target.url.pathname==='/api/business/customers/'+legacyContactDownloadRoute&&isLegacyContactDownloadResponse(response)){
       try{await writePrivateResponse(outgoing,response,controller.signal,legacyContactDownloadLimit,true,20000);}
       finally{discardLegacyContactDownload(response);}
      }
      else if(postedFinanceExportRequest&&response.ok&&decoded===postedFinanceExportPath){
       try{await writePrivateResponse(outgoing,response,controller.signal,postedFinanceExportLimit,true);}
       finally{discardPostedFinanceExport(response);}
      }
      else if(exportRequest)await writeSourceExportResponse(outgoing,response,controller.signal,exportFileRequest);
      else await (schedulingRequest?writeSchedulingResponse:expenseRequest?writeExpenseResponse:holdRequest?writeCustomerResponse:quoteRequest?writeQuoteResponse:originalOperationRequest?writeOriginalOperationResponse:serviceRequest||customerRequest||vehicleRequest||associationRequest||leadRequest||leadSourceRequest?writeCustomerResponse:writeAuthenticationResponse)(outgoing,response,controller.signal);
    }catch{
      if(!outgoing.destroyed&&!outgoing.headersSent)try{await writeAuthenticationResponse(outgoing,(googleCalendarRequest?googleCalendarConsentFailure:supplierOriginalRequest?supplierOriginalFailure:photoRequest?dropoffPhotoFailure:schedulingRequest?schedulingFailureResponse:financeAccountRequest?financeAccountFailure:receiptRequest?receiptFailure:expenseRequest?expenseFailureResponse:holdRequest?holdFailureResponse:quoteRequest?quoteFailureResponse:serviceRequest?serviceFailureResponse:exportRequest?(postedFinanceExportRequest?postedFinanceExportFailure:exportDownloadRequest?sourceExportDownloadFailureResponse:sourceExportFailureResponse):originalOperationRequest?originalOperationFailureResponse:leadSourceRequest?leadSourceFailureResponse:leadRequest?leadFailureResponse:associationRequest?associationFailureResponse:vehicleRequest?vehicleFailureResponse:addressRequest?addressFailureResponse:customerRequest?customerFailureResponse:businessRequest?businessFailureResponse:browserFailureResponse)(),controller.signal);}catch{outgoing.destroy();}
      else outgoing.destroy();
    }finally{if(legacyUploadReserved)activeLegacyUploads--;if(photoFileReserved)activePhotoFiles--;if(reserved)activeProtected--;incoming.off('aborted',abort);}
  })();});
}

