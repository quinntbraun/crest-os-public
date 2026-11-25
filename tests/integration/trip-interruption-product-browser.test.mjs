import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {observeWorkReads} from '../support/work-read-diagnostic.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' actual trip stop, cancellation and confirmed replacement',{timeout:300000},async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,additionalSchedulingAgreement:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobMileage:true});
 let browser,diagnostic;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page=await context.newPage();diagnostic=observeWorkReads(page,f,name+' trip interruption');
  page.setDefaultTimeout(20000);
  const status=page.locator('.job-change-status'),route='**/api/business/scheduling/interrupt';
  const work=id=>f.origin+'/schedule/work?job='+id;
  const schedule=id=>f.origin+'/schedule?job='+id;
  await page.goto(work(f.bookingRequest.jobId));
  await page.getByRole('link',{name:'Sign in to review work status'}).click();
  const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  async function depart(input){
   const booked=await page.evaluate(async input=>{
    const init={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
    const {csrfToken}=await (await fetch('/api/auth/session',init)).json();
    const body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId'));
    const response=await fetch('/api/business/scheduling/book',{...init,headers:{...init.headers,'x-crest-csrf':csrfToken},body:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
   },input);
   assert.equal(booked.status,200);assert.equal(booked.value.state,'committed');
   await page.goto(work(input.jobId));
   await page.getByLabel('Vehicle you are driving',{exact:true}).selectOption(f.fieldVehicleId);
   await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic equipment base');
   await page.getByRole('button',{name:'Record departure',exact:true}).click();
   await expect(page.getByText('Confirmed saved version 2.',{exact:true})).toBeVisible();
   await page.goto(work(input.jobId));
   await page.getByText('More actions',{exact:true}).click();await page.getByRole('link',{name:'Interrupt this trip'}).click();
   await expect(status).toHaveText('Saved open trip loaded.');
  }
  const sourceFacts=()=>Promise.all(['jobs','current_travel_legs'].map(async table=>(await f.client.query('SELECT to_jsonb(v)::text AS value FROM crest.'+table+' v WHERE business_id=$1 ORDER BY to_jsonb(v)::text',[f.business])).rows));
  async function captureReadOnly(stage){
   await mkdir('.local/review',{recursive:true});
   for(const width of [320,390,768,1440,1920]){
    await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
    await page.screenshot({path:'.local/review/field-interruption-'+stage+'-'+name+'-'+width+'.png',fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
  }
  async function capture(stage){
   await mkdir('.local/review',{recursive:true});
   for(const width of [320,360,390,768,1440,1920]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const reason=page.getByLabel('Reason for stopping',{exact:true});
    assert(await reason.evaluate(field=>{
     const label=field.labels?.[0];
     return !!label&&field.getBoundingClientRect().top-label.getBoundingClientRect().bottom>=4;
    }),'the reason label must clear the focus outline');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
    await page.screenshot({path:'.local/review/field-interruption-'+stage+'-'+name+'-'+width+'.png',fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
  }
  const first=f.bookingRequest,second=f.additionalBookingRequest;
  await depart(first);
  const beforeChoice=await sourceFacts(),choiceRequests=f.requests.length;
  await page.getByLabel('What happened?',{exact:true}).selectOption('reschedule');
  await expect(page.getByRole('region',{name:'Interruption consequences',exact:true})).toContainText('replaces the reservation with the customer-confirmed visit time');
  await page.getByLabel('What happened?',{exact:true}).selectOption('cancel');
  await expect(page.getByRole('region',{name:'Interruption consequences',exact:true})).toContainText('cancels this visit');
  await page.getByRole('button',{name:'View visit details',exact:true}).click();
  await expect(page.locator('.field-visit-facts')).toContainText('Trip started');
  await page.getByRole('button',{name:'Hide visit details',exact:true}).click();
  assert.equal(f.requests.length,choiceRequests,'Changing choice and disclosure sends no API request');
  assert.deepEqual(await sourceFacts(),beforeChoice);
  await page.getByLabel('Actual stop location',{exact:true}).fill('Synthetic actual roadside stop');
  await page.getByLabel('Reason for stopping',{exact:true}).fill('Synthetic cancellation during travel');
  await page.getByLabel('Customer-communication status').selectOption('not_sent');
  await capture('cancel');
  let submits=0,receivedStatus=0;
  await page.route(route,async intercepted=>{
   submits++;
   const response=await intercepted.fetch();
   receivedStatus=response.status();
   if(name==='webkit'&&receivedStatus===200)await intercepted.abort('failed');
   else await intercepted.fulfill({response});
  });
  await page.getByRole('button',{name:'End trip and cancel visit',exact:true}).click();
  await expect.poll(()=>receivedStatus).toBe(200);
  if(name==='webkit'){
   await expect(status).toContainText('save outcome is unknown');
   const pending=await page.evaluate(()=>sessionStorage.getItem('crest.trip-interruption.pending-reference.v1'));
   assert(pending&&!pending.includes('Synthetic actual roadside stop'));
   const uncertainFacts=await sourceFacts(),uncertainRequests=f.requests.length;await captureReadOnly('uncertain');
   assert.deepEqual(await sourceFacts(),uncertainFacts);assert.equal(f.requests.length,uncertainRequests);
   await page.reload();
  }
  await expect(status).toContainText('Trip interruption saved.');
  assert.equal(submits,1);
  await page.unroute(route);
  await page.goto(schedule(first.jobId));
  await expect(page.locator('.schedule-status')).toHaveText('Saved job loaded at version 3.');
  await page.getByText('Saved history · version 3',{exact:true}).click();
  await expect(page.getByText('Trip interrupted and visit cancelled',{exact:true})).toBeVisible();

  second.expectedModeSequence='1';
  await depart(second);
  await page.getByLabel('What happened?',{exact:true}).selectOption('reschedule');
  await page.getByLabel('Actual stop location',{exact:true}).fill('Synthetic second actual stop');
  await page.getByLabel('Reason for stopping',{exact:true}).fill('Synthetic customer moved the visit');
  const zone=second.payload.appointment.timezone;
  const clock=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,dateStyle:'short',timeStyle:'short',hourCycle:'h23'});
  const wall=offset=>clock.format(new Date(Date.now()+offset)).replace(' ','T');
  await page.getByLabel('Replacement starts',{exact:true}).fill(wall(48*60*60000));
  await page.getByLabel('Replacement ends',{exact:true}).fill(wall(49*60*60000));
  await page.getByLabel('Actual confirmation or communication channel').selectOption('phone');
  await page.getByLabel('When the confirmation or communication occurred',{exact:true}).fill(wall(-10*60000));
  await page.getByLabel('Confirmation or communication evidence',{exact:true}).fill('Synthetic customer confirmed by phone.');
  await page.getByRole('button',{name:'Review schedule',exact:true}).click();
  await expect(page.getByText('Current schedule review loaded. Saving rechecks reservations.',{exact:true})).toBeVisible();
  const unknown=page.getByRole('checkbox',{name:'I reviewed the schedule and the unknown travel time.'});
  if(await unknown.isVisible())await unknown.check();
  await capture('replace');
  await page.getByRole('button',{name:'End trip and save replacement',exact:true}).click();
  await expect(status).toContainText('Trip interruption saved.');
  await page.goto(schedule(second.jobId));
  await expect(page.locator('.schedule-status')).toHaveText('Saved job loaded at version 3.');
  await page.getByText('Saved history · version 3',{exact:true}).click();
  await expect(page.getByText('Trip interrupted and visit rescheduled',{exact:true})).toBeVisible();
  const rows=(await f.client.query(
   "SELECT j.state,j.first_work_at,t.state trip_state,t.destination_snapshot->>'locationText' AS stop, a.confirmation_state FROM crest.jobs j JOIN crest.current_travel_legs t ON t.job_context_id=j.id JOIN crest.appointments a ON a.id=j.current_appointment_id WHERE j.business_id=$1 ORDER BY j.state",[f.business])).rows;
  assert.deepEqual(rows,[
   {state:'cancelled',first_work_at:null,trip_state:'cancelled',stop:'Synthetic actual roadside stop',confirmation_state:'cancelled'},
   {state:'scheduled',first_work_at:null,trip_state:'cancelled',stop:'Synthetic second actual stop',confirmation_state:'confirmed'}
  ]);

  // Exercise a genuine arrival, then prove interruption navigation is read-only.
  const cookie=(await context.cookies(f.origin)).find(row=>row.name==='__Host-crest_session');assert(cookie);
  const hash=createHash('sha256').update(cookie.value,'ascii').digest();let admissions;
  try{admissions=(await f.client.query("SELECT greatest(0,ceil(extract(epoch FROM a.admitted_at+interval '1 minute'-clock_timestamp())*1000))::int AS wait_ms FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id WHERE s.token_hash=$1 AND a.bucket='ordinary' AND a.admitted_at>clock_timestamp()-interval '1 minute' ORDER BY a.admitted_at",[hash])).rows;}finally{hash.fill(0);}
  assert(admissions.length<=120);const release=admissions[admissions.length+40-120-1];
  if(release){assert(Number.isInteger(release.wait_ms)&&release.wait_ms>=0&&release.wait_ms<=60000);await delay(release.wait_ms+100);}
  await page.goto(work(second.jobId));
  await page.getByLabel('Vehicle you are driving',{exact:true}).selectOption(f.fieldVehicleId);
  await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic replacement departure');
  await page.getByRole('button',{name:'Record departure',exact:true}).click();
  await expect(page.getByText('Confirmed saved version 4.',{exact:true})).toBeVisible();
  await page.goto(work(second.jobId));await page.getByRole('button',{name:'Record arrival and start work',exact:true}).click();
  await expect(page.getByText('Confirmed saved version 5.',{exact:true})).toBeVisible();
  const arrivedFacts=await sourceFacts(),interruptions=f.requests.filter(r=>r.path==='/api/business/scheduling/interrupt').length;
  await page.goto(f.origin+'/schedule/work/interrupt?job='+second.jobId);
  await expect(status).toHaveText('Open an en-route Mobile job to record a trip interruption.');
  await expect(page.getByLabel('What happened?',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Open saved job',exact:true})).toBeVisible();
  await captureReadOnly('already-arrived');
  assert.equal(f.requests.filter(r=>r.path==='/api/business/scheduling/interrupt').length,interruptions);
  assert.deepEqual(await sourceFacts(),arrivedFacts);
  const arrived=(await f.client.query("SELECT state,version::text,first_work_at IS NOT NULL AS work_started,(SELECT count(*)::int FROM crest.current_travel_legs t WHERE t.job_context_id=j.id AND t.state='open') AS open_trips FROM crest.jobs j WHERE id=$1",[second.jobId])).rows;
  assert.deepEqual(arrived,[{state:'in_progress',version:'5',work_started:true,open_trips:0}]);
 }catch(error){await diagnostic?.();throw error;}finally{await browser?.close();await f.close();}
});
