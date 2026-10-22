import {randomBytes,randomUUID} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Socket} from 'node:net';
import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const flow=vi.hoisted(()=>({beginLogin:vi.fn(),login:vi.fn(),session:vi.fn(),logout:vi.fn(),discardUnexposedLogin:vi.fn()}));
vi.mock('../../src/security/browser-session-flow.ts',()=>({createBrowserSessionFlow:()=>flow}));
import {createAuthenticationHttp,settleAuthenticationResponse} from '../../src/security/authentication-http.ts';
import {writeAuthenticationResponse} from '../../src/server/node-server.ts';
import {transportFixture} from '../support/transport.ts';

const origin='https://crest.example.com',opaque=randomBytes(32).toString('base64url'),proof=randomBytes(32).toString('base64url');
const config={origin,environment:'production' as const,ingress:{kind:'direct' as const},connectionString:'unused',loginKey:randomBytes(32),owner:{subject:randomUUID(),factorId:randomUUID()}};
const dispatch=createAuthenticationHttp(config,{} as never,{} as never);
const input={email:'synthetic@example.com',password:'synthetic',code:'123456',trusted:false};
const request=(path='bootstrap',body:unknown={},headers:Record<string,string>={},method='POST',signal?:AbortSignal)=>new Request(origin+'/api/auth/'+path,{
  method,headers:{origin,'content-type':'application/json',...headers},...(!['GET','HEAD'].includes(method)?{body:JSON.stringify(body)}:{}),...(signal?{signal}:{})
});
const cookie=`__Host-crest_session=${opaque}; __Host-crest_login=${opaque}`;
const issued=()=>({evidence:{expiresAt:Date.now()+3600000,actorId:'private-actor'},cookieValueForResponse:()=>opaque,csrfTokenForResponse:()=>proof,toJSON:()=>{throw new Error('private');}});
async function failure(response:Response,status=400){
  expect(response.status).toBe(status);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
  expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  expect(response.headers.has('set-cookie')).toBe(false);expect(response.headers.has('access-control-allow-origin')).toBe(false);
}
beforeEach(()=>{vi.resetAllMocks();flow.discardUnexposedLogin.mockResolvedValue(undefined);});

