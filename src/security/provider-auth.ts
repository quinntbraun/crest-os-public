import "server-only";
import { AuthClient } from "@supabase/auth-js";
import type { User } from "@supabase/auth-js";
import { createRemoteJWKSet,customFetch,jwtVerify } from "jose";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const requestMs=3000;
const operationMs=10000;
const maximumBytes=128*1024;
export class ProviderAuthenticationError extends Error {
  constructor() { super("PROVIDER_AUTHENTICATION_FAILED"); this.name="ProviderAuthenticationError"; }
}
export type ProviderBinding={ subject:string; sessionId?:string };
export type ExistingProviderBinding={subject:string;sessionId:string};
export type ProviderConfiguration={ issuer:string; publicKey:string; environment:"production"|"test" };
// Trusted server adapter only: implement using the narrow provider-session reader,
// never a browser claim, getUser alone, or a cached cross-request boolean.
export type LiveProviderSessionLookup=(subject:string,sessionId:string,signal:AbortSignal)=>Promise<boolean>;
export type ProviderIdentity=Readonly<{
  state:"provider_verified"; issuer:string; subject:string; sessionId:string; expiresAt:number;
  passwordAt:number; totpAt:number; localSessionAndTenantVerificationRequired:true;
}>;

class ProviderLoginMaterial {
  #access:string;
  #refresh:string;
  readonly identity:ProviderIdentity;
  constructor(identity:ProviderIdentity,access:string,refresh:string) { this.identity=identity; this.#access=access; this.#refresh=refresh; }
  // Deliberate server-to-encryption-store handoff. No controller returns this.
  tokensForServerStorage():{accessToken:string;refreshToken:string} { return {accessToken:this.#access,refreshToken:this.#refresh}; }
  toJSON():never { throw new ProviderAuthenticationError(); }
}

function configuration(config:ProviderConfiguration):URL {
  try {
    const url=new URL(config.issuer);
    if (!['production','test'].includes(config.environment) || url.username || url.password || url.search || url.hash
      || url.pathname!=="/auth/v1" || url.toString()!==config.issuer
      || !(url.protocol==='https:'&&url.port==='' || config.environment==='test'&&url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname))
      || !/^sb_publishable_[A-Za-z0-9_-]{16,300}$/.test(config.publicKey)) throw new Error();
    return url;
  } catch { throw new Error("PROVIDER_CONFIGURATION_REQUIRED"); }
}

function providerFetch(issuer:URL,operation?:AbortSignal):typeof fetch {
  return async (input,init) => {
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
    const method=(init?.method??'GET').toUpperCase();
    const path=url.pathname.slice(issuer.pathname.length);
    const allowed=method==='GET'&&(path==='/user'||path==='/.well-known/jwks.json')&&!url.search
      || method==='POST'&&path==='/token'&&url.search==='?grant_type=password'
      || method==='POST'&&path==='/logout'&&url.search==='?scope=local'
      || method==='POST'&&/^\/factors\/[a-f0-9-]{36}\/(challenge|verify)$/.test(path)&&!url.search;
    if (url.origin!==issuer.origin || !url.pathname.startsWith(`${issuer.pathname}/`) || url.username || url.password || url.hash || !allowed) throw new ProviderAuthenticationError();
    const signals=[AbortSignal.timeout(requestMs)]; if(operation) signals.push(operation);
    const response=await fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.any(signals)});
    const length=Number(response.headers.get('content-length'));
    if(Number.isFinite(length)&&length>maximumBytes) { await response.body?.cancel(); throw new ProviderAuthenticationError(); }
    const reader=response.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
    if(reader) {
      try {
        while(true) { const part=await reader.read(); if(part.done) break; size+=part.value.byteLength;
          if(size>maximumBytes) throw new ProviderAuthenticationError(); chunks.push(part.value); }
      } finally { await reader.cancel().catch(()=>undefined); reader.releaseLock(); }
    }
    const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    // Never forward provider Set-Cookie or incidental headers to a future browser.
    return new Response([204,205,304].includes(response.status)?null:bytes,{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'}});
  };
}

function userIsCurrent(user:User|null,subject:string,now:number):boolean {
  if (!user || user.id!==subject || user.role!=='authenticated' || user.aud!=='authenticated' || user.is_anonymous!==false
    || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at)) || Date.parse(user.email_confirmed_at)>now || user.deleted_at) return false;
  if(user.banned_until && (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until)>now)) return false;
  return !!user.factors?.some(f=>f.factor_type==='totp'&&f.status==='verified'&&uuid.test(f.id));
}

