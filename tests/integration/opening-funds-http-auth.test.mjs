// Genuine provider MFA, restricted application login and actual HTTP/PG commits.
// Candidate139 exists only inside the owned disposable fixture.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {normalizeOpeningFundsEvidence} from '../../src/bookkeeping/opening-funds-contract.ts';
const document=reference=>({reference,sha256:'a'.repeat(64)});

test('genuine owner privately saves and resolves candidate139 opening deposits without posting',{timeout:300000},async()=>{
 let fixture,browser;
 try{
  fixture=await sourceExportBrowserFixture({product:true,workspace:true,financeAccounts:true,financeMoneyChannels:true,openingWorksheet:true,openingFunds:true});
  const request=fixture.openingFundsRequest;
  const proof=await request('/api/auth/session',{});assert.equal(proof.status,200);
  const headers={'x-crest-csrf':proof.value.csrfToken};
  const context=await request('/api/business/finance-accounts/context',{}, {headers});assert.equal(context.status,200);
  assert.equal(context.headers['x-crest-opening-funds'],'1');const epoch=context.value.recoveryEpoch;assert(epoch);
  const bound={...headers,'x-crest-edit-binding':context.headers['x-crest-edit-binding']};
  const post=(route,body,options={})=>request('/api/business/finance-accounts/'+route,body,{headers:bound,...options});
  const customerId=randomUUID();
  const customer=await request('/api/business/customers/save',{schemaVersion:1,operationId:randomUUID(),customerId,expectedVersion:'0',recoveryEpoch:epoch,
   displayName:'Fictional opening deposit customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null},{headers});
  assert.equal(customer.status,200);assert.equal(customer.value.state,'committed');
  const projection=await post('opening-worksheet-read',{reviewEpoch:epoch,requestedOn:'2026-06-01'});assert.equal(projection.status,200);
  const unknown={state:'unknown',evidence:null,note:'Fictional opening control remains under review'};
  const draft={cutoverOn:'2026-06-01',cutoverAt:projection.value.cutoverAt,source:document('Fictional cutover evidence'),equityBasis:'Fictional net opening under review',
   banks:projection.value.banks.map(bank=>({channelId:bank.channelId,channelVersion:bank.channelVersion,state:'unknown',statementCents:null,bookCents:null,evidence:null,timing:[],note:'Fictional bank amount remains unknown'})),
   controls:Object.fromEntries(['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'].map(key=>[key,unknown]))};
  const worksheet=await post('opening-worksheet-save',{reference:{operationId:randomUUID(),recoveryEpoch:epoch},expectedRevision:'0',draft});
  assert.equal(worksheet.status,200);assert.equal(worksheet.value.state,'committed');const worksheetRevisionId=worksheet.value.receipt.worksheetRevisionId;
  const counts=async()=>(await fixture.client.query('SELECT (SELECT count(*)::text FROM crest.financial_events) AS events,(SELECT count(*)::text FROM crest.journal_entries) AS journals,(SELECT count(*)::text FROM crest.journal_lines) AS lines,(SELECT count(*)::text FROM crest.accounting_periods) AS periods')).rows[0];
  const before=await counts(),readBody={reviewEpoch:epoch,worksheetRevision:'1'};
  const anonymous=await post('opening-worksheet-funds-read',readBody,{anonymous:true,headers:bound});assert.equal(anonymous.status,400);assert(!('schedule'in anonymous.value));
  assert.equal((await post('opening-worksheet-funds-read',readBody,{headers:{...bound,'x-crest-edit-binding':'foreign'}})).status,400);
  assert.equal((await post('opening-worksheet-funds-read',{...readBody,businessId:randomUUID()})).status,400);
  const empty=await post('opening-worksheet-funds-read',readBody);assert.equal(empty.status,200);assert.equal(empty.value.schedule,null);
  const root={rootId:randomUUID(),sourceNamespace:'legacy.receipts',externalId:'fixture-deposit-001',receivedOn:'2026-05-01',receivedCents:'15000',receiptEvidence:document('Fictional original receipt'),
   reductions:[{kind:'application',reference:'earlier-job',occurredOn:'2026-05-20',amountCents:'5000',evidence:document('Fictional earlier application')}],
   items:[{itemId:randomUUID(),customerId,heldCents:'10000',obligationEvidence:document('Fictional remaining customer obligation'),refundableCeilingCents:null,refundEvidence:null}]};
  const reference={operationId:randomUUID(),recoveryEpoch:epoch},input={schemaVersion:1,roots:[root],reason:'Fictional documented customer deposit review'};
  const body={reference,worksheetRevisionId,cutoverOn:'2026-06-01',draft:{worksheetRevision:'1',expectedRevision:'0',input}};
  const saved=await post('opening-worksheet-funds-save',body);assert.equal(saved.status,200);assert.equal(saved.value.state,'committed');
  assert.match(saved.headers['cache-control'],/no-store/);assert.deepEqual(saved.value.receipt.evidence,normalizeOpeningFundsEvidence(input,'2026-06-01'));
  assert.deepEqual((await post('opening-worksheet-funds-save',body)).value,saved.value);
  const stale=await post('opening-worksheet-funds-save',{...body,reference:{...reference,operationId:randomUUID()}});assert.equal(stale.status,409);assert.equal(stale.value.error,'OPENING_FUNDS_REVISION_CONFLICT');
  const conflict=await post('opening-worksheet-funds-save',{...body,draft:{...body.draft,input:{...input,reason:'Different operation content'}}});assert.equal(conflict.status,409);assert.equal(conflict.value.state,'conflict');
  const current=await post('opening-worksheet-funds-read',readBody);assert.deepEqual(current.value.schedule,saved.value.receipt);
  const resolved=await post('opening-worksheet-funds-lookup',{reference,reviewEpoch:epoch});assert.deepEqual(resolved.value,saved.value);
  const absentReference={operationId:randomUUID(),recoveryEpoch:epoch};
  assert.deepEqual((await post('opening-worksheet-funds-lookup',{reference:absentReference,reviewEpoch:epoch})).value,{state:'absent'});
  assert.deepEqual((await post('opening-worksheet-funds-retire',{reference:absentReference,reviewEpoch:epoch,reason:'Reviewed absent fictional deposit save'})).value,{state:'retired'});
  assert.deepEqual((await post('opening-worksheet-funds-save',{...body,reference:absentReference})).value,{state:'retired'});
  const changed=structuredClone(body);changed.reference.operationId=randomUUID();changed.draft.expectedRevision='1';changed.draft.input.roots[0].items[0].refundableCeilingCents='0';changed.draft.input.roots[0].items[0].refundEvidence=document('Fictional documented zero refundable ceiling');
  const revised=await post('opening-worksheet-funds-save',changed);assert.equal(revised.status,200);assert.equal(revised.value.receipt.revision,'2');assert.equal(revised.value.receipt.evidence.totals.refundableCeilingCents,'0');
  assert.deepEqual((await post('opening-worksheet-funds-lookup',{reference,reviewEpoch:epoch})).value,saved.value);
  assert.deepEqual(await counts(),before);
  browser=await chromium.launch(process.env.CREST_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.CREST_TEST_BROWSER_EXECUTABLE}:{});
  const browserContext=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}}),page=await browserContext.newPage();page.setDefaultTimeout(20000);
  await page.goto(fixture.origin+'/sign-in');const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Signed in');
  await page.goto(fixture.origin+'/settings/accounts');await page.getByRole('button',{name:'Setup',exact:true}).click();await page.getByText('Opening worksheet',{exact:true}).click();
  await page.getByRole('region',{name:'Fictional opening worksheet'}).getByRole('button',{name:'Load opening worksheet'}).click();
  await page.getByText('Customer deposits held at cutover',{exact:true}).click();const deposits=page.getByRole('region',{name:'Opening customer deposits'});
  await deposits.getByRole('button',{name:'Load saved deposits',exact:true}).click();await expect(deposits.getByText('fixture-deposit-001',{exact:true})).toBeVisible();
  await deposits.getByRole('button',{name:'Edit deposit 1',exact:true}).click();
  await expect(deposits.getByLabel('Original receipt reference',{exact:true})).toHaveAttribute('readonly','');
  await deposits.getByLabel('Is the refundable amount documented?',{exact:true}).selectOption('unknown');
  await deposits.getByRole('button',{name:'Review this deposit',exact:true}).click();
  await deposits.getByLabel('What did you review or change?',{exact:true}).fill('Fictional phone review preserves original receipt and unknown refundability');
  await deposits.getByRole('button',{name:'Save deposit evidence',exact:true}).click();
  await expect(deposits.getByRole('status')).toContainText('Deposit schedule revision 3 saved');
  await expect(deposits.getByText('Refundability needs review',{exact:false})).toBeVisible();
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'opening deposit screen must fit the viewport');
   const axe=await new AxeBuilder({page}).include('section[aria-label="Opening customer deposits"]').analyze();assert.deepEqual(axe.violations.filter(item=>item.impact==='critical'||item.impact==='serious'),[]);
   const evidenceDirectory=process.env.CREST_TEST_EVIDENCE_DIRECTORY??'.local/review';await mkdir(evidenceDirectory,{recursive:true});
   await page.screenshot({path:join(evidenceDirectory,process.env.CREST_TEST_EVIDENCE_DIRECTORY?`deposits-${width}.png`:`finance-opening-deposits-chromium-${width}.png`),fullPage:true});
  }
  const afterPhone=await post('opening-worksheet-funds-read',readBody);assert.equal(afterPhone.value.schedule.revision,'3');assert.equal(afterPhone.value.schedule.evidence.totals.heldCents,'10000');assert.equal(afterPhone.value.schedule.evidence.totals.refundableCeilingCents,null);
  assert.deepEqual(await counts(),before);
  await browser.close();browser=undefined;
  assert.equal((await request('/api/auth/logout',{}, {headers})).status,200);
  const revoked=await post('opening-worksheet-funds-read',readBody);assert(revoked.status>=400);assert(!('schedule'in revoked.value));
 }finally{await browser?.close();await fixture?.close();}
});
