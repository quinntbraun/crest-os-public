import {randomBytes} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {BrowserHttpError,readBrowserCookies,createBrowserBodyReader,loginContextResponse,loginResponse,sessionResponse,logoutResponse,browserFailureResponse} from '../../src/security/browser-http.ts';

const origin='https://crest.example.com',now=Date.UTC(2026,9,21),opaque=randomBytes(32).toString('base64url'),proof=randomBytes(32).toString('base64url');
const valid={email:'synthetic@example.com',password:'synthetic: "quoted" \\ password',code:'123456',trusted:false};
const read=createBrowserBodyReader({origin,environment:'production'});
const request=(body:string|Uint8Array|ReadableStream<Uint8Array>,headers:Record<string,string>={},signal?:AbortSignal)=>new Request(origin+'/api/auth/login',{
  method:'POST',headers:{origin,'content-type':'application/json',...headers},body:body as BodyInit,...(signal?{signal}:{}),duplex:'half'
} as RequestInit);
const context=(expiresAt=now+600000)=>({expiresAt,cookieValueForResponse:()=>opaque,csrfTokenForResponse:()=>proof,toJSON:()=>{throw new Error('no serialization');}}) as Parameters<typeof loginContextResponse>[0];
const session=(expiresAt=now+43200000)=>({cookieValueForResponse:()=>opaque,csrfTokenForResponse:()=>proof,
  evidence:{expiresAt,actorId:'must-not-leak',provider:{accessToken:'must-not-leak'},tenantAndRequestVerificationRequired:true},toJSON:()=>{throw new Error('no serialization');}}) as unknown as Parameters<typeof loginResponse>[0];

describe('strict opaque browser cookie boundary',()=>{
  it('accepts both reserved cookies and ignores ordinary cookies without decoding',()=>{
    const result=readBrowserCookies(new Headers({cookie:`theme=dark; __Host-crest_session=${opaque}; __Host-crest_login=${proof}`}));
    expect(result).toEqual({session:opaque,login:proof});expect(Object.isFrozen(result)).toBe(true);
  });
  it('allows missing cookies for anonymous bootstrap',()=>expect(readBrowserCookies(new Headers())).toEqual({}));
  it.each([
    `__Host-crest_session=${opaque}; __Host-crest_session=${opaque}`,
    `__Host-crest_login=${proof}; __Host-crest_login=${opaque}`,
    `__Host-crest_session=%41${opaque.slice(1)}`,
    `__Host-crest_session="${opaque}"`,
    '__Host-crest_session=',
    `__Host-crest_session=${opaque}=`,
    `__Host-crest_session=${'A'.repeat(42)}B`,
    `__Host-crest_session=${opaque}, theme=dark`,
    'theme=hello world','theme=dark;','theme','theme=dark; bad name=foo',
    'theme='+'x'.repeat(8192),Array.from({length:129},()=> 'a=b').join('; ')
  ])('denies malformed, ambiguous or unbounded cookie header %#',raw=>{
    expect(()=>readBrowserCookies(new Headers({cookie:raw}))).toThrow(BrowserHttpError);
  });
  it('does not treat lookalike or lower-case names as an application credential',()=>{
    expect(readBrowserCookies(new Headers({cookie:`crest_session=${opaque}; __host-crest_session=${opaque}`}))).toEqual({});
  });
});

