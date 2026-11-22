import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionSupplierConfiguration,supplierStorageBinding} from '../../src/server/production-supplier-configuration';
import {receiptStorageBinding} from '../../src/server/production-receipt-configuration';
import {photoStorageBinding} from '../../src/server/production-photo-configuration';
import {parseProductionSupplierWorkerProfile} from '../../src/server/production-supplier-worker';

const storage={accountId:'a'.repeat(32),bucket:'crest-private-suppliers',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'};
const worker={origin:'https://supplier-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')};
it('binds supplier storage independently of receipt/photo purpose and business',()=>{
 const businessId=randomUUID(),binding=supplierStorageBinding(storage,businessId);
 expect(parseProductionSupplierConfiguration({storage,worker}).storage.bucket).toBe(storage.bucket);
 expect(binding).not.toBe(receiptStorageBinding(storage,businessId));expect(binding).not.toBe(photoStorageBinding(storage,businessId));
 expect(binding).not.toBe(supplierStorageBinding(storage,randomUUID()));
 expect(()=>parseProductionSupplierConfiguration({storage,worker:{...worker,origin:'http://unsafe.example.com'}})).toThrow('PRODUCTION_SUPPLIER_CONFIGURATION_REQUIRED');
});
const profile=()=>({schemaVersion:1,authenticationProfileFile:resolve('.local/operator/supplier-auth.json'),storage,imageId:'sha256:'+'c'.repeat(64),clientCAFile:resolve('.local/operator/client-ca.pem'),clientFingerprint:'d'.repeat(64),workerConnectionString:'postgresql://crest_supplier_runtime:fixture-only@database.example.com/crest'});
it('keeps the supplier worker profile private and refuses opening the unaccepted release',async()=>{
 const configured=parseProductionSupplierWorkerProfile(JSON.stringify(profile()));
 expect(Object.keys(configured)).toEqual([]);expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_SUPPLIER_WORKER_CONFIGURATION_REQUIRED');
 await expect(configured.open()).rejects.toThrow('PRODUCTION_SUPPLIER_WORKER_CONFIGURATION_REQUIRED');
});
it.each([{imageId:'decoder:latest'},{clientFingerprint:'*'},{workerConnectionString:'postgresql://user:fixture-only@database.example.com/crest?sslmode=disable'},{workerConnectionString:'https://database.example.com'},{authenticationProfileFile:'relative.json'},{dockerSocket:'tcp://remote'}])('rejects invalid worker credentials/images/paths and extra fields',patch=>{
 expect(()=>parseProductionSupplierWorkerProfile(JSON.stringify({...profile(),...patch}))).toThrow('PRODUCTION_SUPPLIER_WORKER_CONFIGURATION_REQUIRED');
});
