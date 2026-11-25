import 'server-only';
import {createHash} from 'node:crypto';
import {createR2ReceiptObjectStore} from '../bookkeeping/expenses/receipt-object-store.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';
import {parseProductionReceiptConfiguration,receiptStorageBinding} from './production-receipt-configuration.ts';
import type {ProductionReceiptConfiguration} from './production-receipt-configuration.ts';
import {createSupplierWorkerClient} from './receipt-worker-transport.ts';

export type ProductionSupplierConfiguration=ProductionReceiptConfiguration;
export function supplierStorageBinding(storage:R2ObjectConfiguration,businessId:string){
 return createHash('sha256').update('crest.supplier-original.storage.v1\0').update(receiptStorageBinding(storage,businessId)).digest('hex');
}
export function parseProductionSupplierConfiguration(input:unknown):ProductionSupplierConfiguration{
 try{return parseProductionReceiptConfiguration(input);}catch{throw Error('PRODUCTION_SUPPLIER_CONFIGURATION_REQUIRED');}
}
export async function openProductionSupplierRuntime(input:ProductionSupplierConfiguration,businessId:string,read:(path:string,limit:number,privateFile:boolean)=>Promise<Buffer>){
 let storage:ReturnType<typeof createR2ReceiptObjectStore>|undefined,worker:ReturnType<typeof createSupplierWorkerClient>|undefined;
 try{
  const config=parseProductionSupplierConfiguration(input),target=config.worker;
  const [key,cert,ca]=await Promise.all([read(target.keyFile,65536,true),read(target.certFile,65536,false),read(target.caFile,65536,false)]);
  worker=createSupplierWorkerClient({origin:target.origin,businessId,storageBinding:supplierStorageBinding(config.storage,businessId),serverFingerprint:target.serverFingerprint,tls:{key,cert,ca}});
  storage=createR2ReceiptObjectStore(config.storage);const ownedStore=storage,ownedWorker=worker;
  return Object.freeze({objects:ownedStore.objects,stagingOrigin:ownedStore.stagingOrigin,dispatch:ownedWorker.dispatch,close(){ownedWorker.close();ownedStore.close();}});
 }catch{worker?.close();storage?.close();throw Error('PRODUCTION_SUPPLIER_CONFIGURATION_REQUIRED');}
}
