import 'server-only';
import {customerUuid as uuid,customerVersion as version,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readBrowserCookies} from '../security/browser-http.ts';
import {privateJsonResponse,readFlatJsonBody} from '../security/private-http.ts';
import {createConditionPhotoCsrfVerifier,createSessionCsrfVerifier} from '../security/session-request-guard.ts';
import {createSessionRequestAdmission} from '../security/session-request-admission.ts';
import {createBusinessSettingsContextReader} from '../security/business-settings-context.ts';
import {createTrustedTransport} from '../security/trusted-transport.ts';
import type {IngressConfiguration,transportFromIncomingMessage} from '../security/trusted-transport.ts';
import type {SessionDatabaseConfiguration} from '../security/session-database.ts';
import {maximumFileBytes} from '../files/private-object-store.ts';
import type {createPrivateObjectStore} from '../files/private-object-store.ts';
import {createDropoffPhotoDirectory} from './dropoff-photo-directory.ts';
import {createDropoffPhotoAccess,parsePhotoReservation,photoStatus} from './dropoff-photo-workflow.ts';
import type {DropoffPhotoScope} from './dropoff-photo-workflow.ts';
import type {PickupPhotoBinding} from './pickup-custody-contract.ts';

export const dropoffPhotoPrefix='/api/business/scheduling/custody-photo/';
const scopeFields=['jobVehicleId','photoId'];
const fields={
 reserve:[...scopeFields,'epoch','caseId','handoff','contentType','byteSize'],
 'reserve-pickup':[...scopeFields,'epoch','caseId','handoff','contentType','byteSize','arrivalVersionId','policyId','jobVersion'],
 'reserve-return':[...scopeFields,'epoch','caseId','handoff','contentType','byteSize','arrivalVersionId','collectionId','jobVersion'],
 status:scopeFields,
 verify:scopeFields,
 file:[...scopeFields,'variant']
} as const;
type Config=SessionDatabaseConfiguration&{origin:string;ingress:IngressConfiguration;businessId:string};
export type SyntheticDropoffPhotoRuntime=Readonly<{
 objects:ReturnType<typeof createPrivateObjectStore>;
 stagingOrigin:string;
 dispatch:(credential:string,scope:DropoffPhotoScope,signal:AbortSignal)=>Promise<unknown>;
}>;
export const dropoffPhotoFailure=(status=400)=>privateJsonResponse({error:'DROPOFF_PHOTO_REQUEST_FAILED'},status);
const photoTypes=['image/jpeg','image/png','image/heic'];
function check(ok:unknown):asserts ok{if(!ok)throw Error('DROPOFF_PHOTO_REQUEST_FAILED');}

function boundedFile(body:ReadableStream<Uint8Array>,size:number,signal:AbortSignal){
 const reader=body.getReader();
 let received=0;
 return new ReadableStream<Uint8Array>({
  async pull(controller){
   try{
    signal.throwIfAborted();
    const chunk=await reader.read();
    signal.throwIfAborted();
    if(chunk.done){check(received===size);reader.releaseLock();controller.close();return;}
    received+=chunk.value.byteLength;
    check(received<=size);
    controller.enqueue(chunk.value);
   }catch{
    await reader.cancel().catch(()=>undefined);reader.releaseLock();
    controller.error(Error('DROPOFF_PHOTO_UPLOAD_UNCONFIRMED'));
   }
  },
  async cancel(){try{await reader.cancel();}finally{reader.releaseLock();}}
 });
}

