import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 test(name+' revises the future Drop-Off policy and verifies a lost save receipt', {timeout:240000},async()=>{
  const previousDatabase=process.env.CREST_TEST_DATABASE_URL;
  const cluster=previousDatabase?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
    quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,
    dropoffCustody:true,dropoffPolicyRevision:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
   const page=await context.newPage();
   page.setDefaultTimeout(20000);
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
   const booking=structuredClone(fixture.bookingRequest);
   delete booking.businessId;
   booking.payload.fulfillmentMode='dropoff';
   const booked=await page.evaluate(async body=>{
    const auth=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    if(!auth.ok)throw Error('Synthetic sign-in proof unavailable');
    const proof=await auth.json();
    const response=await fetch('/api/business/scheduling/book',{method:'POST',
     headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
    return {status:response.status,state:(await response.json()).state};
   },booking);
   assert.deepEqual(booked,{status:200,state:'committed'});

   async function loadPolicy(){
    await page.getByText('Drop-Off handoff policy',{exact:true}).click();
    const panel=page.getByRole('region',{name:'Selected Drop-Off policy'});
    await panel.getByRole('button',{name:'Load Drop-Off policy',exact:true}).click();
    return panel;
   }
   await page.goto(fixture.origin+'/schedule/modes');
   const panel=await loadPolicy();
   const status=panel.getByRole('status');
   await expect(status).toHaveText('No policy is saved for this arrangement.');
   await panel.getByLabel('Condition photo requirement',{exact:true}).selectOption('reason');
   await panel.getByLabel('Handoff acknowledgement (optional)',{exact:true}).fill('Prior synthetic instructions');
   await panel.getByRole('button',{name:'Save Drop-Off policy',exact:true}).click();
   await expect(status).toHaveText('Drop-Off policy saved.');
   const revise=panel.getByRole('button',{name:'Revise for future bookings',exact:true});
   await revise.focus();
   await page.keyboard.press('Enter');
   await panel.getByLabel('Condition photo requirement',{exact:true}).selectOption('required');
   await panel.getByLabel('Handoff acknowledgement (optional)',{exact:true}).fill('');
   await panel.getByLabel('Reason for the revision',{exact:true}).fill('Require a documented photo at handoff.');
   const directory=join(process.cwd(),'.local','review');
   await mkdir(directory,{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await panel.getByLabel('Condition photo requirement',{exact:true}).scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Selected Drop-Off policy"]')
     .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:join(directory,'field-dropoff-policy-revision-'+name+'-'+width+'.png')});
   }
   let responseStatus;
   await page.route('**/custody-policy-revise',async route=>{
    const response=await route.fetch();responseStatus=response.status();
    await route.abort();
   },{times:1});
   await panel.getByRole('button',{name:'Save policy revision',exact:true}).click();
   await expect(status).toContainText('could not be confirmed');
   assert.equal(responseStatus,200);
   const reference=await page.evaluate(()=>sessionStorage.getItem('crest.dropoff-policy-revision.pending-reference.v1'));
   assert(reference&&!reference.includes('Require a documented photo')&&!reference.includes('Prior synthetic instructions'));
   await panel.getByRole('link',{name:'Open policy Save review',exact:true}).click();
   const review=page.getByRole('region',{name:'Original save review'});
   await review.getByRole('button',{name:'Check original resolution',exact:true}).click();
   await review.getByRole('button',{name:'Verify original save receipt',exact:true}).click();
   await expect(review.getByRole('status')).toContainText('receipt is verified');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.dropoff-policy-revision.pending-reference.v1')),null);

   await page.goto(fixture.origin+'/schedule/modes');
   const saved=await loadPolicy();
   await expect(saved.getByRole('status')).toHaveText('Saved Drop-Off policy loaded.');
   await expect(saved.getByText('Verified photo required',{exact:true})).toBeVisible();
   await expect(saved.getByText('No acknowledgement configured',{exact:true})).toBeVisible();
   await page.getByLabel('Saved service arrangement',{exact:true}).selectOption({label:'Version 1'});
   await saved.getByRole('button',{name:'Load Drop-Off policy',exact:true}).click();
   await expect(saved.getByText('Prior synthetic instructions',{exact:true})).toBeVisible();
   await expect(saved.getByRole('button',{name:'Revise for future bookings',exact:true})).toHaveCount(0);
   await page.getByText('Saved arrangement history · version 2',{exact:true}).click();
   const started=page.waitForEvent('download');
   await page.getByRole('button',{name:'Download arrangement history',exact:true}).click();
   const download=await started;
   assert.equal(download.suggestedFilename(),'crest-service-arrangements.zip');
   const stream=await download.createReadStream(),chunks=[];
   assert(stream);
   for await(const bytes of stream)chunks.push(bytes);
   const parts=unzipSync(Buffer.concat(chunks));
   const retained=JSON.parse(strFromU8(parts['saved_history.json']));
   assert.deepEqual(retained.versions.map(row=>[row.sequence,row.dropoff_enabled]),[['1',true],['2',true]]);
   assert(strFromU8(parts['service_arrangements.csv']).includes('Require a documented photo at handoff.'));
  }finally{
   try{await browser?.close();}finally{
    try{await fixture?.close();}finally{
     if(previousDatabase===undefined)delete process.env.CREST_TEST_DATABASE_URL;
     else process.env.CREST_TEST_DATABASE_URL=previousDatabase;
     await cluster?.close();
    }
   }
  }
 });
}
