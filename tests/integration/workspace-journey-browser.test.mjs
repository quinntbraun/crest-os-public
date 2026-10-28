// Actual product pages + genuine provider MFA, restricted SQL and retained
// history. Synthetic TLS exceptions are confined to this disposable test.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' complete signed-in customer / vehicle workspace journey',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),page=await context.newPage();
  await page.goto(f.origin+'/');await expect(page.getByRole('status')).toHaveText('Sign in to open your workspace.');await expect(page.getByRole('link',{name:'Open customers',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Sign in to Crest OS',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Sign in to continue.');
  const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-crest_session');assert(cookie?.secure&&cookie.httpOnly);
  await page.getByRole('link',{name:'Open workspace',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to content',exact:true})).toBeFocused();
  await page.route('**/api/business/settings',route=>route.abort('failed'));await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await expect(page.getByRole('status')).toContainText('Workspace access could not be verified');await expect(page.getByRole('link',{name:'Open customers',exact:true})).toHaveCount(0);await page.unroute('**/api/business/settings');await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  await expect(page.getByText('No follow-up dates recorded.',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Open customers',exact:true}).click();await page.getByRole('button',{name:'Add customer',exact:true}).click();
  const label='Synthetic workshop customer '+name;await page.getByLabel('Customer name',{exact:true}).fill(label);await page.getByLabel('Phone value',{exact:true}).fill('5555550123');await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');
  await page.reload();await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue(label);await expect(page.getByRole('region',{name:'Customer history',exact:true})).toContainText('Current version: 1');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();const download=await downloadPromise,downloaded=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(downloaded.record.display_name,label);assert.equal(downloaded.record.phone_raw,'5555550123');assert.equal(downloaded.record.email_raw,null);assert.equal(downloaded.completeCrestExport,false);assert.equal(downloaded.unsavedDraftIncluded,false);assert.equal(downloaded.history.length,1);
  let refusedDownloads=0;page.on('download',()=>refusedDownloads++);await page.route('**/api/business/customers/history',route=>route.abort('failed'));await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('No file was requested');assert.equal(refusedDownloads,0);await page.unroute('**/api/business/customers/history');
  // Concurrent real command advances this record. The original UI must recover
  // through its existing conflict behavior, without replacing retained history.
  await page.getByLabel('Customer name',{exact:true}).fill(label+' stale draft');
  const changed=await page.evaluate(async({id,operationId,label})=>{
   const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...csrf?{'x-crest-csrf':csrf}:{}},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
   const proof=(await post('auth/session',{})).body,ctx=(await post('business/customers/context',{},proof.csrfToken)).body;
   return (await post('business/customers/save',{schemaVersion:1,operationId,customerId:id,expectedVersion:'1',recoveryEpoch:ctx.recoveryEpoch,displayName:label+' retained edit',phone:'5555550123',email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null},proof.csrfToken)).status;
  },{id:downloaded.record.id,operationId:randomUUID(),label});assert.equal(changed,200);
  await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status').first()).toContainText('record changed');await page.getByRole('button',{name:'Load current customers',exact:true}).click();await page.getByRole('button',{name:label+' retained edit',exact:true}).click();await expect(page.getByRole('region',{name:'Customer history',exact:true})).toContainText('Current version: 2');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`workspace-customers-${name}-${width}.png`),fullPage:true});
  }
  await page.getByRole('link',{name:'Manage vehicles',exact:true}).click();await page.getByRole('button',{name:'Add vehicle',exact:true}).click();const vehicle='Synthetic workshop van '+name;await page.getByLabel('Vehicle label',{exact:true}).fill(vehicle);await page.getByRole('button',{name:'Save vehicle',exact:true}).click();await expect(page.getByRole('status',{name:'Vehicle editor status',exact:true})).toContainText('Vehicle saved');
  await page.reload();await page.getByRole('button',{name:vehicle,exact:true}).click();await expect(page.getByLabel('Vehicle label',{exact:true})).toHaveValue(vehicle);await page.getByRole('button',{name:'Load current customer links',exact:true}).click();await page.getByRole('button',{name:'Add customer link',exact:true}).click();await page.getByLabel('Customer name, phone or email',{exact:true}).fill(label);await page.getByRole('button',{name:'Find customers',exact:true}).click();await page.getByRole('button',{name:'Use '+label+' retained edit',exact:true}).click();await page.getByLabel('Relationship',{exact:true}).selectOption('owner');await page.getByLabel('Billing selection',{exact:true}).selectOption('yes');await page.getByRole('button',{name:'Use current time',exact:true}).click();await page.getByRole('button',{name:'Save customer link',exact:true}).click();
  await expect(page.getByRole('status',{name:'Customer-link status',exact:true})).toContainText('saved');
  const rows=(await f.client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[f.business])).rows;assert.equal(rows[0].n,1);
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Today',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');await page.goBack();await expect(page.getByRole('heading',{name:'Vehicles',exact:true})).toBeVisible();
  await context.close();
 }finally{await browser?.close();await f.close();}
});
