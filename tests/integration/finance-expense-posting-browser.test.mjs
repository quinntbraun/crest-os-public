import {observeExpenseAccess,prepareExpenseBrowserCode} from '../support/expense-access-diagnostic.mjs';
import assert from 'node:assert/strict';
import {openReceiptDownloads,captureExpenseState} from '../support/receipt-layout.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {strFromU8,unzipSync} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {reviewReceiptDocumentViewer} from '../support/receipt-document-viewer.mjs';
import {reviewAccountingReportWorkspace} from '../support/accounting-report-workspace.mjs';

async function exerciseSupplierBills(page,date,fixture,engine){
 const region=page.getByRole('region',{name:'Unpaid supplier bill drafts',exact:true});
 const summary=region.getByText('Unpaid supplier bills',{exact:true});
 const form=region.getByRole('form',{name:'Supplier bill draft',exact:true});
 const status=region.getByRole('status');
 const save=()=>form.getByRole('button',{name:'Save supplier bill draft',exact:true}).click();
 const fill=async purpose=>{
  await form.getByLabel('Incurred date',{exact:true}).fill(date);
  await form.getByLabel('Due date',{exact:true}).fill(date);
  await form.getByLabel('Supplier',{exact:true}).fill('Fictional vendor');
  await form.getByLabel('Bill reference (optional)',{exact:true}).fill('Fictional invoice B-17');
  await form.getByLabel('Bill total (USD)',{exact:true}).fill('150.25');
  await form.getByLabel('Purchase tax included in total (USD, if known)',{exact:true}).fill('5.25');
  await form.getByLabel('Business purpose',{exact:true}).fill(purpose);
  await form.getByLabel('Original document status',{exact:true}).fill('Fictional original evidence still to be retained');
  await form.getByLabel('Category for split 1',{exact:true}).selectOption('supplies');
  await form.getByLabel('Amount for split 1 (USD)',{exact:true}).fill('100.25');
  await form.getByRole('button',{name:'Add bill split',exact:true}).click();
  await form.getByLabel('Category for split 2',{exact:true}).selectOption('other');
  await form.getByLabel('Amount for split 2 (USD)',{exact:true}).fill('50.00');
 };
 await summary.click();
 await fill('Fictional workshop supplies');
 await page.route('**/api/business/finance-accounts/supplier-bill-draft-save',async route=>{
  const response=await route.fetch();
  assert.equal(response.status(),200);
  await route.abort('failed');
 },{times:1});
 await save();
 await expect(status).toContainText('The save could not be confirmed.');
 await region.getByRole('button',{name:'Check original supplier bill save',exact:true}).click();
 await expect(status).toHaveText('Supplier bill draft saved.');
 await page.reload();
 await page.getByRole('button',{name:'Suppliers',exact:true}).click();
 await summary.click();
 await region.getByRole('button',{name:'Load saved supplier bills',exact:true}).click();
 await region.getByRole('button',{name:'Open supplier bill draft',exact:true}).click();
 await region.locator('details.supplier-bill-editor > summary').press('Enter');
 await expect(form.getByLabel('Bill total (USD)',{exact:true})).toHaveValue('150.25');
 await form.getByLabel('Business purpose',{exact:true}).fill('Fictional supplies reviewed again');
 await page.setViewportSize({width:1440,height:900});
 const beforeNavigation=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.supplier_bill_draft_revisions r WHERE business_id=$1 ORDER BY revision',[fixture.business])).rows;
 let navigationRequests=0;const trackNavigation=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))navigationRequests++;};page.on('request',trackNavigation);
 try{
  const editor=region.locator('details.supplier-bill-editor');
  await editor.locator(':scope > summary').press('Enter');await editor.locator(':scope > summary').press('Enter');
  await expect(form.getByLabel('Business purpose',{exact:true})).toHaveValue('Fictional supplies reviewed again');
  await region.getByRole('button',{name:'Open supplier bill draft',exact:true}).click();
  await expect(form.getByLabel('Business purpose',{exact:true})).toHaveValue('Fictional supplies reviewed again');
  page.once('dialog',dialog=>dialog.dismiss());
  await region.getByRole('button',{name:'Enter another supplier bill',exact:true}).click();
  await expect(form.getByLabel('Business purpose',{exact:true})).toHaveValue('Fictional supplies reviewed again');
  assert.equal(navigationRequests,0);
  assert.deepEqual((await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.supplier_bill_draft_revisions r WHERE business_id=$1 ORDER BY revision',[fixture.business])).rows,beforeNavigation);
 }finally{page.off('request',trackNavigation);}
 await form.getByLabel('Reason for this revision',{exact:true}).fill('Fictional source reviewed');
 await form.getByRole('button',{name:'Save supplier bill revision',exact:true}).click();
 await expect(status).toHaveText('Supplier bill draft saved.');
 await region.getByRole('button',{name:'Enter another supplier bill',exact:true}).click();
 await fill('Fictional possible duplicate');
 await save();
 await expect(status).toHaveText('Supplier bill draft saved.');
 await region.getByRole('button',{name:'Review saved bill evidence',exact:true}).click();
 await expect(region.getByText('1 possible duplicate supplier bill.',{exact:true})).toBeVisible();
 assert.equal((await fixture.client.query('SELECT count(*)::int n FROM crest.financial_events WHERE business_id=$1',[fixture.business])).rows[0].n,0);
 assert.equal((await fixture.client.query('SELECT count(*)::int n FROM crest.supplier_bill_draft_revisions WHERE business_id=$1',[fixture.business])).rows[0].n,3);
 await mkdir('.local/review',{recursive:true});
 for(const width of [360,390,768,1100,1440]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const audit=await new AxeBuilder({page}).analyze();
  assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
  await region.getByRole('button',{name:'Review saved bill evidence',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'.local/review/finance-supplier-bill-'+engine+'-'+width+'.png'});
  await region.getByRole('region',{name:'Selected supplier bill',exact:true}).screenshot({path:'.local/review/finance-supplier-draft-selected-'+engine+'-'+width+'.png'});
 }
 await summary.click();
}

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' posts a reviewed paid expense and recovers the original',async t=>{
 const income=process.env.CREST_TEST_RECORDED_INCOME_STATEMENT==='1';
 const matchStatement=process.env.CREST_TEST_STATEMENT_MATCH_REVIEW==='1';
 const saveMatchDraft=process.env.CREST_TEST_STATEMENT_MATCH_DRAFTS==='1';
 const supplierBills=process.env.CREST_TEST_SUPPLIER_BILL_DRAFTS==='1';
 const payableReview=matchStatement&&saveMatchDraft&&supplierBills&&process.env.CREST_TEST_SUPPLIER_PAYABLE_REVIEW==='1';
 const payableReports=payableReview&&process.env.CREST_TEST_SUPPLIER_PAYABLE_POSTING==='1';
 const f=await sourceExportBrowserFixture({product:true,workspace:true,expenses:true,catalog:true,quotes:true,
  quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,
  financeAccounts:true,financeMappings:true,financeCategoryMappings:true,financeTaxProfiles:true,financeMoneyChannels:true,
  invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,directReceipts:true,sameDayExpenses:true,trialBalance:true,
  ...(income?{paymentCorrections:true,fundApplications:true,heldTips:true,invoiceCredits:true,paidInvoiceCredits:true,
   serviceRefunds:true,postedFinanceExport:true}:{}),
  ...(matchStatement?{postedFinanceExport:true,statementStaging:true}:{})});
 let browser,accessDiagnostic;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();accessDiagnostic=observeExpenseAccess(page,f);
  page.setDefaultTimeout(20000);
  await page.goto(f.origin+'/expenses');
  await page.getByRole('link',{name:'Sign in to view expenses',exact:true}).click();
  const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const date=(await f.client.query("SELECT (clock_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS day")).rows[0].day;
  const description='Fictional pH-neutral wash supplies';
  await page.goto(f.origin+'/expenses');
  if(supplierBills){await page.getByRole('button',{name:'Suppliers',exact:true}).click();await exerciseSupplierBills(page,date,f,name);await page.getByRole('button',{name:'Purchases',exact:true}).click();}

  await page.getByRole('button',{name:'Record expense',exact:true}).click();
  await page.getByLabel('Payment date',{exact:true}).fill(date);
  await page.getByLabel('Amount paid (USD)',{exact:true}).fill('100.00');
  await page.getByLabel('Category',{exact:true}).selectOption('supplies');
  await page.getByLabel('Description',{exact:true}).fill(description);
  await page.getByLabel('Payment method',{exact:true}).selectOption('bank');
  await page.getByText('Vendor, reference and notes (optional)',{exact:true}).click();
  await page.getByLabel('Vendor (optional)',{exact:true}).fill('Fictional detailing warehouse');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  const row=page.getByRole('article').filter({has:page.getByRole('heading',{name:description,exact:true})});
  await expect(row.getByText('Receipts',{exact:true})).toHaveCount(0);
  const denied=await page.request.post(f.origin+'/api/business/expense-receipts/list',{data:{}});
  assert.equal(denied.status(),404);
  const posting=row.getByRole('region',{name:'Accounting entry',exact:true});
  await posting.getByRole('button',{name:'Load accounting review',exact:true}).press('Enter');
  await expect(posting.getByRole('status')).toHaveText('Review the original purchase and how you paid.');
  await posting.getByLabel('Incurred date',{exact:true}).fill(date);
  await posting.getByLabel('Actual payment date',{exact:true}).fill(date);
  await posting.getByLabel('Paid from',{exact:true}).selectOption({label:'Fictional checking'});
  await posting.getByLabel('Purchase tax',{exact:true}).selectOption('verified_nonrecoverable');
  await posting.getByLabel('Included purchase tax (USD)',{exact:true}).fill('6.50');
  await posting.getByLabel('Why is the receipt unavailable?',{exact:true}).fill('Paper receipt unavailable. Statement debit reviewed.');
  await posting.getByLabel('Reference source',{exact:true}).fill('bank-statement');
  await posting.getByLabel('Transaction ID',{exact:true}).fill('Fictional-expense-100');
  await posting.getByLabel('Statement reference',{exact:true}).fill('Fictional debit reference');
  await posting.getByLabel('What did you verify before posting?',{exact:true}).fill('Same-day supplies paid from a dedicated business account.');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
   assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
   await page.screenshot({path:'.local/review/finance-expense-posting-'+name+'-'+width+'.png',fullPage:true});
  }
  let lost=false;
  await page.route('**/api/business/finance-accounts/expense-post-submit',async route=>{
   const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
   if(response.status()===200){lost=true;await response.body();await route.abort('failed');return;}
   await route.fulfill({response});
  },{times:1});
  await posting.getByRole('button',{name:'Post paid expense',exact:true}).click();
  await expect(posting.getByRole('status')).toContainText('Posting could not be confirmed');
  assert(lost);
  const original=await page.evaluate(()=>sessionStorage.getItem('crest.expense-post.pending-reference.v1'));
  assert(original);
  assert.deepEqual(Object.keys(JSON.parse(original)).sort(),['binding','businessId','expenseId','reference']);
  assert(!original.includes('Fictional'));
  await page.reload();
  await page.getByRole('button',{name:'Open expense: '+description,exact:true}).click();
  await posting.getByRole('button',{name:'Load accounting review',exact:true}).click();
  await expect(posting.getByRole('status')).toContainText('Posted to the ledger');
  await expect(row.getByRole('button',{name:'Correct or void',exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.expense-post.pending-reference.v1')),null);
  const download=page.waitForEvent('download');
  await posting.getByRole('button',{name:'Download posted expense CSV',exact:true}).click();
  assert.match(await readFile(await (await download).path(),'utf8'),/"10000","650","verified_nonrecoverable"/);
  assert.deepEqual((await f.client.query('SELECT gross_cents::text,purchase_tax_cents::text FROM crest.posted_expenses WHERE business_id=$1',
   [f.business])).rows,[{gross_cents:'10000',purchase_tax_cents:'650'}]);
  await page.goto(f.origin+'/settings/accounts');
  const accounting=page.getByRole('navigation',{name:'Accounting sections',exact:true});
  const reports=accounting.getByRole('button',{name:'Reports',exact:true});
  const setupView=accounting.getByRole('button',{name:'Setup',exact:true});
  const accountsView=accounting.getByRole('button',{name:'Accounts',exact:true});
  const report=page.getByRole('region',{name:'Fictional trial balance',exact:true});
  await expect(reports).toHaveAttribute('aria-current','true');
  await expect(report.getByLabel('Through date (optional)',{exact:true})).toBeVisible();
  await expect(report.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeHidden();
  await mkdir('.local/review',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>window.scrollTo(0,0));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:'.local/review/accounting-landing-'+name+'-'+width+'.png'});
  }
  await reports.press('Enter');
  await expect(page.getByRole('heading',{name:'Reports',exact:true})).toBeFocused();
  await page.setViewportSize({width:390,height:900});
  if(matchStatement){
   await setupView.click();
   const staging=page.getByRole('region',{name:'Fictional bank statement staging',exact:true});
   await staging.getByLabel('Dedicated money account').selectOption({label:'Fictional checking (1234)'});
   await staging.getByLabel('Fictional source file for checksum').setInputFiles({
    name:'fictional-bank.csv',mimeType:'text/csv',buffer:Buffer.from(date+', -100.00\n'),
   });
   await staging.getByLabel('Statement start date').fill(date);
   await staging.getByLabel('Statement end date').fill(date);
   await staging.getByLabel('Opening balance (USD)').fill('40.00');
   await staging.getByLabel('Closing balance (USD)').fill('-60.00');
   await staging.getByLabel('Provider statement date convention').fill('Fictional settlement day');
   await staging.getByLabel('Completeness review').fill('Fictional full statement reviewed');
   await staging.getByLabel('Statement rows',{exact:true}).fill(date+', -100.00');
   await staging.getByRole('button',{name:'Review statement',exact:true}).click();
   await staging.getByRole('button',{name:'Stage reviewed statement',exact:true}).click();
   await expect(staging.getByText('Statement staged. 1 rows retained',{exact:false})).toBeVisible();
   await staging.getByText('Review statement matches',{exact:true}).click();
   const match=staging.getByRole('region',{name:'Statement match review',exact:true});
   await match.getByRole('button',{name:'Load posted movements',exact:true}).click();
   await expect(match.getByRole('status')).toHaveText('Posted movements loaded.');
   await match.getByLabel('Statement row',{exact:true}).selectOption({index:1});
   await match.getByLabel('Posted movement',{exact:true}).selectOption({index:1});
   await match.getByLabel('Signed amount to allocate (USD)',{exact:true}).fill('-100.01');
   await match.getByRole('button',{name:'Add proposed match',exact:true}).click();
   await expect(match.getByRole('status')).toContainText('Check the signed amount.');
   await match.getByLabel('Signed amount to allocate (USD)',{exact:true}).fill('-100.00');
   await match.getByRole('button',{name:'Add proposed match',exact:true}).click();
   await expect(match.getByText('Every statement row is fully allocated in this preview.',{exact:true})).toBeVisible();
   if(saveMatchDraft){
    await match.getByLabel('Match draft review note',{exact:true}).fill('Fictional statement expense matched');
    await match.getByRole('button',{name:'Save match draft',exact:true}).click();
    await expect(match.getByRole('status')).toHaveText('Match draft saved.');
    await expect(match.getByText('Saved draft revision 1',{exact:false})).toBeVisible();
    await staging.getByText('Review statement matches',{exact:true}).click();
    await staging.getByText('Review statement matches',{exact:true}).click();
    await match.getByRole('button',{name:'Load posted movements',exact:true}).click();
    await expect(match.getByRole('status')).toHaveText('Saved match draft loaded.');
    await expect(match.getByText('Every statement row is fully allocated in this preview.',{exact:true})).toBeVisible();
   }
   await match.getByRole('button',{name:'Remove match 1',exact:true}).click();
   await expect(match.getByText('1 statement row needs a match.',{exact:true})).toBeVisible();
   if(saveMatchDraft){
    await match.getByLabel('Match draft review note',{exact:true}).fill('Fictional match withdrawn for review');
    await page.route('**/api/business/finance-accounts/statement-match-draft-save',async route=>{
     const response=await route.fetch();
     assert.equal(response.status(),200);
     await route.abort('failed');
    },{times:1});
    await match.getByRole('button',{name:'Save match draft',exact:true}).click();
    await expect(match.getByRole('status')).toContainText('The save could not be confirmed.');
    await match.getByRole('button',{name:'Retry match draft save',exact:true}).click();
    await expect(match.getByRole('status')).toHaveText('Match draft saved.');
    await expect(match.getByText('Saved draft revision 2',{exact:false})).toBeVisible();
   }
   await staging.getByText('Review statement matches',{exact:true}).click();
   await reports.click();
  }
  if(income){
   const reportPicker=page.getByRole('group',{name:'Choose a report',exact:true});
   const ledgerView=reportPicker.getByRole('button',{name:'Ledger',exact:true});
   const incomeView=reportPicker.getByRole('button',{name:'Income',exact:true});
   await expect(ledgerView).toHaveAttribute('aria-pressed','true');
   await incomeView.press('Enter');
   await expect(incomeView).toHaveAttribute('aria-pressed','true');
   await expect(report).toHaveCount(0);
   const statement=page.getByRole('region',{name:'Recorded income statement',exact:true});
   await statement.getByLabel('From date',{exact:true}).fill(date);
   await statement.getByLabel('Through date',{exact:true}).fill(date);
   // Retain the genuine server body before forwarding it unchanged. Chromium
   // can discard its protocol body handle even in the response-event callback.
   // One real POST, no redirects/retries, fabricated payload or changed headers.
   const incomeBody=Promise.withResolvers(),incomePattern='**/api/business/finance-accounts/recorded-income-statement';let incomeCalls=0,incomeMetadata;
   void incomeBody.promise.catch(()=>undefined);
   const retainIncome=async route=>{try{incomeCalls++;assert.equal(route.request().method(),'POST');const response=await route.fetch({maxRedirects:0,maxRetries:0});assert.equal(response.status(),200);const body=await response.json();await route.fulfill({response});incomeBody.resolve(body);}catch(error){incomeBody.reject(error);await route.abort('failed').catch(()=>undefined);}};
   await page.route(incomePattern,retainIncome);
   try{
    const browserIncome=page.waitForResponse(response=>response.url().endsWith('/api/business/finance-accounts/recorded-income-statement'));
    const [body,response]=await Promise.all([incomeBody.promise,browserIncome,statement.getByRole('button',{name:'Load income statement',exact:true}).press('Enter')]);
    incomeMetadata=body;assert.equal(response.status(),200);assert.equal(incomeCalls,1);
   }finally{await page.unroute(incomePattern,retainIncome);}
   await expect(statement.getByRole('status')).toHaveText('Recorded income loaded.');
   await reviewAccountingReportWorkspace(page,statement,{label:'income-'+name,values:[['Recorded-book net income','-$100.00']]});
   await expect(statement.locator('time[title]')).toHaveAttribute('datetime',incomeMetadata.observedAt);
   await expect(statement.locator('time[title]')).toHaveAttribute('title',incomeMetadata.observedAt);
   await expect(statement).toContainText(incomeMetadata.timeZone);
   await expect(statement.getByText('Coverage incomplete',{exact:true})).toBeVisible();
   const period=statement.locator('p').filter({hasText:'Income statement ·'});
   await expect(period.locator('time[datetime="'+date+'"]')).toHaveCount(1);
   await expect(statement.getByRole('row',{name:'Recorded-book net income -$100.00',exact:true})).toBeVisible();
   const incomeCsv=page.waitForEvent('download');
   await statement.getByRole('button',{name:'Download income statement CSV',exact:true}).click();
   assert.match(await readFile(await (await incomeCsv).path(),'utf8'),/"Recorded-book net income","","","","-10000"/);
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await period.scrollIntoViewIfNeeded();
    assert.equal(await period.locator('..').evaluate(element=>getComputedStyle(element).position),'sticky');
    await expect(period.locator('..').getByText('Coverage incomplete',{exact:true})).toBeVisible();
    if(width===1440){
     const dates=await statement.locator('input[type="date"]').evaluateAll(inputs=>inputs.map(input=>input.getBoundingClientRect().bottom));
     const loadBottom=await statement.getByRole('button',{name:'Load income statement',exact:true}).evaluate(button=>button.getBoundingClientRect().bottom);
     assert(dates.every(bottom=>Math.abs(bottom-loadBottom)<2));
    }
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).include('[aria-label="Recorded income statement"]').withTags(['wcag2a','wcag2aa']).analyze();
    assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
    await page.screenshot({path:'.local/review/finance-income-statement-'+name+'-'+width+'.png'});
   }
   await ledgerView.press('Enter');
   await expect(statement).toHaveCount(0);
   await incomeView.press('Enter');
   await expect(statement.getByRole('table')).toHaveCount(0);
   await ledgerView.press('Enter');
  }
  await expect(setupView).toBeVisible();
  await expect(accountsView).toBeVisible();
  await report.getByLabel('Through date (optional)',{exact:true}).fill(date);
  const dateControl=await report.getByLabel('Through date (optional)',{exact:true}).elementHandle();
  await report.getByRole('button',{name:'Load trial balance',exact:true}).press('Enter');
  await expect(report.getByRole('status')).toHaveText('Posted balances loaded.');
  assert(await dateControl.evaluate(element=>element.isConnected),'loading a snapshot must retain the mounted date control');
  await reviewAccountingReportWorkspace(page,report,{label:'ledger-'+name,values:[['Debit balances','$100.00'],['Credit balances','$100.00']],pickerExpected:income||payableReports});
  await expect(report.getByRole('row').filter({hasText:'Fictional wash supplies'})).toContainText('$100.00');
  await expect(report.getByRole('row').filter({hasText:'Fictional dedicated bank'})).toContainText('$100.00');
  await accountsView.press('Enter');
  await expect(page.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeFocused();
  await expect(report).toBeHidden();
  await reports.press('Enter');
  await expect(report.getByRole('status')).toHaveText('Posted balances loaded.');
  const csv=page.waitForEvent('download');
  await report.getByRole('button',{name:'Download trial balance CSV',exact:true}).click();
  assert.match(await readFile(await (await csv).path(),'utf8'),/"10000","10000","10000","10000"/);
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await report.getByRole('table').scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const amount=report.getByRole('cell',{name:'$100.00',exact:true}).first();
   assert(await amount.evaluate(cell=>{
    const range=document.createRange();
    range.selectNodeContents(cell);
    return range.getClientRects().length===1;
   }),'Amounts keep their cents on the same line.');
   const audit=await new AxeBuilder({page}).include('.trial-balance').withTags(['wcag2a','wcag2aa']).analyze();
   assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
   await page.screenshot({path:'.local/review/finance-trial-balance-'+name+'-'+width+'.png'});
  }
  await report.getByText('Balance sheet',{exact:true}).click();
  const sheet=report.getByRole('region',{name:'Recorded balance sheet',exact:true});
  await expect(sheet.getByRole('row',{name:'Accumulated recorded-book earnings -$100.00',exact:true})).toBeVisible();
  await expect(sheet.getByRole('row',{name:'Total assets -$100.00',exact:true})).toBeVisible();
  await expect(sheet.getByRole('row',{name:'Total liabilities and equity -$100.00',exact:true})).toBeVisible();
  const sheetCsv=page.waitForEvent('download');
  await sheet.getByRole('button',{name:'Download balance sheet CSV',exact:true}).click();
  assert.match(await readFile(await (await sheetCsv).path(),'utf8'),/"Equity","","Accumulated recorded-book earnings","","-10000"/);
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await sheet.getByRole('table').scrollIntoViewIfNeeded();
   const headingsOverlap=await report.evaluate(section=>{
    const outer=section.querySelector(':scope > [data-report-reading] > header')?.getBoundingClientRect(),nested=section.querySelector('section[aria-label="Recorded balance sheet"] > header')?.getBoundingClientRect();
    if(!outer||!nested)throw Error('Both report scope headings are required');
    return outer.bottom>Math.max(0,nested.top)&&nested.bottom>Math.max(0,outer.top)&&outer.top<innerHeight&&nested.top<innerHeight;
   });
   assert.equal(headingsOverlap,false,'Opening the balance sheet must not stack two scope headings over each other.');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="Recorded balance sheet"]').withTags(['wcag2a','wcag2aa']).analyze()).violations.map(entry=>entry.id),[]);
   await page.screenshot({path:'.local/review/finance-balance-sheet-'+name+'-'+width+'.png'});
  }
  const bankAccount=sheet.getByRole('button',{name:/Fictional dedicated bank/});
  await bankAccount.press('Enter');
  const journalAccount=report.getByLabel('Account (optional)',{exact:true});
  await expect(journalAccount).toBeFocused();
  await expect(journalAccount.locator('option:checked')).toContainText('Fictional dedicated bank');
  await expect(sheet).toBeHidden();
  await report.getByLabel('Account (optional)',{exact:true}).selectOption({label:'5005 · Fictional wash supplies'});
  await report.getByRole('button',{name:'Load journal entries',exact:true}).click();
  const journal=report.getByRole('table',{name:'Posted journal page',exact:true});
  await expect(journal.getByRole('row').filter({hasText:'Fictional wash supplies'})).toContainText('$100.00');
  await expect(journal).not.toContainText('Fictional dedicated bank');
  const journalCsv=page.waitForEvent('download');
  await report.getByRole('button',{name:'Download journal page CSV',exact:true}).click();
  assert.match(await readFile(await (await journalCsv).path(),'utf8'),/"Fictional wash supplies",[^\r\n]+"10000","0"/);
  await report.getByText('Journal entries',{exact:true}).click();
  await expect(journal).toHaveCount(0);
  const priorDate=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  await report.getByLabel('Through date (optional)',{exact:true}).fill(priorDate);
  await expect(report.getByRole('table')).toHaveCount(0);
  await report.getByRole('button',{name:'Load trial balance',exact:true}).click();
  await expect(report.getByRole('status')).toHaveText('No supported entries have been posted through this date.');
  await page.route('**/api/business/finance-accounts/trial-balance',route=>route.abort('failed'),{times:1});
  await report.getByRole('button',{name:'Load trial balance',exact:true}).click();
  await expect(report.getByRole('status')).toContainText('Crest could not load a verified trial balance');
  await expect(report.getByRole('button',{name:'Download trial balance CSV',exact:true})).toHaveCount(0);
  if(supplierBills){
   await page.goto(f.origin+'/export-files');
   await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
   const financeDownload=page.waitForEvent('download');
   await page.getByRole('button',{name:'Save ZIP',exact:true}).click();
   const {'manifest.json':manifest,'export_delivery.json':delivery,...source}=unzipSync(await readFile(await (await financeDownload).path()));
   assert.equal(verifyFinanceSourceExport(strFromU8(manifest),Object.entries(source).map(([name,bytes])=>
    ({name,content:strFromU8(bytes)})),f.business).profile,payableReview?'crest.posted-finance-source.v23':'crest.posted-finance-source.v22');
   assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,payableReview?109:108);
   const retained=JSON.parse(strFromU8(source['supplier_bill_draft_source.json'])).revisions;
   assert.equal(retained.length,3);
   assert.equal(retained.find(row=>row.revision==='2').payload.changeReason,'Fictional source reviewed');
   assert(retained.every(row=>row.businessId===f.business));
  }
 }catch(error){t.diagnostic(JSON.stringify((await accessDiagnostic?.report())??{diagnosticUnavailable:true}));throw error;}finally{accessDiagnostic?.stop();await browser?.close();await f.close();}
},{timeout:240000});

