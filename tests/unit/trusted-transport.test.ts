import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createTrustedTransport,transportFromIncomingMessage,TransportError} from '../../src/security/trusted-transport.ts';
import type {IngressConfiguration} from '../../src/security/trusted-transport.ts';
import {transportFixture} from '../support/transport.ts';

const origin='https://crest.example.com',request=()=>new Request(origin+'/api/auth/bootstrap');
const config={origin,environment:'production' as const,ingress:{kind:'direct' as const}};
const direct=createTrustedTransport(config);
const proxy=createTrustedTransport({...config,ingress:{kind:'proxy',peers:['192.0.2.10','2001:db8::10']}});
const headers=(xff:string,protocol='https')=>['Host','crest.example.com','X-Forwarded-For',xff,'X-Forwarded-Proto',protocol];

describe('socket-derived ingress evidence',()=>{
  it('direct ingress ignores every forwarding claim and normalizes mapped IPv6',()=>{
    expect(direct(request(),transportFixture({address:'::ffff:192.0.2.1',headers:headers('198.51.100.1')}))).toBe('192.0.2.1');
    expect(direct(request(),transportFixture({headers:['Host','crest.example.com','Forwarded','for=evil','X-Real-IP','198.51.100.1']}))).toBe('192.0.2.1');
  });
  it('requires actual encrypted transport in production regardless of claimed protocol',()=>{
    expect(()=>direct(request(),transportFixture({encrypted:false,headers:headers('198.51.100.1')}))).toThrow(TransportError);
  });
  it('allows explicit loopback HTTP only in test configuration',()=>{
    const local=createTrustedTransport({...config,origin:'http://127.0.0.1:43210',environment:'test'});
    expect(local(new Request('http://127.0.0.1:43210/api/auth/login'),transportFixture({address:'127.0.0.1',encrypted:false,headers:['Host','127.0.0.1:43210']}))).toBe('127.0.0.1');
    expect(()=>createTrustedTransport({...config,origin:'http://127.0.0.1:43210'})).toThrow('REQUEST_ORIGIN_CONFIGURATION_REQUIRED');
  });
  it.each([[],['Host','evil.example.com'],['Host','crest.example.com','host','crest.example.com'],['Host','crest.example.com:443'],['Host','crest.example.com ']].map(raw=>({raw})))('denies absent, ambiguous or mismatched transport Host %#',({raw})=>{
    expect(()=>direct(request(),transportFixture({headers:raw}))).toThrow('TRUSTED_TRANSPORT_FAILED');
  });
  it('rejects another URL origin, credentials and JSON-shaped peer evidence',()=>{
    for(const url of ['https://evil.example.com/api/auth/login','https://user:secret@crest.example.com/api/auth/login'])expect(()=>direct(new Request(url),transportFixture())).toThrow();
    expect(()=>direct(request(),{} as never)).toThrow(TransportError);
    expect(()=>transportFromIncomingMessage({socket:{remoteAddress:'192.0.2.1'},rawHeaders:['Host','crest.example.com']} as never)).toThrow(TransportError);
  });
  it('keeps socket addresses private and snapshots caller-owned metadata',()=>{
    const raw=['Host','CREST.EXAMPLE.COM'],peer=transportFixture({headers:raw});raw[1]='evil.example.com';
    expect(direct(request(),peer)).toBe('192.0.2.1');expect(Object.isFrozen(peer)).toBe(true);expect(Object.keys(peer)).toEqual([]);expect(()=>JSON.stringify(peer)).toThrow(TransportError);
  });
  it('walks only the trusted right-hand suffix and ignores a forged left prefix',()=>{
    expect(proxy(request(),transportFixture({address:'192.0.2.10',headers:headers('203.0.113.9, 198.51.100.2, 2001:0DB8::10')}))).toBe('198.51.100.2');
  });
  it.each([
    {address:'192.0.2.11',headers:headers('198.51.100.2')},
    {address:'192.0.2.10',headers:['Host','crest.example.com']},
    {address:'192.0.2.10',headers:headers('192.0.2.10,2001:db8::10')},
    {address:'192.0.2.10',headers:headers('198.51.100.2','http')},
    {address:'192.0.2.10',headers:headers('198.51.100.2','https, https')},
    {address:'192.0.2.10',headers:[...headers('198.51.100.2'),'X-Forwarded-For','203.0.113.1']},
    {address:'192.0.2.10',headers:[...headers('198.51.100.2'),'X-Forwarded-Proto','https']}
  ])('denies unknown peers, missing/ambiguous claims and all-trusted chains %#',fixture=>expect(()=>proxy(request(),transportFixture(fixture))).toThrow(TransportError));
  it.each(['unknown','198.51.100.2:443','[2001:db8::1]','fe80::1%eth0','198.51.100.2,','evil,198.51.100.2',Array(9).fill('198.51.100.2').join(','),' '.repeat(1025)+'198.51.100.2'])('bounds and validates the entire chain %#',xff=>{
    expect(()=>proxy(request(),transportFixture({address:'192.0.2.10',headers:headers(xff)}))).toThrow(TransportError);
  });
  it.each([{kind:'automatic'},{kind:'proxy',peers:[]},{kind:'proxy',peers:['proxy.example.com']},{kind:'proxy',peers:['192.0.2.1','::ffff:192.0.2.1']},{kind:'proxy',peers:Array(17).fill('192.0.2.1')}])('denies unbounded or implicit trust configuration %#',ingress=>{
    expect(()=>createTrustedTransport({...config,ingress:ingress as IngressConfiguration})).toThrow('INGRESS_CONFIGURATION_REQUIRED');
  });
  it('snapshots the proxy allowlist',()=>{
    const peers=['192.0.2.10'],resolve=createTrustedTransport({...config,ingress:{kind:'proxy',peers}});peers[0]='192.0.2.11';
    expect(resolve(request(),transportFixture({address:'192.0.2.10',headers:headers('198.51.100.2')}))).toBe('198.51.100.2');
  });
});
