import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {strFromU8,unzipSync} from 'fflate';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {recoveryCluster} from '../support/recovery-drill.mjs';

const financeRoute='/api/business/finance-accounts/';
const beginFinanceCalls=page=>page.evaluate(async prefix=>{
 const initial={'content-type':'application/json'};
 const auth=await fetch('/api/auth/session',{method:'POST',headers:initial,body:'{}'});
 if(!auth.ok)throw Error('Fictional browser session proof failed');
 const {csrfToken}=await auth.json();
 const headers={...initial,'x-crest-csrf':csrfToken};
 const response=await fetch(prefix+'context',{method:'POST',headers,body:'{}'});
 if(!response.ok)throw Error('Fictional finance context failed');
 const binding=response.headers.get('x-crest-edit-binding');
 if(!binding)throw Error('Fictional finance edit binding is absent');
 return {headers:{...headers,'x-crest-edit-binding':binding},context:await response.json()};
},financeRoute);
const financeCall=(page,headers,route,body)=>page.evaluate(async ({headers,route,body,prefix})=>{
 let response;
 try{
  response=await fetch(prefix+route,{method:'POST',headers,body:JSON.stringify(body)});
 }catch{return {status:null};}
 return {status:response.status,body:await response.json()};
},{headers,route,body,prefix:financeRoute});

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' reviews a saved supplier draft and reads recorded payables',
 {timeout:180000,skip:process.env.CREST_TEST_SUPPLIER_PAYABLE_REVIEW!=='1'},async()=>{
  const cluster=await recoveryCluster();
  const previous=process.env.CREST_TEST_DATABASE_URL;
  process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,legacyContactMatches:true,legacyContactBatches:true,legacyContactEffects:true,legacyContactTargets:true,legacyContactDecisions:true,legacyContactApprovals:true,expenses:true,financeAccounts:true,
    financeMoneyChannels:true,postedFinanceExport:true,statementStaging:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}});
   const page=await context.newPage();
   await page.goto(fixture.origin+'/expenses');
   await expect(page.getByRole('link',{name:'Sign in to view expenses'})).toBeVisible();
   await expect(page.getByText('Recorded supplier payables',{exact:true})).toHaveCount(0);
   if(fixture.originalFile){
    const denied=await page.evaluate(async originalId=>(await fetch('/api/business/supplier-original/status',{
     method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({originalId}),
    })).status,randomUUID());
    assert.equal(denied,400);
   }
   await page.getByRole('link',{name:'Sign in to view expenses'}).click();
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
   await page.goto(fixture.origin+'/expenses');
   await page.getByText('Unpaid supplier bills',{exact:true}).click();
   const draft=page.getByRole('form',{name:'Supplier bill draft',exact:true});
   const {rows:[{day}]}=await fixture.client.query("SELECT (clock_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS day");
   await draft.getByLabel('Incurred date',{exact:true}).fill(day);
   await draft.getByLabel('Due date',{exact:true}).fill(day);
   await draft.getByLabel('Supplier',{exact:true}).fill('Fictional workshop supplier');
   await draft.getByLabel('Bill reference (optional)',{exact:true}).fill('Fictional bill 004');
   await draft.getByLabel('Bill total (USD)',{exact:true}).fill('150.25');
   await draft.getByLabel('Purchase tax included in total (USD, if known)',{exact:true}).fill('0');
   await draft.getByLabel('Business purpose',{exact:true}).fill('Fictional workshop supplies');
   await draft.getByLabel('Original document status',{exact:true}).fill('Fictional file is awaiting review');
   await draft.getByLabel('Category for split 1',{exact:true}).selectOption('supplies');
   await draft.getByLabel('Amount for split 1 (USD)',{exact:true}).fill('150.25');
   await draft.getByRole('button',{name:'Save supplier bill draft',exact:true}).click();
   await expect(page.getByText('Supplier bill draft saved.',{exact:true})).toBeVisible();
   await page.getByText('Preview the payable entry',{exact:true}).click();
   const review=page.getByRole('form',{name:'Supplier payable entry preview'});
   await review.getByLabel('Purchase tax treatment').selectOption('none');
   await review.getByLabel('Reason for the review').fill('Fictional purchase tax review');
   await review.getByRole('button',{name:'Review expense and payable amounts'}).click();
   await expect(page.getByText('A verified original is required for this revision.',{exact:true})).toBeVisible();
   const register=page.getByRole('region',{name:'Recorded supplier payables',exact:true});
   await register.getByText('Recorded supplier payables',{exact:true}).click();
   await register.getByRole('button',{name:'Load supplier payables',exact:true}).click();
   await expect(register.getByRole('status')).toHaveText('No supplier payables were recorded through that date.');
   await expect(register).toContainText('$0.00 outstanding');
   assert.equal((await fixture.client.query('SELECT count(*)::int AS count FROM crest.financial_events WHERE business_id=$1',
    [fixture.business])).rows[0].count,0);
   if(fixture.preparePayable){
    const {rows:[saved]}=await fixture.client.query('SELECT bill_id,revision::text FROM crest.supplier_bill_draft_revisions WHERE business_id=$1',
     [fixture.business]);
    const {channelId}=await fixture.preparePayable(day);
    const originalForm=page.getByRole('form',{name:'Verify supplier bill original'});
    await originalForm.getByLabel('Original bill file',{exact:true}).setInputFiles({
     name:fixture.originalMimeType==='application/pdf'?'fictional-supplier.pdf':'fictional-supplier.png',
     mimeType:fixture.originalMimeType,buffer:fixture.originalFile,
    });
    const verification=Promise.withResolvers();
    await page.route('**/api/business/supplier-original/verify',async route=>{
     let status;
     try{status=(await route.fetch({timeout:95000})).status();}catch{/* Report only the status, without private request headers. */}
     finally{
      await route.abort('failed').catch(()=>undefined);
      verification.resolve(status);
     }
    },{times:1});
    await originalForm.getByRole('button',{name:'Upload and verify original',exact:true}).click();
    assert.equal(await verification.promise,200,'verification must commit before simulating the lost reply');
    await expect(page.getByText('Verification could not be confirmed.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Check original upload',exact:true}).click();
    await expect(page.getByText('Original bill verified.',{exact:true})).toBeVisible();
    const {rows:[original]}=await fixture.client.query('SELECT id AS original_id FROM crest.supplier_bill_originals WHERE business_id=$1',
     [fixture.business]);
    const originalId=original.original_id;
    await review.getByRole('button',{name:'Review expense and payable amounts'}).click();
    await expect(page.getByRole('heading',{name:'Proposed entry for Fictional workshop supplier'})).toBeVisible();
    await expect(page.getByText('Credit accounts payable $150.25',{exact:true})).toBeVisible();
    await page.route('**/api/business/supplier-original/preview',async route=>{
     const response=await route.fetch();
     await route.fulfill({response,headers:{...response.headers(),'x-crest-sha256':'0'.repeat(64)}});
    },{times:1});
    await page.getByRole('button',{name:'View verified bill preview',exact:true}).click();
    await expect(page.getByText('The verified preview could not be opened.',{exact:true})).toBeVisible();
    await expect(page.getByRole('img',{name:'Verified supplier bill preview',exact:true})).toHaveCount(0);
    const previewReply=page.waitForResponse(response=>response.url().endsWith('/api/business/supplier-original/preview'));
    await page.getByRole('button',{name:'View verified bill preview',exact:true}).click();
    const downloadedPreview=await previewReply;
    assert.equal(downloadedPreview.status(),200);
    assert.match(downloadedPreview.headers()['x-crest-sha256'],/^[a-f0-9]{64}$/);
    const previewImage=page.getByRole('img',{name:'Verified supplier bill preview',exact:true});
    await expect(previewImage).toBeVisible();
    assert(await previewImage.evaluate(image=>image.naturalWidth>0&&image.getBoundingClientRect().right<=innerWidth));
    const input={billId:saved.bill_id,revision:saved.revision,originalId,taxTreatment:'none',reason:'Fictional purchase tax review'};
    const {headers,context:authContext}=await beginFinanceCalls(page);
    const checked=await financeCall(page,headers,'supplier-payable-review',input);
    assert.equal(checked.status,200);
    assert.deepEqual(checked.body.candidates,[]);
    const reference={kind:'payable',operationId:randomUUID(),id:randomUUID(),recoveryEpoch:authContext.recoveryEpoch};
    const accrue={reference,review:input,planSha256:checked.body.plan.planSha256,reviewedDuplicates:[],distinctReason:null};
    const wrongPlan=await financeCall(page,headers,'supplier-payable-accrual',{...accrue,planSha256:'0'.repeat(64)});
    assert.deepEqual(wrongPlan,{status:409,body:{error:'SUPPLIER_PAYABLE_REVIEW_CHANGED'}});
    const approval=page.getByRole('form',{name:'Confirm supplier bill posting'});
    const postButton=approval.getByRole('button',{name:'Post supplier bill',exact:true});
    await expect(postButton).toBeDisabled();
    await approval.getByLabel('Record the expense and amount owed on '+day+'.',{exact:true}).check();
    let interruptedStatus;
    await page.route('**'+financeRoute+'supplier-payable-accrual',async route=>{
     try{interruptedStatus=(await route.fetch()).status();}finally{await route.abort('failed');}
    },{times:1});
    await postButton.click();
    await expect(page.getByText('The outcome is unconfirmed.',{exact:false})).toBeVisible();
    assert.equal(interruptedStatus,200);
    await page.getByRole('button',{name:'Check original posting request',exact:true}).click();
    await expect(page.getByText('Supplier bill posted. Reload Recorded supplier payables.',{exact:true})).toBeVisible();
    await register.getByRole('button',{name:'Load supplier payables',exact:true}).click();
    await expect(register).toContainText('$150.25 outstanding');
    await register.getByText('Record supplier payment',{exact:true}).click();
    const payment=register.getByRole('form',{name:'Confirm supplier payment'});
    await payment.getByLabel('Actual payment date',{exact:true}).fill(day);
    await payment.getByRole('button',{name:'Load payment accounts',exact:true}).click();
    await payment.getByLabel('Payment account',{exact:true}).selectOption(channelId);
    await payment.getByLabel('Paid amount (USD)',{exact:true}).fill('100.25');
    await payment.getByLabel('Statement transaction ID',{exact:true}).fill('fictional-debit-004');
    await payment.getByLabel('Statement description',{exact:true}).fill('Fictional bank statement item');
    await payment.getByLabel('Payment review note',{exact:true}).fill('Fictional debit reviewed');
    const paymentButton=payment.getByRole('button',{name:'Record verified payment',exact:true});
    await expect(paymentButton).toBeDisabled();
    await payment.getByLabel('I verified this debit on the account statement.',{exact:true}).check();
    let interruptedPaymentStatus;
    await page.route('**'+financeRoute+'supplier-payable-settlement',async route=>{
     try{interruptedPaymentStatus=(await route.fetch()).status();}finally{await route.abort('failed');}
    },{times:1});
    await paymentButton.click();
    await expect(register.getByText('The outcome is unconfirmed.',{exact:false})).toBeVisible();
    assert.equal(interruptedPaymentStatus,200);
    await register.getByRole('button',{name:'Check original posting request',exact:true}).click();
    await expect(register.getByText('Verified supplier payment recorded.',{exact:true})).toBeVisible();
    const {rows:[paymentEvidence]}=await fixture.client.query(`SELECT s.id AS settlement_id,s.payable_id,m.id AS movement_id,v.version::text AS channel_version
     FROM crest.supplier_payable_settlements s JOIN crest.financial_events e ON (e.business_id,e.supplier_payable_settlement_id)=(s.business_id,s.id)
     JOIN crest.money_movements m ON (m.business_id,m.event_id)=(e.business_id,e.id)
     JOIN crest.money_channel_versions v ON (v.business_id,v.id)=(s.business_id,s.channel_version_id) WHERE s.business_id=$1`,[fixture.business]);
    assert.equal(paymentEvidence.channel_version,'1');
    await expect(register).toContainText('$150.25 bill · $100.25 paid · $50.00 outstanding');
    await expect(register).toContainText('The register agrees with the ledger.');
    const {rows:totals}=await fixture.client.query(`SELECT e.template,count(*)::int AS count FROM crest.financial_events e
     WHERE e.business_id=$1 GROUP BY e.template ORDER BY e.template`,[fixture.business]);
    assert.deepEqual(totals,[{template:'P14',count:1},{template:'P15',count:1}]);

    await page.goto(fixture.origin+'/settings/accounts');
    await page.getByRole('button',{name:'Load accounts',exact:true}).click();
    await page.getByText('Fictional trial balance',{exact:true}).first().click();
    const trial=page.getByRole('region',{name:'Fictional trial balance',exact:true});
    await trial.getByLabel('Through date (optional)',{exact:true}).fill(day);
    const trialReply=page.waitForResponse(response=>response.url().endsWith('/api/business/finance-accounts/trial-balance'));
    await trial.getByRole('button',{name:'Load trial balance',exact:true}).click();
    assert.equal((await trialReply).status(),200);
    await expect(trial.getByRole('status')).toHaveText('Posted balances loaded.');
    await expect(trial.getByRole('row',{name:/2200.*Fictional accounts payable/})).toContainText('$50.00');
    await trial.getByText('Balance sheet',{exact:true}).click();
    const sheet=page.getByRole('region',{name:'Recorded balance sheet',exact:true});
    await expect(sheet.getByRole('row',{name:/Total liabilities and equity/})).toContainText('-$100.25');
    await trial.getByText('Journal entries',{exact:true}).click();
    await trial.getByRole('button',{name:'Load journal entries',exact:true}).click();
    await expect(trial.getByText('Supplier bill · Expense recorded',{exact:true})).toBeVisible();
    await expect(trial.getByText('Supplier payment · Verified disbursement',{exact:true})).toBeVisible();
    const [journalDownload]=await Promise.all([page.waitForEvent('download'),
     trial.getByRole('button',{name:'Download journal page CSV',exact:true}).click()]);
    const journalCsv=await readFile(await journalDownload.path(),'utf8');
    for(const expected of ['Supplier settlement ID',saved.bill_id,paymentEvidence.payable_id,paymentEvidence.settlement_id,paymentEvidence.movement_id]){
     assert(journalCsv.includes(expected));
    }

    await page.getByText('Income statement',{exact:true}).click();
    const income=page.getByRole('region',{name:'Recorded income statement',exact:true});
    await income.getByLabel('From date',{exact:true}).fill(day);
    await income.getByLabel('Through date',{exact:true}).fill(day);
    await income.getByRole('button',{name:'Load income statement',exact:true}).click();
    await expect(income.getByRole('row',{name:/Recorded-book net income/})).toContainText('-$150.25');
    await page.goto(fixture.origin+'/export-files');
    await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
    const save=page.getByRole('button',{name:'Save ZIP',exact:true});
    await expect(save).toBeVisible();
    const [download]=await Promise.all([page.waitForEvent('download'),save.click()]);
    assert.equal(download.suggestedFilename(),'crest-posted-finance.zip');
    const {['manifest.json']:manifest,['export_delivery.json']:delivery,...files}=unzipSync(await readFile(await download.path()));
    const verified=verifyFinanceSourceExport(strFromU8(manifest),Object.entries(files).map(([name,bytes])=>
     ({name,content:strFromU8(bytes)})),fixture.business);
    assert.equal(verified.profile,'crest.posted-finance-source.v23');
    assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,115);
    const supplier=JSON.parse(strFromU8(files['supplier_payable_source.json'])).tables;
    assert.equal(supplier.supplier_bill_originals[0].id,originalId);
    assert.equal(supplier.supplier_payable_settlements[0].id,paymentEvidence.settlement_id);
    assert.equal(supplier.money_movements[0].signed_cents,'-10025');
   }
   for(const width of [360,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();
    assert.deepEqual(audit.violations.map(entry=>entry.id),[]);
   }
  }finally{
   try{await browser?.close();}finally{
    try{await fixture?.close();}finally{
     if(previous===undefined)delete process.env.CREST_TEST_DATABASE_URL;
     else process.env.CREST_TEST_DATABASE_URL=previous;
     await cluster.close();
    }
   }
  }
 });
