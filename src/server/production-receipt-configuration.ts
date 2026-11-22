import 'server-only';
import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {createR2ReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';
import {createR2ObjectClient} from '../files/private-object-store.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';
import {createReceiptWorkerClient} from './receipt-worker-transport.ts';

type PrivateFileReader=(path:string,limit:number,privateFile:boolean)=>Promise<Buffer>;
export type ProductionReceiptConfiguration=Readonly<{storage:R2ObjectConfiguration;worker:Readonly<{origin:string;serverFingerprint:string;keyFile:string;certFile:string;caFile:string}>}>;
function require(value:unknown):asserts value{if(!value)throw Error('PRODUCTION_RECEIPT_CONFIGURATION_REQUIRED');}
function exact(value:unknown,fields:readonly string[]):asserts value is Record<string,unknown>{require(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field)));}
export function receiptStorageBinding(storage:R2ObjectConfiguration,businessId:string){
 require(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(businessId));
 const config=parseReceiptStorageConfiguration(storage);
 return createHash('sha256').update('crest.receipt.storage.v1\0').update(businessId).update('\0').update(config.accountId).update('\0').update(config.bucket).digest('hex');
}
export function parseReceiptStorageConfiguration(input:unknown):R2ObjectConfiguration{
 exact(input,['accountId','bucket','accessKeyId','secretAccessKey']);
 require(Object.values(input).every(value=>typeof value==='string'));
 const storage=Object.freeze({...input}) as R2ObjectConfiguration;
 // Reuse the fixed endpoint/credential validator without performing cloud IO.
 const client=createR2ObjectClient(storage);client.destroy();return storage;
}
export function parseProductionReceiptConfiguration(input:unknown):ProductionReceiptConfiguration{
 try{
  exact(input,['storage','worker']);const storage=parseReceiptStorageConfiguration(input.storage),worker=input.worker;
  exact(worker,['origin','serverFingerprint','keyFile','certFile','caFile']);
  require(typeof worker.origin==='string'&&worker.origin.length<=2048);const origin=new URL(worker.origin);
  require(origin.protocol==='https:'&&origin.origin===worker.origin&&!origin.username&&!origin.password);
  require(typeof worker.serverFingerprint==='string'&&/^[a-f0-9]{64}$/.test(worker.serverFingerprint));
  for(const field of ['keyFile','certFile','caFile'])require(typeof worker[field]==='string'&&isAbsolute(worker[field])&&worker[field].length<=4096&&!/\p{Cc}/u.test(worker[field]));
  return Object.freeze({storage,worker:Object.freeze({...worker}) as ProductionReceiptConfiguration['worker']});
 }catch{throw Error('PRODUCTION_RECEIPT_CONFIGURATION_REQUIRED');}
}
export async function openProductionReceiptRuntime(input:ProductionReceiptConfiguration,businessId:string,read:PrivateFileReader){
 let storage:ReturnType<typeof createR2ReceiptObjectStore>|undefined,worker:ReturnType<typeof createReceiptWorkerClient>|undefined;
 try{
  const config=parseProductionReceiptConfiguration(input),target=config.worker;
  const [key,cert,ca]=await Promise.all([read(target.keyFile,65536,true),read(target.certFile,65536,false),read(target.caFile,65536,false)]);
  worker=createReceiptWorkerClient({origin:target.origin,businessId,storageBinding:receiptStorageBinding(config.storage,businessId),serverFingerprint:target.serverFingerprint,tls:{key,cert,ca}});
  storage=createR2ReceiptObjectStore(config.storage);
  const ownedStore=storage,ownedWorker=worker;
  return Object.freeze({objects:ownedStore.objects,stagingOrigin:ownedStore.stagingOrigin,dispatch:ownedWorker.dispatch,close(){ownedWorker.close();ownedStore.close();}});
 }catch{worker?.close();storage?.close();throw Error('PRODUCTION_RECEIPT_CONFIGURATION_REQUIRED');}
}
