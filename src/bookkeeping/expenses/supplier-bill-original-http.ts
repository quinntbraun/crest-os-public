import 'server-only';

import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {fileTypes} from '../../files/validation-contract.ts';
import type {FileType} from '../../files/validation-contract.ts';
import {boundedFileStream} from '../../files/bounded-file-stream.ts';
import {maximumFileBytes} from '../../files/private-object-store.ts';
import {readBrowserCookies} from '../../security/browser-http.ts';
import {createSessionCsrfVerifier,createPrivateFileCsrfVerifier} from '../../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../../security/session-request-admission.ts';
import type {createSessionLifecycle} from '../../security/session-lifecycle.ts';
import type {SessionDatabaseConfiguration} from '../../security/session-database.ts';
import {createTrustedTransport} from '../../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../../security/trusted-transport.ts';
import {privateJsonResponse,readFlatJsonBody} from '../../security/private-http.ts';
import {createSupplierOriginalAccess,parseSupplierOriginalRecord} from './supplier-bill-original-workflow.ts';
import type {createReceiptObjectStore} from './receipt-object-store.ts';
import {createSupplierOriginalDirectory} from './supplier-bill-original-directory.ts';
import type {createSupplierOriginalDispatcher} from './supplier-bill-original-directory.ts';

export const supplierOriginalPrefix='/api/business/supplier-original/';
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export type SyntheticSupplierOriginalRuntime=Readonly<{
 objects:ReturnType<typeof createReceiptObjectStore>;
 stagingOrigin:string;
 dispatch:ReturnType<typeof createSupplierOriginalDispatcher>;
}>;
const fields={
 reserve:['originalId','billId','billRevision','recoveryEpoch','operationId','contentType','byteSize'],
 verify:['originalId','operationId'],status:['originalId'],preview:['originalId'],
} as const;
export const supplierOriginalFailure=(status=400)=>privateJsonResponse({error:'SUPPLIER_ORIGINAL_REQUEST_UNCONFIRMED'},status);
function check(value:unknown):asserts value{if(!value)throw Error('SUPPLIER_ORIGINAL_REQUEST_UNCONFIRMED');}

export function createSupplierBillOriginalHttp(config:Config,provider:Parameters<typeof createSessionLifecycle>[1],
 tokens:Parameters<typeof createSessionLifecycle>[2],financeConnectionString:string,runtime:SyntheticSupplierOriginalRuntime){
 check(config.environment==='test'&&uuid(config.businessId));
 const storage=new URL(runtime.stagingOrigin);
 check(storage.origin===runtime.stagingOrigin&&storage.hostname==='127.0.0.1'&&storage.port
  &&['http:','https:'].includes(storage.protocol)&&typeof runtime.dispatch==='function');
 const resolve=createTrustedTransport(config),csrf=createSessionCsrfVerifier(config),fileCsrf=createPrivateFileCsrfVerifier(config);
 const admit=createSessionRequestAdmission(config),directory=createSupplierOriginalDirectory(config,provider,tokens,financeConnectionString);
 const access=createSupplierOriginalAccess(directory,runtime.objects);
 const businessId=config.businessId;
 let binary=0;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let started=false,held=false;
  try{
   resolve(request,peer);
   const url=new URL(request.url),action=url.pathname.slice(supplierOriginalPrefix.length);
   if(url.search||url.hash||!url.pathname.startsWith(supplierOriginalPrefix)||(action!=='upload'&&!Object.hasOwn(fields,action)))return supplierOriginalFailure(404);
   if(request.method!=='POST')return supplierOriginalFailure(405);
   if(request.headers.has('range'))return supplierOriginalFailure(416);
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(95000)]);
   const bounded=new Request(request,{signal}),credential=readBrowserCookies(bounded.headers).session;
   check(credential);
   await (action==='upload'?fileCsrf:csrf)(bounded,credential,signal);
   if(!await admit(credential,'ordinary',signal))return supplierOriginalFailure(429);
   const input=action==='upload'?{originalId:bounded.headers.get('x-crest-supplier-original')}:
    await readFlatJsonBody(bounded,fields[action as keyof typeof fields],4096);
   const id=input.originalId;
   check(uuid(id));
   if(action==='upload'||action==='preview'){
    if(binary>=2)return supplierOriginalFailure(429);
    binary++;held=true;
   }
   if(action==='reserve'){
    check('recoveryEpoch'in input&&uuid(input.recoveryEpoch)&&uuid(input.operationId)&&uuid(input.billId)&&version(input.billRevision)
     &&fileTypes.includes(input.contentType as FileType)&&typeof input.byteSize==='number'&&Number.isSafeInteger(input.byteSize)
     &&input.byteSize>=1&&input.byteSize<=maximumFileBytes);
    started=true;
    const result=await directory.reserve(credential,[input.recoveryEpoch,input.operationId,id,input.billId,input.billRevision,input.contentType,input.byteSize],signal);
    check(exact(result,['state','receipt'])&&result.state==='committed');
   }
   if(action==='upload'){
    const record=parseSupplierOriginalRecord(await directory.read(credential,businessId,id,signal),businessId,id);
    const reservation=record.reservation;
    check(record.candidate===null&&bounded.body&&bounded.headers.get('content-type')===reservation.declaredType
     &&bounded.headers.get('content-length')===String(reservation.byteSize));
    const capability=(await access.upload(credential,businessId,id,signal)).forUpload(),destination=new URL(capability.url);
    check(destination.origin===storage.origin&&!destination.username&&!destination.password&&!destination.hash);
    const body=boundedFileStream(bounded.body,reservation.byteSize,signal);
    started=true;
    const response=await fetch(destination,{method:'PUT',headers:{...capability.headers,'content-length':String(reservation.byteSize)},
     signal,body,duplex:'half',cache:'no-store',redirect:'error'} as RequestInit);
    void response.body?.cancel().catch(()=>undefined);
    check(response.ok&&!signal.aborted);
    return privateJsonResponse({originalId:id,state:'uploaded'});
   }
   if(action==='verify'){
    check('operationId'in input&&uuid(input.operationId));
    started=true;
    await runtime.dispatch(credential,businessId,id,input.operationId,signal);
   }
   if(action==='preview')return await access.download(credential,businessId,id,'preview',signal);
   const current=await directory.read(credential,businessId,id,signal);
   if(action==='status'&&exact(current,['state'])&&current.state==='absent')return privateJsonResponse({originalId:id,state:'absent'});
   const record=parseSupplierOriginalRecord(current,businessId,id);
   return privateJsonResponse({originalId:id,billId:record.reservation.expenseId,billRevision:record.reservation.expenseRevision,
    state:record.candidate?'available':'reserved',fileSha256:record.candidate?.original.sha256??null});
  }catch{return supplierOriginalFailure(started?503:400);}
  finally{if(held)binary--;}
 };
}
