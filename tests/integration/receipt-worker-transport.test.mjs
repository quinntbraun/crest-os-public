// Real TLS sockets/certificate verification and bounded HTTP transport. The
// dispatcher is a deliberate seam: this file proves neither MFA nor decoding.
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {createServer} from 'node:net';
import {request} from 'node:https';
import {X509Certificate,randomUUID,randomBytes} from 'node:crypto';
import {browserTestTls} from '../support/browser-test-tls.mjs';
import {createReceiptWorkerServer,createReceiptWorkerClient,createPhotoWorkerServer,createPhotoWorkerClient,createSupplierWorkerServer,createSupplierWorkerClient} from '../../src/server/receipt-worker-transport.ts';

let serverTls,clientTls,otherTls;
const businessId=randomUUID(),receiptId=randomUUID(),operationId=randomUUID(),credential=randomBytes(32).toString('base64url');
const storageBinding=randomBytes(32).toString('hex');
const pin=tls=>new X509Certificate(tls.cert).fingerprint256.replaceAll(':','').toLowerCase();
before(async()=>{serverTls=await browserTestTls();clientTls=await browserTestTls();otherTls=await browserTestTls();});
after(()=>{serverTls?.key.fill(0);clientTls?.key.fill(0);otherTls?.key.fill(0);});
async function fixture(dispatch,clientFingerprint,kind='receipt'){
 // Reserve an OS-selected loopback port, release it, then bind this exact port.
 // A collision fails this fixture instead of silently changing its identity.
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;
 await new Promise(resolve=>reservation.close(resolve));
 const host=`localhost:${port}`,factory={'receipt':createReceiptWorkerServer,'custody-photo':createPhotoWorkerServer,'supplier-original':createSupplierWorkerServer}[kind],worker=factory({host,businessId,storageBinding,clientFingerprint:clientFingerprint??pin(clientTls),tls:{...serverTls,ca:clientTls.cert}},dispatch);
 await new Promise((resolve,reject)=>{worker.server.once('error',reject);worker.server.listen(port,'127.0.0.1',resolve);});
 const config={origin:`https://${host}`,businessId,storageBinding,serverFingerprint:pin(serverTls),tls:{...clientTls,ca:serverTls.cert}};
 const clients=[];let stopping;
 return {worker,config,client(patch={}){const client={'receipt':createReceiptWorkerClient,'custody-photo':createPhotoWorkerClient,'supplier-original':createSupplierWorkerClient}[kind]({...config,...patch});clients.push(client);return client;},async close(){for(const client of clients)client.close();stopping??=worker.close();await stopping;}};
}
const signal=()=>AbortSignal.timeout(5000);
test('real mutual TLS delivers only scoped identifiers and credential, then confirms the exact bounded reply',async()=>{
 const calls=[],f=await fixture(async(...args)=>{calls.push(args.slice(0,4));assert.equal(args[4].aborted,false);});
 try{await f.client().dispatch(credential,businessId,receiptId,operationId,signal());assert.deepEqual(calls,[[credential,businessId,receiptId,operationId]]);}finally{await f.close();}
});
test('a wrong worker leaf pin fails before any dispatcher receives credentials',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;});
 try{await assert.rejects(f.client({serverFingerprint:pin(otherTls)}).dispatch(credential,businessId,receiptId,operationId,signal()),/RECEIPT_WORKER_UNCONFIRMED/);assert.equal(calls,0);}finally{await f.close();}
});
test('an untrusted client certificate and a trusted certificate with a wrong leaf pin cannot dispatch',async()=>{
 for(const wrongPin of [false,true]){
  let calls=0;const f=await fixture(async()=>{calls++;},wrongPin?pin(otherTls):undefined);
  try{
   const client=f.client(wrongPin?{}:{tls:{...otherTls,ca:serverTls.cert}});
   await assert.rejects(client.dispatch(credential,businessId,receiptId,operationId,signal()),/RECEIPT_WORKER_UNCONFIRMED/);assert.equal(calls,0);
  }finally{await f.close();}
 }
});
function raw(config,body,patch={},route='/v1/receipts/verify'){
 return new Promise((resolve,reject)=>{
  const outgoing=request(new URL(route,config.origin),{method:'POST',...config.tls,rejectUnauthorized:true,agent:false,signal:signal(),headers:{'content-type':'application/json','content-length':String(Buffer.byteLength(body)),...patch}},incoming=>{
   const chunks=[];incoming.on('data',bytes=>chunks.push(bytes));incoming.on('error',reject);incoming.on('end',()=>resolve({status:incoming.statusCode,body:Buffer.concat(chunks).toString()}));
  });outgoing.once('error',reject);outgoing.end(body);
 });
}
test('foreign business, duplicate names, extra candidate data, excessive bodies and browser cookies never dispatch',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;}),input={version:1,credential,businessId,storageBinding,receiptId,operationId};
 try{
  for(const body of [JSON.stringify({...input,businessId:randomUUID()}),JSON.stringify({...input,storageBinding:randomBytes(32).toString('hex')}),JSON.stringify({...input,candidate:{status:'Available'}}),JSON.stringify(input).replace('{','{"version":1,'),' '.repeat(1025)]){
   const result=await raw(f.config,body);assert.equal(result.status,503);assert.deepEqual(JSON.parse(result.body),{state:'unconfirmed'});
  }
  assert.equal((await raw(f.config,JSON.stringify(input),{cookie:'session=browser'})).status,503);assert.equal(calls,0);
 }finally{await f.close();}
});
test('one active worker request rejects concurrent work without executing a second operation',async()=>{
 let release,entered,calls=0;const started=new Promise(resolve=>{entered=resolve;}),barrier=new Promise(resolve=>{release=resolve;});
 const f=await fixture(async()=>{calls++;entered();await barrier;});
 try{
  const first=f.client().dispatch(credential,businessId,receiptId,operationId,signal());await started;
  await assert.rejects(f.client().dispatch(credential,businessId,randomUUID(),randomUUID(),signal()),/RECEIPT_WORKER_UNCONFIRMED/);assert.equal(calls,1);release();await first;
 }finally{release();await f.close();}
});
test('caller cancellation aborts the active worker signal and never reports success',async()=>{
 let entered,stopped;const started=new Promise(resolve=>{entered=resolve;}),ended=new Promise(resolve=>{stopped=resolve;});
 const f=await fixture(async(_credential,_business,_receipt,_operation,current)=>{entered();await new Promise(resolve=>current.addEventListener('abort',resolve,{once:true}));stopped();throw Error('cancelled');});
 try{
  const controller=new AbortController(),result=f.client().dispatch(credential,businessId,receiptId,operationId,controller.signal),refused=assert.rejects(result,/RECEIPT_WORKER_UNCONFIRMED/);
  await started;controller.abort();await refused;await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(Error('Worker cancellation missing')),2000).unref())]);
 }finally{await f.close();}
});
test('worker shutdown waits for the active dispatch cleanup to settle',{timeout:5000},async()=>{
 let entered,aborted,release;const started=new Promise(resolve=>{entered=resolve;}),stopped=new Promise(resolve=>{aborted=resolve;}),cleanup=new Promise(resolve=>{release=resolve;});
 const f=await fixture(async(_credential,_business,_receipt,_operation,current)=>{entered();await new Promise(resolve=>current.addEventListener('abort',resolve,{once:true}));aborted();await cleanup;});
 try{
  const result=f.client().dispatch(credential,businessId,receiptId,operationId,signal()),refused=assert.rejects(result,/RECEIPT_WORKER_UNCONFIRMED/);await started;
  let closed=false;const closing=f.close().then(()=>{closed=true;});await stopped;assert.equal(closed,false);release();await closing;await refused;
 }finally{release();await f.close();}
});
test('the photo protocol delivers only the exact immutable custody scope over mutual TLS',async()=>{
 const scope={businessId,jobVehicleId:randomUUID(),photoId:randomUUID()},calls=[];
 const f=await fixture(async(currentCredential,currentScope,currentSignal)=>{assert.equal(currentSignal.aborted,false);assert.equal(Object.isFrozen(currentScope),true);calls.push([currentCredential,currentScope]);},undefined,'custody-photo');
 try{await f.client().dispatch(credential,scope,signal());assert.deepEqual(calls,[[credential,scope]]);}finally{await f.close();}
});
test('photo workers refuse receipt endpoints, receipt payloads, foreign storage and candidate metadata',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;},undefined,'custody-photo'),input={version:1,credential,businessId,storageBinding,jobVehicleId:randomUUID(),photoId:randomUUID()};
 try{
  const receipt={version:1,credential,businessId,storageBinding,receiptId,operationId};
  for(const body of [receipt,{...input,storageBinding:randomBytes(32).toString('hex')},{...input,candidate:{status:'Available'}}])assert.equal((await raw(f.config,JSON.stringify(body),{},'/v1/custody-photos/verify')).status,503);
  assert.equal((await raw(f.config,JSON.stringify(receipt))).status,503);assert.equal(calls,0);
 }finally{await f.close();}
});
test('the supplier protocol delivers exact original/operation IDs over mutual TLS',async()=>{
 const originalId=randomUUID(),calls=[],f=await fixture(async(...args)=>{calls.push(args.slice(0,4));},undefined,'supplier-original');
 try{await f.client().dispatch(credential,businessId,originalId,operationId,signal());assert.deepEqual(calls,[[credential,businessId,originalId,operationId]]);}finally{await f.close();}
});
test('supplier workers reject receipt/photo payloads, wrong storage and candidate metadata',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;},undefined,'supplier-original'),input={version:1,credential,businessId,storageBinding,originalId:randomUUID(),operationId};
 try{
  for(const value of [{version:1,credential,businessId,storageBinding,receiptId,operationId},{version:1,credential,businessId,storageBinding,jobVehicleId:randomUUID(),photoId:randomUUID()},{...input,storageBinding:randomBytes(32).toString('hex')},{...input,candidate:{status:'Available'}}])assert.equal((await raw(f.config,JSON.stringify(value),{},'/v1/supplier-originals/verify')).status,503);
  assert.equal((await raw(f.config,JSON.stringify(input))).status,503);assert.equal(calls,0);
 }finally{await f.close();}
});
