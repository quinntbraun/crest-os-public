import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {strFromU8,unzipSync} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' cancels started work and preserves original history',{timeout:300000},async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,
  jobCompletion:true,supportTrips:true,unfulfilledCancellation:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const job=f.bookingRequest.jobId,work=f.origin+'/schedule/work?job='+job;
  const cancel=f.origin+'/schedule/work/cancel?job='+job;
  const status=page.locator('.job-change-status'),route='**/api/business/scheduling/cancel-unfulfilled';
  await page.goto(cancel);
  await page.getByRole('link',{name:'Sign in to review work status'}).click();
  const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const booking=await page.evaluate(async input=>{
   const init={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
   const {csrfToken}=await (await fetch('/api/auth/session',init)).json();
   const body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId'));
   const r=await fetch('/api/business/scheduling/book',{...init,headers:{...init.headers,'x-crest-csrf':csrfToken},body:JSON.stringify(body)});
   return r.status;
  },f.bookingRequest);
  assert.equal(booking,200);
  await page.goto(cancel);
  await expect(status).toContainText('no longer eligible');
  await page.goto(work);
  await page.getByLabel('What is happening?').selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?').fill('Synthetic arrival without trip');
  await page.getByRole('button',{name:'Start work without recorded travel'}).click();
  await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  if(name==='webkit'){
   await page.goto(work);
   await page.getByLabel('Reason for pause').fill('Synthetic wait for supplies');
   await page.getByRole('button',{name:'Pause work',exact:true}).click();
   await expect(page.getByText('Confirmed saved version 3.',{exact:true})).toBeVisible();
   await page.goto(f.origin+'/schedule/travel');
   const trip=page.getByRole('form',{name:'Start a trip',exact:true});
   await trip.getByLabel('Purpose').selectOption('supply');
   await trip.getByLabel('Vehicle you are driving').selectOption(f.fieldVehicleId);
   await trip.getByLabel('Leaving from').fill('Synthetic work site');
   await trip.getByLabel('Going to').fill('Synthetic supply shop');
   await trip.getByRole('button',{name:'Start a trip',exact:true}).click();
   await expect(status).toHaveText('Trip saved.');
  }
  await page.goto(work);
  await page.getByRole('link',{name:'Cancel if no work was completed'}).click();
  await expect(status).toHaveText('Review the saved work before cancelling.');
  await expect(page.getByRole('link',{name:'Review and end job',exact:true})).toHaveCount(0);
  const assignments=page.getByText(/^Assigned work \([1-9]\d*\)$/);
  await assignments.click();
  await expect(assignments.locator('..').getByRole('listitem').first()).toBeVisible();
  await assignments.click();
  if(name==='webkit')await expect(page.getByText(/A trip is still open/)).toBeVisible();
  const reason='Synthetic customer cancelled before work was performed',note='Synthetic communication evidence';
  await page.getByLabel('Cancellation reason').fill(reason);
  await page.getByLabel('Customer-communication status').selectOption('not_sent');
  await page.getByLabel('Communication note (optional)',{exact:true}).fill(note);
  const save=page.getByRole('button',{name:'Cancel job and close work time'});
  let submits=0;
  await page.route(route,async intercepted=>{
   submits++;
   const response=await intercepted.fetch();
   if(name==='webkit'&&response.status()===200)await intercepted.abort('failed');
   else await intercepted.fulfill({response});
  });
  await save.click();
  assert.equal(submits,0);
  await expect(page.getByLabel('Work completed',{exact:true})).toBeFocused();
  await page.getByLabel('Work completed',{exact:true}).selectOption('none');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
   await page.screenshot({path:'.local/review/field-cancellation-'+name+'-'+width+'.png',fullPage:true});
  }
  await save.focus();
  await page.keyboard.press('Enter');
  if(name==='webkit'){
   await expect(status).toContainText('save outcome is unknown');
   const pending=await page.evaluate(()=>sessionStorage.getItem('crest.unfulfilled-cancellation.pending-reference.v1'));
   assert(pending&&!pending.includes(reason)&&!pending.includes(note));
   await page.reload();
  }
  await expect(status).toContainText('Job cancelled.');
  assert.equal(submits,1);
  const finalVersion=name==='webkit'?4:3;
  await page.getByRole('link',{name:'Open updated job in Schedule'}).click();
  await expect(page.locator('.schedule-status')).toHaveText('Saved job loaded at version '+finalVersion+'.');
  await page.getByText('Saved history · version '+finalVersion,{exact:true}).click();
  await expect(page.getByText(reason,{exact:true})).toBeVisible();
  await page.getByText('Communication note',{exact:true}).click();
  await expect(page.getByText(note,{exact:true})).toBeVisible();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download saved history'}).click();
  const exported=unzipSync(await readFile(await (await download).path()));
  const retained=JSON.parse(strFromU8(exported['saved_job_history.json'])).events.at(-1);
  assert.equal(retained.customerCommunication.evidenceNote,note);
  assert.equal(retained.reason,reason);
  assert(Object.keys(exported).some(name=>name.endsWith('.csv')));
  await page.reload();
  await expect(page.locator('.schedule-status')).toHaveText('Saved job loaded at version '+finalVersion+'.');
  const rows=(await f.client.query(`SELECT j.state,
   (SELECT count(*)::int FROM crest.current_work_intervals w WHERE w.job_id=j.id AND w.ended_at IS NULL) open_work,
   (SELECT count(*)::int FROM crest.schedule_reservations r WHERE r.job_id=j.id) reservations,
   (SELECT count(*)::int FROM crest.current_travel_legs t WHERE t.business_id=j.business_id AND t.state='open') open_travel,
   (SELECT bool_and(o.outcome='cancelled' AND o.completed_cents=0) FROM crest.work_scope_outcomes o WHERE o.job_id=j.id) cancelled_scope
   FROM crest.jobs j WHERE j.id=$1`,[job])).rows;
  assert.deepEqual(rows,[{state:'cancelled',open_work:0,reservations:0,open_travel:name==='webkit'?1:0,cancelled_scope:true}]);
 }finally{await browser?.close();await f.close();}
});
