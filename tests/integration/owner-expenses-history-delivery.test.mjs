// Actual Node sockets and bounded JSON transport only. Genuine authorization,
// registered expense history and router composition are separate acceptance gates.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {writeExpenseResponse,writeCustomerResponse,writeQuoteResponse} from '../../src/server/node-server.ts';
import {privateJsonResponse} from '../../src/security/private-http.ts';
const hash=value=>createHash('sha256').update(value).digest('hex');
async function socket(body,writer=writeExpenseResponse,signal=new AbortController().signal){
 let deliveryError;
 const server=createServer(async(_request,outgoing)=>{
  try{await writer(outgoing,new Response(body,{headers:privateJsonResponse({}).headers}),signal);}
  catch(error){deliveryError=error;outgoing.destroy();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port);return {response,error:()=>deliveryError,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};}
 catch(error){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw new Error('EXPENSE_SOCKET_REFUSED',{cause:error});}
}
test('retained history above the customer and quote caps reaches a real socket unchanged',async()=>{
 const body=JSON.stringify({rows:['Synthetic retained expense history '+ 'x'.repeat(6*1024*1024)]}),served=await socket(body);
 try{assert.equal(served.response.status,200);assert.equal(served.response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(served.response.headers.get('referrer-policy'),'no-referrer');assert.equal(served.response.headers.get('x-content-type-options'),'nosniff');const bytes=Buffer.from(await served.response.arrayBuffer());assert.equal(bytes.byteLength,Buffer.byteLength(body));assert.equal(hash(bytes),hash(body));assert.equal(served.error(),undefined);}
 finally{await served.close();}
 await assert.rejects(socket(body,writeCustomerResponse),/EXPENSE_SOCKET_REFUSED/);
 await assert.rejects(socket(body,writeQuoteResponse),/EXPENSE_SOCKET_REFUSED/);
});
test('the expense-only JSON writer accepts its exact8MiB boundary and refuses one extra byte',async()=>{
 const prefix='{"rows":"',suffix='"}',limit=8*1024*1024,body=prefix+'x'.repeat(limit-prefix.length-suffix.length)+suffix;
 assert.equal(Buffer.byteLength(body),limit);const served=await socket(body);
 try{const bytes=await served.response.arrayBuffer();assert.equal(bytes.byteLength,limit);assert.equal(hash(Buffer.from(bytes)),hash(body));assert.equal(served.error(),undefined);}
 finally{await served.close();}
 await assert.rejects(socket(body+' '),/EXPENSE_SOCKET_REFUSED/);
});
test('an already canceled expense JSON handoff does not start a download',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(socket('{"rows":[]}',writeExpenseResponse,controller.signal),/EXPENSE_SOCKET_REFUSED/);
});