describe('authentication HTTP dispatcher',()=>{
  it('bootstraps only a bounded pending cookie and public proof',async()=>{
    flow.beginLogin.mockResolvedValue({...issued(),expiresAt:Date.now()+600000});
    const r=request(),response=await dispatch(r,transportFixture());expect(response.status).toBe(200);
    expect(Object.keys(await response.json())).toEqual(['csrfToken','expiresAt']);expect(response.headers.getSetCookie()[0]).toContain('__Host-crest_login=');
    expect(flow.beginLogin).toHaveBeenCalledWith(expect.any(Request),'192.0.2.1',expect.any(AbortSignal),undefined);
  });
  it('passes only parsed login input and cookies to the flow then emits cookie-only credentials',async()=>{
    const session=issued();flow.login.mockResolvedValue(session);
    const response=await dispatch(request('login',input,{cookie,'x-crest-csrf':proof,'x-forwarded-for':'198.51.100.99'}),transportFixture());
    expect(response.status).toBe(200);expect(await response.json()).toEqual({csrfToken:proof,expiresAt:session.evidence.expiresAt});
    expect(response.headers.getSetCookie()).toHaveLength(2);expect(response.headers.getSetCookie()[0]).not.toContain('Max-Age=');
    expect(flow.login).toHaveBeenCalledWith(expect.any(Request),'192.0.2.1',opaque,input,expect.any(AbortSignal),opaque);expect(flow.discardUnexposedLogin).not.toHaveBeenCalled();
  });
  it('proof reissue never rewrites the cookie and logout clears only confirmed local revocation',async()=>{
    flow.session.mockResolvedValue(issued());const response=await dispatch(request('session',{}, {cookie}),transportFixture());
    expect(response.status).toBe(200);expect(response.headers.has('set-cookie')).toBe(false);
    flow.logout.mockResolvedValue({localRevoked:true,providerSignedOut:false});const out=await dispatch(request('logout',{}, {cookie,'x-crest-csrf':proof}),transportFixture());
    expect(await out.json()).toEqual({localRevoked:true,providerSignedOut:false});expect(out.headers.getSetCookie().every(value=>value.includes('Max-Age=0'))).toBe(true);
  });
  it.each(['login','session','logout'])('requires the appropriate cookie before %s flow IO',async path=>{
    await failure(await dispatch(request(path,path==='login'?input:{}),transportFixture()));expect(flow[path as 'login'|'session'|'logout']).not.toHaveBeenCalled();
  });
  it.each(['missing','login/','%6cogin','login?token=secret'])('returns a private404 for noncanonical path %#',async path=>{
    await failure(await dispatch(request(path,input,{cookie}),transportFixture()),404);expect(flow.login).not.toHaveBeenCalled();
  });
  it.each(['GET','PATCH','OPTIONS'])('returns405 with POST only for %s',async method=>{
    const response=await dispatch(request('login',input,{cookie},method),transportFixture());expect(response.headers.get('allow')).toBe('POST');await failure(response,405);expect(flow.login).not.toHaveBeenCalled();
  });
  it.each([{origin:'https://evil.example.com'},{'sec-fetch-site':'cross-site'},{'content-type':'text/plain'},{cookie:'__Host-crest_session=bad'}])('rejects invalid Origin/body/cookies before flow IO %#',async headers=>{
    await failure(await dispatch(request('login',input,{cookie,...headers}),transportFixture()));expect(flow.login).not.toHaveBeenCalled();
  });
  it('rejects extra login fields, forged transport and already cancelled requests before IO',async()=>{
    await failure(await dispatch(request('login',{...input,subject:'forged'},{cookie}),transportFixture()));
    await failure(await dispatch(request(),{} as never));
    const controller=new AbortController();controller.abort();await failure(await dispatch(request('bootstrap',{}, {},'POST',controller.signal),transportFixture()));
    expect(flow.beginLogin).not.toHaveBeenCalled();expect(flow.login).not.toHaveBeenCalled();
  });
  it('revokes only the freshly issued login when response construction fails',async()=>{
    const session={...issued(),evidence:{expiresAt:0}};flow.login.mockResolvedValue(session);
    await failure(await dispatch(request('login',input,{cookie}),transportFixture()));expect(flow.discardUnexposedLogin).toHaveBeenCalledExactlyOnceWith(session);
  });
  it('uses independent cleanup after cancellation during issuance, even when cleanup fails',async()=>{
    const session=issued(),controller=new AbortController();flow.login.mockImplementation(async()=>{controller.abort();return session;});flow.discardUnexposedLogin.mockRejectedValue(new Error('private tokens'));
    await failure(await dispatch(request('login',input,{cookie},'POST',controller.signal),transportFixture()));expect(flow.discardUnexposedLogin).toHaveBeenCalledExactlyOnceWith(session);
  });
  it('checks cancellation after serialization and cleans the newly issued session',async()=>{
    const controller=new AbortController(),session={...issued(),csrfTokenForResponse:()=>{controller.abort();return proof;}};flow.login.mockResolvedValue(session);
    await failure(await dispatch(request('login',input,{cookie},'POST',controller.signal),transportFixture()));expect(flow.discardUnexposedLogin).toHaveBeenCalledExactlyOnceWith(session);
  });
  it('never revokes an existing session when proof response serialization fails',async()=>{
    flow.session.mockResolvedValue({...issued(),evidence:{expiresAt:0}});
    await failure(await dispatch(request('session',{}, {cookie}),transportFixture()));expect(flow.discardUnexposedLogin).not.toHaveBeenCalled();
  });
  it('never clears a cookie on unconfirmed logout or reflects thrown provider details',async()=>{
    flow.logout.mockResolvedValue({localRevoked:false,providerSignedOut:true});await failure(await dispatch(request('logout',{}, {cookie}),transportFixture()));
    flow.beginLogin.mockRejectedValue(new Error('password=private'));await failure(await dispatch(request(),transportFixture()));
  });
  it('settles a finished delivery once without revoking its login, even after a later close',async()=>{
    flow.login.mockResolvedValue(issued());const response=await dispatch(request('login',input,{cookie}),transportFixture());
    const out=new ServerResponse(new IncomingMessage(new Socket()));vi.spyOn(out,'end').mockImplementation(()=>{out.emit('finish');out.emit('close');return out;});
    await writeAuthenticationResponse(out,response,new AbortController().signal);await settleAuthenticationResponse(response,false);
    expect(flow.discardUnexposedLogin).not.toHaveBeenCalled();expect(out.getHeader('set-cookie')).toHaveLength(2);
  });
  it('cleans a new login exactly once if the response write throws',async()=>{
    const session=issued();flow.login.mockResolvedValue(session);const response=await dispatch(request('login',input,{cookie}),transportFixture());
    const out=new ServerResponse(new IncomingMessage(new Socket()));vi.spyOn(out,'end').mockImplementation(()=>{throw new Error('synthetic write failure');});
    await expect(writeAuthenticationResponse(out,response,new AbortController().signal)).rejects.toThrow('AUTHENTICATION_DELIVERY_FAILED');
    await settleAuthenticationResponse(response,false);expect(flow.discardUnexposedLogin).toHaveBeenCalledExactlyOnceWith(session);
  });
  it('cleans an issued response cancelled before writing and logs only a fixed cleanup failure',async()=>{
    const session=issued();flow.login.mockResolvedValue(session);flow.discardUnexposedLogin.mockRejectedValue(new Error('private provider material'));
    const response=await dispatch(request('login',input,{cookie}),transportFixture()),controller=new AbortController();controller.abort();
    const error=vi.spyOn(console,'error').mockImplementation(()=>{});
    try{await expect(writeAuthenticationResponse(new ServerResponse(new IncomingMessage(new Socket())),response,controller.signal)).rejects.toThrow();
      expect(flow.discardUnexposedLogin).toHaveBeenCalledExactlyOnceWith(session);expect(error).toHaveBeenCalledExactlyOnceWith('AUTHENTICATION_DELIVERY_CLEANUP_FAILED');
    }finally{error.mockRestore();}
  });
  it('does not revoke a pre-existing proof session on a failed write',async()=>{
    flow.session.mockResolvedValue(issued());const response=await dispatch(request('session',{}, {cookie}),transportFixture()),controller=new AbortController();controller.abort();
    await expect(writeAuthenticationResponse(new ServerResponse(new IncomingMessage(new Socket())),response,controller.signal)).rejects.toThrow();expect(flow.discardUnexposedLogin).not.toHaveBeenCalled();
  });
  it('bounds response bytes and cancels a stalled response body',async()=>{
    const out=()=>new ServerResponse(new IncomingMessage(new Socket()));
    await expect(writeAuthenticationResponse(out(),new Response('x'.repeat(8193)),new AbortController().signal)).rejects.toThrow();
    const controller=new AbortController();let cancelled=false;
    const response=new Response(new ReadableStream({cancel(){cancelled=true;}})),pending=writeAuthenticationResponse(out(),response,controller.signal);
    controller.abort();await expect(pending).rejects.toThrow();expect(cancelled).toBe(true);
  });
});