// The same-origin relay passes the bytes to one server-signed staging PUT.
// No object capability, worker database login or decoder enters the browser.
export function createDropoffPhotoHttp(config:Config,provider:Parameters<typeof createDropoffPhotoDirectory>[1],
 tokens:Parameters<typeof createDropoffPhotoDirectory>[2],runtime:SyntheticDropoffPhotoRuntime,pickupEnabled=false,returnEnabled=false){
 check(typeof returnEnabled==='boolean'&&(!returnEnabled||pickupEnabled));
 const storage=new URL(runtime.stagingOrigin);
 check(config.environment==='test'&&uuid(config.businessId)&&storage.origin===runtime.stagingOrigin&&
  storage.hostname==='127.0.0.1'&&storage.port&&['http:','https:'].includes(storage.protocol));
 const resolve=createTrustedTransport(config),csrf=createSessionCsrfVerifier(config),uploadCsrf=createConditionPhotoCsrfVerifier(config);
 const admit=createSessionRequestAdmission(config);
 const directory=createDropoffPhotoDirectory(config,provider,tokens),access=createDropoffPhotoAccess(directory,runtime.objects);
 const businessSettings=createBusinessSettingsContextReader(config,provider,tokens);
 let activeUploads=0;
 return async(request:Request,peer:ReturnType<typeof transportFromIncomingMessage>)=>{
  let uploaded=false,started=false;
  try{
   resolve(request,peer);
   const url=new URL(request.url),route=url.pathname.slice(dropoffPhotoPrefix.length);
   if(!url.pathname.startsWith(dropoffPhotoPrefix)||url.search||url.hash||
    (route!=='upload'&&!Object.hasOwn(fields,route)))return dropoffPhotoFailure(404);
   if(route==='reserve-pickup'&&!pickupEnabled||route==='reserve-return'&&!returnEnabled)return dropoffPhotoFailure(404);
   if(request.method!=='POST')return dropoffPhotoFailure(405);
   if(request.headers.has('range'))return dropoffPhotoFailure(416);
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(40000)]);
   const bounded=new Request(request,{signal}),credential=readBrowserCookies(bounded.headers).session;
   check(credential);
   await (route==='upload'?uploadCsrf:csrf)(bounded,credential,signal);
   if(!await admit(credential,'ordinary',signal))return dropoffPhotoFailure(429);
   const input=route==='upload'?{jobVehicleId:request.headers.get('x-crest-job-vehicle'),photoId:request.headers.get('x-crest-photo')}:
    await readFlatJsonBody(bounded,fields[route as keyof typeof fields],4096);
   check(uuid(input.jobVehicleId)&&uuid(input.photoId));
   const scope={businessId:config.businessId,jobVehicleId:input.jobVehicleId,photoId:input.photoId};
   if(route==='reserve'||route==='reserve-pickup'||route==='reserve-return'){
    check('epoch'in input&&uuid(input.epoch)&&uuid(input.caseId)&&(input.handoff===1||input.handoff===2)&&
     typeof input.contentType==='string'&&photoTypes.includes(input.contentType)&&typeof input.byteSize==='number'&&
     Number.isSafeInteger(input.byteSize)&&input.byteSize>0&&input.byteSize<=maximumFileBytes);
    let pickup:PickupPhotoBinding|undefined;
    if(route==='reserve-pickup'){
     check(input.handoff===1&&'arrivalVersionId'in input&&uuid(input.arrivalVersionId)&&uuid(input.policyId)&&version(input.jobVersion)&&
      BigInt(input.jobVersion)<9223372036854775807n);
     pickup={arrivalVersionId:input.arrivalVersionId,policyId:input.policyId,jobVersion:input.jobVersion};
    }else if(route==='reserve-return'){
     check(input.handoff===2&&'arrivalVersionId'in input&&uuid(input.arrivalVersionId)&&uuid(input.collectionId)&&version(input.jobVersion)&&
      BigInt(input.jobVersion)<9223372036854775807n);
     pickup={arrivalVersionId:input.arrivalVersionId,collectionId:input.collectionId,jobVersion:input.jobVersion};
    }
    started=true;
    return privateJsonResponse(await directory.reserve(credential,{...scope,epoch:input.epoch,caseId:input.caseId,
     handoff:input.handoff,contentType:input.contentType,byteSize:input.byteSize},signal,pickup));
   }
   if(route==='upload'){
    if(activeUploads>=3)return dropoffPhotoFailure(429);
    activeUploads++;uploaded=true;
    const record=await directory.read(credential,scope,signal);
    check(exact(record,['reservation','original','linked'])&&record.original===null);
    const reservation=parsePhotoReservation(record.reservation,scope);
    check(request.headers.get('content-type')===reservation.declared_type&&
     request.headers.get('content-length')===String(reservation.byte_size)&&bounded.body);
    const capability=(await access.upload(credential,scope,signal)).forUpload(),destination=new URL(capability.url);
    check(destination.origin===storage.origin&&!destination.username&&!destination.password&&!destination.hash);
    const body=boundedFile(bounded.body,reservation.byte_size,signal);
    started=true;
    const reply=await fetch(destination,{method:'PUT',headers:{...capability.headers,'content-length':String(reservation.byte_size)},body,duplex:'half',
     signal,cache:'no-store',redirect:'error'} as RequestInit);
    void reply.body?.cancel().catch(()=>undefined);
    check(reply.ok&&!signal.aborted);
    return privateJsonResponse({photoId:scope.photoId,state:'uploaded'});
   }
   if(route==='verify'){started=true;await runtime.dispatch(credential,scope,signal);}
   if(route==='verify'||route==='status'){
    const state=photoStatus(await directory.read(credential,scope,signal),scope);
    check(!signal.aborted&&(route!=='verify'||state==='verified'));
    return privateJsonResponse({photoId:scope.photoId,state});
   }
   check('variant'in input&&(input.variant==='preview'||input.variant==='original'));
   const variant=input.variant,context=variant==='original'?(await businessSettings(credential,scope.businessId,signal)).forServer():null;
   if(context)check(context.writeState==='ready');
   const file=await access.download(credential,scope,variant,signal);
   try{
    const size=file.bytes.byteLength;
    if(context?.writeState==='ready')await directory.recordOriginalAccess(credential,scope,context.recoveryEpoch,
     {sha256:file.sha256,byteSize:size,contentType:file.contentType},signal);
    signal.throwIfAborted();
    const extension=file.contentType==='image/png'?'png':file.contentType==='image/heic'?'heic':'jpg';
    const suffix=variant==='preview'?'-preview':'';
    return new Response(file.bytes as BodyInit,{headers:{'content-type':file.contentType,
     'content-length':String(size),'content-disposition':`attachment; filename="condition-${scope.photoId}${suffix}.${extension}"`,
     'cache-control':'private, no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',
     'content-security-policy':"default-src 'none'; sandbox"}});
   }finally{file.bytes.fill(0);}
  }catch{return dropoffPhotoFailure(started?503:400);}
  finally{if(uploaded)activeUploads--;}
 };
}
