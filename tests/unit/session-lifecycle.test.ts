import {randomBytes} from 'node:crypto';
import {beforeAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createSessionLifecycle} from '../../src/security/session-lifecycle.ts';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
let store:Awaited<ReturnType<typeof createProviderTokenStore>>;
const provider=createProviderBoundary({issuer:'http://127.0.0.1:1/auth/v1',publicKey:'sb_publishable_synthetic_test_only',environment:'test'},async()=>{throw new Error('unexpected lookup');});
beforeAll(async()=>{store=await createProviderTokenStore('synthetic',[{id:'synthetic',key:randomBytes(32)}]);});
describe('session lifecycle boundary',()=>{
  it.each(['https://example.com/db','postgresql://127.0.0.1/crest_test','postgresql://u:p@localhost/crest_migrate_0000000000000000',
    'postgresql://u:p@127.0.0.1/crest_test','postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable'])('rejects unsafe database configuration %s',connectionString=>{
    expect(()=>createSessionLifecycle({connectionString,environment:'test'},provider,store)).toThrow('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  });
  it('rejects malformed/cancelled inputs with fixed errors before any network operation',async()=>{
    const lifecycle=createSessionLifecycle({connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test'},provider,store);
    const controller=new AbortController();controller.abort();
    for(const signal of [controller.signal,new AbortController().signal])await expect(lifecycle.verify('invalid',signal)).rejects.toThrow('SESSION_LIFECYCLE_FAILED');
    await expect(lifecycle.login({email:'synthetic@example.com',password:'synthetic-only',factorId:'invalid',code:'invalid'},{subject:'invalid'},false,controller.signal)).rejects.toThrow('SESSION_LIFECYCLE_FAILED');
  });
});
