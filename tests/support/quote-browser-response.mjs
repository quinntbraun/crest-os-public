// Chromium can retire a page Response body during the real controller refresh.
// Forward exactly one genuine request and buffer its actual server bytes before
// returning them unchanged to the browser. No Auth/result/persistence mock,
// second write, redirect or automatic retry is introduced.
export async function captureQuoteResponse(page,path,{timeoutMs=30000}={}){
 if(!/^\/api\/business\/quotes\/[a-z/]+$/.test(path))throw Error('QUOTE_CAPTURE_PATH_REQUIRED');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('QUOTE_CAPTURE_TIMEOUT_REQUIRED');
 let resolve,reject;
 const outcome=new Promise((yes,no)=>{resolve=yes;reject=no;});
 // A control that never dispatches must fail this observer rather than consume
 // the entire release job. This deadline neither retries nor sends a request.
 const deadline=setTimeout(()=>reject(Error('QUOTE_CAPTURE_DEADLINE: '+path)),timeoutMs);
 void outcome.then(()=>clearTimeout(deadline),()=>clearTimeout(deadline));
 await page.route('**'+path,async route=>{
  try{
   const request=route.request();if(request.method()!=='POST')throw Error('QUOTE_CAPTURE_POST_REQUIRED');
   const requestBody=request.postDataJSON(),response=await route.fetch({maxRetries:0,maxRedirects:0}),bytes=await response.body();
   const body=JSON.parse(bytes.toString('utf8')),status=response.status();
   await route.fulfill({response,body:bytes});
   resolve(Object.freeze({status,body,requestBody}));
  }catch(error){reject(error);await route.abort('failed').catch(()=>{});}
 },{times:1});
 return Object.freeze({outcome});
}
