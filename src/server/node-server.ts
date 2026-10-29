import 'server-only';
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
import {quoteResponseLimit} from '../commercial/quote-storage-contract.ts';
import {createHoldHttp,holdFailureResponse} from '../operations/appointment-hold-http.ts';
import {createCustomerHttp,customerFailureResponse} from '../customer/customer-http.ts';
import {createCustomerAddressHttp,addressFailureResponse} from '../customer/customer-address-http.ts';

import {createVehicleHttp,vehicleFailureResponse} from '../customer/vehicle-http.ts';
import {createAssociationHttp,associationFailureResponse} from '../customer/association-http.ts';
import {createLeadHttp,leadFailureResponse} from '../customer/lead-http.ts';
import {createLeadSourceHttp,leadSourceFailureResponse} from '../customer/lead-source-http.ts';
import {createOriginalOperationHttp,originalOperationFailureResponse} from '../security/original-operation-http.ts';
import {createSourceExportHttp,sourceExportFailureResponse} from '../security/source-export-http.ts';
import {createSourceExportDownloadHttp,sourceExportDownloadFailureResponse} from '../security/source-export-download-http.ts';
import {isSourceExportDownloadResponse,writeSourceExportDownloadResponse,discardSourceExportDownloadResponse} from './source-export-download-response.ts';

export type AuthenticationConfiguration=Readonly<{
  configuration:Omit<Parameters<typeof createAuthenticationHttp>[0],'origin'|'environment'>;
  provider:Parameters<typeof createAuthenticationHttp>[1];tokens:Parameters<typeof createAuthenticationHttp>[2];
}>;
export type SourceExportConfiguration=Readonly<{appReleaseId:string;store:NonNullable<Parameters<typeof createSourceExportDownloadHttp>[3]>}>;
export type NodeConfiguration=Readonly<{origin:string;environment:'production'|'test';tls?:Readonly<{key:Buffer;cert:Buffer}>;authentication?:AuthenticationConfiguration;business?:Readonly<{businessId:string}>;customers?:boolean;vehicles?:boolean;associations?:boolean;leads?:boolean;leadConversions?:boolean;operationResolution?:boolean;syntheticCatalog?:boolean;syntheticQuotes?:boolean;syntheticAppointmentHolds?:boolean;sourceExports?:SourceExportConfiguration}>;
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
  return Object.freeze({url,authentication:decoded==='/api/auth'||decoded.startsWith('/api/auth/'),business:decoded==='/api/business'||decoded.startsWith('/api/business/')});
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
async function writePrivateResponse(outgoing:ServerResponse,response:Response,signal:AbortSignal,limit:number):Promise<void>{
  let finished=false;
  try{
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
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
    const body=Buffer.concat(chunks);
    if(signal.aborted||outgoing.destroyed)throw new Error();
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(fail,5000);timer.unref();
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
    try{await settleAuthenticationResponse(response,finished);}catch{console.error('AUTHENTICATION_DELIVERY_CLEANUP_FAILED');}
  }
}

