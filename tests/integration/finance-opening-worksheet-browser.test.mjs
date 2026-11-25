import assert from 'node:assert/strict';
import {reviewRecoveryActionPriority,financePriorityFacts} from '../support/recovery-action-priority.mjs';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {reviewFinancialRecovery} from '../support/financial-recovery-layout.mjs';

for(const engine of [chromium,webkit]){
 test(`${engine.name()} genuine owner saves and recovers a fictional opening worksheet`,{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   const openingAr=process.env.CREST_TEST_OPENING_AR_PREVIEW==='1';
   const postedFinanceExport=openingAr||process.env.CREST_TEST_OPENING_WORKSHEET_EXPORT==='1';
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
    await page.getByRole('button',{name:'Setup',exact:true}).click();
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
   await reviewFinancialRecovery(page,fixture,engine.name(),'worksheet',reopened);
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
   if(postedFinanceExport&&!openingAr){
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
   if(openingAr){
    await page.goto(fixture.origin+'/customers');
    await page.getByRole('button',{name:'Add customer',exact:true}).click();
    await page.getByLabel('Customer name',{exact:true}).fill('Fictional opening receivable customer');
    await page.getByRole('button',{name:'Save customer',exact:true}).click();
    await expect(page.getByRole('region',{name:'Customer directory',exact:true}).locator(':scope > [role="status"]')).toContainText('Customer saved');
    const opening=await load();
    await opening.getByText('Preview customer balances owed',{exact:true}).click();
    const ar=opening.getByRole('region',{name:'Opening receivables preview'});
    let receivableEntry=0;
    async function enterReceivable(){
     receivableEntry++;
     await ar.getByLabel('Customer name, phone or email').fill('Fictional opening receivable');
     await ar.getByRole('button',{name:'Find customers',exact:true}).click();
     await ar.getByRole('button',{name:'Use Fictional opening receivable customer',exact:true}).click();
     await ar.getByLabel('Legacy invoice or charge reference').fill('PRE-CREST-AR-1');
     await ar.getByLabel('Original services covered').fill('Fictional interior service');
     await ar.getByLabel('Original charge date').fill('2026-05-18');
     await ar.getByLabel('Original due date').fill('2026-06-10');
     await ar.getByLabel('Original charge (USD)').fill('150.00');
     await ar.getByLabel('Amount still owed at cutover (USD)').fill('125.50');
     const charge=ar.getByRole('group',{name:'Original charge evidence'});
     await charge.getByLabel('Document reference').fill('Fictional prior invoice');
     await charge.getByLabel('Document SHA-256 checksum').fill('4'.repeat(64));
     await ar.getByRole('button',{name:'Add prior payment or credit'}).click();
     const adjustment=ar.getByRole('group',{name:'Prior payment or credit 1'});
     await adjustment.getByLabel('Date applied').fill('2026-05-31');
     await adjustment.getByLabel('Amount applied (USD)').fill('24.50');
     await adjustment.getByLabel('Document reference').fill('Fictional prior receipt');
     await adjustment.getByLabel('Document SHA-256 checksum').fill('5'.repeat(64));
     await ar.getByRole('button',{name:'Add receivable to preview'}).click();
     await expect(ar.getByRole('button',{name:'Add receivable to preview'})).toHaveCount(0);
     await reviewRecoveryActionPriority(page,ar,ar.getByRole('button',{name:'Review opening receivables'}),()=>financePriorityFacts(fixture,'opening'),'opening-receivables-review-'+receivableEntry+'-'+engine.name());
     await ar.getByRole('button',{name:'Review opening receivables'}).click();
     await expect(ar.getByText('Total remaining · $125.50 USD')).toBeVisible();
     await expect(ar.getByText('Some original tax details are unknown.')).toBeVisible();
    }
    await ar.getByRole('button',{name:'Load saved receivables'}).click();
    await expect(ar.getByRole('status')).toHaveText('No receivables schedule saved for this worksheet.');
    await enterReceivable();
    await expect(ar.getByRole('button',{name:'Review opening receivables'})).toHaveClass('secondary');
    await reviewRecoveryActionPriority(page,ar,ar.getByRole('button',{name:'Save receivables schedule'}),()=>financePriorityFacts(fixture,'opening'),'opening-receivables-save-'+engine.name());
    for(const width of [360,390,768,1440]){
     await page.setViewportSize({width,height:900});
     assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     await ar.getByRole('heading',{name:'Opening receivables preview'}).scrollIntoViewIfNeeded();
     await page.screenshot({path:`.local/review/finance-opening-receivables-${engine.name()}-${width}.png`,animations:'disabled'});
    }

    const saveAr='**/api/business/finance-accounts/opening-worksheet-ar-save';
    let committedStatus;
    await page.route(saveAr,async route=>{
     const reply=await route.fetch();
     committedStatus=reply.status();
     await route.abort();
    },{times:1});
    await ar.getByLabel('Reason for saving this schedule').fill('Fictional reviewed remaining receivable');
    await ar.getByRole('button',{name:'Save receivables schedule'}).click();
    await expect(ar.getByRole('status')).toContainText('Crest could not confirm the schedule save.');
    assert.equal(committedStatus,200);
    const arPendingKey='crest.opening-ar.pending.v1.'+fixture.business;
    const arRef=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),arPendingKey);
    assert.deepEqual(Object.keys(arRef).sort(),['operationId','recoveryEpoch']);
    const arReopened=await load();
    await arReopened.getByText('Preview customer balances owed',{exact:true}).click();
    await ar.getByRole('button',{name:'Load saved receivables'}).click();
    await reviewFinancialRecovery(page,fixture,engine.name(),'receivables',ar);
    await ar.getByRole('button',{name:'Check original receivables save'}).click();
    await expect(ar.getByRole('status')).toHaveText('The original receivables save was confirmed.');
    await expect(ar.getByText('Saved receivables revision 1 · $125.50 USD')).toBeVisible();
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),arPendingKey),null);
    await ar.getByText('Preview opening entry from saved evidence',{exact:true}).click();
    await expect(ar.getByText('1100 · Opening customer balances owed',{exact:true})).toBeVisible();
    await expect(ar.getByText('Debit 125.50 USD',{exact:true})).toBeVisible();
    await expect(ar.getByText('Credit 226.50 USD',{exact:true})).toBeVisible();
    await expect(ar.getByText('Verify customer funds held.',{exact:true})).toBeVisible();
    await ar.getByText('Saved receivables revision 1 · $125.50 USD').click();
    const arDownload=page.waitForEvent('download');
    await ar.getByRole('button',{name:'Download saved receivables (JSON)',exact:true}).click();
    const file=await arDownload;
    assert.match(file.suggestedFilename(),/^crest-opening-receivables-worksheet-[0-9]+-revision-1\.json$/);
    const savedAr=JSON.parse(await readFile(await file.path(),'utf8'));
    assert.equal(savedAr.businessId,fixture.business);
    assert.equal(savedAr.operationId,arRef.operationId);
    assert.equal(savedAr.evidence.totals.remainingCents,'12550');
    assert.equal(savedAr.evidence.posted,false);
    assert.match(savedAr.evidenceSha256,/^[a-f0-9]{64}$/);

    await enterReceivable();
    await page.route(saveAr,route=>route.abort(),{times:1});
    await ar.getByLabel('Reason for saving this schedule').fill('Fictional lost draft');
    await ar.getByRole('button',{name:'Save receivables schedule'}).click();
    await expect(ar.getByRole('status')).toContainText('Crest could not confirm the schedule save.');
    const retiredRef=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),arPendingKey);
    await ar.getByRole('button',{name:'Check original receivables save'}).click();
    await expect(ar.getByRole('status')).toContainText('Crest found no committed receivables schedule');
    await ar.getByLabel('Reason for closing this receivables save').fill('Fictional owner closed the unused save');
    await ar.getByRole('button',{name:'Close interrupted receivables save'}).click();
    await expect(ar.getByRole('status')).toHaveText('The interrupted receivables save was closed.');
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),arPendingKey),null);
    const closed=(await fixture.client.query('SELECT action,reason FROM crest_private.audit_events WHERE operation_id=$1',[retiredRef.operationId])).rows;
    assert.deepEqual(closed,[{action:'retire',reason:'Fictional owner closed the unused save'}]);
    const after=await fixture.client.query(`SELECT
     (SELECT count(*)::int FROM crest.journal_entries WHERE business_id=$1) AS journals,
     (SELECT count(*)::int FROM crest.receivable_items WHERE business_id=$1) AS receivables,
     (SELECT count(*)::int FROM crest.opening_worksheet_revisions WHERE business_id=$1) AS worksheet,
     (SELECT count(*)::int FROM crest.opening_receivable_schedule_revisions WHERE business_id=$1) AS schedule`,[fixture.business]);
    assert.deepEqual(after.rows,[{journals:0,receivables:0,worksheet:1,schedule:1}]);
    await page.goto(fixture.origin+'/export-files');
    await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
    const archiveDownload=page.waitForEvent('download');
    await page.getByRole('button',{name:'Save ZIP',exact:true}).click();
    const {['manifest.json']:manifest,['export_delivery.json']:delivery,...source}=unzipSync(await readFile(await (await archiveDownload).path()));
    const verified=verifyFinanceSourceExport(strFromU8(manifest),Object.entries(source).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
    assert.equal(verified.profile,'crest.posted-finance-source.v20');
    assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,105);
    const archived=JSON.parse(strFromU8(source['opening_receivables_source.json']));
    assert.equal(archived.revisions.length,1);
    assert.deepEqual(archived.revisions[0].receipt,savedAr);
   }
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
