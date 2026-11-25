import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createR2ReceiptObjectStore} from '../../src/bookkeeping/expenses/receipt-object-store';
import type {ReceiptReservation} from '../../src/bookkeeping/expenses/receipt-contract';

const configuration={accountId:'a'.repeat(32),bucket:'crest-private-receipts',accessKeyId:'fixture-only-access',secretAccessKey:'fixture-only-secret'};
it('signs only the database reservation at the explicit R2 endpoint without any storage request',async()=>{
 const storage=createR2ReceiptObjectStore(configuration),businessId=randomUUID(),receiptId=randomUUID(),dispatchId=randomUUID();
 const reservation:ReceiptReservation={businessId,receiptId,dispatchId,expenseId:randomUUID(),expenseRevision:'1',recoveryEpoch:randomUUID(),declaredType:'image/png',byteSize:4,
  stagingKey:`staging/${businessId}/${receiptId}/${dispatchId}`,originalKey:`originals/${businessId}/${receiptId}`,previewKey:`previews/${businessId}/${receiptId}`};
 try{
  const capability=await storage.objects.issueReservedUpload(reservation),upload=capability.forUpload(),url=new URL(upload.url);
  expect(url.origin).toBe(storage.stagingOrigin);expect(url.pathname).toBe(`/${configuration.bucket}/${reservation.stagingKey}`);
  expect(url.searchParams.get('X-Amz-Credential')?.split('/')[0]).toBe(configuration.accessKeyId);
  expect(url.searchParams.get('X-Amz-Expires')).toBe('600');expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  expect(upload.method).toBe('PUT');expect(upload.headers).toEqual({'content-type':'image/png'});
  expect(()=>JSON.stringify(capability)).toThrow('RECEIPT_STORAGE_UNCONFIRMED');
  await expect(storage.objects.issueReservedUpload({...reservation,stagingKey:`staging/${randomUUID()}/${receiptId}/${dispatchId}`})).rejects.toThrow();
 }finally{storage.close();}
});
it.each([{accountId:'https://elsewhere.example.com'},{bucket:'../public'},{accessKeyId:'short'},{secretAccessKey:'unsafe\nsecret'}])('rejects unsafe R2 configuration with a private fixed error',patch=>{
 expect(()=>createR2ReceiptObjectStore({...configuration,...patch})).toThrow('RECEIPT_STORAGE_UNCONFIRMED');
});
