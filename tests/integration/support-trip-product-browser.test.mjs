import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {strFromU8,unzipSync} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' standalone travel and recovered save',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobMileage:true,supportTrips:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const status=page.locator('.job-change-status');
  await page.goto(fixture.origin+'/schedule/travel');
  await expect(status).toHaveText('Sign in to view saved travel.');
  const closed=await page.request.post(fixture.origin+'/api/business/scheduling/support-trips',{data:{
   afterDepartedAt:null,afterLegId:null,pageSize:20
  }});
  assert(!closed.ok());
  await page.getByRole('link',{name:'Sign in to view travel'}).click();
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  await page.goto(fixture.origin+'/schedule');
  await page.getByRole('link',{name:'Standalone travel',exact:true}).click();
  await expect(status).toHaveText('Saved travel loaded.');
  await expect(page.getByText('No standalone trip is in progress.',{exact:true})).toBeVisible();
  const start=page.getByRole('form',{name:'Start a trip',exact:true});
  async function route(form,kind,origin,destination){
   await form.getByLabel('Purpose',{exact:true}).selectOption(kind);
   await form.getByLabel('Vehicle you are driving',{exact:true}).selectOption(fixture.fieldVehicleId);
   await form.getByLabel('Leaving from',{exact:true}).fill(origin);
   await form.getByLabel('Going to',{exact:true}).fill(destination);
  }
  async function capture(stage){
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(v=>v.id),[]);
    await page.screenshot({path:'.local/review/travel-'+stage+'-'+name+'-'+width+'.png',fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
  }
  await route(start,'supply','Synthetic equipment base','Synthetic supply shop');
  const notes='  Synthetic trip note  ';
  await start.getByLabel('Notes (optional)',{exact:true}).fill(notes);
  const startButton=start.getByRole('button',{name:'Start a trip',exact:true});
  await startButton.focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('Trip saved.');
  const active=page.getByRole('region',{name:'Active trip',exact:true});
  await expect(active).toContainText('Supply run · In progress');
  await expect(active.getByRole('link',{name:'Review trip mileage'})).toHaveCount(0);
  await page.reload();
  await expect(active).toContainText('Synthetic supply shop');
  await capture('active');
  let arrivals=0;
  const pattern='**/api/business/scheduling/support-trip-save';
  await page.route(pattern,async route=>{
   arrivals++;
   const response=await route.fetch();
   if(name==='webkit')await route.abort('failed');
   else await route.fulfill({response});
  });
  await active.getByRole('button',{name:'Record arrival',exact:true}).click();
  if(name==='webkit'){
   await expect(status).toContainText('The save outcome is unknown');
   const pending=await page.evaluate(()=>sessionStorage.getItem('crest.support-trip.pending-reference.v1'));
   assert(pending&&!pending.includes('Synthetic supply shop'));
   await page.reload();
   await page.getByRole('button',{name:'Check original trip',exact:true}).click();
  }
  await expect(status).toHaveText('Trip saved.');
  assert.equal(arrivals,1);
  await page.unroute(pattern);
  const recent=page.getByRole('region',{name:'Recent saved trips'});
  const supply=recent.getByRole('button',{name:/Supply run/});
  await supply.click();
  const history=page.getByRole('region',{name:'Saved trip history',exact:true});
  await expect(history).toContainText('Version 1');
  await expect(history.getByRole('heading',{name:'Saved trip history'})).toBeFocused();
  await expect(history).toContainText('Version 2');
  const exactBefore=(await fixture.client.query(
   'SELECT departed_at::text,arrived_at::text,notes FROM crest.current_travel_legs WHERE business_id=$1 AND purpose=$2',
   [fixture.business,'supply'])).rows[0];
  assert.equal(exactBefore.notes,notes);
  await history.locator('summary').filter({hasText:'Correct saved trip'}).click();
  const correction=history.getByRole('form',{name:'Correct saved trip',exact:true});
  await correction.getByLabel('Going to',{exact:true}).fill('Synthetic corrected supply shop');
  await correction.getByLabel('Reason for correction',{exact:true}).fill('Synthetic destination correction');
  await correction.getByRole('button',{name:'Correct saved trip',exact:true}).click();
  await expect(status).toHaveText('Trip saved.');
  await supply.click();
  await expect(history).toContainText('Version 3');
  await expect(history).toContainText('Synthetic destination correction');
  await expect(history).toContainText('Synthetic supply shop');
  assert.deepEqual((await fixture.client.query(
   'SELECT departed_at::text,arrived_at::text,notes FROM crest.current_travel_legs WHERE business_id=$1 AND purpose=$2',
   [fixture.business,'supply'])).rows[0],exactBefore);
  const [travelFile]=await Promise.all([page.waitForEvent('download'),
   history.getByRole('button',{name:'Download trip history (JSON)',exact:true}).click()]);
  assert.equal(travelFile.suggestedFilename(),'crest-standalone-trip-history.json');
  const travelExport=JSON.parse(await readFile(await travelFile.path(),'utf8'));
  assert.deepEqual(travelExport.trips.map(trip=>trip.sequence),['1','2','3']);
  assert.equal(travelExport.trips[2].notes,notes);
  assert.equal(travelExport.completeBackup,false);
  await capture('history');
  await history.getByRole('link',{name:'Review trip mileage',exact:true}).click();
  await expect(status).toHaveText('Saved mileage history loaded.');
  await expect(page.getByText('No mileage has been saved for this trip.',{exact:true})).toBeVisible();
  await page.getByLabel('Actual miles',{exact:true}).fill('4.125');
  await page.getByRole('button',{name:'Save mileage',exact:true}).click();
  await expect(status).toHaveText('Mileage saved.');
  await page.reload();
  await expect(page.getByText(/4\.1250 actual miles/)).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),
   page.getByRole('button',{name:'Download loaded history (CSV + JSON)',exact:true}).click()]);
  const files=unzipSync(await readFile(await download.path()));
  const exported=JSON.parse(strFromU8(files['mileage_history.json']));
  assert.equal(exported.evidence[0].actual_miles,'4.1250');
  assert.equal(exported.evidence[0].allocation_state,'unallocated');
  assert.deepEqual(exported.allocations,[]);
  await capture('mileage');
  await page.getByRole('link',{name:'Standalone travel',exact:true}).click();
  await expect(status).toHaveText('Saved travel loaded.');
  await page.locator('summary').filter({hasText:'Record an earlier trip'}).click();
  const earlier=page.getByRole('form',{name:'Record an earlier trip',exact:true});
  await route(earlier,'return_to_base','Synthetic lot','Synthetic base');
  await earlier.getByLabel('Actual departure',{exact:true}).fill('2026-08-18T10:15');
  await earlier.getByLabel('Actual stop time',{exact:true}).fill('2026-08-18T10:35');
  await earlier.getByLabel('Reason for recording now',{exact:true}).fill('Synthetic paper log');
  await earlier.getByRole('button',{name:'Record an earlier trip',exact:true}).click();
  await expect(status).toHaveText('Trip saved.');
  await expect(recent.getByRole('button',{name:/Return to base/})).toBeVisible();
  await route(start,'between_jobs','Synthetic departure','Synthetic destination');
  await startButton.click();
  await expect(status).toHaveText('Trip saved.');
  await active.getByText('Cancel this trip',{exact:true}).click();
  await active.getByLabel('Actual stop location',{exact:true}).fill('Synthetic actual stop');
  await active.getByLabel('Reason for cancellation',{exact:true}).fill('Synthetic cancellation');
  await active.getByRole('button',{name:'Record cancellation',exact:true}).click();
  await expect(status).toHaveText('Trip saved.');
  await expect(recent).toContainText('Cancelled · Synthetic departure → Synthetic actual stop');
  const facts=await fixture.client.query('SELECT count(*)::int AS jobs FROM crest.jobs WHERE business_id=$1',[fixture.business]);
  assert.equal(facts.rows[0].jobs,0);
 }finally{
  await browser?.close();
  await fixture.close();
 }
});
