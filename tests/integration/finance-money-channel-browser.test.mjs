import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
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
   await page.getByRole('button',{name:'Load accounts',exact:true}).click();
   await page.getByRole('link',{name:'Money channels',exact:true}).click();

   const panel=page.getByRole('region',{name:'Money channel reviews',exact:true}),status=panel.getByRole('status');
   const load=panel.getByRole('button',{name:'Load channels',exact:true});
   const add=panel.getByRole('button',{name:'Add channel',exact:true}),save=panel.getByRole('button',{name:'Save channel review',exact:true});
   const review=panel.getByRole('button',{name:'Check interrupted review',exact:true});
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
   await expect(panel.getByText('Bank account · Business funds held by owner · fictional-bank •••• 9A76 · Account 1070',{exact:true})).toBeVisible();
   await expect(panel.getByText('Latest review · Open from Jan 1, 2026',{exact:true})).toBeVisible();

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
    for(const width of [360,390,768,1440]){
     await page.setViewportSize({width,height:900});
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     await anchor.scrollIntoViewIfNeeded();
     await page.screenshot({path:'.local/review/finance-channel-'+view+'-'+engine.name()+'-'+width+'.png',animations:'disabled'});
    }
   }
   await capture('opening',panel.getByLabel('Opening date',{exact:true}));
   await page.setViewportSize({width:390,height:900});
   let committedStatus;
   await page.route('**/api/business/finance-accounts/channel-save',async route=>{
    const response=await route.fetch();committedStatus=response.status();await route.abort();
   },{times:1});
   await save.click();
   await expect(status).toContainText('The channel review could not be confirmed');
   assert.equal(committedStatus,200);
   const stored=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(stored&&!stored.includes(accountId)&&!stored.includes('fictional-bank')&&!stored.includes('Fictional')&&!stored.includes('1025'));
   assert.deepEqual(Object.keys(JSON.parse(stored).reference).sort(),['channelId','expectedVersion','operationId','recoveryEpoch']);
   await page.reload();
   await review.click();
   await expect(status).toHaveText('The original channel review was confirmed.');
   await expect(panel.getByText('Verified opening amount · $10.25',{exact:true})).toBeVisible();
   await expect(panel.getByText('Latest review · Open from Feb 1, 2026',{exact:true})).toBeVisible();
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
   await capture('history',history.getByRole('heading'));
   await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
   await expect(history).toHaveCount(0);
   await page.goBack();
   await expect(page.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeVisible();
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
