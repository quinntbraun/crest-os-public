import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' genuine original tip recovery, reload and private export',
 {timeout:240000,skip:process.env.CREST_TEST_RESTORED_TIP_EXPORT!=='1'},async()=>{
  const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
   quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,reviewOutcome:true,reviewHistory:true,
   financeAccounts:true,financeMappings:true,financeTaxProfiles:true,invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,
   financeMoneyChannels:true,directReceipts:true,expenses:true,financeCategoryMappings:true,sameDayExpenses:true,trialBalance:true,
   paymentCorrections:true,fundApplications:true,heldTips:true,invoiceCredits:true,paidInvoiceCredits:true,serviceRefunds:true,postedFinanceExport:true});
  let browser;
  try{
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    await page.goto(fixture.origin+'/settings/accounts');
    await page.getByRole('button',{name:'Load accounts',exact:true}).click();
    await page.getByText('Invoice numbering and periods',{exact:true}).click();
    const setup=page.getByRole('region',{name:'Fictional invoice setup',exact:true});
    await setup.getByRole('button',{name:'Load invoice setup',exact:true}).click();
    await expect(setup.getByRole('status')).toHaveText('Saved invoice setup loaded.');
    await setup.getByLabel('Series label',{exact:true}).fill('TEST');
    await setup.getByLabel('Reason for approval',{exact:true}).fill('Fictional invoice series reviewed');
    await setup.getByRole('button',{name:'Approve invoice series',exact:true}).click();
    await expect(setup).toContainText('Series TEST is approved.');
    await setup.getByLabel('Reason to open period',{exact:true}).fill('Fictional opening date reviewed');
    await setup.getByRole('button',{name:'Open accounting period',exact:true}).click();
    await expect(setup.getByRole('status')).toHaveText('Invoice setup saved.');
    await expect(setup).toContainText('· Open ·');

   await page.goto(fixture.origin+'/customers');
   const customerName='Fictional restored tip customer';
   await page.getByRole('button',{name:'Add customer',exact:true}).press('Enter');
   await page.getByLabel('Customer name',{exact:true}).fill(customerName);
   await page.getByRole('button',{name:'Save customer',exact:true}).press('Enter');
   await expect(page.getByRole('region',{name:'Customer directory',exact:true})
    .locator(':scope > [role="status"]')).toContainText('Customer saved');
   await page.getByRole('button',{name:'Load current customers',exact:true}).press('Enter');
   await page.getByRole('button',{name:customerName,exact:true}).press('Enter');
   const payment=page.getByRole('region',{name:'Record a fictional payment',exact:true});
   await page.getByText('Record a fictional payment',{exact:true}).press('Enter');
   await payment.getByRole('button',{name:'Load saved balances',exact:true}).press('Enter');
   await payment.getByLabel(/^Total received/).fill('0.06');
   await payment.getByText('Include a customer tip',{exact:true}).press('Enter');
   await payment.getByLabel('Tip amount (USD, optional)',{exact:true}).fill('0.06');
   await payment.getByRole('button',{name:'Load tip jurisdictions',exact:true}).press('Enter');
   await payment.getByRole('combobox',{name:'Tip tax jurisdiction',exact:true}).selectOption('Fictional tip district');
   await payment.getByRole('button',{name:'Review tip tax',exact:true}).press('Enter');
   await expect(payment).toContainText('$0.05 tip · $0.01 included tax');
   await payment.getByLabel('How the customer confirmed the tip',{exact:true}).fill('Fictional customer designated the entire payment as a tip.');
   await payment.getByLabel('How you verified the payment',{exact:true}).fill('Fictional received amount verified on the bank statement.');
   let directTip;
   await page.route('**/receipt-tip-record',async route=>{
    const response=await route.fetch();
    try {
     assert.equal(response.status(),200);
     directTip=(await response.json()).receipt;
    } finally {
     await route.fulfill({response});
    }
   },{times:1});
   await payment.getByRole('button',{name:'Record payment',exact:true}).press('Enter');
   await expect.poll(()=>directTip).toBeDefined();
   assert.deepEqual([directTip.grossCents,directTip.tip.netCents,directTip.tip.taxCents],['6','5','1']);
   let restoredTip;
   await mkdir('.local/review',{recursive:true});
   const failureId=randomUUID();
   const channel=(await fixture.client.query(
    'SELECT channel_id AS id,version::text FROM crest.money_channel_versions WHERE business_id=$1 AND id=$2',
    [fixture.business,directTip.channelVersionId])).rows[0];
   assert(channel);
   const result=await page.evaluate(async({directTip,failureId,operationId,channel})=>{
    const headers={'content-type':'application/json'};
    const auth=await fetch('/api/auth/session',{method:'POST',headers,body:'{}'});
    const {csrfToken}=await auth.json();
    const config=await fetch('/api/business/finance-accounts/context',{method:'POST',
     headers:{...headers,'x-crest-csrf':csrfToken},body:'{}'});
    const state=await config.json();
    const response=await fetch('/api/business/finance-accounts/collection-failure-submit',{method:'POST',
     headers:{...headers,'x-crest-csrf':csrfToken,'x-crest-edit-binding':config.headers.get('x-crest-edit-binding')},
     body:JSON.stringify({reference:{operationId,recoveryEpoch:state.recoveryEpoch,collectionFailureId:failureId},
      originalPaymentId:directTip.paymentId,customerId:directTip.customerId,kind:'settled_failure',
      channelId:channel.id,channelVersion:channel.version,effectiveOn:directTip.actualOn,verifiedCents:'6',
      confirmation:'Fictional settled bank statement debit.',reason:'Fictional deposit was returned.',
      externalIdentity:{namespace:'ledger',id:failureId,rawReference:'Fictional verified original tip deposit reversal'},
      components:[{kind:'tip',sourceId:directTip.tip.tipRealizationId,firstCent:'1',lastCent:'6'}]})});
    return {status:response.status,state:(await response.json()).state};
   },{directTip,failureId,operationId:randomUUID(),channel});
   assert.deepEqual(result,{status:200,state:'committed'});
   const region=page.getByRole('region',{name:'Restore a failed payment',exact:true});
   const disclosure=page.locator('summary').filter({hasText:'Restore a failed payment'});
   await disclosure.press('Enter');
   await region.getByRole('button',{name:'Load failed payments',exact:true}).press('Enter');
   await region.getByRole('combobox',{name:'Failed payment',exact:true}).selectOption(failureId);
   await region.getByLabel('Date the deposit cleared',{exact:true}).fill(directTip.actualOn);
   await region.getByRole('button',{name:'Check available funds',exact:true}).press('Enter');
   await region.getByText('Previously recorded tip · $0.06 available',{exact:true}).press('Enter');
   await region.getByLabel('Amount deposited (USD)',{exact:true}).fill('0.03');
   await region.getByLabel('Amount to restore (USD)',{exact:true}).fill('0.03');
   await region.getByText('Choose a different starting position',{exact:true}).press('Enter');
   await region.getByLabel('First cent to restore (optional)',{exact:true}).fill('4');
   await region.getByLabel('Restore to',{exact:true}).selectOption('tip');
   await region.getByRole('combobox',{name:'Bank or wallet credited',exact:true}).selectOption({label:'Fictional checking'});
   await region.getByLabel('Reference type',{exact:true}).fill('ledger');
   await region.getByLabel('Transaction ID',{exact:true}).fill('fictional-reinstate-original-tip');
   await region.getByLabel('Statement reference',{exact:true}).fill('Fictional verified recovered deposit.');
   await region.getByLabel('How you verified the deposit',{exact:true}).fill('Fictional bank confirmed the original money returned.');
   await region.getByLabel('Reason for this recovery',{exact:true}).fill('Fictional original tip was restored.');
   const save=region.getByRole('button',{name:'Record restored payment',exact:true});
   await expect(save).toBeDisabled();
   await region.getByLabel('How the customer confirmed the original tip',{exact:true})
    .fill('Fictional customer confirmed the same designated tip.');
   await expect(save).toBeEnabled();
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await save.scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="Restore a failed payment"]')
      .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
    await page.screenshot({path:'.local/review/finance-restored-tip-'+name+'-'+width+'.png'});
   }
   await page.route('**/api/business/finance-accounts/grouped-payment-recredit-submit',async route=>{
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
    if(response.status()!==200){await route.fulfill({response});return;}
    restoredTip=(await response.json()).receipt;
    await route.abort('failed');
   },{times:1});
   await save.press('Enter');
   await expect(region.locator(':scope > [role="status"]')).toContainText('could not confirm the save');
   assert.deepEqual([restoredTip?.schemaVersion,restoredTip?.components[0].tip.netCents,restoredTip?.components[0].tip.taxCents],[3,'2','1']);
   await page.reload();
   const entries=page.getByRole('button',{name:customerName,exact:true});
   const reload=page.getByRole('button',{name:'Load current customers',exact:true});
   await expect(entries.or(reload).first()).toBeVisible();
   if(!await entries.isVisible())await reload.press('Enter');
   await entries.press('Enter');
   await disclosure.press('Enter');
   await region.getByRole('button',{name:'Check original save',exact:true}).press('Enter');
   await expect(region.locator(':scope > [role="status"]')).toHaveText('Crest found the original recovered deposit.');
   await expect(region).toContainText('Restored to the original tip');
   await expect(region).toContainText('$0.02 tip and $0.01 included tax');
   const receipt=page.waitForEvent('download');
   await region.getByRole('button',{name:'Download restored payment (CSV)',exact:true}).press('Enter');
   assert((await readFile(await (await receipt).path(),'utf8')).includes(restoredTip.components[0].tip.tipRealizationId));

   await page.goto(fixture.origin+'/settings/accounts');
   await page.getByRole('button',{name:'Load accounts',exact:true}).click();
   await page.getByText('Fictional trial balance',{exact:true}).press('Enter');
   const trial=page.getByRole('region',{name:'Fictional trial balance',exact:true});
   await trial.getByRole('button',{name:'Load trial balance',exact:true}).press('Enter');
   await expect(trial.getByRole('status')).toHaveText('Posted balances loaded.');
   await trial.getByText('Journal entries',{exact:true}).press('Enter');
   const ledger=page.waitForResponse(response=>response.url().endsWith('/posted-journal'));
   await trial.getByRole('button',{name:'Load journal entries',exact:true}).press('Enter');
   const journal=await ledger;
   assert.equal(journal.status(),200);
   const raw=await journal.json();
   assert.equal(raw.schemaVersion,15);
   assert(raw.rows.some(row=>row.purpose==='collection_settlement_tip_tax'&&row.creditCents==='1'));

   await page.goto(fixture.origin+'/export-files');
   await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).press('Enter');
   const saveZip=page.getByRole('button',{name:'Save ZIP',exact:true});
   await expect(saveZip).toBeVisible();
   const zip=page.waitForEvent('download');
   await saveZip.press('Enter');
   const archive=await zip;
   assert.equal(archive.suggestedFilename(),'crest-posted-finance.zip');
   const {['manifest.json']:manifest,['export_delivery.json']:delivery,...parts}=unzipSync(await readFile(await archive.path()));
   const verified=verifyFinanceSourceExport(strFromU8(manifest),Object.entries(parts).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
   assert.equal(verified.profile,'crest.posted-finance-source.v17');
   assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,101);
   assert(strFromU8(parts['tip_realizations.csv']).includes(restoredTip.components[0].tip.tipRealizationId));
   assert(strFromU8(parts['journal_lines.csv']).includes('collection_settlement_tip_tax'));
  }finally{
   try{await browser?.close();}finally{await fixture.close();}
  }
 });
