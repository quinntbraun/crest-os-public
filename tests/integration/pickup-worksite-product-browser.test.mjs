
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const location=locationText=>({schemaVersion:1,kind:'manual',locationText,instructions:null});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 test(name+' finds a failed vehicle return from Schedule and completes a later verified handoff', {timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL;
  const cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   const image=await sharp({create:{width:120,height:80,channels:3,background:'#69502c'}}).png().toBuffer();
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
    quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,
    jobCompletion:true,unfulfilledCancellation:true,dropoffCustody:true,dropoffPolicyRevision:true,
    pickupTrips:true,pickupCollection:true,pickupPolicy:true,pickupPhotos:true,pickupReturnWorkflow:true,photoFixture:image});
   browser=await engine.launch();
   const failedRoutes=[];
   async function signIn(){
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
    const page=await context.newPage();page.setDefaultTimeout(20000);
    page.on('response',response=>{
     const path=new URL(response.url()).pathname;
     if(path.startsWith('/api/business/scheduling/')&&response.status()>=400)failedRoutes.push([path,response.status()]);
    });
    await page.goto(fixture.origin+'/sign-in');
    const {email,password,code}=fixture.credentials();
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByLabel('Authenticator code',{exact:true}).fill(code);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    return page;
   }
   let page=await signIn();
   const post=async(route,body)=>{
    const status=await page.evaluate(async({route,body})=>{
     const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
     if(!auth.ok)throw Error('Synthetic sign-in proof unavailable');
     const {csrfToken}=await auth.json();
     const response=await fetch('/api/business/scheduling/'+route,{method:'POST',
      headers:{'content-type':'application/json','x-crest-csrf':csrfToken},body:JSON.stringify(body)});
     return response.status;
    },{route,body});
    assert.equal(status,200,route);
   };
   const booking=structuredClone(fixture.bookingRequest);delete booking.businessId;
   booking.expectedModeSequence='2';
   booking.payload.fulfillmentMode='pickup_return';
   booking.payload.vehicles[0].pickupLocation=location('Synthetic pickup address');
   booking.payload.vehicles[0].returnLocation=location('Synthetic return address');
   const operation=(operationId=randomUUID())=>({schemaVersion:1,operationId,recoveryEpoch:booking.recoveryEpoch});
   const modes=enabled=>({mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:enabled,
    reason:enabled?'Fictional enablement':null});
   await post('mode-save',{...operation(),expectedSequence:'0',payload:modes(false)});
   const policyId=randomUUID();
   await post('pickup-policy-save',{...operation(policyId),expectedSequence:'0',
    body:{acknowledgementText:null,conditionPhotoRequired:true,reason:null}});
   await post('mode-save',{...operation(),expectedSequence:'1',payload:modes(true)});
   await post('book',booking);
   const jobVehicleId=(await fixture.client.query('SELECT id FROM crest.job_vehicles WHERE job_id=$1',[booking.jobId])).rows[0].id;
   const legId=randomUUID(),trip={jobId:booking.jobId,expectedJobVersion:'1',legId};
   await post('pickup-trip-save',{...operation(),...trip,expectedLegVersionId:null,body:{action:'depart',reason:null,
    trip:{jobVehicleIds:[jobVehicleId],drivenVehicleId:fixture.fieldVehicleId,origin:location('Synthetic shop'),etaAt:null,notes:null}}});
   await post('pickup-trip-save',{...operation(),...trip,expectedLegVersionId:legId,body:{action:'arrive',reason:null,trip:null}});
   const jobPath='/schedule?job='+booking.jobId;
   let handoffPanel=page.getByRole('region',{name:'Pickup vehicle collection'});
   let handoffStatus=handoffPanel.getByRole('status',{name:'',exact:true});
   async function loadHandoff(current=page){
    const vehicle=current.locator('summary').filter({hasText:/^Synthetic lifecycle sedan$/});
    try{
     if(!await vehicle.evaluate(summary=>summary.parentElement.open))await vehicle.click();
     await current.getByRole('region',{name:'Pickup vehicle collection'}).getByRole('button',{name:/^(Load|Reload) pickup collection$/}).click();
    }catch(error){
     const status=await current.getByRole('status').allTextContents();
     throw new Error('Could not reopen vehicle handoff '+JSON.stringify({failedRoutes,status}),{cause:error});
    }
   }
   async function conditionPhoto(form,name){
    await form.getByLabel('Condition photo (required)',{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:image});
    await form.getByRole('button',{name:'Upload and verify photo'}).click();
    await expect(form.getByRole('status',{name:'Condition photo status'})).toContainText('Photo verified');
   }
   await page.goto(fixture.origin+jobPath);
   await loadHandoff();
   const intake=handoffPanel.getByRole('group',{name:'Record vehicle collection'});
   await intake.getByLabel('Who handed over the vehicle?').fill('Fictional customer');
   await intake.getByLabel('Actual handoff location').fill('Synthetic pickup address');
   await conditionPhoto(intake,'generated-pickup.png');
   await intake.getByRole('button',{name:'Save vehicle collection'}).click();
   await expect(handoffStatus).toHaveText('Vehicle collection saved.');

   let summary=page.locator('summary').filter({hasText:/^Pickup travel$/});
   let panel=page.locator('details').filter({has:summary});
   const reloadTravel=async()=>{
    try{
     await summary.click();
     await panel.getByRole('button',{name:'Load pickup travel',exact:true}).click();
     await expect(panel.getByRole('status')).toHaveText('Saved pickup travel loaded.');
    }catch(error){throw new Error('Could not reopen pickup travel '+JSON.stringify(failedRoutes),{cause:error});}
   };
   await reloadTravel();
   await expect(panel.getByRole('link',{name:'Start Work'})).toHaveCount(0);
   await panel.getByLabel('Travel task').selectOption('worksite');
   await expect(panel.getByRole('group',{name:'Transport collected vehicles'})).toBeVisible();
   await panel.getByLabel('Vehicle you are driving').selectOption(fixture.fieldVehicleId);
   await panel.getByLabel('Where are you leaving from?').fill('Synthetic pickup address');
   await mkdir('.local/review',{recursive:true});
   const departure=panel.getByRole('button',{name:'Record work-site departure'});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await departure.scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('.schedule-detail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-worksite-'+name+'-'+width+'.png'});
   }
   await departure.focus();await page.keyboard.press('Enter');
   await expect(panel.getByRole('status')).toHaveText('Work-site departure saved.');
   await page.reload();
   await reloadTravel();
   await expect(panel.getByText('Transporting to work site',{exact:true})).toBeVisible();
   await panel.getByRole('button',{name:'Record work-site arrival'}).click();
   await expect(panel.getByRole('status')).toHaveText('Work-site arrival saved.');
   await expect(panel.getByText('Arrived at work site',{exact:true})).toBeVisible();
   await expect(panel.getByLabel('Travel task')).toHaveCount(0);
   const worksiteState=(await fixture.client.query(
    'SELECT state,(SELECT count(*)::int FROM crest.work_intervals WHERE job_id=$1) work FROM crest.jobs WHERE id=$1',[booking.jobId])).rows[0];
   assert.deepEqual(worksiteState,{state:'scheduled',work:0});
   await panel.getByRole('link',{name:'Start Work',exact:true}).click();
   const work=page.getByRole('region',{name:'Pickup work status',exact:true});
   const startWork=work.getByRole('button',{name:'Start Work',exact:true});
   await expect(startWork).toBeVisible();
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await startWork.scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Pickup work status"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-start-work-'+name+'-'+width+'.png'});
   }
   await page.route('**/api/business/scheduling/field-save',async route=>{
    const response=await route.fetch();
    assert.equal(response.status(),200);
    await route.abort();
   },{times:1});
   await startWork.focus();await page.keyboard.press('Enter');
   const status=page.getByRole('status').first();
   await expect(status).toContainText('The save outcome is unknown.');
   await page.getByRole('button',{name:'Check original work action',exact:true}).click();
   await expect(status).toContainText('Work status saved.');
   await page.reload();
   await expect(work.getByText('In progress · Saved version 2',{exact:true})).toBeVisible();
   await expect(work.getByRole('link',{name:'Cancel if no work was completed'})).toBeVisible();
   await work.getByRole('link',{name:'Review and end job',exact:true}).click();
   const completion=page.getByRole('region',{name:'Job completion',exact:true});
   await completion.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
   await completion.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
   await completion.getByRole('button',{name:'End job',exact:true}).click();
   await expect(completion.getByRole('heading',{name:'Full completion',exact:true})).toBeVisible();
   const final=(await fixture.client.query(`
    SELECT state,(SELECT count(*)::int FROM crest.current_work_intervals WHERE job_id=$1 AND ended_at IS NULL) work,
     (SELECT count(*)::int FROM crest_private.vehicle_custody_claims
      WHERE pickup_collection_id IN(SELECT id FROM crest_private.pickup_custody_collections WHERE job_id=$1)) held
    FROM crest.jobs WHERE id=$1`,[booking.jobId])).rows[0];
   assert.deepEqual(final,{state:'completed',work:0,held:1});
   await page.goto(fixture.origin+'/schedule?job='+booking.jobId);
   await reloadTravel();
   const returnForm=panel.getByRole('group',{name:'Return vehicles to customer'});
   await expect(returnForm.getByText('Synthetic return address')).toBeVisible();
   await returnForm.getByLabel('Vehicle you are driving').selectOption(fixture.fieldVehicleId);
   await returnForm.getByLabel('Where are you leaving from?').fill('Synthetic work site');
   const returnDeparture=returnForm.getByRole('button',{name:'Record return departure'});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await returnDeparture.scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('.schedule-detail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-return-travel-'+name+'-'+width+'.png'});
   }
   await returnDeparture.focus();await page.keyboard.press('Enter');
   await expect(panel.getByRole('status')).toHaveText('Return departure saved.');
   await page.reload();
   await reloadTravel();
   await expect(panel.getByText('Returning to customer',{exact:true})).toBeVisible();
   await panel.getByRole('button',{name:'Record return arrival'}).click();
   await expect(panel.getByRole('status')).toHaveText('Return arrival saved.');
   await expect(panel.getByText('Arrived at return stop',{exact:true})).toBeVisible();
   await expect(returnForm).toHaveCount(0);
   const afterReturn=(await fixture.client.query(`
    SELECT (SELECT count(*)::int FROM crest.current_work_intervals WHERE job_id=$1 AND ended_at IS NULL) work,
     (SELECT count(*)::int FROM crest_private.vehicle_custody_claims
      WHERE pickup_collection_id IN(SELECT id FROM crest_private.pickup_custody_collections WHERE job_id=$1)) held
   `,[booking.jobId])).rows[0];
   assert.deepEqual(afterReturn,{work:0,held:1});
   await loadHandoff();
   await expect(handoffStatus).toContainText('still in Crest custody');
   const failureDetails=handoffPanel.locator('summary').filter({hasText:/^Unable to hand over the vehicle\?$/});
   await failureDetails.click();
   const failureForm=handoffPanel.getByRole('group',{name:'Record a failed return'});
   const saveFailure=failureForm.getByRole('button',{name:'Save failed return'});
   await expect(saveFailure).toBeDisabled();
   const failedReason='Fictional recipient was unavailable at the booked stop';
   await failureForm.getByLabel('Why could the vehicle not be handed over?').fill(failedReason);
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await failureForm.evaluate(node=>node.scrollIntoView({block:'center'}));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Pickup vehicle collection"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-return-failed-'+name+'-'+width+'.png'});
   }
   let failureStatus;
   await page.route('**/api/business/scheduling/pickup-return-failure-save',async route=>{
    failureStatus=(await route.fetch()).status();
    await route.abort();
   },{times:1});
   await saveFailure.focus();await page.keyboard.press('Enter');
   await expect(handoffStatus).toContainText('The failed return save could not be confirmed.');
   assert.equal(failureStatus,200);
   const pendingFailure=await page.evaluate(()=>sessionStorage.getItem('crest.pickup-return-failure.pending-reference.v1'));
   assert(pendingFailure&&!pendingFailure.includes(failedReason));
   assert.deepEqual(Object.keys(JSON.parse(pendingFailure).reference).sort(),
    ['collectionId','expectedJobVersion','jobId','operationId','recoveryEpoch','returnLegVersionId']);
   await handoffPanel.getByRole('link',{name:'Open Save review'}).click();
   await page.getByRole('button',{name:'Check original resolution'}).click();
   await page.getByRole('button',{name:'Verify original save receipt'}).click();
   await expect(page.getByRole('status')).toContainText('The original save receipt is verified');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.pickup-return-failure.pending-reference.v1')),null);


   page=await signIn();
   await page.goto(fixture.origin+'/schedule');
   const savedSchedule=page.getByRole('region',{name:'Saved schedule',exact:true});
   try{
    await expect(savedSchedule.getByRole('status').first()).toHaveText('Saved schedule loaded. Proposed changes reserve no new time.');
   }catch(error){
    throw new Error('Could not open Schedule to find a vehicle return '+JSON.stringify({
     failedRoutes,status:await savedSchedule.getByRole('status').allTextContents()
    }),{cause:error});
   }
   await page.locator('summary').filter({hasText:/^Custom date range$/}).click();
   const range=page.getByRole('form',{name:'Schedule date range'});
   await range.getByLabel('Through date',{exact:true}).fill('2026-12-03');
   await range.getByLabel('From date',{exact:true}).fill('2026-12-01');
   await range.getByRole('button',{name:'Load saved schedule',exact:true}).click();
   await expect(page.getByRole('region',{name:'Jobs in selected dates'}).getByText('No saved jobs in this range.')).toBeVisible();
   const queueSummary=page.locator('summary').filter({hasText:/^Vehicles awaiting return$/});
   const queue=page.getByRole('region',{name:'Vehicles awaiting return'});
   await queueSummary.click();
   await page.route('**/api/business/scheduling/pickup-returns',route=>route.abort(),{times:1});
   const loadQueue=queue.getByRole('button',{name:'Load vehicles awaiting return',exact:true});
   await loadQueue.focus();await page.keyboard.press('Enter');
   await expect(queue.getByRole('status')).toHaveText('Vehicles awaiting return could not be verified. Reload to try again.');
   await loadQueue.click();
   await expect(queue.getByText('Handoff unsuccessful · Arrange another trip')).toBeVisible();
   await expect(page.getByRole('region',{name:'Jobs in selected dates'}).getByText('No saved jobs in this range.')).toBeVisible();
   await expect(queue.getByText(failedReason)).toHaveCount(0);
   const openReturn=queue.getByRole('link',{name:'Open return for Synthetic lifecycle sedan'});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await queue.evaluate(node=>node.scrollIntoView({block:'center'}));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Vehicles awaiting return"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-return-queue-'+name+'-'+width+'.png'});
   }
   await queueSummary.click();
   await expect(queue.getByText('Synthetic lifecycle sedan',{exact:false})).toHaveCount(0);
   await queueSummary.click();
   await loadQueue.click();
   await openReturn.focus();await page.keyboard.press('Enter');
   await expect(page).toHaveURL(fixture.origin+jobPath+'&vehicle='+jobVehicleId);
   const selectedVehicle=page.locator('summary').filter({hasText:/^Synthetic lifecycle sedan$/});
   await expect(selectedVehicle).toBeFocused();
   assert(await selectedVehicle.evaluate(summary=>summary.parentElement.open));
   handoffPanel=page.getByRole('region',{name:'Pickup vehicle collection'});
   handoffStatus=handoffPanel.getByRole('status',{name:'',exact:true});
   await loadHandoff();
   await expect(handoffStatus).toContainText('Return could not be completed.');
   await expect(handoffPanel.getByText(failedReason,{exact:true})).toBeVisible();
   await expect(handoffPanel.getByRole('group',{name:'Record return handoff'})).toHaveCount(0);
   summary=page.locator('summary').filter({hasText:/^Pickup travel$/});
   panel=page.locator('details').filter({has:summary});
   await reloadTravel();
   const retry=panel.getByRole('group',{name:'Return vehicles to customer'});
   await retry.getByLabel('Vehicle you are driving').selectOption(fixture.fieldVehicleId);
   await retry.getByLabel('Where are you leaving from?').fill('Fictional safe holding location');
   await retry.getByRole('button',{name:'Record return departure'}).click();
   await expect(panel.getByRole('status')).toHaveText('Return departure saved.');
   await panel.getByRole('button',{name:'Record return arrival'}).click();
   await expect(panel.getByRole('status')).toHaveText('Return arrival saved.');
   await loadHandoff();
   await expect(handoffStatus).toContainText('still in Crest custody');
   await expect(handoffPanel.getByText(failedReason,{exact:true})).toBeVisible();
   const handoff=handoffPanel.getByRole('group',{name:'Record return handoff'});
   const saveReturn=handoff.getByRole('button',{name:'Save return handoff'});
   await expect(saveReturn).toBeDisabled();
   await handoff.getByLabel('Who received the vehicle?').fill('Fictional recipient with a longer name');
   await handoff.getByLabel('Actual handoff location').fill('Synthetic return address');
   await conditionPhoto(handoff,'generated-return.png');
   await expect(saveReturn).toBeEnabled();
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await handoff.evaluate(node=>node.scrollIntoView({block:'center'}));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Pickup vehicle collection"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-return-handoff-'+name+'-'+width+'.png'});
   }
   let responseStatus;
   await page.route('**/api/business/scheduling/pickup-release-save',async route=>{
    responseStatus=(await route.fetch()).status();
    await route.abort();
   },{times:1});
   await saveReturn.focus();await page.keyboard.press('Enter');
   await expect(handoffStatus).toContainText('The return handoff save could not be confirmed.');
   assert.equal(responseStatus,200);
   const retained=await page.evaluate(()=>sessionStorage.getItem('crest.pickup-release.pending-reference.v1'));
   assert(retained&&!retained.includes('Fictional recipient')&&!retained.includes('generated-return'));
   assert.deepEqual(Object.keys(JSON.parse(retained).reference).sort(),['collectionId','expectedJobVersion','jobId','operationId','recoveryEpoch','returnLegVersionId']);
   await handoffPanel.getByRole('link',{name:'Open Save review'}).click();
   await page.getByRole('button',{name:'Check original resolution'}).click();
   await page.getByRole('button',{name:'Verify original save receipt'}).click();
   await expect(page.getByRole('status')).toContainText('The original save receipt is verified');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.pickup-release.pending-reference.v1')),null);
   // Reopen the durable handoff in a separate, genuinely authenticated session.
   // The compressed whole-job fixture approaches the normal per-session limit.
   const reopened=await signIn();
   await reopened.goto(fixture.origin+jobPath);
   await loadHandoff(reopened);
   const savedHandoff=reopened.getByRole('region',{name:'Pickup vehicle collection'});
   await expect(savedHandoff.getByRole('status',{name:'',exact:true})).toHaveText('Vehicle released to the customer.');
   await expect(savedHandoff.getByText('Fictional recipient with a longer name',{exact:true})).toBeVisible();
   await expect(savedHandoff.getByText(failedReason,{exact:true})).toBeVisible();
   const evidence=savedHandoff.getByRole('region',{name:'Return condition evidence'});
   await evidence.getByRole('button',{name:'View condition photo'}).click();
   const savedPhoto=evidence.getByRole('img',{name:'Saved vehicle condition photo'});
   await expect(savedPhoto).toBeVisible();
   assert(await savedPhoto.evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
   await evidence.getByRole('button',{name:'Prepare original download'}).click();
   const downloading=reopened.waitForEvent('download');
   await evidence.getByRole('link',{name:'Save original file'}).click();
   assert.deepEqual(await readFile(await (await downloading).path()),image);
   assert.equal((await fixture.client.query(`
    SELECT count(*)::int held FROM crest_private.vehicle_custody_claims WHERE pickup_collection_id IN(
     SELECT id FROM crest_private.pickup_custody_collections WHERE job_id=$1)`,[booking.jobId])).rows[0].held,0);
   await reopened.goto(fixture.origin+'/schedule');
   await reopened.locator('summary').filter({hasText:/^Vehicles awaiting return$/}).click();
   const reopenedQueue=reopened.getByRole('region',{name:'Vehicles awaiting return'});
   await reopenedQueue.getByRole('button',{name:'Load vehicles awaiting return',exact:true}).click();
   await expect(reopenedQueue.getByRole('status')).toHaveText('No pickup vehicles are awaiting return.');
   assert.deepEqual(failedRoutes,[]);
  }finally{
   try{await browser?.close();}finally{
    try{await fixture?.close();}finally{
     if(previous===undefined)delete process.env.CREST_TEST_DATABASE_URL;
     else process.env.CREST_TEST_DATABASE_URL=previous;
     await cluster?.close();
    }
   }
  }
 });
}
