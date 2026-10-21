import {randomBytes,randomUUID} from 'node:crypto';
import {beforeAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createBrowserSessionFlow,BrowserSessionError} from '../../src/security/browser-session-flow.ts';
import {createProviderBoundary} from '../../src/security/provider-auth.ts';
import {createProviderTokenStore} from '../../src/security/provider-token-store.ts';
const origin='https://crest.example.com',owner={subject:randomUUID(),factorId:randomUUID()},loginKey=randomBytes(32);
const config={origin,owner,loginKey,connectionString:'postgresql://u:p@127.0.0.1/crest_migrate_0000000000000000',environment:'test' as const};
const provider=createProviderBoundary({issuer:'http://127.0.0.1:1/auth/v1',publicKey:'sb_publishable_synthetic_test_only',environment:'test'},async()=>{throw new Error('unexpected lookup');});
let store:Awaited<ReturnType<typeof createProviderTokenStore>>;
beforeAll(async()=>{store=await createProviderTokenStore('test',[{id:'test',key:randomBytes(32)}]);});
const request=(overrides:Record<string,string>={})=>({method:'POST',headers:new Headers({origin,'content-type':'application/json',...overrides})});
describe('browser session orchestration input boundary',()=>{
  it('rejects invalid trusted owner configuration',()=>{
    expect(()=>createBrowserSessionFlow({...config,owner:{...owner,subject:'bad'}},provider,store)).toThrow('BROWSER_OWNER_CONFIGURATION_REQUIRED');
  });
  it('requires the configured Origin on every browser bootstrap/mutation path before network access',async()=>{
    const flow=createBrowserSessionFlow(config,provider,store),signal=new AbortController().signal,r=request({origin:'https://evil.example.com'});
    for(const operation of [flow.beginLogin(r,'192.0.2.1',signal),flow.session(r,'invalid',signal),flow.logout(r,'invalid',signal),flow.login(r,'192.0.2.1','invalid',{email:'x@example.com',password:'synthetic',code:'123456',trusted:false},signal)])await expect(operation).rejects.toThrow(BrowserSessionError);
  });
  it.each([
    {email:'x@example.com',password:'synthetic',code:'123456',trusted:false,factorId:owner.factorId},
    {email:'x@example.com',password:'synthetic',code:'123456'},
    {email:'x@example.com',password:'x'.repeat(1025),code:'123456',trusted:false},
    {email:'x@example.com',password:'synthetic',code:'bad',trusted:false},
    {email:'x@example.com',password:'synthetic',code:'123456',trusted:'true'}
  ])('rejects unknown or malformed login fields without authentication IO',async value=>{
    await expect(createBrowserSessionFlow(config,provider,store).login(request(),'192.0.2.1','invalid',value as never,new AbortController().signal)).rejects.toThrow('BROWSER_SESSION_FAILED');
  });
  it('rejects cancelled context creation and invalid logout cookies with fixed errors',async()=>{
    const flow=createBrowserSessionFlow(config,provider,store),controller=new AbortController();controller.abort();
    await expect(flow.beginLogin(request(),'192.0.2.1',controller.signal)).rejects.toThrow(BrowserSessionError);
    await expect(flow.logout(request(),'invalid',new AbortController().signal)).rejects.toThrow(BrowserSessionError);
  });
});
