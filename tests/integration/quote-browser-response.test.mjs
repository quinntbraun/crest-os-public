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
