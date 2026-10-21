import { describe,expect,it,vi } from "vitest";
vi.mock('server-only',()=>({}));
import { createLiveProviderSessionLookup } from '../../src/security/provider-session-db.ts';
describe('provider database configuration boundary',()=>{
  it.each(['https://example.com/db','postgresql://127.0.0.1/crest_test','postgresql://u:p@localhost/crest_migrate_0000000000000000',
    'postgresql://u:p@127.0.0.1/crest_test','postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000?sslmode=disable'])('rejects unsafe test target %s',connectionString=>{
    expect(()=>createLiveProviderSessionLookup({connectionString,environment:'test'})).toThrow('PROVIDER_DATABASE_CONFIGURATION_REQUIRED');
  });
  it('rejects invalid IDs and pre-cancelled work before any connection',async()=>{
    const lookup=createLiveProviderSessionLookup({connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test'});
    await expect(lookup('invalid','invalid',new AbortController().signal)).rejects.toThrow('PROVIDER_SESSION_LOOKUP_FAILED');
    const controller=new AbortController();controller.abort();
    await expect(lookup('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',controller.signal)).rejects.toThrow('PROVIDER_SESSION_LOOKUP_FAILED');
  });
});
