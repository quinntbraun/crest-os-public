import {captureSavedJob} from '../support/saved-job-layout.mjs';
// Genuine MFA and compiled Next/Node with registered saved-visit history. Native command setup is
// explicit test data; this does not claim the unfinished booking form works.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' populated overlapping planner visual baseline and exact phone return',{timeout:240000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,googleCalendar:true,calendarActivityBookings:6,calendarActivityOverlap:true});let browser;
 try{
  assert.equal(fixture.calendarActivityJobIds.length,6);
  assert.equal((await fixture.client.query('SELECT count(*)::int AS count FROM crest.schedule_overrides WHERE business_id=$1',[fixture.business])).rows[0].count,1);
  assert.equal((await fixture.client.query('SELECT count(*)::int AS count FROM crest.schedule_reservations a JOIN crest.schedule_reservations b ON a.business_id=b.business_id AND a.operator_actor_id=b.operator_actor_id AND a.id<b.id AND a.blocked_interval && b.blocked_interval WHERE a.business_id=$1',[fixture.business])).rows[0].count,1);
  const facts=async()=>{const out={};for(const table of ['jobs','appointments','schedule_reservations','schedule_overrides','schedule_override_conflicts'])out[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;out.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return out;},before=await facts();
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);await signIn(page,fixture);await page.goto(fixture.origin+'/schedule');await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');
  const custom=page.locator('.schedule-custom-range');if(await custom.getAttribute('open')===null)await custom.locator('summary').press('Enter');await page.getByLabel('From date',{exact:true}).fill('2026-11-03');await page.getByLabel('Through date',{exact:true}).fill('2026-11-03');await page.getByRole('button',{name:'Load saved schedule',exact:true}).press('Enter');
  const schedule=page.getByRole('region',{name:'Saved schedule',exact:true}),agenda=page.getByRole('region',{name:'Jobs in selected dates',exact:true}),calendar=page.getByRole('region',{name:'Saved work calendar',exact:true});await expect(agenda.getByRole('listitem')).toHaveCount(6);await expect(schedule).toHaveAttribute('aria-busy','false');await page.getByRole('button',{name:'Calendar',exact:true}).press('Enter');await expect(calendar).toBeVisible();await mkdir('.local/review',{recursive:true});
  async function capture(label){for(const width of [360,390,768,1100,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width>=1100){const nav=await calendar.boundingBox(),content=await(label==='selected'?page.getByRole('region',{name:'Job review',exact:true}):agenda).boundingBox();assert(nav&&content&&content.x>=nav.x+nav.width&&Math.abs(content.y-nav.y)<8,'desktop work starts beside the compact calendar');if(label!=='selected'){await custom.locator('summary').press('Enter');for(const label of ['From date','Through date']){const input=await page.getByLabel(label,{exact:true}).evaluate(element=>({size:parseFloat(getComputedStyle(element).fontSize),height:element.getBoundingClientRect().height}));assert(input.size>=16&&input.height>=44);}assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.local/review/planner-populated-'+label+'-dates-'+name+'-'+width+'.png',fullPage:true});await custom.locator('summary').press('Enter');}}
   await page.screenshot({path:'.local/review/planner-populated-'+label+'-'+name+'-'+width+'.png',fullPage:true});await page.screenshot({path:'.local/review/planner-populated-'+label+'-viewport-'+name+'-'+width+'.png'});}}
  for(const [mode,label]of [['Day','day'],['7 days','week'],['Month','month']]){
   const read=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/business/scheduling/list'&&response.status()===200);await calendar.getByRole('button',{name:mode,exact:true}).press('Enter');await read;await expect(schedule).toHaveAttribute('aria-busy','false');await expect(agenda.getByRole('listitem')).toHaveCount(6);await expect(calendar.getByRole('button',{name:mode,exact:true})).toHaveAttribute('aria-pressed','true');if(page.viewportSize().width>=1100)await expect(calendar.getByRole('button',{name:mode,exact:true})).toBeFocused();await expect(agenda.locator('.schedule-time-overlap')).toHaveCount(2);await expect(agenda.locator('.schedule-overlap-note')).toContainText('2 loaded visits');await expect(page.getByRole('region',{name:'Job review',exact:true})).toHaveCount(0);await expect(calendar.getByRole('button',{name:/View Tuesday, November 3, 2026, 6 loaded visits/})).toHaveCount(1);await capture(label);
  }
  await page.setViewportSize({width:390,height:900});const target=agenda.getByRole('listitem').nth(4).getByRole('button');await target.scrollIntoViewIfNeeded();const savedScroll=await page.evaluate(()=>window.scrollY),from=await page.getByLabel('From date',{exact:true}).inputValue(),through=await page.getByLabel('Through date',{exact:true}).inputValue();await target.press('Enter');const review=page.getByRole('region',{name:'Job review',exact:true});await expect(review.getByRole('article',{name:'Saved job'})).toBeVisible();await expect(schedule).toHaveAttribute('aria-busy','false');await expect(agenda).toBeHidden();await expect(review.getByRole('link',{name:'Open customer record',exact:true})).toHaveAttribute('href',new RegExp('[?&]job='+fixture.calendarActivityJobIds[4]+'(?:&|$)'));await capture('selected');await captureSavedJob(page,name,'planner-selected');await page.setViewportSize({width:390,height:900});
  const requests=[],observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};page.on('request',observe);try{await review.getByRole('button',{name:'Back to agenda',exact:true}).press('Enter');await expect(target).toBeFocused();await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(savedScroll);assert.deepEqual(requests,[]);}finally{page.off('request',observe);}
  await expect(page.getByLabel('From date',{exact:true})).toHaveValue(from);await expect(page.getByLabel('Through date',{exact:true})).toHaveValue(through);await expect(calendar.getByRole('button',{name:'Month',exact:true})).toHaveAttribute('aria-pressed','true');assert.deepEqual(await facts(),before);
 }finally{await browser?.close();await fixture.close();}
});
async function signIn(page,f,freshAfter=0){
 await page.goto(f.origin+'/schedule');await expect(page.locator('.schedule-status')).toHaveText('Sign in to view your schedule.');await page.getByRole('link',{name:'Sign in to view your schedule',exact:true}).click();
 const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 // Use a fresh code after the fixture's own authenticated seed session.
 const remaining=30000-Date.now()%30000;
 const codeReadyAt=Math.max(f.nextBrowserCodeAt,freshAfter,remaining<6000?Date.now()+remaining:0);
 if(codeReadyAt>=Date.now())await delay(codeReadyAt-Date.now()+250);
 const nextCodeAt=(Math.floor(Date.now()/30000)+1)*30000;
 await page.getByLabel('Authenticator code',{exact:true}).fill(f.credentials().code);
 const login=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/login');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 assert.equal((await login).status(),200,'Synthetic sign-in response');
 await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible({timeout:15000});
 return nextCodeAt;
}
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' genuine saved-job review, history retrieval, refresh and privacy',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,recordJobHistory:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  const nextCodeAt=await signIn(page,f);
  const booked=await page.evaluate(async input=>{
   const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!session.ok)return{status:session.status};const proof=await session.json(),{businessId,...body}=input;void businessId;
   const response=await fetch('/api/business/scheduling/book',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};
  },f.bookingRequest);assert.equal(booked.status,200);assert.equal(booked.value.state,'committed');
  await page.goto(f.origin+'/schedule');await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');
  async function capture(prefix){if(prefix==='schedule-month'&&name==='chromium'){const audit=await context.newCDPSession(page);try{await audit.send('DOM.enable');await audit.send('CSS.enable');const {root}=await audit.send('DOM.getDocument');const fonts=[];for(const selector of ['.calendar-heading h2','.calendar-days button span']){const {nodeId}=await audit.send('DOM.querySelector',{nodeId:root.nodeId,selector});const result=await audit.send('CSS.getPlatformFontsForNode',{nodeId});fonts.push(...result.fonts.map(font=>({family:font.familyName,name:font.postScriptName,custom:font.isCustomFont})));}console.log('Synthetic calendar rendered fonts '+JSON.stringify(fonts));assert(fonts.length>0&&fonts.every(font=>font.custom&&/^IBMPlexSans/.test(font.name)));}finally{await audit.detach();}}await mkdir('.local/review',{recursive:true});for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations.map(v=>({id:v.id,targets:v.nodes.map(node=>node.target)})),[]);if(await calendar.isVisible())for(const button of await calendar.locator('.calendar-days button').all()){const box=await button.boundingBox();assert(box&&box.width>=44&&box.height>=44,'phone calendar dates need44px targets');}await page.screenshot({path:'.local/review/'+prefix+'-'+name+'-'+width+'.png',fullPage:true});await page.screenshot({path:'.local/review/'+prefix+'-viewport-'+name+'-'+width+'.png'});}}
  async function search(pageToSearch=page){const custom=pageToSearch.locator('.schedule-custom-range');if(await custom.getAttribute('open')===null)await custom.locator('summary').click();await pageToSearch.getByLabel('From date',{exact:true}).fill('2026-11-03');await pageToSearch.getByLabel('Through date',{exact:true}).fill('2026-11-03');await pageToSearch.getByRole('button',{name:'Load saved schedule',exact:true}).click();await expect(pageToSearch.locator('.schedule-status')).toContainText('Saved schedule loaded.');}
  const calendar=page.getByRole('region',{name:'Saved work calendar',exact:true});
  const agenda=page.getByRole('region',{name:'Jobs in selected dates',exact:true});
  const calendarToggle=page.getByRole('button',{name:'Calendar',exact:true});
  await expect(agenda).toBeVisible();
  await expect(calendar).toBeHidden();
  await expect(calendarToggle).toHaveAttribute('aria-expanded','false');
  await search();
  await calendarToggle.press('Enter');
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button',{name:'Month',exact:true}).click();await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');await expect(calendar.getByRole('heading',{name:'November 2026',exact:true})).toBeVisible();const savedDay=calendar.getByRole('button',{name:'View Tuesday, November 3, 2026, 1 loaded visit',exact:true});await expect(savedDay).toBeVisible();await capture('schedule-month');
  const visitBadge=savedDay.locator('..').locator('.calendar-visit-count');
  await expect(visitBadge).toHaveText('1');
  await visitBadge.scrollIntoViewIfNeeded();
  assert.equal(await visitBadge.evaluate(badge=>{
   const rect=badge.getBoundingClientRect();
   return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('button')?.getAttribute('aria-label');
  }),'View Tuesday, November 3, 2026, 1 loaded visit','calendar count remains part of its date tap target');
  await page.setViewportSize({width:390,height:844});
  await savedDay.click();
  await expect(agenda).toContainText('Tuesday, November 3, 2026');
  await expect(calendar).toBeHidden();
  await expect(agenda.getByRole('heading',{name:'Scheduled work',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Next agenda period',exact:true}).click();
  await expect(agenda).toContainText('Wednesday, November 4, 2026');
  await expect(agenda).toContainText('No saved jobs in this range.');
  await page.getByRole('button',{name:'Previous agenda period',exact:true}).click();
  await expect(agenda).toContainText('Tuesday, November 3, 2026');
  await page.setViewportSize({width:1440,height:900});
  await expect(calendar.getByRole('button',{name:'Day',exact:true})).toHaveAttribute('aria-pressed','true');await calendar.getByRole('button',{name:'Next day',exact:true}).click();await expect(page.getByText('No saved jobs in this range.',{exact:true})).toBeVisible();await calendar.getByRole('button',{name:'Previous day',exact:true}).click();await expect(page.getByRole('button',{name:'Synthetic lifecycle customer · Scheduled · View job',exact:true})).toBeVisible();await page.getByRole('button',{name:'Synthetic lifecycle customer · Scheduled · View job',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeFocused();await expect(page.getByRole('listitem').filter({has:page.getByRole('button',{name:'Synthetic lifecycle customer · Scheduled · View job',exact:true})})).toHaveAttribute('aria-current','true');await expect(page.getByText('Synthetic workshop, 123 Example Lane, Indianapolis',{exact:true})).toBeVisible();await expect(page.getByText('No proposed time changes recorded.',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  const backToAgenda=page.getByRole('button',{name:'Back to agenda',exact:true});
  const visitRow=agenda.getByRole('button',{name:'Synthetic lifecycle customer · Scheduled · View job',exact:true});
  await expect(agenda).toBeHidden();
  await expect(backToAgenda).toBeVisible();
  await backToAgenda.press('Enter');
  await expect(agenda).toContainText('Tuesday, November 3, 2026');
  await expect(visitRow).toBeFocused();
  await expect(visitRow).toHaveAccessibleName('Synthetic lifecycle customer · Scheduled · View job');
  await expect(calendar).toBeHidden();
  await page.screenshot({path:'.local/review/schedule-agenda-'+name+'-390.png'});
  await page.evaluate(()=>window.scrollTo({top:110,behavior:'instant'}));
  const agendaScroll=await page.evaluate(()=>window.scrollY);
  assert(agendaScroll>0);
  await visitRow.press('Enter');
  await expect(backToAgenda).toBeFocused();
  await expect(agenda).toBeHidden();
  await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeInViewport();
  await page.screenshot({path:'.local/review/schedule-agenda-job-'+name+'-390.png'});
  await backToAgenda.press('Enter');
  await expect(visitRow).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(agendaScroll);
  await visitRow.press('Enter');
  await expect(backToAgenda).toBeFocused();
  await page.getByText('Saved history · version 1',{exact:true}).click();await expect(page.getByText('Job booked',{exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved history',exact:true}).focus();await page.keyboard.press('Enter');const download=await downloadEvent;assert.equal(await download.failure(),null);const files=unzipSync(await readFile(await download.path()));assert(Object.keys(files).some(file=>file.endsWith('.csv')));assert(Object.values(files).some(bytes=>strFromU8(bytes).includes('crest.confirmed-job-history.v1')));
  await capture('schedule');await captureSavedJob(page,name,'scheduled');
  if(name==='webkit')await page.setViewportSize({width:390,height:844});
  const jobId=booked.value.receipt.jobId;
  const linkedCustomer=(await f.client.query('SELECT customer_id FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,jobId])).rows[0].customer_id;
  const link=page.getByRole('article',{name:'Saved job',exact:true}).getByRole('link',{name:'Open customer record',exact:true});
  await expect(link).toHaveAttribute('href','/customers?customer='+linkedCustomer+'&job='+jobId);
  await link.focus();await page.keyboard.press('Enter');
  const editor=page.getByRole('form',{name:'Customer editor',exact:true});
  await expect(editor.getByRole('heading',{name:'Edit customer',exact:true})).toBeFocused();
  await expect(editor.getByLabel('Customer name',{exact:true})).toHaveValue('Synthetic lifecycle customer');
  const savedVisits=page.locator('.record-job-history');
  const visitsRoute='**/api/business/scheduling/record-jobs';
  const interruptVisits=route=>route.abort('failed');
  await page.route(visitsRoute,interruptVisits);
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Visits',exact:true}).click();
  await expect(savedVisits.getByRole('status')).toHaveText('Saved visits couldn’t be loaded.');
  await page.unroute(visitsRoute,interruptVisits);
  await savedVisits.getByRole('button',{name:'Retry saved visits',exact:true}).click();
  const savedVisit=savedVisits.getByRole('link',{name:/Open saved job for/});
  await expect(savedVisit).toHaveAttribute('href','/schedule?job='+jobId+'&from=customer');
  await expect(savedVisit).toBeFocused();
  await expect(savedVisits).toContainText('Synthetic lifecycle sedan');
  await page.keyboard.press('Enter');
  const customerVisitsLink=page.getByRole('link',{name:'Back to customer visits',exact:true});
  await expect(customerVisitsLink).toHaveAttribute('href','/customers?customer='+linkedCustomer+'&job='+jobId+'&view=visits');
  await customerVisitsLink.focus();await page.keyboard.press('Enter');
  await expect(savedVisits.locator('summary')).toBeFocused();
  await expect(savedVisit).toBeVisible();
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  const revisedName='Synthetic current customer name';
  await editor.getByLabel('Customer name',{exact:true}).fill(revisedName);
  await editor.getByRole('button',{name:'Save customer',exact:true}).click();
  await expect(page.locator('.customer-directory-status')).toContainText('Customer saved');
  await page.reload();
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  await expect(editor.getByLabel('Customer name',{exact:true})).toHaveValue(revisedName);
  const returnToJob=page.getByRole('link',{name:'Back to saved job',exact:true});
  await expect(returnToJob).toHaveAttribute('href','/schedule?job='+jobId);
  await returnToJob.click();
  await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();
  const jobVehicles=page.getByRole('region',{name:'Vehicles for this job',exact:true});
  const originalVehicle='Synthetic lifecycle sedan';
  const bookedVehicleSummary=jobVehicles.locator('summary').filter({hasText:originalVehicle});
  const jobVehicle=(await f.client.query('SELECT id,vehicle_id FROM crest.job_vehicles WHERE business_id=$1 AND job_id=$2',[f.business,jobId])).rows[0];
  const readVisits=async(kind,recordId)=>page.evaluate(async({kind,recordId})=>{
   const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   if(!session.ok)return {status:session.status};
   const proof=await session.json();
   const result=await fetch('/api/business/scheduling/record-jobs',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify({kind,recordId,afterRecordedAt:null,afterEntryId:null,pageSize:10})});
   return {status:result.status,cache:result.headers.get('cache-control'),body:await result.json()};
  },{kind,recordId});
  for(const [kind,id,expectedVehicle] of [['customer',linkedCustomer,null],['vehicle',jobVehicle.vehicle_id,jobVehicle.id]]){
   const visits=await readVisits(kind,id);
   assert.equal(visits.status,200);
   assert.match(visits.cache,/no-store/);
   assert.equal(visits.body.hasMore,false);
   assert.deepEqual(visits.body.jobs.map(row=>[row.jobId,row.jobVehicleId,row.vehicleLabels]),[[jobId,expectedVehicle,[originalVehicle]]]);
  }
  await bookedVehicleSummary.click();
  const vehicleLink=jobVehicles.getByRole('link',{name:'Open vehicle record for '+originalVehicle,exact:true});
  await expect(vehicleLink).toHaveAttribute('href','/vehicles?vehicle='+jobVehicle.vehicle_id+'&job='+jobId+'&jobVehicle='+jobVehicle.id);
  assert(await vehicleLink.evaluate(el=>el.getBoundingClientRect().height>=44&&document.documentElement.scrollWidth<=innerWidth));
  await vehicleLink.focus();await page.keyboard.press('Enter');
  const vehicleEditor=page.getByRole('form',{name:'Vehicle editor',exact:true});
  await expect(page.getByRole('heading',{name:originalVehicle,exact:true})).toBeFocused();
  await expect(vehicleEditor).toHaveCount(0);
  await savedVisits.locator('summary').click();
  await expect(savedVisit).toHaveAttribute('href','/schedule?job='+jobId+'&vehicle='+jobVehicle.id+'&from=vehicle');
  await expect(savedVisits).toContainText('Synthetic lifecycle customer');
  assert(await savedVisits.evaluate(el=>el.getBoundingClientRect().right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).include('.record-job-history').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
  await savedVisits.screenshot({path:'.local/review/record-job-history-'+name+'.png',animations:'disabled'});
  await savedVisit.focus();await page.keyboard.press('Enter');
  await expect(bookedVehicleSummary).toBeFocused();
  const vehicleVisitsLink=jobVehicles.getByRole('link',{name:'Back to vehicle visits for '+originalVehicle,exact:true});
  await expect(vehicleVisitsLink).toHaveAttribute('href','/vehicles?vehicle='+jobVehicle.vehicle_id+'&job='+jobId+'&jobVehicle='+jobVehicle.id+'&view=visits');
  assert(await vehicleVisitsLink.evaluate(el=>el.getBoundingClientRect().height>=44&&document.documentElement.scrollWidth<=innerWidth));
  await vehicleVisitsLink.focus();await page.keyboard.press('Enter');
  await expect(savedVisits.locator('summary')).toBeFocused();
  await expect(savedVisit).toBeVisible();
  await capture('vehicle-profile');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Edit vehicle',exact:true}).click();
  await expect(vehicleEditor.getByRole('heading',{name:'Edit vehicle',exact:true})).toBeFocused();
  const revisedVehicle='Synthetic current vehicle label';
  await vehicleEditor.getByLabel('Vehicle label',{exact:true}).fill(revisedVehicle);
  await vehicleEditor.getByRole('button',{name:'Save vehicle',exact:true}).click();
  await expect(page.getByRole('status',{name:'Vehicle editor status',exact:true})).toContainText('Vehicle saved');
  await page.reload();
  await expect(page.getByRole('heading',{name:revisedVehicle,exact:true})).toBeVisible();
  await expect(returnToJob).toHaveAttribute('href','/schedule?job='+jobId+'&vehicle='+jobVehicle.id);
  await returnToJob.focus();await page.keyboard.press('Enter');
  await expect(bookedVehicleSummary).toHaveText(originalVehicle);
  await expect(bookedVehicleSummary).toBeFocused();
  await expect(vehicleLink).toBeVisible();
  // The separate recovery and empty-state probes start with a fresh browser session so the deliberately rapid workflows respect the ordinary request allowance.
  await context.close();
  const probeContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),probePage=await probeContext.newPage();
  probePage.setDefaultTimeout(15000);probePage.setDefaultNavigationTimeout(30000);
  await signIn(probePage,f,nextCodeAt);
  const probeVehicleEditor=probePage.getByRole('form',{name:'Vehicle editor',exact:true}),probeVisits=probePage.locator('.record-job-history');
  await probePage.goto(f.origin+'/schedule');await search(probePage);
  const updatedJobRow=probePage.getByRole('button',{name:revisedName+' · Scheduled · View job',exact:true});
  await probePage.route('**/api/business/scheduling/resources',route=>route.abort('failed'));await updatedJobRow.click();await expect(probePage.locator('.schedule-status')).toContainText('could not be verified');await expect(probePage.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toHaveCount(0);await expect(probePage.getByRole('region',{name:'Saved work calendar',exact:true})).toHaveCount(0);await probePage.unroute('**/api/business/scheduling/resources');await probePage.getByRole('button',{name:'Check schedule access',exact:true}).click();await expect(probePage.locator('.schedule-status')).toContainText('Saved schedule loaded.');
  await probePage.goto(f.origin+'/vehicles');
  await probePage.getByRole('button',{name:'Add vehicle',exact:true}).click();
  const unbooked='Synthetic unbooked vehicle';
  await probeVehicleEditor.getByLabel('Vehicle label',{exact:true}).fill(unbooked);
  await probeVehicleEditor.getByRole('button',{name:'Save vehicle',exact:true}).click();
  await expect(probePage.getByRole('status',{name:'Vehicle editor status',exact:true})).toContainText('Vehicle saved');
  await probePage.getByRole('button',{name:'Load current vehicles',exact:true}).click();
  await probePage.getByRole('button',{name:unbooked,exact:true}).click();
  const limitVisits=route=>route.fulfill({status:429,json:{error:'SCHEDULING_REQUEST_LIMITED'},headers:{'cache-control':'no-store','retry-after':'60'}});
  await probePage.route(visitsRoute,limitVisits);
  await probeVisits.locator('summary').click();
  await expect(probeVisits.getByRole('status')).toHaveText('Saved visits are temporarily limited. Wait a minute before trying again.');
  await expect(probeVisits.getByRole('link')).toHaveCount(0);
  await probePage.unroute(visitsRoute,limitVisits);
  await probeVisits.getByRole('button',{name:'Retry saved visits',exact:true}).focus();
  await probePage.keyboard.press('Enter');
  await expect(probeVisits.getByRole('status')).toHaveText('No saved visits for this record.');
  await expect(probeVisits.locator('summary')).toBeFocused();

  await probePage.goto(f.origin+'/schedule');
  await probePage.goto(f.origin+'/');await probePage.goBack();const check=probePage.getByRole('button',{name:'Check schedule access',exact:true});if(await check.isVisible())await check.click();await expect(probePage.locator('.schedule-status')).toContainText('Saved schedule loaded.');assert.equal((await f.client.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,120);
 }finally{await browser?.close();await f.close();}
},{timeout:240000});

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' customer profile shows verified upcoming visits and active vehicle links',{timeout:150000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,quotes:true,quoteReview:true,quoteCommercial:true,
  scheduling:true,recordJobHistory:true,customerProfileFixture:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  await signIn(page,fixture);
  const request=fixture.bookingRequest;
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const visitStart=tomorrow+'T14:00:00.000000Z';
  Object.assign(request.payload.appointment,{start_at:visitStart,end_at:tomorrow+'T15:00:00.000000Z',
   local_start:tomorrow+'T14:00:00.000000',local_end:tomorrow+'T15:00:00.000000'});
  const status=await page.evaluate(async input=>{
   const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   const {csrfToken}=await session.json();
   const {businessId,...body}=input;
   void businessId;
   return (await fetch('/api/business/scheduling/book',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':csrfToken},
    body:JSON.stringify(body)})).status;
  },request);
  assert.equal(status,200);
  const profileEndpoint='**/api/business/customers/profile';
  const stopProfile=route=>route.abort('failed');
  await page.route(profileEndpoint,stopProfile);
  await page.goto(fixture.origin+'/customers?customer='+request.payload.customerId);
  const summary=page.getByRole('region',{name:'Visit summary',exact:true});
  await expect(summary).toContainText('Visits and vehicle links couldn’t be verified.');
  await expect(summary.getByRole('link')).toHaveCount(0);
  await page.unroute(profileEndpoint,stopProfile);
  await summary.getByRole('button',{name:'Retry customer summary',exact:true}).press('Enter');
  await expect(summary).toContainText('No completed visit');
  const upcoming=summary.getByRole('link');
  await expect(upcoming).toHaveAttribute('href','/schedule?job='+request.jobId+'&from=customer');
  await expect(upcoming.locator('time')).toHaveAttribute('datetime',visitStart);
  const sections=page.getByRole('navigation',{name:'Customer record sections',exact:true});
  await sections.getByRole('button',{name:'Vehicles',exact:true}).click();
  const linkedVehicles=page.getByRole('region',{name:'Linked vehicles',exact:true});
  const linkedVehicle=linkedVehicles.getByRole('link',{name:'Synthetic lifecycle sedan',exact:true});
  await expect(linkedVehicle).toHaveAttribute('href','/vehicles?vehicle='+request.payload.vehicles[0].vehicleId+'&customer='+request.payload.customerId);
  await expect(linkedVehicles).toContainText('Owner · Billing contact');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('.customer-record').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/customer-profile-vehicles-'+name+'-'+width+'.png',fullPage:true});
  }
  await linkedVehicle.press('Enter');
  await expect(page.getByRole('heading',{name:'Synthetic lifecycle sedan',exact:true})).toBeFocused();
  await page.getByRole('link',{name:'Back to customer vehicles',exact:true}).press('Enter');
  await expect(linkedVehicle).toBeFocused();
 }finally{await browser?.close();await fixture.close();}
});
