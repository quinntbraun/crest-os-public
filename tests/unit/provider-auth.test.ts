import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload } from "jose";
vi.mock("server-only",()=>({})); // Test loader only; production retains the client-import guard.
import { createProviderBoundary, ProviderAuthenticationError } from "../../src/security/provider-auth.ts";
import type { LiveProviderSessionLookup, ProviderConfiguration } from "../../src/security/provider-auth.ts";

// Synthetic protocol fixture, not a running Supabase Auth service. Keys exist only in RAM.
const owner="00000000-0000-4000-8000-000000000001";
const other="00000000-0000-4000-8000-000000000002";
const factor="00000000-0000-4000-8000-000000000003";
const challenge="00000000-0000-4000-8000-000000000004";
const fixedSession="00000000-0000-4000-8000-000000000005";
const email="first@example.com";
const password="synthetic-test-password-only";
const input={email,password,factorId:factor,code:"123456"};
let ec:Awaited<ReturnType<typeof generateKeyPair>>;
let rsa:Awaited<ReturnType<typeof generateKeyPair>>;
let foreign:Awaited<ReturnType<typeof generateKeyPair>>;
let jwks:object;
let issuer:string;
let userOverrides:Record<string,unknown>;
let initialOverrides:JWTPayload;
let verifiedOverrides:JWTPayload;
let refreshReference:JWTPayload;
let refreshOverrides:JWTPayload;
let mode:string;
let paths:string[];
let lookups:number;
const sessions=new Map<string,string>();
const challenges=new Map<string,string>();
const profile=(subject=owner)=>({id:subject,aud:"authenticated",role:"authenticated",is_anonymous:false,
  email_confirmed_at:"2020-01-01T00:00:00.000Z",created_at:"2020-01-01T00:00:00.000Z",
  app_metadata:{},user_metadata:{},factors:[{id:factor,factor_type:"totp",status:"verified"}],...userOverrides});
