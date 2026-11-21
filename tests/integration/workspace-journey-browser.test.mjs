import {reviewCrmSaveFeedback,reviewCrmLoading} from '../support/crm-save-feedback.mjs';
// Actual product pages + genuine provider MFA, restricted SQL and retained
// history. Synthetic TLS exceptions are confined to this disposable test.
import assert from 'node:assert/strict';
import {assertTodayLayout,captureTodayState} from '../support/today-layout.mjs';

import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {gateEditorFocusFrames,releaseEditorFocusFrames} from '../support/editor-focus-frame.mjs';
import {reviewDirectoryIntroduction} from '../support/directory-introduction.mjs';
import {reviewAddressCustomerChooser} from '../support/address-customer-chooser.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' complete signed-in customer / vehicle workspace journey',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}}),page=await context.newPage();
  await page.goto(f.origin+'/');await expect(page.getByRole('status')).toHaveText('Sign in to open your workspace.');await expect(page.locator('.today-content')).toHaveCount(0);
  await page.getByRole('link',{name:'Sign in to Crest OS',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Sign in to continue.');
  const credentials=f.credentials(),email=page.getByLabel('Email',{exact:true}),password=page.getByLabel('Password',{exact:true}),code=page.getByLabel('Authenticator code',{exact:true});
  const signIn=page.getByRole('button',{name:'Sign in',exact:true}),deviceOptions=page.getByText('Personal device options',{exact:true});
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:width<768?844:950});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const primary=await signIn.boundingBox(),optional=await deviceOptions.boundingBox();
   assert(primary&&optional&&primary.height>=44&&primary.y<optional.y);
   assert.deepEqual((await new AxeBuilder({page}).include('.sign-in-panel').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`settings-sign-in-${name}-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  await email.fill(credentials.email);
  if(name==='chromium'){
   await password.fill('synthetic-wrong-password');await code.fill(f.credentials().code);
   await signIn.click();
   await expect(page.getByRole('status')).toContainText('phone’s date and time are set automatically');
   await expect(email).toHaveValue(credentials.email);
   await expect(password).toHaveValue('');await expect(code).toHaveValue('');
  }
  await password.fill(credentials.password);
  // Keep the test submission away from the provider's 30-second code rollover.
  const remainingCodeTime=30_000-Date.now()%30_000;
  if(remainingCodeTime<5_000)await delay(remainingCodeTime+100);
  await code.fill(f.credentials().code);await signIn.click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();await expect(page.getByLabel('Password',{exact:true})).toHaveCount(0);
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-crest_session');assert(cookie?.secure&&cookie.httpOnly);
  await page.getByRole('link',{name:'Open workspace',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  const skip=page.getByRole('link',{name:'Skip to content',exact:true});
  if(name==='chromium')await page.keyboard.press('Tab');
  else await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace-content')).toBeFocused();
  await expect(page.getByRole('region',{name:'Upcoming visit status'}).getByRole('link',{name:'Open schedule',exact:true})).toHaveAttribute('href','/schedule');
  const searchButton=page.getByRole('button',{name:'Find a tool',exact:true});
  await page.keyboard.press('Control+k');
  const toolSearch=page.getByRole('dialog',{name:'Find a tool',exact:true});
  const toolQuery=toolSearch.getByRole('searchbox',{name:'Search workspace tools',exact:true});
  const firstTool=toolSearch.getByRole('link',{name:/^Today(?: Main navigation)?$/});
  const secondTool=toolSearch.getByRole('link',{name:/^Customers(?: Main navigation)?$/});
  await expect(toolQuery).toBeFocused();
  await toolQuery.press('ArrowDown');await expect(firstTool).toBeFocused();
  await firstTool.press('ArrowDown');await expect(secondTool).toBeFocused();
  await secondTool.press('Home');await expect(firstTool).toBeFocused();
  await firstTool.press('ArrowUp');await expect(toolQuery).toBeFocused();
  await toolQuery.fill('receipt');await expect(toolSearch.getByRole('link',{name:/^Expenses(?: Money)?$/})).toBeVisible();
  await toolQuery.fill('fictionalunmatchedtool');await expect(toolSearch.getByText('No tools match that search.')).toBeVisible();
  await toolQuery.press('Escape');await expect(toolSearch).toBeHidden();await expect(searchButton).toBeFocused();
  await searchButton.evaluate(button=>button.blur());
  for(const width of [320,360,768,1440]){
   await page.setViewportSize({width,height:950});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const [action,review]=await Promise.all([
    page.getByRole('region',{name:'Upcoming visit status'}).getByRole('link',{name:'Open schedule',exact:true}).boundingBox(),
    page.getByRole('region',{name:'Schedule review',exact:true}).boundingBox(),
   ]);
   assert(action&&review&&action.height>=44&&action.y+action.height<review.y);
   assert.deepEqual((await new AxeBuilder({page}).include('.workspace-home').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`working-today-${name}-${width}.png`),fullPage:true});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.today-content').evaluate(element=>getComputedStyle(element).animationName),'none');
  await page.emulateMedia({reducedMotion:null});
  await page.setViewportSize({width:390,height:844});
  const workspaceMenu=page.locator('.workspace-menu summary');
  const tools=page.getByRole('navigation',{name:'Workspace tools',exact:true});
  await workspaceMenu.press('Enter');
  await expect(tools.getByText('Money',{exact:true})).toBeVisible();
  await expect(tools.getByRole('link',{name:'Accounting',exact:true})).toHaveAttribute('href','/settings/accounts');
  await tools.getByRole('link',{name:'Accounting',exact:true}).press('Escape');
  await expect(tools).toBeHidden();
  await expect(workspaceMenu).toBeFocused();
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await workspaceMenu.click();
   const expenses=tools.getByRole('link',{name:'Expenses',exact:true});
   assert((await expenses.boundingBox())?.height>=44);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('.workspace-menu').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`workspace-menu-${name}-${width}.png`)});
   await workspaceMenu.press('Escape');
  }
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/business/settings',route=>route.abort('failed'));await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await expect(page.getByRole('status')).toContainText('Workspace access could not be verified');await expect(page.locator('.today-content')).toHaveCount(0);await page.unroute('**/api/business/settings');await page.getByRole('button',{name:'Refresh workspace',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  await expect(page.getByText('No follow-up dates recorded.',{exact:true})).toBeVisible();
  await reviewCrmLoading(page,name,'customer',()=>page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Customers',exact:true}).click());
  const addCustomer=page.getByRole('button',{name:'Add customer',exact:true});
  await expect(page.getByText('No customers yet. Use Add customer to create a record.',{exact:true})).toBeVisible();
  await reviewDirectoryIntroduction(page,{kind:'customer',engine:name,state:'empty'});
  const addPosition=await addCustomer.boundingBox(),searchPosition=await page.getByRole('searchbox',{name:'Customer search',exact:true}).boundingBox();
  assert(addPosition&&searchPosition&&addPosition.height>=44&&addPosition.y<searchPosition.y);
  await addCustomer.press('Enter');await expect(page.getByRole('heading',{name:'New customer',exact:true})).toBeFocused();
  const label='Synthetic workshop customer '+name;await page.getByLabel('Customer name',{exact:true}).fill(label);await page.getByLabel('Phone value',{exact:true}).fill('5555550123');await expect.poll(()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status')).toContainText('Customer saved');await reviewCrmSaveFeedback(page,f,name,'customer','saved');
  await page.reload();
  await reviewDirectoryIntroduction(page,{kind:'customer',engine:name,state:'unselected'});
  await page.getByRole('searchbox',{name:'Customer search',exact:true}).fill(label);
  await page.getByRole('button',{name:'Search customers',exact:true}).click();
  await expect(page.getByRole('status').first()).toHaveText('Customer search complete.');
  await page.getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue(label);
  await expect(page.locator('.customer-record-header')).toContainText('(555) 555-0123');
  await expect(page.getByRole('region',{name:'Customer lookup',exact:true})).toBeHidden();
  await page.getByLabel('Customer name',{exact:true}).fill('Synthetic unsaved draft');
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('region',{name:'Customer history',exact:true})).toContainText('Current version: 1');
  await page.getByRole('button',{name:/Back to customers/}).click();
  await expect(page.getByRole('button',{name:label,exact:true})).toBeFocused();
  await expect(page.getByRole('searchbox',{name:'Customer search',exact:true})).toHaveValue(label);
  await expect(page.getByRole('form',{name:'Customer editor',exact:true})).toBeHidden();
  await page.getByRole('button',{name:label,exact:true}).click();
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('Synthetic unsaved draft');
  await page.getByLabel('Customer name',{exact:true}).fill(label);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-current','true');
  await expect(page.getByRole('button',{name:label,exact:true})).toHaveAccessibleDescription('(555) 555-0123');
  // Disabled Save is not proof of a clean draft: clearing a required name is
  // still an edit. Canceling a search/record switch must keep it in memory.
  await page.getByLabel('Customer name',{exact:true}).fill('');await expect(page.getByRole('button',{name:'Save customer',exact:true})).toBeDisabled();
  let searches=0;const searched=request=>{if(request.url().endsWith('/api/business/customers/list'))searches++;};page.on('request',searched);
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Search customers',exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('');assert.equal(searches,0);page.off('request',searched);
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('');
  page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.accept();});await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue(label);await expect(page.getByRole('heading',{name:'Edit customer',exact:true})).toBeFocused();
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'History',exact:true}).click();
  const [download]=await Promise.all([
   page.waitForEvent('download'),
   (async()=>{await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('Download requested.');})(),
  ]);
  const downloaded=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(downloaded.record.display_name,label);assert.equal(downloaded.record.phone_raw,'5555550123');assert.equal(downloaded.record.email_raw,null);assert.equal(downloaded.completeCrestExport,false);assert.equal(downloaded.unsavedDraftIncluded,false);assert.equal(downloaded.history.length,1);
  let refusedDownloads=0;page.on('download',()=>refusedDownloads++);await page.route('**/api/business/customers/history',route=>route.abort('failed'));await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('No file was requested');assert.equal(refusedDownloads,0);await page.unroute('**/api/business/customers/history');
  await page.evaluate(()=>{const original=HTMLAnchorElement.prototype.click;window.restoreSyntheticDownload=()=>{HTMLAnchorElement.prototype.click=original;delete window.restoreSyntheticDownload;};HTMLAnchorElement.prototype.click=function(){original.call(this);if(this.download==='crest-customer-record.json')throw Error('SYNTHETIC_DOWNLOAD_AFTER_DISPATCH');};});
  try{const uncertain=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved customer (JSON)',exact:true}).click();await uncertain;await expect(page.getByRole('status',{name:'Record download status',exact:true})).toContainText('Check your browser’s downloads before requesting another file');}finally{await page.evaluate(()=>window.restoreSyntheticDownload());}
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  // Concurrent real command advances this record. The original UI must recover
  // through its existing conflict behavior, without replacing retained history.
  await page.getByLabel('Customer name',{exact:true}).fill(label+' stale draft');
  const changed=await page.evaluate(async({id,operationId,label})=>{
   const post=async(path,body,csrf)=>{const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json',...csrf?{'x-crest-csrf':csrf}:{}},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
   const proof=(await post('auth/session',{})).body,ctx=(await post('business/customers/context',{},proof.csrfToken)).body;
   return (await post('business/customers/save',{schemaVersion:1,operationId,customerId:id,expectedVersion:'1',recoveryEpoch:ctx.recoveryEpoch,displayName:label+' retained edit',phone:'5555550123',email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null},proof.csrfToken)).status;
  },{id:downloaded.record.id,operationId:randomUUID(),label});assert.equal(changed,200);
  await page.getByRole('button',{name:'Save customer',exact:true}).click();await expect(page.getByRole('status').first()).toContainText('record changed');await reviewCrmSaveFeedback(page,f,name,'customer','stale');await page.getByRole('button',{name:'Load current customers',exact:true}).click();await page.getByRole('button',{name:label+' retained edit',exact:true}).click();await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'History',exact:true}).click();await expect(page.getByRole('region',{name:'Customer history',exact:true})).toContainText('Current version: 2');
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   const lookup=await page.locator('.customer-lookup').boundingBox();
   const editor=await page.getByRole('form',{name:'Customer editor',exact:true}).boundingBox();
   assert(editor);
   if(lookup)assert(lookup.x+lookup.width<editor.x);
   if(width<768)assert.equal(lookup,null);
   if(width===768)assert(editor.width>=320,'The tablet record must retain readable content width.');
   if(width===1440)assert(lookup,'A wide workspace keeps the directory beside the record.');
   const sectionButtons=await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button').all();
   const boxes=await Promise.all(sectionButtons.map(button=>button.boundingBox()));
   assert(boxes.every(box=>box&&box.height>=44));
   assert(new Set(boxes.map(box=>box.y)).size<=(width>=768?1:2));
   await page.screenshot({path:join('.local/review',`workspace-customers-${name}-${width}.png`),fullPage:true});
  }
  await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Vehicles',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await reviewCrmLoading(page,name,'vehicle',()=>page.getByRole('link',{name:'Link a vehicle',exact:true}).click());await reviewDirectoryIntroduction(page,{kind:'vehicle',engine:name,state:'empty'});await page.getByRole('button',{name:'Add vehicle',exact:true}).click();const vehicle='Synthetic workshop van '+name;await page.getByLabel('Vehicle label',{exact:true}).fill(vehicle);await page.getByRole('button',{name:'Save vehicle',exact:true}).click();await expect(page.getByRole('status',{name:'Vehicle editor status',exact:true})).toContainText('Vehicle saved');await reviewCrmSaveFeedback(page,f,name,'vehicle','saved');
  await page.reload();await reviewDirectoryIntroduction(page,{kind:'vehicle',engine:name,state:'unselected'});await page.getByRole('button',{name:vehicle,exact:true}).click();await page.getByRole('button',{name:'Edit vehicle',exact:true}).click();await expect(page.getByLabel('Vehicle label',{exact:true})).toHaveValue(vehicle);await expect(page.getByRole('heading',{name:'Edit vehicle',exact:true})).toBeFocused();
  await page.getByLabel('Year',{exact:true}).fill('not-a-year');await expect(page.getByRole('button',{name:'Save vehicle',exact:true})).toBeDisabled();page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Back to vehicle list',exact:true}).click();await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await page.getByRole('button',{name:vehicle,exact:true}).click();await expect(page.getByLabel('Year',{exact:true})).toHaveValue('not-a-year');await page.getByLabel('Year',{exact:true}).fill('');
  await page.getByRole('button',{name:'Load current customer links',exact:true}).click();await page.getByRole('button',{name:'Add customer link',exact:true}).click();await page.getByLabel('Customer name, phone or email',{exact:true}).fill(label);await page.getByRole('button',{name:'Find customers',exact:true}).click();await page.getByRole('button',{name:'Use '+label+' retained edit',exact:true}).click();await page.getByLabel('Relationship',{exact:true}).selectOption('owner');await page.getByLabel('Billing selection',{exact:true}).selectOption('yes');page.once('dialog',dialog=>{assert.equal(dialog.type(),'confirm');void dialog.dismiss();});await page.getByRole('button',{name:'Back to vehicle list',exact:true}).click();await page.getByRole('button',{name:'Search vehicles',exact:true}).click();await page.getByRole('button',{name:vehicle,exact:true}).click();await expect(page.getByRole('form',{name:'Customer link editor',exact:true})).toBeVisible();await expect(page.getByLabel('Relationship',{exact:true})).toHaveValue('owner');await page.getByRole('button',{name:'Use current time',exact:true}).click();await page.getByRole('button',{name:'Review customer-link change',exact:true}).click();await page.getByRole('button',{name:'Save customer link',exact:true}).click();
  await expect(page.getByRole('status',{name:'Customer-link status',exact:true})).toContainText('saved');
  const rows=(await f.client.query('SELECT count(*)::int AS n FROM crest.customer_vehicles WHERE business_id=$1',[f.business])).rows;assert.equal(rows[0].n,1);
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Today',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Workspace access verified.');await page.goBack();await expect(page.getByRole('heading',{name:'Vehicles',exact:true})).toBeVisible();
  await reviewAddressCustomerChooser(page,{fixture:f,engine:name,customerName:label+' retained edit'});
  await context.close();
 }finally{await browser?.close();await f.close();}
});


for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' reviews scheduled lead follow-ups from the dashboard',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,leadFollowUps:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:844}}),page=await context.newPage();
  await page.goto(f.origin+'/sign-in');
  const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  const remainingCodeTime=30_000-Date.now()%30_000;
  if(remainingCodeTime<5_000)await delay(remainingCodeTime+100);
  await page.getByLabel('Authenticator code',{exact:true}).fill(f.credentials().code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  // Start reading the matching response immediately; waiting for the navigation
  // action first can leave Chromium without that response's body handle.
  const firstPage=page.waitForResponse(response=>response.url().endsWith('/api/business/leads/follow-ups')&&response.status()===200)
   .then(async response=>({headers:response.headers(),data:await response.json()}));
  const [observed]=await Promise.all([firstPage,page.getByRole('link',{name:'Open workspace',exact:true}).click()]);
  assert.match(observed.headers['cache-control'],/no-store/i);
  const data=observed.data;
  assert.equal(data.followUps.length,8);
  assert.equal(data.hasMore,true);
  assert.deepEqual(Object.keys(data.followUps[0]).sort(),['followUpAt','id','label','state']);
  const section=page.getByRole('region',{name:'Lead follow-ups',exact:true}),first=f.followUpLeads[0],last=f.followUpLeads.at(-1);
  const featured=page.getByRole('region',{name:'Next due item',exact:true});
  const firstLead=featured.getByRole('link',{name:'Open follow-up',exact:true});
  await expect(firstLead).toHaveAttribute('href','/leads?lead='+first.id);
  await expect(featured.getByRole('heading',{name:first.label,exact:true})).toBeVisible();
  await expect(featured.getByText('Overdue follow-up',{exact:true})).toBeVisible();
  await expect(featured.getByText('Lost lead',{exact:true})).toBeVisible();
  await expect(featured.locator('time')).toHaveAttribute('datetime',first.followUpAt);
  await expect(featured.getByRole('link',{name:'Open schedule',exact:true})).toHaveAttribute('href','/schedule');
  await expect(section.getByRole('link',{name:first.label,exact:true})).toHaveCount(0);
  await expect(section.getByRole('link',{name:last.label,exact:true})).toHaveCount(0);

  await mkdir('.local/review',{recursive:true});
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const touchTarget=await firstLead.boundingBox();assert(touchTarget&&touchTarget.height>=44);
   const due=await featured.boundingBox(),queued=await section.boundingBox();
   assert(due&&queued);if(width<1100)assert(due.y+due.height<queued.y);else assert(queued.x>=due.x+due.width,'wide attention sits beside the next due task');await assertTodayLayout(page);
   assert.deepEqual((await new AxeBuilder({page}).include('.workspace-home').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`today-due-${name}-${width}.png`)});
   await section.screenshot({path:join('.local/review',`lead-follow-ups-${name}-${width}.png`)});
  }
  await section.getByRole('button',{name:'More follow-ups',exact:true}).click();
  await expect(section.getByRole('link',{name:last.label,exact:true})).toBeVisible();
  await expect(firstLead).toBeVisible();
  await expect(section.getByRole('heading',{name:'Lead follow-ups',exact:true})).toBeFocused();
  await section.getByRole('button',{name:'First reminders',exact:true}).click();
  await expect(firstLead).toBeVisible();
  await page.route('**/api/business/scheduling/list',route=>route.abort('failed'));
  await page.reload();
  await expect(page.getByRole('region',{name:'Upcoming visit status'})).toContainText('Upcoming visits could not be verified.');
  await expect(featured).toHaveCount(0);
  await expect(section.getByRole('link',{name:first.label,exact:true})).toBeVisible();await captureTodayState(page,name,'partial-overdue');
  await page.unroute('**/api/business/scheduling/list');
  await page.reload();
  await firstLead.click();
  await expect(page).toHaveURL(f.origin+'/leads?lead='+first.id);
  await expect(page.getByRole('heading',{name:'Edit lead intake',exact:true})).toBeFocused();
  await expect(page.getByRole('textbox',{name:'Lead label',exact:true})).toHaveValue(first.label);
  const latest=page.getByRole('region',{name:'Lead history',exact:true}).locator('.lead-history-event').filter({hasText:/Version 2 ·/});
  await expect(latest).toHaveCount(1);
  await latest.locator(':scope > summary').click();
  await latest.getByText('Retained lead details at version 2',{exact:true}).click();
  await expect(latest.getByRole('group',{name:'Retained resulting lead',exact:true}).getByText('lost',{exact:true})).toBeVisible();
  await page.goto(f.origin+'/leads');
  const leadViews=page.getByRole('navigation',{name:'Lead views',exact:true});
  await expect(leadViews.getByRole('button',{name:'Follow-ups',exact:true})).toHaveAttribute('aria-current','true');
  const queue=page.getByRole('list',{name:'Lead follow-up queue',exact:true});
  await expect(queue.locator('time')).toHaveCount(8);
  assert.deepEqual(await queue.locator('time').evaluateAll(times=>times.map(time=>time.dateTime)),data.followUps.map(lead=>lead.followUpAt));
  await expect(queue.getByText('Overdue',{exact:true})).toHaveCount(1);
  const reminderScope=page.getByRole('region',{name:'Loaded follow-up views',exact:true});
  const leadFacts=async()=>({leads:(await f.client.query('SELECT to_jsonb(l) AS value FROM crest.leads l WHERE business_id=$1 ORDER BY id',[f.business])).rows,audits:(await f.client.query("SELECT to_jsonb(a) AS value FROM crest_private.audit_events a WHERE business_id=$1 AND entity_kind='leads' ORDER BY entity_id,entity_version",[f.business])).rows});
  const businessRequests=()=>f.requests.filter(row=>row.path.startsWith('/api/business/')).length;
  async function captureLead(stage){
   for(const width of [360,390,768,1100,1440]){
    await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
    if(stage==='all'&&width===1440){
     const fonts=await page.evaluate(()=>({root:getComputedStyle(document.documentElement).fontFamily,body:getComputedStyle(document.body).fontFamily,faces:[...document.fonts].filter(face=>face.family.includes('IBM Plex')).map(face=>({family:face.family,weight:face.weight,status:face.status}))}));
     if(name==='chromium'){
      const session=await page.context().newCDPSession(page);
      try{await session.send('DOM.enable');await session.send('CSS.enable');const {root}=await session.send('DOM.getDocument');fonts.platform=[];for(const selector of ['h1','main p']){const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert(nodeId);const result=await session.send('CSS.getPlatformFontsForNode',{nodeId});fonts.platform.push({selector,fonts:result.fonts});}}finally{await session.detach();}
     }
     await writeFile(join('.local/review','lead-workbench-font-'+name+'.json'),JSON.stringify(fonts,null,2)+'\n');
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(row=>row.id),[]);
    if(stage==='record'){await expect(page.getByRole('region',{name:'Lead record',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Edit lead intake',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Browse leads',exact:true}))[width<1100?'toBeHidden':'toBeVisible']();}else{await expect(page.getByRole('region',{name:'Browse leads',exact:true})).toBeVisible();await expect(reminderScope).toBeVisible();}
    await page.screenshot({path:join('.local/review','lead-workbench-'+stage+'-'+name+'-'+width+'.png'),fullPage:true});
    await page.screenshot({path:join('.local/review','lead-workbench-viewport-'+stage+'-'+name+'-'+width+'.png')});
   }
  }
  const beforeFilter=await leadFacts(),filterRequests=businessRequests();
  await reminderScope.getByRole('button',{name:'Due (1)',exact:true}).click();
  await expect(queue.getByRole('button')).toHaveCount(1);
  await expect(queue.getByRole('button',{name:first.label,exact:true})).toBeVisible();
  await expect(queue.getByText('lost',{exact:true})).toBeVisible();
  await expect(reminderScope).toContainText('Showing 1 of 8 reminders on this loaded page.');
  await captureLead('due');
  await reminderScope.getByRole('button',{name:'Upcoming (7)',exact:true}).click();
  await expect(queue.getByRole('button')).toHaveCount(7);
  await expect(queue.getByRole('button',{name:first.label,exact:true})).toHaveCount(0);
  await captureLead('upcoming');
  await reminderScope.getByRole('button',{name:'All (8)',exact:true}).click();
  assert.equal(businessRequests(),filterRequests,'Loaded reminder views do not request new business data');
  assert.deepEqual(await leadFacts(),beforeFilter);
  await captureLead('all');
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:900});
   assert.deepEqual((await new AxeBuilder({page}).include('.crest-record-list').withRules(['label-content-name-mismatch']).analyze()).violations,[]);
   const row=queue.locator('li').first(),button=row.getByRole('button');
   await expect(button).toHaveAccessibleName(first.label);
   await expect(button).toHaveAccessibleDescription(/Follow-up/);
   await row.scrollIntoViewIfNeeded();
   const hit=await row.locator('.crest-record-meta').evaluate(meta=>{
    const rect=meta.getBoundingClientRect();
    return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('button')?.textContent?.trim();
   });
   assert.equal(hit,first.label,'status details remain part of the row tap target');
  }
  await page.screenshot({path:join('.local/review',`lead-queue-${name}-1440.png`)});
  await page.setViewportSize({width:390,height:900});
  await page.screenshot({path:join('.local/review',`lead-queue-${name}-390.png`)});
  await page.getByRole('button',{name:'More follow-ups',exact:true}).click();
  await expect(queue.getByRole('button',{name:last.label,exact:true})).toBeVisible();
  await expect(queue.getByRole('button',{name:first.label,exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Scheduled follow-ups',exact:true})).toBeFocused();
  const laterFacts=await leadFacts(),laterRequests=businessRequests();
  await reminderScope.getByRole('button',{name:'Due (0)',exact:true}).click();
  await expect(page.getByText('No due reminders on this loaded page.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'First reminders',exact:true})).toBeEnabled();
  await reminderScope.getByRole('button',{name:/^All \(/}).click();
  assert.equal(businessRequests(),laterRequests);assert.deepEqual(await leadFacts(),laterFacts);
  await page.route('**/api/business/leads/follow-ups',route=>route.abort('failed'),{times:1});
  await page.getByRole('button',{name:'First reminders',exact:true}).click();
  await expect(queue).toHaveCount(0);
  await expect(page.getByText('Follow-ups could not be verified.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check follow-ups',exact:true}).click();
  await expect(queue.getByRole('button',{name:first.label,exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Scheduled follow-ups',exact:true})).toBeFocused();
  await queue.getByRole('button',{name:first.label,exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:'Edit lead intake',exact:true})).toBeFocused();
  await captureLead('record');
  const beforeJumps=await leadFacts(),jumpRequests=businessRequests(),jumps=page.getByRole('navigation',{name:'Lead record sections',exact:true});
  await jumps.getByRole('link',{name:'Status',exact:true}).press('Enter');
  await expect(page.locator('#lead-status')).toBeFocused();
  await jumps.getByRole('link',{name:'Intake',exact:true}).press('Enter');
  await expect(page.locator('#lead-intake')).toBeFocused();
  assert.equal(businessRequests(),jumpRequests);assert.deepEqual(await leadFacts(),beforeJumps);
  const originalNotes=await page.getByLabel('Notes',{exact:true}).inputValue();
  await page.getByLabel('Notes',{exact:true}).fill('Synthetic preserved reminder intake');
  const draftFacts=await leadFacts(),draftRequests=businessRequests();
  await gateEditorFocusFrames(page,'Back to follow-ups');
  await page.getByRole('button',{name:'Back to follow-ups',exact:true}).click();
  await expect(queue.getByRole('button',{name:first.label,exact:true})).toBeFocused();
  await reminderScope.getByRole('button',{name:'Upcoming (7)',exact:true}).focus();
  await releaseEditorFocusFrames(page);
  await expect(reminderScope.getByRole('button',{name:'Upcoming (7)',exact:true})).toBeFocused();
  await reminderScope.getByRole('button',{name:'Upcoming (7)',exact:true}).click();
  const future=data.followUps.find(row=>row.followUpAt>data.observedAt);assert(future);
  page.once('dialog',dialog=>dialog.dismiss());
  await queue.getByRole('button',{name:future.label,exact:true}).click();
  await expect(page.getByRole('button',{name:'Return to lead record',exact:true})).toBeVisible();
  assert.equal(businessRequests(),draftRequests);assert.deepEqual(await leadFacts(),draftFacts);
  await captureLead('retained-draft');
  await page.getByRole('button',{name:'Return to lead record',exact:true}).click();
  await expect(page.getByLabel('Notes',{exact:true})).toHaveValue('Synthetic preserved reminder intake');
  await page.getByLabel('Notes',{exact:true}).fill(originalNotes);
  await page.getByRole('button',{name:'Back to follow-ups',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Scheduled follow-ups',exact:true})).toBeFocused();
  await reminderScope.getByRole('button',{name:'All (8)',exact:true}).click();
  await queue.getByRole('button',{name:first.label,exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:'Edit lead intake',exact:true})).toBeFocused();
  await leadViews.getByRole('button',{name:'All leads',exact:true}).click();
  const directory=page.getByRole('list',{name:'Saved leads',exact:true});
  const listed=data.followUps.find(lead=>lead.state==='new');
  assert(listed,'fixture includes an open lead with a follow-up');
  const leadRow=directory.getByRole('button',{name:listed.label,exact:true});
  const time=leadRow.locator('..').locator('time');
  await expect(time).toHaveAttribute('datetime',listed.followUpAt);
  await expect(time).toHaveAttribute('title',listed.followUpAt);
  await expect(time).not.toHaveText(listed.followUpAt);
  for(const width of [320,390,1440]){
   await page.setViewportSize({width,height:900});
   const [add,search,record]=await Promise.all([
    page.getByRole('button',{name:'Add lead',exact:true}).boundingBox(),
    page.getByRole('searchbox',{name:'Lead search',exact:true}).boundingBox(),
    leadRow.boundingBox(),
   ]);
   assert(add&&search&&record&&add.y<search.y&&record.height>=44);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="Lead directory"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:join('.local/review',`lead-directory-${name}-${width}.png`)});
  }
  await leadRow.press('Enter');
  await expect(page.getByRole('heading',{name:'Edit lead intake',exact:true})).toBeFocused();
  await expect(leadRow).toHaveAttribute('aria-current','true');
 }finally{try{await browser?.close();}finally{await f.close();}}
});
