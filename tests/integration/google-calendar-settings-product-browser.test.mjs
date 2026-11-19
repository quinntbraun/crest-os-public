import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, webkit } from '@playwright/test';
import { reviewBusinessSettingsIndex } from '../support/business-settings-index.mjs';
import { recoveryCluster } from '../support/recovery-drill.mjs';
import { sourceExportBrowserFixture } from '../support/source-export-browser-fixture.mjs';

const prefix = '/api/business/google-calendar/';
const settings = '/settings/google-calendar';
const referenceKey = 'crest.calendar-consent.pending.v1';

test('signed-in Calendar pages six protected native bookings and retains phone return context', {timeout:240000}, async t=>{
 const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
 if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
 let fixture;
 try{
  fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,googleCalendar:true,calendarActivityBookings:6});
  assert.equal(fixture.calendarActivityJobIds.length,6);
  const captures=new URL('../../.local/review/',import.meta.url);await mkdir(captures,{recursive:true});
  const facts=async()=>{const result={};for(const table of ['jobs','appointments','google_calendar_outbox','google_calendar_dispatch_sends','google_calendar_dispatch_results'])result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;result.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return result;};
  for(const engine of [chromium,webkit]){
   const browser=await engine.launch();
   const failures=[];let diagnosticPage;
   try{
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
    diagnosticPage=page;page.on('response',response=>{const path=new URL(response.url()).pathname;if(response.status()>=400&&(path.startsWith('/api/business/')||path==='/api/auth/session')){if(failures.length===32)failures.shift();failures.push({path,status:response.status()});}});
    await page.goto(fixture.origin+'/sign-in');const credentials=fixture.credentials();
    await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).press('Enter');await expect(page.getByRole('status')).toContainText('Signed in');
    await page.goto(fixture.origin+settings);
    const setup=page.getByRole('region',{name:'Fictional Calendar setup'});
    if(engine===chromium){
     await setup.getByRole('button',{name:'Prepare fictional calendar',exact:true}).press('Enter');
     await setup.getByRole('button',{name:'Review shared event',exact:true}).press('Enter');
     for(const label of [/I reviewed the example event fields/,/I read how to check who can access/,/I read how to check notifications/])await setup.getByLabel(label).check();
     await setup.getByRole('button',{name:'Save Calendar consent',exact:true}).press('Enter');
    }
    await expect(setup.getByRole('region',{name:'Setup overview'}).getByText('Consent saved',{exact:true})).toBeVisible();
    await expect(setup.getByText('Crest Jobs is prepared. Review what an event would share.',{exact:true})).toHaveCount(0);
    const directory=page.getByRole('region',{name:'Appointment activity directory',includeHidden:true}),status=directory.getByRole('status',{name:'Appointment activity status'}),rows=directory.getByRole('list',{name:'Appointments in chosen dates'}).getByRole('listitem'),dates=directory.locator('.calendar-date-disclosure');
    await expect(directory).toHaveAttribute('aria-busy','false');
    await dates.locator('summary').press('Enter');await directory.getByLabel('From date',{exact:true}).fill('2026-11-02');await directory.getByLabel('Through date',{exact:true}).fill('2026-11-04');await directory.getByRole('button',{name:'Load dates',exact:true}).press('Enter');
    await expect(status).toContainText('5 appointments loaded.');await expect(rows).toHaveCount(5);await expect(directory.getByRole('button',{name:'Previous appointments'})).toBeDisabled();
    const before=await facts(),ids=async()=>rows.locator('h3 a').evaluateAll(links=>links.map(link=>new URL(link.href).searchParams.get('job'))),firstIds=await ids();
    assert.equal(new Set(firstIds).size,5);assert(firstIds.every(id=>fixture.calendarActivityJobIds.includes(id)));
    for(const width of [360,390,768,1100,1440]){
     await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await page.screenshot({path:fileURLToPath(new URL('settings-calendar-six-'+engine.name()+'-'+width+'.png',captures)),fullPage:true});
    }
    await page.setViewportSize({width:390,height:900});await directory.getByRole('button',{name:'Next appointments'}).press('Enter');await expect(status).toContainText('1 appointment loaded.');await expect(rows).toHaveCount(1);await expect(directory.getByRole('button',{name:'Next appointments'})).toBeDisabled();await expect(directory.getByRole('heading',{name:'Appointments in range'})).toBeFocused();
    const secondIds=await ids();assert.deepEqual(new Set([...firstIds,...secondIds]),new Set(fixture.calendarActivityJobIds));
    const expectedState=await rows.locator('.calendar-activity-state').textContent();assert(expectedState&&expectedState!=='Check failed');
    const selected=rows.locator('h3 a');await selected.press('Enter');const sync=page.getByRole('region',{name:'Saved appointment sync'});await expect(sync.getByRole('heading',{name:'Saved appointment sync'})).toBeFocused();await expect(directory).toBeHidden();await expect(sync.locator('.calendar-activity-state')).toHaveText(expectedState);await expect(sync).toHaveAttribute('aria-busy','false');
    const requests=[],observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method());};page.on('request',observe);
    try{await page.getByRole('button',{name:'Back to appointment activity'}).press('Enter');await expect(selected).toBeFocused();await expect(rows).toHaveCount(1);assert.deepEqual(requests,[]);}finally{page.off('request',observe);}
    await expect(directory.getByLabel('From date',{exact:true})).toHaveValue('2026-11-02');await expect(directory.getByLabel('Through date',{exact:true})).toHaveValue('2026-11-04');await expect(directory.getByRole('navigation',{name:'Appointment activity pages'})).toContainText('Page 2');
    await page.goBack();await expect(sync).toBeVisible();await page.goForward();await expect(selected).toBeFocused();await expect(rows).toHaveCount(1);
    await directory.getByRole('button',{name:'Previous appointments'}).press('Enter');await expect(rows).toHaveCount(5);assert.deepEqual(await ids(),firstIds);
    await page.route('**/api/business/scheduling/list',route=>route.abort(),{times:1});await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect(status).toContainText('could not verify');await expect(rows).toHaveCount(0);await expect(page.getByRole('region',{name:'Saved appointment sync'})).toHaveCount(0);
    await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect(rows).toHaveCount(5);
    let release,forwarded,held=false;const gate=new Promise(resolve=>{release=resolve;}),hold=route=>{forwarded=(async()=>{held=true;await gate;await route.abort();})();return forwarded;};await page.route('**/api/business/scheduling/list',hold);
    try{await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect.poll(()=>held).toBe(true);await expect(rows).toHaveCount(0);await directory.getByRole('button',{name:'Cancel loading'}).press('Enter');await expect(status).toContainText('cancelled');await expect(rows).toHaveCount(0);}finally{release();await forwarded;await page.unroute('**/api/business/scheduling/list',hold);}
    await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect(rows).toHaveCount(5);assert.deepEqual(await facts(),before);
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),referenceKey),null);
   }catch(error){t.diagnostic('Calendar pagination read failures '+JSON.stringify({engine:engine.name(),failures}));try{await diagnosticPage?.screenshot({path:fileURLToPath(new URL('settings-calendar-six-failure-'+engine.name()+'.png',captures)),fullPage:true});}catch{/* Optional screenshot failure must preserve the original assertion. */}throw error;}finally{await browser.close();}
  }
 }finally{try{await fixture?.close();}finally{if(previous===undefined)delete process.env.CREST_TEST_DATABASE_URL;else process.env.CREST_TEST_DATABASE_URL=previous;await cluster?.close();}}
});


