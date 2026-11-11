import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {strFromU8,unzipSync} from 'fflate';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' genuine maintenance reminder lifecycle and interrupted save',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,
  reviewOutcome:true,reviewHistory:true,maintenanceFollowUp:true});
 let browser,page,checkRefreshBudget=false;
 const reminderResponses=[],authorityFailures=[];
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('response',response=>{
   const path=new URL(response.url()).pathname;
   if(path.startsWith('/api/business/scheduling/maintenance-'))reminderResponses.push({path,status:response.status()});
   if(checkRefreshBudget&&response.status()>=400&&['/api/auth/session','/api/business/scheduling/workspace'].includes(path))
    authorityFailures.push({path,status:response.status()});
  });
  const {origin,bookingRequest}=fixture,jobId=bookingRequest.jobId,customerId=bookingRequest.payload.customerId;
  const completedPath='/schedule/work/complete?job='+jobId;
  await page.goto(origin+completedPath);
  await page.getByRole('link',{name:'Sign in to review completion',exact:true}).click();
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();

  const booking=Object.fromEntries(Object.entries(structuredClone(bookingRequest)).filter(([key])=>key!=='businessId'));
  const booked=await page.evaluate(async body=>{
   const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),proof=await auth.json();
   const response=await fetch('/api/business/scheduling/book',{method:'POST',
    headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
   return {status:response.status,value:await response.json()};
  },booking);
  assert.equal(booked.status,200);assert.equal(booked.value.state,'committed');
  await page.goto(origin+'/schedule?job='+jobId);
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByLabel('What is happening?',{exact:true}).selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?',{exact:true}).fill('Synthetic maintenance appointment.');
  await page.getByRole('button',{name:'Start work without recorded travel',exact:true}).click();
  await expect(page.locator('.job-change-status')).toContainText('Work status saved.');
  await page.goto(origin+completedPath);
  await page.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
  await page.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
  await page.getByRole('button',{name:'End job',exact:true}).click();
  await expect(page.locator('.job-change-status')).toContainText('Job completion saved.');

  const panel=page.locator('details').filter({has:page.getByText('Maintenance reminders',{exact:true})}).last();
  const disclosure=panel.locator('summary');
  async function saveAndRefresh(buttonName){
   const submitted=page.waitForResponse(response=>response.url().endsWith('/api/business/scheduling/maintenance-save'));
   await panel.getByRole('button',{name:buttonName,exact:true}).click();
   // Browser navigation can discard DevTools' response body. The app must
   // still confirm the saved response and the journey verifies the records.
   assert.equal((await submitted).status(),200);
   await expect(panel.getByRole('status')).toHaveText('Maintenance reminder saved.',{timeout:20000});
  }
  await disclosure.focus();await page.keyboard.press('Enter');
  await expect(panel.getByText('No saved maintenance reminders for this job.')).toBeVisible();
  await panel.getByRole('button',{name:'Add maintenance reminder',exact:true}).click();
  await panel.getByLabel('Vehicle (optional)',{exact:true}).selectOption(bookingRequest.payload.vehicles[0].vehicleId);
  await panel.getByLabel('Due date and time',{exact:true}).fill('2025-04-10T09:30');
  const note='=Synthetic maintenance: verify sealant after the next wash.';
  await panel.getByLabel('Note (optional)',{exact:true}).fill(note);
  await saveAndRefresh('Save reminder');
  await expect(panel.getByText(note,{exact:true})).toBeVisible();
  await page.reload();await disclosure.click();
  await expect(panel.getByText(note,{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'View reminder history',exact:true}).click();
  await expect(panel.getByRole('region',{name:'Maintenance reminder history'}).getByText('Created',{exact:true})).toBeVisible();
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await page.screenshot({path:'.local/review/field-maintenance-history-'+name+'-'+width+'.png',fullPage:true});
  }

  await page.goto(origin+'/');
  const due=page.getByRole('region',{name:'Due maintenance reminders'});
  await expect(due.getByRole('heading',{name:'Maintenance due'})).toBeVisible();
  await expect(due.getByRole('link',{name:'Open saved job'})).toHaveAttribute('href','/schedule?job='+jobId);
  const {rows:[customer]}=await fixture.client.query('SELECT display_name FROM crest.customers WHERE business_id=$1 AND id=$2',[fixture.business,customerId]);
  await page.goto(origin+'/customers');
  await page.getByRole('button',{name:customer.display_name,exact:true}).click();
  await disclosure.click();
  await expect(panel.getByText(note,{exact:true})).toBeVisible();

  await panel.getByRole('button',{name:'Update reminder',exact:true}).click();
  await panel.getByLabel('What should happen?',{exact:true}).selectOption('snoozed');
  await panel.getByLabel('Snooze until',{exact:true}).fill('2098-04-12T10:30');
  await saveAndRefresh('Save reminder change');
  await expect(panel.getByText('Snoozed',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Update reminder',exact:true}).click();
  await panel.getByLabel('What should happen?',{exact:true}).selectOption('completed');
  let submissions=0;
  await page.route('**/api/business/scheduling/maintenance-save',async route=>{
   submissions++;
   const response=await route.fetch();
   assert.equal(response.status(),200);
   await route.abort('failed');
  });
  await panel.getByRole('button',{name:'Save reminder change',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('The save could not be confirmed. Review the original before making another change.',{timeout:20000});
  await panel.getByRole('link',{name:'Open interrupted save review',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Interrupted save review',exact:true})).toBeVisible();
  assert.equal(submissions,1);
  const {rows:[proof]}=await fixture.client.query(`SELECT count(*)::int AS count, array_agg(kind ORDER BY version) AS events
   FROM crest.follow_up_task_events WHERE business_id=$1`,[fixture.business]);
  assert.deepEqual(proof,{count:3,events:['created','snoozed','completed']});
  const storage=await page.evaluate(()=>sessionStorage.getItem('crest.maintenance-follow-up.pending-reference.v1'));
  assert(storage&&!storage.includes(note)&&!storage.includes('2098'));
  await page.getByRole('button',{name:'Check original resolution',exact:true}).click();
  await page.getByRole('button',{name:'Verify original save receipt',exact:true}).click();
  await expect(page.getByText(/The original save receipt is verified/)).toBeVisible();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.maintenance-follow-up.pending-reference.v1')),null);
  await page.goto(origin+completedPath);
  await disclosure.click();
  await expect(panel.getByText('Completed',{exact:true})).toBeVisible();
  assert.equal(submissions,1);
  await panel.getByRole('button',{name:'View reminder history',exact:true}).click();
  const history=panel.getByRole('region',{name:'Maintenance reminder history'});
  await expect(history.getByText('Created',{exact:true})).toBeVisible();
  let downloads=0;
  page.on('download',()=>downloads++);
  const downloading=page.waitForEvent('download');
  await history.getByRole('button',{name:'Download history (CSV + JSON)',exact:true}).click();
  const download=await downloading;
  assert.equal(download.suggestedFilename(),'crest-maintenance-reminder-history.zip');
  const bytes=[];
  for await(const chunk of await download.createReadStream())bytes.push(chunk);
  const files=unzipSync(Buffer.concat(bytes)),json=name=>JSON.parse(strFromU8(files[name]));
  const saved=json('saved_history.json');
  assert.equal(saved.throughVersion,'3');assert.equal(saved.completeBackup,false);assert.equal(saved.completeCrestExport,false);
  assert.deepEqual(saved.events.map(event=>event.state),['open','snoozed','completed']);
  assert.equal(saved.events[0].reason,note);
  assert(strFromU8(files['maintenance_reminder_history.csv']).includes('"'+String.fromCharCode(39)+note+'"'));
  assert.deepEqual(json('dictionary.json').escapes,[{event_id:saved.events[0].eventId,column:'reason',apostrophe_prefix:true}]);
  for(const file of json('manifest.json').files){
   assert.equal(files[file.name].length,file.bytes);
   assert.equal(createHash('sha256').update(files[file.name]).digest('hex'),file.sha256);
  }
  await expect(panel.getByRole('status')).toContainText('Reminder history download requested.');
  await page.route('**/api/business/scheduling/maintenance-history',route=>route.abort('failed'));
  await history.getByRole('button',{name:'Download history (CSV + JSON)',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('No history file was prepared.');
  assert.equal(downloads,1);
  await page.unroute('**/api/business/scheduling/maintenance-history');

  await page.unroute('**/api/business/scheduling/maintenance-save');
  await page.goto(origin+'/customers');
  await page.getByRole('button',{name:customer.display_name,exact:true}).click();
  await disclosure.click();
  await panel.getByRole('button',{name:'Add maintenance reminder',exact:true}).click();
  await expect(panel.getByLabel('Due date and time',{exact:true})).toBeFocused();
  await panel.getByLabel('Due date and time',{exact:true}).fill('2026-12-08T08:00');
  await saveAndRefresh('Save reminder');
  const customerReminder=panel.getByRole('listitem').filter({hasText:'Customer-wide reminder'});
  await expect(customerReminder.getByText('Open',{exact:true})).toBeVisible();
  await customerReminder.getByRole('button',{name:'Update reminder',exact:true}).click();
  await panel.getByLabel('What should happen?',{exact:true}).selectOption('dismissed');
  await panel.getByLabel('Dismissal reason',{exact:true}).fill('Synthetic owner dismissed this reminder.');
  // Exercise the real shared admission gate with seven requests remaining.
  // The active sign-in is the newest session in this disposable database.
  const {rows:[browserSession]}=await fixture.client.query(`SELECT id FROM crest_private.app_sessions
   WHERE actor_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,[fixture.actor]);
  const {rows:[budget]}=await fixture.client.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now),
   used AS (SELECT count(*)::int AS n FROM crest_private.session_request_admissions,stamp
    WHERE session_id=$1 AND bucket='ordinary' AND admitted_at>stamp.now-interval '1 minute'),
   seed AS (INSERT INTO crest_private.session_request_admissions(session_id,bucket,admitted_at)
    SELECT $1,'ordinary',stamp.now FROM stamp,used,LATERAL generate_series(1,113-used.n) RETURNING id)
   SELECT used.n+(SELECT count(*)::int FROM seed) AS admitted FROM used`,[browserSession.id]);
  assert.equal(budget.admitted,113);
  checkRefreshBudget=true;
  await saveAndRefresh('Save reminder change');
  await expect(customerReminder.getByText('Dismissed',{exact:true})).toBeVisible();
  await expect(panel.getByText('Completed',{exact:true})).toBeVisible();
  const {rows:[customerTask]}=await fixture.client.query(`SELECT t.vehicle_id,t.source_job_id,e.reason
   FROM crest.follow_up_tasks t JOIN crest.follow_up_task_events e ON e.task_id=t.id AND e.business_id=t.business_id
   WHERE t.business_id=$1 AND t.customer_id=$2 AND t.source_job_id IS NULL AND e.version=1`,[fixture.business,customerId]);
  assert.deepEqual(customerTask,{vehicle_id:null,source_job_id:null,reason:null});
  assert.deepEqual(authorityFailures,[]);
 }catch(error){
  const status=await page?.locator('.maintenance-reminders').getByRole('status').textContent({timeout:1000}).catch(()=>null);
  console.log(JSON.stringify({name,reminderResponses,authorityFailures,status}));
  throw error;
 }finally{
  try{await browser?.close();}finally{await fixture.close();}
 }
},{timeout:360000});
