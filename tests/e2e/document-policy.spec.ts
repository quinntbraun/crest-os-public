import {test,expect} from '@playwright/test';

function nonce(policy:string|undefined){
  expect(policy).toBeDefined();const match=/'nonce-([A-Za-z0-9+/]{43}=)'/.exec(policy!);expect(match).not.toBeNull();return match![1]!;
}
test('rendered scripts use a fresh server nonce, ignore forged headers and retain static asset caching',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setExtraHTTPHeaders({'x-crest-nonce':'forged','x-nonce':'forged','content-security-policy':"script-src * 'unsafe-inline'",authorization:'Bearer synthetic-header-canary'});
  const first=(await page.goto('/'))!,headers=first.headers(),firstNonce=nonce(headers['content-security-policy']);
  expect(headers['cache-control']).toContain('private');expect(headers['cache-control']).toContain('no-store');expect(headers['cdn-cache-control']).toBe('no-store');
  expect(headers['surrogate-control']).toBe('no-store');expect(headers['pragma']).toBe('no-cache');expect(headers['expires']).toBe('0');
  expect(headers['content-security-policy']).not.toContain("'unsafe-eval'");expect(headers['content-security-policy']).not.toContain("'unsafe-inline'");
  expect(headers['x-crest-nonce']).toBeUndefined();expect(JSON.stringify(headers)).not.toContain('synthetic-header-canary');
  await page.waitForFunction(()=>Array.isArray((globalThis as unknown as {__next_f?:unknown}).__next_f));
  const scripts=await page.locator('script').evaluateAll(elements=>elements.map(element=>({nonce:(element as HTMLScriptElement).nonce,src:(element as HTMLScriptElement).src})));
  expect(scripts.length).toBeGreaterThan(0);expect(scripts.every(script=>script.nonce===firstNonce)).toBe(true);
  expect(scripts.filter(script=>script.src).every(script=>new URL(script.src).origin===new URL(page.url()).origin)).toBe(true);
  const asset=scripts.find(script=>script.src.includes('/_next/static/'))!;expect(asset).toBeDefined();
  const staticResponse=await request.get(asset.src);expect(staticResponse.status()).toBe(200);expect(staticResponse.headers()['cache-control']).toContain('immutable');
  expect(staticResponse.headers()['cache-control']).not.toContain('no-store');
  const second=(await page.reload())!;expect(nonce(second.headers()['content-security-policy'])).not.toBe(firstNonce);expect(errors).toEqual([]);
});

test('browser enforces nonce, inline-handler and foreign-script restrictions while allowing an explicit matching nonce',async({page})=>{
  const foreignRequests:string[]=[];await page.route('https://csp-probe.example.com/**',async route=>{foreignRequests.push(route.request().url());await route.fulfill({contentType:'application/javascript',body:'globalThis.__crestForeign=true'});});
  const response=(await page.goto('/'))!,value=nonce(response.headers()['content-security-policy']);
  await page.evaluate(nonce=>{
    const scope=globalThis as unknown as {__crestViolations:string[];__crestAllowed?:boolean;__crestBlocked?:boolean;__crestForeignFinished?:boolean};scope.__crestViolations=[];
    document.addEventListener('securitypolicyviolation',event=>scope.__crestViolations.push(event.effectiveDirective));
    const bad=document.createElement('script');bad.textContent='globalThis.__crestBlocked=true';document.body.append(bad);
    const old=document.createElement('script');old.nonce='forged';old.textContent='globalThis.__crestBlocked=true';document.body.append(old);
    const button=document.createElement('button');button.setAttribute('onclick','globalThis.__crestBlocked=true');document.body.append(button);button.click();
    const foreign=document.createElement('script');foreign.src='https://csp-probe.example.com/blocked.js';foreign.onload=foreign.onerror=()=>{scope.__crestForeignFinished=true;};document.body.append(foreign);
    const good=document.createElement('script');good.nonce=nonce;good.textContent='globalThis.__crestAllowed=true';document.body.append(good);
  },value);
  await page.waitForFunction(()=>{
    const scope=globalThis as unknown as {__crestViolations:string[];__crestForeignFinished?:boolean};return scope.__crestForeignFinished&&scope.__crestViolations.some(x=>x.startsWith('script-src'));
  });
  expect(await page.evaluate(()=>{
    const scope=globalThis as unknown as {__crestAllowed?:boolean;__crestBlocked?:boolean;__crestForeign?:boolean};return {allowed:scope.__crestAllowed,blocked:scope.__crestBlocked===true,foreign:scope.__crestForeign===true};
  })).toEqual({allowed:true,blocked:false,foreign:false});expect(foreignRequests).toEqual([]);
});

test('error documents and caller prefetch hints cannot bypass policy or no-store',async({request,page})=>{
  for(const path of ['/missing.csv','/api/missing','/apiary','/_next/static/missing.js','/favicon.ico']){
    const response=await request.get(path,{headers:{'next-router-prefetch':'1',purpose:'prefetch','x-crest-nonce':'forged'}});
    expect(response.status()).toBe(404);nonce(response.headers()['content-security-policy']);
    expect(response.headers()['cache-control']).toContain('no-store');expect(await response.text()).not.toContain('DOCUMENT_POLICY_REQUIRED');
  }
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  expect((await page.goto('/missing.csv'))!.status()).toBe(404);
  await expect(page.getByRole('heading',{name:'Page not found',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Return to Crest OS',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Crest OS',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
