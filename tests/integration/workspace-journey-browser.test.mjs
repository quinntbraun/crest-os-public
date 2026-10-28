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
  await expect(page.getByRole('heading',{name:'Edit customer',exact:true})).toBeFocused();
  // Disabled Save is not proof of a clean draft: clearing a required name is
  // still an edit. Canceling a search/record switch must keep it in memory.
  await page.getByLabel('Customer name',{exact:true}).fill('');await expect(page.getByRole('button',{name:'Save customer',exact:true})).toBeDisabled();
  let searches=0;const searched=request=>{if(request.url().endsWith('/api/business/customers/list'))searches++;};page.on('request',searched);
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Search customers',exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('');assert.equal(searches,0);page.off('request',searched);
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('');
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.accept();});await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue(label);await expect(page.getByRole('heading',{name:'Edit customer',exact:true})).toBeFocused();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();const download=await downloadPromise,downloaded=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(downloaded.record.display_name,label);assert.equal(downloaded.record.phone_raw,'5555550123');assert.equal(downloaded.record.email_raw,null);assert.equal(downloaded.completeCrestExport,false);assert.equal(downloaded.unsavedDraftIncluded,false);assert.equal(downloaded.history.length,1);
  let refusedDownloads=0;page.on('download',()=>refusedDownloads++);await page.route('**/api/business/customers/history',route=>route.abort('failed'));await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('No file was requested');assert.equal(refusedDownloads,0);await page.unroute('**/api/business/customers/history');
  await page.evaluate(()=>{const original=HTMLAnchorElement.prototype.click;window.restoreSyntheticDownload=()=>{HTMLAnchorElement.prototype.click=original;delete window.restoreSyntheticDownload;};HTMLAnchorElement.prototype.click=function(){original.call(this);if(this.download==='crest-customer-record.json')throw Error('SYNTHETIC_DOWNLOAD_AFTER_DISPATCH');};});
  try{const uncertain=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await uncertain;await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('Check your browser’s downloads before requesting another file');}finally{await page.evaluate(()=>window.restoreSyntheticDownload());}
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
  await page.reload();await page.getByRole('button',{name:vehicle,exact:true}).click();await expect(page.getByLabel('Vehicle label',{exact:true})).toHaveValue(vehicle);await expect(page.getByRole('heading',{name:'Edit vehicle',exact:true})).toBeFocused();
  await page.getByLabel('Year',{exact:true}).fill('not-a-year');await expect(page.getByRole('button',{name:'Save vehicle',exact:true})).toBeDisabled();page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await expect(page.getByLabel('Year',{exact:true})).toHaveValue('not-a-year');await page.getByLabel('Year',{exact:true}).fill('');
  await page.getByRole('button',{name:'Load current customer links',exact:true}).click();await page.getByRole('button',{name:'Add customer link',exact:true}).click();await page.getByLabel('Customer name, phone or email',{exact:true}).fill(label);await page.getByRole('button',{name:'Find customers',exact:true}).click();await page.getByRole('button',{name:'Use '+label+' retained edit',exact:true}).click();await page.getByLabel('Relationship',{exact:true}).selectOption('owner');await page.getByLabel('Billing selection',{exact:true}).selectOption('yes');page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await expect(page.getByRole('form',{name:'Customer link editor',exact:true})).toBeVisible();await expect(page.getByLabel('Relationship',{exact:true})).toHaveValue('owner');await page.getByRole('button',{name:'Use current time',exact:true}).click();await page.getByRole('button',{name:'Save customer link',exact:true}).click();
  await expect(page.getByRole('status',{name:'Customer-link status',exact:true})).toContainText('saved');
  const rows=(await f.client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[f.business])).rows;assert.equal(rows[0].n,1);
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Today',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');await page.goBack();await expect(page.getByRole('heading',{name:'Vehicles',exact:true})).toBeVisible();
  await context.close();
 }finally{await browser?.close();await f.close();}
});

// Independent fixtures keep this contact-review acceptance out of the original
// journey's admission budget and preserve its existing scope unchanged.
async function sharedContactJourney(name,engine){
 const f=await sourceExportBrowserFixture({product:true,workspace:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:780}}),page=await context.newPage();
  await page.goto(f.origin+'/sign-in');const credentials=f.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const existing='Synthetic archived household '+name;
  const seed=await page.evaluate(async label=>{
   const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...csrf?{'x-crest-csrf':csrf}:{}},body:JSON.stringify(body)});if(r.status!==200)throw Error('SYNTHETIC_CONTACT_SETUP_FAILED');return r.json();};
   const p=await post('auth/session',{}),c=await post('business/customers/context',{},p.csrfToken),customerId=crypto.randomUUID();
   await post('business/customers/save',{schemaVersion:1,operationId:crypto.randomUUID(),customerId,expectedVersion:'0',recoveryEpoch:c.recoveryEpoch,displayName:label,phone:'(317) 555-0123',email:'Household@Example.com',contactPreference:null,outreachOptOut:true,notes:'Synthetic retained source',customerSince:null,archived:true,archiveReason:'Synthetic retained archive'},p.csrfToken);return customerId;
  },existing);
  const count=async()=>Number((await f.client.query('SELECT count(*) AS n FROM crest.customers WHERE business_id=$1',[f.business])).rows[0].n);
  await page.goto(f.origin+'/customers');await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill('Synthetic phone household member '+name);await page.getByLabel('Phone value',{exact:true}).fill('3175550123');
  await page.getByRole('button',{name:'Save customer',exact:true}).click();const review=page.getByRole('region',{name:'Shared contact review',exact:true});await expect(review).toBeVisible();await expect(review.getByRole('button',{name:'Review '+existing+' — archived',exact:true})).toBeVisible();await expect(review).toContainText('Phone matches');assert.equal(await count(),1);assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.customer.pending-reference.v1')),null);
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await review.getByRole('button',{name:'Review '+existing+' — archived',exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('Synthetic phone household member '+name);assert.equal(await count(),1);
  for(const width of [360,390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);}
  await page.getByRole('button',{name:'Save as separate customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');assert.equal(await count(),2);
  await page.getByRole('button',{name:'Load current customers',exact:true}).click();await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill('Synthetic email household member '+name);await page.getByLabel('Email value',{exact:true}).fill('Household@Example.com');await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(review).toContainText('Email search result');await expect(review.getByText('Phone matches',{exact:true})).toHaveCount(0);assert.equal(await count(),2);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(review).toHaveCount(0);await expect(page.getByLabel('Customer name',{exact:true})).toHaveCount(0);assert.equal(await count(),2);assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.customer.pending-reference.v1')),null);
  await page.getByRole('button',{name:'Load current customers',exact:true}).click();await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill('Synthetic email household member '+name);await page.getByLabel('Email value',{exact:true}).fill('Household@Example.com');await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(review).toBeVisible();await page.getByRole('button',{name:'Save as separate customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');assert.equal(await count(),3);
  const retained=(await f.client.query('SELECT display_name,phone_raw,email_raw,notes,archived_reason,version::text FROM crest.customers WHERE business_id=$1 AND id=$2',[f.business,seed])).rows[0];assert.deepEqual(retained,{display_name:existing,phone_raw:'(317) 555-0123',email_raw:'Household@Example.com',notes:'Synthetic retained source',archived_reason:'Synthetic retained archive',version:'1'});
  await context.close();
 }finally{try{await browser?.close();}finally{await f.close();}}
}
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' shared phone/email prompts review and preserves distinct household records',()=>sharedContactJourney(name,engine));
