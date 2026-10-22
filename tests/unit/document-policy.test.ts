import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('server-only',()=>({}));
import {NextRequest} from 'next/server';
import {createDocumentPolicy,requireDocumentNonce} from '../../src/security/document-policy.ts';
import {proxy} from '../../src/proxy.ts';
afterEach(()=>vi.unstubAllEnvs());
describe('server-generated document policy',()=>{
  it('creates fresh canonical256-bit nonces bound to both script and style policies',()=>{
    const values=Array.from({length:100},()=>createDocumentPolicy('production'));
    expect(new Set(values.map(x=>x.nonce)).size).toBe(100);
    for(const item of values){
      expect(Buffer.from(item.nonce,'base64')).toHaveLength(32);expect(Buffer.from(item.nonce,'base64').toString('base64')).toBe(item.nonce);
      expect(item.policy).toContain(`script-src 'self' 'nonce-${item.nonce}'`);expect(item.policy).toContain(`style-src 'self' 'nonce-${item.nonce}'`);expect(Object.isFrozen(item)).toBe(true);
    }
  });
  it('has no production eval/inline wildcard, external service host or delegated script trust',()=>{
    const {policy}=createDocumentPolicy('production');
    for(const forbidden of ["'unsafe-inline'","'unsafe-eval'","'strict-dynamic'",'https:','http:','ws:','wss:','*','data:'])expect(policy).not.toContain(forbidden);
    for(const directive of ["script-src-attr 'none'","style-src-attr 'none'","frame-src 'none'","frame-ancestors 'none'","object-src 'none'","base-uri 'none'","form-action 'self'","worker-src 'none'"])expect(policy).toContain(directive);
  });
  it('confines development debugging allowances to the explicit development mode',()=>{
    const {policy}=createDocumentPolicy('development');expect(policy).toContain("'unsafe-eval'");expect(policy).toContain("connect-src 'self' ws: wss:");expect(policy).not.toContain("'unsafe-inline'");
  });
  it.each(['test','',null,undefined])('rejects an unknown policy mode %#',mode=>expect(()=>createDocumentPolicy(mode as never)).toThrow('DOCUMENT_POLICY_CONFIGURATION_REQUIRED'));
  it('accepts the matching internal nonce/script policy and denies missing or mismatched values',()=>{
    const a=createDocumentPolicy('production'),b=createDocumentPolicy('production');
    expect(requireDocumentNonce(new Headers({'x-crest-nonce':a.nonce,'content-security-policy':a.policy}))).toBe(a.nonce);
    for(const headers of [new Headers(),new Headers({'x-crest-nonce':a.nonce}),new Headers({'content-security-policy':a.policy}),new Headers({'x-crest-nonce':a.nonce,'content-security-policy':b.policy}),new Headers({'x-crest-nonce':a.nonce,'content-security-policy':`style-src 'nonce-${a.nonce}'`})])expect(()=>requireDocumentNonce(headers)).toThrow('DOCUMENT_POLICY_REQUIRED');
  });
  it.each(['A'.repeat(42)+'B=','A'.repeat(44),'bad',"abc'; script-src *",'A'.repeat(43)+'=='])('rejects malformed or noncanonical nonce %#',nonce=>{
    expect(()=>requireDocumentNonce(new Headers({'x-crest-nonce':nonce,'content-security-policy':`script-src 'nonce-${nonce}'`}))).toThrow('DOCUMENT_POLICY_REQUIRED');
  });
});
describe('Next request/response policy boundary',()=>{
  it('overwrites forged nonce/CSP and removes legacy or report-only request hints without reflecting credentials',()=>{
    vi.stubEnv('NODE_ENV','production');
    const original=new NextRequest('https://crest.example.com/',{headers:{'x-crest-nonce':'forged','x-nonce':'forged','content-security-policy':"script-src * 'unsafe-inline'",'content-security-policy-report-only':'forged',authorization:'Bearer synthetic-only',cookie:'theme=synthetic'}});
    const response=proxy(original),policy=response.headers.get('content-security-policy')!,nonce=/'nonce-([^']+)'/.exec(policy)![1]!;
    expect(nonce).not.toBe('forged');expect(response.headers.get('x-middleware-request-x-crest-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(response.headers.get('x-middleware-request-content-security-policy-report-only')).toBeNull();expect(response.headers.get('x-middleware-request-x-nonce')).toBeNull();
    expect(response.headers.get('authorization')).toBeNull();expect(response.headers.get('cookie')).toBeNull();expect(response.headers.get('x-crest-nonce')).toBeNull();
    expect(original.headers.get('x-crest-nonce')).toBe('forged');
  });
  it.each(['/','/missing.csv','/api/health','/api/missing','/apiary','/private/customer/photo.jpg','/_next/image','/favicon.ico'])('applies no-store to dynamic, API and error paths %s even with prefetch headers',path=>{
    const response=proxy(new NextRequest('https://crest.example.com'+path,{headers:{'next-router-prefetch':'1',purpose:'prefetch'}}));
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');expect(response.headers.get('surrogate-control')).toBe('no-store');expect(response.headers.get('pragma')).toBe('no-cache');expect(response.headers.get('expires')).toBe('0');
  });
  it('leaves framework static cache decisions to Next while still supplying a fresh rendering policy',()=>{
    const a=proxy(new NextRequest('https://crest.example.com/_next/static/chunks/page-a.js')),b=proxy(new NextRequest('https://crest.example.com/_next/static/chunks/page-a.js'));
    expect(a.headers.get('cache-control')).toBeNull();expect(a.headers.get('cdn-cache-control')).toBeNull();expect(a.headers.get('content-security-policy')).not.toBe(b.headers.get('content-security-policy'));
  });
  it('does not weaken a production build for test or caller environment headers',()=>{
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('CREST_ENV','test');
    const response=proxy(new NextRequest('https://crest.example.com/',{headers:{'x-crest-environment':'development'}}));expect(response.headers.get('content-security-policy')).not.toContain("'unsafe-eval'");
  });
});
