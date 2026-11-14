import assert from 'node:assert/strict';
// Chromium can retire a page Response body during the real controller refresh.
// Forward exactly one genuine request and buffer its actual server bytes before
// returning them unchanged to the browser. No Auth/result/persistence mock,
// second write, redirect or automatic retry is introduced.
export async function captureQuoteResponse(page,path,{timeoutMs=30000,beforeForward,matchesRequest}={}){
 if(!/^\/api\/business\/(?:quotes\/[a-z/]+|settings|scheduling\/(?:book|cancel|history))$/.test(path))throw Error('QUOTE_CAPTURE_PATH_REQUIRED');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('QUOTE_CAPTURE_TIMEOUT_REQUIRED');
 if(beforeForward!==undefined&&typeof beforeForward!=='function')throw Error('QUOTE_CAPTURE_PACING_REQUIRED');
 if(matchesRequest!==undefined&&typeof matchesRequest!=='function')throw Error('QUOTE_CAPTURE_MATCH_REQUIRED');
 let resolve,reject,capturing=false;
 const outcome=new Promise((yes,no)=>{resolve=yes;reject=no;});
 // A control that never dispatches must fail this observer rather than consume
 // the entire release job. This deadline neither retries nor sends a request.
 const deadline=setTimeout(()=>reject(Error('QUOTE_CAPTURE_DEADLINE: '+path)),timeoutMs);
 void outcome.then(()=>clearTimeout(deadline),()=>clearTimeout(deadline));
 const pattern='**'+path,handler=async route=>{
  try{
   const request=route.request();if(request.method()!=='POST')throw Error('QUOTE_CAPTURE_POST_REQUIRED');
   if(capturing){await route.fallback();return;}
   if(matchesRequest){const matched=matchesRequest(request);if(typeof matched!=='boolean')throw Error('QUOTE_CAPTURE_MATCH_REQUIRED');if(!matched){await route.fallback();return;}}
   // A pre-save recheck must pass through without consuming this observer.
   // Remove only this exact handler once its intended request is captured.
   capturing=true;
   await beforeForward?.();
   const requestBody=request.postDataJSON(),response=await route.fetch({maxRetries:0,maxRedirects:0}),bytes=await response.body();
   const body=JSON.parse(bytes.toString('utf8')),status=response.status();
   await route.fulfill({response,body:bytes});
   if(matchesRequest)await page.unroute(pattern,handler);
   resolve(Object.freeze({status,body,requestBody}));
  }catch(error){reject(error);await route.abort('failed').catch(()=>{});}
 };
 // Preserve the original one-shot lifecycle for existing commercial callers.
 // Only a filtered reader must survive an unrelated preflight request.
 await page.route(pattern,handler,matchesRequest?{}:{times:1});
 return Object.freeze({outcome,async cancel(){clearTimeout(deadline);reject(Error('QUOTE_CAPTURE_CANCELLED'));await page.unroute(pattern,handler);}});
}

export async function captureDuringAction(page,path,action,options){
 const capture=await captureQuoteResponse(page,path,options);
 try{await action();return await capture.outcome;}
 finally{await Promise.allSettled([capture.cancel()]);}
}

export async function captureAmendmentCommand(page,path,click,beforeForward){
 const captures=[];let committed=false;
 const observe=response=>{
  if(new URL(response.url()).pathname===path&&response.request().method()==='POST')committed=true;
 };
 page.on('response',observe);
 try{
  const response=await captureQuoteResponse(page,path,{beforeForward});captures.push(response);
  const read=await captureQuoteResponse(page,'/api/business/quotes/amendments/read',{
   matchesRequest:()=>committed,beforeForward
  });captures.push(read);
  await click();
  const saved=await response.outcome;assert.equal(saved.status,200);assert.equal(saved.body.state,'committed');
  const reloaded=await read.outcome;assert.equal(reloaded.status,200);assert(reloaded.body&&typeof reloaded.body==='object');
  return saved.body.receipt;
 }finally{page.off('response',observe);await Promise.allSettled(captures.map(capture=>capture.cancel()));}
}
