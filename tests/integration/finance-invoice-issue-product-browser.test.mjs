import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {parseInvoiceCreditReference} from '../../src/bookkeeping/invoice-credit-contract.ts';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const directReceipts=true;
const paymentCorrections=process.env.CREST_TEST_PAYMENT_CORRECTIONS==='1';
const fundApplications=process.env.CREST_TEST_FUND_APPLICATIONS==='1';
const heldTips=process.env.CREST_TEST_HELD_TIPS==='1';
const invoiceCredits=process.env.CREST_TEST_INVOICE_CREDITS==='1';
const paidInvoiceCredits=process.env.CREST_TEST_PAID_INVOICE_CREDITS==='1';
const serviceRefunds=process.env.CREST_TEST_SERVICE_REFUNDS==='1';
const receivableAging=process.env.CREST_TEST_RECEIVABLE_AGING==='1';
const customerFundsReport=process.env.CREST_TEST_CUSTOMER_FUNDS_REPORT==='1';
const postedFinanceExport=process.env.CREST_TEST_POSTED_FINANCE_EXPORT==='1';
const excessReceipts=process.env.CREST_TEST_EXCESS_RECEIPTS==='1';
const applyReceiptFunds=excessReceipts&&process.env.CREST_TEST_RECEIPT_FUNDS_APPLICATION==='1';
const excessReturnExport=process.env.CREST_TEST_EXCESS_RETURN_EXPORT==='1';
const tipReturnExport=process.env.CREST_TEST_TIP_RETURN_EXPORT==='1';
const collectionFailureExport=process.env.CREST_TEST_COLLECTION_FAILURE_EXPORT==='1';
const refundTransferExport=process.env.CREST_TEST_REFUND_TRANSFER_EXPORT==='1';
const postedFinanceSchemaVersion=refundTransferExport?96:collectionFailureExport?95:tipReturnExport?94:excessReturnExport?93:applyReceiptFunds?92:excessReceipts?91:customerFundsReport?90:89;
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' genuine taxable and exempt invoice with owner setup',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,reviewOutcome:true,reviewHistory:true,
  financeAccounts:true,financeMappings:true,financeTaxProfiles:true,invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,
  financeMoneyChannels:directReceipts,directReceipts,...paymentCorrections?{
   expenses:true,financeCategoryMappings:true,sameDayExpenses:true,trialBalance:true,paymentCorrections:true,fundApplications,heldTips,invoiceCredits,paidInvoiceCredits,serviceRefunds,postedFinanceExport,
  }:{}});
 let browser;
 const financeResponses=[];
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('response',response=>{
   const path=new URL(response.url()).pathname;
   if(path.startsWith('/api/business/finance-accounts/')||path==='/api/auth/session'||path==='/api/business/scheduling/workspace'){
    financeResponses.push([path,response.status()]);
   }
  });
  page.setDefaultTimeout(20000);
  const jobId=fixture.bookingRequest.jobId,job='/schedule?job='+jobId;
  const end='/schedule/work/complete?job='+jobId;
  assert.equal((await page.goto(fixture.origin+end))?.status(),200,'The current production build must serve the End Job route.');
  const status=page.locator('.job-change-status');
  await expect(status).toHaveText('Sign in to review completion.');
  await page.getByRole('link',{name:'Sign in to review completion',exact:true}).click();
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  async function post(path,body){
   return page.evaluate(async({path,body})=>{
    const confirmation=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const proof=await confirmation.json();
    const response=await fetch('/api/business/scheduling/'+path,{method:'POST',
     headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
    return {status:response.status,value:await response.json()};
   },{path,body});
  }
  const booking=Object.fromEntries(Object.entries(structuredClone(fixture.bookingRequest)).filter(([key])=>key!=='businessId'));
  booking.payload.appointment.contact_snapshot={kind:'phone',value:'+12025550123'};
  const booked=await post('book',booking);
  assert.equal(booked.status,200);
  assert.equal(booked.value.state,'committed');
  await page.goto(fixture.origin+job);
  const drafts=page.getByRole('region',{name:'Invoice drafts',exact:true});
  const draftStatus=drafts.locator(':scope > [role="status"]');
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByLabel('What is happening?',{exact:true}).selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?',{exact:true}).fill('Synthetic arrival without travel.');
  await page.getByRole('button',{name:'Start work without recorded travel',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('link',{name:'Review and end job',exact:true}).click();
  await expect(page.getByRole('heading',{name:'End job',exact:true})).toBeVisible();
  await expect(status).toContainText('Review the assigned work');
  await page.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
  await page.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
  await page.getByRole('button',{name:'End job',exact:true}).click();
  await expect(status).toHaveText('Job completion saved.');
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
  await allowInvoiceReadWindow();
  await page.goto(fixture.origin+job);
  await page.getByText('Invoice drafts',{exact:true}).click();
  await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
  await expect(draftStatus).toHaveText('No saved invoice drafts found.');
  await drafts.getByRole('button',{name:'New invoice draft',exact:true}).click();
  await drafts.getByRole('button',{name:'Load completed portions',exact:true}).click();
  await expect(drafts.getByRole('checkbox')).toHaveCount(2);
  await drafts.getByRole('checkbox').first().check();
  await drafts.getByRole('checkbox').last().check();
  await drafts.getByRole('button',{name:'Save invoice draft',exact:true}).click();
  await expect(draftStatus).toHaveText('Invoice draft saved.');
  const saved=drafts.getByRole('region',{name:'Saved draft',exact:true});
  await mkdir('.local/review',{recursive:true});
    const expand=saved.getByText('Review invoice tax',{exact:true});
    await expand.click();
    const tax=saved.getByRole('form',{name:'Invoice tax review',exact:true});
    const check=tax.getByRole('button',{name:'Check invoice tax',exact:true});
     async function allowInvoiceReadWindow(){
      const cookie=(await context.cookies(fixture.origin)).find(entry=>entry.name==='__Host-crest_session');
      assert(cookie);
      const admissionHash=createHash('sha256').update(cookie.value,'ascii').digest();
      try{
       const {rows}=await fixture.client.query(`SELECT greatest(0,ceil(extract(epoch FROM admitted_at+interval '1 minute'-clock_timestamp())*1000))::int AS wait_ms
        FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id
        WHERE s.token_hash=$1 AND a.bucket='ordinary' AND admitted_at>clock_timestamp()-interval '1 minute'
        ORDER BY admitted_at`,[admissionHash]);
       // A work-page navigation performs several independent session and business reads.
       // Start these synthetic batches with headroom under the shared 120-per-minute cap.
       const release=rows[rows.length-60];
       if(release){
        assert(Number.isSafeInteger(release.wait_ms)&&release.wait_ms>=0&&release.wait_ms<=60000);
        await new Promise(resolve=>setTimeout(resolve,release.wait_ms+100));
       }
      }finally{admissionHash.fill(0);}
     }
    await check.press('Enter');
    await expect(tax.getByRole('status')).toHaveText('Some completed portions need tax information.');
    await expect(tax).toContainText('Enter the reviewed jurisdiction.');
    const jurisdiction=tax.getByLabel('Jurisdiction for portion 1',{exact:true});
    await expect(tax.locator('datalist option')).toHaveCount(4);
    await expect(tax.locator('datalist option').first()).toHaveAttribute('value','Fictional district');
    await jurisdiction.fill('Fictional district');
    await tax.getByLabel('Jurisdiction for portion 2',{exact:true}).fill('Fictional exempt district');
    await page.route('**/api/business/finance-accounts/'+'invoice-issue-prepare',route=>route.abort(),{times:1});
    await check.press('Enter');
    await expect(tax.getByRole('status')).toHaveText('Crest could not verify the tax review. Check the saved draft and try again.');
    await expect(tax).not.toContainText('Tax reviewed');
    await check.press('Enter');
    {
     await expect(tax.getByRole('status')).toHaveText('Some completed portions need tax information.');
     await tax.getByText('Review exemption evidence',{exact:true}).click();
     const evidence=tax.getByRole('region',{name:'Exemption evidence',exact:true});
     await allowInvoiceReadWindow();
     const evidenceRead=page.waitForResponse(response=>response.url().endsWith('/invoice-issue-exemption-read'));
     await evidence.getByRole('button',{name:'Load saved evidence',exact:true}).click();
     assert.equal((await evidenceRead).status(),200,JSON.stringify(financeResponses.slice(-12)));
     await expect(evidence.getByRole('status')).toHaveText('No evidence saved for this portion.');
     await evidence.getByLabel('Evidence reference',{exact:true}).fill('Fictional exemption record 1');
     await evidence.getByLabel('Reason for approval',{exact:true}).fill('Reviewed the fictional customer and transaction');
     const evidenceApproval=page.waitForResponse(response=>response.url().endsWith('/invoice-issue-exemption-approve'));
     await evidence.getByRole('button',{name:'Approve evidence',exact:true}).click();
     assert.equal((await evidenceApproval).status(),200,JSON.stringify(financeResponses.slice(-12)));
     await expect(evidence.getByRole('status')).toHaveText('Evidence approved. Check invoice tax again.');
     await check.press('Enter');
    }
    await expect(tax.getByRole('status')).toHaveText('Tax reviewed for all completed portions.');
    await expect(tax).toContainText('Reviewed tax $0.00');
    {
     await allowInvoiceReadWindow();
     await expect(tax).toContainText('Tax payable mappings to review');
     await tax.getByText('Tax payable for Fictional district',{exact:true}).click();
     const mapping=tax.getByRole('region',{name:'Tax payable mapping for Fictional district',exact:true});
     await mapping.getByRole('button',{name:'Load saved mapping',exact:true}).click();
     await expect(mapping).toContainText('2100 · Fictional sales tax payable');
     await mapping.getByLabel('Reason for approval',{exact:true}).fill('Fictional jurisdiction reviewed');
     await mapping.getByRole('button',{name:'Approve mapping',exact:true}).click();
     await expect(mapping.getByRole('status')).toHaveText('Mapping approved. Check invoice tax again.');
     await check.press('Enter');
     await expect(tax.getByRole('status')).toHaveText('Tax reviewed for all completed portions.');
     await tax.getByText('Confirm and issue invoice',{exact:true}).click();
     await expect(tax).toContainText('Included tax');
     let submitCount=0;
     let issueResponse;
     await page.route('**/api/business/finance-accounts/invoice-issue-submit',async route=>{
      submitCount++;
      const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
      issueResponse={status:response.status(),state:(await response.json()).state};
      await route.abort('failed');
     },{times:1});
     await tax.getByRole('button',{name:'Issue invoice',exact:true}).press('Enter');
     await expect(tax.getByRole('status')).toHaveText('The issue outcome is uncertain. Check the original before attempting another issue.');
     assert.deepEqual(issueResponse,{status:200,state:'committed'},'Only a committed issue response should be discarded.');
     // This test combines two interrupted issue journeys. Keep the same sign-in
     // for the saved operation reference and respect the ordinary request window.
     await allowInvoiceReadWindow();
     await page.reload();
     const draftDisclosure=page.getByText('Invoice drafts',{exact:true});
     await draftDisclosure.click();
     await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
     await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
     await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
     await expect(draftStatus).toHaveText('Saved invoice draft loaded.');
     await expand.click();
     await check.press('Enter');
     const invoice=saved.getByRole('region',{name:'Issued invoice',exact:true});
     await expect(invoice.getByRole('heading',{name:'Invoice TEST-1'})).toBeVisible();
     await expect(invoice.getByRole('status')).toHaveText('Issued invoice loaded.');
     await expect(invoice).toContainText('Included tax');
     assert.equal(submitCount,1);
     await expect(saved.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
     const retrieving=page.waitForEvent('download');
     await invoice.getByRole('button',{name:'Download invoice (CSV)',exact:true}).click();
     const receipt=await retrieving;
     assert.equal(receipt.suggestedFilename(),'crest-invoice-TEST-1.csv');
     assert.match(await readFile(await receipt.path(),'utf8'),/"TEST-1","Synthetic lifecycle customer"/);
     await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
     await expect(draftStatus).toHaveText('Issued invoice loaded.');
     await expect(invoice.getByRole('heading',{name:'Invoice TEST-1'})).toBeVisible();
     await expect(saved.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
     for(const width of [360,390,768,1440]){
      await page.setViewportSize({width,height:900});
      await invoice.evaluate(element=>element.scrollIntoView({block:'center'}));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
      assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
      await page.screenshot({path:'.local/review/finance-invoice-issue-product-'+name+'-'+width+'.png'});
     }
     if(directReceipts){
      await page.setViewportSize({width:390,height:844});
      const payments=invoice.getByRole('region',{name:'Record a fictional payment',exact:true});
      await invoice.getByText('Record a fictional payment',{exact:true}).click();
      await allowInvoiceReadWindow();
      await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
      await expect(payments.getByRole('status')).toHaveText('Saved balances loaded.');
      await expect(payments.getByLabel('Money received in')).toHaveValue(/^[a-f0-9-]{36}$/);
      await payments.getByLabel(/Invoice TEST-1/).fill('100.00');
      await payments.getByLabel('How you verified the payment').fill('Fictional credited payment verified');
      await page.route('**/api/business/finance-accounts/receipt-record',async route=>{
       assert.equal((await route.fetch()).status(),200);await route.abort();
      },{times:1});
      await payments.getByRole('button',{name:'Record payment',exact:true}).press('Enter');
      await expect(payments.getByRole('status')).toContainText('could not be confirmed');
      const pending=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('crest.direct-receipt.pending-reference.v1')??'null'));
      assert.deepEqual(Object.keys(pending.reference).sort(),['operationId','paymentId','recoveryEpoch']);
      await payments.getByRole('button',{name:'Check original payment',exact:true}).press('Enter');
      await expect(payments.getByRole('status')).toHaveText('The original payment was saved.');
      await expect(payments).toContainText('$100.00');
      const paymentDownload=page.waitForEvent('download');
      await payments.getByRole('button',{name:'Download payment (CSV)',exact:true}).click();
      const paymentCsv=await paymentDownload;
      assert.equal(paymentCsv.suggestedFilename(),'crest-payment.csv');
      assert.match(await readFile(await paymentCsv.path(),'utf8'),/"10000"/);
      await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
      await expect(payments.getByLabel(/Invoice TEST-1/)).toBeVisible();
      await expect(payments).toContainText('$150.00 due');
      for(const width of [360,390,768,1440]){
       await page.setViewportSize({width,height:900});
       await payments.evaluate(element=>element.scrollIntoView({block:'center'}));
       assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
       const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
       assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
       await page.screenshot({path:'.local/review/finance-direct-receipt-'+name+'-'+width+'.png'});
      }
      if(applyReceiptFunds){
       await allowInvoiceReadWindow();
       const heldPayment=payments.getByLabel('Total received (optional)',{exact:true});
       await heldPayment.fill('12.34');
       await payments.getByRole('combobox',{name:'Remaining amount',exact:true}).selectOption({label:'Hold as customer funds'});
       await payments.getByLabel('How you verified the payment',{exact:true}).fill('Fictional funds received separately');
       let held;
       await page.route('**/api/business/finance-accounts/receipt-record',async route=>{
        const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
        if(response.status()===200)held=(await response.json()).receipt;
        await route.fulfill({response});
       },{times:1});
       await payments.getByRole('button',{name:'Record payment',exact:true}).press('Enter');
       await expect(payments).toContainText('$12.34 held as customer funds.');
       assert(held?.eventId);
       await invoice.getByText('Apply customer funds',{exact:true}).press('Enter');
       const funds=invoice.getByRole('region',{name:'Apply customer funds',exact:true});
       await funds.getByRole('button',{name:'Load available funds',exact:true}).press('Enter');
       await expect(funds).toContainText('Maximum to apply · $12.34');
       await funds.getByLabel('Amount to apply',{exact:true}).fill('12.34');
       await funds.getByLabel('Reason for applying funds',{exact:true}).fill('Fictional customer approved applying the held payment');
       const apply=funds.getByRole('button',{name:'Apply funds to invoice',exact:true});
       for(const width of [360,390,768,1440]){
        await page.setViewportSize({width,height:900});
        await apply.evaluate(button=>button.scrollIntoView({block:'center'}));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.deepEqual((await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
        await page.screenshot({path:'.local/review/finance-apply-received-funds-'+name+'-'+width+'.png'});
       }
       let applied;
       await page.route('**/api/business/finance-accounts/fund-application-submit',async route=>{
        const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
        if(response.status()===200)applied=(await response.json()).receipt;
        await route.fulfill({response});
       },{times:1});
       await apply.press('Enter');
       await expect(funds).toContainText('$12.34 applied on');
       assert.equal(applied?.receiptEventId,held.eventId);
       const download=page.waitForEvent('download');
       await funds.getByRole('button',{name:'Download funds application (CSV)',exact:true}).press('Enter');
       assert((await readFile(await (await download).path(),'utf8')).includes(held.eventId));
       await page.reload();
       await draftDisclosure.click();
       await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).press('Enter');
       await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).press('Enter');
       await expect(draftStatus).toHaveText('Issued invoice loaded.');
       await invoice.getByText('Record a fictional payment',{exact:true}).press('Enter');
       await payments.getByRole('button',{name:'Load saved balances',exact:true}).press('Enter');
       await expect(payments).toContainText('$137.66 due');
       return;
      }
      if(paymentCorrections){
       await page.setViewportSize({width:390,height:844});
       await allowInvoiceReadWindow();
       await invoice.getByText('Correct an applied payment',{exact:true}).press('Enter');
       const correction=invoice.getByRole('region',{name:'Correct an applied payment',exact:true});
       await correction.getByRole('button',{name:'Load applied payments',exact:true}).press('Enter');
       await expect(correction.getByRole('status')).toHaveText('Saved payments loaded.');
       await correction.getByRole('button',{name:'Review correction',exact:true}).press('Enter');
       await expect(correction).toContainText('$100.00');
       await correction.getByLabel('Amount to move',{exact:true}).fill('25.00');
       await correction.getByLabel('Reason for correcting payment',{exact:true}).fill('Fictional amount held for another invoice');
       for(const width of [360,390,768,1440]){
        await page.setViewportSize({width,height:900});
        await correction.getByRole('button',{name:'Move to customer funds',exact:true}).scrollIntoViewIfNeeded();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const audit=await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
        await page.screenshot({path:'.local/review/finance-payment-correction-'+name+'-'+width+'.png'});
       }
       let committedResponse=false;
       await page.route('**/api/business/finance-accounts/payment-correction-submit',async route=>{
        const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
        if(response.status()===200){committedResponse=true;await route.abort('failed');}
        else await route.fulfill({response});
       },{times:1});
       await correction.getByRole('button',{name:'Move to customer funds',exact:true}).press('Enter');
       await expect(correction.getByRole('status')).toContainText('outcome could not be confirmed');
       assert(committedResponse);
       const stored=await page.evaluate(()=>sessionStorage.getItem('crest.payment-correction.pending-reference.v1'));
       assert(stored&&!stored.includes('Fictional'));
       assert.deepEqual(Object.keys(JSON.parse(stored).reference).sort(),['operationId','recoveryEpoch','unapplicationId']);
       await page.reload();
       await draftDisclosure.click();
       await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
       await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
       await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
       await expect(draftStatus).toHaveText('Issued invoice loaded.');
       await invoice.getByText('Correct an applied payment',{exact:true}).press('Enter');
       await correction.getByRole('button',{name:'Load applied payments',exact:true}).press('Enter');
       await expect(correction.getByRole('status')).toHaveText('The original correction was saved.');
       assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.payment-correction.pending-reference.v1')),null);
       const correctionDownload=page.waitForEvent('download');
       await correction.getByRole('button',{name:'Download correction (CSV)',exact:true}).click();
       assert.match(await readFile(await (await correctionDownload).path(),'utf8'),/"2500","Fictional amount held/);
       await allowInvoiceReadWindow();
       await invoice.getByText('Record a fictional payment',{exact:true}).click();
       await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
       await expect(payments).toContainText('$175.00 due');
       if(fundApplications){
        await allowInvoiceReadWindow();
        await invoice.getByText('Apply customer funds',{exact:true}).press('Enter');
        const funds=invoice.getByRole('region',{name:'Apply customer funds',exact:true});
        await funds.getByRole('button',{name:'Load available funds',exact:true}).press('Enter');
        await expect(funds.getByRole('status')).toHaveText('Review the amount before applying funds.');
        await expect(funds).toContainText('Maximum to apply · $25.00');
        await funds.getByLabel('Amount to apply',{exact:true}).fill('15.00');
        await funds.getByLabel('Reason for applying funds',{exact:true}).fill('Fictional customer approved use on this invoice');
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await funds.getByRole('button',{name:'Apply funds to invoice',exact:true}).scrollIntoViewIfNeeded();
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         const audit=await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
         assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
         await page.screenshot({path:'.local/review/finance-fund-application-'+name+'-'+width+'.png'});
        }
        await allowInvoiceReadWindow();
        await funds.getByRole('button',{name:'Apply funds to invoice',exact:true}).press('Enter');
        await expect(funds.getByRole('status')).toContainText('Funds applied.');
        const receiptDownload=page.waitForEvent('download');
        await funds.getByRole('button',{name:'Download funds application (CSV)',exact:true}).click();
        assert.match(await readFile(await (await receiptDownload).path(),'utf8'),/"1500","Fictional customer approved/);
        await allowInvoiceReadWindow();
        await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
        await expect(payments).toContainText('$160.00 due');
       }
       if(customerFundsReport){
        await allowInvoiceReadWindow();
        await page.goto(fixture.origin+'/settings/accounts');
        await page.getByRole('button',{name:'Load accounts',exact:true}).press('Enter');
        const disclosure=page.getByText(refundTransferExport?'Available customer funds':'Customer funds held',{exact:true});
        await disclosure.press('Enter');
        const report=page.getByRole('region',{name:'Customer funds held',exact:true});
        const reportDate=report.getByLabel('Through date (optional)');
        const load=report.getByRole('button',{name:'Load customer funds',exact:true});
        await reportDate.fill('1900-01-01');
        await load.press('Enter');
        await expect(report.getByRole('status')).toHaveText('No posted customer funds were held on this date.');
        await reportDate.fill('');
        await page.route('**/api/business/finance-accounts/customer-funds-report',route=>route.abort(),{times:1});
        await load.press('Enter');
        await expect(report.getByRole('status')).toContainText('Crest could not verify customer funds.');
        await load.press('Enter');
        await expect(report.getByRole('status')).toHaveText('Customer funds matched the ledger.');
        await report.getByText('Held funds by customer (1 of 1 entries)',{exact:true}).press('Enter');
        await expect(report.getByText('$10.00',{exact:true})).toHaveCount(2);
        const download=page.waitForEvent('download');
        const exportButton=report.getByRole('button',{name:'Download listed funds (CSV)',exact:true});
        await exportButton.press('Enter');
        assert.match(await readFile(await (await download).path(),'utf8'),/"1000","1","1"/);
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await report.getByText('Total held',{exact:true}).scrollIntoViewIfNeeded();
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         const audit=await new AxeBuilder({page}).include('[aria-label="Customer funds held"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
         assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
         await page.screenshot({path:'.local/review/finance-customer-funds-'+name+'-'+width+'.png'});
        }
        await disclosure.press('Enter');
        await disclosure.press('Enter');
        await expect(report.getByText('$10.00',{exact:true})).toHaveCount(0);
        await allowInvoiceReadWindow();
        await page.goto(fixture.origin+job);
        await draftDisclosure.click();
        await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
        await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
        await expect(draftStatus).toHaveText('Issued invoice loaded.');
       }
       if(heldTips){
        await allowInvoiceReadWindow();
        await invoice.getByText('Record a tip from held funds',{exact:true}).press('Enter');
        const tip=invoice.getByRole('region',{name:'Record a tip from held funds',exact:true});
        await tip.getByRole('button',{name:'Load held funds',exact:true}).press('Enter');
        await expect(tip.getByRole('status')).toContainText('Choose the jurisdiction');
        await tip.getByLabel('Tip jurisdiction',{exact:true}).selectOption('Fictional tip district');
        await tip.getByRole('button',{name:'Load reviewed tax treatment',exact:true}).press('Enter');
        await expect(tip.getByRole('status')).toContainText('Enter the amount');
        await tip.getByLabel('Tip amount (USD)',{exact:true}).fill('5.50');
        await tip.getByLabel('How did the customer confirm the tip?',{exact:true}).fill('Fictional customer confirmed $5.50 as a tip');
        await tip.getByLabel('What did you review?',{exact:true}).fill('Fictional confirmation and dated tax reviewed');
        await expect(tip.getByLabel('Tip posting preview')).toContainText('$5.00');
        await expect(tip.getByLabel('Tip posting preview')).toContainText('$0.50');
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await tip.getByRole('button',{name:'Record tip',exact:true}).evaluate(button=>button.scrollIntoView({block:'center'}));
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         const audit=await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
         assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
         await page.screenshot({path:'.local/review/finance-held-tip-'+name+'-'+width+'.png'});
        }
        await allowInvoiceReadWindow();
        let committed=false;
        await page.route('**/api/business/finance-accounts/held-tip-submit',async route=>{
         const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
         if(response.status()===200){committed=true;await route.abort('failed');}
         else await route.fulfill({response});
        },{times:1});
        await tip.getByRole('button',{name:'Record tip',exact:true}).press('Enter');
        await expect(tip.getByRole('status')).toContainText('outcome could not be confirmed');
        assert(committed);
        const stored=await page.evaluate(()=>sessionStorage.getItem('crest.held-tip.pending-reference.v1'));
        assert(stored&&!stored.includes('Fictional'));
        assert.deepEqual(Object.keys(JSON.parse(stored).reference).sort(),['operationId','recoveryEpoch','tipRealizationId']);
        await page.reload();
        await draftDisclosure.click();
        await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
        await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
        await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
        await expect(draftStatus).toHaveText('Issued invoice loaded.');
        await invoice.getByText('Record a tip from held funds',{exact:true}).press('Enter');
        await tip.getByRole('button',{name:'Load held funds',exact:true}).press('Enter');
        await expect(tip.getByRole('status')).toHaveText('The original tip was recorded.');
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.held-tip.pending-reference.v1')),null);
        const receipt=page.waitForEvent('download');
        await tip.getByRole('button',{name:'Download saved tip CSV',exact:true}).click();
        assert.match(await readFile(await (await receipt).path(),'utf8'),/"550","500","50","Fictional customer confirmed/);
        if(tipReturnExport){
         await allowInvoiceReadWindow();
         const returnTitle='Record a settled tip return';
         const returnPanel=invoice.getByRole('region',{name:returnTitle,exact:true});
         await invoice.getByText(returnTitle,{exact:true}).press('Enter');
         const actualOn=(await fixture.client.query("SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
         await returnPanel.getByLabel('Settlement date',{exact:true}).fill(actualOn);
         const optionsResponse=page.waitForResponse(response=>response.url().endsWith('/tip-return-options'));
         await returnPanel.getByRole('button',{name:'Load eligible tips',exact:true}).press('Enter');
         assert.equal((await optionsResponse).status(),200);
         await expect(returnPanel.getByRole('status')).toHaveText('Choose the original tip and match the settled amount to your account record.');
         const originalTip=JSON.parse(stored).reference.tipRealizationId;
         const original=returnPanel.getByRole('combobox',{name:'Original tip',exact:true});
         await expect(original.locator('option').nth(1)).toContainText('$5.50 available');
         await original.selectOption(originalTip);
         await returnPanel.getByRole('combobox',{name:'Returned from',exact:true}).selectOption({label:'Fictional checking'});
         const amount=returnPanel.getByLabel('Settled amount (USD)',{exact:true});
         const saveTipReturn=returnPanel.getByRole('button',{name:'Save tip return',exact:true});
         await amount.fill('5.51');
         await expect(saveTipReturn).toBeDisabled();
         await expect(returnPanel).toContainText('The settled amount exceeds the remaining tip balance.');
         await amount.fill('1.10');
         await returnPanel.getByLabel('Reference type',{exact:true}).fill('ledger');
         await returnPanel.getByLabel('Transaction ID',{exact:true}).fill('fictional-tip-return-transaction');
         await returnPanel.getByLabel('Reference as shown on the account',{exact:true}).fill('Fictional settled tip debit');
         await returnPanel.getByLabel('How you verified settlement',{exact:true}).fill('Fictional statement verifies settlement');
         await returnPanel.getByLabel('Reason for the return',{exact:true}).fill('Fictional confirmed tip return');
         for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:900});
          await saveTipReturn.evaluate(button=>button.scrollIntoView({block:'center'}));
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="'+returnTitle+'"]')
           .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
          await page.screenshot({path:'.local/review/finance-tip-return-'+name+'-'+width+'.png'});
         }
         let returned,submissions=0;
         await page.route('**/api/business/finance-accounts/tip-return-submit',async route=>{
          submissions++;
          const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
          if(response.status()!==200){await route.fulfill({response});return;}
          returned=(await response.json()).receipt;
          await route.abort('failed');
         },{times:1});
         await allowInvoiceReadWindow();
         await saveTipReturn.press('Enter');
         await expect(returnPanel.getByRole('status')).toContainText('could not confirm the save');
         assert.deepEqual([returned?.tipRealizationId,returned?.cents,returned?.netCents,returned?.taxCents],[originalTip,'110','100','10']);
         const key='crest.tip-return.pending-reference.v1';
         const pendingReturn=await page.evaluate(key=>sessionStorage.getItem(key),key);
         assert(pendingReturn&&!pendingReturn.includes('fictional-tip-return-transaction'));
         await allowInvoiceReadWindow();
         await page.reload();
         await draftDisclosure.click();
         await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
         await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
         await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
         await expect(draftStatus).toHaveText('Issued invoice loaded.');
         await invoice.getByText(returnTitle,{exact:true}).press('Enter');
         await returnPanel.getByRole('button',{name:'Check original return',exact:true}).press('Enter');
         await expect(returnPanel.getByRole('status')).toHaveText('The original return record was saved.');
         assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
         assert.equal(submissions,1);
         const download=page.waitForEvent('download');
         await returnPanel.getByRole('button',{name:'Download tip return (CSV)',exact:true}).press('Enter');
         const csv=await readFile(await (await download).path(),'utf8');
         assert(csv.includes(originalTip)&&csv.includes(returned.tipReturnId)&&csv.includes('"110","100","10"'));
         await invoice.getByText(returnTitle,{exact:true}).press('Enter');
        }
        await allowInvoiceReadWindow();
        await invoice.getByText('Record a fictional payment',{exact:true}).click();
        await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
        await expect(payments).toContainText('$160.00 due');
       }
       if(invoiceCredits){
        await allowInvoiceReadWindow();
        await invoice.getByText('Credit an invoice line',{exact:true}).press('Enter');
        const credit=invoice.getByRole('region',{name:'Credit an invoice line',exact:true});
        await credit.getByRole('button',{name:'Load credit options',exact:true}).press('Enter');
        await expect(credit.getByRole('status')).toContainText('Review the credit');
        await expect(credit).toContainText('Maximum credit · $160.00');
        const amount=credit.getByLabel('Credit amount (USD)',{exact:true});
        const save=credit.getByRole('button',{name:'Save invoice credit',exact:true});
        await amount.fill('160.01');
        await expect(amount).toHaveAttribute('aria-invalid','true');
        await expect(save).toBeDisabled();
        await amount.fill('11.00');
        await credit.getByLabel('Reason for the credit',{exact:true}).fill('Fictional owner approved a line credit');
        await expect(credit.getByLabel('Credit preview')).toContainText('$11.00');
        await expect(credit.getByLabel('Credit preview')).toContainText('$1.00');
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await save.evaluate(button=>button.scrollIntoView({block:'center'}));
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         const audit=await new AxeBuilder({page}).include('.invoice-credit').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
         assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
         await page.screenshot({path:'.local/review/finance-invoice-credit-'+name+'-'+width+'.png'});
        }
        const {rows:[savedInvoice]}=await fixture.client.query(
         'SELECT id FROM crest.invoices WHERE business_id=$1 AND job_id=$2 AND invoice_number=$3',
         [fixture.business,jobId,'TEST-1']);
        let posted=false,submittedReference,submittedBinding;
        await page.route('**/api/business/finance-accounts/invoice-credit-submit',async route=>{
         submittedReference=parseInvoiceCreditReference(route.request().postDataJSON().reference);
         submittedBinding=route.request().headers()['x-crest-edit-binding'];
         const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
         if(response.status()===200){posted=true;await route.abort('failed');}
         else await route.fulfill({response});
        },{times:1});
        await save.press('Enter');
        await expect(credit.getByRole('status')).toContainText('outcome could not be confirmed');
        assert(posted);
        const stored=await page.evaluate(()=>sessionStorage.getItem('crest.invoice-credit.pending-reference.v1'));
        assert(stored);
        assert.match(submittedBinding,/^[A-Za-z0-9_-]{43}$/);
        assert.deepEqual(JSON.parse(stored),{businessId:fixture.business,binding:submittedBinding,
         invoiceId:savedInvoice.id,reference:submittedReference});
        await allowInvoiceReadWindow();
        const scheduleReady=page.waitForResponse(response=>response.url().endsWith('/api/business/scheduling/workspace'));
        await page.reload();
        assert.equal((await scheduleReady).status(),200,JSON.stringify(financeResponses.slice(-12)));
        await draftDisclosure.click();
        await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
        await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
        await allowInvoiceReadWindow();
        await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
        await expect(draftStatus).toHaveText('Issued invoice loaded.');
        await invoice.getByText('Credit an invoice line',{exact:true}).press('Enter');
        await allowInvoiceReadWindow();
        await credit.getByRole('button',{name:'Load credit options',exact:true}).press('Enter');
        await expect(credit.getByRole('status')).toHaveText('The original credit was saved.');
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.invoice-credit.pending-reference.v1')),null);
        const receipt=page.waitForEvent('download');
        await credit.getByRole('button',{name:'Download invoice credit (CSV)',exact:true}).click();
        assert.match(await readFile(await (await receipt).path(),'utf8'),/"1100","100","Fictional owner approved/);
        await allowInvoiceReadWindow();
        await invoice.getByText('Record a fictional payment',{exact:true}).click();
        await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
        await expect(payments).toContainText('$149.00 due');
       }
       if(paidInvoiceCredits){
        if(receivableAging){
         await allowInvoiceReadWindow();
         await page.setViewportSize({width:390,height:900});
         await page.goto(fixture.origin+'/settings/accounts');
         await page.getByRole('button',{name:'Load accounts',exact:true}).press('Enter');
         await page.getByText('Outstanding invoices by due date',{exact:true}).press('Enter');
         const aging=page.getByRole('region',{name:'Outstanding invoices by due date',exact:true});
         await aging.getByRole('button',{name:'Load outstanding invoices',exact:true}).press('Enter');
         await expect(aging.getByRole('status')).toHaveText('Outstanding invoices loaded.');
         await aging.getByText('Invoice details (1 of 1)',{exact:true}).press('Enter');
         await expect(aging).toContainText('Invoice TEST-1');
         await expect(aging).toContainText('$149.00');
         for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:900});
          await aging.getByText('Invoice TEST-1',{exact:true}).scrollIntoViewIfNeeded();
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await page.screenshot({path:'.local/review/finance-receivable-aging-populated-'+name+'-'+width+'.png'});
         }
         await allowInvoiceReadWindow();
         await page.goto(fixture.origin+job);
         await draftDisclosure.click();
         await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
         await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
         await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
         await expect(draftStatus).toHaveText('Issued invoice loaded.');
        }
        await allowInvoiceReadWindow();
        await invoice.getByText('Credit a paid or partly paid invoice',{exact:true}).press('Enter');
        const credit=invoice.getByRole('region',{name:'Credit a paid or partly paid invoice',exact:true});
        await credit.getByRole('button',{name:'Load applied payments',exact:true}).press('Enter');
        await expect(credit.getByRole('status')).toContainText('Choose the payment');
        const choice=credit.getByLabel('Payment',{exact:true});
        if(await choice.count())await choice.selectOption({label:(await choice.locator('option').nth(1).textContent()).trim()});
        await credit.getByRole('button',{name:'Review credit and payment',exact:true}).press('Enter');
        await expect(credit.getByRole('status')).toContainText('Review the credit and the amount');
        await expect(credit).toContainText('$149.00');
        const save=credit.getByRole('button',{name:'Save credit and release',exact:true});
        const amount=credit.getByLabel('Credit amount (USD)',{exact:true});
        await amount.fill('149.00');
        await expect(save).toBeDisabled();
        await amount.fill('160.00');
        await credit.getByLabel('Reason for the credit',{exact:true}).fill('Fictional paid invoice adjustment');
        const preview=credit.getByLabel('Paid invoice credit preview');
        await expect(preview).toContainText('$160.00');
        await expect(preview).toContainText('$11.00');
        await expect(preview).toContainText('$0.00');
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await save.evaluate(button=>button.scrollIntoView({block:'center'}));
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         const audit=await new AxeBuilder({page}).include('.invoice-credit').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
         assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
         await page.screenshot({path:'.local/review/finance-paid-invoice-credit-'+name+'-'+width+'.png'});
        }
        let posted=false;
        await allowInvoiceReadWindow();
        await page.route('**/api/business/finance-accounts/paid-invoice-credit-submit',async route=>{
         const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
         if(response.status()===200){posted=true;await route.abort('failed');}
         else await route.fulfill({response});
        },{times:1});
        await save.press('Enter');
        await expect(credit.getByRole('status')).toContainText('outcome could not be confirmed');
        assert(posted);
        const stored=await page.evaluate(()=>sessionStorage.getItem('crest.paid-invoice-credit.pending-reference.v1'));
        assert(stored&&!stored.includes('Fictional'));
        assert.deepEqual(Object.keys(JSON.parse(stored).reference).sort(),['invoiceCreditId','operationId','recoveryEpoch','unapplicationId']);
        await allowInvoiceReadWindow();
        await page.reload();
        await draftDisclosure.click();
        await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
        await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
        await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
        await expect(draftStatus).toHaveText('Issued invoice loaded.');
        await invoice.getByText('Credit a paid or partly paid invoice',{exact:true}).press('Enter');
        await credit.getByRole('button',{name:'Load applied payments',exact:true}).press('Enter');
        await expect(credit.getByRole('status')).toHaveText('The original credit and payment release were saved.');
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.paid-invoice-credit.pending-reference.v1')),null);
        const receipt=page.waitForEvent('download');
        await credit.getByRole('button',{name:'Download credit and payment release (CSV)',exact:true}).click();
        assert.match(await readFile(await (await receipt).path(),'utf8'),/"16000","[0-9]+","1100","Fictional paid invoice adjustment"/);
        await allowInvoiceReadWindow();
        await invoice.getByText('Record a fictional payment',{exact:true}).click();
        await payments.getByRole('button',{name:'Load saved balances',exact:true}).click();
        await expect(payments.getByRole('status')).toHaveText('This customer has no outstanding invoices for that date.');
        await expect(payments).not.toContainText('TEST-1 ·');
        if(serviceRefunds){
         await allowInvoiceReadWindow();
         await invoice.getByText('Record a settled refund',{exact:true}).press('Enter');
         const refund=invoice.getByRole('region',{name:'Record a settled refund',exact:true});
         await refund.getByRole('button',{name:'Load available credits',exact:true}).press('Enter');
         await expect(refund.getByRole('status')).toHaveText('Enter the date the refund settled.');
         const date=(await fixture.client.query("SELECT (statement_timestamp() AT TIME ZONE 'America/Indiana/Indianapolis')::date::text AS date")).rows[0].date;
         await refund.getByLabel('Settlement date',{exact:true}).fill(date);
         await refund.getByRole('button',{name:'Review refund',exact:true}).press('Enter');
         await expect(refund.getByRole('status')).toContainText('Match the settled amount');
         const account=refund.getByRole('combobox',{name:'Refunded from',exact:true});
         await expect(account).toBeVisible();
         await account.selectOption({label:'Fictional checking'});
         await refund.getByLabel('Settled amount (USD)',{exact:true}).fill('5.00');
         await refund.getByLabel('Reference type',{exact:true}).fill('ledger');
         await refund.getByLabel('Transaction ID',{exact:true}).fill('synthetic-refund-'+name);
         await refund.getByLabel('Reference as shown on the account',{exact:true}).fill('Fictional bank outflow');
         await refund.getByLabel('How you verified settlement',{exact:true}).fill('Fictional bank debit settled');
         await refund.getByLabel('Reason for the refund',{exact:true}).fill('Fictional service refund confirmed');
         const record=refund.getByRole('button',{name:'Save refund record',exact:true});
         for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:900});await record.evaluate(button=>button.scrollIntoView({block:'center'}));
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual((await new AxeBuilder({page}).include('.invoice-credit').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
          await page.screenshot({path:'.local/review/finance-service-refund-'+name+'-'+width+'.png'});
         }
         await allowInvoiceReadWindow();
         let refundPosted=false;
         await page.route('**/api/business/finance-accounts/service-refund-submit',async route=>{
          const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
          if(response.status()===200){refundPosted=true;await route.abort('failed');}
          else await route.fulfill({response});
         },{times:1});
         await record.press('Enter');
         await expect(refund.getByRole('status')).toContainText('could not confirm the save');
         assert(refundPosted);
         const ref=await page.evaluate(()=>sessionStorage.getItem('crest.service-refund.pending-reference.v1'));
         assert(ref&&!ref.includes('Fictional')&&!ref.includes('synthetic-refund-'));
         await refund.getByRole('button',{name:'Check original refund',exact:true}).press('Enter');
         await expect(refund.getByRole('status')).toHaveText('The original refund record was saved.');
         const refundDownload=page.waitForEvent('download');
         await refund.getByRole('button',{name:'Download refund record (CSV)',exact:true}).click();
         assert.match(await readFile(await (await refundDownload).path(),'utf8'),/"500","Fictional bank debit settled","Fictional service refund confirmed"/);
        }
       }
       await page.goto(fixture.origin+'/settings/accounts');
       await page.getByRole('button',{name:'Load accounts',exact:true}).click();
       await page.getByText('Fictional trial balance',{exact:true}).click();
       const report=page.getByRole('region',{name:'Fictional trial balance',exact:true});
       await report.getByRole('button',{name:'Load trial balance',exact:true}).press('Enter');
       await expect(report.getByRole('status')).toHaveText('Posted balances loaded.');
       await expect(report).toContainText(heldTips?'Customer funds and tax payable match the ledger':'Customer funds held match the ledger');
       await report.getByText('Journal entries',{exact:true}).click();
       await report.getByRole('button',{name:'Load journal entries',exact:true}).press('Enter');
       await expect(report).toContainText('Invoice reopened');
       await expect(report).toContainText('Customer funds held');
       if(fundApplications)await expect(report).toContainText('Invoice balance reduced');
       if(heldTips)await expect(report).toContainText('Held tip · Tip revenue');
       if(invoiceCredits)await expect(report).toContainText('Invoice credit · Sales returns');
       if(serviceRefunds){
        await expect(report).toContainText('Service refund · Held balance reduced');
        await expect(report).toContainText('Service refund · Settled outflow');
       }
       if(receivableAging){
        await allowInvoiceReadWindow();
        await page.getByText('Outstanding invoices by due date',{exact:true}).press('Enter');
        const aging=page.getByRole('region',{name:'Outstanding invoices by due date',exact:true});
        const load=aging.getByRole('button',{name:'Load outstanding invoices',exact:true});
        await page.route('**/api/business/finance-accounts/receivable-aging',route=>route.abort(),{times:1});
        await load.press('Enter');
        await expect(aging.getByRole('status')).toContainText('could not verify the report');
        await load.press('Enter');
        await expect(aging.getByRole('status')).toContainText(/Outstanding invoices loaded|No posted invoices/);
        await expect(aging).toContainText('Total outstanding');
        await expect(aging).toContainText('91+ days');
        await expect(aging).not.toContainText('Invoice TEST-1');
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         await aging.evaluate(element=>element.scrollIntoView({block:'center'}));
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         assert.deepEqual((await new AxeBuilder({page}).include('.review-card').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
         await page.screenshot({path:'.local/review/finance-receivable-aging-'+name+'-'+width+'.png'});
        }
        await page.getByText('Outstanding invoices by due date',{exact:true}).press('Enter');
        await page.getByText('Outstanding invoices by due date',{exact:true}).press('Enter');
        await expect(aging).not.toContainText('Total outstanding');
       }
       if(postedFinanceExport){
        await allowInvoiceReadWindow();
        await page.goto(fixture.origin+'/export-files');
        const exporter=page.getByRole('region',{name:'Posted finance export',exact:true});
        const prepare=exporter.getByRole('button',{name:'Prepare posted finance CSV',exact:true});
        await expect(prepare).toBeVisible();
        for(const width of [360,390,768,1440]){
         await page.setViewportSize({width,height:900});
         assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
         assert.deepEqual((await new AxeBuilder({page}).include('.export-files').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
         await page.screenshot({path:'.local/review/finance-posted-export-'+name+'-'+width+'.png'});
        }
        const responseReady=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/business/exports/posted-finance');
        await prepare.press('Enter');
        const response=await responseReady;
        assert.equal(response.status(),200);
        assert.match(response.headers()['cache-control'],/no-store/);
        const save=exporter.getByRole('button',{name:'Save ZIP',exact:true});
        await expect(save).toBeVisible();
        const ready=page.waitForEvent('download');
        await save.press('Enter');
        const download=await ready;
        assert.equal(download.suggestedFilename(),'crest-posted-finance.zip');
        const archive=await readFile(await download.path());
        const digest=createHash('sha256').update(archive).digest('hex');
        assert.equal(digest,response.headers()['x-crest-sha256']);
        const {['manifest.json']:manifestBytes,['export_delivery.json']:deliveryBytes,...parts}=unzipSync(archive);
        const manifest=strFromU8(manifestBytes),delivery=JSON.parse(strFromU8(deliveryBytes));
        const verified=verifyFinanceSourceExport(manifest,Object.entries(parts).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
        const exportProfile=refundTransferExport?'crest.posted-finance-source.v12':collectionFailureExport?'crest.posted-finance-source.v11':tipReturnExport?'crest.posted-finance-source.v10':excessReturnExport?'crest.posted-finance-source.v9':excessReceipts?'crest.posted-finance-source.v8':'crest.posted-finance-source.v7';
        assert.equal(verified.profile,exportProfile);
        assert.equal(verified.completePortableExport,false);
        assert.equal(delivery.sourceSchemaVersion,postedFinanceSchemaVersion);
        assert.equal(delivery.manifestSha256,createHash('sha256').update(manifestBytes).digest('hex'));
        assert.match(strFromU8(parts['service_credit_refunds.csv']),/Fictional service refund confirmed/);
        const extract=join(fixture.workspace,'posted-finance-extracted');
        await mkdir(extract,{mode:0o700});
        for(const [file,bytes] of Object.entries({'manifest.json':manifestBytes,'export_delivery.json':deliveryBytes,...parts})){
         assert(file==='README.txt'||/^[a-z][a-z0-9_]{0,79}\.(csv|json|ndjson)$/.test(file));
         await writeFile(join(extract,file),bytes,{flag:'wx',mode:0o600});
        }
        const cli=JSON.parse(execFileSync(process.execPath,['--conditions=react-server','scripts/verify-source-export.mjs',
         extract,fixture.business,delivery.appReleaseId],{encoding:'utf8',timeout:10000}));
        assert.equal(cli.profile,verified.profile);
        assert.equal(cli.sourceRows,verified.sourceRows);
        const evidence=(await fixture.client.query(`SELECT o.command_type,a.action,a.delta->'after' AS evidence
          FROM crest_private.audit_events a JOIN crest_private.operations o USING (business_id,operation_id)
          WHERE a.business_id=$1 AND a.entity_kind='finance_export_accesses'`,[fixture.business])).rows;
        assert.equal(evidence.length,1);
        assert.equal(evidence[0].command_type,'finance.export_access');
        assert.equal(evidence[0].action,'authorized_handoff');
        assert.equal(evidence[0].evidence.profile,exportProfile);
        assert.equal(evidence[0].evidence.archiveSha256,digest);
        assert.equal(evidence[0].evidence.manifestSha256,delivery.manifestSha256);
        await assert.rejects(fixture.authorizePostedFinance({requestedBusiness:'00000000-0000-4000-8000-000000000001'}));
        await assert.rejects(fixture.authorizePostedFinance({epochOverride:'00000000-0000-4000-8000-000000000002',record:true}));
        const rolledBack=await fixture.authorizePostedFinance({record:true,rollback:true});
        assert.equal(rolledBack.state,'authorized_handoff');
        assert.equal((await fixture.client.query('SELECT count(*)::int AS n FROM crest_private.operations WHERE business_id=$1 AND operation_id=$2',
         [fixture.business,rolledBack.operationId])).rows[0].n,0);
        if(excessReceipts){
         const returnTitle='Record a return of unused payment funds';
         const returnPanel=page.getByRole('region',{name:returnTitle,exact:true});
         async function openReturn(date){
          const disclosure=invoice.locator('summary').filter({hasText:returnTitle});
          const open=await disclosure.evaluate(element=>element.closest('details').open);
          if(!open)await disclosure.press('Enter');
          await expect(returnPanel).toBeVisible();
          if(date){
           await returnPanel.getByLabel('Settlement date',{exact:true}).fill(date);
           const loaded=page.waitForResponse(response=>response.url().endsWith('/excess-return-options'));
           await returnPanel.getByRole('button',{name:'Load eligible payments',exact:true}).press('Enter');
           assert.equal((await loaded).status(),200,'Return options must be read from the signed-in server.');
          }
         }
         async function openPayment(){
          await allowInvoiceReadWindow();
          await page.goto(fixture.origin+job);
          await draftDisclosure.click();
          await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
          await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
          await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
          await expect(draftStatus).toHaveText('Issued invoice loaded.');
          await invoice.getByText('Record a fictional payment',{exact:true}).press('Enter');
         }
         await openPayment();
         if(excessReturnExport){
          const date=(await fixture.client.query("SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
          await openReturn(date);
          await expect(returnPanel.getByRole('status')).toHaveText('This customer has no unused original payment funds for that date.');
          await expect(returnPanel.getByRole('combobox',{name:'Original payment',exact:true})).toHaveCount(0);
          await invoice.getByText(returnTitle,{exact:true}).press('Enter');
         }
         await payments.getByRole('button',{name:'Load saved balances',exact:true}).press('Enter');
         await expect(payments.getByRole('status')).toHaveText('This customer has no outstanding invoices for that date.');
         await expect(payments.getByRole('group',{name:'Apply the payment'})).toHaveCount(0);
         await payments.getByLabel('Total received',{exact:true}).fill('12.34');
         await expect(payments).toContainText('$0.00 applied to invoices. $12.34 remaining.');
         const hold=payments.getByRole('combobox',{name:'Remaining amount',exact:true});
         await expect(hold).toHaveValue('');
         const confirmation='Fictional separately credited customer funds';
         await payments.getByLabel('How you verified the payment',{exact:true}).fill(confirmation);
         const record=payments.getByRole('button',{name:'Record payment',exact:true});
         const sent=()=>financeResponses.filter(([path])=>path.endsWith('/receipt-record')).length;
         const before=sent();
         await record.press('Enter');
         assert.equal(await hold.evaluate(select=>select.validity.valueMissing),true);
         assert.equal(sent(),before,'The remaining amount requires explicit review.');
         await hold.selectOption({label:'Hold as customer funds'});
         const mappingId=await hold.inputValue();
         assert.match(mappingId,/^[a-f0-9-]{36}$/);
         for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:900});
          await record.evaluate(button=>button.scrollIntoView({block:'center'}));
          assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          assert.deepEqual((await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
          await page.screenshot({path:'.local/review/finance-excess-receipt-'+name+'-'+width+'.png'});
         }
         await allowInvoiceReadWindow();
         let committed,forwarded=0;
         await page.route('**/api/business/finance-accounts/receipt-record',async route=>{
          forwarded++;
          const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
          if(response.status()!==200){await route.fulfill({response});return;}
          committed=(await response.json()).receipt;
          await route.abort('failed');
         },{times:1});
         await record.press('Enter');
         await expect(payments.getByRole('status')).toContainText('outcome could not be confirmed');
         assert.equal(committed?.schemaVersion,2);
         assert.equal(committed?.grossCents,'1234');
         assert.deepEqual(committed?.applications,[]);
         assert.equal(committed?.heldFunds.mappingId,mappingId);
         assert.equal(committed?.heldFunds.cents,'1234');
         const raw=await page.evaluate(()=>sessionStorage.getItem('crest.direct-receipt.pending-reference.v1'));
         assert(raw&&!raw.includes(confirmation)&&!raw.includes(mappingId));
         const pending=JSON.parse(raw);
         assert.deepEqual(Object.keys(pending).sort(),['binding','businessId','invoiceId','reference']);
         assert.deepEqual(Object.keys(pending.reference).sort(),['operationId','paymentId','recoveryEpoch']);
         assert.equal(pending.reference.paymentId,committed.paymentId);
         await openPayment();
         await payments.getByRole('button',{name:'Load saved balances',exact:true}).press('Enter');
         await expect(payments.getByRole('status')).toHaveText('The original payment was saved.');
         await expect(payments).toContainText('$12.34 held as customer funds.');
         assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.direct-receipt.pending-reference.v1')),null);
         assert.equal(forwarded,1);
         assert.equal(sent(),before,'Lookup recovers the original without another record response.');
         const exportReceipt=page.waitForEvent('download');
         await payments.getByRole('button',{name:'Download payment (CSV)',exact:true}).press('Enter');
         const csv=await readFile(await (await exportReceipt).path(),'utf8');
         assert(csv.includes('"Held funds lot ID","Held funding partition ID","Held funds mapping ID","Held cents"'));
         assert(csv.includes([committed.heldFunds.lotId,committed.heldFunds.fundingPartitionId,mappingId,'1234']
          .map(field=>'"'+field+'"').join(',')));
         const history=(await fixture.client.query(`SELECT p.gross_cents::text AS gross,l.purpose,
          a.code,l.debit_cents::text AS debit,l.credit_cents::text AS credit,l.fund_lot_id AS lot
          FROM crest.payments p JOIN crest.financial_events e ON (e.business_id,e.payment_id)=(p.business_id,p.id)
          JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
          JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
          JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
          WHERE p.business_id=$1 AND p.id=$2 ORDER BY l.purpose`,[fixture.business,committed.paymentId])).rows;
         assert.deepEqual(history,[
          {gross:'1234',purpose:'receipt_funds',code:'2000',debit:'0',credit:'1234',lot:committed.heldFunds.lotId},
          {gross:'1234',purpose:'receipt_money',code:'1000',debit:'1234',credit:'0',lot:null},
         ]);
         const funds=(await fixture.client.query(`SELECT o.id AS origin,l.id AS lot,l.original_cents::text AS cents,
          l.unapplication_id AS unapplication,l.receipt_event_id AS event,l.mapping_id AS mapping,
          f.id AS partition,f.first_cent::text AS first,f.last_cent::text AS last,
          (SELECT count(*)::int FROM crest.funding_partitions v WHERE (v.business_id,v.origin_id)=(o.business_id,o.id)) AS partitions,
          (SELECT count(*)::int FROM crest.allocation_events v WHERE (v.business_id,v.event_id)=(l.business_id,l.receipt_event_id)) AS allocations
          FROM crest.funding_origins o JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id)=(o.business_id,o.id)
          JOIN crest.funding_partitions f ON (f.business_id,f.id)=(l.business_id,l.parent_partition_id)
          WHERE o.business_id=$1 AND o.payment_id=$2`,[fixture.business,committed.paymentId])).rows;
         assert.deepEqual(funds,[{origin:committed.fundingOriginId,lot:committed.heldFunds.lotId,cents:'1234',unapplication:null,
          event:committed.eventId,mapping:mappingId,partition:committed.heldFunds.fundingPartitionId,first:'1',last:'1234',partitions:1,allocations:0}]);
         let returned,adjustment,recredit,refundRetry;
         if(excessReturnExport){
          await allowInvoiceReadWindow();
          await openReturn(committed.actualOn);
          await expect(returnPanel.getByRole('status')).toHaveText('Choose the original payment and match the settled amount to your account record.');
          const payment=returnPanel.getByRole('combobox',{name:'Original payment',exact:true});
          await expect(payment.locator('option')).toHaveCount(2);
          await expect(payment.locator('option').nth(1)).toContainText('$12.34 available');
          await payment.selectOption(committed.heldFunds.lotId);
          await returnPanel.getByRole('combobox',{name:'Returned from',exact:true}).selectOption({label:'Fictional checking'});
          const amount=returnPanel.getByLabel('Settled amount (USD)',{exact:true});
          await expect(amount).toHaveAttribute('inputmode','decimal');
          await amount.fill('1.00');
          const reason='Fictional unused payment return', confirmation='Fictional statement verifies settled debit';
          const transaction='fictional-unused-payment-return-browser';
          await returnPanel.getByLabel('Reference type',{exact:true}).fill('ledger');
          await returnPanel.getByLabel('Transaction ID',{exact:true}).fill(transaction);
          await returnPanel.getByLabel('Reference as shown on the account',{exact:true}).fill('Fictional settled debit');
          await returnPanel.getByLabel('How you verified settlement',{exact:true}).fill(confirmation);
          await returnPanel.getByLabel('Reason for the return',{exact:true}).fill(reason);
          const saveReturn=returnPanel.getByRole('button',{name:'Save return record',exact:true});
          for(const width of [360,390,768,1440]){
           await page.setViewportSize({width,height:900});
           await saveReturn.scrollIntoViewIfNeeded();
           assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
           assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="'+returnTitle+'"]')
            .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
           await page.screenshot({path:'.local/review/finance-excess-return-'+name+'-'+width+'.png'});
          }
          await allowInvoiceReadWindow();
          let submitted=0;
          await page.route('**/api/business/finance-accounts/excess-return-submit',async route=>{
           submitted++;
           const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
           if(response.status()!==200){await route.fulfill({response});return;}
           returned=(await response.json()).receipt;
           await route.abort('failed');
          },{times:1});
          await saveReturn.press('Enter');
          await expect(returnPanel.getByRole('status')).toContainText('could not confirm the save');
          assert.equal(submitted,1);
          assert.equal(returned?.originalPaymentId,committed.paymentId);
          assert.equal(returned?.fundLotId,committed.heldFunds.lotId);
          assert.equal(returned?.cents,'100');
          const pendingKey='crest.excess-return.pending-reference.v1';
          const heldReference=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
          assert(heldReference&&!heldReference.includes(transaction)&&!heldReference.includes(reason)&&!heldReference.includes(confirmation));
          const pendingReturn=JSON.parse(heldReference);
          assert.deepEqual(Object.keys(pendingReturn).sort(),['binding','businessId','customerId','reference']);
          assert.deepEqual(Object.keys(pendingReturn.reference).sort(),['excessReturnId','operationId','recoveryEpoch']);
          assert.equal(pendingReturn.reference.excessReturnId,returned.excessReturnId);
          await openPayment();
          await openReturn();
          await returnPanel.getByRole('button',{name:'Check original return',exact:true}).press('Enter');
          await expect(returnPanel.getByRole('status')).toHaveText('The original return record was saved.');
          await expect(returnPanel).toContainText('$1.00 recorded');
          assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
          assert.equal(submitted,1);
          assert.equal((await fixture.client.query('SELECT count(*)::int AS n FROM crest.excess_receipt_returns WHERE business_id=$1 AND fund_lot_id=$2',
           [fixture.business,committed.heldFunds.lotId])).rows[0].n,1);
          const returnedCsv=page.waitForEvent('download');
          await returnPanel.getByRole('button',{name:'Download return record (CSV)',exact:true}).press('Enter');
          const returnedDownload=await returnedCsv;
          assert.equal(returnedDownload.suggestedFilename(),'crest-unused-payment-return.csv');
          const returnFile=await readFile(await returnedDownload.path(),'utf8');
          assert(returnFile.includes(returned.excessReturnId)&&returnFile.includes(committed.paymentId)&&returnFile.includes('"100"'));

          if(collectionFailureExport){
           await allowInvoiceReadWindow();
           const title='Correct a customer payment';
           const panel=invoice.getByRole('region',{name:title,exact:true});
           await invoice.getByText(title,{exact:true}).press('Enter');
           await panel.getByRole('button',{name:'Load customer payments',exact:true}).press('Enter');
           const payment=panel.getByRole('combobox',{name:'Original payment',exact:true});
           await expect(payment).toBeVisible();
           await payment.selectOption(committed.paymentId);
           const label=await payment.evaluate(select=>select.selectedOptions[0]?.textContent);
           assert(label?.includes('$12.34')&&label.includes(committed.paymentId.slice(-8)));
           await panel.getByLabel('Adjustment date',{exact:true}).fill(committed.actualOn);
           await panel.getByRole('combobox',{name:'What happened?',exact:true}).selectOption('settled_failure');
           await panel.getByRole('button',{name:'Review remaining amounts',exact:true}).press('Enter');
           const affected=panel.getByRole('region',{name:'Held funds · Customer funds held',exact:true});
           await affected.getByText('$11.34 available',{exact:true}).press('Enter');
           const selection=affected.getByLabel('Amount to adjust (USD)',{exact:true});
           await selection.fill('0.25');
           const save=panel.getByRole('button',{name:'Save payment adjustment',exact:true});
           const debit=panel.getByLabel('Amount debited (USD)',{exact:true});
           await debit.fill('0.26');
           await expect(save).toBeDisabled();
           await affected.getByRole('button',{name:'Start at cent 101',exact:true}).press('Enter');
           await debit.fill('0.25');
           await panel.getByRole('combobox',{name:'Account debited',exact:true}).selectOption({label:'Fictional checking'});
           await panel.getByLabel('Reference type',{exact:true}).fill('ledger');
           const transaction='fictional-incoming-failure';
           await panel.getByLabel('Transaction ID',{exact:true}).fill(transaction);
           await panel.getByLabel('Statement reference',{exact:true}).fill('Fictional failed deposit debit');
           await panel.getByLabel('How you verified the debit',{exact:true}).fill('Fictional owner checked the settled statement debit');
           await panel.getByLabel('Reason for the adjustment',{exact:true}).fill('Fictional incoming payment failed');
           for(const width of [360,390,768,1440]){
            await page.setViewportSize({width,height:900});
            await save.scrollIntoViewIfNeeded();
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="'+title+'"]')
             .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
            await page.screenshot({path:'.local/review/finance-collection-failure-'+name+'-'+width+'.png'});
           }
           await allowInvoiceReadWindow();
           let requests=0;
           await page.route('**/api/business/finance-accounts/collection-failure-submit',async route=>{
            requests++;
            const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
            if(response.status()!==200){await route.fulfill({response});return;}
            adjustment=(await response.json()).receipt;
            await route.abort('failed');
           },{times:1});
           await save.press('Enter');
           await expect(panel.getByRole('status')).toContainText('could not confirm the save');
           assert.deepEqual([adjustment?.originalPaymentId,adjustment?.cents,adjustment?.kind],
            [committed.paymentId,'25','settled_failure']);
           assert.deepEqual(adjustment.components.map(({kind,firstCent,lastCent})=>[kind,firstCent,lastCent]),[['funds','101','125']]);
           const key='crest.collection-failure.pending-reference.v1';
           const retained=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key));
           assert.deepEqual(Object.keys(retained).sort(),['binding','businessId','customerId','paymentId','reference']);
           assert.deepEqual(Object.keys(retained.reference).sort(),['collectionFailureId','operationId','recoveryEpoch']);
           assert.equal(retained.paymentId,committed.paymentId);
           await allowInvoiceReadWindow();
           await page.reload();
           await draftDisclosure.click();
           await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
           await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
           await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
           await expect(draftStatus).toHaveText('Issued invoice loaded.');
           await invoice.getByText(title,{exact:true}).press('Enter');
           await panel.getByRole('button',{name:'Check original adjustment',exact:true}).press('Enter');
           await expect(panel.getByRole('status')).toHaveText('The original payment adjustment was saved.');
           assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
           assert.equal(requests,1);
           const csv=page.waitForEvent('download');
           await panel.getByRole('button',{name:'Download adjustment (CSV)',exact:true}).press('Enter');
           assert((await readFile(await (await csv).path(),'utf8')).includes(adjustment.collectionFailureId));
          }
          if(refundTransferExport){
           await allowInvoiceReadWindow();
           const title='Review a returned refund';
           const transfer=invoice.getByRole('region',{name:title,exact:true});
           await invoice.getByText(title,{exact:true}).press('Enter');
           async function prepareTransfer(kind,eventId,amount,transaction){
            await transfer.getByRole('combobox',{name:'What happened?',exact:true}).selectOption(kind);
            await transfer.getByLabel('Settlement date',{exact:true}).fill(committed.actualOn);
            await transfer.getByRole('button',{name:'Load prior transfers',exact:true}).press('Enter');
            await expect(transfer.getByRole('status')).toContainText('Choose the prior transfer');
            await transfer.getByRole('combobox',{name:'Prior transfer',exact:true}).selectOption(eventId);
            await transfer.getByText('$1.00 available',{exact:true}).press('Enter');
            await transfer.getByLabel('Amount to record (USD)',{exact:true}).fill(amount);
            if(kind==='retry')await transfer.getByRole('button',{name:'Start at cent 1',exact:true}).press('Enter');
            await transfer.getByLabel('Settled amount (USD)',{exact:true}).fill(amount);
            await transfer.getByRole('combobox',{name:kind==='recredit'?'Account recredited':'Account debited',exact:true}).selectOption({label:'Fictional checking'});
            await transfer.getByLabel('Reference type',{exact:true}).fill('ledger');
            await transfer.getByLabel('Transaction ID',{exact:true}).fill(transaction);
            await transfer.getByLabel('Statement reference',{exact:true}).fill('Fictional statement transfer');
            await transfer.getByLabel('How you verified settlement',{exact:true}).fill('Fictional owner verified settlement');
            await transfer.getByLabel('Reason for the transfer',{exact:true}).fill('Fictional returned disbursement');
           }
           await prepareTransfer('recredit',returned.eventId,'1.00','fictional-refund-recredit');
           const save=transfer.getByRole('button',{name:'Save refund transfer',exact:true});
           for(const width of [360,390,768,1440]){
            await page.setViewportSize({width,height:900});await save.scrollIntoViewIfNeeded();
            assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
            assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="'+title+'"]')
             .withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
            await page.screenshot({path:'.local/review/finance-refund-transfer-'+name+'-'+width+'.png'});
           }
           await allowInvoiceReadWindow();
           let submitted=0;
           await page.route('**/api/business/finance-accounts/refund-transfer-submit',async route=>{
            submitted++;
            const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
            if(response.status()!==200){await route.fulfill({response});return;}
            recredit=(await response.json()).receipt;await route.abort('failed');
           },{times:1});
           await save.press('Enter');
           await expect(transfer.getByRole('status')).toContainText('could not confirm the save');
           assert.deepEqual([recredit?.kind,recredit?.priorEventId,recredit?.cents],['recredit',returned.eventId,'100']);
           const key='crest.refund-transfer.pending-reference.v1';
           const pending=JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key));
           assert.deepEqual(Object.keys(pending).sort(),['binding','businessId','customerId','reference']);
           assert.deepEqual(Object.keys(pending.reference).sort(),['operationId','recoveryEpoch','refundTransferAdjustmentId']);
           await allowInvoiceReadWindow();
           await page.reload();
           await draftDisclosure.click();
           await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
           await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
           await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
           await expect(draftStatus).toHaveText('Issued invoice loaded.');
           await invoice.getByText(title,{exact:true}).press('Enter');
           await transfer.getByRole('button',{name:'Check original refund transfer',exact:true}).press('Enter');
           await expect(transfer.getByRole('status')).toHaveText('The original refund transfer was recorded.');
           assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
           assert.equal(submitted,1);
           await prepareTransfer('retry',recredit.eventId,'0.40','fictional-refund-retry');
           await allowInvoiceReadWindow();
           await page.route('**/api/business/finance-accounts/refund-transfer-submit',async route=>{
            const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});
            if(response.status()===200)refundRetry=(await response.json()).receipt;
            await route.fulfill({response});
           },{times:1});
           await save.press('Enter');
           await expect(transfer.getByRole('status')).toHaveText('Refund transfer record saved.');
           assert.deepEqual([refundRetry?.kind,refundRetry?.originalEventId,refundRetry?.priorEventId,refundRetry?.cents],
            ['retry',returned.eventId,recredit.eventId,'40']);
           const csv=page.waitForEvent('download');
           await transfer.getByRole('button',{name:'Download refund transfer (CSV)',exact:true}).press('Enter');
           assert((await readFile(await (await csv).path(),'utf8')).includes(refundRetry.refundTransferAdjustmentId));
          }
          await allowInvoiceReadWindow();
          await page.goto(fixture.origin+'/settings/accounts');
          await page.getByRole('button',{name:'Load accounts',exact:true}).click();
          await page.getByText(refundTransferExport?'Available customer funds':'Customer funds held',{exact:true}).press('Enter');
          const heldReport=page.getByRole('region',{name:'Customer funds held',exact:true});
          await heldReport.getByRole('button',{name:'Load customer funds',exact:true}).press('Enter');
          await expect(heldReport.getByRole('status')).toHaveText('Customer funds matched the ledger.');
          await heldReport.getByText(/^Held funds by customer/).press('Enter');
          await expect(heldReport.getByText(collectionFailureExport?'$11.09':'$11.34',{exact:true}).first()).toBeVisible();
          await page.getByText('Fictional trial balance',{exact:true}).press('Enter');
          const trial=page.getByRole('region',{name:'Fictional trial balance',exact:true});
          await trial.getByRole('button',{name:'Load trial balance',exact:true}).press('Enter');
          await expect(trial.getByRole('status')).toHaveText('Posted balances loaded.');
          if(refundTransferExport)await expect(trial).toContainText('Refunds still due · $0.60');
          await trial.getByText('Journal entries',{exact:true}).press('Enter');
          await allowInvoiceReadWindow();
          const journalResponse=page.waitForResponse(response=>response.url().endsWith('/posted-journal'));
          await trial.getByRole('button',{name:'Load journal entries',exact:true}).press('Enter');
          assert.equal((await journalResponse).status(),200);
          await expect(trial).toContainText('Unused payment return · Held balance reduced');
          await expect(trial).toContainText('Unused payment return · Settled outflow');
          if(tipReturnExport){
           await expect(trial).toContainText('Tip return · Original tip revenue reduced');
           await expect(trial).toContainText('Tip return · Original tax reduced');
           await expect(trial).toContainText('Tip return · Settled outflow');
          }
          if(adjustment){
           await expect(trial).toContainText('Failed payment · Customer funds reduced');
           await expect(trial).toContainText('Failed payment · Money account credited');
          }
          if(refundRetry){
           await expect(trial).toContainText('Refund returned · Recredited by bank or wallet');
           await expect(trial).toContainText('Retried refund · Settled debit');
          }
          const journalCsv=page.waitForEvent('download');
          await trial.getByRole('button',{name:'Download journal page CSV',exact:true}).press('Enter');
          const journalText=await readFile(await (await journalCsv).path(),'utf8');
          assert(journalText.includes('Unused payment return ID')&&journalText.includes(returned.excessReturnId));
          if(adjustment)assert(journalText.includes('Original payment ID')&&journalText.includes(adjustment.collectionFailureId));
         }
         await allowInvoiceReadWindow();
         await page.goto(fixture.origin+'/export-files');
         await expect(prepare).toBeVisible();
         const excessExportResponse=page.waitForResponse(result=>new URL(result.url()).pathname==='/api/business/exports/posted-finance');
         await prepare.press('Enter');
         const excessResponse=await excessExportResponse;
         assert.equal(excessResponse.status(),200);
         assert.match(excessResponse.headers()['cache-control'],/no-store/);
         await expect(save).toBeVisible();
         const waitingForZip=page.waitForEvent('download');
         await save.press('Enter');
         const exported=await waitingForZip;
         assert.equal(exported.suggestedFilename(),'crest-posted-finance.zip');
         const excessZip=await readFile(await exported.path());
         assert.equal(createHash('sha256').update(excessZip).digest('hex'),excessResponse.headers()['x-crest-sha256']);
         const {['manifest.json']:excessManifest,['export_delivery.json']:excessDelivery,...excessParts}=unzipSync(excessZip);
         const verifiedExcess=verifyFinanceSourceExport(strFromU8(excessManifest),
          Object.entries(excessParts).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
         assert.equal(verifiedExcess.profile,exportProfile);
         assert.equal(verifiedExcess.completePortableExport,false);
         assert.equal(JSON.parse(strFromU8(excessDelivery)).sourceSchemaVersion,postedFinanceSchemaVersion);
         const lots=strFromU8(excessParts['customer_fund_lots.csv']);
         const lot=lots.split(/\r?\n/).find(row=>row.includes(committed.heldFunds.lotId));
         assert(lots.split(/\r?\n/)[0].includes('receipt_event_id'));
         assert(lot?.includes(committed.eventId)&&lot.includes(committed.heldFunds.fundingPartitionId)
          &&lot.includes(mappingId)&&lot.includes('"1234"'));
         const ledger=strFromU8(excessParts['journal_lines.csv']);
         if(adjustment){
          assert(strFromU8(excessParts['collection_failures.csv']).includes(adjustment.collectionFailureId));
          assert(strFromU8(excessParts['collection_failure_components.csv']).includes(adjustment.components[0].componentId));
         }
         if(refundRetry)assert(strFromU8(excessParts['refund_transfer_adjustments.csv']).includes(refundRetry.refundTransferAdjustmentId));
         assert(ledger.split(/\r?\n/).some(row=>row.includes('"receipt_funds"')&&row.includes(committed.heldFunds.lotId)&&row.includes('"1234"')));
         if(returned){
          const returns=strFromU8(excessParts['excess_receipt_returns.csv']);
          assert(returns.split(/\r?\n/).some(row=>row.includes(returned.excessReturnId)&&row.includes(committed.eventId)
            &&row.includes(committed.heldFunds.lotId)&&row.includes('"1","100","100"')));
          assert.deepEqual(ledger.split(/\r?\n/).filter(row=>row.includes(returned.excessReturnId))
            .map(row=>row.includes('"excess_return_funds"')?'funds':row.includes('"excess_return_money"')?'money':'unexpected').sort(),
           ['funds','money']);
          const audit=(await fixture.client.query(
           "SELECT delta->'after' AS scope FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='finance_export_accesses' AND delta->'after'->>'archiveSha256'=$2",
           [fixture.business,excessResponse.headers()['x-crest-sha256']])).rows[0].scope;
          assert.equal(audit.profile,exportProfile);
          assert.equal(audit.sourceSchemaVersion,postedFinanceSchemaVersion);
          assert.equal(audit.manifestSha256,createHash('sha256').update(excessManifest).digest('hex'));
         }
        }
        await fixture.client.query('UPDATE crest_private.business_recovery_authorities SET writes_enabled=false,version=version+1 WHERE business_id=$1',[fixture.business]);
        await prepare.press('Enter');
        await expect(exporter.getByRole('status')).toContainText('could not prepare');
        assert.equal(await save.count(),0);
        assert.equal((await fixture.client.query("SELECT count(*)::int AS n FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind='finance_export_accesses'",[fixture.business])).rows[0].n,excessReceipts?2:1);
       }
      }
     }
    }
 }catch(error){
  if(error instanceof Error)throw new Error(error.message+'\nRecent finance responses '+JSON.stringify(financeResponses.slice(-15)),{cause:error});
  throw error;
 }finally{
  await browser?.close();
  await fixture.close();
 }
},{timeout:excessReceipts?960000:paidInvoiceCredits?840000:invoiceCredits?720000:480000});
