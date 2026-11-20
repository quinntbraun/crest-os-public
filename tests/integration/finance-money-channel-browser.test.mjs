import assert from 'node:assert/strict';
import {reviewFinancialRecovery} from '../support/financial-recovery-layout.mjs';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {parseMoneyChannelReference} from '../../src/bookkeeping/finance-money-channel-contract.ts';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

for(const engine of [chromium,webkit]){
 test(engine.name()+' reviews a fictional money channel, recovers a lost save and exports its evidence',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMoneyChannels:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const anonymous=await page.request.post(fixture.origin+'/api/business/finance-accounts/channel-list',{data:{afterChannel:null}});
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
   await page.getByRole('button',{name:'Setup',exact:true}).click();
   await page.getByRole('link',{name:'Money channels',exact:true}).click();

   const panel=page.getByRole('region',{name:'Money channel reviews',exact:true}),status=panel.getByRole('status');
   const load=panel.getByRole('button',{name:'Load channels',exact:true});
   const add=panel.getByRole('button',{name:'Add channel',exact:true}),save=panel.getByRole('button',{name:'Save channel review',exact:true});
   const review=panel.getByRole('button',{name:'Check interrupted review',exact:true});
   const selected=panel.getByRole('region',{name:'Fictional business custody',exact:true});
   const filter=panel.getByLabel('Filter loaded channels',{exact:true});
   const openCustody=()=>panel.getByRole('button',{name:/^Fictional business custody/}).click();
   async function checkInterrupted(){
    if(!await review.isVisible())await panel.getByText('Review an interrupted save',{exact:true}).click();
    await review.click();
   }
   async function facts(){return {
    versions:(await fixture.client.query('SELECT to_jsonb(v) AS value FROM crest.money_channel_versions v WHERE business_id=$1 ORDER BY to_jsonb(v)::text',[fixture.business])).rows,
    audits:(await fixture.client.query('SELECT to_jsonb(v) AS value FROM crest_private.audit_events v WHERE business_id=$1 ORDER BY to_jsonb(v)::text',[fixture.business])).rows
   };}
   const date=panel.getByLabel('Effective from',{exact:true}),reason=panel.getByLabel('Reason for review',{exact:true});
   const pendingKey='crest.finance-money-channel.pending-reference.v1';
   await expect(load).toBeEnabled();
   await load.focus();
   await expect(load).toBeFocused();
   await page.keyboard.press('Enter');
   await expect(panel.getByText('No money channels have been saved.',{exact:true})).toBeVisible();
   await add.press('Enter');
   await expect(panel.getByRole('heading',{name:'Add money channel',exact:true})).toBeFocused();
   await panel.getByLabel('Channel type',{exact:true}).selectOption('bank');
   await panel.getByLabel('Ownership',{exact:true}).selectOption('mixed_personal');
   await panel.getByRole('button',{name:'Find eligible accounts',exact:true}).click();
   const account=panel.getByLabel('Linked account',{exact:true});
   await expect(account.getByRole('option',{name:'1000 · Fictional dedicated bank',exact:true})).toHaveCount(0);
   const [accountId]=await account.selectOption({label:'1070 · Fictional owner custody'});
   await panel.getByLabel('Provider code',{exact:true}).fill('fictional-bank');
   await panel.getByLabel('Last four characters',{exact:true}).fill('9a76');
   await panel.getByLabel('Channel name',{exact:true}).fill('Fictional business custody');
   await date.fill('2026-01-01');
   await reason.fill('Fictional masked channel setup');
   await save.press('Enter');
   await expect(status).toHaveText('Channel review saved.');
   await expect(panel.getByText('Opening unknown',{exact:true})).toBeVisible();
   await expect(panel.locator('.channel-directory').getByText('Account 1070 · USD',{exact:true})).toBeVisible();
   await expect(panel.getByRole('button',{name:/^Fictional business custody/})).toHaveAccessibleName(/Fictional business custody.*Account 1070.*USD.*Opening unknown/);
   await filter.fill('custody');
   const beforeSelect=await facts(),selectRequests=fixture.requests.length;
   await openCustody();
   await expect(selected.getByRole('heading',{name:'Fictional business custody',exact:true})).toBeFocused();
   await expect(selected.getByText('Bank account · Business funds held by owner · fictional-bank •••• 9A76',{exact:true})).toBeVisible();
   await expect(selected.getByText('Latest review · Open from Jan 1, 2026',{exact:true})).toBeVisible();
   await expect(filter).toBeHidden();
   await selected.getByRole('button',{name:'Back to channels',exact:true}).click();
   await expect(filter).toHaveValue('custody');
   await expect(panel.getByRole('button',{name:/^Fictional business custody/})).toBeFocused();
   await openCustody();
   assert.equal(fixture.requests.length,selectRequests,'Selecting and returning makes no API request');
   assert.deepEqual(await facts(),beforeSelect,'Selecting and returning preserves channel and audit data');

   await panel.getByRole('button',{name:'Edit review',exact:true}).click();
   await expect(panel.getByLabel('Linked account',{exact:true})).toHaveCount(0);
   await date.fill('2026-02-01');
   await panel.getByText('Ownership and opening evidence',{exact:true}).click();
   await panel.getByLabel('Opening status',{exact:true}).selectOption('verified');
   await panel.getByLabel('Opening amount ($)',{exact:true}).fill('-10.00');
   await panel.getByLabel('Ownership evidence',{exact:true}).fill('Fictional ownership review');
   await panel.getByLabel('Opening date',{exact:true}).fill('2026-01-01');
   await panel.getByLabel('Opening evidence',{exact:true}).fill('=Fictional verified opening evidence');
   await reason.fill('Fictional opening reviewed');
   await expect(save).toBeDisabled();
   await panel.getByLabel('Opening amount ($)',{exact:true}).fill('10.25');
   await expect(save).toBeEnabled();
   await mkdir('.local/review',{recursive:true});
   async function capture(view,anchor){
    for(const width of [360,390,768,1100,1440]){
     await page.setViewportSize({width,height:900});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     await anchor.scrollIntoViewIfNeeded();
     if(width>=1100&&(view==='history'||view==='record')){
      const directory=await panel.getByRole('heading',{name:'Saved channels',exact:true}).boundingBox();
      assert(directory&&directory.y>=0&&directory.y<900,'Desktop directory context should remain visible while reviewing evidence');
     }
     await page.screenshot({path:'.local/review/finance-channel-'+view+'-'+engine.name()+'-'+width+'.png',animations:'disabled'});
    }
   }
   await capture('opening',panel.getByLabel('Opening date',{exact:true}));
   const savedReview=panel.getByRole('region',{name:'Latest saved channel',exact:true});
   const proposedReview=panel.getByRole('region',{name:'Proposed channel review',exact:true});
   await expect(savedReview.getByText('Open from Jan 1, 2026',{exact:true})).toBeVisible();
   await expect(savedReview.getByText('Opening unknown',{exact:true})).toBeVisible();
   await expect(proposedReview.getByText('Open from Feb 1, 2026',{exact:true})).toBeVisible();
   await expect(proposedReview.getByText('1070',{exact:true})).toBeVisible();
   await expect(proposedReview.getByText('Verified opening amount',{exact:true})).toBeVisible();
   await capture('comparison',panel.getByRole('region',{name:'Review effective channel settings',exact:true}));
   await page.setViewportSize({width:390,height:900});
   // An opaque operation ID can contain the same digits as the opening amount.
   const operationId='10250000-0000-4000-8000-000000000001';
   await page.evaluate(id=>{
    const generate=crypto.randomUUID;
    crypto.randomUUID=()=>{crypto.randomUUID=generate;return id;};
   },operationId);
   let committedStatus,submittedReference,submittedBinding;
   await page.route('**/api/business/finance-accounts/channel-save',async route=>{
    submittedReference=route.request().postDataJSON().reference;
    submittedBinding=route.request().headers()['x-crest-edit-binding'];
    const response=await route.fetch();committedStatus=response.status();await route.abort();
   },{times:1});
   await save.click();
   await expect(status).toContainText('The channel review could not be confirmed');
   assert.equal(committedStatus,200);
   const stored=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(stored);
   const pending=JSON.parse(stored);
   const reference=parseMoneyChannelReference(pending.reference);
   assert.equal(reference.operationId,operationId);
   assert.equal(reference.expectedVersion,'1');
   assert(!Object.values(reference).includes(accountId));
   assert.match(submittedBinding,/^[A-Za-z0-9_-]{43}$/);
   assert.deepEqual(pending,{businessId:fixture.business,binding:submittedBinding,reference:submittedReference});
   await reviewFinancialRecovery(page,fixture,engine.name(),'channel',panel.getByRole('region',{name:'Interrupted channel review',exact:true}));
   await page.reload();
   await checkInterrupted();
   await expect(status).toHaveText('The original channel review was confirmed.');
   await openCustody();
   await expect(selected.getByText('Verified opening amount · $10.25',{exact:true})).toBeVisible();
   await expect(selected.getByText('Latest review · Open from Feb 1, 2026',{exact:true})).toBeVisible();
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);

   await panel.getByRole('button',{name:'Edit review',exact:true}).click();
   await date.fill('2026-03-01');
   await reason.fill('Fictional request interrupted before delivery');
   await page.route('**/api/business/finance-accounts/channel-save',route=>route.abort(),{times:1});
   await save.click();
   await expect(status).toContainText('The channel review could not be confirmed');
   await review.click();
   await expect(status).toContainText('No completed review was found.');
   await panel.getByLabel('Reason to close this attempt',{exact:true}).fill('Fictional owner closed this attempt');
   await panel.getByRole('button',{name:'Close interrupted review',exact:true}).click();
   await expect(status).toHaveText('The interrupted channel review was closed.');

   await openCustody();
   await panel.getByRole('button',{name:'Edit review',exact:true}).click();
   await date.fill('2026-03-01');
   await reason.fill('Fictional unsaved channel review');
   const beforeCancel=await facts(),cancelRequests=fixture.requests.length;
   const cancel=panel.getByRole('button',{name:'Cancel',exact:true});
   page.once('dialog',dialog=>dialog.dismiss());
   await cancel.click();
   await expect(reason).toHaveValue('Fictional unsaved channel review');
   page.once('dialog',dialog=>dialog.accept());
   await cancel.click();
   await expect(selected.getByRole('heading',{name:'Fictional business custody',exact:true})).toBeFocused();
   assert.equal(fixture.requests.length,cancelRequests,'Cancelling an unsaved review makes no API request');
   assert.deepEqual(await facts(),beforeCancel,'Cancelling preserves retained reviews and audit history');
   await panel.getByRole('button',{name:'View history',exact:true}).click();
   const history=panel.getByRole('region',{name:'Saved channel history',exact:true});
   await expect(history.getByText('Version 2 · Open',{exact:true})).toBeVisible();
   await expect(history.getByText('Version 1 · Open',{exact:true})).toBeVisible();
   await expect(history.getByText('Version 3',{exact:false})).toHaveCount(0);
   await history.getByText('Evidence',{exact:true}).click();
   await expect(history.getByText('Opening · 2026-01-01 · =Fictional verified opening evidence',{exact:true})).toBeVisible();
   const waiting=page.waitForEvent('download');
   await history.getByRole('button',{name:'Download loaded history (CSV)',exact:true}).click();
   const download=await waiting;
   assert.equal(download.suggestedFilename(),'crest-money-channel-history.csv');
   const csv=await readFile(await download.path(),'utf8');
   assert.match(csv,/"Verified opening amount","2026-01-01","1025","'=Fictional verified opening evidence"/);
   await expect(history).toContainText('Before Feb 1, 2026 (exclusive)');
   await capture('history',history.getByRole('heading'));
   await page.setViewportSize({width:390,height:900});
   await selected.getByRole('button',{name:'Back to channels',exact:true}).click();
   await filter.fill('custody');
   await add.click();
   await panel.getByLabel('Channel type',{exact:true}).selectOption('bank');
   await panel.getByLabel('Ownership',{exact:true}).selectOption('dedicated_business');
   await panel.getByRole('button',{name:'Find eligible accounts',exact:true}).click();
   await account.selectOption({label:'1000 · Fictional dedicated bank'});
   await panel.getByLabel('Provider code',{exact:true}).fill('fictional-reserve');
   await panel.getByLabel('Last four characters',{exact:true}).fill('1234');
   await panel.getByLabel('Channel name',{exact:true}).fill('Fictional reserve');
   await date.fill('2026-01-01');
   await reason.fill('Fictional second channel');
   await save.click();
   await expect(status).toHaveText('Channel review saved.');
   await expect(filter).toHaveValue('custody');
   await filter.fill('');
   await expect(panel.locator('.channel-directory > li')).toHaveCount(2);
   await capture('directory',panel.getByRole('heading',{name:'Saved channels',exact:true}));
   await page.setViewportSize({width:390,height:900});
   const beforeBrowse=await facts(),browseRequests=fixture.requests.length;
   await filter.fill('no fictional channel matches');
   await expect(panel.getByText('No loaded channels match. Clear the filter or load more channels.',{exact:true})).toBeVisible();
   await filter.fill('reserve');
   await expect(panel.locator('.channel-directory > li')).toHaveCount(1);
   await panel.getByRole('button',{name:/^Fictional reserve/}).click();
   const reserve=panel.getByRole('region',{name:'Fictional reserve',exact:true});
   await expect(reserve).toContainText('Account 1000');
   await expect(reserve.getByRole('region',{name:'Saved opening evidence',exact:true})).toContainText('Opening unknown');
   await expect(reserve.getByText('This is saved opening evidence, not a current balance or confirmation from a bank.',{exact:true})).toBeVisible();
   await expect(history).toHaveCount(0);
   await capture('record',reserve);
   await page.setViewportSize({width:390,height:900});
   await reserve.getByRole('button',{name:'Back to channels',exact:true}).click();
   await expect(filter).toHaveValue('reserve');
   await expect(panel.getByRole('button',{name:/^Fictional reserve/})).toBeFocused();
   assert.equal(fixture.requests.length,browseRequests,'Loaded filtering and channel inspection make no API request');
   assert.deepEqual(await facts(),beforeBrowse,'Loaded filtering and inspection preserve retained data');
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   await expect(history).toHaveCount(0);
   await expect(filter).toHaveCount(0);
   await expect(panel.locator('.channel-directory > li')).toHaveCount(0);
   await page.goBack();
   await expect(page.getByRole('heading',{name:'Accounting',level:1,exact:true})).toBeVisible();
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