async function token(overrides:JWTPayload={},algorithm="ES256",header:Record<string,unknown>={},wrongKey=false) {
  const now=Math.floor(Date.now()/1000);
  const claims:JWTPayload={iss:issuer,aud:"authenticated",sub:owner,session_id:fixedSession,iat:now,exp:now+3600,
    aal:"aal2",role:"authenticated",is_anonymous:false,amr:[{method:"password",timestamp:now},{method:"totp",timestamp:now}],...overrides};
  const key=wrongKey?foreign.privateKey:algorithm==='RS256'?rsa.privateKey:ec.privateKey;
  return new SignJWT(claims).setProtectedHeader({alg:algorithm,kid:algorithm==='RS256'?'rsa':'ec',typ:'JWT',...header}).sign(key);
}
const json=(res:ServerResponse,value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
async function serve(req:IncomingMessage,res:ServerResponse) {
  const path=req.url??''; paths.push(`${req.method} ${path}`);
  if(path==='/auth/v1/.well-known/jwks.json') {
    if(mode==='jwks-outage') {json(res,{msg:'private key endpoint diagnostic'},503);return;}
    if(mode==='jwks-malformed') {json(res,{keys:'invalid'});return;}
    json(res,jwks);return;
  }
  if(mode==='redirect') {res.writeHead(302,{location:`${issuer}/unexpected`});res.end();return;}
  if(mode==='large') {res.writeHead(200,{'content-length':131073});res.end('x'.repeat(131073));return;}
  if(mode==='chunked-large') {res.writeHead(200,{'content-type':'application/json'});res.write('x'.repeat(80000));res.end('x'.repeat(80000));return;}
  if(mode==='malformed') {res.end('{');return;}
  if(mode==='unavailable') {json(res,{msg:'private provider diagnostic'},503);return;}
  if(mode==='hanging') return;
  if(path==='/auth/v1/token?grant_type=refresh_token'){
    let body='';for await(const chunk of req)body+=chunk;
    if(JSON.parse(body).refresh_token!=='synthetic-refresh-only'){json(res,{msg:'synthetic denied'},400);return;}
    const now=Math.floor(Date.now()/1000);
    json(res,{access_token:await token({...refreshReference,iat:now,exp:now+3600,...refreshOverrides}),refresh_token:'synthetic-rotated-only',expires_in:3600,token_type:'bearer',user:profile(refreshReference.sub)});return;
  }
  if(path==='/auth/v1/token?grant_type=password') {
    let body='';for await(const chunk of req) body+=chunk;
    const credentials=JSON.parse(body);
    const subject=credentials.email===email?owner:credentials.email==='second@example.com'?other:null;
    if(!subject||credentials.password!==password) {json(res,{msg:'private credential diagnostic'},400);return;}
    const sessionId=randomUUID();sessions.set(sessionId,subject);
    const now=Math.floor(Date.now()/1000);
    json(res,{access_token:await token({sub:subject,session_id:sessionId,aal:'aal1',amr:[{method:'password',timestamp:now}],...initialOverrides},'ES256',{},mode==='initial-wrong-key'),
      refresh_token:'synthetic-refresh-only',expires_in:3600,token_type:'bearer',user:profile(subject)});return;
  }
  const bearer=req.headers.authorization?.slice('Bearer '.length);
  const claims=bearer?decodeJwt(bearer):null;
  if(path==='/auth/v1/logout?scope=local'&&typeof claims?.session_id==='string') {sessions.delete(claims.session_id);res.writeHead(204);res.end();return;}
  if(path==='/auth/v1/user') {json(res,profile(claims?.sub));return;}
  if(path===`/auth/v1/factors/${factor}/challenge`&&claims?.sub&&typeof claims.session_id==='string') {
    challenges.set(claims.session_id,challenge);json(res,{id:challenge,type:'totp',expires_at:Math.floor(Date.now()/1000)+60});return;
  }
  if(path===`/auth/v1/factors/${factor}/verify`&&claims?.sub&&typeof claims.session_id==='string') {
    let body='';for await(const chunk of req) body+=chunk;
    const submitted=JSON.parse(body);
    if(submitted.code!=='123456'||submitted.challenge_id!==challenges.get(claims.session_id)) {json(res,{msg:'private MFA diagnostic'},400);return;}
    const now=Math.floor(Date.now()/1000);
    json(res,{access_token:await token({sub:claims.sub,session_id:claims.session_id,amr:[{method:'password',timestamp:now},{method:'mfa/totp',timestamp:now}],...verifiedOverrides}),
      refresh_token:'synthetic-refreshed-only',expires_in:3600,token_type:'bearer',user:profile(claims.sub)});return;
  }
  json(res,{msg:'unexpected fixture endpoint'},404);
}
const server=createServer((req,res)=>{void serve(req,res).catch(()=>json(res,{msg:'fixture failure'},500));});
const configuration=():ProviderConfiguration=>({issuer,publicKey:'sb_publishable_synthetic_test_only_0000',environment:'test'});
const live:LiveProviderSessionLookup=async(subject,id,signal)=>{lookups++;return !signal.aborted&&sessions.get(id)===subject;};
const boundary=(lookup:LiveProviderSessionLookup=live)=>createProviderBoundary(configuration(),lookup);
const binding={subject:owner,sessionId:fixedSession};
async function denied(work:Promise<unknown>) {
  const error=await work.then(()=>null,error=>error);
  expect(error).toBeInstanceOf(ProviderAuthenticationError);
  expect(error.message).toBe('PROVIDER_AUTHENTICATION_FAILED');
  expect(error.cause).toBeUndefined();
}
beforeAll(async()=>{
  [ec,rsa,foreign]=await Promise.all([generateKeyPair('ES256'),generateKeyPair('RS256'),generateKeyPair('ES256')]);
  jwks={keys:[{...await exportJWK(ec.publicKey),kid:'ec',alg:'ES256',use:'sig'},{...await exportJWK(rsa.publicKey),kid:'rsa',alg:'RS256',use:'sig'}]};
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string') throw new Error('fixture bind failed');
  issuer=`http://127.0.0.1:${address.port}/auth/v1`;
});
beforeEach(()=>{sessions.clear();sessions.set(fixedSession,owner);challenges.clear();userOverrides={};initialOverrides={};verifiedOverrides={};refreshReference={};refreshOverrides={};mode='normal';paths=[];lookups=0;});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});

