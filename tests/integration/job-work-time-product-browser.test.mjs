import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {workTimeFailureDiagnostic} from '../support/work-time-diagnostic.mjs';
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
  await page.getByText('Other ways to start',{exact:true}).click();await page.getByRole('button',{name:'Already here — start without recorded travel',exact:true}).click();
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.goto(work);
  await page.getByText('More actions',{exact:true}).click();await page.getByRole('link',{name:'Review recorded work time'}).click();
  await expect(view.getByText(/Work is in progress/)).toBeVisible();
  await page.goto(work);
  const reason='=Synthetic equipment check';
  await page.getByLabel('Reason for pause').fill(reason);
  await page.getByRole('button',{name:'Pause work',exact:true}).click();
  await expect(page.getByText('Confirmed saved version 3.',{exact:true})).toBeVisible();
  await page.goto(time);
  await expect(view.getByText(/Work is paused/)).toBeVisible();
  const ledger=view.getByRole('region',{name:'Saved intervals',exact:true});
  await expect(ledger.getByRole('heading',{name:'Saved intervals (2)',exact:true})).toBeVisible();
  await expect(ledger.locator('.work-time-interval')).toHaveCount(2);
  await expect(ledger.getByText('At last read',{exact:true})).toBeVisible();
  await expect(ledger.getByText('Still open',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Saved job and history',exact:true})).toHaveAttribute('href','/schedule?job='+job);
  await expect(ledger.locator('.work-time-interval > .work-time-reason').filter({hasText:reason})).toBeVisible();
  const retained=ledger.locator('.work-time-interval').first().locator('.work-interval-history');
  const inspectionRequests=fixture.requests.length;
  await retained.getByText('Retained versions (2)',{exact:true}).click();
  await expect(retained.locator('.work-history-facts').getByText('Open when recorded',{exact:true})).toBeVisible();
  await expect(retained.getByText('Not closed in this version',{exact:true})).toBeVisible();
  await expect(retained.getByRole('region',{name:'Changes in interval version 2',exact:true})).toContainText('Not recorded');
  await expect(view.getByRole('region',{name:'Work totals',exact:true})).toContainText('Open durations are measured only to the read time above.');
  assert.equal(fixture.requests.length,inspectionRequests,'Inspecting interval history makes no API request');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/field-work-time-'+name+'-'+width+'.png',fullPage:true});
   await page.screenshot({path:'.local/review/work-time-ledger-'+name+'-'+width+'.png',animations:'disabled'});
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
  // Exercise local-day grouping with a controlled cross-midnight read after the native workflow.
  const midnightRoute='**/api/business/scheduling/work-time';
  const dates=[
   {startedAt:'2026-10-01T03:59:15.000000Z',endedAt:'2026-10-01T04:00:15.000000Z',kind:'active',pauseReason:null},
   {startedAt:'2026-10-01T04:01:15.000000Z',endedAt:'2026-10-01T04:01:35.000000Z',kind:'pause',pauseReason:'Synthetic split day'}
  ];
  const intervalVersions=dates.map(row=>{
   const id=randomUUID();
   return {...row,intervalId:id,versionId:id,sequence:'1',recordReason:'Synthetic time import',changeKind:'record',replacesVersionId:null,recordedAt:row.endedAt};
  });
  await page.route(midnightRoute,async route=>{
   const response=await route.fetch();
   assert.equal(response.status(),200);
   await route.fulfill({response,json:{...await response.json(),jobState:'completed',intervalVersions}});
  });
  await view.getByRole('button',{name:'Refresh totals'}).click();
  await expect(ledger.locator('.work-time-day h3')).toHaveText(['Wednesday, September 30, 2026','Thursday, October 1, 2026']);
  const crossMidnight=ledger.locator('.work-time-interval').first();
  await expect(crossMidnight).toContainText('Oct 1, 2026');
  await expect(crossMidnight.locator('.work-time-interval-head strong')).toHaveText('1m 0s');
  await expect(ledger.locator('.work-time-interval').last().locator('.work-time-interval-head strong')).toHaveText('20s');
  await expect(view.getByLabel('Work totals')).toContainText('Unrecorded gap');
  await page.unroute(midnightRoute);
 }catch(error){await workTimeFailureDiagnostic(fixture,name,null);throw error;}finally{await browser?.close();await fixture.close();}
});
