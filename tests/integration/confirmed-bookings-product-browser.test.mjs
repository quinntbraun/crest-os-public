// Genuine MFA and compiled Next/Node/registered50. Native command setup is
// explicit test data; this does not claim the unfinished booking form works.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' genuine saved-job review, history retrieval, refresh and privacy',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  await page.goto(f.origin+'/schedule');await expect(page.locator('.schedule-status')).toHaveText('Sign in to view your schedule.');await page.getByRole('link',{name:'Sign in to view your schedule',exact:true}).click();
  const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const booked=await page.evaluate(async input=>{
   const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!session.ok)return{status:session.status};const proof=await session.json(),{businessId,...body}=input;void businessId;
   const response=await fetch('/api/business/scheduling/book',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});return{status:response.status,value:await response.json()};
  },f.bookingRequest);assert.equal(booked.status,200);assert.equal(booked.value.state,'committed');
  await page.goto(f.origin+'/schedule');await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');
  async function search(){await page.getByLabel('From date',{exact:true}).fill('2026-11-03');await page.getByLabel('Through date',{exact:true}).fill('2026-11-03');await page.getByRole('button',{name:'Load saved schedule',exact:true}).click();await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');}
  await search();await page.getByRole('button',{name:'Synthetic lifecycle customer · View job',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();await expect(page.getByRole("region",{name:"Job review",exact:true})).toBeFocused();await expect(page.getByText('Synthetic workshop, 123 Example Lane, Indianapolis',{exact:true})).toBeVisible();await expect(page.getByText('No proposed time changes recorded.',{exact:true})).toBeVisible();
  await page.getByText('Saved history · version 1',{exact:true}).click();await expect(page.getByText('Job booked',{exact:true})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved history',exact:true}).focus();await page.keyboard.press('Enter');const download=await downloadEvent;assert.equal(await download.failure(),null);const files=unzipSync(await readFile(await download.path()));assert(Object.keys(files).some(file=>file.endsWith('.csv')));assert(Object.values(files).some(bytes=>strFromU8(bytes).includes('crest.confirmed-job-history.v1')));
  await mkdir('.local/review',{recursive:true});for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);await page.screenshot({path:'.local/review/schedule-'+name+'-'+width+'.png',fullPage:true});}
  await page.reload();await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');await search();await page.getByRole('button',{name:'Synthetic lifecycle customer · View job',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();
  await page.route('**/api/business/scheduling/resources',route=>route.abort('failed'));await page.getByRole('button',{name:'Synthetic lifecycle customer · View job',exact:true}).click();await expect(page.locator('.schedule-status')).toContainText('could not be verified');await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toHaveCount(0);await page.unroute('**/api/business/scheduling/resources');await page.getByRole('button',{name:'Check schedule access',exact:true}).click();await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');
  await page.goto(f.origin+'/');await page.goBack();const check=page.getByRole('button',{name:'Check schedule access',exact:true});if(await check.isVisible())await check.click();await expect(page.locator('.schedule-status')).toContainText('Saved schedule loaded.');assert.equal((await f.client.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,51);
 }finally{await browser?.close();await f.close();}
},{timeout:240000});
