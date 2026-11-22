import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {parseProductionReceiptConfiguration,receiptStorageBinding} from '../../src/server/production-receipt-configuration';
import {parseProductionReceiptWorkerProfile} from '../../src/server/production-receipt-worker';

const storage={accountId:'a'.repeat(32),bucket:'crest-private-receipts',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'};
const worker={origin:'https://worker.example.com',serverFingerprint:'b'.repeat(64),keyFile:resolve('.local/operator/client.key'),certFile:resolve('.local/operator/client.pem'),caFile:resolve('.local/operator/worker-ca.pem')};
it('parses separate private storage and certificate-authenticated worker configuration without IO',()=>{
 const input={storage:{...storage},worker:{...worker}},parsed=parseProductionReceiptConfiguration(input);input.storage.bucket='different-private-bucket';
 expect(parsed.storage.bucket).toBe(storage.bucket);expect(Object.isFrozen(parsed.worker)).toBe(true);
});
it.each([
 {storage,worker:{...worker,origin:'http://worker.example.com'}},
 {storage,worker:{...worker,origin:'https://worker.example.com/other'}},
 {storage,worker:{...worker,origin:'https://secret@worker.example.com'}},
 {storage,worker:{...worker,serverFingerprint:'wildcard'}},
 {storage,worker:{...worker,keyFile:'relative.key'}},
 {storage:{...storage,bucket:'../public'},worker},
 {storage,worker:{...worker,skipTlsVerification:true}},
 {storage,worker,decoderSocket:'/var/run/docker.sock'}
 ])('rejects ambiguous endpoints, unsafe files, unknown fields and TLS bypass flags',value=>{
 expect(()=>parseProductionReceiptConfiguration(value)).toThrow('PRODUCTION_RECEIPT_CONFIGURATION_REQUIRED');
});
it('binds the exact business/account/bucket while permitting separate least-privilege credentials',()=>{
 const businessId=randomUUID(),binding=receiptStorageBinding(storage,businessId);
 expect(receiptStorageBinding({...storage,accessKeyId:'other-fixture-access',secretAccessKey:'other-fixture-secret'},businessId)).toBe(binding);
 for(const value of [{...storage,accountId:'b'.repeat(32)},{...storage,bucket:'crest-other-receipts'}])expect(receiptStorageBinding(value,businessId)).not.toBe(binding);
 expect(receiptStorageBinding(storage,randomUUID())).not.toBe(binding);
});
const profile=()=>({schemaVersion:1,authenticationProfileFile:resolve('.local/operator/worker-auth.json'),storage,imageId:'sha256:'+'c'.repeat(64),clientCAFile:resolve('.local/operator/client-ca.pem'),clientFingerprint:'d'.repeat(64)});
it('keeps the worker profile private and refuses opening an unaccepted production release',async()=>{
 const configured=parseProductionReceiptWorkerProfile(JSON.stringify(profile()));
 expect(Object.keys(configured)).toEqual([]);expect(()=>JSON.stringify(configured)).toThrow('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');
 await expect(configured.open()).rejects.toThrow('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');
});
it.each([{imageId:'decoder:latest'},{clientFingerprint:'*'},{authenticationProfileFile:'relative.json'},{clientCAFile:'relative.pem'},{dockerSocket:'tcp://remote'}])('rejects worker image/path/pin substitutions and extra configuration',patch=>{
 expect(()=>parseProductionReceiptWorkerProfile(JSON.stringify({...profile(),...patch}))).toThrow('PRODUCTION_RECEIPT_WORKER_CONFIGURATION_REQUIRED');
});