test('Calendar refuses a page whose real appointment changes during its status read',{timeout:240000},async t=>{
 const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
 let fixture;
 try{
  fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,googleCalendar:true,calendarActivityBookings:1});
  for(const engine of [chromium,webkit]){
   const browser=await engine.launch();
   const observations=[],started=Date.now();let diagnosticPage,held=false;
   try{
    const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
    diagnosticPage=page;page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/business/')||path==='/api/auth/session'){if(observations.length===40)observations.shift();observations.push({path,status:response.status(),elapsedMs:Date.now()-started});}});
    await page.goto(fixture.origin+'/sign-in');const credentials=fixture.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).press('Enter');await expect(page.getByRole('status')).toContainText('Signed in');
    await page.goto(fixture.origin+settings);const setup=page.getByRole('region',{name:'Fictional Calendar setup'});
    if(engine===chromium){await setup.getByRole('button',{name:'Prepare fictional calendar',exact:true}).press('Enter');await setup.getByRole('button',{name:'Review shared event',exact:true}).press('Enter');for(const label of [/I reviewed the example event fields/,/I read how to check who can access/,/I read how to check notifications/])await setup.getByLabel(label).check();await setup.getByRole('button',{name:'Save Calendar consent',exact:true}).press('Enter');}
    await expect(setup.getByRole('region',{name:'Setup overview'}).getByText('Consent saved',{exact:true})).toBeVisible();
    const directory=page.getByRole('region',{name:'Appointment activity directory'}),status=directory.getByRole('status',{name:'Appointment activity status'}),rows=directory.getByRole('list',{name:'Appointments in chosen dates'}).getByRole('listitem');await expect(rows).toHaveCount(1);await expect(directory).toHaveAttribute('aria-busy','false');
    const jobId=fixture.calendarActivityJobIds[0],current=(await fixture.client.query("SELECT j.version::text,a.id AS appointment_id,a.sequence::text,to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS start_at,to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS end_at FROM crest.jobs j JOIN crest.appointments a ON (a.business_id,a.job_id,a.id)=(j.business_id,j.id,j.current_appointment_id) WHERE j.business_id=$1 AND j.id=$2",[fixture.business,jobId])).rows[0];assert(current);
    const post=request=>page.evaluate(async body=>{const proof=await(await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json(),response=await fetch('/api/business/scheduling/reschedule',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};},request);
    let release,forwarded;const gate=new Promise(resolve=>{release=resolve;}),hold=route=>{forwarded=(async()=>{held=true;await gate;await route.continue();})();return forwarded;};await page.route('**'+prefix+'job-status',hold);
    try{
     await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect.poll(()=>held).toBe(true);await expect(directory).toHaveAttribute('aria-busy','true');await expect(rows).toHaveCount(0);
     const later=value=>new Date(Date.parse(value)+15*60000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),start=later(current.start_at),end=later(current.end_at);
     const proposed=await post({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:fixture.bookingRequest.recoveryEpoch,jobId,expectedJobVersion:current.version,payload:{action:'propose',reason:'Synthetic customer requested a fifteen-minute change during Calendar review.',latestAppointmentId:current.appointment_id,expectedModeSequence:'1',appointment:{start_at:start,end_at:end,timezone:'UTC',local_start:start.slice(0,-1),local_end:end.slice(0,-1),start_offset_minutes:0,end_offset_minutes:0,travel_before_seconds:0,travel_after_seconds:0,contact_snapshot:fixture.bookingRequest.payload.appointment.contact_snapshot},customerConfirmation:null,conflictReview:null}});assert.equal(proposed.status,200,JSON.stringify(proposed.value));assert.equal(proposed.value.state,'committed');
     const confirmed=await post({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:fixture.bookingRequest.recoveryEpoch,jobId,expectedJobVersion:proposed.value.receipt.version,payload:{action:'confirm',reason:'Synthetic customer confirmed the changed visit.',latestAppointmentId:proposed.value.receipt.latestAppointmentId,expectedModeSequence:'1',appointment:null,customerConfirmation:{channel:'in_person',effectiveAt:new Date(Date.now()-1000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'),evidenceNote:'Customer confirmed this exact revised synthetic appointment.'},conflictReview:{expectedAppointmentIds:[],expectedUnknownTravel:false,unknownTravelReviewed:false,overrideReason:null}}});assert.equal(confirmed.status,200,JSON.stringify(confirmed.value));assert.equal(confirmed.value.state,'committed');assert.equal(BigInt(confirmed.value.receipt.appointmentSequence),BigInt(current.sequence)+2n);
    }finally{release();await forwarded;await page.unroute('**'+prefix+'job-status',hold);}
    await expect(status).toContainText('Appointment or access details changed.');await expect(rows).toHaveCount(0);await expect(page.getByRole('region',{name:'Saved appointment sync'})).toHaveCount(0);
    const facts=async()=>{const result={};for(const table of ['jobs','appointments','google_calendar_outbox','google_calendar_dispatch_sends','google_calendar_dispatch_results'])result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;result.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return result;},afterChange=await facts();
    await page.screenshot({path:'.local/review/settings-calendar-changed-'+engine.name()+'-390.png',fullPage:true});await directory.getByRole('button',{name:'Reload activity'}).press('Enter');await expect(rows).toHaveCount(1);await expect(directory).toHaveAttribute('aria-busy','false');await expect(rows.locator('time')).toHaveAttribute('datetime',new Date(Date.parse(current.start_at)+15*60000).toISOString().replace(/\.(\d{3})Z$/,'.$1000Z'));assert.deepEqual(await facts(),afterChange);
   }catch(error){const state=diagnosticPage?await diagnosticPage.evaluate(()=>({message:document.querySelector('[aria-label="Appointment activity status"]')?.textContent??null,busy:document.querySelector('[aria-label="Appointment activity directory"]')?.getAttribute('aria-busy')??null,reloadDisabled:document.querySelector('button[aria-label="Reload activity"]')?.disabled??null,visibility:document.visibilityState})).catch(()=>({unavailable:true})):{unavailable:true};t.diagnostic('Calendar appointment-change failure '+JSON.stringify({engine:engine.name(),held,observations,state,provider:fixture.authDiagnostics()}));try{await diagnosticPage?.screenshot({path:'.local/review/settings-calendar-change-failure-'+engine.name()+'.png',fullPage:true});}catch{/* Keep the original failure if optional capture fails. */}throw error;}finally{await browser.close();}
  }
 }finally{try{await fixture?.close();}finally{if(previous===undefined)delete process.env.CREST_TEST_DATABASE_URL;else process.env.CREST_TEST_DATABASE_URL=previous;await cluster?.close();}}
});

for (const automatic of [false,true]) test('signed-in Calendar preserves consent and ' + (automatic ? 'shares selected details automatically' : 'leaves a booking pending by default'), { timeout: 240000 }, async t => {
  const optional=automatic;
  const expectedStatus=automatic ? 'The current appointment is synced to the fictional calendar.' : 'A Calendar update is waiting.';
  const previous = process.env.CREST_TEST_DATABASE_URL;
  const cluster = previous ? null : await recoveryCluster();
  if (cluster) process.env.CREST_TEST_DATABASE_URL = cluster.testDatabaseUrl;
  let fixture;
  try {
    fixture = await sourceExportBrowserFixture({ product: true, workspace: true, catalog: true, quotes: true, quoteReview: true,
      quoteCommercial: true, scheduling: true, googleCalendar: true, googleCalendarAutomatic: automatic });
    const directory = new URL('../../.local/review/', import.meta.url);
    await mkdir(directory, { recursive: true });
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      let diagnosticPage,phase='setup';const failures=[];
      const admissionUsage=async()=>{try{return(await fixture.client.query("SELECT a.bucket,count(*) FILTER (WHERE a.admitted_at>clock_timestamp()-interval '1 minute')::int AS recent FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id WHERE s.actor_id=$1 GROUP BY a.session_id,a.bucket ORDER BY recent DESC",[fixture.actor])).rows;}catch{return[{unavailable:true}];}};
      try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 900 } });
        const page = await context.newPage();
        diagnosticPage=page;
        page.on('response',response=>{const path=new URL(response.url()).pathname;if(response.status()>=400&&(path.startsWith('/api/business/')||path==='/api/auth/session')){if(failures.length===32)failures.shift();failures.push({phase,path,status:response.status()});}});
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(20000);
        const crossOrigin = [];
        page.on('request', request => {
          if (!request.url().startsWith(fixture.origin + '/')) crossOrigin.push(new URL(request.url()).origin);
        });
        await page.goto(fixture.origin + '/settings');
        await expect(page.getByRole('link', { name: 'Google Calendar setup' })).toHaveCount(0);
        const denied = await page.request.post(fixture.origin + prefix + 'setup-state', { data: {} });
        assert.equal(denied.status(), 400);
        assert.deepEqual(Object.keys(await denied.json()), ['error']);
        await page.goto(fixture.origin + '/sign-in');
        const credentials = fixture.credentials();
        await page.getByLabel('Email', { exact: true }).fill(credentials.email);
        await page.getByLabel('Password', { exact: true }).fill(credentials.password);
        await page.getByLabel('Authenticator code', { exact: true }).fill(credentials.code);
        await page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
        await expect(page.getByRole('status')).toContainText('Signed in');
        await page.goto(fixture.origin + '/settings');
        await reviewBusinessSettingsIndex(page,{label:'calendar-'+(automatic?'automatic':'default')+'-'+engine.name(),finance:false,calendar:true});
        await page.getByRole('link', { name: 'Google Calendar setup' }).press('Enter');
        await expect(page).toHaveURL(fixture.origin + settings);
        const setup = page.getByRole('region', { name: 'Fictional Calendar setup' });
        const overview = setup.getByRole('region', { name: 'Setup overview' });
        await expect(overview.getByText('Simulated account', { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to Settings', exact: true })).toHaveAttribute('href','/settings');
        await expect(page.getByRole('link', { name: 'Open Schedule', exact: true })).toHaveAttribute('href','/schedule');
        if (engine === chromium) {
          const prepare = setup.getByRole('button', { name: 'Prepare fictional calendar' });
          const stateCount = () => fixture.client.query('SELECT count(*)::int AS n FROM crest.google_calendar_destinations WHERE business_id=$1',
            [fixture.business]).then(result => result.rows[0].n);
          await expect(prepare).toBeEnabled();
          await expect(overview.getByText('Waiting for preparation', { exact: true })).toBeVisible();
          assert.equal(await stateCount(), 0);
          await prepare.press('Enter');
          const panel = page.getByRole('region', { name: 'Google Calendar', exact: true });
          await expect(panel.getByRole('button', { name: 'Review shared event' })).toBeEnabled();
          await expect(overview.getByText('Crest Jobs', { exact: true })).toBeVisible();
          await expect(overview.getByText('Review required', { exact: true })).toBeVisible();
          assert.equal(await stateCount(), 1);
          await page.reload();
          if (optional) {
            await panel.getByText('Optional details to share', { exact: true }).press('Enter');
            for (const label of ['Client display name', 'Service label', 'Work address']) {
              const choice = panel.getByLabel(label, { exact: true });
              await expect(choice).not.toBeChecked();
              await choice.check();
            }
          }
          await panel.getByRole('button', { name: 'Review shared event' }).press('Enter');
          await expect(panel.getByRole('heading', { name: 'Review what Google receives', exact: true })).toBeFocused();
          await expect(panel.getByText(optional ? 'Crest job · Sample Detail · Sample Client' : 'Crest job', { exact: true })).toBeVisible();
          await expect(panel.getByText('calendar-owner@example.test', { exact: true })).toBeVisible();
          await expect(panel.getByText('Example location')).toHaveCount(optional ? 1 : 0);
          for (const width of [360, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const axe = await new AxeBuilder({ page }).analyze();
            assert.deepEqual(axe.violations.map(item => item.id), []);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
            await page.screenshot({ path: fileURLToPath(new URL((optional ? 'settings-calendar-disclosure-' : 'settings-calendar-default-disclosure-') + engine.name() + '-' + width + '.png', directory)), fullPage: true });
          }
          await panel.getByLabel(/I reviewed the example event fields/).check();
          await panel.getByLabel(/I read how to check who can access/).check();
          await panel.getByLabel(/I read how to check notifications/).check();
          let responseStatus;
          await page.route('**' + prefix + 'consent/confirm', async route => {
            const response = await route.fetch();
            responseStatus = response.status();
            await route.abort();
          }, { times: 1 });
          await panel.getByRole('button', { name: 'Save Calendar consent' }).press('Enter');
          await expect(panel.getByRole('status')).toContainText('could not confirm the save');
          assert.equal(responseStatus, 200);
          await page.reload();
          await panel.getByRole('button', { name: 'Check save status' }).press('Enter');
          await expect(panel.getByRole('status')).toContainText('consent was saved');
          await expect(overview.getByText('Consent saved', { exact: true })).toBeVisible();
          assert.equal(await page.evaluate(key => sessionStorage.getItem(key), referenceKey), null);
          const consent = await fixture.client.query('SELECT state,client_name,service_label,work_address FROM crest.google_calendar_consents WHERE business_id=$1',
            [fixture.business]);
          assert.deepEqual(consent.rows, [{ state: 'active', client_name: optional, service_label: optional, work_address: optional }]);
          const booking = Object.fromEntries(Object.entries(structuredClone(fixture.bookingRequest)).filter(([key]) => key !== 'businessId'));
          booking.payload.workLocation.instructions = 'Private calendar entry instructions';
          const saved = await page.evaluate(async bookingRequest => {
            const session = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
            const proof = await session.json();
            const response = await fetch('/api/business/scheduling/book', { method: 'POST',
              headers: { 'content-type': 'application/json', 'x-crest-csrf': proof.csrfToken }, body: JSON.stringify(bookingRequest) });
            return { status: response.status, result: await response.json() };
          }, booking);
          assert.equal(saved.status, 200, JSON.stringify(saved.result));
          assert.equal(saved.result.state, 'committed');
        } else {
          await expect(setup.getByText('Calendar consent is saved.', { exact: true })).toBeVisible();
          await expect(setup.getByRole('button', { name: 'Prepare fictional calendar' })).toHaveCount(0);
          await page.reload();
          await expect(setup.getByText('Calendar consent is saved.', { exact: true })).toBeVisible();
        }
        const job = fixture.bookingRequest.jobId;
        phase='selected_activity';
        if (automatic) await expect.poll(async () => (await fixture.client.query(
          "SELECT count(*)::int AS count FROM crest.google_calendar_dispatch_results WHERE business_id=$1 AND outcome='published' AND source_current",
          [fixture.business])).rows[0].count).toBe(1);
        await page.goto(fixture.origin + '/schedule?job=' + job);
        const link = page.getByRole('link', { name: 'Calendar sync status', exact: true });
        await expect(link).toHaveAttribute('href', settings + '?job=' + job);
        await link.press('Enter');
        const sync = page.getByRole('region', { name: 'Saved appointment sync' });
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        const currentUrl=new URL(page.url());assert.equal(currentUrl.origin,fixture.origin);assert.equal(currentUrl.pathname,settings);assert.equal(currentUrl.searchParams.get('job'),job);
        const activityDirectory=page.getByRole('region',{name:'Appointment activity directory',includeHidden:true});
        await expect(activityDirectory).toHaveAttribute('aria-busy','false');
        const beforeReturn=[];const observeReturn=request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/business/'))beforeReturn.push(request.method()+' '+path);};page.on('request',observeReturn);
        try{
          await page.getByRole('button',{name:'Back to appointment activity',exact:true}).press('Enter');
          await expect(activityDirectory).toBeVisible();await expect(sync).toHaveCount(0);
          await expect(activityDirectory.getByRole('heading',{name:'Appointments in range'})).toBeFocused();
          assert.deepEqual(beforeReturn,[],'returning to the mounted directory must not reload business records');
        }finally{page.off('request',observeReturn);}
        const [{day}]=(await fixture.client.query("SELECT to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day FROM crest.jobs j JOIN crest.appointments a ON (a.business_id,a.job_id,a.id)=(j.business_id,j.id,j.current_appointment_id) WHERE j.business_id=$1 AND j.id=$2",[fixture.business,job])).rows;
        const around=offset=>new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10),from=around(-1),through=around(1);
        const dateDisclosure=activityDirectory.locator('.calendar-date-disclosure'),datesToggle=dateDisclosure.locator('summary');
        await datesToggle.press('Enter');await expect(dateDisclosure).toHaveAttribute('open','');
        await activityDirectory.getByLabel('From date',{exact:true}).fill(from);await activityDirectory.getByLabel('Through date',{exact:true}).fill(through);
        await activityDirectory.getByRole('button',{name:'Load dates',exact:true}).press('Enter');
        await expect(activityDirectory).toHaveAttribute('aria-busy','false');
        await expect(activityDirectory.getByRole('status',{name:'Appointment activity status'})).toContainText('1 appointment loaded.');
        await expect(dateDisclosure).not.toHaveAttribute('open','');
        const activityLink=activityDirectory.locator('a[href*="job='+job+'"]');await expect(activityLink).toHaveCount(1);
        for(const width of [360,390,768,1100,1440]){
          await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});
          assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:fileURLToPath(new URL('settings-calendar-activity-'+(automatic?'automatic-':'pending-')+engine.name()+'-'+width+'.png',directory)),fullPage:true});
          await datesToggle.press('Enter');await expect(dateDisclosure).toHaveAttribute('open','');
          const control=await activityDirectory.getByLabel('From date',{exact:true}).evaluate(element=>({size:parseFloat(getComputedStyle(element).fontSize),height:element.getBoundingClientRect().height}));assert(control.size>=16&&control.height>=44);
          assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:fileURLToPath(new URL('settings-calendar-activity-dates-'+(automatic?'automatic-':'pending-')+engine.name()+'-'+width+'.png',directory)),fullPage:true});
          await datesToggle.press('Enter');await expect(dateDisclosure).not.toHaveAttribute('open','');await expect(datesToggle).toBeFocused();
        }
        await page.setViewportSize({width:390,height:900});
        const facts=async()=>{const rows={};for(const table of ['jobs','appointments','google_calendar_outbox','google_calendar_dispatch_sends','google_calendar_dispatch_results'])rows[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;rows.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return rows;};
        const retained=await facts();await activityLink.press('Enter');await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        await expect(activityDirectory).toBeHidden();await expect(sync.getByRole('heading',{name:'Saved appointment sync'})).toBeFocused();
        const returns=[];const observe=request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/business/'))returns.push(request.method()+' '+path);};page.on('request',observe);
        try{
          await page.getByRole('button',{name:'Back to appointment activity',exact:true}).press('Enter');await expect(activityDirectory).toBeVisible();await expect(activityLink).toBeFocused();
          await expect(activityDirectory.getByLabel('From date',{exact:true})).toHaveValue(from);await expect(activityDirectory.getByLabel('Through date',{exact:true})).toHaveValue(through);assert.deepEqual(returns,[]);
        }finally{page.off('request',observe);}
        await page.goBack();await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        await page.goForward();await expect(activityDirectory).toBeVisible();await expect(activityLink).toBeFocused();
        await expect(activityDirectory.getByLabel('From date',{exact:true})).toHaveValue(from);await expect(activityDirectory.getByLabel('Through date',{exact:true})).toHaveValue(through);
        assert.deepEqual(await facts(),retained);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),referenceKey),null);
        await activityLink.press('Enter');await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        const fonts=await page.evaluate(async()=>{await document.fonts.ready;return {root:getComputedStyle(document.documentElement).fontFamily,body:getComputedStyle(document.body).fontFamily,regular:document.fonts.check('400 16px "IBM Plex Sans"'),semibold:document.fonts.check('600 16px "IBM Plex Sans"'),faces:[...document.fonts].map(face=>({family:face.family,weight:face.weight,status:face.status}))};});
        await writeFile(fileURLToPath(new URL('settings-calendar-fonts-'+(automatic?'automatic-':'pending-')+engine.name()+'.json',directory)),JSON.stringify(fonts,null,2));
        assert(fonts.root.includes('IBM Plex Sans'));assert(fonts.body.includes('IBM Plex Sans'));assert(fonts.regular&&fonts.semibold,'the actual requested self-hosted body font weights must be loaded before visual acceptance');
        const activity=sync.getByRole('list',{name:'Appointment sync activity'});
        await expect(activity.getByRole('listitem')).toHaveCount(1);
        await expect(activity.getByRole('heading',{name:'Selected appointment'})).toBeVisible();
        await expect(activity.locator('.calendar-activity-state')).toHaveText(automatic?'Synced · fictional':'Waiting');
        await expect(sync).toContainText('Fictional calendar · No events are sent to Google.');
        await expect(sync.getByRole('link', { name: 'Open saved job' })).toHaveAttribute('href', '/schedule?job=' + job);
        await expect(sync.getByText('Last successful sync', { exact: true })).toHaveCount(automatic ? 1 : 0);
        if (automatic) {
          const facts=async()=>{const result={};for(const table of ['jobs','google_calendar_consents','google_calendar_dispatch_results','google_calendar_dispatch_sends'])result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;result.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return result;};
          const before=await facts(),requests=[];const observe=request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/business/'))requests.push(request.method()+' '+path);};page.on('request',observe);
          const evidence=sync.locator('.calendar-sync-evidence'),toggle=evidence.locator('summary');
          try{
          await expect(evidence).not.toHaveAttribute('open','');
          await expect(sync.locator('time')).toBeHidden();
          await toggle.press('Enter');await expect(evidence).toHaveAttribute('open','');
          await expect(toggle).toBeFocused();
          await expect(sync.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
          await expect(sync.locator('time')).toBeVisible();
          await expect(sync.getByText('1 of 1', { exact: true })).toBeVisible();
          await page.screenshot({path:fileURLToPath(new URL('settings-calendar-evidence-'+engine.name()+'-390.png',directory)),fullPage:true});
          await toggle.press('Enter');await expect(sync.locator('time')).toBeHidden();await expect(toggle).toBeFocused();
          assert.deepEqual(await facts(),before);assert.deepEqual(requests,[]);
          }finally{page.off('request',observe);}
        }
        for (const width of [360, 390, 768, 1100, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.evaluate(async()=>{await document.fonts.ready;});
          const axe = await new AxeBuilder({ page }).analyze();
          assert.deepEqual(axe.violations.map(item => item.id), []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
          const screenshotPrefix = automatic ? 'settings-calendar-synced-' : 'settings-calendar-pending-';
          await page.screenshot({ path: fileURLToPath(new URL(screenshotPrefix + engine.name() + '-' + width + '.png', directory)), fullPage: true });
        }
        await page.setViewportSize({width:390,height:900});
        let releaseRead,forwarded,heldRead=false;const readGate=new Promise(resolve=>{releaseRead=resolve;});
        const holdRead=route=>{forwarded=(async()=>{heldRead=true;await readGate;await route.continue();})();return forwarded;};
        await page.route('**'+prefix+'job-status',holdRead);
        try{
          await sync.getByRole('button',{name:'Check Calendar status'}).press('Enter');
          await expect.poll(()=>heldRead).toBe(true);
          await expect(sync).toHaveAttribute('aria-busy','true');
          await expect(activity.locator('.calendar-activity-state')).toHaveText('Checking');
          await expect(sync.getByRole('button',{name:'Check Calendar status'})).toBeDisabled();
          await expect(sync.locator('time')).toHaveCount(0);
          await page.screenshot({path:fileURLToPath(new URL('settings-calendar-checking-'+(automatic?'automatic-':'pending-')+engine.name()+'-390.png',directory)),fullPage:true});
        }finally{releaseRead();await forwarded;await page.unroute('**'+prefix+'job-status',holdRead);}
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        await page.route('**' + prefix + 'job-status', route => route.abort(), { times: 1 });
        await sync.getByRole('button', { name: 'Check Calendar status' }).press('Enter');
        await expect(sync.getByRole('status')).toContainText('could not verify');
        await expect(activity.locator('.calendar-activity-state')).toHaveText('Check failed');
        await expect(sync.locator('time')).toHaveCount(0);
        await expect(sync.locator('.calendar-sync-evidence')).toHaveCount(0);
        for(const width of [390,1440]){
          await page.setViewportSize({width,height:900});
          assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:fileURLToPath(new URL('settings-calendar-failed-'+(automatic?'automatic-':'pending-')+engine.name()+'-'+width+'.png',directory)),fullPage:true});
        }
        await sync.getByRole('button', { name: 'Check Calendar status' }).press('Enter');
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        phase='final_reload';
        t.diagnostic('Calendar pre-reload admission '+JSON.stringify({engine:engine.name(),automatic,admissions:await admissionUsage()}));
        await page.reload();
        await expect(sync.getByRole('status')).toHaveText(expectedStatus,{timeout:15000});
        assert.deepEqual(crossOrigin, []);
      } catch(error){
        const admissions=await admissionUsage();
        const state=diagnosticPage?await diagnosticPage.evaluate(()=>({selectedRegions:document.querySelectorAll('[aria-label="Saved appointment sync"]').length,activityMessage:document.querySelector('[aria-label="Appointment activity status"]')?.textContent??null,setupMessage:document.querySelector('.settings-feedback')?.textContent??null})).catch(()=>({unavailable:true})):{unavailable:true};
        t.diagnostic('Calendar failure evidence '+JSON.stringify({engine:engine.name(),automatic,phase,failures,admissions,state,provider:fixture.authDiagnostics()}));throw error;
      } finally {
        await browser.close();
      }
    }
    const admissions = (await fixture.client.query("SELECT count(*)::int AS count FROM crest.google_calendar_request_admissions WHERE business_id=$1 AND kind='insert'",
      [fixture.business])).rows[0].count;
    assert.equal(admissions, automatic ? 1 : 0);
    if (automatic) {
      const [{ body }] = (await fixture.client.query(
        "SELECT request_body::jsonb AS body FROM crest.google_calendar_dispatch_sends WHERE business_id=$1 AND action='insert'", [fixture.business])).rows;
      assert.equal(body.summary, optional ? 'Crest job · Fictional Calendar interior · Synthetic lifecycle customer' : 'Crest job');
      assert.equal(body.location, optional ? 'Synthetic workshop, 123 Example Lane, Indianapolis' : '');
      for (const text of ['Private calendar entry instructions', 'Private calendar fixture scope', 'Private calendar catalog guidance',
        'Synthetic lifecycle sedan', 'Synthetic interior', '25000']) assert(!JSON.stringify(body).includes(text), text);
    }
  } finally {
    try { await fixture?.close(); }
    finally {
      if (previous === undefined) delete process.env.CREST_TEST_DATABASE_URL;
      else process.env.CREST_TEST_DATABASE_URL = previous;
      await cluster?.close();
    }
  }
});
