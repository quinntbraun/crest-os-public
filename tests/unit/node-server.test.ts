import {request as httpRequest} from 'node:http';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const flow=vi.hoisted(()=>({beginLogin:vi.fn(),business:vi.fn()}));
vi.mock('../../src/security/browser-session-flow.ts',()=>({createBrowserSessionFlow:()=>flow}));
vi.mock('../../src/security/business-http.ts',async importOriginal=>({...await importOriginal<typeof import('../../src/security/business-http.ts')>(),createBusinessHttp:()=>flow.business}));
import {createBoundedNodeServer,bindApplicationHandler,requestTarget} from '../../src/server/node-server.ts';
import type {NodeConfiguration} from '../../src/server/node-server.ts';

const origin='https://crest.example.com';
describe('Node hosting boundary',()=>{
  it.each(['/api/business','/api/business/settings','/api/%62usiness/rename','/%61pi/business/operation','/api%2fbusiness/settings'])('reserves the business namespace including encoded aliases: %s',path=>expect(requestTarget(path,origin).business).toBe(true));
  it('requires explicit authentication composition before enabling a business target',()=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'test',business:{businessId:'untrusted'}},async()=>{})).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each(['/api/auth/login','/api/auth','/api/%61uth/login','/%61pi/auth/login','/api%2fauth/login'])('reserves the authentication namespace including encoded aliases: %s',path=>{
    expect(requestTarget(path,origin).authentication).toBe(true);
  });
  it.each(['/','/api/health','/api/author','/_next/static/app.js','/?_rsc=synthetic'])('retains canonical Next targets: %s',path=>expect(requestTarget(path,origin).authentication).toBe(false));
  it.each([undefined,'','http://evil.example.com/api/auth/login','//evil.example.com/api/auth/login','/api/../api/auth/login','/api/auth#secret','/api\\auth','/api/auth login','/api/%ZZ','/'+ 'x'.repeat(8192)])('denies ambiguous or unbounded raw targets %#',path=>{
    expect(()=>requestTarget(path,origin)).toThrow();
  });
  it('rejects a second request listener and production authentication without actual TLS',()=>{
    const server=createBoundedNodeServer(),pages=async()=>{};
    bindApplicationHandler(server,{origin,environment:'production'},pages);
    expect(()=>bindApplicationHandler(server,{origin,environment:'production'},pages)).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
    const another=createBoundedNodeServer();expect(()=>bindApplicationHandler(another,{origin,environment:'production',authentication:{} as never},pages)).toThrow('APPLICATION_SERVER_CONFIGURATION_REQUIRED');
  });
  it.each([{origin:origin+'/'},{origin:'https://user:secret@crest.example.com'},{origin:'file:///tmp'},{environment:'development'}])('rejects invalid server configuration %#',patch=>{
    expect(()=>bindApplicationHandler(createBoundedNodeServer(),{origin,environment:'production',...patch} as NodeConfiguration,async()=>{})).toThrow();
  });
  it('serves private closed-auth JSON before Next and preserves page ownership',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`,pages=vi.fn(async(_request,response)=>{response.end('synthetic page');});
    bindApplicationHandler(server,{origin:local,environment:'test'},pages);
    try{
      for(const path of ['bootstrap','login','session','logout']){
        const response=await fetch(`${local}/api/auth/${path}`,{method:'POST',body:'{}',headers:{'content-type':'application/json',origin:local}});
        expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'AUTHENTICATION_REQUEST_FAILED'});
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.has('set-cookie')).toBe(false);
      }
      for(const path of ['/api/business/settings','/api/business/rename','/api/%62usiness/operation']){
        const response=await fetch(local+path,{method:'POST',body:'{}'});expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'BUSINESS_REQUEST_FAILED'});expect(response.headers.get('cache-control')).toContain('no-store');
      }
      expect(pages).not.toHaveBeenCalled();expect(await(await fetch(local+'/')).text()).toBe('synthetic page');expect(pages).toHaveBeenCalledTimes(1);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('rejects excess headers instead of truncating a late security header',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`;
    bindApplicationHandler(server,{origin:local,environment:'test'},async()=>{throw new Error('must not reach Next');});
    try{
      const status=await new Promise<number|undefined>((resolve,reject)=>{const request=httpRequest(local+'/api/auth/bootstrap',{method:'POST',headers:Object.fromEntries(Array.from({length:129},(_,i)=>['x-synthetic-'+i,'value']))},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end('{}');});
      expect(status).toBe(400);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('bounds concurrent authentication work before flow IO and restores capacity after completion',async()=>{
    const server=createBoundedNodeServer();await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address();if(!address||typeof address==='string')throw new Error();const local=`http://127.0.0.1:${address.port}`;
    let release:()=>void=()=>{},entered:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});let count=0;
    flow.beginLogin.mockImplementation(async()=>{if(++count===32)entered();await gate;throw new Error('synthetic completion');});
    bindApplicationHandler(server,{origin:local,environment:'test',business:{businessId:'explicit-synthetic'},authentication:{configuration:{ingress:{kind:'direct'}} as never,provider:{} as never,tokens:{} as never}},async()=>{});
    const send=()=>fetch(local+'/api/auth/bootstrap',{method:'POST',body:'{}',headers:{origin:local,'content-type':'application/json'},signal:AbortSignal.timeout(10000)});
    const pending=Array.from({length:32},send);
    try{
      await ready;const excess=await send();expect(excess.status).toBe(503);await excess.text();expect(count).toBe(32);
      const business=await fetch(local+'/api/business/settings',{method:'POST',body:'{}'});expect(business.status).toBe(503);await business.text();expect(flow.business).not.toHaveBeenCalled();
      release();for(const response of await Promise.all(pending)){expect(response.status).toBe(400);await response.text();}
      const next=await send();expect(next.status).toBe(400);await next.text();expect(count).toBe(33);
    }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
