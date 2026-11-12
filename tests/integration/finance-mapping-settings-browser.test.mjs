import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const engine of [chromium,webkit]){
 test(engine.name()+' reopens the account mapping applicable on a date and its approved history',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMappings:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const anonymous=await page.request.post(fixture.origin+'/api/business/finance-accounts/mapping-history',
    {data:{purpose:'service_revenue',beforeVersion:null}});
   assert.equal(anonymous.status(),400);
   assert(!('rows' in await anonymous.json()));
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('status')).toContainText('Signed in');
   await page.goto(fixture.origin+'/settings');
   await page.getByRole('link',{name:'Fictional account setup',exact:true}).click();
   await page.getByRole('button',{name:'Load accounts',exact:true}).click();
   await expect(page.getByRole('link',{name:'Expense category mappings',exact:true})).toHaveCount(0);
   await page.getByRole('link',{name:'Dated account mappings',exact:true}).click();

   const view=page.getByRole('region',{name:'Account mapping lookup',exact:true});
   const status=view.getByRole('status'),purpose=view.getByLabel('Purpose',{exact:true}),date=view.getByLabel('Effective date',{exact:true});
   const check=view.getByRole('button',{name:'Check account',exact:true});
   const approvals=view.getByRole('button',{name:'View approval history',exact:true});
   const history=view.getByRole('region',{name:'Saved mapping history',exact:true});
   await expect(check).toBeDisabled();
   await purpose.selectOption('service_revenue');
   await date.fill('2026-03-31');
   await check.press('Enter');
   await expect(status).toHaveText('Approved mapping found.');
   await expect(view.getByRole('heading',{name:'Account on Mar 31, 2026',exact:true})).toBeVisible();
   await expect(view.getByText('4000 · Detailing service revenue',{exact:true})).toBeVisible();
   await expect(view.getByText('Version 1 · Effective Jan 1, 2026. Next version starts Apr 1, 2026.',{exact:true})).toBeVisible();
   await mkdir('.local/review',{recursive:true});
   await page.screenshot({path:'.local/review/finance-mapping-lookup-'+engine.name()+'-390.png',animations:'disabled'});
   await date.fill('2026-04-01');
   await check.click();
   await expect(view.getByText('Fictional approval renewed',{exact:true})).toBeVisible();
   await date.fill('2026-10-01');
   await check.click();
   await expect(status).toHaveText('No usable account mapping applies on that date.');
   await expect(view.getByRole('region',{name:'Approved account',exact:true})).toHaveCount(0);

   await page.route('**/api/business/finance-accounts/mapping-history',route=>route.abort(),{times:1});
   await approvals.click();
   await expect(status).toHaveText('The mapping could not be verified. Try again.');
   await approvals.click();
   await expect(status).toHaveText('Saved mapping history loaded.');
   await expect(history.getByText('Version 3 · Closed',{exact:true})).toBeVisible();
   await expect(history.getByText('=Fictional initial approval',{exact:true})).toBeVisible();
   const download=page.waitForEvent('download');
   await history.getByRole('button',{name:'Download loaded approvals (CSV)',exact:true}).click();
   const file=await download;
   assert.equal(file.suggestedFilename(),'crest-mapping-approvals.csv');
   const csv=await readFile(await file.path(),'utf8');
   assert.match(csv,/"3","2026-10-01","Closed","","Fictional mapping closed"/);
   assert.match(csv,/"1","2026-01-01","Approved","4000","'=Fictional initial approval"/);
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'.local/review/finance-mapping-history-'+engine.name()+'-'+width+'.png',animations:'disabled'});
   }
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   await expect(history).toHaveCount(0);
   await expect(purpose).toHaveValue('');
   await page.reload();
   await purpose.selectOption('tips_revenue');
   await approvals.click();
   await expect(status).toHaveText('No approved versions for this purpose.');
   await page.goBack();
   await expect(page.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeVisible();

   const epoch=(await fixture.client.query('SELECT active_epoch FROM crest_private.business_recovery_authorities')).rows[0].active_epoch;
   const accountId=(await fixture.client.query("SELECT id FROM crest.accounts WHERE code='4000'")).rows[0].id;
   const reference={operationId:randomUUID(),recoveryEpoch:epoch,purpose:'service_revenue',expectedVersion:'3'};
   const approval={accountId,effectiveFrom:'2026-11-01',reason:'Fictional mapping reapproved'};
   const send=(action,data,invalidBinding=false)=>page.evaluate(async({action,data,invalidBinding})=>{
    const post=(path,body,headers={})=>fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    const proof=await post('/api/auth/session',{});
    if(!proof.ok)throw Error('GENUINE_SESSION_REQUIRED');
    const {'csrfToken':csrf}=await proof.json();
    const prefix='/api/business/finance-accounts/';
    const context=await post(prefix+'context',{}, {'x-crest-csrf':csrf});
    if(!context.ok||context.headers.get('x-crest-finance-fixed-mappings')!=='1')throw Error('MAPPING_CONTEXT_REQUIRED');
    const binding=context.headers.get('x-crest-edit-binding');
    const response=await post(prefix+action,data,{'x-crest-csrf':csrf,'x-crest-edit-binding':invalidBinding?'invalid':binding});
    return {status:response.status,body:await response.json()};
   },{action,data,invalidBinding});
   const disabledCategories=await send('mapping-category-accounts',{purpose:'category_fuel',afterCode:null});
   assert.equal(disabledCategories.status,400);assert(!('rows' in disabledCategories.body));
   assert.equal((await send('mapping-approve',{reference,approval},true)).status,400);
   assert.deepEqual((await send('mapping-operation',reference)).body,{state:'absent'});
   let savedStatus;
   await page.route('**/api/business/finance-accounts/mapping-approve',async route=>{
    const response=await route.fetch();savedStatus=response.status();await route.abort();
   },{times:1});
   await assert.rejects(send('mapping-approve',{reference,approval}));
   assert.equal(savedStatus,200);
   await page.reload();
   const original=await send('mapping-operation',reference);
   assert.equal(original.body.state,'committed');
   assert.equal(original.body.receipt.version,'4');
   assert.equal(original.body.receipt.effectiveFrom,approval.effectiveFrom);
   assert.equal(original.body.receipt.reason,approval.reason);
   const abandoned={...reference,operationId:randomUUID(),expectedVersion:'4'};
   const decision=await send('mapping-retire',{reference:abandoned,reviewEpoch:epoch,reason:'Fictional review closed the attempt'});
   assert.equal(decision.status,200);
   assert.equal(decision.body.state,'retired');
   assert.deepEqual((await send('mapping-operation',abandoned)).body,decision.body);
   assert.equal((await send('mapping-approve',{reference:abandoned,approval:{...approval,effectiveFrom:'2026-12-01'}})).status,409);
   assert.equal((await fixture.client.query('SELECT count(*)::integer n FROM crest.account_mapping_versions')).rows[0].n,4);

   await page.goto(fixture.origin+'/settings/accounts/mappings');
   await page.getByRole('link',{name:'Manage approvals',exact:true}).click();
   const editor=page.getByRole('region',{name:'Mapping approvals',exact:true}),editorStatus=editor.getByRole('status');
   const selectPurpose=editor.getByLabel('Purpose',{exact:true});
   const loadSettings=editor.getByRole('button',{name:'Load approval settings',exact:true});
   const review=editor.getByRole('button',{name:'Review interrupted approval',exact:true});
   const pendingKey='crest.finance-mapping.pending-reference.v1';
   await review.click();
   await expect(editorStatus).toHaveText('There is no interrupted approval in this tab.');
   await selectPurpose.selectOption('service_revenue');
   await loadSettings.press('Enter');
   await expect(editorStatus).toHaveText('Approval settings loaded.');
   await expect(editor.getByText('Version 4 · Approved · Effective Nov 1, 2026',{exact:true})).toBeVisible();
   await expect(editor.getByText('4000 · Fictional service revenue',{exact:true})).toBeVisible();
   await editor.getByRole('button',{name:'Close mapping',exact:true}).press('Enter');
   await expect(editor.getByRole('heading',{name:'Close mapping',exact:true})).toBeFocused();
   await expect(loadSettings).toHaveCount(0);
   const effective=editor.getByLabel('Effective from',{exact:true}),saveClosure=editor.getByRole('button',{name:'Save closure',exact:true});
   await effective.fill('2026-11-01');
   await editor.getByLabel('Closure reason',{exact:true}).fill('Fictional owner closed this mapping');
   await expect(saveClosure).toBeDisabled();
   await effective.fill('2026-12-01');
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'.local/review/finance-mapping-manage-'+engine.name()+'-'+width+'.png',animations:'disabled'});
   }
   let closureStatus;
   await page.route('**/api/business/finance-accounts/mapping-approve',async route=>{
    const response=await route.fetch();closureStatus=response.status();await route.abort();
   },{times:1});
   await saveClosure.press('Enter');
   await expect(editorStatus).toContainText('The approval could not be confirmed');
   assert.equal(closureStatus,200);
   const retained=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(retained&&!retained.includes('Fictional')&&!retained.includes('2026-12-01')&&!retained.includes(accountId));
   assert.deepEqual(Object.keys(JSON.parse(retained).reference).sort(),['expectedVersion','operationId','purpose','recoveryEpoch']);
   await page.reload();
   await review.click();
   await expect(editorStatus).toHaveText('The original approval was confirmed.');
   await expect(editor.getByText('Version 5 · Closed · Effective Dec 1, 2026',{exact:true})).toBeVisible();
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);

   const approveButton=editor.getByRole('button',{name:'Approve mapping',exact:true});
   const saveApproval=editor.getByRole('button',{name:'Save approval',exact:true});
   const approvalReason=editor.getByLabel('Approval reason',{exact:true});
   await approveButton.click();
   await expect(editor.getByRole('heading',{name:'Approve mapping',exact:true})).toBeFocused();
   await editor.getByRole('button',{name:'Cancel',exact:true}).press('Enter');
   await expect(editorStatus).toBeFocused();
   await expect(loadSettings).toBeVisible();
   await approveButton.click();
   await effective.fill('2027-01-01');
   await approvalReason.fill('Fictional approval interrupted before reaching Crest');
   await page.route('**/api/business/finance-accounts/mapping-approve',route=>route.abort(),{times:1});
   await saveApproval.click();
   await expect(editorStatus).toContainText('The approval could not be confirmed');
   const unsent=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey)).reference;
   await page.reload();
   await review.click();
   await expect(editorStatus).toContainText('No completed approval was found');
   await expect(editor.getByRole('button',{name:'Retry original approval',exact:true})).toHaveCount(0);
   const closeAttempt=editor.getByRole('button',{name:'Close interrupted attempt',exact:true});
   await expect(closeAttempt).toBeDisabled();
   await editor.getByLabel('Reason for closing the attempt',{exact:true}).fill('Fictional owner reviewed the interruption');
   let retiredStatus;
   await page.route('**/api/business/finance-accounts/mapping-retire',async route=>{
    const response=await route.fetch();retiredStatus=response.status();await route.abort();
   },{times:1});
   await closeAttempt.press('Enter');
   await expect(editorStatus).toContainText('The review could not be confirmed');
   assert.equal(retiredStatus,200);
   await page.reload();
   await review.click();
   await expect(editorStatus).toHaveText('The interrupted approval was closed. You can start a new change.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
   assert.equal((await send('mapping-approve',{reference:unsent,approval:{...approval,effectiveFrom:'2027-01-01'}})).status,409);
   await approveButton.click();
   await effective.fill('2027-01-01');
   await approvalReason.fill('Fictional mapping approved again');
   await saveApproval.press('Enter');
   await expect(editorStatus).toHaveText('Mapping approval saved.');
   await expect(editor.getByText('Version 6 · Approved · Effective Jan 1, 2027',{exact:true})).toBeVisible();
   await selectPurpose.selectOption('tips_revenue');
   await loadSettings.click();
   await expect(editor.getByText('Add or activate an eligible account in the chart of accounts before approving this purpose.',
    {exact:true})).toBeVisible();
   await expect(approveButton).toHaveCount(0);
   await expect(editor.getByRole('button',{name:'Close mapping',exact:true})).toHaveCount(0);
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
