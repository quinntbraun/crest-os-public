import 'server-only';
import {createServer,request} from 'node:https';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {checkServerIdentity,createSecureContext,TLSSocket} from 'node:tls';
import {parseEvidenceJson} from '../security/provider-evidence-json.ts';
import type {ReceiptDispatch} from '../bookkeeping/expenses/receipt-http.ts';
import type {DropoffPhotoScope} from '../operations/dropoff-photo-workflow.ts';

const maximumBytes=1024,deadlineMs=85000;
type WorkerKind='receipt'|'custody-photo'|'supplier-original'|'opening-document';
const routes:Readonly<Record<WorkerKind,string>>={'receipt':'/v1/receipts/verify','custody-photo':'/v1/custody-photos/verify','supplier-original':'/v1/supplier-originals/verify','opening-document':'/v1/opening-documents/verify'};
const jobIds:Readonly<Record<WorkerKind,readonly [string,string]>>={'receipt':['receiptId','operationId'],'custody-photo':['jobVehicleId','photoId'],'supplier-original':['originalId','operationId'],'opening-document':['documentId','operationId']};
type WorkerClientConfiguration=Readonly<{origin:string;businessId:string;storageBinding:string;serverFingerprint:string;tls:TlsMaterial}>;
type WorkerServerConfiguration=Readonly<{host:string;businessId:string;storageBinding:string;clientFingerprint:string;tls:TlsMaterial}>;
export type CustodyPhotoDispatch=(credential:string,scope:DropoffPhotoScope,signal:AbortSignal)=>Promise<unknown>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fingerprint=/^[a-f0-9]{64}$/;
export class ReceiptWorkerTransportError extends Error{
 constructor(){super('RECEIPT_WORKER_UNCONFIRMED');this.name='ReceiptWorkerTransportError';}
}
function require(value:unknown):asserts value{if(!value)throw new ReceiptWorkerTransportError();}
type TlsMaterial=Readonly<{key:Buffer;cert:Buffer;ca:Buffer}>;
type WorkerJob=Readonly<{credential:string;businessId:string;firstId:string;secondId:string}>;
function material(input:TlsMaterial){
 const value={key:Buffer.from(input.key),cert:Buffer.from(input.cert),ca:Buffer.from(input.ca)};
 require(Object.values(value).every(bytes=>bytes.length>0&&bytes.length<=65536));
 createSecureContext({...value,minVersion:'TLSv1.2'});return value;
}
function job(value:unknown,businessId:string,storageBinding:string,kind:WorkerKind):WorkerJob{
 require(value!==null&&typeof value==='object'&&!Array.isArray(value));
 const ids=jobIds[kind];
 const input=value as Record<string,unknown>,fields=['version','credential','businessId','storageBinding',...ids];
 require(Object.keys(input).length===fields.length&&fields.every(field=>Object.hasOwn(input,field))&&input.version===1);
 require(input.businessId===businessId&&input.storageBinding===storageBinding&&[input.businessId,input[ids[0]],input[ids[1]]].every(value=>typeof value==='string'&&uuid.test(value)));
 require(typeof input.credential==='string'&&/^[A-Za-z0-9_-]{43}$/.test(input.credential)&&Buffer.from(input.credential,'base64url').toString('base64url')===input.credential);
 return Object.freeze({credential:input.credential,businessId,firstId:input[ids[0]] as string,secondId:input[ids[1]] as string});
}
function wireJob(credential:string,businessId:string,storageBinding:string,firstId:string,secondId:string,kind:WorkerKind){
 const ids=jobIds[kind],input={version:1,credential,businessId,storageBinding,[ids[0]]:firstId,[ids[1]]:secondId};
 job(input,businessId,storageBinding,kind);return input;
}
function parse(bytes:Uint8Array){return parseEvidenceJson(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));}
async function boundedBody(message:IncomingMessage,maximum:number,signal:AbortSignal){
 const chunks:Buffer[]=[];let size=0;
 const abort=()=>message.destroy(new ReceiptWorkerTransportError());
 signal.addEventListener('abort',abort,{once:true});
 try{
  require(!signal.aborted);
  for await(const part of message){require(!signal.aborted&&part instanceof Uint8Array);size+=part.length;require(size<=maximum);chunks.push(Buffer.from(part));}
  require(!signal.aborted&&message.complete);return Buffer.concat(chunks,size);
 }finally{signal.removeEventListener('abort',abort);}
}
function peerFingerprint(socket:TLSSocket){return socket.getPeerCertificate().fingerprint256?.replaceAll(':','').toLowerCase();}

