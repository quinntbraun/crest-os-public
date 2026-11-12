// Genuine Next/Node/MFA browser acceptance for the isolated completion candidate.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const dollars=cents=>(cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' genuine End Job editor and saved completion',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,reviewOutcome:true,reviewHistory:true,
  financeAccounts:true,invoicePreparation:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
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
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByLabel('What is happening?',{exact:true}).selectOption('direct_arrive');
  await page.getByLabel('Why was travel not recorded?',{exact:true}).fill('Synthetic arrival without travel.');
  await page.getByRole('button',{name:'Start work without recorded travel',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('link',{name:'Review and end job',exact:true}).click();
  await expect(page.getByRole('heading',{name:'End job',exact:true})).toBeVisible();
  await expect(status).toContainText('Review the assigned work');
  const loaded=await post('completion-context',{jobId});
  assert.equal(loaded.status,200);
  const rows=loaded.value.assignments;
  assert(rows.length>=2);

  await page.getByRole('button',{name:'Mark all items fulfilled',exact:true}).click();
  await page.getByLabel('Walkthrough outcome',{exact:true}).selectOption('done');
  const partial=name==='webkit';
  let split=null,firstGross=0n;
  if(partial){
   const index=rows.findIndex(row=>BigInt(row.grossInclusiveCents)>1n);
   assert(index>=0);
   const row=rows[index],gross=BigInt(row.grossInclusiveCents),discount=BigInt(row.discountInclusiveCents);
   firstGross=gross/2n;
   const firstDiscount=discount/2n;
   const group=page.getByRole('group',{name:'Assigned item '+(index+1),exact:true});
   await group.getByLabel('Outcome for item '+(index+1),{exact:true}).selectOption('split');
   split=group.getByRole('group',{name:'Portion 1',exact:true});
   const deferred=group.getByRole('group',{name:'Portion 2',exact:true});
   await split.getByLabel('Work in this portion',{exact:true}).fill('Synthetic interior surfaces fulfilled');
   await deferred.getByLabel('Work in this portion',{exact:true}).fill('Synthetic final pass deferred');
   await split.getByLabel('Gross amount in dollars',{exact:true}).fill(dollars(firstGross));
   await split.getByLabel('Discount in dollars',{exact:true}).fill(dollars(firstDiscount));
   await deferred.getByLabel('Gross amount in dollars',{exact:true}).fill(dollars(gross-firstGross));
   await deferred.getByLabel('Discount in dollars',{exact:true}).fill(dollars(discount-firstDiscount));
   await deferred.getByLabel('Reason for unfinished portion',{exact:true}).fill('Synthetic weather interruption.');
   await page.getByLabel('Walkthrough outcome',{exact:true}).selectOption('unavailable');
   await page.getByLabel('Why was the walkthrough unavailable?',{exact:true}).fill('Synthetic customer departed.');
  }
  await page.getByText('Completion note and review request',{exact:true}).click();
  await page.getByLabel('HTTPS review link',{exact:true}).fill('https://example.invalid/crest-review');

  async function capture(stage){
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/completion-'+stage+'-'+name+'-'+width+'.png',fullPage:true});
   }
  }
  await capture('editor');
  await page.setViewportSize({width:390,height:844});
  let submissions=0;
  await page.route('**/api/business/scheduling/complete',async route=>{
   submissions++;
   const response=await route.fetch();
   if(partial)await route.abort('failed');
   else await route.fulfill({response});
  });
  if(split){
   await split.getByLabel('Gross amount in dollars',{exact:true}).fill(dollars(firstGross+1n));
   await page.getByRole('button',{name:'End job',exact:true}).click();
   await expect(page.locator('form').getByRole('alert')).toContainText('Portion amounts must add up');
   assert.equal(submissions,0);
   await split.getByLabel('Gross amount in dollars',{exact:true}).fill(dollars(firstGross));
  }
  await page.getByRole('button',{name:'End job',exact:true}).click();
  if(partial){
   await expect(status).toContainText('The save outcome is unknown');
   const pending=await page.evaluate(()=>sessionStorage.getItem('crest.field-completion.pending-reference.v1'));
   assert(pending&&!pending.includes('Synthetic')&&!pending.includes('https:'));
   await page.getByRole('button',{name:'Check original completion',exact:true}).click();
  }
  await expect(status).toHaveText('Job completion saved.');
  const summary=page.getByRole('region',{name:'Saved completion',exact:true});
  await expect(summary.getByRole('heading',{name:partial?'Partial completion':'Full completion',exact:true})).toBeVisible();
  await expect(summary).toContainText('Invoice review · Open');
  await expect(summary).toContainText('Text draft · Prepared');
  const reviewDraft=summary.getByRole('textbox',{name:'Prepared review draft',exact:true});
  await expect(reviewDraft).toHaveValue(/https:\/\/example\.invalid\/crest-review/);
  const draftText=await reviewDraft.inputValue();
  const copyDraft=summary.getByRole('button',{name:'Copy review draft',exact:true});
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{
    throw new DOMException('Synthetic permission denial','NotAllowedError');
   }}});
  });
  await copyDraft.click();
  await expect(summary.getByRole('status')).toHaveText('Copy is unavailable. Select the draft text to copy it manually.');
  await expect(reviewDraft).toHaveValue(draftText);
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{
    document.body.dataset.syntheticCopiedDraft=text;
   }}});
  });
  await copyDraft.click();
  await expect(summary.getByRole('status')).toHaveText('Review draft copied.');
  await expect(summary).toContainText('Text draft · Prepared');
  assert.equal(await page.evaluate(()=>document.body.dataset.syntheticCopiedDraft),draftText);
  if(partial){
   await expect(summary).toContainText('Synthetic final pass deferred');
   await expect(summary).toContainText('Commercial resolution · Open');
  }
  assert.equal(submissions,1);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('crest.field-completion.pending-reference.v1')),null);
  await page.reload();
  await expect(status).toHaveText('Saved completion loaded.');
  await expect(reviewDraft).toHaveValue(draftText);
  await expect(summary).toContainText('Text draft · Prepared');
  await capture('saved');
  await page.setViewportSize({width:390,height:844});
  let outcomeSubmissions=0;
  await page.route('**/api/business/scheduling/review-outcome-save',async route=>{
   outcomeSubmissions++;
   const response=await route.fetch();
   if(partial&&outcomeSubmissions===1)await route.abort('failed');
   else await route.fulfill({response});
  });
  await summary.getByText('Record message outcome',{exact:true}).click();
  await summary.getByLabel('Message outcome',{exact:true}).selectOption('failed');
  const saveOutcome=summary.getByRole('button',{name:'Save message outcome',exact:true});
  await expect(saveOutcome).toBeDisabled();
  await summary.getByLabel('Reason',{exact:true}).fill('Synthetic messaging app unavailable');
  await saveOutcome.click();
  const pendingKey='crest.review-message-outcome.pending-reference.v1';
  if(partial){
   await expect(status).toContainText('The save outcome is unknown');
   const pending=await page.evaluate(key=>sessionStorage.getItem(key),pendingKey);
   assert(pending&&!pending.includes('Synthetic')&&!pending.includes('https:'));
   await expect(page.getByRole('link',{name:'Open Save review',exact:true})).toHaveAttribute('href','/save-review?kind=operations.message.record_outcome');
   await page.goto(fixture.origin+'/schedule/work/complete?job='+randomUUID());
   await expect(status).toContainText('different saved job');
   await expect(summary).toHaveCount(0);
   assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),pending);
   await page.goto(fixture.origin+end);
  }
  await expect(status).toHaveText('Review message outcome saved.');
  await expect(summary).toContainText('Text draft · Failed');
  await expect(summary).toContainText('Synthetic messaging app unavailable');
  await expect(reviewDraft).toHaveValue(draftText);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),pendingKey),null);
  assert.equal(outcomeSubmissions,1);
  await summary.getByText('Record message outcome',{exact:true}).click();
  await summary.getByLabel('Message outcome',{exact:true}).selectOption('owner_confirmed_sent');
  await saveOutcome.click();
  await expect(status).toHaveText('Review message outcome saved.');
  await expect(summary).toContainText('Text draft · Owner-confirmed Sent');
  await expect(copyDraft).toHaveCount(0);
  await expect(summary.getByText('Record message outcome',{exact:true})).toHaveCount(0);
  assert.equal(outcomeSubmissions,2);
  await page.reload();
  await expect(status).toHaveText('Saved completion loaded.');
  await expect(summary).toContainText('Text draft · Owner-confirmed Sent');
  await expect(reviewDraft).toHaveValue(draftText);
  await capture('outcome');
  const historyDisclosure=summary.locator('details').filter({has:page.getByText('Review message history',{exact:true})});
  const historyButton=historyDisclosure.locator('summary');
  await expect(historyDisclosure.getByRole('listitem')).toHaveCount(0);
  let historyReads=0;
  await page.route('**/api/business/scheduling/review-history',async route=>{
   historyReads++;
   if(historyReads===1)await route.abort('failed');
   else await route.continue();
  });
  await historyButton.focus();
  await historyButton.press('Enter');
  await expect(historyDisclosure.getByRole('alert')).toHaveText('Couldn’t load saved message history.');
  assert.equal(historyReads,1);
  await historyDisclosure.getByRole('button',{name:'Retry history',exact:true}).click();
  const historyRows=historyDisclosure.getByRole('listitem');
  await expect(historyRows).toHaveCount(3);
  await expect(historyRows.nth(0)).toContainText('Owner-confirmed sent');
  await expect(historyRows.nth(1)).toContainText('Synthetic messaging app unavailable');
  await expect(historyRows.nth(2)).toContainText('Prepared');
  await expect(historyDisclosure).not.toContainText('https://example.invalid/crest-review');
  assert.equal(historyReads,2);
  await capture('history');
  await historyButton.click();
  await expect(historyDisclosure.locator('li')).toHaveCount(0);
  await page.unroute('**/api/business/scheduling/review-history');
  const customer=(await fixture.client.query(
   'SELECT c.id,c.display_name FROM crest.customers c JOIN crest.jobs j ON j.business_id=c.business_id AND j.customer_id=c.id WHERE j.id=$1 AND j.business_id=$2',
   [jobId,fixture.business])).rows[0];
  assert(customer);
  const foreignHistory=await post('review-history',{scopeKind:'customer',scopeId:randomUUID(),cursorSource:null,cursorId:null});
  assert.equal(foreignHistory.status,200);
  assert.deepEqual(foreignHistory.value.entries,[]);
  const invalidCursor=await post('review-history',{scopeKind:'customer',scopeId:customer.id,cursorSource:null,cursorId:randomUUID()});
  assert.equal(invalidCursor.status,400);
  await page.goto(fixture.origin+'/customers');
  await page.getByRole('button',{name:customer.display_name,exact:true}).click();
  const customerHistory=page.locator('details').filter({has:page.getByText('Review message history',{exact:true})});
  await customerHistory.locator('summary').click();
  await expect(customerHistory.getByRole('listitem')).toHaveCount(3);
  await expect(customerHistory.getByRole('listitem').nth(1)).toContainText('Synthetic messaging app unavailable');
  const jobLink=customerHistory.getByRole('link',{name:'Open job completion',exact:true}).first();
  await expect(jobLink).toHaveAttribute('href',end);
  await jobLink.click();
  await expect(status).toHaveText('Saved completion loaded.');
  await expect(summary.locator('details[open]').filter({has:page.getByText('Review message history',{exact:true})})).toHaveCount(0);
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  const scheduleStatus=page.getByRole('region',{name:'Saved schedule',exact:true}).getByRole('status').first();
  const requestOutcomes=[];
  const scheduleResponse=response=>{
   const path=new URL(response.url()).pathname;
   if(path.startsWith('/api/business/scheduling/')||path==='/api/auth/session')requestOutcomes.push([path,response.status()]);
  };
  page.on('response',scheduleResponse);
  try{
   const savedCompletion=page.getByRole('link',{name:'Review saved completion',exact:true});
   await expect(savedCompletion, 'Schedule should reopen the completed job').toBeVisible({timeout:10000});
   await savedCompletion.click();
  }catch(error){
   assert(error instanceof Error);
   error.message+='\nSchedule status '+(await scheduleStatus.textContent())+' '+JSON.stringify(requestOutcomes.slice(-12));
   throw error;
  }finally{page.off('response',scheduleResponse);}
  await expect(status).toHaveText('Saved completion loaded.');
  const preparation=page.getByRole('region',{name:'Invoice preparation',exact:true});
  const load=preparation.getByRole('button',{name:'Load completed work',exact:true});
  const prepStatus=preparation.getByRole('status');
  await page.route('**/api/business/finance-accounts/invoice-preparation',route=>route.abort(),{times:1});
  await load.click();
  await expect(prepStatus).toHaveText('Crest could not verify the completed work. Try again.');
  await expect(preparation.getByRole('listitem')).toHaveCount(0);
  await load.focus();
  await page.keyboard.press('Enter');
  await expect(prepStatus).toHaveText('Completed work loaded.');
  await expect(preparation.getByRole('listitem')).toHaveCount(2);
  await expect(preparation).toContainText('$0.00 agreed for this portion');
  if(partial){
   await expect(preparation).toContainText('Synthetic interior surfaces fulfilled');
   await expect(preparation).not.toContainText('Synthetic final pass deferred');
  }
  const downloading=page.waitForEvent('download');
  await preparation.getByRole('button',{name:'Download completed work (CSV)',exact:true}).click();
  const downloaded=await downloading;
  assert.equal(downloaded.suggestedFilename(),'crest-completed-work.csv');
  const csv=await readFile(await downloaded.path(),'utf8');
  assert.match(csv,/"grossInclusiveCents","discountInclusiveCents","inclusiveCents"/);
  assert(!csv.includes('Synthetic final pass deferred'));
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await preparation.getByRole('list',{name:'Completed portions',exact:true}).evaluate(element=>
    element.scrollIntoView({block:'center'}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await page.screenshot({path:'.local/review/completion-invoice-preparation-'+name+'-'+width+'.png'});
  }
  await page.reload();
  await expect(preparation.getByRole('listitem')).toHaveCount(0);
  await load.click();
  await expect(prepStatus).toHaveText('Completed work loaded.');
 }finally{
  await browser?.close();
  await fixture.close();
 }
});
