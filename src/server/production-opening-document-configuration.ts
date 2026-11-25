import 'server-only';
import {createHash} from 'node:crypto';
import {createR2ReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';
import {parseProductionReceiptConfiguration,receiptStorageBinding} from './production-receipt-configuration.ts';
import type {ProductionReceiptConfiguration} from './production-receipt-configuration.ts';
import {createOpeningDocumentWorkerClient} from './receipt-worker-transport.ts';

export type ProductionOpeningDocumentConfiguration=ProductionReceiptConfiguration;
// Separate purpose binding prevents a supplier/expense worker pointed at the
// same physical bucket from acknowledging an opening-document dispatch.
export function openingDocumentStorageBinding(storage:R2ObjectConfiguration,businessId:string){
 return createHash('sha256').update('crest.opening-document.storage.v1\0').update(receiptStorageBinding(storage,businessId)).digest('hex');
}
export function parseProductionOpeningDocumentConfiguration(input:unknown):ProductionOpeningDocumentConfiguration{
 try{return parseProductionReceiptConfiguration(input);}catch{throw Error('PRODUCTION_OPENING_DOCUMENT_CONFIGURATION_REQUIRED');}
}
// This constructs the web-side storage/transport only. Startup must separately
// authorize the registered release and compose a real isolated document worker.
export async function openProductionOpeningDocumentRuntime(input:ProductionOpeningDocumentConfiguration,businessId:string,read:(path:string,limit:number,privateFile:boolean)=>Promise<Buffer>){
 let storage:ReturnType<typeof createR2ReceiptObjectStore>|undefined,worker:ReturnType<typeof createOpeningDocumentWorkerClient>|undefined;
 try{
  const config=parseProductionOpeningDocumentConfiguration(input),target=config.worker;
  const [key,cert,ca]=await Promise.all([read(target.keyFile,65536,true),read(target.certFile,65536,false),read(target.caFile,65536,false)]);
  worker=createOpeningDocumentWorkerClient({origin:target.origin,businessId,storageBinding:openingDocumentStorageBinding(config.storage,businessId),serverFingerprint:target.serverFingerprint,tls:{key,cert,ca}});
  storage=createR2ReceiptObjectStore(config.storage);const ownedStore=storage,ownedWorker=worker;
  return Object.freeze({objects:ownedStore.objects,stagingOrigin:ownedStore.stagingOrigin,dispatch:ownedWorker.dispatch,close(){ownedWorker.close();ownedStore.close();}});
 }catch{worker?.close();storage?.close();throw Error('PRODUCTION_OPENING_DOCUMENT_CONFIGURATION_REQUIRED');}
}
