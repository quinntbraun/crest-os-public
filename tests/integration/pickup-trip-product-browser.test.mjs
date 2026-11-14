import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const location=locationText=>({schemaVersion:1,kind:'manual',locationText,instructions:null});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 test(name+' configures pickup policy, records collection, and verifies interrupted saves', {timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL;
  const cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
    quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,
    dropoffCustody:true,dropoffPolicyRevision:true,pickupTrips:true,pickupCollection:true,pickupPolicy:true});
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
    if(!auth.ok)throw Error('Synthetic sign-in proof unavailable');
    const proof=await auth.json();
    const response=await fetch('/api/business/scheduling/'+route,{method:'POST',
     headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
   },{route,body});
   const booking=structuredClone(fixture.bookingRequest);
   delete booking.businessId;
   booking.payload.fulfillmentMode='pickup_return';
   booking.payload.vehicles[0].pickupLocation=location('Synthetic pickup address');
   booking.payload.vehicles[0].returnLocation=location('Synthetic return address');
   assert.deepEqual(await post('book',booking),{status:409,value:{state:'conflict',reason:'mode_disabled'}});
   const initialMode=await post('mode-save',{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:booking.recoveryEpoch,
    expectedSequence:'0',payload:{mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:false,reason:null}});
   assert.equal(initialMode.status,200,JSON.stringify(initialMode.value));
   const arrangements=page.getByRole('form',{name:'Service arrangement settings'});
   async function enablePickup(){
    await arrangements.getByLabel('Pickup and return',{exact:true}).selectOption('enabled');
    await arrangements.getByLabel('Reason for changing service arrangements').fill('Enable in this fictional test');
    await arrangements.getByRole('button',{name:'Save service arrangements'}).click();
   }
   const policy=page.getByRole('region',{name:'Pickup handoff policy settings'});
   const review=page.getByRole('region',{name:'Original save review'});
   async function openPolicy(){
    await page.goto(fixture.origin+'/schedule/modes');
    await page.locator('summary').filter({hasText:/^Pickup handoff policy$/}).click();
    await policy.getByRole('button',{name:'Load pickup policy'}).click();
   }
   await page.goto(fixture.origin+'/schedule/modes');
   await enablePickup();
   await expect(page.getByRole('status').first()).toContainText('Create a pickup handoff policy before enabling');
   await openPolicy();
   await expect(policy.getByRole('status')).toHaveText('No pickup policy is saved.');
   await policy.getByRole('button',{name:'Create pickup policy'}).click();
   await policy.getByLabel('Condition photos').selectOption('reason');
   await policy.getByLabel('Handoff acknowledgement').fill('Synthetic permission to transport this vehicle.');
   await policy.getByRole('button',{name:'Save pickup policy'}).click();
   await expect(policy.getByRole('status')).toHaveText('Pickup policy saved.');
   await expect(policy.getByText('Version 1',{exact:true})).toBeVisible();
   await expect(arrangements.getByLabel('Pickup and return',{exact:true})).toHaveValue('disabled');
   await enablePickup();
   await expect(page.getByRole('status').first()).toHaveText('Service arrangements saved. Review the retained settings and their history.');
   booking.expectedModeSequence='2';
   assert.equal((await post('book',booking)).status,200);
   await openPolicy();
   await expect(policy.getByRole('status')).toHaveText('Saved pickup policy loaded.');
   await policy.getByRole('button',{name:'Edit pickup policy'}).click();
   await policy.getByLabel('Condition photos').selectOption('required');
   await policy.getByLabel('Handoff acknowledgement').fill('');
   await policy.getByLabel('Reason for revision').fill('Retain verified synthetic condition photos for later bookings');
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('section[aria-label="Pickup handoff policy settings"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await policy.locator('form').evaluate(form=>form.scrollIntoView({block:'center'}));
    await policy.getByRole('button',{name:'Save pickup policy'}).click({trial:true});
    await policy.locator('form').screenshot({path:'.local/review/field-pickup-policy-'+name+'-'+width+'.png'});
   }
   const policyKey='crest.pickup-policy.pending-reference.v1';
   let policyStatus;
   await page.route('**/pickup-policy-save',async route=>{
    policyStatus=(await route.fetch()).status();
    await route.abort();
   },{times:1});
   await policy.getByRole('button',{name:'Save pickup policy'}).focus();
   await page.keyboard.press('Enter');
   await expect(policy.getByRole('status')).toContainText('could not be confirmed');
   assert.equal(policyStatus,200);
   const retainedPolicy=await page.evaluate(key=>sessionStorage.getItem(key),policyKey);
   assert(retainedPolicy&&!retainedPolicy.includes('Synthetic')&&!retainedPolicy.includes('acknowledgement'));
   await policy.getByRole('link',{name:'Open Save review'}).click();
   await review.getByRole('button',{name:'Check original resolution'}).click();
   await review.getByRole('button',{name:'Verify original save receipt'}).click();
   await expect(review.getByRole('status')).toContainText('receipt is verified');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),policyKey),null);
   await openPolicy();
   await expect(policy.getByRole('status')).toHaveText('Saved pickup policy loaded.');
   await expect(policy.getByText('Version 2',{exact:true})).toBeVisible();
   await expect(policy.getByText('None configured')).toBeVisible();
   await policy.locator('summary').filter({hasText:/^Earlier pickup policies$/}).click();
   await expect(policy.getByText('Synthetic permission to transport this vehicle.')).toBeVisible();
   const policyEvidence=await fixture.client.query(
    'SELECT p.sequence::text FROM crest_private.pickup_job_policies b JOIN crest_private.pickup_custody_policies p ON p.business_id=b.business_id AND p.id=b.policy_id WHERE b.job_id=$1',[booking.jobId]);
   assert.deepEqual(policyEvidence.rows,[{sequence:'1'}]);
   const jobPath='/schedule?job='+booking.jobId;
   const vehiclePanel=page.getByRole('region',{name:'Vehicles for this job'}).locator('details').first();
   const collection=vehiclePanel.getByRole('region',{name:'Pickup vehicle collection'});
   async function openCollection(){
    await vehiclePanel.locator('summary').click();
    await collection.getByRole('button',{name:'Load pickup collection'}).click();
   }
   const panel=page.locator('details').filter({has:page.locator('summary').filter({hasText:/^Pickup travel$/})});
   async function openTravel(){
    await page.goto(fixture.origin+jobPath);
    await page.locator('summary').filter({hasText:/^Pickup travel$/}).click();
    await panel.getByRole('button',{name:'Load pickup travel',exact:true}).click();
    await expect(panel.getByRole('status')).toHaveText('Saved pickup travel loaded.');
   }
   await openTravel();
   await expect(panel.getByText('No pickup trip has been recorded.')).toBeVisible();
   await openCollection();
   await expect(collection.getByRole('status')).toContainText('Record arrival at');
   await expect(collection.getByRole('button',{name:'Save vehicle collection'})).toHaveCount(0);
   await vehiclePanel.locator('summary').click();
   await expect(panel.getByText('Pickup stop Synthetic pickup address')).toBeVisible();
   await panel.getByLabel('Vehicle you are driving').selectOption(fixture.fieldVehicleId);
   await panel.getByLabel('Where are you leaving from?').fill('Synthetic Crest garage');
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await panel.getByRole('button',{name:'Record pickup departure'}).scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('.schedule-detail')
     .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-departure-'+name+'-'+width+'.png'});
   }
   await panel.getByRole('button',{name:'Record pickup departure'}).focus();
   await page.keyboard.press('Enter');
   await expect(panel.getByRole('status')).toHaveText('Pickup departure saved.');
   await expect(panel.getByText('Traveling to pickup',{exact:true})).toBeVisible();
   let savedStatus;
   await page.route('**/pickup-trip-save',async route=>{
    const saved=await route.fetch();
    savedStatus=saved.status();
    await route.abort();
   },{times:1});
   await panel.getByRole('button',{name:'Record pickup arrival'}).click();
   await expect(panel.getByRole('status')).toContainText('could not be confirmed');
   assert.equal(savedStatus,200);
   const key='crest.pickup-trip.pending-reference.v1';
   const reference=await page.evaluate(key=>sessionStorage.getItem(key),key);
   assert(reference&&!reference.includes('Synthetic')&&!reference.includes('destination'));
   await panel.getByRole('link',{name:'Open Save review'}).click();
   await review.getByRole('button',{name:'Check original resolution'}).click();
   await review.getByRole('button',{name:'Verify original save receipt'}).click();
   await expect(review.getByRole('status')).toContainText('receipt is verified');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
   await openTravel();
   await expect(panel.getByText('Arrived at pickup',{exact:true})).toBeVisible();
   await openCollection();
   await expect(collection.getByRole('status')).toHaveText('Ready to record collection.');
   const handoffName='Synthetic handing-over person with a long multi-part family name';
   await collection.getByLabel('Who handed over the vehicle?').fill(handoffName);
   await collection.getByLabel('Actual handoff location').fill('Synthetic pickup address');
   await collection.getByLabel('Why is a condition photo missing?').fill('Camera unavailable during synthetic handoff');
   await collection.getByRole('button',{name:'Save vehicle collection'}).click();
   await expect(collection.getByRole('status')).toHaveText('Ready to record collection.');
   await collection.getByRole('checkbox',{name:'Record the required acknowledgement'}).check();
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await collection.getByRole('button',{name:'Save vehicle collection'}).scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('.schedule-detail').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await collection.locator('form').screenshot({path:'.local/review/field-pickup-collection-'+name+'-'+width+'.png'});
   }
   const collectionKey='crest.pickup-collection.pending-reference.v1';
   let collectionStatus;
   await page.route('**/pickup-collection-save',async route=>{
    collectionStatus=(await route.fetch()).status();
    await route.abort();
   },{times:1});
   await collection.getByRole('button',{name:'Save vehicle collection'}).focus();
   await page.keyboard.press('Enter');
   await expect(collection.getByRole('status')).toContainText('could not be confirmed');
   assert.equal(collectionStatus,200);
   const collectionReference=await page.evaluate(key=>sessionStorage.getItem(key),collectionKey);
   assert(collectionReference&&!collectionReference.includes('Synthetic')&&!collectionReference.includes('notes'));
   await collection.getByRole('link',{name:'Open Save review'}).click();
   await review.getByRole('button',{name:'Check original resolution'}).click();
   await review.getByRole('button',{name:'Verify original save receipt'}).click();
   await expect(review.getByRole('status')).toContainText('receipt is verified');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),collectionKey),null);
   await openTravel();
   await openCollection();
   await expect(collection.getByRole('status')).toHaveText('In Crest custody.');
   await expect(collection.getByText(handoffName,{exact:true})).toBeVisible();
   await expect(collection.getByText('Camera unavailable during synthetic handoff')).toBeVisible();
   await expect(collection.getByText('Notes',{exact:true})).toHaveCount(0);
   await vehiclePanel.locator('summary').click();
   await expect(collection.getByText(handoffName,{exact:true})).toHaveCount(0);
   await panel.getByLabel('Vehicle you are driving').selectOption(fixture.fieldVehicleId);
   await panel.getByLabel('Where are you leaving from?').fill('Synthetic Crest garage');
   await panel.getByRole('button',{name:'Record pickup departure'}).click();
   await expect(panel.getByRole('status')).toHaveText('Pickup departure saved.');
   await panel.locator('summary').filter({hasText:/^Stop this pickup trip$/}).click();
   await panel.getByLabel('Actual stop').fill('Synthetic safe stop');
   await panel.getByLabel('Why did the trip stop?').fill('Customer unavailable');
   await page.route('**/pickup-trips',route=>route.fulfill({status:429,
    headers:{'cache-control':'private, no-store','retry-after':'60'},
    json:{error:'SCHEDULING_REQUEST_LIMITED'}}),{times:1});
   await panel.getByRole('button',{name:'Record stopped trip'}).click();
   await expect(panel.getByRole('status')).toHaveText('Pickup trip stopped. History requests are temporarily limited. Wait a minute before reloading.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
   await panel.getByRole('button',{name:'Load pickup travel',exact:true}).click();
   await expect(panel.getByRole('status')).toHaveText('Saved pickup travel loaded.');
   await expect(panel.getByText('Pickup trip stopped',{exact:true})).toBeVisible();
   await expect(panel.getByText('Stopped at Synthetic safe stop',{exact:false})).toBeVisible();
   const {rows:[job]}=await fixture.client.query(
    'SELECT state,(SELECT count(*)::int FROM crest.work_intervals WHERE job_id=$1) work,(SELECT count(*)::int FROM crest.custody_cases WHERE job_id=$1) custody FROM crest.jobs WHERE id=$1',
    [booking.jobId]);
   assert.deepEqual(job,{state:'scheduled',work:0,custody:0});
   const pickupCustody=await fixture.client.query(
    'SELECT person_snapshot,notes,acknowledgement_confirmed FROM crest_private.pickup_custody_collections WHERE job_id=$1',[booking.jobId]);
   assert.deepEqual(pickupCustody.rows,[{person_snapshot:{schemaVersion:1,displayName:handoffName},notes:null,acknowledgement_confirmed:true}]);
   await page.locator('summary').filter({hasText:/^Pickup travel$/}).click();
   await expect(panel.getByRole('region',{name:'Saved pickup trips'})).toHaveCount(0);
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