export function createProviderBoundary(config:ProviderConfiguration,liveSession:LiveProviderSessionLookup) {
  const issuer=configuration(config);
  const publicKey=config.publicKey;
  if(typeof liveSession!=='function') throw new Error("PROVIDER_CONFIGURATION_REQUIRED");
  const keys=createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`),{
    timeoutDuration:requestMs,cacheMaxAge:600000,cooldownDuration:30000,[customFetch]:providerFetch(issuer)
  }); // Cache public keys only; JWT/user/provider-session observations are never cached.

  async function claims(access:string,binding:ProviderBinding,requireMfa:boolean):Promise<ProviderIdentity> {
    if(typeof access!=='string'||access.length>32768||!uuid.test(binding.subject)||binding.sessionId!==undefined&&!uuid.test(binding.sessionId)) throw new ProviderAuthenticationError();
    const now=Date.now();
    const {payload,protectedHeader}=await jwtVerify(access,keys,{issuer:issuer.toString(),audience:'authenticated',
      algorithms:['ES256','RS256'],requiredClaims:['sub','session_id','exp','iat','aal','role','is_anonymous','amr'],clockTolerance:0,currentDate:new Date(now)});
    if(protectedHeader.typ!=='JWT'||typeof protectedHeader.kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(protectedHeader.kid)
      || protectedHeader.jku!==undefined||protectedHeader.x5u!==undefined
      || payload.sub!==binding.subject||typeof payload.session_id!=='string'||!uuid.test(payload.session_id)
      || binding.sessionId!==undefined&&payload.session_id!==binding.sessionId
      || payload.aud!=='authenticated'||payload.role!=='authenticated'||payload.is_anonymous!==false
      || !Number.isSafeInteger(payload.iat!*1000)||!Number.isSafeInteger(payload.exp!*1000)||!Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)
      || payload.iat!*1000>now||payload.exp!*1000<=now||payload.exp!<=payload.iat!
      || payload.aal!==(requireMfa?'aal2':'aal1')||!Array.isArray(payload.amr)) throw new ProviderAuthenticationError();
    const references=payload.amr as {method?:unknown;timestamp?:unknown}[];
    if(references.some(r=>!r||typeof r.method!=='string'||typeof r.timestamp!=='number'||!Number.isSafeInteger(r.timestamp)
      ||r.timestamp<0||r.timestamp*1000>now||r.timestamp>payload.iat!)) throw new ProviderAuthenticationError();
    const at=(methods:string[]) => {
      const values=references.filter(r=>typeof r.method==='string'&&methods.includes(r.method)).map(r=>r.timestamp);
      if(!values.length||!values.every(v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v*1000<=now&&v<=payload.iat!)) throw new ProviderAuthenticationError();
      return Math.max(...values as number[])*1000;
    };
    const passwordAt=at(['password']); const totpAt=requireMfa?at(['totp','mfa/totp']):0;
    return Object.freeze({state:'provider_verified',issuer:issuer.toString(),subject:binding.subject,sessionId:payload.session_id,
      expiresAt:payload.exp!*1000,passwordAt,totpAt,localSessionAndTenantVerificationRequired:true});
  }

  async function operation<T>(work:(client:InstanceType<typeof AuthClient>,signal:AbortSignal)=>Promise<T>,external?:AbortSignal):Promise<T> {
    const controller=new AbortController();
    const signal=external?AbortSignal.any([external,controller.signal]):controller.signal;
    const timer=setTimeout(()=>controller.abort(),operationMs); timer.unref();
    let client:InstanceType<typeof AuthClient>|undefined;
    let result:T; let disposalFailed=false;
    try {
      if(signal.aborted)throw new ProviderAuthenticationError();
      const current=new AuthClient({url:issuer.toString(),headers:{apikey:publicKey},fetch:providerFetch(issuer,signal),
        autoRefreshToken:false,persistSession:false,detectSessionInUrl:false,flowType:'pkce',skipAutoInitialize:true,debug:false,throwOnError:false});
      client=current;
      const interrupted=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new ProviderAuthenticationError()),{once:true}));
      const request=(async()=>{ await current.initialize(); return work(current,signal); })();
      result=await Promise.race([request,interrupted]);
      if(signal.aborted) throw new ProviderAuthenticationError();
    } catch { throw new ProviderAuthenticationError(); }
    finally {
      clearTimeout(timer); controller.abort();
      try { await client?.dispose(); } catch { disposalFailed=true; }
    }
    if(disposalFailed) throw new ProviderAuthenticationError();
    return result;
  }
  async function verify(client:InstanceType<typeof AuthClient>,signal:AbortSignal,access:string,binding:ProviderBinding):Promise<ProviderIdentity> {
    const identity=await claims(access,binding,true);
    const {data,error}=await client.getUser(access);
    if(error||!userIsCurrent(data.user,identity.subject,Date.now())) throw new ProviderAuthenticationError();
    const exists=await liveSession(identity.subject,identity.sessionId,signal);
    if(exists!==true||signal.aborted||Date.now()>=identity.expiresAt) throw new ProviderAuthenticationError();
    return identity;
  }
  return Object.freeze({
    verifyAccess(access:string,binding:ExistingProviderBinding,external?:AbortSignal):Promise<ProviderIdentity> {
      const expected=Object.freeze({...binding});
      return operation((client,signal)=>{
        if(!uuid.test(expected.sessionId)) throw new ProviderAuthenticationError();
        return verify(client,signal,access,expected);
      },external);
    },
    authenticatePasswordTotp(input:{email:string;password:string;factorId:string;code:string},binding:ProviderBinding,external?:AbortSignal):Promise<ProviderLoginMaterial> {
      input=Object.freeze({...input}); binding=Object.freeze({...binding});
      return operation(async(client,signal)=>{
        const started=Date.now();
        let createdSession=false;
        try {
        if(!uuid.test(binding.subject)||typeof input.email!=='string'||!input.email.trim()||input.email.length>320||typeof input.password!=='string'||!input.password||input.password.length>1024
          ||typeof input.factorId!=='string'||!uuid.test(input.factorId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||binding.sessionId!==undefined) throw new ProviderAuthenticationError();
        const signed=await client.signInWithPassword({email:input.email.trim(),password:input.password});
        createdSession=!!signed.data.session;
        if(signed.error||!signed.data.session||signed.data.user?.id!==binding.subject) throw new ProviderAuthenticationError();
        const initial=await claims(signed.data.session.access_token,binding,false);
        if(initial.passwordAt<Math.floor(started/1000)*1000) throw new ProviderAuthenticationError();
        const profile=await client.getUser(signed.data.session.access_token);
        if(profile.error||!userIsCurrent(profile.data.user,binding.subject,Date.now())
          ||!profile.data.user?.factors?.some(f=>f.id===input.factorId&&f.factor_type==='totp'&&f.status==='verified')) throw new ProviderAuthenticationError();
        const mfa=await client.mfa.challengeAndVerify({factorId:input.factorId,code:input.code});
        if(mfa.error||!mfa.data?.access_token||!mfa.data.refresh_token||mfa.data.refresh_token.length>32768) throw new ProviderAuthenticationError();
        const identity=await verify(client,signal,mfa.data.access_token,{subject:binding.subject,sessionId:initial.sessionId});
        if(identity.passwordAt<Math.floor(started/1000)*1000||identity.totpAt<Math.floor(started/1000)*1000) throw new ProviderAuthenticationError();
        return new ProviderLoginMaterial(identity,mfa.data.access_token,mfa.data.refresh_token);
        } catch {
          // This client owns only this attempt's newly created session. Local
          // signout must never log out an already authenticated second device.
          if(createdSession&&!signal.aborted) {
            try { await client.signOut({scope:'local'}); } catch { /* best effort; no raw SDK cause */ }
          }
          throw new ProviderAuthenticationError();
        }
      },external);
    }
  });
}
