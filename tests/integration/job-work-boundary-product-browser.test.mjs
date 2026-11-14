import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const correctionRoute='**/api/business/scheduling/work-boundary-save';
const storeKey='crest.work-boundary.pending-reference.v1';
const reason='Synthetic timer observation corrected';
const zone='America/Indiana/Indianapolis';
function localTime(milliseconds){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(milliseconds);
 const at=Object.fromEntries(parts.map(({type,value})=>[type,value]));
 // datetime-local normalizes zero seconds away even when step is one second.
 return at.year+'-'+at.month+'-'+at.day+'T'+at.hour+':'+at.minute+(at.second==='00'?'':':'+at.second);
}

async function signInAndBook(page,fixture){
 await page.goto(fixture.origin+'/sign-in');
 const credentials=fixture.credentials();
 await page.getByLabel('Email',{exact:true}).fill(credentials.email);
 await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
 assert.equal(await page.evaluate(async input=>{
  const init={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
  const {csrfToken}=await (await fetch('/api/auth/session',init)).json();
  const body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId'));
  return (await fetch('/api/business/scheduling/book',{...init,headers:{...init.headers,'x-crest-csrf':csrfToken},body:JSON.stringify(body)})).status;
 },fixture.bookingRequest),200);
}

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' corrects a pause and recovers the committed original after a lost response',{timeout:300000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,workTime:true,workBoundary:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const job=fixture.bookingRequest.jobId,work=fixture.origin+'/schedule/work?job='+job,time=fixture.origin+'/schedule/work/time?job='+job;
  await signInAndBook(page,fixture);
  await page.goto(work);
  await page.getByLabel('What is happening?').selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.goto(time);
  const view=page.getByRole('region',{name:'Saved work time',exact:true}),status=view.getByRole('status');
  await expect(view.getByText('Work is in progress.',{exact:true})).toBeVisible();
  await view.getByText('Saved intervals (1)',{exact:true}).click();
  const start=await view.locator('ol time').first().getAttribute('datetime');
  await expect.poll(()=>Date.now()-Date.parse(start)).toBeGreaterThan(3000);
  await page.goto(work);
  await page.getByLabel('Reason for pause').fill('Synthetic equipment check');
  await page.getByRole('button',{name:'Pause work',exact:true}).click();
  await expect(page.getByText('Confirmed saved version 3.',{exact:true})).toBeVisible();
  await page.goto(time);
  await expect(view.getByText('Work is paused.',{exact:true})).toBeVisible();
  const download=async()=>{
   const response=page.waitForEvent('download');
   await view.getByRole('button',{name:'Download JSON',exact:true}).click();
   return JSON.parse(await readFile(await (await response).path(),'utf8'));
  };
  const before=await download(),boundary=before.intervals[0].endedAt;
  const corrected=Math.floor((Date.parse(boundary)-1000)/1000)*1000;
  assert(corrected>Date.parse(start));
  await view.getByText('Correct a pause or resume time',{exact:true}).click();
  await view.getByLabel('Recorded transition').selectOption({index:1});
  await view.getByLabel('Corrected local time').fill(localTime(corrected));
  await view.getByLabel('Correction reason').fill(reason);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.locator('.skip-link').evaluate(link=>link.getBoundingClientRect().bottom<=0));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/field-work-boundary-'+name+'-'+width+'.png',fullPage:true});
  }
  let committedStatus,requests=0;
  await page.route(correctionRoute,async route=>{
   requests++;
   committedStatus=(await route.fetch()).status();
   await route.abort();
  });
  await view.getByRole('button',{name:'Save work-time correction'}).press('Enter');
  await expect(status).toContainText('The correction could not be confirmed.');
  assert.equal(committedStatus,200);
  const pending=await page.evaluate(key=>sessionStorage.getItem(key),storeKey);
  assert(pending&&!pending.includes(reason)&&!pending.includes('correctedAt'));
  await page.reload();
  await expect(status).toHaveText('Work-time correction saved.');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storeKey),null);
  assert.equal(requests,1);
  const after=await download();
  assert.equal(after.jobVersion,before.jobVersion);
  assert.equal(after.jobState,'paused');
  assert.equal(Date.parse(after.intervals[0].endedAt),corrected);
  assert.equal(after.intervals[0].endedAt,after.intervals[1].startedAt);
  assert.equal(after.intervals[1].recordReason,reason);
  assert.equal(after.intervalVersions.length,before.intervalVersions.length+2);
  for(const original of before.intervalVersions)
   assert.deepEqual(after.intervalVersions.find(version=>version.versionId===original.versionId),original);
 }finally{await browser?.close();await fixture.close();}
});

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' first work start form persists and recovers the exact lost acknowledgment',{timeout:300000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,workTime:true,workBoundary:true,workStart:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const job=fixture.bookingRequest.jobId,work=fixture.origin+'/schedule/work?job='+job,time=fixture.origin+'/schedule/work/time?job='+job;
  await signInAndBook(page,fixture);
  await page.goto(time);
  const view=page.getByRole('region',{name:'Saved work time',exact:true}),status=view.getByRole('status');
  await expect(view.getByText('No work intervals have been recorded for this job.',{exact:true})).toBeVisible();
  await expect(view.getByText('Correct the first work start',{exact:true})).toHaveCount(0);
  await page.goto(work);
  await page.getByLabel('What is happening?').selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.goto(time);
  await expect(status).toHaveText('Saved work time loaded.');
  await view.getByText('Correct the first work start',{exact:true}).click();
  const form=view.locator('form').filter({has:page.getByRole('button',{name:'Save first-start correction',exact:true})});
  const original=await form.locator('time').first().getAttribute('datetime');
  const corrected=Math.floor((Date.parse(original)-1000)/1000)*1000;
  await form.getByLabel('Corrected first start').fill(localTime(corrected));
  await form.getByLabel('First-start correction reason').fill(reason);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/field-work-start-'+name+'-'+width+'.png',fullPage:true});
  }
  const route='**/api/business/scheduling/work-start-save',key='crest.work-start.pending-reference.v1';
  let committedStatus,requests=0;
  await page.route(route,async intercepted=>{
   requests++;
   committedStatus=(await intercepted.fetch()).status();
   await intercepted.abort();
  });
  await form.getByRole('button',{name:'Save first-start correction',exact:true}).press('Enter');
  await expect(status).toContainText('The correction could not be confirmed.');
  assert.equal(committedStatus,200);
  const pending=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);
  assert(pending&&!pending.includes(reason)&&!pending.includes('correctedAt'));
  await page.reload();
  await expect(status).toHaveText('Work-time correction saved.');
  assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),null);
  assert.equal(requests,1);
  await view.getByText('Correct the first work start',{exact:true}).click();
  assert.equal(Date.parse(await form.locator('time').first().getAttribute('datetime')),corrected);
  assert.equal(await form.locator('time').nth(1).getAttribute('datetime'),original);
  const response=page.waitForEvent('download');
  await view.getByRole('button',{name:'Download JSON',exact:true}).click();
  const downloaded=JSON.parse(await readFile(await (await response).path(),'utf8'));
  assert.equal(downloaded.jobVersion,'3');
  assert.equal(downloaded.jobState,'in_progress');
  assert.equal(Date.parse(downloaded.intervals[0].startedAt),corrected);
  assert.equal(downloaded.intervalVersions.length,2);
  assert.equal(downloaded.intervalVersions[0].startedAt,original);
 }finally{await browser?.close();await fixture.close();}
});

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' corrects completed work, verifies history and recovers the original save',{timeout:300000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,
  workTime:true,workBoundary:true,workStart:true,workEnd:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const job=fixture.bookingRequest.jobId,time=fixture.origin+'/schedule/work/time?job='+job;
  const completion=fixture.origin+'/schedule/work/complete?job='+job;
  await signInAndBook(page,fixture);
  await page.goto(fixture.origin+'/schedule/work?job='+job);
  await page.getByLabel('What is happening?').selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.goto(time);
  const view=page.getByRole('region',{name:'Saved work time',exact:true}),status=view.getByRole('status');
  const editor=view.getByText('Correct the completion time',{exact:true});
  await expect(status).toHaveText('Saved work time loaded.');
  await expect(editor).toHaveCount(0);
  await view.getByText('Saved intervals (1)',{exact:true}).click();
  const start=await view.locator('ol time').first().getAttribute('datetime');
  const corrected=Math.ceil(Date.parse(start)/1000)*1000;
  await expect.poll(()=>Date.now()-corrected).toBeGreaterThan(1500);
  await page.goto(completion);
  await page.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
  await page.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
  await page.getByRole('button',{name:'End job',exact:true}).click();
  await expect(page.getByText('Job completion saved.',{exact:true})).toBeVisible();
  await page.goto(time);
  await expect(status).toHaveText('Saved work time loaded.');
  await editor.click();
  const form=view.locator('form').filter({has:page.getByRole('button',{name:'Save completion correction',exact:true})});
  const original=await form.locator('time').first().getAttribute('datetime');
  assert(Date.parse(original)>corrected);
  await form.getByLabel('Corrected completion time').fill(localTime(corrected));
  await form.getByLabel('Completion correction reason').fill(reason);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/field-work-end-'+name+'-'+width+'.png',fullPage:true});
  }
  const key='crest.work-end.pending-reference.v1';
  let savedStatus,submissions=0;
  await page.route('**/api/business/scheduling/work-end-save',async request=>{
   submissions++;
   savedStatus=(await request.fetch()).status();
   await request.abort();
  });
  await form.getByRole('button',{name:'Save completion correction',exact:true}).press('Enter');
  await expect(status).toContainText('The correction could not be confirmed.');
  assert.equal(savedStatus,200);
  const pending=await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key);
  assert(pending&&!pending.includes(reason)&&!pending.includes('correctedAt'));
  await page.reload();
  await expect(status).toHaveText('Work-time correction saved.');
  assert.equal(await page.evaluate(storageKey=>sessionStorage.getItem(storageKey),key),null);
  assert.equal(submissions,1);
  await editor.click();
  assert.equal(Date.parse(await form.locator('time').first().getAttribute('datetime')),corrected);
  assert.equal(await form.locator('time').nth(1).getAttribute('datetime'),original);
  const response=page.waitForEvent('download');
  await view.getByRole('button',{name:'Download JSON',exact:true}).click();
  const downloaded=JSON.parse(await readFile(await (await response).path(),'utf8'));
  assert.equal(downloaded.jobVersion,'4');
  assert.equal(downloaded.jobState,'completed');
  assert.equal(Date.parse(downloaded.intervals[0].endedAt),corrected);
  assert(downloaded.intervalVersions.some(row=>row.endedAt===original));
  await page.goto(completion);
  await expect(page.getByRole('heading',{name:'Full completion',exact:true})).toBeVisible();
 }finally{await browser?.close();await fixture.close();}
});
