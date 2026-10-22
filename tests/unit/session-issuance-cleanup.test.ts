import {randomUUID} from 'node:crypto';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({query:vi.fn(),revoke:vi.fn()}));
vi.mock('../../src/security/session-database.ts',()=>({sessionDatabase:()=>mocks.query}));
vi.mock('../../src/security/session-revocation-db.ts',()=>({createSessionRevoker:()=>mocks.revoke}));
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';

beforeEach(()=>vi.resetAllMocks());
function fixture(){
  const events:string[]=[],controller=new AbortController(),subject=randomUUID(),sessionId=randomUUID();
  const material={identity:{subject,sessionId,issuer:'https://crest.example.com/auth/v1',passwordAt:Date.now(),totpAt:Date.now()},tokensForServerStorage:()=>({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'})};
  const provider={authenticatePasswordTotp:vi.fn(async()=>material),signOutLocal:vi.fn(async()=>{events.push('provider');})};
  mocks.query.mockImplementation(async(sql:string,_values:unknown[],signal:AbortSignal)=>{
    if(signal.aborted)throw new Error('synthetic cancellation');
    if(sql.includes('session_actor_context'))return {actorId:randomUUID(),securityEpoch:randomUUID()};
    if(sql.includes('issue_app_session')){controller.abort();return true;}
    throw new Error('unexpected query');
  });
  mocks.revoke.mockImplementation(async()=>{events.push('local');});
  const tokens={encrypt:vi.fn(async()=>({ciphertext:new Uint8Array(16),keyId:'synthetic'}))};
  const lifecycle=createSessionLifecycle({connectionString:'unused',environment:'test'},provider as never,tokens as never);
  const login=()=>lifecycle.login({email:'synthetic@example.com',password:'synthetic',code:'123456',factorId:randomUUID()},{subject},false,controller.signal);
  return {events,controller,subject,sessionId,provider,login};
}
it('cancelled post-commit verification revokes locally then signs out only known new provider material with an independent signal',async()=>{
  const f=fixture();await expect(f.login()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.controller.signal.aborted).toBe(true);expect(f.events).toEqual(['local','provider']);
  const cleanup=mocks.revoke.mock.calls[0]![1] as AbortSignal;expect(cleanup.aborted).toBe(false);expect(cleanup).not.toBe(f.controller.signal);
  expect(f.provider.signOutLocal).toHaveBeenCalledWith('synthetic-access',{subject:f.subject,sessionId:f.sessionId},cleanup);
});
it('failed local cleanup still attempts the exact newly created provider session',async()=>{
  const f=fixture();mocks.revoke.mockImplementation(async()=>{f.events.push('local');throw new Error('synthetic unavailable database');});
  await expect(f.login()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(f.events).toEqual(['local','provider']);expect(f.provider.signOutLocal).toHaveBeenCalledTimes(1);
});
it('failed provider cleanup cannot undo local revocation or expose its exception',async()=>{
  const f=fixture();f.provider.signOutLocal.mockRejectedValue(new Error('private material'));
  const error=await f.login().catch(error=>error);expect(error.message).toBe('SESSION_LIFECYCLE_FAILED');expect(error.cause).toBeUndefined();expect(mocks.revoke).toHaveBeenCalledTimes(1);
});
it('a failure before any credential allocation cleans known provider material without inventing a local session',async()=>{
  const f=fixture();mocks.query.mockRejectedValue(new Error('synthetic context failure'));
  await expect(f.login()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(mocks.revoke).not.toHaveBeenCalled();expect(f.events).toEqual(['provider']);
});
it('an authentication failure without returned provider material cannot target another session for cleanup',async()=>{
  const f=fixture();f.provider.authenticatePasswordTotp.mockRejectedValue(new Error('synthetic rejected login'));
  await expect(f.login()).rejects.toThrow('SESSION_LIFECYCLE_FAILED');expect(mocks.revoke).not.toHaveBeenCalled();expect(f.provider.signOutLocal).not.toHaveBeenCalled();
});
