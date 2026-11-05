// Real Node sockets and the receipt workflow/writer. Authorization/storage are
// explicit seams; this is neither deployed TLS nor real provider/decoder proof.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {createReceiptDownload} from '../../src/bookkeeping/expenses/receipt-workflow.ts';
import {receiptDownloadResponse,writeReceiptDownloadResponse,isReceiptDownloadResponse} from '../../src/bookkeeping/expenses/receipt-download-response.ts';
import {writeCustomerResponse} from '../../src/server/node-server.ts';
const hash=value=>createHash('sha256').update(value).digest('hex'),signal=()=>new AbortController().signal;
async function socketResponse(make,writer=writeReceiptDownloadResponse,external=signal()){
 let failure;const server=createServer(async(_request,outgoing)=>{try{const response=await make();assert(isReceiptDownloadResponse(response));await writer(outgoing,response,external);}catch(error){failure=error;outgoing.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return {response:await fetch('http://127.0.0.1:'+server.address().port),failure:()=>failure,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(failure)throw new Error('SOCKET_DELIVERY_REFUSED',{cause:error});throw error;}
}
test('authorized original reaches an actual socket at the full25MiB limit while preserving private attachment headers',async()=>{
 const businessId=randomUUID(),receiptId=randomUUID(),dispatchId=randomUUID(),bytes=Buffer.alloc(25*1024*1024,71),sha256=hash(bytes),reservation={businessId,receiptId,expenseId:randomUUID(),expenseRevision:'1',recoveryEpoch:randomUUID(),declaredType:'application/pdf',byteSize:bytes.length,stagingKey:`staging/${businessId}/${receiptId}/${dispatchId}`,originalKey:`originals/${businessId}/${receiptId}`,previewKey:`previews/${businessId}/${receiptId}`,dispatchId};let reads=0;
 const candidate={status:'PrivateValidatedCandidate',validationVersion:'crest-pdf-v1-qpdf-12.3.2-poppler-26.09.0',source:{sha256,byteSize:bytes.length,detectedType:'application/pdf',pageCount:1},original:{key:reservation.originalKey,byteSize:bytes.length,sha256},preview:{key:reservation.previewKey,byteSize:4,sha256:'b'.repeat(64),contentType:'image/jpeg',width:1,height:1,pageNumber:1}};
 // Use the canonical version without duplicating its release value here.
 candidate.validationVersion=(await import('../../src/files/validation-contract.ts')).pdfValidationVersion;
 const download=createReceiptDownload({async read(){reads++;return {reservation,candidate};}},{async readAvailable(){return {forResponse:()=>Buffer.from(bytes)};}});
 const socket=await socketResponse(()=>download('synthetic',businessId,receiptId,'original',signal()));
 try{assert.equal(socket.response.status,200);assert.equal(socket.response.headers.get('content-length'),String(bytes.length));assert.equal(socket.response.headers.get('content-disposition'),`attachment; filename="receipt-${receiptId}.pdf"`);assert.equal(socket.response.headers.get('cache-control'),'private, no-store');assert.equal(socket.response.headers.get('x-content-type-options'),'nosniff');assert.equal(socket.response.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(hash(Buffer.from(await socket.response.arrayBuffer())),sha256);assert.equal(reads,2);assert.equal(socket.failure(),undefined);}finally{await socket.close();}
},{timeout:30000});
test('unchanged customer writer still refuses a receipt larger than its1MiB JSON boundary',async()=>{const bytes=Buffer.alloc(1024*1024+1,72);await assert.rejects(socketResponse(()=>receiptDownloadResponse(bytes,{name:`receipt-${randomUUID()}.png`,type:'image/png',byteSize:bytes.length,sha256:hash(bytes)}),writeCustomerResponse),/SOCKET_DELIVERY_REFUSED/);});
test('receipt handoff refuses oversized originals/previews and wrong hashes before writing',()=>{
 const name=`receipt-${randomUUID()}`,small=Buffer.from('synthetic');
 assert.throws(()=>receiptDownloadResponse(Buffer.alloc(25*1024*1024+1),{name:name+'.pdf',type:'application/pdf',byteSize:25*1024*1024+1,sha256:'a'.repeat(64)}));
 assert.throws(()=>receiptDownloadResponse(Buffer.alloc(8*1024*1024+1),{name:name+'-preview.jpg',type:'image/jpeg',byteSize:8*1024*1024+1,sha256:'a'.repeat(64)}));
 assert.throws(()=>receiptDownloadResponse(small,{name:name+'.png',type:'image/png',byteSize:small.length,sha256:'a'.repeat(64)}));
 assert.throws(()=>receiptDownloadResponse(small,{name:'../private.png',type:'image/png',byteSize:small.length,sha256:hash(small)}));
});
test('binary transport rejects unbranded, altered and already consumed handoffs',async()=>{
 const bytes=Buffer.from('synthetic receipt'),create=()=>receiptDownloadResponse(bytes,{name:`receipt-${randomUUID()}.png`,type:'image/png',byteSize:bytes.length,sha256:hash(bytes)});
 await assert.rejects(socketResponse(async()=>{const response=create();response.headers.set('content-type','text/html');return response;}),/SOCKET_DELIVERY_REFUSED/);
 await assert.rejects(socketResponse(async()=>{const response=create();await response.arrayBuffer();return response;}),/SOCKET_DELIVERY_REFUSED/);
 const response=create(),first=await socketResponse(()=>response);try{assert.equal(await first.response.text(),bytes.toString());}finally{await first.close();}await assert.rejects(socketResponse(()=>response),/SOCKET_DELIVERY_REFUSED/);
 const abort=new AbortController();abort.abort();await assert.rejects(socketResponse(create,writeReceiptDownloadResponse,abort.signal),/SOCKET_DELIVERY_REFUSED/);
 const outgoing={headersSent:false,destroyed:false,destroy(){this.destroyed=true;}};await assert.rejects(writeReceiptDownloadResponse(outgoing,new Response(bytes),signal()),/RECEIPT_DELIVERY_UNCONFIRMED/);assert.equal(outgoing.destroyed,true);
});