if(process.env.CREST_TEST_RECORDED_INCOME_STATEMENT!=='1')
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' attaches and previews a private receipt from Expenses',async t=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,expenses:true,expenseReceipts:true});
 let browser,accessDiagnostic;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();accessDiagnostic=observeExpenseAccess(page,f);
  const accessGate=Promise.withResolvers();
  await page.route('**/api/auth/session',async route=>{await accessGate.promise;await route.continue();},{times:1});
  await page.goto(f.origin+'/expenses');
  const placeholder=page.locator('.expense-record-placeholder');
  await expect(page.locator('.expenses-page').getByRole('status')).toHaveText('Checking expense access…');
  await expect(placeholder.locator('.workspace-skeleton').first()).toHaveCSS('animation-name','workspace-skeleton-pass');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(placeholder.locator('.workspace-skeleton').first()).toHaveCSS('animation-name','none');
  await expect(page.getByRole('button',{name:'Record expense',exact:true})).toHaveCount(0);
  accessGate.resolve();
  await page.getByRole('link',{name:'Sign in to view expenses',exact:true}).click();
  await prepareExpenseBrowserCode(f);
  const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const historyGate=Promise.withResolvers();
  await page.route('**/api/business/expenses/history',async route=>{await historyGate.promise;await route.continue();},{times:1});
  await page.goto(f.origin+'/expenses');
  await expect(page.locator('.expenses-page').getByRole('status')).toHaveText('Loading saved expenses…');
  await expect(placeholder).toBeVisible();
  const record=page.getByRole('button',{name:'Record expense',exact:true});
  await expect(record).toBeDisabled();
  await page.evaluate(()=>document.fonts.ready);
  const heading=page.getByRole('heading',{name:'Saved expenses',exact:true});
  const loadingHeading=await heading.boundingBox();
  await page.screenshot({path:'.local/review/expenses-loading-'+name+'.png'});
  historyGate.resolve();
  await expect(placeholder).toHaveCount(0);
  await expect(record).toBeEnabled();
  const loadedHeading=await heading.boundingBox();
  assert(loadingHeading&&loadedHeading&&Math.abs(loadingHeading.y-loadedHeading.y)<=1);
  await record.click();
  const date=(await f.client.query('SELECT current_date::text AS day')).rows[0].day;
  await page.getByLabel('Payment date',{exact:true}).fill(date);
  await page.getByLabel('Amount paid (USD)',{exact:true}).fill('12.99');
  await page.getByLabel('Category',{exact:true}).selectOption('supplies');
  await page.getByLabel('Description',{exact:true}).fill('Fictional towel purchase');
  await page.getByLabel('Payment method',{exact:true}).selectOption('bank');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  const expense=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Fictional towel purchase',exact:true})});
  await expense.getByText('Receipts',{exact:true}).click();
  const sharp=(await import('sharp')).default;
  const receipt=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720"><rect width="480" height="720" fill="#fffdf7"/><g fill="#20232b" font-family="sans-serif"><text x="40" y="65" font-size="21" font-weight="bold">FICTIONAL TEST RECEIPT</text><text x="40" y="110" font-size="18">Demo supply store</text><text x="40" y="145" font-size="16">${date}</text><path d="M40 180H440" stroke="#9a9a94"/><text x="40" y="230" font-size="18">Test towel supplies</text><text x="440" y="230" text-anchor="end" font-size="18">$12.99</text><path d="M40 280H440" stroke="#9a9a94"/><text x="40" y="330" font-size="23" font-weight="bold">TOTAL</text><text x="440" y="330" text-anchor="end" font-size="23" font-weight="bold">$12.99</text><text x="40" y="390" font-size="16">Payment: fictional bank entry</text><text x="40" y="540" font-size="16">Synthetic development fixture.</text><text x="40" y="575" font-size="16">Not a real purchase or tax document.</text><text x="40" y="640" font-size="16">Preview and zoom verification only.</text></g></svg>`)).png().toBuffer();
  await expense.getByLabel('Receipt file',{exact:true}).setInputFiles({name:'fictional-receipt.png',mimeType:'image/png',buffer:receipt});
  let publicationStatus;
  await page.route('**/api/business/expense-receipts/publish',async route=>{
   const response=await route.fetch();
   publicationStatus=response.status();
   await route.abort('failed');
  },{times:1});
  const upload=page.waitForResponse(response=>response.url()===f.origin+'/api/business/expense-receipts/upload-file');
  await expense.getByRole('button',{name:'Attach receipt',exact:true}).click();
  assert.equal((await upload).status(),200);
  await expect(expense.getByRole('status')).toContainText('Receipt outcome is unknown');
  assert.equal(publicationStatus,200);
  await expense.getByRole('button',{name:'Check interrupted receipt',exact:true}).click();
  await expect(expense.getByRole('status')).toHaveText('Original receipt publication confirmed.');
  await expense.getByRole('button',{name:'View preview for receipt 1',exact:true}).click();
  const preview=expense.getByRole('img',{name:'Verified receipt preview',exact:true});
  await expect(preview).toBeVisible();
  await page.waitForFunction(()=>document.querySelector('.receipt-preview img')?.naturalWidth>0);
  await expect(expense.getByRole('button',{name:'Close preview',exact:true})).toBeFocused();
  await mkdir('.local/review',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('.expense-receipts').withTags(['wcag2a','wcag2aa']).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/expenses-verified-receipt-'+name+'-'+width+'.png',animations:'disabled'});
  }
  await expect(expense.locator('.receipt-preview-context')).toContainText('Recorded expense: $12.99 USD');await captureExpenseState(page,name,'receipt-verified');
  await reviewReceiptDocumentViewer(page,{fixture:f,expense,engine:name});
  await openReceiptDownloads(expense,1);
  const [download]=await Promise.all([page.waitForEvent('download'),expense.getByRole('button',{name:'Download receipt 1',exact:true}).click()]);
  assert.deepEqual(await readFile(await download.path()),receipt);
  await page.route('**/api/business/expense-receipts/list',route=>route.abort('failed'));await expense.getByRole('button',{name:'Load saved receipts',exact:true}).click();await expect(expense.getByRole('status')).toHaveText('Saved receipts could not be verified. Load them again to check.');await expect(preview).toHaveCount(0);await expect(expense.locator('.receipt-saved-row')).toHaveCount(0);await expect(expense.getByText('No saved receipts for this expense.',{exact:true})).toHaveCount(0);await captureExpenseState(page,name,'receipt-read-lost');
  await page.unroute('**/api/business/expense-receipts/list');await expense.getByRole('button',{name:'Load saved receipts',exact:true}).click();await expect(expense.getByRole('status')).toHaveText('Saved receipt list refreshed.');await expect(preview).toHaveCount(0);await expense.getByRole('button',{name:'View preview for receipt 1',exact:true}).click();await expect(preview).toBeVisible();
  await page.getByRole('button',{name:'Exports',exact:true}).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole('button',{name:'Purchases',exact:true}).click();
  await expect(preview).toHaveCount(0);
  let receiptCount=1,rejectedReceiptReservations=0;
  if(process.env.CREST_EXPENSE_RECEIPT_IMAGE_ID){
   const receipts=expense.locator('.expense-receipts');
   if(await receipts.getAttribute('open')===null)await receipts.locator('summary').click();
   await expense.getByRole('button',{name:'Load saved receipts',exact:true}).click();
   await expect(expense.getByRole('status')).toHaveText('Saved receipt list refreshed.');
   const {pdf}=await import('../support/pdf-fixtures.mjs');
   const {encodeHeic}=await import('../support/heic-fixtures.mjs');
   const formats=[
    {name:'fictional-receipt.jpg',type:'image/jpeg',bytes:await sharp(receipt).jpeg().toBuffer()},
    {name:'fictional-receipt.pdf',type:'application/pdf',bytes:pdf({pages:1})},
    {name:'fictional-receipt.heic',type:'image/heic',bytes:await encodeHeic([receipt])},
   ];
   for(const file of formats){
    await expense.getByLabel('Receipt file',{exact:true}).setInputFiles({name:file.name,mimeType:file.type,buffer:file.bytes});
    await expense.getByRole('button',{name:'Attach receipt',exact:true}).click();
    await expect(expense.getByRole('status')).toHaveText('Receipt saved and checked.',{timeout:85000});
    receiptCount++;
    const downloads=expense.getByRole('region',{name:'Receipt '+receiptCount,exact:true}).locator('details.receipt-downloads');
    assert.equal(await downloads.evaluate(node=>node.open),false,'A newly attached receipt keeps its download controls closed');
    await openReceiptDownloads(expense,receiptCount);
    const button=expense.getByRole('button',{name:'Download receipt '+receiptCount,exact:true});await expect(button).toBeVisible();
    const [saved]=await Promise.all([page.waitForEvent('download'),button.click()]);
    assert.deepEqual(await readFile(await saved.path()),file.bytes);
   }
   console.log('SYNTHETIC_RECEIPT_WORKER_FORMATS '+name+' image/png,image/jpeg,application/pdf,image/heic');
   const workerPath=join(f.workspace,'expense-receipts','worker.json'),originalProfile=await readFile(workerPath);
   try{
    const profile=JSON.parse(originalProfile);profile.documentKind='supplier-original';
    await writeFile(workerPath,JSON.stringify(profile));
    await expense.getByLabel('Receipt file',{exact:true}).setInputFiles({name:'fictional-wrong-profile.png',mimeType:'image/png',buffer:receipt});
    const refused=page.waitForResponse(response=>response.url()===f.origin+'/api/business/expense-receipts/publish');
    await expense.getByRole('button',{name:'Attach receipt',exact:true}).click();
    assert.equal((await refused).status(),503);
    await expect(expense.getByRole('status')).toContainText('Receipt outcome is unknown');
    await expect(expense.getByRole('link',{name:'Review interrupted receipt request',exact:true})).toBeVisible();
    rejectedReceiptReservations=1;
   }finally{await writeFile(workerPath,originalProfile);}
  }
  const rows=await f.client.query("SELECT revision,payload->>'amountCents' AS amount FROM crest.expense_revisions WHERE business_id=$1",[f.business]);
  assert.equal(rows.rowCount,1,'attaching a receipt must not revise the expense');
  assert.equal(rows.rows[0].amount,'1299');
  assert.equal((await f.client.query('SELECT count(*)::int AS count FROM crest.expense_receipt_revisions WHERE business_id=$1',[f.business])).rows[0].count,2*receiptCount+rejectedReceiptReservations);
 }catch(error){t.diagnostic(JSON.stringify((await accessDiagnostic?.report())??{diagnosticUnavailable:true}));throw error;}finally{accessDiagnostic?.stop();await browser?.close();await f.close();}
},{timeout:process.env.CREST_EXPENSE_RECEIPT_IMAGE_ID?360000:180000});
