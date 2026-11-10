import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' reloads and exports saved active and paused work time',{timeout:300000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,workTime:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const job=fixture.bookingRequest.jobId,work=fixture.origin+'/schedule/work?job='+job,time=fixture.origin+'/schedule/work/time?job='+job;
  await page.goto(time);
  const view=page.getByRole('region',{name:'Saved work time',exact:true});
  const status=view.getByRole('status');
  await expect(status).toHaveText('Sign in to view work time.');
  await page.getByRole('link',{name:'Sign in to view work time'}).click();
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
  await page.goto(time);
  await expect(view.getByText('No work intervals have been recorded for this job.')).toBeVisible();
  await page.goto(work);
  await page.getByLabel('What is happening?').selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.goto(work);
  await page.getByRole('link',{name:'Review recorded work time'}).click();
  await expect(view.getByText(/Work is in progress/)).toBeVisible();
  await page.goto(work);
  const reason='=Synthetic equipment check';
  await page.getByLabel('Reason for pause').fill(reason);
  await page.getByRole('button',{name:'Pause work',exact:true}).click();
  await expect(page.getByText('Confirmed saved version 3.',{exact:true})).toBeVisible();
  await page.goto(time);
  await expect(view.getByText(/Work is paused/)).toBeVisible();
  await view.getByText('Saved intervals (2)',{exact:true}).click();
  await expect(view.getByText(reason,{exact:true})).toBeVisible();
  await view.getByText('Earlier versions (1)',{exact:true}).click();
  await expect(view.getByText(/Open when recorded/)).toBeVisible();
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/field-work-time-'+name+'-'+width+'.png',fullPage:true});
  }
  const getDownload=async(label)=>{
   const event=page.waitForEvent('download');
   await view.getByRole('button',{name:label,exact:true}).click();
   return readFile(await (await event).path(),'utf8');
  };
  const first=JSON.parse(await getDownload('Download JSON'));
  assert.equal(first.summary.openInterval.kind,'pause');
  assert.equal(first.intervals[0].endedAt,first.intervals[1].startedAt);
  assert.equal(first.summary.closedActiveMicroseconds,first.summary.observedActiveMicroseconds);
  assert.equal(first.summary.unrecordedMicroseconds,'0');
  const original=first.intervalVersions.find(row=>row.versionId===first.intervals[0].replacesVersionId);
  assert(original&&original.endedAt===null&&original.changeKind==='open');
  const csv=await getDownload('Download CSV');
  assert(csv.includes(first.intervals[1].versionId)&&csv.includes(original.versionId)&&csv.includes('"'+"'"+reason+'"'));
  await page.reload();
  await expect(status).toHaveText('Saved work time loaded.');
  const second=JSON.parse(await getDownload('Download JSON'));
  assert.deepEqual(second.intervals,first.intervals);
  assert.deepEqual(second.intervalVersions,first.intervalVersions);
  assert.equal(second.summary.observedActiveMicroseconds,first.summary.observedActiveMicroseconds);
  assert(second.observedAt>=first.observedAt);
  await context.setOffline(true);
  await view.getByRole('button',{name:'Refresh totals'}).click();
  await expect(status).toContainText('Work time could not be verified');
  await expect(view.getByRole('button',{name:'Download JSON'})).toHaveCount(0);
  await context.setOffline(false);
  await view.getByRole('button',{name:'Refresh totals'}).click();
  await expect(status).toHaveText('Saved work time loaded.');
 }finally{await browser?.close();await fixture.close();}
});