describe('bounded same-origin shallow JSON bodies',()=>{
  it('accepts exactly the login schema without normalizing the password',async()=>{
    const value=await read(request(JSON.stringify(valid)),'login');expect(value).toEqual(valid);expect(Object.isFrozen(value)).toBe(true);
  });
  it('accepts an empty JSON object for bootstrap/session/logout only',async()=>expect(await read(request(' {} '),'empty')).toEqual({}));
  it.each([
    {...valid,subject:'injected'},{...valid,factorId:'injected'},{...valid,__proto__:null,extra:true},
    {...valid,password:''},{...valid,password:'x'.repeat(1025)},{...valid,email:' '},{...valid,email:'a'.repeat(321)},
    {...valid,code:123456},{...valid,code:'12345a'},{...valid,trusted:'false'},
    {...valid,password:{nested:true}},{email:valid.email,password:valid.password,code:valid.code},
    [],null,true,'text'
  ])('denies unsupported fields, types and lengths %#',async value=>{
    await expect(read(request(JSON.stringify(value)),'login')).rejects.toThrow(BrowserHttpError);
  });
  it.each([
    '{"email":"x","password":"y","code":"123456","trusted":false,"trusted":true}',
    '{"email":"x","password":"y","code":"123456","trusted":false,"tr\\u0075sted":true}',
    '{"email":"x","password":"y","code":"123456","trusted":false,}',
    '{"__proto__":{},"email":"x","password":"y","code":"123456","trusted":false}',
    '\uFEFF'+JSON.stringify(valid),JSON.stringify(valid)+' {}',''
  ])('denies duplicate keys, invalid JSON, BOM and multiple values %#',async raw=>{
    await expect(read(request(raw),'login')).rejects.toThrow('BROWSER_HTTP_FAILED');
  });
  it('rejects fields on the empty-body schema',async()=>await expect(read(request('{"trusted":true}'),'empty')).rejects.toThrow(BrowserHttpError));
  it.each([
    {origin:'https://evil.example.com'}, {origin:'null'}, {'content-type':'text/plain'},
    {'sec-fetch-site':'cross-site'}, {'content-encoding':'gzip'}, {'content-encoding':'identity'},
    {'content-length':'8193'},{'content-length':'9999999999999999999999'}, {'content-length':'01'},
    {'content-length':'-1'}, {'content-length':'2, 2'}, {'content-length':'0'}
  ])('denies invalid Origin, metadata, encoding or declared length %#',async headers=>{
    await expect(read(request(JSON.stringify(valid),headers),'login')).rejects.toThrow(BrowserHttpError);
  });
  it('permits an exact byte length including multibyte JSON',async()=>{
    const body=JSON.stringify({...valid,password:'\u00e9\uD83D\uDE80'});
    expect(await read(request(body,{'content-length':String(Buffer.byteLength(body))}),'login')).toEqual({...valid,password:'\u00e9\uD83D\uDE80'});
  });
  it('denies absent Origin even when Host and forwarded headers look right',async()=>{
    const r=request('{}',{'host':'crest.example.com','x-forwarded-host':'crest.example.com','referer':origin});r.headers.delete('origin');
    await expect(read(r,'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('requires POST even though the general mutation guard also permits PATCH',async()=>{
    const r=new Request(origin,{method:'PATCH',headers:{origin,'content-type':'application/json'},body:'{}'});
    await expect(read(r,'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('rejects a reused request body and null stream',async()=>{
    const r=request('{}');await read(r,'empty');await expect(read(r,'empty')).rejects.toThrow(BrowserHttpError);
    await expect(read(new Request(origin,{method:'POST',headers:{origin,'content-type':'application/json'}}),'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('enforces actual bytes without Content-Length and cancels oversized streams',async()=>{
    const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(8193));},cancel});
    await expect(read(request(stream),'empty')).rejects.toThrow(BrowserHttpError);expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not trust a small Content-Length over actual streamed bytes',async()=>{
    await expect(read(request(' '.repeat(8193),{'content-length':'2'}),'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('rejects empty chunks instead of allowing an unbounded microtask read loop',async()=>{
    const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array());},cancel});
    await expect(read(request(stream),'empty')).rejects.toThrow(BrowserHttpError);expect(cancel).toHaveBeenCalledOnce();
  });
  it('accepts exactly 8192 bytes and rejects one additional byte',async()=>{
    expect(await read(request('{}'+' '.repeat(8190)),'empty')).toEqual({});
    await expect(read(request('{}'+' '.repeat(8191)),'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('decodes UTF-8 across byte boundaries and rejects invalid/truncated sequences',async()=>{
    const body=new TextEncoder().encode(JSON.stringify({...valid,password:'\u00e9\uD83D\uDE80'}));
    const stream=new ReadableStream<Uint8Array>({start(c){for(const byte of body)c.enqueue(new Uint8Array([byte]));c.close();}});
    expect(await read(request(stream),'login')).toEqual({...valid,password:'\u00e9\uD83D\uDE80'});
    for(const bytes of [new Uint8Array([0xff]),new Uint8Array([0xc3])])await expect(read(request(bytes),'empty')).rejects.toThrow(BrowserHttpError);
  });
  it('responds to cancellation without awaiting a hostile cancel promise',async()=>{
    const controller=new AbortController(),cancel=vi.fn(()=>new Promise<void>(()=>{}));
    const r=request(new ReadableStream<Uint8Array>({cancel}),{},controller.signal),pending=read(r,'empty');
    controller.abort();await expect(pending).rejects.toThrow(BrowserHttpError);expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects already-aborted requests and masks stream failures',async()=>{
    const controller=new AbortController();controller.abort('private-value');
    await expect(read(request('{}',{},controller.signal),'empty')).rejects.toThrow('BROWSER_HTTP_FAILED');
    await expect(read(request(new ReadableStream<Uint8Array>({start(c){c.error(new Error('private-value'));}})),'empty')).rejects.toThrow('BROWSER_HTTP_FAILED');
  });
  it('times out a stalled stream within the fixed five-second body budget',async()=>{
    const cancel=vi.fn();
    await expect(read(request(new ReadableStream<Uint8Array>({cancel})),'empty')).rejects.toThrow(BrowserHttpError);
    expect(cancel).toHaveBeenCalledOnce();
  },8000);
});

describe('explicit private HTTP responses',()=>{
  it('sets a bounded Secure HttpOnly host-only pending cookie and emits only CSRF/expiry',async()=>{
    const r=loginContextResponse(context(),now),cookies=r.headers.getSetCookie();
    expect(cookies).toEqual([`__Host-crest_login=${opaque}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600; Expires=${new Date(now+600000).toUTCString()}`]);
    expect(await r.json()).toEqual({csrfToken:proof,expiresAt:now+600000});
  });
  it('makes an untrusted login a browser-session cookie and clears the pending context',()=>{
    const cookies=loginResponse(session(),false,now).headers.getSetCookie();
    expect(cookies[0]).toBe(`__Host-crest_session=${opaque}; Path=/; Secure; HttpOnly; SameSite=Lax`);
    expect(cookies[1]).toContain('__Host-crest_login=;');expect(cookies[1]).toContain('Max-Age=0');
  });
  it('persists trusted sessions only until the original verified absolute deadline',async()=>{
    const end=now+30*86400000,r=loginResponse(session(end),true,now+1500);
    expect(r.headers.getSetCookie()[0]).toContain('Max-Age=2591998;');
    expect(r.headers.getSetCookie()[0]).toContain(`Expires=${new Date(end).toUTCString()}`);
    expect(await r.json()).toEqual({csrfToken:proof,expiresAt:end});
  });
  it('does not rewrite cookies or return internal evidence during proof reissue',async()=>{
    const r=sessionResponse(session(),now);expect(r.headers.getSetCookie()).toEqual([]);
    expect(await r.json()).toEqual({csrfToken:proof,expiresAt:now+43200000});
  });
  it.each([true,false])('clears both cookies after confirmed local logout with provider outcome %s',async providerSignedOut=>{
    const r=logoutResponse({localRevoked:true,providerSignedOut});
    expect(await r.json()).toEqual({localRevoked:true,providerSignedOut});
    expect(r.headers.getSetCookie()).toHaveLength(2);
    for(const c of r.headers.getSetCookie()){expect(c).toContain('Max-Age=0');expect(c).toContain('HttpOnly');expect(c).not.toContain(opaque);}
  });
  it('refuses to imply local logout succeeded after uncertain revocation',()=>{
    expect(()=>logoutResponse({localRevoked:false,providerSignedOut:false} as never)).toThrow(BrowserHttpError);
  });
  it.each([now,now+999,now+600001,NaN,Infinity])('rejects invalid or out-of-budget pending expiry %s',expiry=>{
    expect(()=>loginContextResponse(context(expiry),now)).toThrow(BrowserHttpError);
  });
  it('rejects deadline overrun, invalid trust and malformed response credentials/proof',()=>{
    expect(()=>loginResponse(session(now+43200001),false,now)).toThrow(BrowserHttpError);
    expect(()=>loginResponse(session(now+30*86400000+1),true,now)).toThrow(BrowserHttpError);
    expect(()=>loginResponse(session(),null as never,now)).toThrow(BrowserHttpError);
    expect(()=>loginContextResponse({...context(),cookieValueForResponse:()=>opaque+'\r\nDomain=evil.example'} as never,now)).toThrow(BrowserHttpError);
    expect(()=>sessionResponse({...session(),csrfTokenForResponse:()=>opaque+'='} as never,now)).toThrow(BrowserHttpError);
  });
  it('makes all success/failure responses uncacheable and denies CORS and framing',async()=>{
    for(const r of [loginContextResponse(context(),now),loginResponse(session(),false,now),sessionResponse(session(),now),logoutResponse({localRevoked:true,providerSignedOut:false}),browserFailureResponse()]){
      expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0');
      expect(r.headers.get('pragma')).toBe('no-cache');expect(r.headers.get('expires')).toBe('0');
      expect(r.headers.get('vary')).toBe('Cookie, Origin');expect(r.headers.get('access-control-allow-origin')).toBeNull();
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');expect(r.headers.get('referrer-policy')).toBe('no-referrer');
      expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      const body=await r.text();expect(body).not.toContain(opaque);expect(body).not.toContain('must-not-leak');
      expect(r.headers.getSetCookie().join(';')).not.toContain('Domain=');
    }
  });
  it('uses one generic error without clearing an existing cookie or reflecting an exception',async()=>{
    const r=browserFailureResponse();expect(r.status).toBe(400);expect(r.headers.getSetCookie()).toEqual([]);
    expect(await r.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
  });
});
