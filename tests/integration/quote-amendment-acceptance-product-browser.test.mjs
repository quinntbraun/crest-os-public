// Genuine registered53/MFA/Next journey. Fictional data and owned services only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {unzipSync,strFromU8} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';
import {pendingQuoteAmendmentKeys} from '../../src/client/pending-quote-amendment.ts';

async function command(page,label,path,message){
 let committed=false;
 const response=page.waitForResponse(r=>{if(new URL(r.url()).pathname===path&&r.request().method()==='POST'){committed=true;return true;}return false;});
 const read=page.waitForResponse(r=>committed&&new URL(r.url()).pathname==='/api/business/quotes/amendments/read'&&r.request().method()==='POST');
 await page.getByRole('button',{name:label,exact:true}).click();
 const saved=await response;assert.equal(saved.status(),200);const result=await saved.json();assert.equal(result.state,'committed');
 const current=await read;assert.equal(current.status(),200);await current.finished();
 if(message)await expect(page.getByRole('status')).toContainText(message);
 return result.receipt;
}
async function reviewAndShare(page){
 await command(page,'Request review of saved amendment','/api/business/quotes/review/submit','Amendment review requested and reloaded.');
 await command(page,'Approve this exact amendment','/api/business/quotes/review/approve','Amendment approval recorded and reloaded.');
 await page.getByText('Record actual sharing',{exact:true}).click();
 const form=page.getByRole('form',{name:'Actual amendment sharing',exact:true});
 await form.getByLabel('Actual sharing channel',{exact:true}).selectOption('in_person');
 await form.getByRole('checkbox',{name:'I actually shared this exact approved amendment with this recipient.',exact:true}).check();
 await command(page,'Record actual amendment sharing','/api/business/quotes/amendments/send','Actual amendment sharing recorded and reloaded.');
}
async function confirm(page){
 let scopeLoaded=false;
 const loaded=page.waitForResponse(response=>{const path=new URL(response.url()).pathname;if(path==='/api/business/quotes/amendments/acceptance-scope'){scopeLoaded=true;return false;}return scopeLoaded&&path==='/api/business/quotes/context'&&response.request().method()==='POST';});
 const prepare=page.getByRole('button',{name:'Review remaining work for acceptance',exact:true});await prepare.focus();await page.keyboard.press('Enter');
 const current=await loaded;assert.equal(current.status(),200);await current.finished();
 await expect(page.getByRole('form',{name:'Customer amendment confirmation',exact:true})).toBeVisible();
 await expect(page.getByText('Save your edits before requesting review, approval or sharing. The comparison above still shows the saved proposal.',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Use one unassigned portion per line',exact:true}).click();
 const form=page.getByRole('form',{name:'Customer amendment confirmation',exact:true});
 await form.getByLabel('Confirmation channel',{exact:true}).selectOption('in_person');
 await form.getByLabel('Confirmed by',{exact:true}).fill('Synthetic customer confirming revised work');
 await form.getByRole('button',{name:'Use current time',exact:true}).click();
 await form.getByLabel('Acceptance evidence',{exact:true}).fill('Synthetic customer separately confirmed the exact sent proposal and all remaining work. No financial posting is inferred.');
 await form.getByRole('checkbox',{name:'The customer separately confirmed this exact sent amendment, and I reviewed its remaining work portions.',exact:true}).check();
 await expect(form.getByRole('button',{name:'Record customer amendment acceptance',exact:true})).toBeEnabled();
}
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' genuine53 amendment acceptance, bound visit, cancellation recovery and reopened Draft',{timeout:600000},async t=>{
 const phase=step=>console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' '+step);
 const bounded=async(label,run)=>{phase(label+'_started');let timer;try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SYNTHETIC_BROWSER_STEP_TIMEOUT_'+label)),20000);})]);}finally{clearTimeout(timer);phase(label+'_finished');}};
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true});let browser,page;
 t.signal.addEventListener('abort',()=>{void browser?.close().catch(()=>{});},{once:true});
 try{
  assert.equal((await f.client.query('SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations')).rows[0].n,53);
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:900},timezoneId:'America/Indianapolis',reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(30000);
  let next=0,limited=0,accepts=0;const errors=[];
  // Human reading pace, not retries or a changed server admission window.
  await page.route('**/api/**',async route=>{const now=Date.now(),wait=Math.max(0,next-now);next=Math.max(next,now)+650;if(wait)await new Promise(resolve=>setTimeout(resolve,wait));await route.continue();});
  page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.status()===429)limited++;});
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/business/quotes/amendments/accept')accepts++;});
  page.on('pageerror',error=>errors.push(error.name));
  await page.goto(f.origin+'/sign-in');const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' signed_in');const cookie=(await context.cookies()).find(c=>c.name==='__Host-crest_session');assert(cookie?.httpOnly&&cookie.secure);
  const original=(await f.client.query('SELECT to_jsonb(g)::text AS row FROM crest.agreements g WHERE business_id=$1 ORDER BY id',[f.business])).rows;
  const status=()=>page.getByRole('status');
  async function selectCurrent(){
   const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/quotes/amendments/targets'&&r.request().method()==='POST');await page.goto(f.origin+'/quotes/amendments');assert.equal((await loaded).status(),200);await expect(status()).toHaveText('Saved accepted quotes loaded.');
   const button=page.getByRole('button',{name:/Accepted agreement|Amendment Accepted|Amendment Draft/}).first(),amended=/Amendment (?:Accepted|Draft)/.test(await button.innerText());
   const selected=page.waitForResponse(r=>new URL(r.url()).pathname===(amended?'/api/business/quotes/amendments/read':'/api/business/quotes/amendments/targets')&&r.request().method()==='POST');await button.click();const current=await selected;assert.equal(current.status(),200);await bounded('selected_read_body',()=>current.finished());await expect(status()).toContainText('Saved accepted work loaded.');
  }
  async function capture(stage,focus){
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await bounded('resize_'+width,()=>page.setViewportSize({width,height:900}));await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await focus.scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow at '+width);
    assert(await page.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.getClientRects().length&&e.type!=='checkbox'&&e.type!=='radio').every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)),'readable phone form text');
    assert(await page.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)),'reachable touch controls');
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
    const primary=page.getByRole('button',{name:stage==='confirmation'?'Record customer amendment acceptance':stage==='accepted'?'Load accepted work':'Save new amendment Draft',exact:true});await primary.focus();await expect(primary).toBeFocused();
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'.local/review/amendment-acceptance-'+name+'-'+stage+'-'+width+'.png',fullPage:true});await focus.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'.local/review/amendment-acceptance-'+name+'-'+stage+'-'+width+'-viewport.png',fullPage:false});
   }
   await bounded('restore_phone_width',()=>page.setViewportSize({width:390,height:900}));
  }
  await selectCurrent();await page.getByText('Accepted scope and terms',{exact:true}).click();
  await command(page,'Prepare amendment Draft from accepted terms','/api/business/quotes/amendments/create','Amendment Draft saved and reloaded.');
  await page.getByText('Edit proposed work and pricing',{exact:true}).click();const editor=page.getByRole('form',{name:'Amendment draft',exact:true});
  await editor.getByLabel('Amendment title',{exact:true}).fill('Synthetic revised detailing package with a deliberately long description for clear phone review');
  await editor.getByLabel('All-in amount (USD)',{exact:true}).first().fill('285.25');
  await command(page,'Save amendment changes','/api/business/quotes/save','saved');
  await reviewAndShare(page);
  await page.getByText('Recorded sharing',{exact:true}).click();await expect(page.getByText(/recording amendment acceptance is not available/)).toHaveCount(0);
  console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' prepared_acceptance');await confirm(page);await capture('confirmation',page.getByRole('form',{name:'Customer amendment confirmation',exact:true}));
  const accepted=await command(page,'Record customer amendment acceptance','/api/business/quotes/amendments/accept','Customer acceptance saved and reloaded.');
  assert.equal(accepted.agreementVersion,'2');console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' accepted');await expect(page.getByText('This amendment refers to an earlier accepted agreement. Review the current accepted terms before preparing further changes.',{exact:true})).toHaveCount(0);await page.getByText('Review accepted changes',{exact:true}).click();await expect(page.getByRole('heading',{name:'Accepted change to work',exact:true})).toBeVisible();await page.getByText('Review accepted changes',{exact:true}).click();assert.equal(accepts,1);assert.deepEqual((await f.client.query('SELECT to_jsonb(g)::text AS row FROM crest.agreements g WHERE business_id=$1 AND version_no=1 ORDER BY id',[f.business])).rows,original);
  await expect(page.getByRole('heading',{name:'Customer acceptance recorded',exact:true})).toBeVisible();await capture('accepted',page.getByRole('heading',{name:'Customer acceptance recorded',exact:true}));phase('captured_accepted');
  await selectCurrent();phase('reloaded_accepted');await expect(page.getByRole('heading',{name:'Customer acceptance recorded',exact:true})).toBeVisible();assert.equal(accepts,1);
  let settingsReads=0;const home=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/settings'&&r.request().method()==='POST'&&++settingsReads===2);phase('going_home');await page.goto(f.origin+'/');const verified=await home;phase('home_response');assert.equal(verified.status(),200);await bounded('home_read_body',()=>verified.finished());await expect(page.getByRole('status')).toHaveText('Workspace access verified.');
  // Back may restore the intentionally cleared BFCache page. It must not
  // restore private selected terms or silently replay a mutation.
  phase('going_back');await bounded('back_navigation',()=>page.goBack());phase('back_returned');await expect(page.getByRole('heading',{name:'Quote amendments',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Selected accepted work',exact:true})).toHaveCount(0);assert.equal(accepts,1);
  const back=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/quotes/amendments/targets'&&r.request().method()==='POST');await page.getByRole('button',{name:'Load accepted work',exact:true}).click();assert.equal((await back).status(),200);await expect(status()).toHaveText('Saved accepted quotes loaded.');const reopenedRead=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/quotes/amendments/read');await page.getByRole('button',{name:/Accepted agreement 2/}).click();assert.equal((await reopenedRead).status(),200);await expect(page.getByRole('heading',{name:'Customer acceptance recorded',exact:true})).toBeVisible();assert.equal(accepts,1);
  await page.getByText('Download a private saved record',{exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved amendment record',exact:true}).click();const file=await download;phase('download_started');const filePath=await bounded('private_record_download',()=>file.path());const archive=unzipSync(await readFile(filePath)),record=JSON.parse(strFromU8(archive['amendment_original.json']));assert.equal(record.profile,'crest.amendment-record.v2');assert.equal(record.acceptedCommandAndReceiptIncluded,true);assert(Object.keys(archive).some(n=>n.endsWith('.csv')));assert.equal(record.completeBackup,false);console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' retrieved_record');

  // The same genuine app must book the newly accepted current scope, then
  // separately cancel that visit before commercial cancellation is allowed.
  await page.goto(f.origin+'/schedule/new?agreement='+f.bookingFamilyId);await expect(page.getByRole('form',{name:'Confirmed visit booking',exact:true})).toBeVisible();
  const day=new Date(Date.now()+86400000).toISOString().slice(0,10);
  await page.getByLabel('Work location details',{exact:true}).fill('Synthetic Crest workshop — 123 Example Lane, Indianapolis');await page.getByLabel('Time zone',{exact:true}).fill('UTC');await page.getByLabel('Visit starts',{exact:true}).fill(day+'T10:00');await page.getByLabel('Visit ends',{exact:true}).fill(day+'T11:00');
  await page.getByText('Travel around this visit',{exact:true}).click();await page.getByLabel('Travel before (minutes)',{exact:true}).fill('0');await page.getByLabel('Travel after (minutes)',{exact:true}).fill('0');await page.getByLabel('Contact method',{exact:true}).selectOption('no_contact');await page.getByLabel('Reason no contact is selected',{exact:true}).fill('Synthetic visit arranged in person.');await page.getByLabel('Visit confirmation channel',{exact:true}).selectOption('in_person');await page.getByLabel('When the customer confirmed this visit',{exact:true}).fill(new Date(Date.now()-1000).toISOString().slice(0,16));await page.getByLabel('Visit confirmation evidence',{exact:true}).fill('Synthetic customer confirmed this exact work and visit window.');
  await page.getByRole('button',{name:/^Review schedule(?: again)?$/,exact:true}).click();await expect(page.getByRole('region',{name:'Schedule conflict review',exact:true})).toContainText('Current schedule review loaded.');
  const allocationReasons=page.getByLabel('Reason for this scope allocation',{exact:true});assert.equal(await allocationReasons.count(),2);for(const field of await allocationReasons.all()){await field.fill('Synthetic current accepted work assigned to this separately confirmed visit.');await expect(allocationReasons).toHaveCount(2);}console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' stable_allocation_labels');
  const booking=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/scheduling/book');await page.getByRole('button',{name:'Confirm and save job',exact:true}).click();const booked=await booking;assert.equal(booked.status(),200);const visit=await booked.json();assert.equal(visit.receipt.schemaVersion,2);assert.equal(visit.state,'committed');console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' booked_current_scope');
  const jobHistory=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/scheduling/history'&&r.request().method()==='POST');await page.getByRole('link',{name:'Open saved job in Schedule',exact:true}).click();const loadedHistory=await jobHistory;assert.equal(loadedHistory.status(),200);await bounded('saved_job_history_body',()=>loadedHistory.finished());await expect(page.getByRole('heading',{name:'Synthetic lifecycle customer',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel this job…',exact:true}).click();await page.getByLabel('Cancellation reason',{exact:true}).fill('Synthetic customer separately cancelled this visit before work.');await page.getByLabel('Customer-communication status',{exact:true}).selectOption('not_sent');
  const cancellation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/scheduling/cancel');await page.getByRole('button',{name:'Cancel this scheduled job',exact:true}).click();const cancelled=await cancellation;assert.equal(cancelled.status(),200);assert.equal((await cancelled.json()).state,'committed');await expect(page.locator('.job-change-status')).toContainText('Job cancellation saved.');console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' cancelled_visit');
  assert.equal((await f.client.query('SELECT state FROM crest.jobs WHERE business_id=$1 AND id=$2',[f.business,visit.receipt.jobId])).rows[0].state,'cancelled');assert.equal((await f.client.query('SELECT count(*)::int AS n FROM crest.schedule_reservations WHERE business_id=$1',[f.business])).rows[0].n,0);
  await selectCurrent();await page.getByRole('button',{name:'Prepare cancellation proposal',exact:true}).click();await page.getByLabel('Reason the customer will see',{exact:true}).fill('Synthetic customer separately cancels all remaining commercial work. The visit cancellation is already recorded; no refund or fee is inferred.');
  await command(page,'Save cancellation proposal','/api/business/quotes/amendments/create','saved');await reviewAndShare(page);await confirm(page);
  await page.route('**/api/business/quotes/amendments/accept',async route=>{const response=await route.fetch({maxRetries:0,maxRedirects:0});assert.equal(response.status(),200);assert.equal((await response.json()).state,'committed');await route.abort('failed');});
  const lost=page.waitForEvent('requestfailed',r=>new URL(r.url()).pathname==='/api/business/quotes/amendments/accept');await page.getByRole('button',{name:'Record customer amendment acceptance',exact:true}).click();await lost;console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' lost_cancel_ack');await expect(status()).toContainText('uncertain');assert.equal(accepts,2);
  const key=pendingQuoteAmendmentKeys['quote.amendment.accept'],pending=await page.evaluate(k=>sessionStorage.getItem(k),key);assert(pending);assert.equal(Object.keys(JSON.parse(pending).reference).length,13);assert(!/Synthetic|scopePlans|counterparty|evidenceNote|Hash/.test(pending));
  await page.unroute('**/api/business/quotes/amendments/accept');await page.reload();await expect(status()).toContainText('unresolved original reference');await page.getByRole('button',{name:'Check original quote result',exact:true}).click();await expect(status()).toHaveText('The original quote save is confirmed. Reload accepted work.');assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),null);assert.equal(accepts,2);
  await selectCurrent();console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' reconciled_cancel');await expect(page.getByRole('heading',{name:'Customer acceptance recorded',exact:true})).toBeVisible();assert.equal((await f.client.query('SELECT max(version_no)::text AS version FROM crest.agreements WHERE business_id=$1',[f.business])).rows[0].version,'3');assert.equal((await f.client.query('SELECT count(*)::int AS n FROM crest.current_scope_allocation_parts WHERE business_id=$1',[f.business])).rows[0].n,0);
  await page.getByRole('button',{name:'Propose new work after cancellation',exact:true}).click();const reopened=page.getByRole('form',{name:'Amendment draft',exact:true});await expect(reopened.getByLabel('All-in amount (USD)',{exact:true})).toHaveCount(0);
  await reopened.getByRole('button',{name:'Add proposed line',exact:true}).click();await reopened.getByLabel('Scope',{exact:true}).selectOption('job-wide');await reopened.getByLabel('Work description',{exact:true}).fill('Synthetic separately requested final inspection');await reopened.getByLabel('All-in amount (USD)',{exact:true}).fill('35.50');
  await reopened.getByRole('button',{name:'Add proposed line',exact:true}).click();const complimentary=reopened.getByRole('group',{name:'Proposed line 2',exact:true});await complimentary.getByLabel('Scope',{exact:true}).selectOption('job-wide');await complimentary.getByLabel('Work description',{exact:true}).fill('Synthetic courtesy review');await complimentary.getByLabel('All-in amount (USD)',{exact:true}).fill('0');await expect(reopened.getByRole('button',{name:'Save new amendment Draft',exact:true})).toBeDisabled();await complimentary.getByLabel('Complimentary-work reason',{exact:true}).fill('Synthetic explicitly offered courtesy inspection.');await expect(reopened.getByRole('group',{name:'Proposed line 1',exact:true}).getByLabel('Complimentary-work reason',{exact:true})).toHaveValue('');
  await capture('reopening',reopened);console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' prepared_reopening');await command(page,'Save new amendment Draft','/api/business/quotes/amendments/create','saved');await selectCurrent();await page.getByText('Edit proposed work and pricing',{exact:true}).click();await expect(page.getByLabel('All-in amount (USD)',{exact:true}).first()).toHaveValue('35.50');await expect(page.getByLabel('All-in amount (USD)',{exact:true}).last()).toHaveValue('0.00');await expect(page.getByRole('form',{name:'Amendment draft',exact:true}).getByRole('group',{name:'Proposed line 2',exact:true}).getByLabel('Complimentary-work reason',{exact:true})).toHaveValue('Synthetic explicitly offered courtesy inspection.');assert.equal(accepts,2);assert.deepEqual(errors,[]);assert.equal(limited,0);console.log('SYNTHETIC_AMENDMENT_BROWSER_PHASE '+name+' complete');
 }catch(error){console.log('SYNTHETIC_AMENDMENT_BROWSER_FAILURE '+JSON.stringify({engine:name,events:f.authDiagnostics(),kind:error?.message?.startsWith('SYNTHETIC_BROWSER_STEP_TIMEOUT_')?error.message:error.name}));if(page)await page.screenshot({path:'.local/amendment-acceptance-'+name+'-failure.png',fullPage:true}).catch(()=>{});throw error;}
 finally{try{await browser?.close();}finally{await f.close();}}
});
