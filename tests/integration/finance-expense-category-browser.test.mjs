import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const engine of [chromium,webkit]){
 test(engine.name()+' approves a fictional expense category account, recovers an interrupted save and exports history',
  {timeout:240000},async()=>{
   const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
   if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
   let fixture,browser;
   try{
    fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMappings:true,financeCategoryMappings:true});
    browser=await engine.launch();
    const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
    const page=await context.newPage();page.setDefaultTimeout(20000);
    const anonymous=await page.request.post(fixture.origin+'/api/business/finance-accounts/mapping-category-accounts',
     {data:{purpose:'category_fuel',afterCode:null}});
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
    await page.getByRole('link',{name:'Expense category mappings',exact:true}).click();
    await page.getByRole('link',{name:'Manage category approvals',exact:true}).click();

    const editor=page.getByRole('region',{name:'Mapping approvals',exact:true}),status=editor.getByRole('status');
    const category=editor.getByLabel('Expense category',{exact:true}),date=editor.getByLabel('Effective from',{exact:true});
    const load=editor.getByRole('button',{name:'Load approval settings',exact:true});
    const save=editor.getByRole('button',{name:'Save approval',exact:true});
    const review=editor.getByRole('button',{name:'Review interrupted approval',exact:true});
    await expect(category.getByRole('option',{name:'Other',exact:true})).toHaveCount(0);
    await category.selectOption('category_fuel');
    await load.press('Enter');
    await expect(status).toHaveText('Approval settings loaded.');
    await expect(editor.getByText('No approved mapping yet.',{exact:true})).toBeVisible();
    await editor.getByRole('button',{name:'Approve mapping',exact:true}).press('Enter');
    await expect(editor.getByRole('heading',{name:'Approve mapping',exact:true})).toBeFocused();
    const account=editor.getByLabel('Account',{exact:true});
    await expect(account).toHaveValue('');
    await expect(account.getByRole('option',{name:'5100 · Fictional fuel account',exact:true})).toHaveCount(0);
    await editor.getByRole('button',{name:'Load more accounts',exact:true}).click();
    await expect(status).toHaveText('More eligible accounts loaded.');
    await expect(account.getByRole('option',{name:'1000 · Fictional bank',exact:true})).toHaveCount(0);
    await date.fill('2026-02-01');
    await editor.getByLabel('Approval reason',{exact:true}).fill('=Fictional review selected the fuel account');
    await expect(save).toBeDisabled();
    const [accountId]=await account.selectOption({label:'5100 · Fictional fuel account'});

    await mkdir('.local/review',{recursive:true});
    async function capture(view){
     for(const width of [360,390,768,1440]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
      if(view==='approval')await page.evaluate(()=>window.scrollTo(0,0));
      else await page.getByRole('heading',{name:'Approval history',exact:true}).scrollIntoViewIfNeeded();
      await page.screenshot({path:'.local/review/finance-category-'+view+'-'+engine.name()+'-'+width+'.png',animations:'disabled'});
     }
    }
    await capture('approval');
    await page.setViewportSize({width:390,height:900});

    let savedStatus;
    await page.route('**/api/business/finance-accounts/mapping-approve',async route=>{
     const response=await route.fetch();savedStatus=response.status();await route.abort();
    },{times:1});
    await save.press('Enter');
    await expect(status).toContainText('The approval could not be confirmed');
    assert.equal(savedStatus,200);
    const pendingKey='crest.finance-mapping.pending-reference.v1';
    const retained=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
    assert(retained&&!retained.includes(accountId)&&!retained.includes('2026-02-01')&&!retained.includes('Fictional'));
    assert.deepEqual(Object.keys(JSON.parse(retained).reference).sort(),['expectedVersion','operationId','purpose','recoveryEpoch']);
    await page.reload();
    await review.click();
    await expect(status).toHaveText('The original approval was confirmed.');
    await expect(editor.getByText('Version 1 · Approved · Effective Feb 1, 2026',{exact:true})).toBeVisible();
    await expect(editor.getByText('Approved account 5100',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);

    await editor.getByRole('button',{name:'Close mapping',exact:true}).click();
    await date.fill('2026-03-01');
    await editor.getByLabel('Closure reason',{exact:true}).fill('Fictional owner stopped using this category mapping');
    await editor.getByRole('button',{name:'Save closure',exact:true}).click();
    await expect(status).toHaveText('Mapping closure saved.');
    await page.getByRole('link',{name:'Expense category mappings',exact:true}).click();

    const lookup=page.getByRole('region',{name:'Account mapping lookup',exact:true});
    await lookup.getByLabel('Expense category',{exact:true}).selectOption('category_fuel');
    const effective=lookup.getByLabel('Effective date',{exact:true});
    await effective.fill('2026-02-28');
    await lookup.getByRole('button',{name:'Check account',exact:true}).click();
    await expect(lookup.getByText('5100 · Fuel',{exact:true})).toBeVisible();
    await expect(lookup.getByRole('heading',{name:'Account on Feb 28, 2026',exact:true})).toBeFocused();
    await effective.fill('2026-03-01');
    await lookup.getByRole('button',{name:'Check account',exact:true}).click();
    await expect(lookup.getByRole('status')).toHaveText('No usable account mapping applies on that date.');
    await lookup.getByRole('button',{name:'View approval history',exact:true}).click();
    await expect(lookup.getByText('Version 2 · Closed',{exact:true})).toBeVisible();
    await expect(lookup.getByRole('heading',{name:'Approval history',exact:true})).toBeFocused();
    await expect(lookup.getByText('Version 2 · Closed',{exact:true})).toBeInViewport();
    await expect(lookup.getByText('Version 1 · Account 5100',{exact:true})).toBeVisible();
    const waiting=page.waitForEvent('download');
    await lookup.getByRole('button',{name:'Download loaded approvals (CSV)',exact:true}).click();
    const download=await waiting;
    assert.equal(download.suggestedFilename(),'crest-mapping-approvals.csv');
    const csv=await readFile(await download.path(),'utf8');
    assert.match(csv,/"Fuel","1","2026-02-01","Approved","5100","'=Fictional review selected the fuel account"/);
    await capture('history');
    await page.goBack();
    await expect(page.getByRole('heading',{name:'Manage expense category approvals',exact:true})).toBeVisible();
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
