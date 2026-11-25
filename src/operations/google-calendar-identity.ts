import 'server-only';
import {createHash,timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
import {GoogleCalendarOAuthError,googleCalendarOAuthIssuer} from './google-calendar-oauth.ts';

export type GoogleCalendarProviderIdentity=Readonly<{issuer:typeof googleCalendarOAuthIssuer;subject:string}>;
export function googleCalendarProviderSubject(value:unknown):value is string{return typeof value==='string'&&/^[!-~]{1,255}$/.test(value);}
const keysUrl='https://www.googleapis.com/oauth2/v3/certs';
const tokenPattern=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
function requireIdentity(value:unknown):asserts value{if(!value)throw new GoogleCalendarOAuthError();}

// Only public Google verification keys are retrieved here: no cookies,
// access/refresh tokens or private account information reach this endpoint.
export function createGoogleCalendarIdentityVerifier(clientId:string,request:typeof fetch){
 requireIdentity(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)&&typeof request==='function');
 const keys=createRemoteJWKSet(new URL(keysUrl),{timeoutDuration:3000,cooldownDuration:30000,cacheMaxAge:300000,
  [customFetch]:async(url,options)=>{
   requireIdentity(url===keysUrl&&options.method==='GET');
   const response=await request(keysUrl,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{accept:'application/json'},signal:options.signal});
   requireIdentity(response.status===200&&!response.redirected&&response.type!=='opaqueredirect'&&(!response.url||response.url===keysUrl)&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''));
   const size=response.headers.get('content-length');requireIdentity(size===null||/^\d{1,5}$/.test(size)&&Number(size)<=65536);
   const reader=response.body?.getReader();requireIdentity(reader);const chunks:Uint8Array[]=[];let length=0;
   try{for(;;){options.signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;requireIdentity(length<=65536);chunks.push(chunk.value);}}
   finally{void reader.cancel().catch(()=>undefined);reader.releaseLock();}
   const body=Buffer.concat(chunks);const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
   requireIdentity(value&&typeof value==='object'&&!Array.isArray(value)&&'keys'in value&&Array.isArray(value.keys)&&value.keys.length>0&&value.keys.length<=32);
   return new Response(body,{status:200,headers:{'content-type':'application/json'}});
  }});
 return async(token:unknown,accessToken:string,nonce:string|undefined,signal:AbortSignal,expected?:GoogleCalendarProviderIdentity):Promise<GoogleCalendarProviderIdentity>=>{
  try{
   signal.throwIfAborted();requireIdentity(typeof token==='string'&&token.length<=16384&&tokenPattern.test(token));
   const verified=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:[googleCalendarOAuthIssuer,'accounts.google.com'],audience:clientId,requiredClaims:['iss','sub','aud','iat','exp'],clockTolerance:5,maxTokenAge:3600});
   signal.throwIfAborted();const claims=verified.payload,header=verified.protectedHeader,now=Math.floor(Date.now()/1000);
   requireIdentity(!header.jku&&!header.x5u&&(!header.typ||header.typ==='JWT')&&typeof header.kid==='string'&&header.kid.length<=255&&claims.aud===clientId&&(claims.azp===undefined||claims.azp===clientId)&&googleCalendarProviderSubject(claims.sub)&&typeof claims.iat==='number'&&Number.isSafeInteger(claims.iat)&&claims.iat<=now+5&&typeof claims.exp==='number'&&Number.isSafeInteger(claims.exp)&&claims.exp>claims.iat&&claims.exp-claims.iat<=3605);
   if(nonce!==undefined)requireIdentity(/^[A-Za-z0-9_-]{43}$/.test(nonce)&&claims.nonce===nonce);
   if(claims.at_hash!==undefined){
    const expectedHash=createHash('sha256').update(accessToken,'ascii').digest().subarray(0,16).toString('base64url');
    requireIdentity(typeof claims.at_hash==='string'&&claims.at_hash.length===expectedHash.length&&timingSafeEqual(Buffer.from(claims.at_hash),Buffer.from(expectedHash)));
   }
   const identity=Object.freeze({issuer:googleCalendarOAuthIssuer,subject:claims.sub});
   requireIdentity(!expected||expected.issuer===identity.issuer&&expected.subject===identity.subject);return identity;
  }catch{throw new GoogleCalendarOAuthError();}
 };
}