// Web-side transport only: no decoder executable, Docker socket, object keys or
// candidate metadata. TLS verifies the hostname/CA AND the pinned worker leaf.
function createFileWorkerClient(config:WorkerClientConfiguration,kind:WorkerKind){
 try{
  const origin=new URL(config.origin);require(origin.protocol==='https:'&&origin.origin===config.origin&&!origin.username&&!origin.password&&uuid.test(config.businessId)&&fingerprint.test(config.serverFingerprint));
  require(fingerprint.test(config.storageBinding));
  const tls=material(config.tls),businessId=config.businessId,pin=config.serverFingerprint,storageBinding=config.storageBinding,shutdown=new AbortController(),route=routes[kind];
  let active=false;
  const dispatch:ReceiptDispatch=async(credential,requestedBusiness,receiptId,operationId,external)=>{
   let body:Buffer|undefined;
   try{
    require(!active&&requestedBusiness===businessId&&!external.aborted&&!shutdown.signal.aborted);
    body=Buffer.from(JSON.stringify(wireJob(credential,businessId,storageBinding,receiptId,operationId,kind)));
    require(body.length<=maximumBytes);active=true;
    const signal=AbortSignal.any([external,shutdown.signal,AbortSignal.timeout(deadlineMs)]);
    await new Promise<void>((resolve,reject)=>{
     const fail=()=>reject(new ReceiptWorkerTransportError());
     const outgoing=request(new URL(route,origin),{method:'POST',...tls,agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',signal,
      headers:{'content-type':'application/json','content-length':String(body!.length)},
      checkServerIdentity:(hostname,certificate)=>checkServerIdentity(hostname,certificate)??(certificate.fingerprint256?.replaceAll(':','').toLowerCase()===pin?undefined:new ReceiptWorkerTransportError())},incoming=>{
       void (async()=>{
        try{
         require(incoming.statusCode===200&&incoming.headers['content-type']==='application/json');
         const value=parse(await boundedBody(incoming,64,signal));
         require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'state')&&(value as {state:unknown}).state==='verified');
         require(!signal.aborted);resolve();
        }catch{incoming.destroy();fail();}
       })();
      });
     outgoing.once('error',fail);outgoing.end(body);
    });
   }catch{throw new ReceiptWorkerTransportError();}
   finally{body?.fill(0);if(body)active=false;}
  };
  return Object.freeze({dispatch,close(){shutdown.abort();}});
 }catch{throw new ReceiptWorkerTransportError();}
}
export function createReceiptWorkerClient(config:WorkerClientConfiguration){return createFileWorkerClient(config,'receipt');}
export function createSupplierWorkerClient(config:WorkerClientConfiguration){return createFileWorkerClient(config,'supplier-original');}
export function createOpeningDocumentWorkerClient(config:WorkerClientConfiguration){return createFileWorkerClient(config,'opening-document');}
export function createPhotoWorkerClient(config:WorkerClientConfiguration){
 const client=createFileWorkerClient(config,'custody-photo');
 return Object.freeze({dispatch:((credential,scope,signal)=>client.dispatch(credential,scope.businessId,scope.jobVehicleId,scope.photoId,signal)) as CustodyPhotoDispatch,close:client.close});
}

