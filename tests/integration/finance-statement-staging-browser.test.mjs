import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import {chromium,expect,webkit} from '@playwright/test';
import {strFromU8,unzipSync} from 'fflate';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {verifyFinanceSourceExport} from '../../src/tooling/verify-finance-source-export.ts';

const route='/api/business/finance-accounts/statement-staging-';
const matching=process.env.CREST_TEST_STATEMENT_MATCH_REVIEW==='1';
for(const engine of [chromium,webkit]){
 test(engine.name()+' genuine owner stages a fictional statement and recovers an interrupted save',{timeout:300000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL,cluster=previous?null:await recoveryCluster();
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMoneyChannels:true,
    postedFinanceExport:true,statementStaging:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900}});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   const anonymous=await page.request.post(fixture.origin+route+'lookup',{data:{reference:null}});
   assert.equal(anonymous.status(),400);
   assert.match(anonymous.headers()['cache-control'],/no-store/);
   assert.deepEqual(await anonymous.json(),{error:'FINANCE_ACCOUNT_REQUEST_FAILED'});
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('status')).toContainText('Signed in');

   async function load(){
    await page.goto(fixture.origin+'/settings/accounts');
    await page.getByRole('button',{name:'Load accounts',exact:true}).click();
    return page.getByRole('region',{name:'Fictional bank statement staging'});
   }
   const form=await load();
   const channel=form.getByLabel('Dedicated money account');
   await expect(channel.getByRole('option',{name:'Fictional checking (1234)'})).toHaveCount(1);
   await channel.selectOption({label:'Fictional checking (1234)'});
   const file=Buffer.from('fictional-provider-statement-bytes');
   await form.getByLabel('Fictional source file for checksum').setInputFiles({name:'fictional-statement.txt',mimeType:'text/plain',buffer:file});
   await form.getByLabel('Statement start date').fill('2026-01-01');
   await form.getByLabel('Statement end date').fill('2026-01-31');
   await form.getByLabel('Opening balance (USD)',{exact:true}).fill('12.00');
   await form.getByLabel('Closing balance (USD)',{exact:true}).fill('14.00');
   await form.getByLabel('Provider statement date convention').fill('Fictional bank posting date');
   await form.getByLabel('Completeness review').fill('Fictional full-period statement reviewed');
   await form.getByLabel('Statement rows',{exact:true}).fill('2026-02-01, 3.25\n2026-01-04, -0.75');
   await form.getByRole('button',{name:'Review statement'}).click();
   await expect(form.getByRole('status')).toContainText('Check the statement dates');
   await form.getByLabel('Statement rows',{exact:true}).fill('2026-01-01, 3.25\n2026-01-04, -0.75');
   await form.getByRole('button',{name:'Review statement'}).click();
   await expect(form.getByText('Statement difference −$0.50.',{exact:false})).toBeVisible();
   const hash=createHash('sha256').update(file).digest('hex');
   await expect(form.getByText(hash,{exact:true})).toBeVisible();
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await form.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
    await page.screenshot({path:`.local/review/finance-statement-staging-${engine.name()}-${width}.png`});
   }
   let recorded;
   await page.route('**'+route+'save',async request=>{
    const data=request.request().postDataJSON();
    assert.equal(data.draft.fileSha256,hash);
    assert(!JSON.stringify(data).includes(file.toString()));
    const response=await request.fetch();
    recorded=response.status();
    assert.match(response.headers()['cache-control'],/no-store/);
    await request.abort();
   },{times:1});
   await form.getByRole('button',{name:'Stage reviewed statement'}).click();
   await expect(form.getByRole('status')).toContainText('The save could not be confirmed');
   assert.equal(recorded,200);
   const key='crest.statement-stage.original.v1.'+fixture.business;
   const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
   assert.deepEqual(Object.keys(saved).sort(),['operationId','recoveryEpoch','statementId']);
   const reopened=await load();
   await reopened.getByRole('button',{name:'Check original save'}).click();
   await expect(reopened.getByRole('status')).toContainText('Statement staged. 2 rows retained with a statement difference of −$0.50.');
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),null);
   const reference=[saved.operationId,saved.recoveryEpoch,saved.statementId].join('.');
   await expect(reopened.getByText(reference,{exact:true})).toBeVisible();
   await page.reload();
   await page.getByRole('button',{name:'Load accounts',exact:true}).click();
   await reopened.getByText('Check a saved statement',{exact:true}).click();
   await reopened.getByLabel('Statement save reference',{exact:true}).fill(reference);
   await reopened.getByRole('button',{name:'Check saved statement'}).click();
   await expect(reopened.getByRole('status')).toContainText('Statement staged. 2 rows retained');
   if(matching){
    await reopened.getByText('Review statement matches',{exact:true}).click();
    const matchReview=reopened.getByRole('region',{name:'Statement match review',exact:true});
    await matchReview.getByRole('button',{name:'Load posted movements',exact:true}).click();
    await expect(matchReview.getByRole('status')).toHaveText('There are no posted movements in this search window.');
    await expect(matchReview.getByText('2 statement rows need matching.',{exact:true})).toBeVisible();
    await expect(matchReview.getByText('Resolve the −$0.50 statement difference',{exact:false})).toBeVisible();
    for(const width of [360,390,768,1440]){
     await page.setViewportSize({width,height:900});
     await matchReview.scrollIntoViewIfNeeded();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
     assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
     await page.screenshot({path:`.local/review/finance-statement-matching-${engine.name()}-${width}.png`});
    }
   }
   assert.equal((await fixture.client.query('SELECT count(*)::int n FROM crest.journal_entries WHERE business_id=$1',[fixture.business])).rows[0].n,0);

   await page.goto(fixture.origin+'/export-files');
   await page.getByRole('button',{name:'Prepare posted finance CSV',exact:true}).click();
   const downloadPromise=page.waitForEvent('download');
   await page.getByRole('button',{name:'Save ZIP',exact:true}).click();
   const download=await downloadPromise;
   const {['manifest.json']:manifest,['export_delivery.json']:delivery,...source}=unzipSync(await readFile(await download.path()));
   const verified=verifyFinanceSourceExport(strFromU8(manifest),Object.entries(source).map(([name,bytes])=>({name,content:strFromU8(bytes)})),fixture.business);
   assert.equal(verified.profile,matching?'crest.posted-finance-source.v20':'crest.posted-finance-source.v19');
   assert.equal(JSON.parse(strFromU8(delivery)).sourceSchemaVersion,matching?106:103);
   const [statement]=JSON.parse(strFromU8(source['statement_staging_source.json'])).batches;
   assert.deepEqual([statement.id,statement.operationId,statement.fileSha256,statement.statementDifferenceCents],
    [saved.statementId,saved.operationId,hash,'-50']);
   assert(!JSON.stringify(statement).includes(file.toString()));
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
