// Actual Next page and production Node dispatch over TLS with real disposable
// Auth/SQL/SigV4/JWE. No traces, HAR, storageState or credential artifacts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
const region=page=>page.getByRole('region',{name:'Download export files',exact:true}),sha=value=>createHash('sha256').update(value).digest('hex');
const gets=f=>f.storage.requests.filter(r=>r.method==='GET').length-f.setupGets;
async function load(page){await region(page).getByRole('button',{name:'Check sign-in and load file list',exact:true}).click();await expect(region(page).getByRole('status')).toContainText('The complete file list is checked.');}
async function prepare(page,part){await region(page).getByLabel('File to prepare',{exact:true}).selectOption(part.partId);await region(page).getByRole('button',{name:'Prepare selected file',exact:true}).click();await expect(region(page).getByRole('button',{name:'Request browser save',exact:true})).toBeEnabled();}
for(const [name,engine,mobile]of [['chromium',chromium,false],['webkit',webkit,true]]){
 test('genuine Next export product route '+name,{timeout:240000},async t=>{
  let f,browser,context,page;const saved=[],downloads=[];
  try{
   f=await sourceExportBrowserFixture({product:true});assert.equal(f.product,true);assert.equal(f.plan.parts[0].bytes,20000);
   browser=await engine.launch();context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:mobile?{width:360,height:800}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});page=await context.newPage();page.on('download',value=>downloads.push(value));
   await t.test('actual Next sign-in and customer navigation open export controls without fetching private objects',async()=>{
    const document=await context.request.get(f.origin+'/export-files');assert.equal(document.status(),200);const headers=document.headers(),html=await document.text();assert(headers['cache-control']?.includes('private')&&headers['cache-control'].includes('no-store'));assert.equal(headers['cdn-cache-control'],'no-store');assert.equal(headers['surrogate-control'],'no-store');assert.match(headers['content-security-policy'],/script-src[^;]*'nonce-[^']+'/);assert(!headers['content-security-policy'].includes("'unsafe-inline'")&&!headers['content-security-policy'].includes("'unsafe-eval'"));assert(!html.includes(f.business)&&!html.includes(f.actor)&&!html.includes(f.jobId),'server page must not contain private fixture records');
    await page.goto(f.origin+'/sign-in');const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    const cookie=(await context.cookies()).find(value=>value.name==='__Host-crest_session');assert(cookie?.httpOnly&&cookie.secure);
    await page.getByRole('link',{name:'Customers',exact:true}).click();await expect(page).toHaveURL(f.origin+'/customers');await page.getByRole('link',{name:'Business data exports',exact:true}).click();await expect(page).toHaveURL(f.origin+'/export-files');await expect(page.getByRole('heading',{name:'Business data exports',exact:true})).toBeVisible();await expect(region(page)).toBeVisible();
    assert.equal(gets(f),0);assert.equal(downloads.length,0);assert.equal(await page.evaluate(()=>typeof window.crestExportFixture),'undefined');assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   });
   await t.test('actual Next binary dispatch saves a file above the metadata cap and compares both real disk copies',async()=>{
    await load(page);const before=await f.facts();
    for(const [index,part]of f.plan.parts.entries()){
     const privateResponse=page.waitForResponse(response=>response.url()===f.origin+'/api/business/exports/file'&&response.request().method()==='POST');await prepare(page,part);const response=await privateResponse;assert.equal(response.status(),200);const headers=response.headers();assert(headers['cache-control']?.includes('private')&&headers['cache-control'].includes('no-store')&&headers['cache-control'].includes('no-transform'));assert.equal(headers['cdn-cache-control'],'no-store');assert.equal(headers['content-length'],String(part.bytes));assert.equal(headers['x-crest-sha256'],part.sha256);assert.equal(headers['content-disposition'],'attachment; filename="'+part.fileName+'"');const pending=page.waitForEvent('download');await region(page).getByRole('button',{name:'Request browser save',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),part.fileName);assert.equal(await download.failure(),null);assert(download.url().startsWith('blob:'));const directory=join(f.workspace,'next-verified-'+index);await mkdir(directory,{mode:0o700});const path=join(directory,part.fileName);assert.equal(basename(path),part.fileName);await download.saveAs(path);assert.equal(sha(await readFile(path)),part.sha256);saved.push(path);
    }
    assert.equal(gets(f),2);assert.equal(downloads.length,2);const requests=f.requests.length,chooser=page.waitForEvent('filechooser');await region(page).getByLabel('Select local copies to compare',{exact:true}).click();await(await chooser).setFiles(saved);await expect(region(page).getByRole('status')).toContainText('All selected file bytes match this export.');assert.equal(f.requests.length,requests);
    const after=await f.facts();for(const kind of ['export_jobs','export_job_snapshots','export_part_intents','export_part_verifications','export_job_completions'])assert.deepEqual(after[kind],before[kind]);for(const kind of ['operations','audit_events'])assert.equal(after[kind].length,before[kind].length+2);const access=after.audit_events.filter(row=>row.value.entity_kind==='export_accesses');assert.equal(access.length,2);assert(access.every(row=>row.value.actor_id===f.actor&&row.value.action==='authorized_handoff'&&row.value.event_hash===sha(row.value.hash_input)));assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   });
   await t.test('actual Next client navigation and return discard the unsaved prepared copy and require a new file-list action',async()=>{
    await prepare(page,f.plan.parts[0]);const reads=gets(f);assert.equal(reads,3);await page.getByRole('navigation',{name:'Export navigation',exact:true}).getByRole('link',{name:'Customers',exact:true}).click();await expect(page).toHaveURL(f.origin+'/customers');await page.goBack();await expect(page).toHaveURL(f.origin+'/export-files');await expect(region(page)).toBeVisible();await expect(region(page).getByLabel('File to prepare',{exact:true})).toHaveCount(0);await expect(region(page).getByRole('button',{name:'Request browser save',exact:true})).toHaveCount(0);assert.equal(gets(f),reads);assert.equal(downloads.length,2);await load(page);
   });
   await t.test('actual Next export dispatch refuses fresh recovery pause before an object read or authorized handoff',async()=>{
    const before=await f.facts(),reads=gets(f);await f.client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await region(page).getByRole('button',{name:'Prepare selected file',exact:true}).click();await expect(region(page).getByRole('status')).toContainText('could not be verified');assert.equal(gets(f),reads);assert.equal(downloads.length,2);assert.deepEqual(await f.facts(),before);await expect(region(page).getByLabel('File to prepare',{exact:true})).toHaveCount(0);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   });
  }finally{try{await context?.close();}finally{try{await browser?.close();}finally{await f?.close();}}}
 });
}
