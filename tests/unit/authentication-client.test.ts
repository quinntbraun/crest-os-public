import {afterEach,describe,it,expect,vi} from 'vitest';
import {authentication,AuthenticationError} from '../../src/client/authentication';
const signal=()=>new AbortController().signal;
const proof=()=>({csrfToken:'A'.repeat(43),expiresAt:Date.now()+600000});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8'}});
afterEach(()=>vi.unstubAllGlobals());
describe('same-origin browser authentication transport',()=>{
  it('bootstraps once, submits exact login once and confirms accepted cookie with a separate session request',async()=>{
    const pending=proof(),session=proof(),input={email:'synthetic@example.com',password:' synthetic password ',code:'123456',trusted:false};
    const fetcher=vi.fn().mockResolvedValueOnce(json(pending)).mockResolvedValueOnce(json(session)).mockResolvedValueOnce(json(session));vi.stubGlobal('fetch',fetcher);
    expect(await authentication.login(input,signal())).toEqual(session);
    expect(fetcher.mock.calls.map(call=>call[0])).toEqual(['/api/auth/bootstrap','/api/auth/login','/api/auth/session']);
    for(const [,init] of fetcher.mock.calls){expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});expect(init.signal).toBeInstanceOf(AbortSignal);}
    expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify(input));expect(fetcher.mock.calls[1]![1].headers['x-crest-csrf']).toBe(pending.csrfToken);
    expect(fetcher.mock.calls[0]![1].body).toBe('{}');expect(fetcher.mock.calls[2]![1].body).toBe('{}');
  });
  it.each([400,503,500,302])('classifies %s safely and never retries',async status=>{
    const fetcher=vi.fn().mockResolvedValue(json({private:'must not escape'},status));vi.stubGlobal('fetch',fetcher);
    const error=await authentication.session(signal()).catch((error:unknown)=>error);
    expect(error).toMatchObject({message:'AUTHENTICATION_FAILED',kind:status===400?'denied':status===503?'unavailable':'uncertain'});expect(error).not.toHaveProperty('cause');expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not claim login before cookie verification or replay an uncertain exchange',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json(proof())).mockResolvedValueOnce(json(proof())).mockRejectedValueOnce(new Error('private response detail'));vi.stubGlobal('fetch',fetcher);
    await expect(authentication.login({email:'synthetic@example.com',password:'synthetic',code:'123456',trusted:true},signal())).rejects.toMatchObject({kind:'uncertain',message:'AUTHENTICATION_FAILED'});expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each([{},[],{...proof(),extra:'secret'},{...proof(),csrfToken:'Z'.repeat(43)},{...proof(),expiresAt:0},{...proof(),expiresAt:1.5}])('rejects malformed or expired proof',async value=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json(value)));await expect(authentication.session(signal())).rejects.toBeInstanceOf(AuthenticationError);
  });
  it('bounds actual streamed bytes and rejects invalid JSON/content type',async()=>{
    for(const response of [json({data:'x'.repeat(9000)}),new Response('{', {headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}})]){
      vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));await expect(authentication.session(signal())).rejects.toMatchObject({kind:'uncertain'});
    }
  });
  it('sends only current proof for logout and requires confirmed local revocation',async()=>{
    const current=proof(),fetcher=vi.fn().mockResolvedValueOnce(json({localRevoked:true,providerSignedOut:false})).mockResolvedValueOnce(json({localRevoked:false,providerSignedOut:true}));vi.stubGlobal('fetch',fetcher);
    expect(await authentication.logout(current,signal())).toEqual({localRevoked:true,providerSignedOut:false});
    expect(fetcher.mock.calls[0]![1]).toMatchObject({body:'{}',headers:{'x-crest-csrf':current.csrfToken}});
    await expect(authentication.logout(current,signal())).rejects.toMatchObject({kind:'uncertain'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('passes cancellation to fetch without retrying or exposing its cause',async()=>{
    const controller=new AbortController();controller.abort();
    const fetcher=vi.fn().mockImplementation((_path,init)=>{expect(init.signal.aborted).toBe(true);throw new Error('private');});vi.stubGlobal('fetch',fetcher);
    const error=await authentication.session(controller.signal).catch((error:unknown)=>error);expect(error).toMatchObject({kind:'uncertain'});expect(error).not.toHaveProperty('cause');expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
