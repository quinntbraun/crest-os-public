// Actual access screen and transports with explicit HTTP fixtures. No genuine
// authentication, persistence or owner-device claim comes from this suite.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {build} from 'rolldown';
import {chromium,webkit,expect} from '@playwright/test';
const root=fileURLToPath(new URL('../../',import.meta.url));
const proof=()=>({csrfToken:'A'.repeat(43),expiresAt:Date.now()+60000}),json=value=>({status:200,contentType:'application/json',headers:{'cache-control':'private, no-store'},body:JSON.stringify(value)});
test('expense access is explicit, clears private forms on hide and ignores a late proof',async()=>{
 const directory=await mkdtemp(join(root,'.local/expense-access-'));let server;
 try{
  const bundle=join(directory,'entry.js');await build({input:join(root,'tests/fixtures/owner-expenses-access.tsx'),platform:'browser',transform:{jsx:'react-jsx'},output:{file:bundle,format:'esm'}});const js=await readFile(bundle);server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/entry.js'?'text/javascript':'text/html');res.end(req.url==='/entry.js'?js:'<!doctype html><html lang="en"><head><title>Synthetic expense access</title></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
   for(const scenario of ['signed-out','unavailable','ready','late']){
    const context=await browser.newContext(),page=await context.newPage();let calls=0,complete;
    await page.route('**/api/auth/session',async route=>{calls++;if(scenario==='late'&&calls===1){complete=()=>route.fulfill(json(proof())).catch(()=>{});return;}if(calls===1&&['signed-out','unavailable'].includes(scenario)){await route.fulfill({status:scenario==='signed-out'?400:503,contentType:'application/json',body:'{}'});return;}await route.fulfill(json(proof()));});
    await page.route('**/api/business/expenses/context',route=>route.fulfill({...json({businessId:'11111111-1111-1111-1111-111111111111',recoveryEpoch:'22222222-2222-2222-2222-222222222222',writeState:'ready'}),headers:{'cache-control':'private, no-store','x-crest-edit-binding':'A'.repeat(43)}}));
    await page.route('**/api/business/expenses/history',route=>route.fulfill(json({rows:[]})));
    await page.goto('http://127.0.0.1:'+server.address().port);
    if(scenario==='signed-out'){await page.getByRole('link',{name:'Sign in to view expenses',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save expense',exact:true}).count(),0);await context.close();continue;}
    if(scenario==='unavailable'){await page.getByRole('button',{name:'Check expense access',exact:true}).click();await page.getByRole('button',{name:'Load saved expenses',exact:true}).waitFor();assert.equal(calls,2);await context.close();continue;}
    if(scenario==='ready'){await page.getByRole('button',{name:'Load saved expenses',exact:true}).click();await expect(page.getByRole('status')).toContainText('Expenses loaded');await page.getByLabel('Description',{exact:true}).fill('PRIVATE_SYNTHETIC_EXPENSE_DRAFT');}
    else{await page.getByRole('status').filter({hasText:'Checking expense access'}).waitFor();await expect.poll(()=>typeof complete).toBe('function');}
    const beforeHide=calls;
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});await page.getByRole('button',{name:'Check expense access',exact:true}).waitFor();if(complete)await complete();assert.equal(await page.getByLabel('Description',{exact:true}).count(),0);assert.equal(await page.getByText('PRIVATE_SYNTHETIC_EXPENSE_DRAFT',{exact:true}).count(),0);
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(calls,beforeHide);await page.getByRole('button',{name:'Check expense access',exact:true}).click();await page.getByRole('button',{name:'Load saved expenses',exact:true}).waitFor();assert.equal(await page.getByLabel('Description',{exact:true}).inputValue(),'');assert.equal(calls,beforeHide+1);assert.equal(await page.evaluate(()=>sessionStorage.length),0);await context.close();
   }
  }finally{await browser.close();}}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));assert(resolve(directory).startsWith(resolve(root,'.local')+sep));await rm(directory,{recursive:true,force:true});}
},{timeout:120000});
