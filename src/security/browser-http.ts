import 'server-only';
import {sessionCredentialHash} from './session-credential.ts';
import {createRequestProtection} from './request-protection.ts';
import {sessionLimits} from './session-policy.ts';
import type {createBrowserSessionFlow} from './browser-session-flow.ts';

const sessionName='__Host-crest_session',loginName='__Host-crest_login';
const bodyLimit=8192,bodyTimeoutMs=5000,cookieLimit=8192;
type Flow=ReturnType<typeof createBrowserSessionFlow>;
type LoginContext=Awaited<ReturnType<Flow['beginLogin']>>;
type BrowserSession=Awaited<ReturnType<Flow['login']>>;
type LoginInput=Parameters<Flow['login']>[3];
export class BrowserHttpError extends Error{
  constructor(){super('BROWSER_HTTP_FAILED');this.name='BrowserHttpError';}
}
function credential(value:string):string{
  try{sessionCredentialHash(value).fill(0);return value;}catch{throw new BrowserHttpError();}
}
function csrf(value:string):string{
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)throw new BrowserHttpError();
  return value;
}

// Never URL-decode credentials or choose between duplicate reserved cookie names.
export function readBrowserCookies(headers:Headers):Readonly<{session?:string;login?:string}>{
  const raw=headers.get('cookie');
  if(raw===null)return Object.freeze({});
  if(!raw||Buffer.byteLength(raw,'utf8')>cookieLimit)throw new BrowserHttpError();
  const result:{session?:string;login?:string}={};
  const pairs=raw.split(';');if(pairs.length>128)throw new BrowserHttpError();
  for(const pair of pairs){
    const match=/^[ \t]*([!#$%&'*+\-.^_`|~0-9A-Za-z]+)=([\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)[ \t]*$/.exec(pair);
    if(!match)throw new BrowserHttpError();
    const name=match[1]!,value=match[2]!;
    if(name!==sessionName&&name!==loginName)continue;
    const key=name===sessionName?'session':'login';
    if(Object.hasOwn(result,key))throw new BrowserHttpError();
    result[key]=credential(value);
  }
  return Object.freeze(result);
}

function cookie(name:string,value:string,age?:number,expiresAt?:number):string{
  let result=`${name}=${credential(value)}; Path=/; Secure; HttpOnly; SameSite=Lax`;
  if(age!==undefined)result+=`; Max-Age=${age}; Expires=${new Date(expiresAt!).toUTCString()}`;
  return result;
}
function clearCookie(name:string){return `${name}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;}
function lifetime(expiresAt:number,now:number,maximum:number):number{
  if(!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(now)||now<0||expiresAt<=now||expiresAt-now>maximum)throw new BrowserHttpError();
  const seconds=Math.floor((expiresAt-now)/1000);
  if(seconds<1||!Number.isFinite(new Date(expiresAt).getTime()))throw new BrowserHttpError();
  return seconds;
}
function json(body:object,status=200,cookies:string[]=[]):Response{
  const headers=new Headers({
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'private, no-store, max-age=0',
    'Pragma':'no-cache','Expires':'0','Vary':'Cookie, Origin',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  for(const value of cookies)headers.append('Set-Cookie',value);
  return new Response(JSON.stringify(body),{status,headers});
}

// Explicit allowlists: never serialize lifecycle evidence, provider tokens or opaque credentials.
export function loginContextResponse(context:LoginContext,now=Date.now()):Response{
  const age=lifetime(context.expiresAt,now,10*60*1000);
  return json({csrfToken:csrf(context.csrfTokenForResponse()),expiresAt:context.expiresAt},200,
    [cookie(loginName,context.cookieValueForResponse(),age,context.expiresAt)]);
}
export function loginResponse(session:BrowserSession,trusted:boolean,now=Date.now()):Response{
  if(typeof trusted!=='boolean')throw new BrowserHttpError();
  const expiresAt=session.evidence.expiresAt;
  const age=lifetime(expiresAt,now,trusted?sessionLimits.trustedAbsoluteMs:sessionLimits.untrustedAbsoluteMs);
  return json({csrfToken:csrf(session.csrfTokenForResponse()),expiresAt},200,
    [cookie(sessionName,session.cookieValueForResponse(),trusted?age:undefined,trusted?expiresAt:undefined),clearCookie(loginName)]);
}
export function sessionResponse(session:BrowserSession,now=Date.now()):Response{
  // Proof reissue must not rewrite a persistent cookie's original deadline.
  lifetime(session.evidence.expiresAt,now,sessionLimits.trustedAbsoluteMs);
  return json({csrfToken:csrf(session.csrfTokenForResponse()),expiresAt:session.evidence.expiresAt});
}
export function logoutResponse(result:Awaited<ReturnType<Flow['logout']>>):Response{
  if(result?.localRevoked!==true||typeof result.providerSignedOut!=='boolean')throw new BrowserHttpError();
  // Clear only after confirmed local revocation; do not claim remote signout succeeded.
  return json({localRevoked:true,providerSignedOut:result.providerSignedOut},200,[clearCookie(sessionName),clearCookie(loginName)]);
}
export function browserFailureResponse():Response{
  // No exception argument: request/SDK/database errors and credentials cannot be reflected.
  return json({error:'AUTHENTICATION_REQUEST_FAILED'},400);
}

async function boundedBody(request:Request,signal:AbortSignal):Promise<string>{
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    if(signal.aborted||request.bodyUsed||request.headers.has('content-encoding'))throw new BrowserHttpError();
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>bodyLimit))throw new BrowserHttpError();
    if(!request.body)throw new BrowserHttpError();
    reader=request.body.getReader();
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    let size=0,text='';
    while(true){
      // A stalled stream must not outlive the overall deadline or client cancellation.
      const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{
        const abort=()=>reject(new BrowserHttpError());
        if(signal.aborted){abort();return;}
        signal.addEventListener('abort',abort,{once:true});
        reader!.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
      });
      if(signal.aborted)throw new BrowserHttpError();
      if(part.done)break;
      if(!(part.value instanceof Uint8Array)||part.value.byteLength===0||(size+=part.value.byteLength)>bodyLimit)throw new BrowserHttpError();
      text+=decoder.decode(part.value,{stream:true});
    }
    text+=decoder.decode();
    if(length!==null&&Number(length)!==size)throw new BrowserHttpError();
    return text;
  }catch{
    // Do not wait for a hostile source's cancellation promise to settle.
    if(reader)void reader.cancel().catch(()=>{});
    throw new BrowserHttpError();
  }finally{reader?.releaseLock();}
}

export function createBrowserBodyReader(config:{origin:string;environment:'production'|'test'}){
  const protect=createRequestProtection(config);
  return async function read(request:Request,kind:'login'|'empty'):Promise<LoginInput|Readonly<Record<string,never>>>{
    try{
      if(!['login','empty'].includes(kind)||request.method!=='POST')throw new BrowserHttpError();
      protect.requireOrigin(request);
      const signal=AbortSignal.any([request.signal,AbortSignal.timeout(bodyTimeoutMs)]);
      const text=await boundedBody(request,signal),value:unknown=JSON.parse(text);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new BrowserHttpError();
      const keys=Object.keys(value);
      if(kind==='empty'){
        if(keys.length)throw new BrowserHttpError();
        return Object.freeze({});
      }
      const input=value as LoginInput;
      if(keys.length!==4||!['email','password','code','trusted'].every(key=>Object.hasOwn(input,key))
        ||typeof input.email!=='string'||!input.email.trim()||input.email.length>320
        ||typeof input.password!=='string'||!input.password||input.password.length>1024
        ||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||typeof input.trusted!=='boolean')throw new BrowserHttpError();
      // For this shallow schema all values are strings/boolean. Counting separators
      // outside valid JSON strings rejects duplicate keys, including escaped names.
      if((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(token=>token===':').length!==4)throw new BrowserHttpError();
      return Object.freeze({email:input.email,password:input.password,code:input.code,trusted:input.trusted});
    }catch{throw new BrowserHttpError();}
  };
}
