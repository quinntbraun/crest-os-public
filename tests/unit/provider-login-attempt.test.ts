import {randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const {query,revoke}=vi.hoisted(()=>({query:vi.fn(),revoke:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>query}));
vi.mock('../../src/security/session-revocation-db.ts',()=>({createSessionRevoker:()=>revoke}));
import type {ProviderPasswordSessionObserver} from '../../src/security/provider-auth.ts';
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import type {createProviderTokenStore} from '../../src/security/provider-token-store.ts';

const issuer='https://auth.example.com/auth/v1',subject:string=randomUUID(),actorId=randomUUID(),epoch=randomUUID();
const input=():{email:string;password:string;factorId:string;code:string}=>({email:'synthetic@example.com',password:'synthetic-only',factorId:randomUUID(),code:'123456'});
const base=createProviderBoundary({issuer,publicKey:'sb_publishable_synthetic_test_only',environment:'test'},async()=>false);
const authenticate=vi.fn(),signOut=vi.fn(),encrypt=vi.fn();
const provider={...base,authenticatePasswordTotp:authenticate,signOutLocal:signOut};
const tokens={encrypt} as unknown as Awaited<ReturnType<typeof createProviderTokenStore>>;
const lifecycle=()=>createSessionLifecycle({connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test'},provider,tokens);
const run=(data=input(),binding={subject},signal=new AbortController().signal)=>lifecycle().login(data,binding,false,signal);
const confirmed=(_sql:string,args:unknown[])=>({attemptId:args[0],appSessionId:args[1],actorId,securityEpoch:epoch});
beforeEach(()=>{vi.resetAllMocks();query.mockImplementation(confirmed);authenticate.mockRejectedValue(new Error('synthetic provider denial'));revoke.mockResolvedValue(undefined);signOut.mockResolvedValue(undefined);});

it('confirms a unique durable attempt before the first provider call and never retries provider failure',async()=>{
  authenticate.mockImplementation(async()=>{expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]![0]).toContain('begin_provider_login');throw new Error('synthetic denial');});
  await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(authenticate).toHaveBeenCalledTimes(1);
  const args=query.mock.calls[0]![1] as unknown[];expect(args[0]).not.toBe(args[1]);expect(args.slice(2)).toEqual([issuer,subject]);expect(revoke).not.toHaveBeenCalled();
});
it.each(['failure','null','wrong-attempt','wrong-session','wrong-actor','wrong-epoch'])('stops before provider I/O on an unconfirmed begin: %s',async reason=>{
  query.mockImplementation(async(sql,args)=>{if(reason==='failure')throw new Error('uncertain commit');if(reason==='null')return null;
    const result=confirmed(sql,args);return {...result,...(reason==='wrong-attempt'?{attemptId:randomUUID()}:reason==='wrong-session'?{appSessionId:randomUUID()}:reason==='wrong-actor'?{actorId:'invalid'}:{securityEpoch:'invalid'})};});
  await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(1);expect(authenticate).not.toHaveBeenCalled();expect(revoke).not.toHaveBeenCalled();
});
it('checks cancellation again after a confirmed begin and before provider I/O',async()=>{
  const c=new AbortController();query.mockImplementation(async(sql,args)=>{c.abort();return confirmed(sql,args);});
  await expect(run(input(),{subject},c.signal)).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(authenticate).not.toHaveBeenCalled();
});
it('snapshots credentials and trusted subject before awaiting the begin record',async()=>{
  let release!:(v:unknown)=>void;query.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  const data=input(),original={...data},binding={subject};const pending=run(data,binding);data.password='changed';data.code='999999';binding.subject=randomUUID();
  release(confirmed('',query.mock.calls[0]![1]));await expect(pending).rejects.toThrow('SESSION_LIFECYCLE_FAILED');
  expect(authenticate.mock.calls[0]![0]).toEqual(original);expect(authenticate.mock.calls[0]![1]).toEqual({subject});
});
it('pins the pre-provider epoch, reserved session and attempt through encryption and registration',async()=>{
  const identity={issuer,subject,sessionId:randomUUID(),passwordAt:Date.now()-1000,totpAt:Date.now()-1000};
  authenticate.mockImplementation(async(_input:unknown,_binding:unknown,signal:AbortSignal,observe:ProviderPasswordSessionObserver)=>{await observe({...identity,expiresAt:Date.now()+60000},signal);return {identity,tokensForServerStorage:()=>({accessToken:'synthetic',refreshToken:'synthetic'})};});
  encrypt.mockResolvedValue({ciphertext:Buffer.from('synthetic'),keyId:'synthetic'});
  query.mockImplementation(async(sql,args)=>{if(sql.includes('begin_provider_login'))return confirmed(sql,args);if(sql.includes('record_provider_login_target'))return {evidence:{attemptId:args[0],actorId:args[1],securityEpoch:args[2],providerIssuer:args[3],providerSubject:args[4],providerSessionId:args[5]}};throw new Error('uncertain issuance');});
  await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');const begin=query.mock.calls[0]![1],issue=query.mock.calls[2]!;
  expect(issue[0]).toContain('issue_targeted_app_session');expect(issue[1][0]).toBe(begin[1]);expect(issue[1][3]).toBe(epoch);expect(issue[1][12]).toBe(begin[0]);
  expect(encrypt.mock.calls[0]![1]).toMatchObject({actorId,securityEpoch:epoch,appSessionId:begin[1]});
  expect(revoke).toHaveBeenCalledTimes(1);expect(signOut).toHaveBeenCalledTimes(1);expect(query.mock.calls.some(c=>c[0].includes('session_actor_context'))).toBe(false);
});
it.each(['issuer','subject'])('rejects mismatched provider %s without registering a session',async field=>{
  authenticate.mockResolvedValue({identity:{issuer,subject,sessionId:randomUUID(),[field]:field==='issuer'?'https://other.example.com/auth/v1':randomUUID()},tokensForServerStorage:()=>({accessToken:'synthetic'})});
  await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(1);expect(encrypt).not.toHaveBeenCalled();expect(signOut).toHaveBeenCalledTimes(1);
});
it('rejects malformed or coercible UUID inputs before persisting or calling the provider',async()=>{
  for(const field of ['factorId','subject']){const bad={toString:()=>randomUUID()};const data=input(),binding={subject};
    if(field==='factorId')data.factorId=bad as unknown as string;else binding.subject=bad as unknown as string;
    await expect(run(data,binding)).rejects.toThrow('SESSION_LIFECYCLE_FAILED');}
  expect(query).not.toHaveBeenCalled();expect(authenticate).not.toHaveBeenCalled();
});

const receipt=(args:unknown[])=>({evidence:{attemptId:args[0],actorId:args[1],securityEpoch:args[2],providerIssuer:args[3],providerSubject:args[4],providerSessionId:args[5]}});
function exchange({referenceOverrides={},identityOverrides={},twice=false,omit=false}:{referenceOverrides?:object;identityOverrides?:object;twice?:boolean;omit?:boolean}={}){
  const identity={issuer,subject,sessionId:randomUUID(),passwordAt:Date.now()-1000,totpAt:Date.now()-1000};
  authenticate.mockImplementation(async(_input:unknown,_binding:unknown,signal:AbortSignal,observe:ProviderPasswordSessionObserver)=>{
    const reference={...identity,expiresAt:Date.now()+60000,...referenceOverrides};
    if(!omit){await observe(reference,signal);if(twice)await observe(reference,signal);}
    return {identity:{...identity,...identityOverrides},tokensForServerStorage:()=>({accessToken:'synthetic',refreshToken:'synthetic'})};
  });
  query.mockImplementation(async(sql,args)=>sql.includes('begin_provider_login')?confirmed(sql,args):receipt(args));
}
it.each(['failure','null','attempt','provider'])('an unconfirmed target receipt blocks encryption/issuance without retry: %s',async reason=>{
  exchange();query.mockImplementation(async(sql,args)=>{if(sql.includes('begin_provider_login'))return confirmed(sql,args);
    if(reason==='failure')throw new Error('uncertain receipt commit');if(reason==='null')return null;
    const r=receipt(args);return {evidence:{...r.evidence,...(reason==='attempt'?{attemptId:randomUUID()}:{providerSessionId:randomUUID()})}};});
  await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(authenticate).toHaveBeenCalledTimes(1);expect(query).toHaveBeenCalledTimes(2);
  expect(encrypt).not.toHaveBeenCalled();expect(revoke).not.toHaveBeenCalled();
});
it.each([{issuer:'https://other.example.com/auth/v1'},{subject:randomUUID()},{sessionId:'invalid'}])('rejects mismatched safe references before receipt SQL: %j',async referenceOverrides=>{
  exchange({referenceOverrides});await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(1);expect(encrypt).not.toHaveBeenCalled();
});
it('cannot register returned MFA material when a trusted adapter omits the required observer',async()=>{
  exchange({omit:true});await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(1);expect(encrypt).not.toHaveBeenCalled();expect(signOut).toHaveBeenCalledTimes(1);
});
it('rejects a repeated callback without sending a second receipt or registering',async()=>{
  exchange({twice:true});await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(2);expect(encrypt).not.toHaveBeenCalled();
});
it('cannot swap the provider session after the safe password reference was recorded',async()=>{
  exchange({identityOverrides:{sessionId:randomUUID()}});await expect(run()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(2);expect(encrypt).not.toHaveBeenCalled();expect(signOut).toHaveBeenCalledTimes(1);
});
it('cancellation after target commit never proceeds to session registration',async()=>{
  exchange();const c=new AbortController();query.mockImplementation(async(sql,args)=>{if(sql.includes('begin_provider_login'))return confirmed(sql,args);c.abort();return receipt(args);});
  await expect(run(input(),{subject},c.signal)).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(query).toHaveBeenCalledTimes(2);expect(encrypt).not.toHaveBeenCalled();
});
