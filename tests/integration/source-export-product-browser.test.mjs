import {watchExportCopies,reviewExportPrivateAccess} from '../support/export-private-access.mjs';
// Actual Next page and production Node dispatch over TLS with real disposable
// Auth/SQL/SigV4/JWE. No traces, HAR, storageState or credential artifacts.
import assert from 'node:assert/strict';
import {captureExportCenter} from '../support/export-center-layout.mjs';
import {postedFinanceExportName} from '../../src/security/posted-finance-owner-export-contract.ts';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {currentOriginalProductFixture} from '../support/current-original-product-fixture.mjs';
import {unzipSync} from 'fflate';
const region=page=>page.getByRole('region',{name:'Download export files',exact:true}),sha=value=>createHash('sha256').update(value).digest('hex');
const gets=f=>f.storage.requests.filter(r=>r.method==='GET').length-f.setupGets;
async function load(page){await region(page).getByRole('button',{name:'Check sign-in and load file list',exact:true}).click();await expect(region(page).getByRole('status')).toContainText('The complete file list is checked.');}
async function prepare(page,part){
 const files=region(page);
 const choice=files.getByLabel('File to prepare',{exact:true});
 await choice.selectOption(part.partId);
 await expect(choice).toHaveAccessibleDescription(part.bytes.toLocaleString('en-US')+' bytes');
 await expect(files.locator('.export-picked-file strong')).toHaveText(part.fileName);
 await files.getByRole('button',{name:'Prepare selected file',exact:true}).click();
 await expect(files.getByRole('button',{name:'Request browser save',exact:true})).toBeEnabled();
}
for(const [name,engine,mobile]of [['chromium',chromium,false],['webkit',webkit,true]]){
 test('genuine Next export product route '+name,{timeout:240000},async t=>{
  let f,browser,context,page;const saved=[],downloads=[];
  try{
   f=await sourceExportBrowserFixture({product:true});assert.equal(f.product,true);assert.equal(f.plan.parts[0].bytes,20000);
   browser=await engine.launch();context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:mobile?{width:360,height:800}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile});page=await context.newPage();page.on('download',value=>downloads.push(value));
   await t.test('actual Next sign-in and workspace navigation open export controls without fetching private objects',async()=>{
    const document=await context.request.get(f.origin+'/export-files');assert.equal(document.status(),200);const headers=document.headers(),html=await document.text();assert(headers['cache-control']?.includes('private')&&headers['cache-control'].includes('no-store'));assert.equal(headers['cdn-cache-control'],'no-store');assert.equal(headers['surrogate-control'],'no-store');assert.match(headers['content-security-policy'],/script-src[^;]*'nonce-[^']+'/);assert(!headers['content-security-policy'].includes("'unsafe-inline'")&&!headers['content-security-policy'].includes("'unsafe-eval'"));assert(!html.includes(f.business)&&!html.includes(f.actor)&&!html.includes(f.jobId),'server page must not contain private fixture records');
    await page.goto(f.origin+'/sign-in');const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    const cookie=(await context.cookies()).find(value=>value.name==='__Host-crest_session');assert(cookie?.httpOnly&&cookie.secure);
    await page.getByRole('link',{name:'Customers',exact:true}).click();await expect(page).toHaveURL(f.origin+'/customers');await page.locator('.workspace-menu > summary').click();await page.getByRole('navigation',{name:'Workspace tools',exact:true}).getByRole('link',{name:'Data exports',exact:true}).click();await expect(page).toHaveURL(f.origin+'/export-files');await expect(page.getByRole('heading',{name:'Business data exports',exact:true})).toBeVisible();await expect(region(page)).toBeVisible();
    await expect(page.getByRole('region',{name:'Posted finance export',exact:true})).toHaveCount(0);
    assert.equal(gets(f),0);assert.equal(downloads.length,0);assert.equal(await page.evaluate(()=>typeof window.crestExportFixture),'undefined');assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   });
   await t.test('actual Next binary dispatch saves a file above the metadata cap and compares both real disk copies',async()=>{
    const priorityButton=region(page).getByRole('button',{name:'Check sign-in and load file list',exact:true});
    await priorityButton.evaluate(element=>{
     const observer=new MutationObserver(()=>{
      if(!element.classList.contains('secondary'))return;
      void getComputedStyle(element).backgroundColor;
      for(const animation of element.getAnimations()){
       if('transitionProperty'in animation&&animation.transitionProperty==='background-color'){
        const duration=Number(animation.effect?.getTiming().duration);
        if(Number.isFinite(duration)&&duration>0){animation.pause();animation.currentTime=0;}
       }
      }
      element.dataset.priorityTransition='observed';observer.disconnect();
     });
     observer.observe(element,{attributes:true,attributeFilter:['class']});
    });
    await load(page);
    await expect(region(page).locator('.export-package-meta time')).toHaveCount(2);await expect(region(page).locator('.export-assurance')).toContainText('Complete business portability and a recoverable backup still require the remaining source and original-file components.');await captureExportCenter(page,name,'ready');
    await expect(priorityButton).toHaveAttribute('data-priority-transition','observed');
    try{
     const contrast=await new AxeBuilder({page}).analyze();
     assert.deepEqual(contrast.violations.map(issue=>issue.id),[],JSON.stringify(contrast.violations.map(({id,nodes})=>({id,nodes:nodes.map(node=>({target:node.target,summary:node.failureSummary}))}))));
    }finally{await priorityButton.evaluate(element=>{for(const animation of element.getAnimations())if('transitionProperty'in animation&&animation.transitionProperty==='background-color')animation.play();});}
    const before=await f.facts();
    for(const [index,part]of f.plan.parts.entries()){
     if(index===0){
      await mkdir('.local/review',{recursive:true});
      for(const width of [320,390,768,1440]){
       await page.setViewportSize({width,height:900});
       await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
       assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
       assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
       await page.screenshot({path:'.local/review/export-files-'+name+'-'+width+'.png',fullPage:true});
      }
      await page.setViewportSize(mobile?{width:360,height:800}:{width:1280,height:900});
     }
     const privateResponse=page.waitForResponse(response=>response.url()===f.origin+'/api/business/exports/file'&&response.request().method()==='POST');await prepare(page,part);const readyRow=region(page).locator('.export-save-row[data-prepared="true"]');await expect(readyRow).toContainText(part.fileName);await expect(readyRow).toContainText('Ready for up to one minute');await expect(readyRow.getByRole('button',{name:'Request browser save',exact:true})).toBeInViewport();const response=await privateResponse;assert.equal(response.status(),200);const headers=response.headers();assert(headers['cache-control']?.includes('private')&&headers['cache-control'].includes('no-store')&&headers['cache-control'].includes('no-transform'));assert.equal(headers['cdn-cache-control'],'no-store');assert.equal(headers['content-length'],String(part.bytes));assert.equal(headers['x-crest-sha256'],part.sha256);assert.equal(headers['content-disposition'],'attachment; filename="'+part.fileName+'"');const pending=page.waitForEvent('download');await region(page).getByRole('button',{name:'Request browser save',exact:true}).click();const download=await pending;assert.equal(download.suggestedFilename(),part.fileName);assert.equal(await download.failure(),null);assert(download.url().startsWith('blob:'));const directory=join(f.workspace,'next-verified-'+index);await mkdir(directory,{mode:0o700});const path=join(directory,part.fileName);assert.equal(basename(path),part.fileName);await download.saveAs(path);assert.equal(sha(await readFile(path)),part.sha256);saved.push(path);
    }
    assert.equal(gets(f),2);assert.equal(downloads.length,2);const requests=f.requests.length,chooser=page.waitForEvent('filechooser');await region(page).getByLabel('Select local copies to compare',{exact:true}).click();await(await chooser).setFiles(saved);await expect(region(page).getByRole('status')).toContainText('All selected file bytes match this export.');assert.equal(f.requests.length,requests);
    const after=await f.facts();for(const kind of ['export_jobs','export_job_snapshots','export_part_intents','export_part_verifications','export_job_completions'])assert.deepEqual(after[kind],before[kind]);for(const kind of ['operations','audit_events'])assert.equal(after[kind].length,before[kind].length+2);const access=after.audit_events.filter(row=>row.value.entity_kind==='export_accesses');assert.equal(access.length,2);assert(access.every(row=>row.value.actor_id===f.actor&&row.value.action==='authorized_handoff'&&row.value.event_hash===sha(row.value.hash_input)));assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   });
   await t.test('actual Next client navigation and return discard the unsaved prepared copy and require a new file-list action',async()=>{
    await prepare(page,f.plan.parts[0]);const reads=gets(f);assert.equal(reads,3);await page.getByRole('navigation',{name:'Export navigation',exact:true}).getByRole('link',{name:'Customers',exact:true}).click();await expect(page).toHaveURL(f.origin+'/customers');await page.goBack();await expect(page).toHaveURL(f.origin+'/export-files');await expect(region(page)).toBeVisible();await expect(region(page).getByLabel('File to prepare',{exact:true})).toHaveCount(0);await expect(region(page).getByRole('button',{name:'Request browser save',exact:true})).toHaveCount(0);assert.equal(gets(f),reads);assert.equal(downloads.length,2);await load(page);
   });
   await t.test('actual Next export dispatch refuses fresh recovery pause before an object read or authorized handoff',async()=>{
    const before=await f.facts(),reads=gets(f);try{await f.client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[f.business]);await region(page).getByRole('button',{name:'Prepare selected file',exact:true}).click();await expect(region(page).getByRole('status')).toContainText('could not be verified');assert.equal(gets(f),reads);assert.equal(downloads.length,2);assert.deepEqual(await f.facts(),before);await expect(region(page).getByLabel('File to prepare',{exact:true})).toHaveCount(0);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}finally{await f.client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=true,version=version+1 WHERE business_id=$1',[f.business]);}
   });
   await t.test('recorded request selection is local and interrupted original requests remain distinct from files',async()=>{
    const source=page.getByRole('region',{name:'Business data exports',exact:true});const history=source.getByRole('table',{name:'Export history',exact:true});await expect(history).toBeVisible();const selection=source.getByRole('heading',{name:'Selected export',exact:true});
    let reads=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))reads++;};page.on('request',observe);try{await history.getByRole('button',{name:/Review export requested/}).first().click();await expect(selection).toBeFocused();assert.equal(reads,0,'selection never fetches or prepares files');}finally{page.off('request',observe);}
    const before=(await f.facts()).export_jobs.length;let original,requests=0;await page.route('**/api/business/exports/request',route=>{requests++;original=route.request().postDataJSON();return route.abort('failed');},{times:1});await source.getByRole('button',{name:'Request business export',exact:true}).click();await expect(source.getByRole('region',{name:'Interrupted export request',exact:true})).toBeVisible();await expect(source.locator('.export-status').first()).toContainText('The result could not be confirmed.');assert.equal(requests,1);assert.equal((await f.facts()).export_jobs.length,before);await expect(source.getByRole('heading',{name:'Selected export',exact:true})).toHaveCount(0);await expect(region(page)).toHaveCount(0);await captureExportCenter(page,name,'interrupted');
    await page.reload();await expect(source.getByRole('button',{name:'Check original request status',exact:true})).toBeVisible();await source.getByRole('button',{name:'Check original request status',exact:true}).click();await expect(source.locator('.export-status').first()).toContainText('does not prove that the request failed');await source.getByLabel('Reason for closing this interrupted request',{exact:true}).fill('Synthetic owner closes the unsent original after explicit status review.');await source.getByRole('button',{name:'Close this interrupted request',exact:true}).click();await expect(source.locator('.export-status').first()).toContainText('closed');
    const refused=await page.evaluate(async body=>{const session=await(await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();const response=await fetch('/api/business/exports/request',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':session.csrfToken},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};},original);assert.equal(refused.status,200);assert.deepEqual(refused.value,{state:'conflict',reason:'operation'});assert.equal((await f.facts()).export_jobs.length,before);
   });
   await t.test('lost confirmed request replies recover exactly once and show the recorded job status',async()=>{
    const source=page.getByRole('region',{name:'Business data exports',exact:true});await source.getByRole('button',{name:'Check sign-in and load exports',exact:true}).click();await expect(source.getByRole('button',{name:'Request business export',exact:true})).toBeEnabled();const before=(await f.facts()).export_jobs.length;let requests=0;await page.route('**/api/business/exports/request',async route=>{requests++;const response=await route.fetch({maxRetries:0});assert.equal(response.status(),200);await response.body();await route.abort('failed');},{times:1});await source.getByRole('button',{name:'Request business export',exact:true}).click();await expect(source.getByRole('region',{name:'Interrupted export request',exact:true})).toBeVisible();await expect(source.locator('.export-status').first()).toContainText('The result could not be confirmed.');assert.equal(requests,1);assert.equal((await f.facts()).export_jobs.length,before+1);await source.getByRole('button',{name:'Check original request status',exact:true}).click();await expect(source.getByRole('button',{name:'Check export status',exact:true})).toBeVisible();await expect(source.locator('.export-selection')).toContainText('Check its export status');await source.getByRole('button',{name:'Check export status',exact:true}).click();await expect(source.locator('.export-selection .export-state')).toHaveText('Queued');await expect(source.locator('.export-selection time')).toHaveCount(2);assert.equal(requests,1);await source.getByRole('button',{name:'Check sign-in and load exports',exact:true}).click();await expect(source.getByRole('table',{name:'Export history'}).getByRole('button',{name:/Review export requested/})).toHaveCount(2);await captureExportCenter(page,name,'queued');
   });
  }finally{try{await context?.close();}finally{try{await browser?.close();}finally{await f?.close();}}}
 });
}

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test('genuine equivalent export choices with posted finance available '+name,{timeout:180000},async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMoneyChannels:true,postedFinanceExport:true,statementStaging:true});let browser;
 try{browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}}),page=await context.newPage();await watchExportCopies(page);await page.goto(f.origin+'/sign-in');const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(f.credentials().code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await page.goto(f.origin+'/export-files');const financial=page.getByRole('region',{name:'Posted finance export',exact:true});await expect(financial).toBeVisible();await expect(page.getByRole('table',{name:'Export history',exact:true})).toBeVisible();await expect(financial).toContainText('no date filter');await captureExportCenter(page,name,'finance-available');
 const [verified]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/exports/posted-finance'&&r.request().method()==='POST').then(async r=>({status:r.status(),headers:r.headers(),bytes:await r.body()})),financial.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click()]);await expect(financial.getByRole('button',{name:'Save ZIP',exact:true})).toBeEnabled();assert.equal(verified.status,200);assert.equal(sha(verified.bytes),verified.headers['x-crest-sha256']);const saving=page.waitForEvent('download');await financial.getByRole('button',{name:'Save ZIP',exact:true}).click();const saved=await saving;assert.equal(saved.suggestedFilename(),postedFinanceExportName);assert.deepEqual(await readFile(await saved.path()),verified.bytes);
 await reviewExportPrivateAccess(page,f,name);
 }finally{await browser?.close();await f.close();}
});

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test('genuine current138 original ZIP product download '+name,{timeout:240000},async()=>{
 let f,browser,context;
 try{
  f=await currentOriginalProductFixture();browser=await engine.launch();context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844},isMobile:name==='webkit',hasTouch:name==='webkit'});const page=await context.newPage();
  await page.goto(f.origin+'/sign-in');const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const cookie=(await context.cookies()).find(value=>value.name==='__Host-crest_session');assert(cookie?.httpOnly&&cookie.secure);
  await page.goto(f.origin+'/export-files');const downloads=region(page);await downloads.getByRole('button',{name:'Check sign-in and load file list',exact:true}).click();await expect(downloads.getByRole('status')).not.toHaveText('Load the file list before downloading this export.');try{await expect(downloads).toHaveAttribute('aria-busy','false',{timeout:95000});}finally{console.log('CURRENT_ORIGINAL_CATALOGUE '+JSON.stringify(f.catalogueDiagnostics()));}await expect(downloads.getByRole('status')).toContainText('The complete file list is checked.');
  const originals=page.getByRole('region',{name:'Original receipts, documents and photos',exact:true});await originals.getByRole('button',{name:'Load original file list',exact:true}).click();await expect(originals).toContainText('3 available originals');assert.equal(f.originals.requests.filter(value=>value.method==='GET').length,0);
  await originals.getByRole('button',{name:'Prepare original-file ZIP',exact:true}).click();await expect(downloads.getByRole('button',{name:'Save file',exact:true})).toBeEnabled();const waiting=page.waitForEvent('download');await downloads.getByRole('button',{name:'Save file',exact:true}).click();const download=await waiting,saved=await readFile(await download.path()),entries=unzipSync(saved),manifest=JSON.parse(new TextDecoder().decode(entries['original_batch.json']));
  assert.equal(manifest.header.sourceSchemaVersion,138);assert.equal(manifest.header.exportJobId,f.jobId);assert.equal(manifest.originalCount,3);assert.equal(manifest.pendingCount,0);assert.equal(manifest.completeBackup,false);assert.deepEqual(new Set(manifest.files.map(file=>file.kind)),new Set(['expense_receipt','supplier_document','condition_photo']));
  for(const file of manifest.files){assert.deepEqual(Buffer.from(entries[file.path]),f.bytes);assert.equal(sha(entries[file.path]),file.sha256);}
  const audits=await f.accesses();assert.equal(audits.length,3);for(const file of manifest.files){const scope=audits.find(value=>value.file.attachmentId===file.attachmentId);assert(scope);assert.equal(scope.indexSha256,manifest.inventorySha256);assert.equal(scope.header.generationId,manifest.header.generationId);assert.deepEqual(scope.file,file);}
  assert.equal(f.originals.requests.filter(value=>value.method==='GET').length,3);await originals.getByLabel('Compare downloaded original-file ZIPs',{exact:true}).setInputFiles({name:download.suggestedFilename(),mimeType:'application/zip',buffer:saved});await expect(downloads.getByRole('status')).toContainText('Every available original in this export matches');await expect(originals).toContainText('1 verified locally');
  await mkdir('.local/review',{recursive:true});for(const width of[390,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);await originals.screenshot({path:'.local/review/current-original-zip-'+name+'-'+width+'.png'});}
  const csrf=await page.evaluate(async()=>{const response=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error('Session proof unavailable');return(await response.json()).csrfToken;});
  const post=async(body,proof=csrf)=>page.evaluate(async({body,proof})=>{const response=await fetch('/api/business/exports/original-file',{method:'POST',headers:{'content-type':'application/json',...proof?{'x-crest-csrf':proof}:{}},body:JSON.stringify(body)});return{status:response.status,type:response.headers.get('content-type'),attachment:response.headers.get('content-disposition')};},{body,proof});
  const countBefore=f.originals.requests.length;assert.equal((await post(f.references[0],'')).status,400);assert.equal((await post({...f.references[0],businessId:'00000000-0000-4000-8000-000000000001'})).status,400);assert.equal(f.originals.requests.length,countBefore);assert.equal((await f.accesses()).length,3);
  const key=f.source.reservation.originalKey,retained=f.originals.objects.get(key),damaged=Buffer.from(retained.bytes);damaged[0]^=1;f.originals.objects.set(key,{...retained,bytes:damaged});const corrupt=await post(f.references[0]);assert.equal(corrupt.status,503);assert.equal(corrupt.attachment,null);assert.equal((await f.accesses()).length,3);f.originals.objects.set(key,retained);
  const beforeRevocation=f.originals.requests.length;await f.revokeBrowserSession(cookie.value);const revoked=await post(f.references[1]);assert(revoked.status>=400);assert.equal(revoked.attachment,null);assert.equal(f.originals.requests.length,beforeRevocation);assert.equal((await f.accesses()).length,3);
 }finally{try{await context?.close();}finally{try{await browser?.close();}finally{await f?.close();}}}
});



