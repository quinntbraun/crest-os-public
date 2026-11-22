import 'server-only';
import {createHash} from 'node:crypto';
import {createR2ObjectStore} from '../files/private-object-store.ts';
import type {R2ObjectConfiguration} from '../files/private-object-store.ts';
import {parseProductionReceiptConfiguration,receiptStorageBinding} from './production-receipt-configuration.ts';
import type {ProductionReceiptConfiguration} from './production-receipt-configuration.ts';
import {createPhotoWorkerClient} from './receipt-worker-transport.ts';

export type ProductionPhotoConfiguration=ProductionReceiptConfiguration;
export function photoStorageBinding(storage:R2ObjectConfiguration,businessId:string){
 return createHash('sha256').update('crest.custody-photo.storage.v1\0').update(receiptStorageBinding(storage,businessId)).digest('hex');
}
export function parseProductionPhotoConfiguration(input:unknown):ProductionPhotoConfiguration{
 try{return parseProductionReceiptConfiguration(input);}catch{throw Error('PRODUCTION_PHOTO_CONFIGURATION_REQUIRED');}
}
export async function openProductionPhotoRuntime(input:ProductionPhotoConfiguration,businessId:string,read:(path:string,limit:number,privateFile:boolean)=>Promise<Buffer>){
 let storage:ReturnType<typeof createR2ObjectStore>|undefined,worker:ReturnType<typeof createPhotoWorkerClient>|undefined;
 try{
  const config=parseProductionPhotoConfiguration(input),target=config.worker;
  const [key,cert,ca]=await Promise.all([read(target.keyFile,65536,true),read(target.certFile,65536,false),read(target.caFile,65536,false)]);
  worker=createPhotoWorkerClient({origin:target.origin,businessId,storageBinding:photoStorageBinding(config.storage,businessId),serverFingerprint:target.serverFingerprint,tls:{key,cert,ca}});
  storage=createR2ObjectStore(config.storage);const ownedStore=storage,ownedWorker=worker;
  return Object.freeze({objects:ownedStore.store,stagingOrigin:`https://${config.storage.accountId}.r2.cloudflarestorage.com`,dispatch:ownedWorker.dispatch,close(){ownedWorker.close();ownedStore.close();}});
 }catch{worker?.close();storage?.close();throw Error('PRODUCTION_PHOTO_CONFIGURATION_REQUIRED');}
}
