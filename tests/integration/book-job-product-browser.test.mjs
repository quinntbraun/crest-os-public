// Genuine accepted quote → actual booking form → uncertain-save recovery →
// saved Schedule review. Test-only services and fictional records throughout.
import assert from 'node:assert/strict';
import {assertTodayLayout,captureTodayState} from '../support/today-layout.mjs';

import {test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' genuine quote-to-booking lost-reply/reload and saved-job journey',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,appointmentHolds:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  await page.goto(f.origin+'/schedule/new?agreement='+f.bookingFamilyId);await expect(page.locator('.booking-status')).toHaveText('Sign in to book a visit.');await expect(page.getByRole('form',{name:'Confirmed visit booking',exact:true})).toHaveCount(0);await page.getByRole('link',{name:'Sign in to book a visit',exact:true}).click();
  const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();assert((await context.cookies()).some(cookie=>cookie.name==='__Host-crest_session'&&cookie.httpOnly&&cookie.secure));
  await page.goto(f.origin+'/');await expect(page.getByRole('status')).toHaveText('Workspace access verified.');await expect(page.getByRole('region',{name:'Upcoming visit status'})).toContainText('No active saved visits in the next seven days.');await expect(page.getByRole('region',{name:'Unconfirmed appointment proposals'})).toHaveAttribute('data-queue-state','empty');await captureTodayState(page,name,'empty');
  await page.goto(f.origin+'/schedule/new');await expect(page.getByRole('link',{name:'Open saved quotes',exact:true})).toHaveAttribute('href','/quotes');
  await page.goto(f.origin+'/quotes');const directory=page.getByRole('list',{name:'Saved quotes',exact:true});await expect(directory.getByRole('button')).toHaveCount(1);await directory.getByRole('button').click();const book=page.getByRole('link',{name:'Book a visit from this agreement',exact:true});await expect(book).toBeVisible();await book.click();await expect(page.getByRole('form',{name:'Confirmed visit booking',exact:true})).toBeVisible();
  const visitDay=new Date(Date.now()+86400000).toISOString().slice(0,10);await page.getByLabel('Work location details',{exact:true}).fill('Synthetic Crest booking workshop — 123 Example Lane, Indianapolis');await page.getByRole('button',{name:'Continue to time',exact:true}).click();await expect(page.getByRole('heading',{name:'Time and contact',exact:true})).toBeFocused();await page.getByLabel('Time zone',{exact:true}).fill('UTC');await page.getByLabel('Visit starts',{exact:true}).fill(visitDay+'T10:00');await page.getByLabel('Visit ends',{exact:true}).fill(visitDay+'T11:00');
  await page.getByText('Travel around this visit',{exact:true}).click();await page.getByLabel('Travel before (minutes)',{exact:true}).fill('0');await page.getByLabel('Travel after (minutes)',{exact:true}).fill('0');await page.getByLabel('Contact method',{exact:true}).selectOption('no_contact');await page.getByLabel('Reason no contact is selected',{exact:true}).fill('Synthetic visit arranged with the customer in person.');  await mkdir('.local/review',{recursive:true});for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(width<=390){const box=await page.getByLabel("Visit starts",{exact:true}).boundingBox();assert(box&&box.width>=240,"phone date/time fields must show the full value");}assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);await page.screenshot({path:'.local/review/book-job-'+name+'-'+width+'.png',fullPage:true});}

  await page.getByRole('button',{name:'Continue to confirmation',exact:true}).click();await page.getByLabel('Visit confirmation channel',{exact:true}).selectOption('in_person');await page.getByLabel('When the customer confirmed this visit',{exact:true}).fill(new Date(Date.now()-1000).toISOString().slice(0,16));await page.getByLabel('Visit confirmation evidence',{exact:true}).fill('Synthetic customer confirmed the selected work, location and actual visit window.');
  await expect(page.getByRole('region',{name:'Appointment to confirm',exact:true})).toContainText('Synthetic Crest booking workshop');
  let requests=0,loseReply=true;await page.route('**/api/business/scheduling/book',async route=>{requests++;const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});if(loseReply&&response.status()===200){loseReply=false;await response.body();await route.abort('failed');return;}await route.fulfill({response});});await page.getByRole('button',{name:/^Review schedule(?: again)?$/,exact:true}).click();await expect(page.getByRole('region',{name:'Schedule conflict review',exact:true})).toContainText('Current schedule review loaded.');await page.getByRole('button',{name:'Back',exact:true}).click();const originalEnd=await page.getByLabel('Visit ends',{exact:true}).inputValue();await page.getByLabel('Visit ends',{exact:true}).fill(new Date(Date.parse(originalEnd+'Z')+15*60000).toISOString().slice(0,16));await page.getByRole('button',{name:'Continue to confirmation',exact:true}).click();await expect(page.getByRole('region',{name:'Schedule conflict review',exact:true})).not.toContainText('Current schedule review loaded.');await page.getByRole('button',{name:'Confirm and save job',exact:true}).click();await expect(page.getByRole('form',{name:'Confirmed visit booking',exact:true}).getByRole('alert')).toContainText('Review the current schedule');assert.equal(requests,0);await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByLabel('Visit ends',{exact:true}).fill(originalEnd);await page.getByRole('button',{name:'Continue to confirmation',exact:true}).click();await expect(page.getByRole('region',{name:'Schedule conflict review',exact:true})).not.toContainText('Current schedule review loaded.');await page.getByRole('button',{name:/^Review schedule(?: again)?$/,exact:true}).click();await expect(page.getByRole('region',{name:'Schedule conflict review',exact:true})).toContainText('Current schedule review loaded.');await page.getByRole('button',{name:'Confirm and save job',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('.booking-status')).toContainText('Booking save outcome is unknown.');assert.equal(requests,1);
  const raw=await page.evaluate(()=>sessionStorage.getItem('crest.book-job.pending-reference.v1'));assert(raw);assert(!raw.includes('Synthetic'));const pending=JSON.parse(raw);assert.deepEqual(Object.keys(pending.reference).sort(),['expectedModeSequence','jobId','operationId','recoveryEpoch']);assert.equal((await f.client.query('SELECT count(*)::int AS count FROM crest.jobs WHERE business_id=$1',[f.business])).rows[0].count,1);await expect(page.getByRole('button',{name:'Retry unchanged original booking',exact:true})).toHaveCount(0);
  page.once('dialog',dialog=>dialog.accept());await page.reload();await expect(page.locator('.booking-status')).toHaveText('Confirmed job saved. Open its retained visit details in Schedule.');assert.equal(requests,1);assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.book-job.pending-reference.v1')),null);await page.getByRole('link',{name:'Open saved job in Schedule',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeFocused();await expect(page.getByText('Synthetic Crest booking workshop — 123 Example Lane, Indianapolis',{exact:true})).toBeVisible();await page.getByRole('navigation',{name:'Job sections',exact:true}).getByRole('link',{name:'History',exact:true}).click();await expect(page.getByText('Job booked',{exact:true})).toBeVisible();
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:'.local/review/field-saved-job-'+name+'-'+width+'.png',fullPage:true});
  }
  await page.reload();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();
  // Home reads the actual saved visit; no seeded dashboard counts or fake rows.
  await page.setViewportSize({width:390,height:900});
  let releaseWorkspaceRead;
  const workspaceReadReady=new Promise(resolve=>{releaseWorkspaceRead=resolve;});
  await page.route('**/api/business/settings',async route=>{await workspaceReadReady;await route.continue();},{times:1});
  try{
   await page.goto(f.origin+'/');
   await expect(page.locator('main')).toHaveAttribute('aria-busy','true');
   const placeholder=page.locator('.today-loading .workspace-skeleton').first();
   await expect(placeholder).toBeVisible();
   const title=await page.locator('.today-heading').boundingBox();
   assert(title&&title.height<112,'The mobile title keeps the loading state near the top of the screen.');
   assert.equal(await placeholder.evaluate(node=>getComputedStyle(node).animationName),'workspace-skeleton-pass');
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await placeholder.evaluate(node=>getComputedStyle(node).animationName),'none');
   await page.emulateMedia({reducedMotion:null});
   const logo=page.getByRole('link',{name:'Crest OS home',exact:true}).locator('img');
   await expect.poll(()=>logo.evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
   await page.screenshot({path:'.local/review/home-loading-'+name+'-390.png'});
  }finally{releaseWorkspaceRead();}
  await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  await expect(page.locator('.today-loading')).toHaveCount(0);
  const sidebarAccounting=page.locator('.workspace-sidebar-tools').getByRole('link',{name:'Accounting',exact:true,includeHidden:true});
  await expect(sidebarAccounting).toBeHidden();
  await page.setViewportSize({width:1440,height:900});
  await expect(sidebarAccounting).toBeVisible();
  const featured=page.getByRole('region',{name:'Next confirmed visit',exact:true});
  const openVisit=featured.getByRole('link',{name:'Open visit for Synthetic lifecycle customer',exact:true});
  const upcoming=page.getByRole('region',{name:'Schedule review',exact:true});
  await expect(openVisit).toBeVisible();
  await expect(featured.locator('time')).toContainText('10:00 AM');
  await expect(upcoming).not.toContainText('Synthetic lifecycle customer');
  await upcoming.getByText('Appointment changes to review',{exact:true}).click();
  await expect(upcoming).toContainText('No proposed appointment changes recorded.');
  await page.route('**/api/business/scheduling/list',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  await expect(page.getByRole('region',{name:'Upcoming visit status'})).toContainText('Upcoming visits could not be verified');
  await expect(openVisit).toHaveCount(0);await captureTodayState(page,name,'partial-visits');
  await page.unroute('**/api/business/scheduling/list');
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(openVisit).toBeVisible();
  await page.route('**/api/business/scheduling/pending',route=>route.abort('failed'));
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(openVisit).toBeVisible();
  await expect(upcoming).toContainText('Proposed changes could not be verified.');
  await page.unroute('**/api/business/scheduling/pending');
  await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();
  await expect(openVisit).toBeVisible();
  for(const width of [320,360,390,768,1440]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
   const [action,queue,scheduleLink]=await Promise.all([openVisit.boundingBox(),upcoming.boundingBox(),upcoming.getByRole('link',{name:'Open schedule',exact:true}).boundingBox()]);
   assert(action&&queue&&scheduleLink&&action.height>=44&&scheduleLink.height>=44&&action.y+action.height<Math.min(queue.y,700));
   if(width===1440){
    const visitDetails=await featured.locator('.today-feature-content > div').boundingBox();
    assert(visitDetails&&action.x>=visitDetails.x+visitDetails.width&&action.x-visitDetails.x-visitDetails.width<=40);
   }
   await assertTodayLayout(page);
   await page.screenshot({path:'.local/review/agenda-upcoming-'+name+'-'+width+'.png'});
  }
  await page.route(/\/api\/business\/scheduling\/(list|pending)$/,route=>route.abort('failed'));
  await openVisit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Job',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Saved work calendar',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Back to Today',exact:true})).toHaveAttribute('href','/');
  assert(page.url().includes('job='+pending.reference.jobId));
  const facts=(await f.client.query('SELECT state,version::text FROM crest.jobs WHERE business_id=$1',[f.business])).rows;assert.deepEqual(facts,[{state:'scheduled',version:'1'}]);const amounts=(await f.client.query('SELECT amount_cents::text FROM crest.allocation_plan_parts WHERE business_id=$1 AND job_id=$2 ORDER BY amount_cents',[f.business,pending.reference.jobId])).rows;assert.deepEqual(amounts,[{amount_cents:'0'},{amount_cents:'25000'}]);assert.equal(requests,1);
 }finally{await browser?.close();await f.close();}
},{timeout:240000});
