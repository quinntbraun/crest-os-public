import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const directReceipts=true;
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' genuine taxable and exempt invoice with owner setup',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,reviewOutcome:true,reviewHistory:true,
  financeAccounts:true,financeMappings:true,financeTaxProfiles:true,invoicePreparation:true,invoiceDrafts:true,invoiceIssueTaxReview:true,invoiceIssue:true,
  financeMoneyChannels:directReceipts,directReceipts});
 let browser;
 const financeResponses=[];
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.on('response',response=>{
   const path=new URL(response.url()).pathname;
   if(path.startsWith('/api/business/finance-accounts/'))financeResponses.push([path,response.status()]);
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
       const release=rows[rows.length-89];
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
     await page.route('**/api/business/finance-accounts/invoice-issue-submit',async route=>{
      submitCount++;
      assert.equal((await route.fetch()).status(),200);
      await route.abort();
     },{times:1});
     await tax.getByRole('button',{name:'Issue invoice',exact:true}).press('Enter');
     await expect(tax.getByRole('status')).toHaveText('The issue outcome is uncertain. Check the original before attempting another issue.');
     // This test combines two interrupted issue journeys. Keep the same sign-in
     // for the saved operation reference and respect the ordinary request window.
     await allowInvoiceReadWindow();
     await page.reload();
     const draftDisclosure=page.getByText('Invoice drafts',{exact:true});
     await draftDisclosure.click();
     await drafts.getByRole('button',{name:'Load saved drafts',exact:true}).click();
     await expect(draftStatus).toHaveText('Saved invoice drafts loaded.');
     await drafts.getByRole('button',{name:'Open invoice draft',exact:true}).click();
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
     }
    }
 }catch(error){
  if(error instanceof Error)error.message+='\nRecent finance responses '+JSON.stringify(financeResponses.slice(-15));
  throw error;
 }finally{
  await browser?.close();
  await fixture.close();
 }
});
