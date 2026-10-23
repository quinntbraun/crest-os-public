import {randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const {query,revoke}=vi.hoisted(()=>({query:vi.fn(),revoke:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>query}));
vi.mock('../../src/security/session-revocation-db.ts',()=>({createSessionRevoker:()=>revoke}));
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import type {ProviderPasswordSessionObserver} from '../../src/security/provider-auth.ts';
import type {createProviderTokenStore} from '../../src/security/provider-token-store.ts';

beforeEach(()=>vi.resetAllMocks());
function fixture(){
  const issuer='https://auth.example.com/auth/v1',subject=randomUUID(),actorId=randomUUID(),epoch=randomUUID(),sessionId=randomUUID();
  const controller=new AbortController(),events:string[]=[],now=Date.now();let attemptId:string,appSessionId:string;
  const identity={issuer,subject,sessionId,passwordAt:now-1000,totpAt:now-1000,expiresAt:now+300000,state:'provider_verified' as const,localSessionAndTenantVerificationRequired:true as const};
  const access=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({exp:Math.floor(now/1000)+300})).toString('base64url'),'synthetic'].join('.');
  const base=createProviderBoundary({issuer,publicKey:'sb_publishable_synthetic_test_only',environment:'test'},async()=>false);
  const provider={...base,authenticatePasswordTotp:vi.fn(async(_input:unknown,_binding:unknown,signal:AbortSignal,observe:ProviderPasswordSessionObserver)=>{
    await observe(identity,signal);return {identity,tokensForServerStorage:()=>({accessToken:access,refreshToken:'synthetic'})};
  }),verifyAccess:vi.fn(async()=>{events.push('provider-verify');return identity;}),signOutLocal:vi.fn(async()=>{events.push('provider-cleanup');})};
  const tokens={encrypt:vi.fn(async()=>({keyId:'synthetic',ciphertext:Buffer.from('synthetic')})),decrypt:vi.fn(async()=>({tokensForProvider:()=>({accessToken:access,refreshToken:'synthetic'})}))} as unknown as Awaited<ReturnType<typeof createProviderTokenStore>>;
  const handle=async(sql:string,args:unknown[])=>{
    if(sql.includes('begin_provider_login')){attemptId=args[0] as string;appSessionId=args[1] as string;events.push('begin');return {attemptId,appSessionId,actorId,securityEpoch:epoch};}
    if(sql.includes('record_provider_login_target')){events.push('target');return {evidence:{attemptId,actorId,securityEpoch:epoch,providerIssuer:issuer,providerSubject:subject,providerSessionId:sessionId}};}
    if(sql.includes('issue_open_app_session')){events.push('issue');return null;}
    if(sql.includes('finish_provider_login')){events.push(args[5] as string);return {evidence:{attemptId,appSessionId,actorId,securityEpoch:epoch,providerIssuer:issuer,providerSubject:subject,phase:args[5]}};}
    if(sql.includes('app_session_snapshot')){events.push('snapshot');return {id:appSessionId,version:'1',now:Date.now(),binding:{appSessionId,actorId,securityEpoch:epoch,providerSessionId:sessionId,issuer,subject},
      actor:{id:actorId,kind:'owner',securityEpoch:epoch,disabled:false},session:{actorId,issuedSecurityEpoch:epoch,trusted:false,createdAt:now-1000,authenticatedAt:now-1000,lastActiveAt:now-1000,expiresAt:now+43199000,revokedAt:null,reauthAt:null},keyId:'synthetic',ciphertext:Buffer.from('synthetic').toString('base64')};}
    throw new Error('unexpected trusted query');
  };
  query.mockImplementation(handle);revoke.mockImplementation(async()=>{events.push('fallback-revoke');});
  const lifecycle=createSessionLifecycle({connectionString:'unused',environment:'test'},provider as never,tokens);
  const run=()=>lifecycle.login({email:'synthetic@example.com',password:'synthetic',factorId:randomUUID(),code:'123456'},{subject},false,controller.signal);
  return {run,handle,events,provider,controller};
}
it('confirms registration closure before fresh final verification and opaque credential handoff',async()=>{
  const f=fixture(),issued=await f.run();expect(Buffer.from(issued.cookieValueForResponse(),'base64url')).toHaveLength(32);
  expect(f.events).toEqual(['begin','target','issue','registration_closed','snapshot','provider-verify','snapshot']);expect(revoke).not.toHaveBeenCalled();expect(f.provider.signOutLocal).not.toHaveBeenCalled();
});
it.each(['throw','null','phase','attempt','issuer'])('uncertain or malformed registration closure never releases a credential: %s',async reason=>{
  const f=fixture();query.mockImplementation(async(sql,args)=>{if(sql.includes('finish_provider_login')&&args[5]==='registration_closed'){
    if(reason==='throw')throw new Error('unknown close commit');if(reason==='null')return null;
    const r=await f.handle(sql,args) as {evidence:object};return {evidence:{...r.evidence,...(reason==='phase'?{phase:'stopped_review'}:reason==='attempt'?{attemptId:randomUUID()}:{providerIssuer:'https://other.example.com/auth/v1'})}};
  }return f.handle(sql,args);});
  await expect(f.run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.events).toContain('stopped_review');expect(f.provider.verifyAccess).not.toHaveBeenCalled();expect(f.provider.signOutLocal).toHaveBeenCalledTimes(1);expect(revoke).not.toHaveBeenCalled();
});
it('failed stop confirmation falls back to known credential revocation before scoped provider cleanup',async()=>{
  const f=fixture();query.mockImplementation(async(sql,args)=>{if(sql.includes('finish_provider_login')){f.events.push(String(args[5]));throw new Error('synthetic finish outage');}return f.handle(sql,args);});
  const error=await f.run().catch(error=>error);expect(error.message).toBe('SESSION_LIFECYCLE_FAILED');expect(error.cause).toBeUndefined();expect(f.events.slice(-3)).toEqual(['stopped_review','fallback-revoke','provider-cleanup']);
});
it('provider failure before material return still records a stop without inventing a credential or provider target',async()=>{
  const f=fixture();f.provider.authenticatePasswordTotp.mockRejectedValue(new Error('synthetic SDK denial'));
  await expect(f.run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.events).toEqual(['begin','stopped_review']);expect(revoke).not.toHaveBeenCalled();expect(f.provider.signOutLocal).not.toHaveBeenCalled();
});
it('a prepared registration never bypasses a failed final provider verification',async()=>{
  const f=fixture();f.provider.verifyAccess.mockRejectedValue(new Error('provider revoked'));
  await expect(f.run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.events).toContain('registration_closed');expect(f.events).toContain('stopped_review');expect(f.provider.verifyAccess).toHaveBeenCalledTimes(1);expect(f.provider.signOutLocal).toHaveBeenCalledTimes(1);expect(revoke).not.toHaveBeenCalled();
});
it('request cancellation after registration commit uses an independent stop signal and cannot hand off a credential',async()=>{
  const f=fixture();query.mockImplementation(async(sql,args,signal)=>{const r=await f.handle(sql,args);if(args[5]==='registration_closed')f.controller.abort();if(args[5]==='stopped_review'){expect(signal.aborted).toBe(false);expect(signal).not.toBe(f.controller.signal);}return r;});
  await expect(f.run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.events).toContain('stopped_review');expect(f.provider.verifyAccess).not.toHaveBeenCalled();expect(f.provider.signOutLocal).toHaveBeenCalledTimes(1);
});

it('a malformed stop acknowledgement falls back to local revocation and still scopes provider cleanup',async()=>{
  const f=fixture();f.provider.verifyAccess.mockRejectedValue(new Error('provider failed'));
  query.mockImplementation(async(sql,args)=>sql.includes('finish_provider_login')&&args[5]==='stopped_review'?null:f.handle(sql,args));
  await expect(f.run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(revoke).toHaveBeenCalledTimes(1);expect(f.provider.signOutLocal).toHaveBeenCalledTimes(1);
});
