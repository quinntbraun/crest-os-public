import 'server-only';
import {privateJsonResponse as json,readFlatJsonBody} from './private-http.ts';
import {sessionCredentialHash} from './session-credential.ts';
import {createRequestProtection} from './request-protection.ts';
import {sessionLimits} from './session-policy.ts';
import type {createBrowserSessionFlow} from './browser-session-flow.ts';

const sessionName='__Host-crest_session',loginName='__Host-crest_login';
const cookieLimit=8192;
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
export function browserFailureResponse(status:400|404|405|503=400):Response{
  // No exception argument: request/SDK/database errors and credentials cannot be reflected.
  const response=json({error:'AUTHENTICATION_REQUEST_FAILED'},[400,404,405,503].includes(status)?status:400);
  if(status===405)response.headers.set('Allow','POST');
  return response;
}

export function createBrowserBodyReader(config:{origin:string;environment:'production'|'test'}){
  const protect=createRequestProtection(config);
  function read(request:Request,kind:'login'):Promise<LoginInput>;
  function read(request:Request,kind:'empty'):Promise<Readonly<Record<string,never>>>;
  async function read(request:Request,kind:'login'|'empty'):Promise<LoginInput|Readonly<Record<string,never>>>{
    try{
      if(!['login','empty'].includes(kind)||request.method!=='POST')throw new BrowserHttpError();
      protect.requireOrigin(request);
      const value=await readFlatJsonBody(request,kind==='empty'?[]:['email','password','code','trusted']),keys=Object.keys(value);
      if(kind==='empty')return Object.freeze({});
      const input=value as LoginInput;
      if(keys.length!==4||!['email','password','code','trusted'].every(key=>Object.hasOwn(input,key))
        ||typeof input.email!=='string'||!input.email.trim()||input.email.length>320
        ||typeof input.password!=='string'||!input.password||input.password.length>1024
        ||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||typeof input.trusted!=='boolean')throw new BrowserHttpError();
      return Object.freeze({email:input.email,password:input.password,code:input.code,trusted:input.trusted});
    }catch{throw new BrowserHttpError();}
  }
  return read;
}
