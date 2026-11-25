import 'server-only';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {createSessionCsrfVerifier,createPrivateFileCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {productionCapability} from '../security/production-capabilities.ts';
import type {ProductionCapabilityConfiguration} from '../security/production-capabilities.ts';
import type {createSessionLifecycle} from '../security/session-lifecycle.ts';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {boundedFileStream} from '../files/bounded-file-stream.ts';
import {createOpeningDocumentDirectory} from './opening-document-directory.ts';
import type {createOpeningDocumentDispatcher} from './opening-document-directory.ts';
import {createOpeningDocumentAccess,parseOpeningDocumentRecord} from './opening-document-workflow.ts';
import type {createReceiptObjectStore} from './expenses/receipt-object-store.ts';
export const openingDocumentPrefix='/api/business/opening-documents/';
export const openingDocumentFailure=(status=400)=>privateJsonResponse({error:'OPENING_DOCUMENT_REQUEST_UNCONFIRMED'},status);
export type OpeningDocumentRuntime=Readonly<{objects:ReturnType<typeof createReceiptObjectStore>;stagingOrigin:string;dispatch:ReturnType<typeof createOpeningDocumentDispatcher>;close?:()=>void}>;
type Config=SessionDatabaseConfiguration&ProductionCapabilityConfiguration&Readonly<{origin:string;ingress:IngressConfiguration;businessId:string}>;
const fields={find:['reference','sha256'],reserve:['documentId','operationId','recoveryEpoch','reference','sha256','contentType','byteSize'],verify:['documentId','operationId'],status:['documentId'],original:['documentId'],preview:['documentId']} as const;
const describe=(record:ReturnType<typeof parseOpeningDocumentRecord>)=>privateJsonResponse({documentId:record.reservation.receiptId,reference:record.evidence.reference,sha256:record.evidence.sha256,state:record.candidate?'available':'reserved',contentType:record.reservation.declaredType,byteSize:record.reservation.byteSize});
function require(value:unknown):asserts value{if(!value)throw Error('OPENING_DOCUMENT_REQUEST_UNCONFIRMED');}
export function createOpeningDocumentHttp(config:Config,provider:Parameters<typeof createSessionLifecycle>[1],tokens:Parameters<typeof createSessionLifecycle>[2],financeConnectionString:string,runtime:OpeningDocumentRuntime){
 require((config.environment==='test'||productionCapability(config,'openingDocuments'))&&uuid(config.businessId));
 const storage=new URL(runtime.stagingOrigin);require(storage.origin===runtime.stagingOrigin&&typeof runtime.dispatch==='function'&&(config.environment==='test'
  ?storage.hostname==='127.0.0.1'&&storage.port&&['http:','https:'].includes(storage.protocol)
  :/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(runtime.stagingOrigin)));
 const resolve=createTrustedTransport(config),csrf=createSessionCsrfVerifier(config),fileCsrf=createPrivateFileCsrfVerifier(config),admit=createSessionRequestAdmission(config),directory=createOpeningDocumentDirectory(config,provider,tokens,financeConnectionString),access=createOpeningDocumentAccess(directory,runtime.objects),business=config.businessId;let binary=0;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let started=false,held=false;
  try{
   resolve(request,peer);const url=new URL(request.url),action=url.pathname.slice(openingDocumentPrefix.length);
   if(url.search||url.hash||!url.pathname.startsWith(openingDocumentPrefix)||(action!=='upload'&&!Object.hasOwn(fields,action)))return openingDocumentFailure(404);
   if(request.method!=='POST')return openingDocumentFailure(405);if(request.headers.has('range'))return openingDocumentFailure(416);
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(95000)]),bounded=new Request(request,{signal}),credential=readBrowserCookies(bounded.headers).session;require(credential);await(action==='upload'?fileCsrf:csrf)(bounded,credential,signal);if(!await admit(credential,'ordinary',signal))return openingDocumentFailure(429);
   const input=action==='upload'?{documentId:bounded.headers.get('x-crest-opening-document')}:await readFlatJsonBody(bounded,fields[action as keyof typeof fields],4096);
   if(action==='find'){const found=await directory.find(credential,input,signal);return found.state==='absent'?privateJsonResponse({state:'absent'}):describe(found.record);}
   const id=input.documentId;require(uuid(id));
   if(action==='upload'||action==='original'||action==='preview'){if(binary>=2)return openingDocumentFailure(429);binary++;held=true;}
   if(action==='reserve'){
    started=true;const result=await directory.reserve(credential,input,signal);if(result.state==='conflict')return openingDocumentFailure(409);
   }
   if(action==='upload'){
    const current=parseOpeningDocumentRecord(await directory.read(credential,business,id,signal),business,id),reservation=current.reservation;require(!current.candidate&&bounded.body&&bounded.headers.get('content-type')===reservation.declaredType&&bounded.headers.get('content-length')===String(reservation.byteSize));
    const capability=(await access.upload(credential,business,id,signal)).forUpload(),destination=new URL(capability.url);require(destination.origin===storage.origin&&!destination.username&&!destination.password&&!destination.hash);
    const body=boundedFileStream(bounded.body,reservation.byteSize,signal);started=true;const response=await fetch(destination,{method:'PUT',headers:{...capability.headers,'content-length':String(reservation.byteSize)},body,duplex:'half',signal,cache:'no-store',redirect:'error'} as RequestInit);void response.body?.cancel().catch(()=>undefined);require(response.ok&&!signal.aborted);return privateJsonResponse({documentId:id,state:'uploaded'});
   }
   if(action==='verify'){require('operationId'in input&&uuid(input.operationId));started=true;await runtime.dispatch(credential,business,id,input.operationId,signal);}
   if(action==='original'||action==='preview')return await access.download(credential,business,id,action,signal);
   const record=parseOpeningDocumentRecord(await directory.read(credential,business,id,signal),business,id);return describe(record);
  }catch{return openingDocumentFailure(started?503:400);}finally{if(held)binary--;}
 };
}
