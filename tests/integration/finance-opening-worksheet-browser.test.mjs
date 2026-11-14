import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';

for(const engine of [chromium,webkit]){
 test(`${engine.name()} genuine owner saves and recovers a fictional opening worksheet`,{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   const postedFinanceExport=process.env.CREST_TEST_OPENING_WORKSHEET_EXPORT==='1';
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMoneyChannels:true,openingWorksheet:true,
    ...(postedFinanceExport?{
     catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,
     fieldSessions:true,jobCompletion:true,reviewOutcome:true,reviewHistory:true,financeMappings:true,financeTaxProfiles:true,
     invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,directReceipts:true,
     expenses:true,financeCategoryMappings:true,sameDayExpenses:true,trialBalance:true,paymentCorrections:true,fundApplications:true,
     heldTips:true,invoiceCredits:true,paidInvoiceCredits:true,serviceRefunds:true,postedFinanceExport:true,
    }:{})});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const anonymous=await page.request.post(fixture.origin+'/api/business/finance-accounts/opening-worksheet-read',{data:{requestedOn:null}});
   assert.equal(anonymous.status(),400);
   assert(!('worksheet' in await anonymous.json()));
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('status')).toContainText('Signed in');

   const load=async()=>{
    await page.goto(fixture.origin+'/settings/accounts');
    await page.getByRole('button',{name:'Load accounts',exact:true}).click();
    await page.getByText('Opening worksheet',{exact:true}).click();
    const worksheet=page.getByRole('region',{name:'Fictional opening worksheet'});
    await worksheet.getByRole('button',{name:'Load opening worksheet'}).click();
    return worksheet;
   };
   const worksheet=await load();
   await worksheet.getByLabel('Proposed local cutover date',{exact:false}).fill('2026-06-01');
   await worksheet.getByRole('button',{name:'Check cutover date and bank accounts'}).click();
   const evidence=worksheet.getByRole('group',{name:'Opening evidence',exact:true});
   await evidence.locator('#opening-source-reference').fill('Fictional owner source');
   await evidence.locator('#opening-source-sha256').fill('1'.repeat(64));
   await evidence.getByLabel('Basis for provisional opening equity').fill('Fictional documented net capital');
   const bank=evidence.getByRole('group',{name:'Fictional checking (ending 1234)',exact:true});
   await bank.getByLabel('Bank review note').fill('Fictional balance reviewed');
   await bank.getByLabel('Review status').selectOption('verified');
   await bank.getByLabel('Statement balance (USD)',{exact:true}).fill('100.00');
   await bank.getByLabel('Book balance (USD)',{exact:true}).fill('101.00');
   await bank.getByLabel('Document reference',{exact:true}).fill('Fictional bank statement');
   await bank.getByLabel('Document SHA-256 checksum',{exact:true}).fill('2'.repeat(64));
   await bank.getByRole('button',{name:'Add outstanding item'}).click();
   const outstanding=bank.getByRole('group',{name:'Outstanding item 1',exact:true});
   await outstanding.getByLabel('Adjustment to statement balance (USD)').fill('1.00');
   await outstanding.getByLabel('Document reference',{exact:true}).fill('Fictional deposit in transit');
   await outstanding.getByLabel('Document SHA-256 checksum',{exact:true}).fill('3'.repeat(64));
   for(const name of ['Customer balances owed','Customer funds held','Supplier bills','Taxes owed','Other liabilities','Cash and checks','Payment wallets','Other assets']){
    await evidence.getByRole('group',{name,exact:true}).getByLabel('Review note',{exact:true}).fill('Fictional data remains unknown');
   }
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await bank.scrollIntoViewIfNeeded();
    await page.screenshot({path:`.local/review/finance-opening-worksheet-${engine.name()}-${width}.png`,animations:'disabled'});
   }
   await page.setViewportSize({width:390,height:900});
   let recorded;
   await page.route('**/api/business/finance-accounts/opening-worksheet-save',async route=>{
    const response=await route.fetch();recorded=response.status();await route.abort();
   },{times:1});
   await worksheet.getByRole('button',{name:'Save opening worksheet'}).click();
   await expect(worksheet.getByRole('status')).toContainText('Crest could not confirm the save.');
   assert.equal(recorded,200);
   const key='crest.opening-worksheet.original.v1.'+fixture.business;
   const retained=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
   assert.deepEqual(Object.keys(retained).sort(),['operationId','recoveryEpoch']);

   const reopened=await load();
   await reopened.getByRole('button',{name:'Check original worksheet save'}).click();
   await expect(reopened.getByRole('status')).toHaveText('The original worksheet save was confirmed.');
   await expect(reopened.getByRole('heading',{name:'Saved revision 1'})).toBeVisible();
   await expect(reopened.getByText('Some opening balances are still unknown.')).toBeVisible();
   await expect(reopened.getByText('101.00 USD').first()).toBeVisible();
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
   const downloadPromise=page.waitForEvent('download');
   await reopened.getByRole('button',{name:'Download saved worksheet (JSON)'}).click();
   const download=await downloadPromise;
   assert.equal(download.suggestedFilename(),'crest-opening-worksheet-revision-1.json');
   const portable=JSON.parse(await readFile(await download.path(),'utf8'));
   assert.equal(portable.scope,'saved_opening_worksheet_revision');
   assert.equal(portable.worksheet.posted,false);
   assert.equal(portable.worksheet.operationId,retained.operationId);
   assert.equal(portable.worksheet.banks[0].bookCents,'10100');
   if(postedFinanceExport){
    await page.goto(fixture.origin+'/export-files');
    await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
    const zipPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Save ZIP',exact:true}).click();
    const zip=await zipPromise;
    assert.equal(zip.suggestedFilename(),'crest-posted-finance.zip');
    const {['manifest.json']:manifest,['export_delivery.json']:delivery,...source}=unzipSync(await readFile(await zip.path()));
    const verified=verifyFinanceSourceExport(strFromU8(manifest),Object.entries(source).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
    assert.equal(verified.profile,'crest.posted-finance-source.v18');
    assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,102);
    const openingSource=JSON.parse(strFromU8(source['opening_worksheet_source.json']));
    assert.equal(openingSource.revisions[0].id,portable.worksheet.worksheetRevisionId);
    assert.equal(openingSource.operations[0].operationId,portable.worksheet.operationId);
    assert.equal(openingSource.audits[0].id,portable.worksheet.auditEventId);
   }
   const financial=await fixture.client.query('SELECT count(*)::int AS count FROM crest.journal_entries WHERE business_id=$1',[fixture.business]);
   assert.equal(financial.rows[0].count,0);
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
