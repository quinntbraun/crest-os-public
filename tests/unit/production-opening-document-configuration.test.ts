import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionOpeningDocumentConfiguration,openingDocumentStorageBinding} from '../../src/server/production-opening-document-configuration';
import {receiptStorageBinding} from '../../src/server/production-receipt-configuration';
import {supplierStorageBinding} from '../../src/server/production-supplier-configuration';
import {parseProductionOpeningDocumentWorkerProfile} from '../../src/server/production-opening-document-worker';

const storage={accountId:'a'.repeat(32),bucket:'crest-private-documents',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'};
const worker={origin:'https://document-worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')};
it('isolates opening documents from supplier/receipt purposes and other businesses or buckets',()=>{
 const businessId=randomUUID(),binding=openingDocumentStorageBinding(storage,businessId);
 expect(parseProductionOpeningDocumentConfiguration({storage,worker}).storage.bucket).toBe(storage.bucket);
 expect(binding).not.toBe(receiptStorageBinding(storage,businessId));
 expect(binding).not.toBe(supplierStorageBinding(storage,businessId));
 expect(binding).not.toBe(openingDocumentStorageBinding(storage,randomUUID()));
 expect(binding).not.toBe(openingDocumentStorageBinding({...storage,bucket:'other-private-documents'},businessId));
});
it.each([{...worker,origin:'http://unsafe.example.com'},{...worker,origin:'https://document-worker.example.com/path'},{...worker,serverFingerprint:'*'},{...worker,keyFile:'relative.key'}])('refuses invalid worker destinations and identity',invalid=>{
 expect(()=>parseProductionOpeningDocumentConfiguration({storage,worker:invalid})).toThrow('PRODUCTION_OPENING_DOCUMENT_CONFIGURATION_REQUIRED');
});
const profile=()=>({schemaVersion:1,authenticationProfileFile:resolve('.local/operator/document-auth.json'),storage,imageId:'sha256:'+'c'.repeat(64),clientCAFile:resolve('.local/operator/client-ca.pem'),clientFingerprint:'d'.repeat(64),workerConnectionString:'postgresql://crest_document_runtime:fixture-only@database.example.com/crest'});
it('keeps document-worker secrets private and refuses the unaccepted production release',async()=>{
 const configured=parseProductionOpeningDocumentWorkerProfile(JSON.stringify(profile()));
 expect(Object.keys(configured)).toEqual([]);
 expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');
 await expect(configured.open()).rejects.toThrow('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');
});
it.each([{imageId:'decoder:latest'},{clientFingerprint:'*'},{workerConnectionString:'postgresql://user:fixture-only@database.example.com/crest?sslmode=disable'},{workerConnectionString:'https://database.example.com'},{authenticationProfileFile:'relative.json'},{dockerSocket:'tcp://remote'}])('refuses unsafe document-worker profiles',patch=>{
 expect(()=>parseProductionOpeningDocumentWorkerProfile(JSON.stringify({...profile(),...patch}))).toThrow('PRODUCTION_OPENING_DOCUMENT_WORKER_CONFIGURATION_REQUIRED');
});
