import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const engine of [chromium,webkit]){
 test(engine.name()+' edits fictional account settings and recovers an interrupted save',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const api=fixture.origin+'/api/business/finance-accounts/';
   const anonymous=await page.request.post(api+'list',{data:{afterCode:null,includeArchived:true}});
   assert.equal(anonymous.status(),400);
   assert(!('rows' in await anonymous.json()));
   await page.goto(fixture.origin+'/settings');
   await expect(page.getByRole('status')).toContainText('Business settings could not be verified');
   await expect(page.getByRole('link',{name:'Fictional account setup',exact:true})).toHaveCount(0);
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('status')).toContainText('Signed in');

   await page.goto(fixture.origin+'/settings');
   await page.getByRole('link',{name:'Fictional account setup',exact:true}).click();
   const settings=page.getByRole('region',{name:'Account settings',exact:true}),status=settings.getByRole('status');
   await settings.getByRole('button',{name:'Load accounts',exact:true}).press('Enter');
   await expect(status).toHaveText('No accounts match this view.');
   await expect(page.getByRole('link',{name:'Dated account mappings',exact:true})).toHaveCount(0);
   assert.equal((await page.request.post(api+'mapping-approve',{data:{}})).status(),404);
   await settings.getByRole('button',{name:'Add account',exact:true}).click();
   await settings.getByLabel('Account name',{exact:true}).fill('Fictional checking');
   await settings.getByLabel('Account code',{exact:true}).fill('1000');
   await settings.getByLabel('Account type',{exact:true}).selectOption('asset');
   await settings.getByLabel('Report role',{exact:true}).fill('money');
   await settings.getByLabel('Control kind (optional)',{exact:true}).fill('bank');
   await settings.getByRole('button',{name:'Save account',exact:true}).click();
   await expect(status).toHaveText('Account saved.');
   await expect(settings.getByText('1000 · Fictional checking',{exact:true})).toBeVisible();

   await settings.getByRole('button',{name:'Edit account Fictional checking',exact:true}).click();
   await settings.getByLabel('Account name',{exact:true}).fill('Fictional closed checking');
   await settings.getByLabel('Availability',{exact:true}).selectOption('archived');
   await settings.getByLabel('Reason for change',{exact:true}).fill('Fictional review confirmed closure');
   let committedStatus;
   await page.route('**/api/business/finance-accounts/save',async route=>{
    const response=await route.fetch();committedStatus=response.status();await route.abort();
   },{times:1});
   await settings.getByRole('button',{name:'Save account',exact:true}).click();
   await expect(status).toContainText('The save could not be confirmed');
   assert.equal(committedStatus,200);
   const pendingKey='crest.finance-account.pending-reference.v1';
   const retained=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(retained);assert(!retained.includes('Fictional')&&!retained.includes('name'));
   assert.deepEqual(Object.keys(JSON.parse(retained).reference).sort(),['accountId','expectedVersion','operationId','recoveryEpoch']);

   await page.reload();
   await settings.getByRole('button',{name:'Load accounts',exact:true}).click();
   await expect(status).toContainText('Review the interrupted account save');
   await settings.getByRole('button',{name:'Check save status',exact:true}).click();
   await expect(status).toHaveText('The original account save was confirmed.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
   await settings.getByLabel('Show archived accounts',{exact:true}).check();
   await expect(settings.getByText('1000 · Fictional closed checking',{exact:true})).toBeVisible();
   await settings.getByRole('button',{name:'View history for Fictional closed checking',exact:true}).click();
   const history=settings.getByRole('region',{name:'Saved account history',exact:true});
   await expect(history.getByText('Fictional checking',{exact:true})).toBeVisible();
   await expect(history.getByText('Fictional review confirmed closure',{exact:true})).toBeVisible();
   const download=page.waitForEvent('download');
   await history.getByRole('button',{name:'Download loaded history (CSV)',exact:true}).click();
   const file=await download;
   assert.equal(file.suggestedFilename(),'crest-account-history.csv');
   assert.match(await readFile(await file.path(),'utf8'),/"1000","Fictional closed checking","2","Archived"/);

   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:'.local/review/finance-account-settings-recovery-'+engine.name()+'-'+width+'.png',animations:'disabled'});
   }
   const stored=(await fixture.client.query('SELECT version::text,active FROM crest.account_versions ORDER BY version')).rows;
   assert.deepEqual(stored,[{version:'1',active:true},{version:'2',active:false}]);
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   await expect(history).toHaveCount(0);

   await page.setViewportSize({width:390,height:900});
   await settings.getByRole('button',{name:'Load accounts',exact:true}).click();
   await settings.getByRole('button',{name:'Add account',exact:true}).click();
   await settings.getByLabel('Account name',{exact:true}).fill('Fictional draft lost before save');
   await settings.getByLabel('Account code',{exact:true}).fill('1100');
   await settings.getByLabel('Account type',{exact:true}).selectOption('asset');
   await settings.getByLabel('Report role',{exact:true}).fill('receivable');
   await page.route('**/api/business/finance-accounts/save',route=>route.abort(),{times:1});
   await settings.getByRole('button',{name:'Save account',exact:true}).click();
   await expect(status).toContainText('The save could not be confirmed');
   const original=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey)).reference;

   await page.reload();
   await settings.getByRole('button',{name:'Load accounts',exact:true}).click();
   await settings.getByRole('button',{name:'Check save status',exact:true}).click();
   await expect(status).toContainText('No completed save was found');
   const close=settings.getByRole('button',{name:'Close interrupted save',exact:true});
   await expect(close).toBeDisabled();
   await expect(settings.getByRole('button',{name:'Add account',exact:true})).toHaveCount(0);
   await expect(settings.getByRole('button',{name:'Retry original save',exact:true})).toHaveCount(0);
   await settings.getByLabel('Reason for closing the attempt',{exact:true}).fill('Fictional owner reviewed the interrupted attempt');
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/finance-account-interrupted-'+engine.name()+'-390.png',animations:'disabled'});
   let reviewStatus;
   await page.route('**/api/business/finance-accounts/retire',async route=>{
    const response=await route.fetch();reviewStatus=response.status();await route.abort();
   },{times:1});
   await close.press('Enter');
   await expect(status).toContainText('The review could not be confirmed');
   assert.equal(reviewStatus,200);
   const unresolved=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert.deepEqual(JSON.parse(unresolved).reference,original);
   assert(!unresolved.includes('Fictional'));
   await page.reload();
   await settings.getByRole('button',{name:'Load accounts',exact:true}).click();
   await settings.getByRole('button',{name:'Check save status',exact:true}).click();
   await expect(status).toHaveText('The interrupted save was closed. You can start a new edit.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
   await expect(settings.getByRole('button',{name:'Add account',exact:true})).toBeEnabled();
   const retired=(await fixture.client.query(`
    SELECT o.command_type,a.reason,o.result->>'state' AS state FROM crest_private.operations o
    JOIN crest_private.audit_events a USING(business_id,operation_id,actor_id) WHERE o.operation_id=$1
   `,[original.operationId])).rows;
   assert.deepEqual(retired,[{command_type:'finance.account.retire',reason:'Fictional owner reviewed the interrupted attempt',state:'retired'}]);
   assert.equal((await fixture.client.query('SELECT count(*)::integer n FROM crest.accounts WHERE id=$1',[original.accountId])).rows[0].n,0);
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
