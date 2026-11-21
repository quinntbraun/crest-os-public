import {captureSavedJob} from '../support/saved-job-layout.mjs';
// Actual compiled Next/Node controls, real password/TOTP and owned held54 SQL.
// Viewport/browser-engine emulation is not physical iPhone acceptance.
import assert from 'node:assert/strict';
import {captureTodayState} from '../support/today-layout.mjs';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {decodeCustomerCsv} from '../support/customer-fixture.ts';
import {assertActiveWorkLayout} from '../support/field-work-layout.mjs';
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' genuine Mobile field work, retained history, uncertain saves and retirement',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true});let browser;
 try{
  // This journey also checks Today's actual seven-day agenda. Keep its
  // synthetic booking inside that window, retaining original microseconds.
  const visitDay=new Date().toISOString().slice(0,10),appointment=f.bookingRequest.payload.appointment;
  appointment.start_at=visitDay+'T10:00:00.123456Z';appointment.end_at=visitDay+'T11:00:00.123456Z';
  appointment.local_start=appointment.start_at.slice(0,-1);appointment.local_end=appointment.end_at.slice(0,-1);
  assert.equal(appointment.timezone,'UTC');
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
  const work=f.origin+'/schedule/work?job='+f.bookingRequest.jobId,job=f.origin+'/schedule?job='+f.bookingRequest.jobId,status=page.locator('.job-change-status');
  await page.goto(work);await expect(status).toHaveText('Sign in to review work status.');await page.getByRole('link',{name:'Sign in to review work status',exact:true}).click();const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const booked=await page.evaluate(async input=>{const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),proof=await session.json(),body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId')),r=await fetch('/api/business/scheduling/book',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};},f.bookingRequest);assert.equal(booked.status,200);assert.equal(booked.value.state,'committed');
  await page.goto(job);await expect(page.locator('.schedule-status')).toHaveText('Saved job loaded at version 1.');await captureSavedJob(page,name,'work-ready');
  const departure=page.getByRole('button',{name:'Record departure…',exact:true});
  await expect(departure).toBeEnabled();
  await mkdir('.local/review',{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(()=>document.fonts.ready);
   const bounds=await departure.boundingBox();
   assert(bounds&&bounds.height>=44);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:'.local/review/saved-job-departure-'+name+'-'+width+'.png'});
  }
  await departure.press('Enter');
  await expect(status).toContainText('Saved job loaded.');
  await expect(page.getByRole('heading',{name:'Record departure',exact:true})).toBeVisible();
  const visit=page.locator('.field-visit-heading');
  await expect(visit).toContainText('Scheduled');
  await expect(visit).toContainText('Synthetic lifecycle customer');
  await expect(visit).toContainText('Synthetic lifecycle sedan');
  await expect(visit.locator('time').first()).toHaveAttribute('datetime',f.bookingRequest.payload.appointment.start_at);
  await expect(page.getByRole('button',{name:'Record departure',exact:true})).toBeVisible();
  const departureOrigin=page.getByLabel('Where are you leaving from?',{exact:true});
  await departureOrigin.fill('Synthetic departure draft to retain');
  let detailRequests=0;const observeDetails=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))detailRequests++;};
  page.on('request',observeDetails);
  try{
   await expect(visit.locator('.field-visit-facts')).toBeHidden();
   await visit.getByRole('button',{name:'View visit details',exact:true}).press('Enter');
   await expect(visit.getByRole('button',{name:'Hide visit details',exact:true})).toHaveAttribute('aria-expanded','true');
   await expect(visit.locator('.field-visit-facts')).toBeVisible();
   await expect(visit.locator('time').first()).toBeVisible();
   await expect(visit).toContainText('Synthetic workshop');
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await visit.getByRole('button',{name:'Hide visit details',exact:true}).press('Enter');
   await expect(visit.locator('.field-visit-facts')).toBeHidden();
   await expect(departureOrigin).toHaveValue('Synthetic departure draft to retain');
   assert.equal(detailRequests,0,'disclosing saved context makes no business request');
  }finally{page.off('request',observeDetails);}
  await page.getByText('Other ways to start',{exact:true}).click();
  await page.getByRole('button',{name:'Already here — start without recorded travel',exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:'Start work without recorded travel',exact:true})).toBeFocused();
  await expect(departureOrigin).toBeHidden();
  await expect(page.getByLabel('Why was travel not recorded?',{exact:true})).toBeVisible();
  await page.getByText('Other ways to start',{exact:true}).click();
  await page.getByRole('button',{name:'Switch to departure',exact:true}).click();
  await expect(departureOrigin).toHaveValue('Synthetic departure draft to retain');
  await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic private draft that must clear');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.getByLabel('Where are you leaving from?',{exact:true})).toHaveCount(0);await expect(status).toContainText('Private form cleared.');await page.getByRole('button',{name:'Reload saved work',exact:true}).click();await expect(page.getByLabel('Where are you leaving from?',{exact:true})).toHaveValue('');
  await page.getByLabel('Vehicle you are driving',{exact:true}).selectOption(f.fieldVehicleId);await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic equipment base, '+('a long fictional street and arrival description '.repeat(20)));
  await page.getByText('Trip notes and arrival estimate (optional)',{exact:true}).click();await expect(page.getByLabel('Estimated arrival (optional)',{exact:true})).not.toHaveAttribute('required');
  async function capture(prefix,state){
   await mkdir('.local/review',{recursive:true});
   for(const width of [320,360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    await assertActiveWorkLayout(page,width,state);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
    for(const control of await page.locator('.field-work-form input,.field-work-form select,.field-work-form button').all()){
     if(!await control.isVisible())continue;
     const box=await control.boundingBox();
     assert(box&&box.height>=44,'field controls need44px touch targets');
     assert(Number.parseFloat(await control.evaluate(el=>getComputedStyle(el).fontSize))>=16,'field controls use16px text');
    }
    const labelClearsFocusOutline=await page.evaluate(()=>{
     const control=document.activeElement;
     if(!(control instanceof HTMLInputElement||control instanceof HTMLTextAreaElement))return true;
     const label=control.labels?.[0];
     if(!label||label.contains(control))return true;
     const style=getComputedStyle(control);
     const outline=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset);
     return control.getBoundingClientRect().top-label.getBoundingClientRect().bottom>=outline;
    });
    assert(labelClearsFocusOutline,'field labels must clear the focused input outline');
    await page.screenshot({path:'.local/review/'+prefix+'-'+name+'-'+width+'.png',fullPage:true});
   }
  }
  // An entered invalid optional time cannot silently become an omitted ETA.
  await page.getByLabel('Estimated arrival (optional)',{exact:true}).fill('2027-03-14T02:30');await expect(page.locator('.field-work-form [role="alert"]')).toContainText('daylight-saving gap');assert.equal(await page.getByLabel('Estimated arrival (optional)',{exact:true}).evaluate(el=>el.checkValidity()),false);await page.getByLabel('Estimated arrival (optional)',{exact:true}).fill('');
  await capture('field-departure','Scheduled');await page.setViewportSize({width:390,height:500});
  assert.equal(await visit.evaluate(el=>getComputedStyle(el).position),'static','short keyboard-size viewports do not pin the visit strip');
  await departureOrigin.focus();await expect(departureOrigin).toBeFocused();
  await page.setViewportSize({width:390,height:844});
  let acknowledge,received,receiveFailed;const acknowledgement=new Promise(resolve=>{acknowledge=resolve;}),responseReady=new Promise((resolve,reject)=>{received=resolve;receiveFailed=reject;});
  await page.route('**/api/business/scheduling/field-save',async route=>{try{const response=await route.fetch();assert.equal(response.status(),200);await response.body();received();await acknowledgement;await route.fulfill({response});}catch(error){receiveFailed(error);await route.abort();}},{times:1});
  await page.getByRole('button',{name:'Record departure',exact:true}).focus();await page.keyboard.press('Enter');
  try{await responseReady;await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toHaveCount(0);await expect(status).not.toHaveText('Work status saved. Open the job to reload its current status and history.');}finally{acknowledge();}
  await expect(status).toHaveText('Work status saved. Open the job to reload its current status and history.');await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();await expect(page.getByText('En route · Mobile detail',{exact:true})).toBeVisible();await captureSavedJob(page,name,'en-route');await page.reload();await expect(page.getByText('En route · Mobile detail',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Record arrival and start work…',exact:true}).click();await expect(status).toContainText('Saved job loaded.');await capture('field-arrival','En route');await page.getByRole('button',{name:'Record arrival and start work',exact:true}).click();await expect(page.getByText('Confirmed saved version 3.',{exact:true})).toBeVisible();
  await page.goto(f.origin+'/');await expect(page.getByRole('region',{name:'Active visit',exact:true})).toContainText('In progress');await captureTodayState(page,name,'active');
  await page.goto(job);await page.getByRole('button',{name:'Pause work…',exact:true}).click();await expect(status).toContainText('Saved job loaded.');await page.getByLabel('Reason for pause',{exact:true}).fill('Synthetic supply break');await capture('field-pause','In progress');await page.setViewportSize({width:390,height:844});let delivered=0;
  await page.route('**/api/business/scheduling/field-save',async route=>{delivered++;const response=await route.fetch();assert.equal(response.status(),200);await response.body();await route.abort('failed');});await page.getByRole('button',{name:'Pause work',exact:true}).click();await expect(status).toContainText('save outcome is unknown');assert.equal(delivered,1);await expect(page.getByLabel('Reason for pause',{exact:true})).toHaveCount(0);const pending=await page.evaluate(()=>sessionStorage.getItem('crest.field-session.pending-reference.v1'));assert(pending&&!pending.includes('Synthetic supply break')&&!pending.includes('locationText'));await page.unroute('**/api/business/scheduling/field-save');await page.getByRole('button',{name:'Check original work action',exact:true}).click();await expect(page.getByText('Confirmed saved version 4.',{exact:true})).toBeVisible();assert.equal(delivered,1);
  // A request that never reached the server remains pending until explicitly
  // retired and acknowledged; an absent observation does not clear it.
  await page.goto(job);await expect(page.getByRole('button',{name:'Resume work…',exact:true})).toBeVisible();await captureSavedJob(page,name,'paused');await page.getByRole('button',{name:'Resume work…',exact:true}).click();await expect(status).toContainText('Saved job loaded.');await capture('field-resume','Paused');await page.route('**/api/business/scheduling/field-save',route=>route.abort('failed'));await page.getByRole('button',{name:'Resume work',exact:true}).click();await expect(status).toContainText('save outcome is unknown');await page.unroute('**/api/business/scheduling/field-save');await page.getByRole('button',{name:'Check original work action',exact:true}).click();await expect(status).toContainText('No committed original was found.');assert(await page.evaluate(()=>sessionStorage.getItem('crest.field-session.pending-reference.v1')));
  await page.getByRole('link',{name:'Open Save review',exact:true}).click();await expect(page.getByLabel('Interrupted save type',{exact:true})).toHaveValue('operations.job.field');await expect(page.getByLabel('Interrupted save type',{exact:true}).locator('option:checked')).toHaveText('Mobile work status');await page.getByRole('button',{name:'Retirement options',exact:true}).click();await page.getByLabel('Reason for retiring this original save',{exact:true}).fill('Synthetic owner reviewed the undelivered resume request');await page.getByRole('button',{name:'Review retirement',exact:true}).click();await page.getByRole('button',{name:'Confirm retirement of this original save',exact:true}).click();await page.getByRole('button',{name:'Acknowledge retirement and release local reference',exact:true}).click();await expect(page.getByRole('region',{name:'Original save review',exact:true}).getByRole('status')).toContainText('retired save reference is released');
  await page.goto(work);await expect(status).toContainText('Saved job loaded.');await page.getByRole('button',{name:'Resume work',exact:true}).click();await expect(page.getByText('Confirmed saved version 5.',{exact:true})).toBeVisible();await page.goto(job);await expect(page.getByText('In progress · Mobile detail',{exact:true})).toBeVisible();await page.getByText('Saved history · version 5',{exact:true}).click();await expect(page.getByText('Work status changed',{exact:true})).toHaveCount(4);
  const stamps=(await f.client.query("SELECT to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated,to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS effective FROM crest.jobs j JOIN crest.job_events e ON e.business_id=j.business_id AND e.job_id=j.id AND e.sequence=j.version WHERE j.business_id=$1 AND j.id=$2",[f.business,f.bookingRequest.jobId])).rows[0];assert.notEqual(stamps.updated,stamps.effective);assert(stamps.effective<stamps.updated);
  const downloadEvent=page.waitForEvent('download').catch(()=>null);await page.getByRole('button',{name:'Download saved history',exact:true}).click();await expect(page.getByRole('status',{name:'Job download status',exact:true})).toContainText('download requested');const download=await downloadEvent;assert(download);assert.equal(await download.failure(),null);const parts=unzipSync(await readFile(await download.path())),history=JSON.parse(strFromU8(parts['saved_job_history.json'])),csv=decodeCustomerCsv(strFromU8(parts['history.csv']),strFromU8(parts['history_escape_map.json']));assert.deepEqual(history.events.map(e=>e.toState),['scheduled','en_route','in_progress','paused','in_progress']);assert.deepEqual(csv.map(e=>e.toState),history.events.map(e=>e.toState));assert.equal(history.events.at(-1).effectiveAt,stamps.effective);assert.equal(history.head.job.updated_at,stamps.updated);assert.equal(csv.at(-1).effectiveAt,stamps.effective);
  await page.route('**/api/business/scheduling/resources',route=>route.abort('failed'));await page.goto(work);await expect(status).toContainText('could not be verified');await expect(page.locator('.field-work-form')).toHaveCount(0);await page.unroute('**/api/business/scheduling/resources');await page.getByRole('button',{name:'Reload saved work',exact:true}).click();await expect(status).toContainText('Saved job loaded.');await page.goto(f.origin+'/');await page.goBack();if(await page.getByRole('button',{name:'Reload saved work',exact:true}).isVisible())await page.getByRole('button',{name:'Reload saved work',exact:true}).click();await expect(status).toContainText('Saved job loaded.');
  assert.equal((await f.client.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,54);assert.equal((await f.client.query('SELECT version::text,state FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,f.bookingRequest.jobId])).rows[0].version,'5');
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect(page.locator('.active-work-form')).toHaveCount(0);
  await context.clearCookies();await page.reload();await expect(status).toHaveText('Sign in to review work status.');await expect(page.locator('.active-work-form')).toHaveCount(0);
 }finally{await browser?.close();await f.close();}
},{timeout:300000});
