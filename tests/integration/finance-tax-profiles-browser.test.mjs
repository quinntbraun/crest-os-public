import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const engine of [chromium,webkit]){
 test(engine.name()+' reviews, saves and recovers fictional tax approvals with history and dated amounts',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,financeAccounts:true,financeTaxProfiles:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const anonymous=await page.request.post(fixture.origin+'/api/business/finance-accounts/tax-history',
    {data:{jurisdiction:'Fictional district',applicability:'tip',serviceId:null,beforeVersion:null}});
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
   await page.getByRole('link',{name:'Tax profiles',exact:true}).click();

   const panel=page.getByRole('region',{name:'Tax profile review',exact:true});
   const status=panel.locator(':scope > [role=status]'),jurisdiction=panel.getByLabel('Jurisdiction',{exact:true});
   const applies=panel.getByLabel('Applies to',{exact:true}),review=panel.getByRole('button',{name:'View approval history',exact:true});
   const history=panel.getByRole('region',{name:'Saved tax profile history',exact:true});
   const calculation=panel.getByRole('region',{name:'Tax calculation result',exact:true});
   await expect(review).toBeDisabled();
   await expect(jurisdiction).toBeEnabled();
   await jurisdiction.fill('Fictional district');
   await applies.selectOption('service');
   await panel.getByLabel('Service name or code',{exact:true}).fill('interior');
   await panel.getByRole('button',{name:'Find services',exact:true}).press('Enter');
   await expect(status).toHaveText('Choose a saved service.');
   const service=panel.getByLabel('Service',{exact:true});
   await expect(service).toBeEnabled();
   const [selectedService]=await service.selectOption({label:'Fictional interior detail · fictional-interior'});
   await expect(jurisdiction).toHaveValue('Fictional district');
   await expect(applies).toHaveValue('service');
   await expect(service).toHaveValue(selectedService);
   await expect(review).toBeEnabled();

   await page.route('**/api/business/finance-accounts/tax-history',route=>route.abort(),{times:1});
   await review.click();
   await expect(status).toHaveText('Crest could not verify this request. Try again.');
   await review.press('Enter');
   await expect(status).toHaveText('Saved tax profile history loaded.');
   await expect(history.getByRole('heading',{name:'Approval history',exact:true})).toBeFocused();
   await expect(history.getByText('Version 2 · Verified exemption policy',{exact:true})).toBeVisible();
   await expect(history.getByText('Version 1 · Verified inclusive rate',{exact:true})).toBeVisible();
   await history.getByText('Verification evidence',{exact:true}).last().click();
   await expect(history.getByText('=Fictional rate evidence',{exact:true})).toBeVisible();
   const pendingDownload=page.waitForEvent('download');
   await history.getByRole('button',{name:'Download loaded history (CSV)',exact:true}).click();
   const file=await pendingDownload;
   assert.equal(file.suggestedFilename(),'crest-tax-profile-history.csv');
   const csv=await readFile(await file.path(),'utf8');
   assert.match(csv,/"2026-01-01","Verified inclusive rate","0\.1","'=Fictional rate evidence"/);
   assert.match(csv,/"2026-06-01","Verified exemption policy","","Fictional exemption policy"/);
   await mkdir('.local/review',{recursive:true});
   async function renders(view){
    for(const width of [360,390,768,1440]){
     await page.setViewportSize({width,height:900});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     const anchor=view==='history'?history:view==='approval'?panel.getByRole('region',{name:'Manage tax approvals',exact:true}):calculation;
     await anchor.scrollIntoViewIfNeeded();
     await page.screenshot({path:'.local/review/finance-tax-'+view+'-'+engine.name()+'-'+width+'.png',animations:'disabled'});
    }
   }
   await renders('history');

   await panel.getByText('Check an amount',{exact:true}).click();
   const date=panel.getByLabel('Effective date',{exact:true}),gross=panel.getByLabel('Amount before discount ($)',{exact:true});
   const discount=panel.getByLabel('Discount ($, optional)',{exact:true}),check=panel.getByRole('button',{name:'Check tax',exact:true});
   await date.fill('2026-05-31');
   await gross.fill('110.00');
   await expect(discount).toHaveValue('');
   await page.route('**/api/business/finance-accounts/tax-preview',async route=>{
    const response=await route.fetch();
    assert.equal(response.status(),200);
    const result=await response.json();
    assert.equal(result.state,'ready');
    const {components}=result;
    // Preserve all sums while changing the rate-derived split by one cent.
    components.netCents=String(BigInt(components.netCents)-1n);
    components.taxCents=String(BigInt(components.taxCents)+1n);
    components.grossNetCents=String(BigInt(components.grossNetCents)-1n);
    await route.fulfill({response,json:result});
   },{times:1});
   await check.press('Enter');
   await expect(status).toHaveText('Crest could not verify this request. Try again.');
   await expect(calculation).toHaveCount(0);
   await check.press('Enter');
   await expect(status).toHaveText('Fictional tax calculation loaded.');
   await expect(calculation.getByText('$10.00',{exact:true})).toBeVisible();
   await discount.fill('111.00');
   await expect(check).toBeDisabled();
   await discount.fill('11.00');
   await check.click();
   await expect(calculation.getByText('$99.00',{exact:true})).toBeVisible();
   await expect(calculation.getByText('$90.00',{exact:true})).toBeVisible();
   await expect(calculation.getByText('$9.00',{exact:true})).toBeVisible();
   await expect(calculation.getByRole('heading',{name:'Verified inclusive rate',exact:true})).toBeFocused();
   await renders('preview');
   await date.fill('2026-06-01');
   await check.click();
   await expect(status).toHaveText('An exemption policy applies. This transaction needs its own evidence.');
   await expect(calculation.getByText('Tax included',{exact:true})).toHaveCount(0);
   await date.fill('2025-12-31');
   await check.click();
   await expect(status).toHaveText('No verified tax treatment applies on that date.');
   await expect(calculation).toHaveCount(0);

   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   await expect(jurisdiction).toHaveValue('');
   await expect(gross).toHaveValue('');
   await page.reload();
   await jurisdiction.fill('Fictional district');
   await applies.selectOption('tip');
   await review.click();
   await expect(history.getByText('Version 1 · Verified non-taxable',{exact:true})).toBeVisible();
   const manager=panel.getByRole('region',{name:'Manage tax approvals',exact:true});
   const approvalStatus=manager.getByRole('status');
   const reviewInterrupted=manager.getByRole('button',{name:'Check interrupted approval',exact:true});
   const pendingKey='crest.finance-tax.pending-reference.v1';
   const openEditor=()=>panel.getByText('Manage fictional approvals',{exact:true}).click();
   async function prepareApproval(dateValue,treatment,reason){
    await manager.getByRole('button',{name:'Load approval settings',exact:true}).click();
    await expect(approvalStatus).toHaveText('Latest approval loaded.');
    await expect(approvalStatus).toBeFocused();
    await manager.getByLabel('Effective from',{exact:true}).fill(dateValue);
    await manager.getByLabel('Tax treatment',{exact:true}).selectOption(treatment);
    await manager.getByLabel('Approval reason',{exact:true}).fill(reason);
   }
   await openEditor();
   await prepareApproval('2026-07-01','inclusive_single','Fictional dated tip rate approval');
   const save=manager.getByRole('button',{name:'Save tax approval',exact:true});
   await expect(save).toBeDisabled();
   await manager.getByLabel('Decimal rate',{exact:true}).fill('0.0800');
   await manager.getByLabel('Verification evidence',{exact:true}).fill('Fictional supporting evidence for the rate');
   await expect(save).toBeEnabled();
   await renders('approval');
   await page.setViewportSize({width:390,height:900});
   await save.press('Enter');
   await expect(approvalStatus).toHaveText('Tax approval saved.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
   await review.click();
   await expect(history.getByText('Version 2 · Verified inclusive rate',{exact:true})).toBeVisible();
   await expect(history.getByText('Effective Jul 1, 2026 · Decimal rate 0.08',{exact:true})).toBeVisible();

   await prepareApproval('2026-08-01','unresolved','Fictional approval with a lost response');
   await expect(manager.getByLabel('Verification evidence',{exact:true})).toHaveCount(0);
   await page.route('**/api/business/finance-accounts/tax-approve',async route=>{
    const response=await route.fetch();
    assert.equal(response.status(),200);
    await route.abort();
   },{times:1});
   await save.click();
   await expect(approvalStatus).toContainText('The approval could not be confirmed.');
   const pending=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(pending);
   assert.deepEqual(Object.keys(JSON.parse(pending)).sort(),['binding','businessId','reference']);
   assert.deepEqual(Object.keys(JSON.parse(pending).reference).sort(),['expectedVersion','operationId','recoveryEpoch']);
   await page.reload();
   await openEditor();
   await reviewInterrupted.click();
   await expect(approvalStatus).toHaveText('The original tax approval was confirmed.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);

   await jurisdiction.fill('Fictional district');
   await applies.selectOption('tip');
   await prepareApproval('2026-09-01','unresolved','Fictional attempt interrupted before delivery');
   await page.route('**/api/business/finance-accounts/tax-approve',route=>route.abort(),{times:1});
   await save.click();
   await expect(approvalStatus).toContainText('The approval could not be confirmed.');
   await reviewInterrupted.click();
   await expect(approvalStatus).toContainText('No completed approval was found.');
   await manager.getByLabel('Reason to close this attempt',{exact:true}).fill('Fictional owner reviewed the pending operation');
   await manager.getByRole('button',{name:'Close interrupted attempt',exact:true}).click();
   await expect(approvalStatus).toHaveText('The interrupted tax approval was closed.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
   await review.click();
   await expect(history.getByText('Version 3 · Unresolved',{exact:true})).toBeVisible();
   await expect(history.getByText('Version 4',{exact:false})).toHaveCount(0);

   await page.goBack();
   await expect(page.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeVisible();
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
