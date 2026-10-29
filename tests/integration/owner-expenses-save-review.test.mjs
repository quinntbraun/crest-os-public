// Actual screen/controller/transports in Chromium/WebKit with explicit HTTP
// fixtures. Genuine MFA/SQL is covered separately; no deployed browser claim.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {build} from 'rolldown';
import {chromium,webkit} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
const root=fileURLToPath(new URL('../../',import.meta.url));
const kinds=['bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish'];
test('financial save review requires explicit confirmation and exact receipt reconciliation in both browsers',async()=>{
 const directory=await mkdtemp(join(root,'.local/expense-save-review-'));let server;
 try{
  const bundle=join(directory,'entry.js');await build({input:join(root,'tests/fixtures/owner-expenses-save-review.tsx'),platform:'browser',transform:{jsx:'react-jsx'},output:{file:bundle,format:'esm'}});
  const js=await readFile(bundle),css=await readFile(join(root,'src/app/globals.css'),'utf8'),fonts=new Map(await Promise.all(['IBMPlexSans-Regular.woff2','IBMPlexSans-SemiBold.woff2'].map(async name=>['/fonts/'+name,await readFile(join(root,'public/fonts',name))])));
  server=createServer((req,res)=>{const font=fonts.get(req.url);if(font){res.setHeader('content-type','font/woff2');res.end(font);return;}res.setHeader('content-type',req.url==='/entry.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/entry.js'?js:'<!doctype html><html lang="en"><head><title>Synthetic original save review</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await mkdir(join(root,'.local/review'),{recursive:true});
  for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
   for(const kind of kinds)for(const result of ['lost-retirement','recorded']){
    const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage(),businessId=randomUUID(),epoch=randomUUID(),binding=randomBytes(32).toString('base64url'),key=kind==='bookkeeping.expense.save'?'crest.expense.pending-reference.v1':'crest.receipt.pending-reference.v1';
    const reference={operationId:randomUUID(),recoveryEpoch:randomUUID(),expenseId:randomUUID(),expectedRevision:kind==='bookkeeping.receipt.publish'?'1':'0',...(kind==='bookkeeping.expense.save'?{}:{receiptId:randomUUID(),expenseRevision:'1'})},original={schemaVersion:1,businessId,commandType:kind,reference},raw=JSON.stringify({schemaVersion:1,businessId,binding:randomBytes(32).toString('base64url'),reference});
    await page.addInitScript(({key,raw})=>sessionStorage.setItem(key,raw),{key,raw});let retired=null,retireCalls=0,domainCalls=0;
    await page.route('**/api/**',async route=>{
     const request=route.request(),path=new URL(request.url()).pathname,body=request.postDataJSON(),headers={'content-type':'application/json','cache-control':'private, no-store','x-crest-edit-binding':binding};let value;
     if(path==='/api/auth/session')value={csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000};
     else if(path==='/api/business/settings')value={schemaVersion:1,businessId,legalName:'Synthetic Crest',businessVersion:'1',writeState:'ready',recoveryEpoch:epoch};
     else if(path==='/api/business/original-operations/retire'){
      retireCalls++;assert.deepEqual(JSON.parse(body.originalJson),original);assert.equal(body.recoveryEpoch,epoch);assert.equal(body.reason,'Synthetic lost form reviewed explicitly.');
      if(result==='recorded')value={schemaVersion:1,state:'original_recorded',original};else{retired={schemaVersion:1,state:'retired',original,retirement:{operationRowId:randomUUID(),auditEventId:randomUUID(),recoveryEpoch:epoch,reason:body.reason,recordedAt:'2026-10-29T08:00:00.123456Z'}};await route.abort('failed');return;}
     }else if(path==='/api/business/original-operations/resolution'){assert.deepEqual(JSON.parse(body.originalJson),original);value=retired??{state:'absent'};}
     else if(path==='/api/business/expenses/context')value={businessId,recoveryEpoch:null,writeState:'paused'};
     else if(path==='/api/business/expenses/operation'){
      domainCalls++;assert.deepEqual(body,reference);assert.equal(request.headers()['x-crest-edit-binding'],binding);value={state:'committed',expense:{businessId,expenseId:reference.expenseId,revision:'1',operationId:reference.operationId,actorId:randomUUID(),recordedAt:'2026-10-29T08:00:00.123456Z',payload:{paidOn:'2026-10-29',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic towels',vendor:null,paymentMethod:'cash',reference:null,notes:null,voided:false,changeReason:null}}};
     }else if(path==='/api/business/expense-receipts/operation'){
      domainCalls++;assert.deepEqual(body,reference);assert.equal(request.headers()['x-crest-edit-binding'],binding);const published=reference.expectedRevision==='1';value={state:'committed',original:reference,receipt:{receiptId:reference.receiptId,expenseId:reference.expenseId,expenseRevision:'1',receiptVersion:published?'2':'1',status:published?'available':'reserved',declaredType:'image/png',byteSize:100,sourceSha256:published?'a'.repeat(64):null}};
     }else throw Error('UNEXPECTED_UI_FIXTURE_ROUTE');
     await route.fulfill({status:200,headers,body:JSON.stringify(value)});
    });
    await page.goto('http://127.0.0.1:'+server.address().port+'/?kind='+kind);await page.getByLabel('Reason for retiring this original save',{exact:true}).waitFor();assert.equal(retireCalls,0);
    await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Synthetic lost form reviewed explicitly.');await page.getByRole('button',{name:'Review retirement',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Confirm retirement',exact:true}).waitFor();assert.equal(retireCalls,0);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);
    if(kind==='bookkeeping.expense.save'&&result==='lost-retirement')for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(axe.violations.map(v=>v.id),[]);await page.screenshot({path:join(root,'.local/review/expense-save-review-'+engine.name()+'-'+width+'.png'),fullPage:true});}
    await page.getByRole('button',{name:'Confirm retirement of this original save',exact:true}).click();
    if(result==='lost-retirement'){
     await page.getByRole('status').filter({hasText:'outcome could not be verified'}).waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);await page.getByRole('button',{name:'Check original resolution',exact:true}).click();await page.getByRole('button',{name:'Acknowledge retirement and release local reference',exact:true}).waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);await page.getByRole('button',{name:'Acknowledge retirement and release local reference',exact:true}).click();await page.getByRole('status').filter({hasText:'retired save reference is released'}).waitFor();assert.equal(domainCalls,0);
    }else{await page.getByRole('button',{name:'Verify original save receipt',exact:true}).waitFor();assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);await page.getByRole('button',{name:'Verify original save receipt',exact:true}).click();await page.getByRole('status').filter({hasText:'original save receipt is verified'}).waitFor();assert.equal(domainCalls,1);}
    assert.equal(retireCalls,1);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);await context.close();
   }
  }finally{await browser.close();}}
 }finally{if(server)await new Promise(resolve=>server.close(resolve));assert(resolve(directory).startsWith(resolve(root,'.local')+sep));await rm(directory,{recursive:true,force:true});}
},{timeout:120000});
