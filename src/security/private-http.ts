import 'server-only';
const bodyLimit=8192;
export class PrivateHttpError extends Error{constructor(){super('PRIVATE_HTTP_FAILED');this.name='PrivateHttpError';}}
export function privateJsonResponse(body:object,status=200,cookies:string[]=[]):Response{
  const headers=new Headers({
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store, max-age=0',
    'CDN-Cache-Control':'no-store','Surrogate-Control':'no-store',
    'Pragma':'no-cache','Expires':'0','Vary':'Cookie, Origin',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
    'X-Robots-Tag':'noindex, nofollow','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  for(const value of cookies)headers.append('Set-Cookie',value);
  return new Response(JSON.stringify(body),{status,headers});
}

async function boundedBody(request:Request,signal:AbortSignal):Promise<string>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    if(signal.aborted||request.bodyUsed||request.headers.has('content-encoding'))throw new PrivateHttpError();
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>bodyLimit))throw new PrivateHttpError();
    if(!request.body)throw new PrivateHttpError();
    reader=request.body.getReader();
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    let size=0,text='';
    while(true){
      // A stalled stream must not outlive the overall deadline or client cancellation.
      const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
        const abort=()=>reject(new PrivateHttpError());
        if(signal.aborted){abort();return;}
        signal.addEventListener('abort',abort,{once:true});
        reader!.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      });
      if(signal.aborted)throw new PrivateHttpError();
      if(part.done)break;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength===0||(size+=part.value.byteLength)>bodyLimit)throw new PrivateHttpError();
      text+=decoder.decode(part.value,{stream:true});
    }
    text+=decoder.decode();
    if(length!==null&&Number(length)!==size)throw new PrivateHttpError();
    return text;
  }catch{
    // Do not wait for a hostile source's cancellation promise to settle.
    if(reader)void reader.cancel().catch(()=>{});
    throw new PrivateHttpError();
  }finally{reader?.releaseLock();}
}

export async function readFlatJsonBody(request:Request,keys:readonly string[]):Promise<Readonly<Record<string,unknown>>>{
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),text=await boundedBody(request,signal),value:unknown=JSON.parse(text);
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))throw new PrivateHttpError();
    if(Object.values(value).some(v=>v!==null&&typeof v==='object')||(text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==keys.length)throw new PrivateHttpError();
    return Object.freeze({...value});
  }catch{throw new PrivateHttpError();}
}
