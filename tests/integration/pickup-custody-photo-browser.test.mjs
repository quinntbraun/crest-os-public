import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import sharp from 'sharp';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const place=locationText=>({schemaVersion:1,kind:'manual',locationText,instructions:null});
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 test(name+' verifies a private pickup photo, collects the vehicle, and reopens the original',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   const imageBytes=await sharp({create:{width:160,height:90,channels:3,background:'#9b702a'}})
    .withExif({IFD0:{Copyright:'Generated Crest test image'}}).png().toBuffer();
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,
    scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,dropoffCustody:true,dropoffPolicyRevision:true,
    pickupTrips:true,pickupCollection:true,pickupPolicy:true,pickupPhotos:true,photoFixture:imageBytes});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   await page.goto(fixture.origin+'/sign-in');
   const {email,password,code}=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(email);
   await page.getByLabel('Password',{exact:true}).fill(password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
   const post=(route,body)=>page.evaluate(async({route,body})=>{
    const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!auth.ok)throw Error('Synthetic sign-in proof unavailable');
    const proof=await auth.json(),response=await fetch('/api/business/scheduling/'+route,{method:'POST',
     headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
    const type=response.headers.get('content-type')??'';
    return {status:response.status,type,value:type.startsWith('application/json')?await response.json():null};
   },{route,body});
   const booking=structuredClone(fixture.bookingRequest);delete booking.businessId;
   const command=()=>({schemaVersion:1,operationId:randomUUID(),recoveryEpoch:booking.recoveryEpoch});
   const arrange=enabled=>({mobileEnabled:true,dropoffEnabled:true,pickupReturnEnabled:enabled,reason:enabled?'Synthetic pickup authorization':null});
   assert.equal((await post('mode-save',{...command(),expectedSequence:'0',payload:arrange(false)})).status,200);
   assert.equal((await post('pickup-policy-save',{...command(),expectedSequence:'0',
    body:{acknowledgementText:null,conditionPhotoRequired:true,reason:null}})).status,200);
   assert.equal((await post('mode-save',{...command(),expectedSequence:'1',payload:arrange(true)})).status,200);
   booking.expectedModeSequence='2';
   booking.payload.fulfillmentMode='pickup_return';
   booking.payload.vehicles[0].pickupLocation=place('Synthetic pickup address');
   booking.payload.vehicles[0].returnLocation=place('Synthetic return address');
   assert.equal((await post('book',booking)).status,200);
   const jobVehicleId=(await fixture.client.query('SELECT id FROM crest.job_vehicles WHERE job_id=$1',[booking.jobId])).rows[0].id;
   const legId=randomUUID(),trip={jobId:booking.jobId,expectedJobVersion:'1',legId};
   const departure=await post('pickup-trip-save',{...command(),...trip,expectedLegVersionId:null,body:{action:'depart',reason:null,
    trip:{jobVehicleIds:[jobVehicleId],drivenVehicleId:fixture.fieldVehicleId,origin:place('Synthetic Crest garage'),etaAt:null,notes:null}}});
   assert.equal(departure.status,200,JSON.stringify(departure.value));
   const arrived=await post('pickup-trip-save',{...command(),...trip,expectedLegVersionId:legId,body:{action:'arrive',reason:null,trip:null}});
   assert.equal(arrived.status,200,JSON.stringify(arrived.value));
   const jobPath=fixture.origin+'/schedule?job='+booking.jobId;
   const vehicle=page.getByRole('region',{name:'Vehicles for this job'}).locator('summary').first();
   const collection=page.getByRole('region',{name:'Pickup vehicle collection'});
   async function openCollection(){
    await page.goto(jobPath);
    await vehicle.click();
    await collection.getByRole('button',{name:'Load pickup collection',exact:true}).click();
   }
   await openCollection();
   await expect(collection.getByRole('status',{name:'',exact:true})).toHaveText('Upload a verified condition photo to record collection.');
   const save=collection.getByRole('button',{name:'Save vehicle collection',exact:true});
   await expect(save).toBeDisabled();
   await collection.getByLabel('Who handed over the vehicle?').fill('Synthetic owner at handoff');
   await collection.getByLabel('Actual handoff location').fill('Synthetic pickup address');
   await collection.getByLabel('Condition photo (required)',{exact:true}).setInputFiles({
    name:'generated-pickup-condition.png',mimeType:'image/png',buffer:imageBytes});
   // Abort the first browser transfer before any bytes are sent. Let the
   // second file transfer use the browser's own binary request framing.
   await page.route('**/custody-photo/upload',route=>route.abort(),{times:1});
   await collection.getByRole('button',{name:'Upload and verify photo'}).click();
   const photoStatus=collection.getByRole('status',{name:'Condition photo status'});
   await expect(photoStatus).toContainText('could not be confirmed');
   assert.equal(fixture.photoStorage.requests.length,0);
   await expect(save).toBeDisabled();
   await collection.getByRole('button',{name:'Check photo status'}).click();
   await expect(photoStatus).toContainText('photo is pending');
   let verifiedStatus;
   await page.route('**/custody-photo/verify',async route=>{
    verifiedStatus=(await route.fetch()).status();
    await route.abort();
   },{times:1});
   const upload=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/custody-photo/upload'));
   await collection.getByRole('button',{name:'Upload selected photo again'}).click();
   assert.equal((await upload).status(),200);
   await expect(photoStatus).toContainText('could not be confirmed');
   assert.equal(verifiedStatus,200);
   await expect(save).toBeDisabled();
   await collection.getByRole('button',{name:'Check photo status'}).click();
   await expect(photoStatus).toHaveText('Photo verified. Save the handoff to link it.');
   await expect(save).toBeEnabled();
   const slot=(await fixture.client.query('SELECT photo_id,collection_id FROM crest_private.pickup_photo_slots WHERE job_id=$1',[booking.jobId])).rows[0];
   assert(slot);
   const scope={jobVehicleId,photoId:slot.photo_id};
   assert.equal((await post('custody-photo/file',{...scope,variant:'preview'})).status,400);
   assert.equal((await post('custody-photo/file',{...scope,variant:'original'})).status,400);
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await save.evaluate(button=>button.scrollIntoView({block:'center'}));
    await save.click({trial:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('section[aria-label="Pickup vehicle collection"]')
     .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/field-pickup-photo-'+name+'-'+width+'.png'});
   }
   await save.focus();await page.keyboard.press('Enter');
   await expect(collection.getByRole('status',{name:'',exact:true})).toHaveText('Vehicle collection saved.');
   await openCollection();
   await expect(collection.getByRole('status',{name:'',exact:true})).toHaveText('In Crest custody.');
   await collection.getByRole('button',{name:'View condition photo'}).click();
   const preview=collection.getByRole('img',{name:'Saved vehicle condition photo'});
   await expect(preview).toBeVisible();
   assert(await preview.evaluate(async image=>{await image.decode();return image.naturalWidth>0;}));
   assert.equal((await post('custody-photo/file',{jobVehicleId:randomUUID(),photoId:slot.photo_id,variant:'preview'})).status,400);
   await collection.getByRole('button',{name:'Prepare original download'}).click();
   const link=collection.getByRole('link',{name:'Save original file'});
   await expect(link).toBeVisible();
   await page.setViewportSize({width:390,height:900});
   await collection.screenshot({path:'.local/review/field-pickup-photo-saved-'+name+'-390.png'});
   const downloading=page.waitForEvent('download');
   await link.click();
   const download=await downloading;
   assert.equal(download.suggestedFilename(),'condition-'+slot.photo_id+'.png');
   assert.deepEqual(await readFile(await download.path()),imageBytes);
   assert.equal(fixture.photoStorage.requests.filter(request=>request.method==='PUT'&&request.key.startsWith('staging/')).length,1);
   const saved=(await fixture.client.query('SELECT id,condition_photo_id,missing_photo_reason FROM crest_private.pickup_custody_collections WHERE job_id=$1',[booking.jobId])).rows;
   assert.deepEqual(saved,[{id:slot.collection_id,condition_photo_id:slot.photo_id,missing_photo_reason:null}]);
   await vehicle.click();
   await expect(preview).toHaveCount(0);
   await expect(link).toHaveCount(0);
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