// Isolated-host transport. The supplied dispatcher must use the real session,
// recovery-fenced reservation and isolated decoder; a transport success alone
// never creates attachment availability. The web app re-reads committed state.
function createFileWorkerServer(config:WorkerServerConfiguration,dispatch:ReceiptDispatch,kind:WorkerKind){
 try{
  require(uuid.test(config.businessId)&&fingerprint.test(config.clientFingerprint)&&fingerprint.test(config.storageBinding)&&typeof dispatch==='function');
  const host=new URL('https://'+config.host);require(host.host===config.host&&host.pathname==='/'&&!host.username&&!host.password&&!host.search&&!host.hash);
  const tls=material(config.tls),businessId=config.businessId,pin=config.clientFingerprint,expectedHost=config.host,storageBinding=config.storageBinding,route=routes[kind];
  const shutdown=new AbortController();let active=false;
  const pending=new Set<Promise<void>>();
  const server=createServer({...tls,minVersion:'TLSv1.2',requestCert:true,rejectUnauthorized:true,maxHeaderSize:4096,handshakeTimeout:5000,connectionsCheckingInterval:1000},(incoming,outgoing)=>{
   const running=handle(incoming,outgoing);pending.add(running);void running.then(()=>pending.delete(running),()=>{pending.delete(running);outgoing.destroy();});
  });
  server.headersTimeout=5000;server.requestTimeout=10000;server.keepAliveTimeout=1000;server.setTimeout(deadlineMs+5000,socket=>socket.destroy());server.maxConnections=8;server.maxRequestsPerSocket=1;
  server.on('upgrade',(_request,socket)=>socket.destroy());
  server.on('clientError',(_error,socket)=>socket.destroy());
  const respond=(response:ServerResponse,status:number)=>{
   if(response.destroyed)return;
   const body=JSON.stringify({state:status===200?'verified':'unconfirmed'});
   response.writeHead(status,{'content-type':'application/json','content-length':Buffer.byteLength(body),'cache-control':'private, no-store','content-security-policy':"default-src 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','connection':'close'});response.end(body);
  };
  async function handle(incoming:IncomingMessage,outgoing:ServerResponse){
   let acquired=false,bytes:Buffer|undefined;
   const disconnected=new AbortController(),signal=AbortSignal.any([shutdown.signal,disconnected.signal,AbortSignal.timeout(deadlineMs)]);
   const close=()=>{if(!outgoing.writableFinished)disconnected.abort();};
   outgoing.once('close',close);
   try{
    const socket=incoming.socket;require(socket instanceof TLSSocket&&socket.authorized&&peerFingerprint(socket)===pin);
    const seen=new Set<string>();for(let index=0;index<incoming.rawHeaders.length;index+=2){const name=incoming.rawHeaders[index]!.toLowerCase();require(!seen.has(name));seen.add(name);}
    require(incoming.method==='POST'&&incoming.url===route&&incoming.headers.host===expectedHost&&incoming.headers['content-type']==='application/json'&&!incoming.headers.origin&&!incoming.headers.cookie&&!incoming.headers.authorization&&!incoming.headers['transfer-encoding']);
    const length=incoming.headers['content-length'];require(typeof length==='string'&&/^[1-9]\d{0,3}$/.test(length)&&Number(length)<=maximumBytes);
    if(active){incoming.resume();respond(outgoing,503);return;}
    active=true;acquired=true;
    bytes=await boundedBody(incoming,maximumBytes,signal);require(bytes.length===Number(length));const input=job(parse(bytes),businessId,storageBinding,kind);bytes.fill(0);
    await dispatch(input.credential,input.businessId,input.firstId,input.secondId,signal);
    require(!signal.aborted);respond(outgoing,200);
   }catch{incoming.resume();respond(outgoing,503);}
   finally{bytes?.fill(0);if(acquired)active=false;outgoing.off('close',close);}
  }
  server.once('close',()=>shutdown.abort());
  return Object.freeze({server,async close(){shutdown.abort();const closed=new Promise<void>((resolve,reject)=>server.close(error=>error?reject(new ReceiptWorkerTransportError()):resolve()));server.closeAllConnections();await Promise.all([closed,...pending]);}});
 }catch{throw new ReceiptWorkerTransportError();}
}
export function createReceiptWorkerServer(config:WorkerServerConfiguration,dispatch:ReceiptDispatch){return createFileWorkerServer(config,dispatch,'receipt');}
export function createSupplierWorkerServer(config:WorkerServerConfiguration,dispatch:ReceiptDispatch){return createFileWorkerServer(config,dispatch,'supplier-original');}
export function createOpeningDocumentWorkerServer(config:WorkerServerConfiguration,dispatch:ReceiptDispatch){return createFileWorkerServer(config,dispatch,'opening-document');}
export function createPhotoWorkerServer(config:WorkerServerConfiguration,dispatch:CustodyPhotoDispatch){
 return createFileWorkerServer(config,async(credential,businessId,jobVehicleId,photoId,signal)=>{await dispatch(credential,Object.freeze({businessId,jobVehicleId,photoId}),signal);},'custody-photo');
}
