import {randomBytes,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createCsrfToken,createRequestProtection,RequestProtectionError} from '../../src/security/request-protection.ts';
const origin='https://crest.example.com',id=randomUUID();
const protect=createRequestProtection({origin,environment:'production'});
const request=(token:string,overrides:Record<string,string>={},method='POST')=>({method,headers:new Headers({origin,'content-type':'application/json','sec-fetch-site':'same-origin','x-crest-csrf':token,...overrides})});
describe('browser mutation prerequisites',()=>{
  it('accepts a matching random synchronizer token only for its bound session and approved origin',()=>{
    const token=createCsrfToken(id);expect(Buffer.from(token.tokenForResponse(),'base64url')).toHaveLength(32);
    for(const method of ['POST','PATCH'])expect(()=>protect(request(token.tokenForResponse(),{},method),id,token.hashForDatabase())).not.toThrow();
    const headers=request(token.tokenForResponse());headers.headers.delete('sec-fetch-site');expect(()=>protect(headers,id,token.hashForDatabase())).not.toThrow();
    expect(()=>protect(request(token.tokenForResponse()),randomUUID(),token.hashForDatabase())).toThrow(RequestProtectionError);
  });
  it('rejects missing, substituted, duplicate or noncanonical tokens without disclosing details',()=>{
    const token=createCsrfToken(id);
    for(const value of ['',createCsrfToken(id).tokenForResponse(),token.tokenForResponse()+'=',token.tokenForResponse()+','+token.tokenForResponse(),'A'.repeat(42)+'B']){
      expect(()=>protect(request(value),id,token.hashForDatabase())).toThrow('REQUEST_PROTECTION_FAILED');
    }
    for(const stored of [randomBytes(32),randomBytes(31)])expect(()=>protect(request(token.tokenForResponse()),id,stored)).toThrow(RequestProtectionError);
  });
  it.each(['GET','HEAD','OPTIONS','PUT','DELETE'])('does not permit %s to invoke this mutation guard',method=>{
    const token=createCsrfToken(id);expect(()=>protect(request(token.tokenForResponse(),{},method),id,token.hashForDatabase())).toThrow(RequestProtectionError);
  });
  it.each([
    {origin:'null'},{origin:''},{origin:'https://evil.example.com'},{origin:origin+'/'},{origin:origin+', https://evil.example.com'},
    {origin:'http://crest.example.com'},{origin:'https://crest.example.com:444'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},
    {'content-type':'text/plain'},{'content-type':'application/json; charset=utf-16'}
  ])('rejects unsafe browser headers %j',overrides=>{
    const token=createCsrfToken(id);expect(()=>protect(request(token.tokenForResponse(),overrides),id,token.hashForDatabase())).toThrow(RequestProtectionError);
  });
  it('does not trust forwarded hosts or referer in place of the exact Origin header',()=>{
    const token=createCsrfToken(id),r=request(token.tokenForResponse(),{'x-forwarded-host':'crest.example.com',referer:origin+'/'});r.headers.delete('origin');
    expect(()=>protect(r,id,token.hashForDatabase())).toThrow(RequestProtectionError);
    const hash=token.hashForDatabase();hash.fill(0);expect(()=>protect(request(token.tokenForResponse()),id,token.hashForDatabase())).not.toThrow();
    expect(()=>JSON.stringify(token)).toThrow(RequestProtectionError);
  });
  it.each(['http://crest.example.com','https://user:pass@crest.example.com','https://crest.example.com/','https://crest.example.com/path','https://crest.example.com?x=1','https://crest.example.com#x'])('rejects unsafe configured origin %s',origin=>{
    expect(()=>createRequestProtection({origin,environment:'production'})).toThrow('REQUEST_ORIGIN_CONFIGURATION_REQUIRED');
  });
  it('permits explicit loopback HTTP only in tests and snapshots trusted configuration',()=>{
    expect(()=>createRequestProtection({origin:'http://127.0.0.1:3000',environment:'test'})).not.toThrow();
    expect(()=>createRequestProtection({origin:'http://localhost:3000',environment:'test'})).toThrow();
    const config={origin,environment:'production' as const},guard=createRequestProtection(config),token=createCsrfToken(id);config.origin='https://evil.example.com';
    expect(()=>guard(request(token.tokenForResponse()),id,token.hashForDatabase())).not.toThrow();
  });
});
