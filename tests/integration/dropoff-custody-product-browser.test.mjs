import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
import {strFromU8,unzipSync} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

async function downloadCustodyHistory(page,panel){
 const started=page.waitForEvent('download');
 await panel.getByRole('button',{name:'Download custody history (CSV + JSON)',exact:true}).click();
 const download=await started;
 assert.equal(download.suggestedFilename(),'crest-custody-history.zip');
 const stream=await download.createReadStream(),chunks=[];
 assert(stream);
 for await(const chunk of stream)chunks.push(chunk);
 const files=unzipSync(Buffer.concat(chunks)),manifest=JSON.parse(strFromU8(files['manifest.json']));
 for(const file of manifest.files){
  assert.equal(files[file.name].length,file.bytes);
  assert.equal(createHash('sha256').update(files[file.name]).digest('hex'),file.sha256);
 }
 assert.equal(manifest.completeBackup,false);
 assert.equal(manifest.completeCrestExport,false);
 await expect(panel.getByRole('status')).toHaveText('Custody history download requested. Check your downloads.');
 return JSON.parse(strFromU8(files['saved_custody_history.json'])).custody;
}

for(const [name,engine,startWork,cancelWork] of [['chromium',chromium,false,false],['webkit',webkit,false,false],['chromium',chromium,true,false],['webkit',webkit,true,false],['chromium',chromium,true,true],['webkit',webkit,true,true]])test(
 name+(cancelWork?' Drop-Off no-work cancellation retains the vehicle for explicit return':startWork?' Drop-Off work starts explicitly, completes, and awaits separate collection':' Drop-Off forms recover interrupted intake and record collection'),async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:startWork,unfulfilledCancellation:cancelWork,dropoffCustody:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(fixture.origin+'/sign-in');
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();

  const post=(route,body)=>page.evaluate(async({route,body})=>{
   const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   if(!auth.ok)throw Error('Synthetic test could not obtain a sign-in proof ('+auth.status+').');
   const proof=await auth.json(),response=await fetch('/api/business/scheduling/'+route,{method:'POST',
    headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
   return {status:response.status,value:await response.json(),cache:response.headers.get('cache-control')};
  },{route,body});
  const booking=structuredClone(fixture.bookingRequest);
  delete booking.businessId;
  booking.payload.fulfillmentMode='dropoff';
  const result=await post('book',booking);
  assert.equal(result.status,200,JSON.stringify(result.value));
  assert.equal(result.value.state,'committed');
  const jobId=booking.jobId,jobPath='/schedule?job='+jobId;
  const {rows:[booked]}=await fixture.client.query(
   'SELECT j.mode_version_id,v.id FROM crest.jobs j JOIN crest.job_vehicles v ON v.job_id=j.id AND v.business_id=j.business_id WHERE j.id=$1 AND j.business_id=$2',
   [jobId,fixture.business]);
  const jobVehicleId=booked.id;
  const mismatch=await post('custody-context',{jobId,jobVehicleId:randomUUID()});
  assert.deepEqual(mismatch.value,{state:'absent'});
  assert.match(mismatch.cache,/no-store/);

  await page.goto(fixture.origin+jobPath);
  const collectionList=page.getByRole('region',{name:'Vehicle collections',exact:true});
  async function loadCollections(){
   await page.locator('summary').filter({hasText:/^Vehicle collections$/}).click();
   await collectionList.getByRole('button',{name:'Load vehicle collections',exact:true}).click();
  }
  await loadCollections();
  await expect(collectionList.getByRole('status')).toHaveText('No vehicles are awaiting collection or return.');
  await page.locator('summary').filter({hasText:/^Vehicle collections$/}).click();
  const vehicle=page.getByRole('region',{name:'Vehicles for this job'}).locator('summary').first();
  const panel=page.getByRole('region',{name:'Vehicle custody'});
  const status=panel.getByRole('status');
  await vehicle.focus();await page.keyboard.press('Enter');
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await expect(panel.getByText('Expected',{exact:true})).toBeVisible();
  await expect(panel.getByText('A handoff policy needs to be configured for this booking.',{exact:true})).toBeVisible();

  const workStatus=page.locator('.job-change-status');
  const openWork=async()=>{
   await page.getByRole('button',{name:'Record work status…',exact:true}).click();
   await expect(page.getByRole('region',{name:'Drop-Off work status'})).toBeVisible();
  };
  if(startWork){
   await openWork();
   await page.getByRole('button',{name:'Start work',exact:true}).click();
   await expect(workStatus).toHaveText('Record intake for every booked vehicle before starting work. No work action was saved.');
  }

  const acknowledgement='Synthetic handoff verification requirement';
  await page.goto(fixture.origin+'/schedule/modes');
  await page.getByText('Drop-Off handoff policy',{exact:true}).click();
  const settings=page.getByRole('region',{name:'Selected Drop-Off policy'});
  await settings.getByRole('button',{name:'Load Drop-Off policy',exact:true}).click();
  await expect(settings.getByRole('status')).toHaveText('No policy is saved for this arrangement.');
  await settings.getByLabel('Condition photo requirement',{exact:true}).selectOption('reason');
  await settings.getByLabel('Handoff acknowledgement (optional)',{exact:true}).fill(acknowledgement);
  await settings.getByRole('button',{name:'Save Drop-Off policy',exact:true}).scrollIntoViewIfNeeded();
  await mkdir('.local/review',{recursive:true});
  const policyAudit=await new AxeBuilder({page}).include('[aria-label="Selected Drop-Off policy"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(policyAudit.violations.map(issue=>issue.id),[]);
  await page.screenshot({path:'.local/review/field-dropoff-policy-'+name+'-390.png'});
  await settings.getByRole('button',{name:'Save Drop-Off policy',exact:true}).click();
  await expect(settings.getByRole('status')).toHaveText('Drop-Off policy saved.',{timeout:20000});
  await expect(settings.getByText(acknowledgement,{exact:true})).toBeVisible();
  const {rows:[configured]}=await fixture.client.query('SELECT id,acknowledgement_text FROM crest.custody_authorization_configs WHERE business_id=$1 AND mode_version_id=$2',
   [fixture.business,booked.mode_version_id]);
  assert.equal(configured.acknowledgement_text,acknowledgement);
  await page.goto(fixture.origin+jobPath);
  await vehicle.click();
  const intakePerson='Synthetic intake contact with a long name for mobile review';
  const location='Synthetic shop bay',missing='Synthetic camera unavailable';
  async function fillHandoff(time,person,releasing=false){
   await panel.getByRole('button',{name:releasing?'Record release…':'Record intake…',exact:true}).click();
   await panel.getByLabel('Actual handoff time',{exact:true}).fill(time);
   await panel.getByLabel(releasing?'Who collected the vehicle?':'Who handed over the vehicle?',{exact:true}).fill(person);
   await panel.getByLabel('Handoff location',{exact:true}).fill(location);
   await panel.getByLabel('Why is a condition photo missing?',{exact:true}).fill(missing);
   await panel.getByRole('checkbox',{name:'Record the required acknowledgement'}).check();
  }
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await fillHandoff('2026-11-03T09:45',intakePerson);
  await mkdir('.local/review',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   await panel.getByRole('group',{name:'Receive vehicle'}).scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('[aria-label="Vehicle custody"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await page.screenshot({path:'.local/review/field-dropoff-intake-'+name+'-'+width+'.png'});
  }
  await page.setViewportSize({width:390,height:844});
  let committedResponse=false;
  await page.route('**/api/business/scheduling/custody-save',async route=>{
   const response=await route.fetch();
   committedResponse=response.status()===200;
   await route.abort();
  },{times:1});
  await panel.getByRole('button',{name:'Save intake',exact:true}).click();
  await expect(status).toHaveText('The handoff could not be confirmed. Check Save review before trying again.',{timeout:20000});
  assert.equal(committedResponse,true);
  const retained=await page.evaluate(()=>sessionStorage.getItem('crest.dropoff-custody.pending-reference.v1'));
  assert(retained&&!retained.includes(intakePerson)&&!retained.includes(location)&&!retained.includes(missing));
  const original=JSON.parse(retained).reference;
  assert.equal(original.jobVehicleId,jobVehicleId);
  assert.equal((await fixture.client.query('SELECT authorization_config_id FROM crest.custody_cases WHERE id=$1',[original.caseId])).rows[0].authorization_config_id,configured.id);
  assert.deepEqual(Object.keys(original).sort(),['caseId','expectedVersion','jobVehicleId','operationId','recoveryEpoch']);
  await panel.getByRole('link',{name:'Open Save review'}).click();
  await page.getByRole('button',{name:'Check original resolution'}).click();
  await page.getByRole('button',{name:'Verify original save receipt'}).click();
  await expect(page.getByRole('status')).toContainText('The original save receipt is verified',{timeout:20000});
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.dropoff-custody.pending-reference.v1')),null);
  await page.goto(fixture.origin+jobPath);
  await vehicle.click();
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await expect(panel.getByText('In Crest custody',{exact:true})).toBeVisible();
  await expect(panel.getByText(intakePerson,{exact:true})).toBeVisible();
  await panel.getByText('Saved acknowledgement requirement',{exact:true}).click();
  await expect(panel.getByText(acknowledgement,{exact:true})).toBeVisible();

  if(startWork){
   await openWork();
   const work=page.getByRole('region',{name:'Drop-Off work status'});
   await expect(work.getByText('Scheduled · Saved version 1',{exact:true})).toBeVisible();
   await expect(work.getByLabel('Vehicle you are driving',{exact:true})).toHaveCount(0);
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Drop-Off work status"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-dropoff-work-'+name+'-'+width+'.png',fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
   let workCommitted=false;
   await page.route('**/api/business/scheduling/field-save',async route=>{
    const response=await route.fetch();
    workCommitted=response.status()===200;
    await route.abort();
   },{times:1});
   const start=work.getByRole('button',{name:'Start work',exact:true});
   await start.focus();await page.keyboard.press('Enter');
   await expect(workStatus).toContainText('The save outcome is unknown.');
   assert(workCommitted);
   await page.getByRole('button',{name:'Check original work action',exact:true}).click();
   await expect(workStatus).toContainText('Work status saved.');
   await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
   await openWork();
   await expect(work.getByText('In progress · Saved version 2',{exact:true})).toBeVisible();
   await work.getByLabel('Reason for pause',{exact:true}).fill('Synthetic break');
   await work.getByRole('button',{name:'Pause work',exact:true}).click();
   await expect(workStatus).toContainText('Work status saved.');
   await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
   await openWork();
   await expect(work.getByText('Paused · Saved version 3',{exact:true})).toBeVisible();
   if(cancelWork){
    await work.getByRole('link',{name:'Cancel if no work was completed',exact:true}).click();
    const cancellation=page.getByRole('region',{name:'Drop-Off job cancellation',exact:true});
    await expect(cancellation.getByRole('status')).toHaveText('Review the saved work before cancelling.');
    await expect(cancellation.getByText('Any vehicle in your custody still needs a separate recorded handoff. Cancellation keeps it in the return queue.',{exact:true})).toBeVisible();
    const reason='Synthetic long cancellation reason: the owner stopped before any assigned detailing work was performed.';
    await cancellation.getByLabel('Cancellation reason',{exact:true}).fill(reason);
    await cancellation.getByLabel('Customer-communication status',{exact:true}).selectOption('not_sent');
    await cancellation.getByLabel('Work completed',{exact:true}).selectOption('none');
    for(const width of [360,390,768,1440]){
     await page.setViewportSize({width,height:900});
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     const audit=await new AxeBuilder({page}).include('[aria-label="Drop-Off job cancellation"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
     assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
     await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
     await page.screenshot({path:'.local/review/field-dropoff-cancellation-'+name+'-'+width+'.png',fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    let submitted=0;
    await page.route('**/api/business/scheduling/cancel-unfulfilled',async route=>{
     submitted++;const response=await route.fetch();assert.equal(response.status(),200);
     if(name==='webkit')await route.abort();else await route.fulfill({response});
    },{times:1});
    const cancel=cancellation.getByRole('button',{name:'Cancel job and close work time',exact:true});
    await cancel.focus();await page.keyboard.press('Enter');
    if(name==='webkit'){
     await expect(workStatus).toContainText('The save outcome is unknown.');
     await page.reload();
    }
    await expect(workStatus).toContainText('Job cancelled.');assert.equal(submitted,1);
    await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
    await loadCollections();
    await expect(collectionList.getByText('Return required',{exact:true})).toBeVisible();
    await collectionList.getByRole('link',{name:'Open saved job and handoff',exact:true}).click();
    await vehicle.click();await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
    await expect(panel.getByText('Return required',{exact:true})).toBeVisible();
    const before=await downloadCustodyHistory(page,panel);assert.equal(before.state,'return_required');
    await page.reload();await vehicle.click();await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
    await expect(panel.getByText('Return required',{exact:true})).toBeVisible();
    await fillHandoff(new Date().toISOString().slice(0,19),'Synthetic return recipient',true);
    await panel.getByRole('button',{name:'Save release',exact:true}).click();
    await expect(status).toHaveText('Handoff saved.');
    await expect(panel.getByText('Released',{exact:true})).toHaveCount(2);
    const after=await downloadCustodyHistory(page,panel);assert.equal(after.state,'released');
    await loadCollections();await expect(collectionList.getByRole('status')).toHaveText('No vehicles are awaiting collection or return.');
    assert.equal((await fixture.client.query('SELECT count(*)::int count FROM crest.travel_legs WHERE business_id=$1 AND job_context_id=$2',[fixture.business,jobId])).rows[0].count,0);
    return;
   }
   await work.getByRole('button',{name:'Resume work',exact:true}).click();
   await expect(workStatus).toContainText('Work status saved.');
   await page.reload();
   await expect(work.getByText('In progress · Saved version 4',{exact:true})).toBeVisible();
   await work.getByRole('link',{name:'Review and end job',exact:true}).click();
   const completion=page.getByRole('region',{name:'Job completion',exact:true});
   await completion.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
   await completion.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
   await page.route('**/api/business/scheduling/complete',async route=>{
    const response=await route.fetch();
    assert.equal(response.status(),200);
    await route.abort();
   },{times:1});
   await completion.getByRole('button',{name:'End job',exact:true}).click();
   await expect(workStatus).toContainText('The save outcome is unknown.');
   await completion.getByRole('button',{name:'Check original completion',exact:true}).click();
   await expect(workStatus).toHaveText('Job completion saved.');
   const summary=completion.getByRole('region',{name:'Saved completion',exact:true});
   await expect(summary.getByRole('heading',{name:'Full completion',exact:true})).toBeVisible();
   await expect(summary).toContainText('Invoice review · Open');
   const savedCompletion=await post('completion-context',{jobId});
   assert.equal(savedCompletion.status,200);
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Job completion"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-dropoff-completion-'+name+'-'+width+'.png',fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
   await completion.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
   await loadCollections();
   await expect(collectionList.getByRole('status')).toHaveText('Saved vehicle collections loaded.');
   await expect(collectionList.getByText('Awaiting collection',{exact:true})).toBeVisible();
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Vehicle collections"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await collectionList.scrollIntoViewIfNeeded();
    await page.screenshot({path:'.local/review/field-dropoff-collections-'+name+'-'+width+'.png'});
   }
   await page.setViewportSize({width:390,height:844});
   await page.route('**/api/business/scheduling/custody-collections',route=>route.abort(),{times:1});
   await collectionList.getByRole('button',{name:'Reload vehicle collections',exact:true}).click();
   await expect(collectionList.getByRole('status')).toHaveText('Vehicle collections could not be verified. Reload to try again.');
   await expect(collectionList.getByText('Awaiting collection',{exact:true})).toHaveCount(0);
   await collectionList.getByRole('button',{name:'Load vehicle collections',exact:true}).click();
   await expect(collectionList.getByText('Awaiting collection',{exact:true})).toBeVisible();
   await collectionList.getByRole('link',{name:'Open saved job and handoff',exact:true}).click();
   await vehicle.click();
   await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
   await expect(panel.getByText('Awaiting collection',{exact:true})).toBeVisible();
   const nextSecond=Math.floor(Date.parse(savedCompletion.value.completedAt)/1000)*1000+1000;
   await expect.poll(()=>Date.now()>=nextSecond).toBe(true);
   await fillHandoff(new Date(nextSecond).toISOString().slice(0,19),'Synthetic collecting customer',true);
   await panel.getByRole('button',{name:'Save release',exact:true}).click();
   await expect(status).toHaveText('Handoff saved.');
   await expect(panel.getByText('Released',{exact:true})).toHaveCount(2);
   assert.deepEqual((await post('completion-context',{jobId})).value,savedCompletion.value);
   await loadCollections();
   await expect(collectionList.getByRole('status')).toHaveText('No vehicles are awaiting collection or return.');
   await page.getByRole('link',{name:'Review saved completion',exact:true}).click();
   await expect(workStatus).toHaveText('Saved completion loaded.');
   assert.equal((await fixture.client.query('SELECT count(*)::int count FROM crest.travel_legs WHERE business_id=$1 AND job_context_id=$2',[fixture.business,jobId])).rows[0].count,0);
   return;
  }

  await page.getByRole('button',{name:'Cancel this job…',exact:true}).click();
  await page.getByLabel('Cancellation reason',{exact:true}).fill('Synthetic cancellation after handoff');
  await page.getByLabel('Customer-communication status',{exact:true}).selectOption('not_sent');
  await page.getByRole('button',{name:'Cancel this scheduled job',exact:true}).click();
  await expect(page.locator('.job-change-status')).toContainText('Job cancellation saved.',{timeout:20000});
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await loadCollections();
  await expect(collectionList.getByText('Return required',{exact:true})).toBeVisible();
  await collectionList.getByRole('link',{name:'Open saved job and handoff',exact:true}).click();
  await vehicle.click();
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await expect(panel.getByText('Return required',{exact:true})).toBeVisible();

  const collectedBy='Synthetic collecting customer';
  await fillHandoff('2026-11-03T11:15',collectedBy,true);
  await panel.getByRole('button',{name:'Save release',exact:true}).click();
  await expect(status).toHaveText('Handoff saved.',{timeout:20000});
  const {rows:events}=await fixture.client.query('SELECT action,notes FROM crest.custody_events WHERE case_id=$1 ORDER BY version',[original.caseId]);
  assert.deepEqual(events,[{action:'received',notes:null},{action:'released',notes:null}]);
  await expect(panel.getByText(collectedBy,{exact:true})).toBeVisible();
  await expect(panel.getByText('Released',{exact:true})).toHaveCount(2);
  let downloads=0;page.on('download',()=>{downloads++;});
  await page.route('**/api/business/scheduling/custody-context',route=>route.abort(),{times:1});
  await panel.getByRole('button',{name:'Download custody history (CSV + JSON)',exact:true}).click();
  await expect(status).toHaveText('No file could be prepared. Reload the saved custody history before downloading.');
  assert.equal(downloads,0);
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await expect(panel.getByText(collectedBy,{exact:true})).toBeVisible();
  const downloaded=await downloadCustodyHistory(page,panel);
  assert.equal(downloads,1);
  assert.equal(downloaded.state,'released');
  assert.equal(downloaded.events.length,2);
  assert.equal(downloaded.events[0].person.displayName,intakePerson);
  assert.equal(downloaded.events[1].person.displayName,collectedBy);
  assert.equal(downloaded.events[0].notes,null);
  assert.equal(downloaded.policy.acknowledgementText,acknowledgement);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('[aria-label="Vehicle custody"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await page.screenshot({path:'.local/review/field-dropoff-history-'+name+'-'+width+'.png',fullPage:true});
  }

  await page.route('**/api/business/scheduling/custody-context',route=>route.abort(),{times:1});
  await panel.getByRole('button',{name:'Reload custody history',exact:true}).click();
  await expect(status).toHaveText('Custody details could not be loaded. Try again.');
  await expect(panel.getByText(collectedBy,{exact:true})).toHaveCount(0);
  await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  await expect(panel.getByText(collectedBy,{exact:true})).toBeVisible();
  await vehicle.click();
  await expect(panel).not.toBeVisible();
  await vehicle.click();
  await expect(panel.getByText(collectedBy,{exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Load custody history',exact:true})).toBeVisible();
 }finally{try{await browser?.close();}finally{await fixture.close();}}
},{timeout:360000});

const photoEngine=process.env.CREST_CUSTODY_PHOTO_ENGINE==='webkit'?['webkit',webkit]:['chromium',chromium];
test(photoEngine[0]+' signed-in condition photo survives interrupted upload confirmation and reopens after reload',async()=>{
 const photo=await sharp({create:{width:160,height:90,channels:3,background:'#9b702a'}})
  .withExif({IFD0:{Copyright:'Generated Crest test image'}}).png().toBuffer();
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,dropoffCustody:true,photoFixture:photo});
 let browser;
 try{
  browser=await photoEngine[1].launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();page.setDefaultTimeout(25000);
  await page.addInitScript(()=>{
   const revoke=URL.revokeObjectURL.bind(URL);
   window.crestTestRevocations=[];
   URL.revokeObjectURL=url=>{window.crestTestRevocations.push(url);revoke(url);};
  });
  await page.goto(fixture.origin+'/sign-in');
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const post=(route,body,extra={})=>page.evaluate(async({route,body,extra})=>{
   const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
   if(!auth.ok)throw Error('Synthetic sign-in proof failed.');
   const proof=await auth.json(),response=await fetch('/api/business/scheduling/'+route,{method:'POST',
    headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken,...extra},body:JSON.stringify(body)});
   return {status:response.status,cache:response.headers.get('cache-control'),type:response.headers.get('content-type'),
    value:response.headers.get('content-type')?.startsWith('application/json')?await response.json():
     Array.from(new Uint8Array(await response.arrayBuffer()))};
  },{route,body,extra});
  const booking=structuredClone(fixture.bookingRequest);delete booking.businessId;
  booking.payload.fulfillmentMode='dropoff';
  const booked=await post('book',booking);
  assert.equal(booked.value.state,'committed',JSON.stringify(booked.value));
  const jobPath='/schedule?job='+booking.jobId;
  const {rows:[vehicleRow]}=await fixture.client.query('SELECT id FROM crest.job_vehicles WHERE business_id=$1 AND job_id=$2',
   [fixture.business,booking.jobId]);
  const jobVehicleId=vehicleRow.id;
  await page.goto(fixture.origin+'/schedule/modes');
  await page.getByText('Drop-Off handoff policy',{exact:true}).click();
  const settings=page.getByRole('region',{name:'Selected Drop-Off policy'});
  await settings.getByRole('button',{name:'Load Drop-Off policy',exact:true}).click();
  await expect(settings.getByRole('status')).toHaveText('No policy is saved for this arrangement.');
  await settings.getByLabel('Condition photo requirement',{exact:true}).selectOption('required');
  await settings.getByRole('button',{name:'Save Drop-Off policy',exact:true}).click();
  await expect(settings.getByRole('status')).toHaveText('Drop-Off policy saved.');
  await page.goto(fixture.origin+jobPath);
  const vehicle=page.getByRole('region',{name:'Vehicles for this job'}).locator('summary').first();
  const panel=page.getByRole('region',{name:'Vehicle custody'});
  const photoStatus=panel.getByRole('status',{name:'Condition photo status'});
  const photoResponses=[];
  page.on('response',response=>{
   const path=new URL(response.url()).pathname;
   if(path.includes('/custody-photo/'))photoResponses.push([path.split('/').at(-1),response.status()]);
  });
  async function openHistory(){
   await vehicle.click();
   await panel.getByRole('button',{name:'Load custody history',exact:true}).click();
  }
  await openHistory();
  await panel.getByRole('button',{name:'Record intake…',exact:true}).click();
  await panel.getByLabel('Actual handoff time',{exact:true}).fill('2026-11-03T09:45');
  await panel.getByLabel('Who handed over the vehicle?',{exact:true}).fill('Synthetic intake contact');
  await panel.getByLabel('Handoff location',{exact:true}).fill('Synthetic shop bay');
  const save=panel.getByRole('button',{name:'Save intake',exact:true});
  await expect(save).toBeDisabled();
  await panel.getByLabel('Condition photo (required)',{exact:true}).setInputFiles({
   name:'generated-test-condition.png',mimeType:'image/png',buffer:photo});
  await page.route('**/custody-photo/upload',route=>route.abort(),{times:1});
  await panel.getByRole('button',{name:'Upload and verify photo',exact:true}).click();
  await expect(photoStatus).toContainText('could not be confirmed');
  await expect(save).toBeDisabled();
  assert.deepEqual(photoResponses,[['reserve',200]]);
  assert.equal(fixture.photoStorage.requests.length,0);
  await mkdir('.local/review',{recursive:true});
  await photoStatus.scrollIntoViewIfNeeded();
  await page.screenshot({path:'.local/review/field-condition-photo-error-'+photoEngine[0]+'-390.png'});
  let verifiedStatus;
  await page.route('**/custody-photo/verify',async route=>{
   const response=await route.fetch();verifiedStatus=response.status();
   await route.abort();
  },{times:1});
  const uploadReply=page.waitForResponse(response=>response.url().endsWith('/custody-photo/upload'),{timeout:15000});
  await panel.getByRole('button',{name:'Upload selected photo again',exact:true}).click();
  const upload=await uploadReply.catch(()=>null);
  assert.equal(upload?.status(),200,JSON.stringify({photoResponses,storageCalls:fixture.photoStorage.requests.map(item=>item.method)}));
  await expect.poll(()=>verifiedStatus).toBe(200);
  await expect(photoStatus).toContainText('could not be confirmed');
  await expect(save).toBeDisabled();
  await panel.getByRole('button',{name:'Check photo status',exact:true}).click();
  await expect(photoStatus).toHaveText('Photo verified. Save the handoff to link it.');
  const {rows:[staged]}=await fixture.client.query('SELECT id FROM crest.custody_photo_attempts WHERE business_id=$1',[fixture.business]);
  const scope={jobVehicleId,photoId:staged.id};
  assert.equal((await post('custody-photo/file',{...scope,variant:'preview'})).status,400);
  assert.equal((await post('custody-photo/file',{...scope,variant:'original'})).status,400);
  assert.equal((await post('custody-photo/status',{jobVehicleId:randomUUID(),photoId:scope.photoId})).status,400);
  await expect(save).toBeEnabled();await save.click();
  await expect(panel.getByText('Handoff saved.',{exact:true})).toBeVisible();
  await page.reload();await openHistory();
  const exported=await downloadCustodyHistory(page,panel);
  assert.equal(exported.state,'in_custody');
  assert.equal(exported.events[0].conditionPhotoId,scope.photoId);
  const show=panel.getByRole('button',{name:'View condition photo',exact:true});
  await show.focus();await page.keyboard.press('Enter');
  const image=panel.getByRole('img',{name:'Saved vehicle condition photo'});
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(element=>element.naturalWidth)).toBe(160);
  const file=await post('custody-photo/file',{...scope,variant:'preview'});
  assert.equal(file.status,200);assert.equal(file.type,'image/jpeg');assert.match(file.cache,/no-store/);
  assert.equal((await sharp(Buffer.from(file.value)).metadata()).exif,undefined);
  assert.equal((await post('custody-photo/file',{...scope,variant:'preview'},{range:'bytes=0-1'})).status,416);
  assert.equal((await post('custody-photo/file',{jobVehicleId:randomUUID(),photoId:scope.photoId,variant:'original'})).status,400);
  const auditRows=()=>fixture.client.query("SELECT action,delta FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='custody_photo_accesses'",[fixture.business]);
  assert.equal((await auditRows()).rowCount,0);
  await panel.getByRole('button',{name:'Prepare original download',exact:true}).click();
  const downloadLink=panel.getByRole('link',{name:'Save original file',exact:true});
  await expect(downloadLink).toBeVisible();
  const {rows:[access]}=await auditRows();
  assert.equal(access.action,'authorized_handoff');
  assert.equal(access.delta.after.photoId,scope.photoId);
  assert.equal(access.delta.after.byteSize,photo.length);
  const downloadPromise=page.waitForEvent('download');
  await downloadLink.click();
  const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),`condition-${scope.photoId}.png`);
  assert.deepEqual(await readFile(await download.path()),photo);
  assert.equal((await auditRows()).rowCount,1);
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await image.scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('[aria-label="Vehicle custody"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await page.screenshot({path:'.local/review/field-condition-photo-'+photoEngine[0]+'-'+width+'.png'});
  }
  const oldUrl=await image.getAttribute('src'),oldDownload=await downloadLink.getAttribute('href');
  await vehicle.click();
  await expect(image).toHaveCount(0);
  await expect.poll(()=>page.evaluate(url=>window.crestTestRevocations.includes(url),oldUrl)).toBe(true);
  await expect.poll(()=>page.evaluate(url=>window.crestTestRevocations.includes(url),oldDownload)).toBe(true);

  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Cancel this job…',exact:true}).click();
  await page.getByLabel('Cancellation reason',{exact:true}).fill('Synthetic cancellation after verified intake');
  await page.getByLabel('Customer-communication status',{exact:true}).selectOption('not_sent');
  await page.getByRole('button',{name:'Cancel this scheduled job',exact:true}).click();
  await expect(page.locator('.job-change-status')).toContainText('Job cancellation saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await openHistory();
  await panel.getByRole('button',{name:'Record release…',exact:true}).click();
  await panel.getByLabel('Actual handoff time',{exact:true}).fill('2026-11-03T11:15');
  await panel.getByLabel('Who collected the vehicle?',{exact:true}).fill('Synthetic collecting customer');
  await panel.getByLabel('Handoff location',{exact:true}).fill('Synthetic shop bay');
  const releaseSave=panel.getByRole('button',{name:'Save release',exact:true});
  await expect(releaseSave).toBeDisabled();
  await panel.getByLabel('Condition photo (required)',{exact:true}).setInputFiles({
   name:'generated-test-release.png',mimeType:'image/png',buffer:photo});
  await panel.getByRole('button',{name:'Upload and verify photo',exact:true}).click();
  await expect(photoStatus).toHaveText('Photo verified. Save the handoff to link it.');
  await releaseSave.click();
  await expect(panel.getByText('Handoff saved.',{exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'View condition photo',exact:true})).toHaveCount(2);
  const {rows}=await fixture.client.query('SELECT condition_photo_id FROM crest.custody_events WHERE business_id=$1 ORDER BY version',[fixture.business]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].condition_photo_id,scope.photoId);
  assert.notEqual(rows[1].condition_photo_id,scope.photoId);
  assert(rows[1].condition_photo_id);
  assert.equal(fixture.photoStorage.requests.filter(request=>request.method==='PUT'&&request.key.startsWith('staging/')).length,2);
 }finally{try{await browser?.close();}finally{await fixture.close();}}
},{timeout:360000});
