import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' posts a reviewed paid expense and recovers the original',async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,expenses:true,catalog:true,quotes:true,
  quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,
  financeAccounts:true,financeMappings:true,financeCategoryMappings:true,financeTaxProfiles:true,financeMoneyChannels:true,
  invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,directReceipts:true,sameDayExpenses:true,trialBalance:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
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
  await page.getByRole('button',{name:'Load saved expenses',exact:true}).click();
  await page.getByLabel('Payment date',{exact:true}).fill(date);
  await page.getByLabel('Amount paid (USD)',{exact:true}).fill('100.00');
  await page.getByLabel('Category',{exact:true}).selectOption('supplies');
  await page.getByLabel('Description',{exact:true}).fill(description);
  await page.getByLabel('Payment method',{exact:true}).selectOption('bank');
  await page.getByText('Vendor, reference and notes (optional)',{exact:true}).click();
  await page.getByLabel('Vendor (optional)',{exact:true}).fill('Fictional detailing warehouse');
  await page.getByRole('button',{name:'Save expense',exact:true}).click();
  const row=page.getByRole('article').filter({has:page.getByRole('heading',{name:description,exact:true})});
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
  await page.getByRole('button',{name:'Load saved expenses',exact:true}).click();
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
  await page.getByRole('button',{name:'Load accounts',exact:true}).click();
  await page.getByText('Fictional trial balance',{exact:true}).click();
  const report=page.getByRole('region',{name:'Fictional trial balance',exact:true});
  await report.getByLabel('Through date (optional)',{exact:true}).fill(date);
  await report.getByRole('button',{name:'Load trial balance',exact:true}).press('Enter');
  await expect(report.getByRole('status')).toHaveText('Posted balances loaded.');
  await expect(report.getByRole('row').filter({hasText:'Fictional wash supplies'})).toContainText('$100.00');
  await expect(report.getByRole('row').filter({hasText:'Fictional dedicated bank'})).toContainText('$100.00');
  const csv=page.waitForEvent('download');
  await report.getByRole('button',{name:'Download trial balance CSV',exact:true}).click();
  assert.match(await readFile(await (await csv).path(),'utf8'),/"10000","10000","10000","10000"/);
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await report.getByRole('table').scrollIntoViewIfNeeded();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('.trial-balance').withTags(['wcag2a','wcag2aa']).analyze();
   assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
   await page.screenshot({path:'.local/review/finance-trial-balance-'+name+'-'+width+'.png'});
  }
  await report.getByText('Journal entries',{exact:true}).click();
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
 }finally{await browser?.close();await f.close();}
},{timeout:240000});
