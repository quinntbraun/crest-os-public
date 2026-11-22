import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {strFromU8,unzipSync} from 'fflate';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {reviewSupplierRegister} from '../support/supplier-register-layout.mjs';
import {reviewSupplierDraft} from '../support/supplier-draft-layout.mjs';
import {reviewSupplierDirectory} from '../support/supplier-directory-layout.mjs';
import {reviewFinancialRecovery} from '../support/financial-recovery-layout.mjs';
import {captureDuringAction} from '../support/quote-browser-response.mjs';
import {reviewSupplierPostingAccessRecovery} from '../support/supplier-posting-access-recovery.mjs';
import {sessionAdmissionDiagnostic} from '../support/session-admission-diagnostic.mjs';

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

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])for(const scenario of ['complete','original-reentry','original-reentry-new-signin'])test(name+' reviews a saved supplier draft and reads recorded payables'+(scenario==='complete'?'':scenario==='original-reentry'?' (original request re-entry)':' (original request re-entry after new sign-in)'),
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
   await page.getByRole('button',{name:'Suppliers',exact:true}).click();
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
   const bills=page.getByRole('region',{name:'Unpaid supplier bill drafts',exact:true});
   const editor=bills.locator('details.supplier-bill-editor');
   if(await editor.count())await editor.locator(':scope > summary').press('Enter');
   await draft.getByLabel('Business purpose',{exact:true}).fill('Unsaved supplier bill change');
   const facts=async()=>{const result={};for(const table of ['supplier_bill_draft_revisions','financial_events','journal_entries','journal_lines'])
    result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
    result.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return result;};
   const draftLayoutFindings=[];
   draftLayoutFindings.push(...await reviewSupplierDraft(page,name,'dirty-editor',facts));
   const beforeDirtyReview=await facts();let dirtyReviewRequests=0;const trackDirtyReview=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))dirtyReviewRequests++;};page.on('request',trackDirtyReview);
   try{
    await expect(page.getByText('Preview the payable entry',{exact:true})).toHaveAttribute('aria-disabled','true');
    await page.getByText('Preview the payable entry',{exact:true}).press('Enter');
    await expect(page.getByRole('form',{name:'Supplier payable entry preview'})).toBeHidden();
    await expect(bills.getByText('Unsaved edits are separate from the saved bill. Save or discard them before reviewing the payable.',{exact:true})).toBeVisible();
    assert.equal(dirtyReviewRequests,0);assert.deepEqual(await facts(),beforeDirtyReview);
   }finally{page.off('request',trackDirtyReview);}
   await bills.getByRole('button',{name:'Discard draft edits',exact:true}).click();
   await expect(draft.getByLabel('Business purpose',{exact:true})).toHaveValue('Fictional workshop supplies');
   await expect(draft.getByLabel('Incurred date',{exact:true})).toBeFocused();
   await editor.locator(':scope > summary').press('Enter');
   const selected=bills.getByRole('region',{name:'Selected supplier bill',exact:true});
   await expect(selected.getByRole('heading',{name:'Fictional workshop supplier',exact:true})).toBeVisible();
   await expect(selected.getByText('Saved bill record · Revision 1',{exact:true})).toBeVisible();
   await expect(selected.getByText('$150.25',{exact:true})).toBeVisible();
   for(const width of [360,390,768,1100,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(issue=>issue.id),[]);
    await mkdir('.local/review',{recursive:true});
    await selected.screenshot({path:'.local/review/finance-supplier-selected-'+name+'-'+width+'.png'});
    await bills.screenshot({path:'.local/review/finance-supplier-workspace-'+name+'-'+width+'.png'});
   }
   draftLayoutFindings.push(...await reviewSupplierDraft(page,name,'selected',facts));
   await page.getByText('Preview the payable entry',{exact:true}).click();
   const review=page.getByRole('form',{name:'Supplier payable entry preview'});
   await editor.locator(':scope > summary').press('Enter');
   await expect(draft.getByLabel('Business purpose',{exact:true})).toBeDisabled();
   await expect(bills.getByRole('button',{name:'Enter another supplier bill',exact:true})).toBeDisabled();
   await editor.locator(':scope > summary').press('Enter');
   await review.getByLabel('Purchase tax treatment').selectOption('none');
   await review.getByLabel('Reason for the review').fill('Fictional purchase tax review');
   await review.getByRole('button',{name:'Review expense and payable amounts'}).click();
   await expect(page.getByText('A verified original is required for this revision.',{exact:true})).toBeVisible();
   draftLayoutFindings.push(...await reviewSupplierDraft(page,name,'original-required',facts));
   await page.getByText('Preview the payable entry',{exact:true}).click();
   await editor.locator(':scope > summary').press('Enter');
   await expect(draft.getByLabel('Business purpose',{exact:true})).toBeEnabled();
   await editor.locator(':scope > summary').press('Enter');
   await page.getByText('Preview the payable entry',{exact:true}).click();
   await expect(review.getByLabel('Purchase tax treatment')).toHaveValue('none');
   await expect(review.getByLabel('Reason for the review')).toHaveValue('Fictional purchase tax review');
   const register=page.getByRole('region',{name:'Recorded supplier payables',exact:true});
   const loadRegister=async()=>{
    if(await register.locator(':scope > details').getAttribute('open')===null)await register.getByText('Recorded supplier payables',{exact:true}).click();
    const response=await captureDuringAction(page,financeRoute+'supplier-payable-register',()=>register.getByRole('button',{name:'Load supplier payables',exact:true}).click());
    assert.equal(response.requestBody.throughOn,day,'Register reads retain the explicitly selected date');
    assert.equal(response.status,200);return response.body;
   };
   await register.getByText('Recorded supplier payables',{exact:true}).click();
   await register.getByLabel('Through date (optional)',{exact:true}).fill(day);
   await page.getByRole('button',{name:'Exports',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('payablesThrough'),day);
   await page.getByRole('button',{name:'Purchases',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('payablesThrough'),day);
   await page.getByRole('button',{name:'Suppliers',exact:true}).click();await expect(register.getByLabel('Through date (optional)',{exact:true})).toHaveValue(day);
   const emptyRegister=await loadRegister();
   await expect(register.getByRole('status')).toHaveText('No supplier payables were recorded through that date.');
   await expect(register).toContainText('$0.00 outstanding');
   await reviewSupplierRegister(page,name,'empty',emptyRegister,facts);
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
    await reviewFinancialRecovery(page,fixture,name,'supplier_upload',bills);
    await page.getByRole('button',{name:'Check original upload',exact:true}).click();
    await expect(page.getByText('Original bill verified.',{exact:true})).toBeVisible();
    const {rows:[original]}=await fixture.client.query('SELECT id AS original_id FROM crest.supplier_bill_originals WHERE business_id=$1',
     [fixture.business]);
    const originalId=original.original_id;
    await review.getByRole('button',{name:'Review expense and payable amounts'}).click();
   await expect(page.getByRole('heading',{name:'Proposed entry for Fictional workshop supplier'})).toBeVisible();
   draftLayoutFindings.push(...await reviewSupplierDraft(page,name,'entry-ready',facts));
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
    let {headers,context:authContext}=await beginFinanceCalls(page);
    const checked=await financeCall(page,headers,'supplier-payable-review',input);
    assert.equal(checked.status,200);
    assert.deepEqual(checked.body.candidates,[]);
    const reference={kind:'payable',operationId:randomUUID(),id:randomUUID(),recoveryEpoch:authContext.recoveryEpoch};
    const accrue={reference,review:input,planSha256:checked.body.plan.planSha256,reviewedDuplicates:[],distinctReason:null};
    const wrongPlan=await financeCall(page,headers,'supplier-payable-accrual',{...accrue,planSha256:'0'.repeat(64)});
    assert.deepEqual(wrongPlan,{status:409,body:{error:'SUPPLIER_PAYABLE_REVIEW_CHANGED'}});
    const approval=page.getByRole('form',{name:'Confirm supplier bill posting'});
    const postButton=approval.getByRole('button',{name:/^(?:Post supplier bill|Retry original supplier bill posting)$/});
    await expect(postButton).toBeDisabled();
    await approval.getByLabel('Record the expense and amount owed on '+day+'.',{exact:true}).check();
    let absentReference;
    if(scenario!=='complete'){
     await page.route('**'+financeRoute+'supplier-payable-accrual',async route=>{absentReference=route.request().postDataJSON().reference;await route.abort('failed');},{times:1});
     await postButton.click();await expect(page.getByText('The outcome is unconfirmed.',{exact:false})).toBeVisible();
     const retained=await page.evaluate(()=>sessionStorage.getItem('crest.supplier-posting.pending-reference.v1'));assert(retained);
     await reviewSupplierPostingAccessRecovery(page,fixture,name+'-'+scenario+'-absent','payable',absentReference,facts,{freshSignIn:scenario==='original-reentry-new-signin'});
     ({headers,context:authContext}=await beginFinanceCalls(page));
     const originalRecovery=page.getByRole('region',{name:'Interrupted supplier posting',exact:true});
     await originalRecovery.getByRole('button',{name:'Check original posting request',exact:true}).click();
     await expect(originalRecovery.getByRole('status')).toContainText('No committed entry was found');
     assert.equal((await page.evaluate(()=>sessionStorage.getItem('crest.supplier-posting.pending-reference.v1')))===retained,true);
     assert.equal((await fixture.client.query('SELECT count(*)::int AS count FROM crest.financial_events WHERE business_id=$1',[fixture.business])).rows[0].count,0);
     await originalRecovery.getByRole('button',{name:'Review the original record again',exact:true}).click();
     await bills.getByText('Unpaid supplier bills',{exact:true}).click();
     await bills.getByRole('button',{name:'Load saved supplier bills',exact:true}).click();
     await bills.getByRole('button',{name:'Open supplier bill draft',exact:true}).click();
     await bills.getByText('Preview the payable entry',{exact:true}).click();
     await review.getByLabel('Purchase tax treatment').selectOption(input.taxTreatment);
     await review.getByLabel('Reason for the review').fill(input.reason);
     const prepare=review.getByRole('button',{name:'Review expense and payable amounts'});await prepare.click();await expect(prepare).toBeEnabled();
     const originalChoice=review.getByLabel('Verified original',{exact:true});
     if(await originalChoice.isVisible()){await originalChoice.selectOption(originalId);await prepare.click();}
     await expect(approval).toBeVisible();await approval.getByLabel('Record the expense and amount owed on '+day+'.',{exact:true}).check();
    }
    let interruptedStatus,interruptedReference,interruptedError=null;
    await page.route('**'+financeRoute+'supplier-payable-accrual',async route=>{
     interruptedReference=route.request().postDataJSON().reference;
     if(absentReference)assert.equal(['kind','operationId','recoveryEpoch','id'].every(key=>interruptedReference[key]===absentReference[key]),true,'Re-entry must deliver the same original posting identity');
     try{const response=await route.fetch();interruptedStatus=response.status();if(interruptedStatus!==200){try{const value=await response.json();interruptedError=typeof value.error==='string'&&/^[A-Z0-9_]{1,100}$/.test(value.error)?value.error:'UNCLASSIFIED_FAILURE';}catch{interruptedError='UNCLASSIFIED_FAILURE';}}}finally{await route.abort('failed');}
    },{times:1});
    await postButton.click();
    await expect(page.getByText('The outcome is unconfirmed.',{exact:false})).toBeVisible();
    if(interruptedStatus!==200){const diagnostic=await sessionAdmissionDiagnostic(fixture);console.warn('SUPPLIER_POSTING_FAILURE '+JSON.stringify({scenario,engine:name,status:interruptedStatus,error:interruptedError,admissions:diagnostic.admissions??null,provider:diagnostic.provider??null}));}
    assert.equal(interruptedStatus,200);
    await reviewFinancialRecovery(page,fixture,name,'supplier_posting',bills);
    await reviewSupplierPostingAccessRecovery(page,fixture,scenario==='complete'?name:name+'-'+scenario,'payable',interruptedReference,facts);
    await page.getByRole('button',{name:'Check original posting request',exact:true}).click();
    await expect(page.getByText('Supplier bill posted. Reload Recorded supplier payables.',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.supplier-posting.pending-reference.v1')),null);
    if(scenario!=='complete'){
     const previousHeaders=headers;({headers,context:authContext}=await beginFinanceCalls(page));
     const verified=await financeCall(page,headers,'supplier-payable-lookup',{reference:absentReference});
     await writeFile('.local/review/supplier-original-verification-'+name+'-'+scenario+'.json',JSON.stringify({engine:name,scenario,status:verified.status,currentAuthorization:true,csrfChanged:previousHeaders['x-crest-csrf']!==headers['x-crest-csrf'],bindingChanged:previousHeaders['x-crest-edit-binding']!==headers['x-crest-edit-binding']},null,2)+'\n');
     assert.equal(verified.status,200);assert.equal(verified.body.state,'committed');assert.equal(verified.body.receipt.payableId===absentReference.id&&verified.body.receipt.operationId===absentReference.operationId,true);assert.equal(verified.body.receipt.grossCents,'15025');
     assert.deepEqual((await fixture.client.query('SELECT template,count(*)::int AS count FROM crest.financial_events WHERE business_id=$1 GROUP BY template ORDER BY template',[fixture.business])).rows,[{template:'P14',count:1}]);
     return;
    }
    const postedRegister=await loadRegister();
    await expect(register).toContainText('$150.25 outstanding');
    await reviewSupplierRegister(page,name,'posted',postedRegister,facts);
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
    let interruptedPaymentStatus,interruptedPaymentReference;
    await page.route('**'+financeRoute+'supplier-payable-settlement',async route=>{
     interruptedPaymentReference=route.request().postDataJSON().reference;
     try{interruptedPaymentStatus=(await route.fetch()).status();}finally{await route.abort('failed');}
    },{times:1});
    await paymentButton.click();
    await expect(register.getByText('The outcome is unconfirmed.',{exact:false})).toBeVisible();
    assert.equal(interruptedPaymentStatus,200);
    await expect(register.getByLabel('Through date (optional)',{exact:true})).toBeDisabled();
    await expect(register.getByRole('button',{name:'Load supplier payables',exact:true})).toBeDisabled();
    await expect(register.getByText('Check the original payment result below before changing this register’s date.',{exact:true})).toBeVisible();
    await expect(payment).toBeVisible();
    await reviewFinancialRecovery(page,fixture,name,'supplier_payment',register);
    await reviewSupplierPostingAccessRecovery(page,fixture,name,'settlement',interruptedPaymentReference,facts);
    ({headers,context:authContext}=await beginFinanceCalls(page));
    const refreshedRegister=await captureDuringAction(page,financeRoute+'supplier-payable-register',()=>page.getByRole('button',{name:'Check original posting request',exact:true}).click());
    assert.equal(refreshedRegister.requestBody.throughOn,day,'Recovered payment balances use the selected register date');
    await expect(register.getByText('Verified supplier payment recorded.',{exact:true})).toBeVisible();
    await expect(register.getByLabel('Through date (optional)',{exact:true})).toHaveValue(day);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.supplier-posting.pending-reference.v1')),null);
    assert.equal(refreshedRegister.status,200);
    const partiallyPaidRegister=refreshedRegister.body;
    const {rows:[paymentEvidence]}=await fixture.client.query(`SELECT s.id AS settlement_id,s.payable_id,m.id AS movement_id,v.version::text AS channel_version
     FROM crest.supplier_payable_settlements s JOIN crest.financial_events e ON (e.business_id,e.supplier_payable_settlement_id)=(s.business_id,s.id)
     JOIN crest.money_movements m ON (m.business_id,m.event_id)=(e.business_id,e.id)
     JOIN crest.money_channel_versions v ON (v.business_id,v.id)=(s.business_id,s.channel_version_id) WHERE s.business_id=$1`,[fixture.business]);
    assert.equal(paymentEvidence.channel_version,'1');
    await expect(register.locator('.supplier-payable-amounts dd')).toHaveText(['$150.25','$100.25','$50.00']);
    await expect(register).toContainText('The register agrees with the ledger.');
    await expect(register.getByLabel('Through date (optional)',{exact:true})).toBeEnabled();
    await reviewSupplierRegister(page,name,'partially-paid',partiallyPaidRegister,facts);
    const {rows:totals}=await fixture.client.query(`SELECT e.template,count(*)::int AS count FROM crest.financial_events e
     WHERE e.business_id=$1 GROUP BY e.template ORDER BY e.template`,[fixture.business]);
    assert.deepEqual(totals,[{template:'P14',count:1},{template:'P15',count:1}]);

    await page.goto(fixture.origin+'/settings/accounts');
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

    await page.getByRole('group',{name:'Choose a report',exact:true}).getByRole('button',{name:'Income',exact:true}).click();
    const income=page.getByRole('region',{name:'Recorded income statement',exact:true});
    await income.getByLabel('From date',{exact:true}).fill(day);
    await income.getByLabel('Through date',{exact:true}).fill(day);
    await income.getByRole('button',{name:'Load income statement',exact:true}).click();
    await expect(income.getByRole('row',{name:/Recorded-book net income/})).toContainText('-$150.25');
    await page.goto(fixture.origin+'/export-files');
    const financeExport=page.getByRole('region',{name:'Posted finance export',exact:true});
    await expect(financeExport).toContainText('CSV files in one ZIP');
    await financeExport.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
    const save=financeExport.getByRole('button',{name:'Save ZIP',exact:true});
    await expect(save).toBeVisible();
    await expect(financeExport.locator('.export-save-row[data-prepared="true"]')).toContainText('crest-posted-finance.zip');
    await expect(save).toBeInViewport();
    assert.deepEqual((await new AxeBuilder({page}).include('.export-finance').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
    await mkdir('.local/review',{recursive:true});
    await page.screenshot({path:'.local/review/export-finance-ready-'+name+'.png'});
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
   assert.equal(draftLayoutFindings.length,0,'Supplier draft layout findings are retained in state/engine observation reports');
   const directoryAuth=await beginFinanceCalls(page);
   for(let index=1;index<=8;index++){
    const seeded=await financeCall(page,directoryAuth.headers,'supplier-bill-draft-save',{
     reference:{billId:randomUUID(),recoveryEpoch:directoryAuth.context.recoveryEpoch,operationId:randomUUID(),expectedRevision:'0'},
     payload:{incurredOn:day,dueOn:day,unknownDueReason:null,vendor:'Fictional directory supplier '+index,unknownVendorReason:null,
      documentReference:'Directory bill '+index,grossCents:'2500',purchaseTaxCents:'0',purpose:'Fictional directory supplies',
      missingReceiptReason:'Synthetic directory evidence',splits:[{category:'supplies',grossCents:'2500'}],changeReason:null},
    });
    assert.equal(seeded.status,200);assert.equal(seeded.body.state,'committed');
   }
   await page.goto(fixture.origin+'/expenses');
   await page.getByRole('button',{name:'Suppliers',exact:true}).click();
   await page.getByText('Unpaid supplier bills',{exact:true}).click();
   await reviewSupplierDirectory(page,name,facts);
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
