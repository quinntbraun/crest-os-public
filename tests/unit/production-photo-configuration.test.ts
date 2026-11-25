import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionPhotoConfiguration,photoStorageBinding} from '../../src/server/production-photo-configuration';
import {receiptStorageBinding} from '../../src/server/production-receipt-configuration';
import {parseProductionPhotoWorkerProfile} from '../../src/server/production-photo-worker';
import {productionPhotoWorkerBaseCapabilities,createProductionCapabilities,productionCapability} from '../../src/security/production-capabilities';

const storage={accountId:'a'.repeat(32),bucket:'crest-private-photos',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'};
const worker={origin:'https://photo-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')};
it('binds photo configuration independently of receipt processing, including business/account/bucket',()=>{
 const businessId=randomUUID(),binding=photoStorageBinding(storage,businessId);
 expect(parseProductionPhotoConfiguration({storage,worker}).storage.bucket).toBe(storage.bucket);
 expect(binding).not.toBe(receiptStorageBinding(storage,businessId));
 expect(binding).not.toBe(photoStorageBinding({...storage,bucket:'crest-other-photos'},businessId));
 expect(binding).not.toBe(photoStorageBinding(storage,randomUUID()));
 expect(()=>parseProductionPhotoConfiguration({storage,worker:{...worker,origin:'http://unsafe.example.com'}})).toThrow('PRODUCTION_PHOTO_CONFIGURATION_REQUIRED');
});
it('keeps the worker capability dependency closure explicit and limited to custody photo preparation',()=>{
 const businessId=randomUUID(),grant=createProductionCapabilities({productionActivation:'ready'},businessId,[...productionPhotoWorkerBaseCapabilities,'dropoffPhotos']);
 expect(productionCapability({environment:'production',businessId,productionCapabilities:grant},'dropoffPhotos')).toBe(true);
 for(const capability of ['finance','expenseReceipts','jobCompletion'] as const)expect(productionCapability({environment:'production',businessId,productionCapabilities:grant},capability)).toBe(false);
});
const profile=()=>({schemaVersion:1,authenticationProfileFile:resolve('.local/operator/photo-auth.json'),storage,imageId:'sha256:'+'c'.repeat(64),clientCAFile:resolve('.local/operator/client-ca.pem'),clientFingerprint:'d'.repeat(64),workerConnectionString:'postgresql://crest_photo_runtime:fixture-only@database.example.com/crest'});
it('keeps photo worker credentials private and refuses opening an unaccepted release',async()=>{
 const configured=parseProductionPhotoWorkerProfile(JSON.stringify(profile()));
 expect(Object.keys(configured)).toEqual([]);expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_PHOTO_WORKER_CONFIGURATION_REQUIRED');
 await expect(configured.open()).rejects.toThrow('PRODUCTION_PHOTO_WORKER_CONFIGURATION_REQUIRED');
});
it.each([{imageId:'decoder:latest'},{clientFingerprint:'*'},{workerConnectionString:'postgresql://user:fixture-only@database.example.com/crest?sslmode=disable'},{workerConnectionString:'https://database.example.com'},{authenticationProfileFile:'relative.json'},{dockerSocket:'tcp://remote'}])('rejects unpinned images, invalid database credentials, relative files and additional fields',patch=>{
 expect(()=>parseProductionPhotoWorkerProfile(JSON.stringify({...profile(),...patch}))).toThrow('PRODUCTION_PHOTO_WORKER_CONFIGURATION_REQUIRED');
});
