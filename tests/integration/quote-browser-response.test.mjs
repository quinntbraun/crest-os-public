// Real browser/HTTP lifecycle regression for the test observer. This is not
// product Auth/database acceptance; those genuine journeys remain mandatory.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {chromium,webkit} from '@playwright/test';
import {captureQuoteResponse} from '../support/quote-browser-response.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' captures actual quote bytes across immediate navigation without a second request',async()=>{
 const operationId=randomUUID(),body={state:'committed',operationId,synthetic:'Exact Unicode 雪 é'},failure={error:'SYNTHETIC_NOT_SUBMITTED'},requests=[];
 const server=createServer(async(request,outgoing)=>{
  if(request.url==='/api/business/quotes/review/submit'){
   let raw='';for await(const part of request)raw+=part;const input=JSON.parse(raw);requests.push(input);
   outgoing.writeHead(input.refuse?503:200,{'content-type':'application/json','cache-control':'private, no-store'});outgoing.end(JSON.stringify(input.refuse?failure:body));return;
  }
  outgoing.writeHead(200,{'content-type':'text/html'});
  outgoing.end(`<!doctype html><html lang="en"><title>Synthetic observer</title><button id="save">Record synthetic request</button><button id="refuse">Request synthetic refusal</button><script>
   for(const id of ['save','refuse'])document.getElementById(id).onclick=async()=>{
    const response=await fetch('/api/business/quotes/review/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:${JSON.stringify(operationId)},refuse:id==='refuse'})});
    sessionStorage.setItem('syntheticReceived',JSON.stringify({status:response.status,body:await response.json()}));location.assign('/after');
   };
  </script></html>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await engine.launch();const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin);
  let captured=await captureQuoteResponse(page,'/api/business/quotes/review/submit');
  await page.getByRole('button',{name:'Record synthetic request',exact:true}).click();await page.waitForURL(origin+'/after');
  assert.deepEqual(await captured.outcome,{status:200,body,requestBody:{operationId,refuse:false}});
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('syntheticReceived'))),{status:200,body});assert.equal(requests.length,1);
  captured=await captureQuoteResponse(page,'/api/business/quotes/review/submit');
  await page.getByRole('button',{name:'Request synthetic refusal',exact:true}).click();
  assert.deepEqual(await captured.outcome,{status:503,body:failure,requestBody:{operationId,refuse:true}});
  await page.waitForURL(origin+'/after');assert.equal(requests.length,2);assert.deepEqual(requests,[{operationId,refuse:false},{operationId,refuse:true}]);
  const absent=await captureQuoteResponse(page,'/api/business/quotes/review/submit',{timeoutMs:50});
  await assert.rejects(absent.outcome,/QUOTE_CAPTURE_DEADLINE/);
  assert.equal(requests.length,2,'A missing dispatch must not trigger a write or retry.');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' captures one genuine command and its following read before immediate navigation',async()=>{
 const paths=['/api/business/quotes/amendments/create','/api/business/quotes/amendments/read'],operationId=randomUUID(),requests=[],receipt={operationId,synthetic:'original immutable receipt'},snapshot={revision:operationId,synthetic:'actual refreshed Unicode 雪 é'};
 const server=createServer(async(request,outgoing)=>{
  if(paths.includes(request.url)){
   let text='';for await(const part of request)text+=part;requests.push({path:request.url,body:JSON.parse(text)});
   outgoing.writeHead(200,{'content-type':'application/json','cache-control':'private, no-store'});outgoing.end(JSON.stringify(request.url===paths[0]?{state:'committed',receipt}:requests.at(-1).body.purpose==='recheck'?{synthetic:'pre-save source, not the saved refresh'}:snapshot));return;
  }
  outgoing.writeHead(200,{'content-type':'text/html'});outgoing.end(`<!doctype html><html lang="en"><title>Synthetic paired observer</title><button id="record">Record and refresh</button><script>
   document.getElementById('record').onclick=async()=>{
    const before=await fetch(${JSON.stringify(paths[1])},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purpose:'recheck'})});await before.json();
    const saved=await fetch(${JSON.stringify(paths[0])},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:${JSON.stringify(operationId)}})});
    const command=await saved.json();const refreshed=await fetch(${JSON.stringify(paths[1])},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:command.receipt.operationId})});
    sessionStorage.setItem('syntheticPair',JSON.stringify({command,read:await refreshed.json()}));location.assign('/after');
   };
  </script></html>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const captures=[];
 try{
  browser=await engine.launch();const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;await page.goto(origin);let committed=false,paced=0;
  await page.route('**/api/**',async route=>{paced++;await route.continue();});
  page.on('response',response=>{if(new URL(response.url()).pathname===paths[0]&&response.request().method()==='POST')committed=true;});
  const saved=await captureQuoteResponse(page,paths[0],{beforeForward:async()=>{paced++;}});captures.push(saved);
  const refreshed=await captureQuoteResponse(page,paths[1],{matchesRequest:()=>committed,beforeForward:async()=>{assert(committed);paced++;}});captures.push(refreshed);
  await page.getByRole('button',{name:'Record and refresh',exact:true}).click();await Promise.all([saved.outcome,refreshed.outcome,page.waitForURL(origin+'/after')]);
  assert.deepEqual(await saved.outcome,{status:200,body:{state:'committed',receipt},requestBody:{operationId}});assert.deepEqual(await refreshed.outcome,{status:200,body:snapshot,requestBody:{revision:operationId}});
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('syntheticPair'))),{command:{state:'committed',receipt},read:snapshot});assert.deepEqual(requests,[{path:paths[1],body:{purpose:'recheck'}},{path:paths[0],body:{operationId}},{path:paths[1],body:{revision:operationId}}]);assert.equal(paced,3);
  const unused=await captureQuoteResponse(page,paths[0]);await unused.cancel();await assert.rejects(unused.outcome,/QUOTE_CAPTURE_CANCELLED/);assert.equal(requests.length,3,'Cancelling an unused observer must not send a command.');
 }finally{await Promise.allSettled(captures.map(capture=>capture.cancel()));await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