export function bindApplicationHandler(server:Server,config:NodeConfiguration,pages:PageHandler):void{
  const {origin,environment,authentication,business,customers,vehicles,associations,leads,leadConversions,operationResolution,sourceExports,syntheticCatalog,syntheticQuotes,syntheticAppointmentHolds}=config;
  const url=new URL(origin);
  if(syntheticCatalog!==undefined&&(typeof syntheticCatalog!=='boolean'||syntheticCatalog&&(environment!=='test'||!authentication||!business)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticQuotes!==undefined&&(typeof syntheticQuotes!=='boolean'||syntheticQuotes&&(environment!=='test'||!authentication||!business)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(syntheticAppointmentHolds!==undefined&&(typeof syntheticAppointmentHolds!=='boolean'||syntheticAppointmentHolds&&(environment!=='test'||!authentication||!business||operationResolution!==true)))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(sourceExports!==undefined&&(!sourceExports||typeof sourceExports!=='object'||Array.isArray(sourceExports)||!business||!authentication||typeof sourceExports.appReleaseId!=='string'||!/^([a-f0-9]{40})$/.test(sourceExports.appReleaseId)||typeof sourceExports.store?.readVerified!=='function'))throw Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(operationResolution!==undefined&&typeof operationResolution!=='boolean'||operationResolution&&(!business||!authentication))throw new Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  if(url.origin!==origin||url.username||url.password||!['http:','https:'].includes(url.protocol)||!['production','test'].includes(environment)
    ||business&&!authentication||customers!==undefined&&typeof customers!=='boolean'||customers&&(!business||!authentication)||vehicles!==undefined&&typeof vehicles!=='boolean'||vehicles&&(!business||!authentication)||associations!==undefined&&typeof associations!=='boolean'||associations&&(!business||!authentication)||leadConversions!==undefined&&typeof leadConversions!=='boolean'||leadConversions&&!leads||leads!==undefined&&typeof leads!=='boolean'||leads&&(!business||!authentication)||authentication&&environment==='production'&&!config.tls||server.listenerCount('request'))throw new Error('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  const dispatch=authentication?createAuthenticationHttp({...authentication.configuration,origin,environment},authentication.provider,authentication.tokens):undefined;
  const dispatchBusiness=business&&authentication?createBusinessHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchServices=syntheticCatalog===true&&business&&authentication?createServiceHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,true):undefined;
  const dispatchQuotes=syntheticQuotes===true&&business&&authentication?createQuoteHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,true):undefined;
  const dispatchHolds=syntheticAppointmentHolds===true&&business&&authentication?createHoldHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,true):undefined;
  const dispatchCustomers=customers&&business&&authentication?createCustomerHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchAddresses=customers&&business&&authentication?createCustomerAddressHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchVehicles=vehicles&&business&&authentication?createVehicleHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchAssociations=associations&&business&&authentication?createAssociationHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchLeads=leads&&business&&authentication?createLeadHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,leadConversions===true):undefined;
  const dispatchLeadSources=leads&&business&&authentication?createLeadSourceHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens):undefined;
  const dispatchOriginalOperations=operationResolution===true&&business&&authentication?createOriginalOperationHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,true):undefined;
  const dispatchExports=sourceExports&&business&&authentication?createSourceExportHttp({...authentication.configuration,origin,environment,businessId:business.businessId,appReleaseId:sourceExports.appReleaseId},authentication.provider,authentication.tokens,true):undefined;
  const dispatchExportDownloads=sourceExports&&business&&authentication?createSourceExportDownloadHttp({...authentication.configuration,origin,environment,businessId:business.businessId},authentication.provider,authentication.tokens,sourceExports.store,true):undefined;
  let activeProtected=0;
  server.on('request',(incoming,outgoing)=>{void (async()=>{
    const controller=new AbortController();
    const abort=()=>controller.abort();incoming.once('aborted',abort);
    outgoing.once('close',()=>{if(!outgoing.writableFinished)abort();});
    let reserved=false,businessRequest=false,serviceRequest=false,quoteRequest=false,holdRequest=false,customerRequest=false,addressRequest=false,vehicleRequest=false,associationRequest=false,leadRequest=false,leadSourceRequest=false,originalOperationRequest=false,exportRequest=false,exportDownloadRequest=false;
    try{
      if(incoming.rawHeaders.length>256)throw new Error();
      const target=requestTarget(incoming.url,origin);
      businessRequest=target.business;
      const decoded=decodeURIComponent(target.url.pathname);customerRequest=target.business&&(decoded==='/api/business/customers'||decoded.startsWith('/api/business/customers/'));
      serviceRequest=target.business&&(decoded==='/api/business/services'||decoded.startsWith('/api/business/services/'));
      quoteRequest=target.business&&(decoded==='/api/business/quotes'||decoded.startsWith('/api/business/quotes/'));
      holdRequest=target.business&&(decoded==='/api/business/appointment-holds'||decoded.startsWith('/api/business/appointment-holds/'));
      addressRequest=customerRequest&&(decoded==='/api/business/customers/addresses'||decoded.startsWith('/api/business/customers/addresses/'));
      vehicleRequest=target.business&&(decoded==='/api/business/vehicles'||decoded.startsWith('/api/business/vehicles/'));
      associationRequest=target.business&&(decoded==='/api/business/vehicle-associations'||decoded.startsWith('/api/business/vehicle-associations/'));
      leadRequest=target.business&&(decoded==='/api/business/leads'||decoded.startsWith('/api/business/leads/'));
      leadSourceRequest=target.business&&(decoded==='/api/business/lead-sources'||decoded.startsWith('/api/business/lead-sources/'));
      originalOperationRequest=target.business&&(decoded==='/api/business/original-operations'||decoded.startsWith('/api/business/original-operations/'));
      exportRequest=target.business&&(decoded==='/api/business/exports'||decoded.startsWith('/api/business/exports/'));
      exportDownloadRequest=exportRequest&&(decoded==='/api/business/exports/downloads'||decoded.startsWith('/api/business/exports/downloads/')||decoded==='/api/business/exports/file'||decoded.startsWith('/api/business/exports/file/'));
      const exportFileRequest=decoded==='/api/business/exports/file';
      if(!target.authentication&&!target.business){await pages(incoming,outgoing);return;}
      const handler=holdRequest?dispatchHolds:quoteRequest?dispatchQuotes:serviceRequest?dispatchServices:exportRequest?(exportDownloadRequest?dispatchExportDownloads:dispatchExports):originalOperationRequest?dispatchOriginalOperations:leadSourceRequest?dispatchLeadSources:leadRequest?dispatchLeads:associationRequest?dispatchAssociations:vehicleRequest?dispatchVehicles:addressRequest?dispatchAddresses:customerRequest?dispatchCustomers:target.business?dispatchBusiness:dispatch,failure=holdRequest?holdFailureResponse:quoteRequest?quoteFailureResponse:serviceRequest?serviceFailureResponse:exportRequest?(exportDownloadRequest?sourceExportDownloadFailureResponse:sourceExportFailureResponse):originalOperationRequest?originalOperationFailureResponse:leadSourceRequest?leadSourceFailureResponse:leadRequest?leadFailureResponse:associationRequest?associationFailureResponse:vehicleRequest?vehicleFailureResponse:addressRequest?addressFailureResponse:customerRequest?customerFailureResponse:target.business?businessFailureResponse:browserFailureResponse;
      if(!handler||activeProtected>=32){await writeAuthenticationResponse(outgoing,failure(503),controller.signal);return;}
      activeProtected++;reserved=true;
      const peer=transportFromIncomingMessage(incoming),headers=new Headers();
      for(let i=0;i<incoming.rawHeaders.length;i+=2)headers.append(incoming.rawHeaders[i]!,incoming.rawHeaders[i+1]!);
      const request=new Request(target.url,{method:incoming.method,headers,signal:controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method??'')?{body:Readable.toWeb(incoming),duplex:'half'}:{})} as RequestInit);
      const response=await handler(request,peer);
      if(exportRequest)await writeSourceExportResponse(outgoing,response,controller.signal,exportFileRequest);
      else await (holdRequest?writeCustomerResponse:quoteRequest?writeQuoteResponse:originalOperationRequest?writeOriginalOperationResponse:serviceRequest||customerRequest||vehicleRequest||associationRequest||leadRequest||leadSourceRequest?writeCustomerResponse:writeAuthenticationResponse)(outgoing,response,controller.signal);
    }catch{
      if(!outgoing.destroyed&&!outgoing.headersSent)try{await writeAuthenticationResponse(outgoing,(holdRequest?holdFailureResponse:quoteRequest?quoteFailureResponse:serviceRequest?serviceFailureResponse:exportRequest?(exportDownloadRequest?sourceExportDownloadFailureResponse:sourceExportFailureResponse):originalOperationRequest?originalOperationFailureResponse:leadSourceRequest?leadSourceFailureResponse:leadRequest?leadFailureResponse:associationRequest?associationFailureResponse:vehicleRequest?vehicleFailureResponse:addressRequest?addressFailureResponse:customerRequest?customerFailureResponse:businessRequest?businessFailureResponse:browserFailureResponse)(),controller.signal);}catch{outgoing.destroy();}
      else outgoing.destroy();
    }finally{if(reserved)activeProtected--;incoming.off('aborted',abort);}
  })();});
}