describe('server provider evidence with actual SDK HTTP and JWT signatures',()=>{
  it.each(['ES256','RS256'])('accepts %s only as provider evidence, with immutable identity',async algorithm=>{
    const identity=await boundary().verifyAccess(await token({},algorithm),binding);
    expect(identity).toMatchObject({state:'provider_verified',subject:owner,sessionId:fixedSession,localSessionAndTenantVerificationRequired:true});
    expect(Object.isFrozen(identity)).toBe(true);expect(lookups).toBe(1);expect(paths).toContain('GET /auth/v1/user');
  });
  it('rechecks user and live session on every request and denies a deleted session before JWT expiry',async()=>{
    const gate=boundary();const access=await token();
    await gate.verifyAccess(access,binding);await gate.verifyAccess(access,binding);
    expect(paths.filter(p=>p.endsWith('/user'))).toHaveLength(2);expect(lookups).toBe(2);
    sessions.delete(fixedSession);await denied(gate.verifyAccess(access,binding));expect(lookups).toBe(3);
  });
  it('caches only public keys and bounds unknown-key refetch pressure',async()=>{
    const gate=boundary();await gate.verifyAccess(await token(),binding);
    await denied(gate.verifyAccess(await token({},'ES256',{kid:'unknown'}),binding));
    await gate.verifyAccess(await token(),binding);
    expect(paths.filter(p=>p.endsWith('/.well-known/jwks.json'))).toHaveLength(1);
    expect(paths.filter(p=>p.endsWith('/user'))).toHaveLength(2);expect(lookups).toBe(2);
  });
  it('rejects a provider session owned by another subject and adapter failures without leaking causes',async()=>{
    sessions.set(fixedSession,other);await denied(boundary().verifyAccess(await token(),binding));
    await denied(boundary(async()=>{throw new Error('secret diagnostic');}).verifyAccess(await token(),binding));
  });
  it('never replaces actual authentication times with token issue time after refresh',async()=>{
    const old=Math.floor(Date.now()/1000)-3600;
    const identity=await boundary().verifyAccess(await token({amr:[{method:'password',timestamp:old},{method:'totp',timestamp:old}]}),binding);
    expect(identity.passwordAt).toBe(old*1000);expect(identity.totpAt).toBe(old*1000);
  });
  it('performs password and TOTP through the SDK and blocks accidental JSON token exposure',async()=>{
    const material=await boundary().authenticatePasswordTotp(input,{subject:owner});
    expect(material.identity.subject).toBe(owner);expect(material.identity.totpAt).toBeGreaterThan(Date.now()-2000);
    const storage=material.tokensForServerStorage();expect(decodeJwt(storage.accessToken).aal).toBe('aal2');
    expect(storage.refreshToken).toBe('synthetic-refreshed-only');
    expect(()=>JSON.stringify(material)).toThrow('PROVIDER_AUTHENTICATION_FAILED');
    expect(paths).toContain(`POST /auth/v1/factors/${factor}/challenge`);
    expect(paths).toContain(`POST /auth/v1/factors/${factor}/verify`);
  });
  it('awaits an immutable token-free signed password reference before profile or MFA requests',async()=>{
    let seen=false;
    const material=await boundary().authenticatePasswordTotp(input,{subject:owner},undefined,async(reference,signal)=>{
      seen=true;expect(signal.aborted).toBe(false);expect(Object.isFrozen(reference)).toBe(true);
      expect(Object.keys(reference).sort()).toEqual(['expiresAt','issuer','passwordAt','sessionId','subject']);
      expect(reference).toMatchObject({issuer,subject:owner});expect(sessions.get(reference.sessionId)).toBe(owner);
      expect(paths.some(p=>p.includes('/user')||p.includes('/factors/'))).toBe(false);
      expect(challenges.size).toBe(0);
    });expect(seen).toBe(true);expect(material.identity.subject).toBe(owner);
  });
  it('failed durable observer blocks profile/MFA and cleans only the new password session',async()=>{
    const observer=vi.fn(async()=>{throw new Error('synthetic unknown receipt commit');});
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner},undefined,observer));
    expect(observer).toHaveBeenCalledTimes(1);expect(challenges.size).toBe(0);expect(paths.some(p=>p.includes('/factors/'))).toBe(false);
    expect(paths).toContain('POST /auth/v1/logout?scope=local');expect(sessions.size).toBe(1);expect(sessions.get(fixedSession)).toBe(owner);
  });
  it('cancellation during receipt confirmation never continues to profile or MFA',async()=>{
    const controller=new AbortController();
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner},controller.signal,async()=>{controller.abort();}));
    expect(challenges.size).toBe(0);expect(paths.some(p=>p.includes('/factors/'))).toBe(false);
  });
  it.each([{sub:other},{aal:'aal2'},{exp:1},{amr:[{method:'password',timestamp:1}]}])('invalid or stale initial signed claims never reach the observer: %j',async overrides=>{
    initialOverrides=overrides;const observer=vi.fn(async()=>{});
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner},undefined,observer));expect(observer).not.toHaveBeenCalled();expect(challenges.size).toBe(0);
  });
  it('rejects an invalid initial signature before delivering a password-session reference',async()=>{
    mode='initial-wrong-key';const observer=vi.fn(async()=>{});
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner},undefined,observer));expect(observer).not.toHaveBeenCalled();expect(challenges.size).toBe(0);
  });
  it('rejects a malformed trusted observer before any provider HTTP request',async()=>{
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner},undefined,{} as never));expect(paths).toHaveLength(0);
  });
  it('isolates simultaneous SDK sessions for distinct durable subjects',async()=>{
    const gate=boundary();const [a,b]=await Promise.all([gate.authenticatePasswordTotp(input,{subject:owner}),
      gate.authenticatePasswordTotp({...input,email:'second@example.com'},{subject:other})]);
    expect(a.identity.subject).toBe(owner);expect(b.identity.subject).toBe(other);
    expect(a.identity.sessionId).not.toBe(b.identity.sessionId);
    expect(decodeJwt(a.tokensForServerStorage().accessToken).sub).toBe(owner);
    expect(decodeJwt(b.tokensForServerStorage().accessToken).sub).toBe(other);
  });
  it('snapshots caller inputs before awaiting network IO',async()=>{
    const credentials={...input};const expected={subject:owner};
    const result=boundary().authenticatePasswordTotp(credentials,expected);
    credentials.code='000000';expected.subject=other;
    expect((await result).identity.subject).toBe(owner);
  });
  it.each([
    ['wrong issuer',{iss:'https://wrong.example/auth/v1'}],['wrong audience',{aud:'service_role'}],
    ['ambiguous audience',{aud:['authenticated','service_role']}],['unrepresentable expiry',{exp:Number.MAX_SAFE_INTEGER}],
    ['wrong role',{role:'service_role'}],['anonymous',{is_anonymous:true}],['wrong subject',{sub:other}],
    ['wrong session',{session_id:randomUUID()}],['invalid session',{session_id:'not-a-uuid'}],
    ['expired',{exp:1}],['future issue',{iat:Math.floor(Date.now()/1000)+3600}],
    ['expiry before issue',{iat:Math.floor(Date.now()/1000)+10,exp:Math.floor(Date.now()/1000)+9}],
    ['AAL1',{aal:'aal1'}],['missing AMR',{amr:undefined}],['malformed AMR',{amr:'password'}],
    ['password only',{amr:[{method:'password',timestamp:1}]}],['TOTP only',{amr:[{method:'totp',timestamp:1}]}],
    ['future AMR',{amr:[{method:'password',timestamp:9999999999},{method:'totp',timestamp:1}]}],
    ['text AMR time',{amr:[{method:'password',timestamp:'1'},{method:'totp',timestamp:1}]}],
    ['malformed AMR method',{amr:[{method:['password'],timestamp:1},{method:'totp',timestamp:1}]}],
    ['malformed extra AMR',{amr:[{method:'password',timestamp:1},{method:'totp',timestamp:1},null]}],
    ['fractional AMR',{amr:[{method:'password',timestamp:1.5},{method:'totp',timestamp:1}]}]
  ])('rejects signed %s before online identity checks',async(_name,overrides)=>{
    await denied(boundary().verifyAccess(await token(overrides as JWTPayload),binding));
    expect(lookups).toBe(0);expect(paths).not.toContain('GET /auth/v1/user');
  });
  it.each([{kid:undefined},{typ:'at+jwt'},{jku:'https://attacker.example/jwks'},{x5u:'https://attacker.example/cert'}])('rejects unsafe JWT header %j',async header=>{
    await denied(boundary().verifyAccess(await token({},'ES256',header),binding));expect(lookups).toBe(0);
    expect(paths.every(p=>p==='GET /auth/v1/.well-known/jwks.json')).toBe(true);
  });
  it('rejects a wrong signature, unsigned and HMAC downgrade tokens',async()=>{
    await denied(boundary().verifyAccess(await token({},'ES256',{},true),binding));
    const access=await token();const [,payload]=access.split('.');
    const header=Buffer.from(JSON.stringify({alg:'none',kid:'ec',typ:'JWT'})).toString('base64url');
    await denied(boundary().verifyAccess(`${header}.${payload}.`,binding));
    const symmetric=await new SignJWT(decodeJwt(access)).setProtectedHeader({alg:'HS256',kid:'ec',typ:'JWT'}).sign(new Uint8Array(32).fill(7));
    await denied(boundary().verifyAccess(symmetric,binding));
    expect(lookups).toBe(0);
  });
  it.each([{is_anonymous:true},{email_confirmed_at:null},{email_confirmed_at:'invalid'},{deleted_at:'2020-01-01'},
    {banned_until:'2099-01-01'},{banned_until:'invalid'},{id:other},{role:'service_role'},{factors:[]},
    {factors:[{id:factor,factor_type:'totp',status:'unverified'}]}])('rejects inactive or ineligible online user %j',async overrides=>{
    userOverrides=overrides;await denied(boundary().verifyAccess(await token(),binding));expect(lookups).toBe(0);
  });
  it.each([{password:'incorrect'},{code:'000000'},{code:'1'},{factorId:other},{email:'unknown@example.com'}])('rejects invalid login input %j',async overrides=>{
    await denied(boundary().authenticatePasswordTotp({...input,...overrides},{subject:owner}));
  });
  it('does not authorize email equality or an existing session as a fresh login',async()=>{
    await denied(boundary().authenticatePasswordTotp(input,{subject:other}));
    await denied(boundary().authenticatePasswordTotp(input,binding));
  });
  it('cleans up only the failed attempt provider session, preserving another device',async()=>{
    const gate=boundary();const material=await gate.authenticatePasswordTotp(input,{subject:owner});
    await denied(gate.authenticatePasswordTotp({...input,code:'000000'},{subject:owner}));
    expect(sessions.has(material.identity.sessionId)).toBe(true);
    expect([...sessions.values()].filter(s=>s===owner)).toHaveLength(2); // prior fixture session and successful device only
    expect(paths).toContain('POST /auth/v1/logout?scope=local');
  });
  it('requires fresh password AMR and fresh TOTP AMR from the completed ceremony',async()=>{
    initialOverrides={amr:[{method:'password',timestamp:1}]};
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner}));
    initialOverrides={};verifiedOverrides={amr:[{method:'password',timestamp:1},{method:'totp',timestamp:1}]};
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner}));
  });
  it('requires same provider session throughout MFA',async()=>{
    verifiedOverrides={session_id:fixedSession};
    await denied(boundary().authenticatePasswordTotp(input,{subject:owner}));
  });
  it.each(['redirect','large','chunked-large','malformed','unavailable','jwks-outage','jwks-malformed'])('fails closed on %s without diagnostics or redirects',async failure=>{
    mode=failure;const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {await denied(boundary().verifyAccess(await token(),binding));expect(log).not.toHaveBeenCalled();}
    finally {log.mockRestore();}
    expect(paths).not.toContain('GET /auth/v1/unexpected');expect(lookups).toBe(0);
  });
  it('bounds an unresponsive provider request at three seconds',async()=>{
    mode='hanging';const start=Date.now();await denied(boundary().verifyAccess(await token(),binding));
    expect(Date.now()-start).toBeGreaterThanOrEqual(2800);expect(Date.now()-start).toBeLessThan(5000);
    expect(paths).toContain('GET /auth/v1/user');expect(lookups).toBe(0);
  },7000);
  it('bounds a hanging live-session adapter at ten seconds and signals cancellation',async()=>{
    let signal:AbortSignal|undefined;const start=Date.now();
    const gate=boundary(async(_subject,_session,current)=>{signal=current;return new Promise(()=>{});});
    await denied(gate.verifyAccess(await token(),binding));expect(signal?.aborted).toBe(true);
    expect(Date.now()-start).toBeLessThan(12000);
  },15000);
  it('rejects externally cancelled verification/login before provider IO',async()=>{
    const controller=new AbortController();controller.abort();const gate=boundary();
    await denied(gate.verifyAccess(await token(),binding,controller.signal));await denied(gate.authenticatePasswordTotp(input,{subject:owner},controller.signal));expect(paths).toHaveLength(0);
  });
  it('propagates active caller cancellation to provider/session verification',async()=>{
    let entered:()=>void=()=>{};const ready=new Promise<void>(resolve=>{entered=resolve;});let observed:AbortSignal|undefined;
    const gate=boundary(async(_subject,_session,signal)=>{observed=signal;entered();return new Promise(()=>{});});
    const controller=new AbortController(),work=gate.verifyAccess(await token(),binding,controller.signal);await ready;controller.abort();
    await denied(work);expect(observed?.aborted).toBe(true);
  });
  it('refreshes an expired signed AMR reference without using it as current provider evidence',async()=>{
    const old=Math.floor(Date.now()/1000)-3600,access=await token({iat:old,exp:old+3599,amr:[{method:'password',timestamp:old},{method:'totp',timestamp:old}]});refreshReference=decodeJwt(access);
    const gate=boundary();await denied(gate.verifyAccess(access,binding));
    const material=await gate.refreshForSession({accessToken:access,refreshToken:'synthetic-refresh-only'},binding);
    expect(material.identity.passwordAt).toBe(old*1000);expect(material.identity.totpAt).toBe(old*1000);expect(material.identity.expiresAt).toBeGreaterThan(Date.now());
    expect(material.tokensForServerStorage().refreshToken).toBe('synthetic-rotated-only');expect(()=>JSON.stringify(material)).toThrow();
    expect(paths.filter(p=>p.includes('grant_type=refresh_token'))).toHaveLength(1);expect(lookups).toBe(1);
  });
  it('rejects an expired reference with an invalid signature before any refresh exchange',async()=>{
    const old=Math.floor(Date.now()/1000)-3600;await denied(boundary().refreshForSession({accessToken:await token({iat:old,exp:old+3599},'ES256',{},true),refreshToken:'synthetic-refresh-only'},binding));
    expect(paths.some(p=>p.includes('grant_type=refresh_token'))).toBe(false);
  });
  it.each([{iss:'https://other.example.com/auth/v1'},{aud:'other'},{sub:other},{session_id:other},{aal:'aal1'},{role:'service_role'},{is_anonymous:true},{nbf:4102444800}])('rejects invalid reference binding %j',async overrides=>{
    await denied(boundary().refreshForSession({accessToken:await token(overrides),refreshToken:'synthetic-refresh-only'},binding));expect(paths.some(p=>p.includes('grant_type=refresh_token'))).toBe(false);
  });
  it.each(['subject','session','aal','password','totp'])('rejects refreshed %s changes',async field=>{
    const old=Math.floor(Date.now()/1000)-3600,amr=[{method:'password',timestamp:old},{method:'totp',timestamp:old}],access=await token({amr});refreshReference=decodeJwt(access);
    refreshOverrides=field==='subject'?{sub:other}:field==='session'?{session_id:other}:field==='aal'?{aal:'aal1'}:{amr:amr.map(a=>a.method===field?{...a,timestamp:old+1}:a)};
    await denied(boundary().refreshForSession({accessToken:access,refreshToken:'synthetic-refresh-only'},binding));expect(paths.filter(p=>p.includes('grant_type=refresh_token'))).toHaveLength(1);
  });
  it.each(['unavailable','hanging'])('does not let the SDK retry an uncertain %s refresh',async failure=>{
    const access=await token(),gate=boundary();refreshReference=decodeJwt(access);
    await gate.verifyAccess(access,binding);paths=[];mode=failure;const started=Date.now();
    await denied(gate.refreshForSession({accessToken:access,refreshToken:'synthetic-refresh-only'},binding));
    expect(Date.now()-started).toBeLessThan(5000);expect(paths.filter(p=>p.includes('grant_type=refresh_token'))).toHaveLength(1);
  },7000);
  it('uses the public-key SDK logout endpoint only for the exact signed session and local scope',async()=>{
    const second=randomUUID();sessions.set(second,owner);const access=await token();await boundary().signOutLocal(access,binding);
    expect(sessions.has(fixedSession)).toBe(false);expect(sessions.has(second)).toBe(true);expect(lookups).toBe(0);
    expect(paths.filter(path=>path.includes('/logout'))).toEqual(['POST /auth/v1/logout?scope=local']);expect(paths.some(path=>path.endsWith('/user'))).toBe(false);
  });
  it('rejects substituted logout identity and session before provider logout',async()=>{
    const access=await token();await denied(boundary().signOutLocal(access,{subject:other,sessionId:fixedSession}));
    await denied(boundary().signOutLocal(access,{subject:owner,sessionId:randomUUID()}));expect(paths.some(path=>path.includes('/logout'))).toBe(false);
  });
  it('returns a generic failure for provider logout outage without replaying it',async()=>{
    const access=await token();mode='unavailable';await denied(boundary().signOutLocal(access,binding));expect(paths.filter(path=>path.includes('/logout'))).toHaveLength(1);
  });
  it.each([
    {issuer:'http://example.com/auth/v1',environment:'production'},
    {issuer:'http://localhost/auth/v1'},{issuer:'http://169.254.169.254/auth/v1'},
    {issuer:'https://example.com/auth/v1/'},{issuer:'https://example.com/auth/v1?x=1'},
    {issuer:'https://example.com/auth/v1#x'},{issuer:'https://example.com/auth/v1',publicKey:'sb_secret_not_allowed'},
    {issuer:'https://example.com:8443/auth/v1'},{issuer:'https://user:pass@example.com/auth/v1'}
  ])('rejects unsafe configuration before IO %j',overrides=>{
    expect(()=>createProviderBoundary({...configuration(),...overrides} as ProviderConfiguration,live)).toThrow('PROVIDER_CONFIGURATION_REQUIRED');
    expect(paths).toHaveLength(0);
  });
});
