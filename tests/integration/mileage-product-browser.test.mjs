// Actual Next controls with registered mileage and genuine MFA.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {strFromU8,unzipSync} from 'fflate';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

function departureLocalTime(milliseconds){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Indiana/Indianapolis',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(milliseconds);
 const at=Object.fromEntries(parts.map(({type,value})=>[type,value]));
 return at.year+'-'+at.month+'-'+at.day+'T'+at.hour+':'+at.minute+':'+at.second;
}

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' corrects a Mobile departure and recovers the original without rewriting mileage',{timeout:300000},async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,jobMileage:true,
  workTime:true,workBoundary:true,workStart:true,workEnd:true,mobileDeparture:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844}});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const jobId=fixture.bookingRequest.jobId,job='/schedule?job='+jobId;
  const status=page.locator('.job-change-status');
  await page.goto(fixture.origin+'/sign-in');
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(async input=>{
   const init={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
   const {csrfToken}=await (await fetch('/api/auth/session',init)).json();
   const body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId'));
   return (await fetch('/api/business/scheduling/book',{...init,headers:{...init.headers,'x-crest-csrf':csrfToken},body:JSON.stringify(body)})).status;
  },fixture.bookingRequest),200);
  await page.goto(fixture.origin+job);
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByLabel('Vehicle you are driving',{exact:true}).selectOption(fixture.fieldVehicleId);
  await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic equipment base');
  await page.getByRole('button',{name:'Record departure',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByRole('button',{name:'Record arrival and start work',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('link',{name:'Review trip mileage',exact:true}).click();
  await page.getByRole('button',{name:/Travel to job/}).click();
  await expect(status).toHaveText('Saved mileage history loaded.');
  await page.getByLabel('Actual miles',{exact:true}).fill('7.125');
  await page.getByLabel('Type of travel',{exact:true}).selectOption('business_rig');
  await page.getByRole('button',{name:'Save mileage',exact:true}).click();
  await expect(status).toHaveText('Mileage saved.');
  const history=page.getByRole('region',{name:'Saved mileage history',exact:true});
  await expect(history).toContainText('7.1250 actual miles');
  const editor=page.getByText('Correct departure time',{exact:true}),form=page.locator('form').filter({
   has:page.getByRole('button',{name:'Save departure correction',exact:true}),
  });
  await editor.click();
  const original=await form.locator('time').first().getAttribute('datetime');
  const arrival=await form.locator('time').nth(1).getAttribute('datetime');
  const corrected=Math.floor((Date.parse(original)-1000)/1000)*1000;
  const reason='Synthetic earlier departure documented';
  await form.getByLabel('Corrected departure time',{exact:true}).fill(departureLocalTime(corrected));
  await form.getByLabel('Departure correction reason',{exact:true}).fill(reason);
  await expect(form).toContainText('Saved mileage will need review after the correction.');
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(row=>row.id),[]);
   await page.screenshot({path:'.local/review/mileage-departure-correction-'+name+'-'+width+'.png',fullPage:true});
  }
  let savedStatus,submissions=0;
  const route='**/api/business/scheduling/mobile-departure-save',storageKey='crest.mobile-departure.pending-reference.v1';
  await page.route(route,async request=>{submissions++;savedStatus=(await request.fetch()).status();await request.abort();});
  await form.getByRole('button',{name:'Save departure correction',exact:true}).press('Enter');
  await expect(status).toContainText('The save outcome is unknown.');
  assert.equal(savedStatus,200);
  const pending=await page.evaluate(key=>sessionStorage.getItem(key),storageKey);
  assert(pending&&!pending.includes(reason)&&!pending.includes('correctedAt')&&!pending.includes('7.125'));
  await page.reload();
  await page.getByRole('button',{name:'Check original departure correction',exact:true}).click();
  await expect(status).toHaveText('Departure time corrected.');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),storageKey),null);
  assert.equal(submissions,1);
  await expect(history).toContainText('7.1250 actual miles');
  await expect(page.getByRole('list',{name:'Trips for this job'})).toContainText('Mileage needs review');
  await editor.click();
  assert.equal(Date.parse(await form.locator('time').first().getAttribute('datetime')),corrected);
  assert.equal(await form.locator('time').nth(1).getAttribute('datetime'),original);
  assert.equal(await form.locator('time').nth(2).getAttribute('datetime'),arrival);
 }finally{await browser?.close();await fixture.close();}
});

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' saved trip mileage and corrections',async()=>{
 const fixture=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,
  quoteCommercial:true,scheduling:true,additionalSchedulingAgreement:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobMileage:true});
 let browser;
 try{
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const jobId=fixture.bookingRequest.jobId,job='/schedule?job='+jobId;
  const mileage='/schedule/mileage?job='+jobId,status=page.locator('.job-change-status');
  assert.equal((await page.goto(fixture.origin+mileage))?.status(),200);
  await expect(status).toHaveText('Sign in to view mileage for this job.');
  await page.getByRole('link',{name:'Sign in to view mileage',exact:true}).click();
  const credentials=fixture.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);
  await page.getByLabel('Password',{exact:true}).fill(credentials.password);
  await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const book=input=>page.evaluate(async input=>{
   const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),proof=await session.json();
   const body=Object.fromEntries(Object.entries(input).filter(([key])=>key!=='businessId'));
   const response=await fetch('/api/business/scheduling/book',{method:'POST',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify(body)});
   return {status:response.status,value:await response.json()};
  },input);
  const other=fixture.additionalBookingRequest,appointment=other.payload.appointment;
  other.expectedModeSequence='1';
  for(const key of ['start_at','end_at','local_start','local_end'])appointment[key]=appointment[key].replace('2026-11-03','2026-11-04');
  for(const [index,input] of [fixture.bookingRequest,other].entries()){
   const booked=await book(input);
   const reason=String(booked.value.reason??booked.value.error??'');
   assert.equal(booked.status,200,'Synthetic visit '+(index+1)+': '+(/^[a-z_]{1,80}$/i.test(reason)?reason:'no conflict code'));
   assert.equal(booked.value.state,'committed');
  }
  await page.goto(fixture.origin+job);
  await page.getByRole('link',{name:'Review trip mileage',exact:true}).click();
  await expect(status).toHaveText('No trips are recorded for this job.');
  await page.getByRole('link',{name:'Saved job',exact:true}).click();
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByLabel('Vehicle you are driving',{exact:true}).selectOption(fixture.fieldVehicleId);
  await page.getByLabel('Where are you leaving from?',{exact:true}).fill('Synthetic equipment base');
  await page.getByRole('button',{name:'Record departure',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('button',{name:'Record work status…',exact:true}).click();
  await page.getByRole('button',{name:'Record arrival and start work',exact:true}).click();
  await expect(status).toContainText('Work status saved.');
  await page.getByRole('link',{name:'Open updated job in Schedule',exact:true}).click();
  await page.getByRole('link',{name:'Review trip mileage',exact:true}).click();
  const trip=page.getByRole('button',{name:/Travel to job/});
  await trip.click();
  await expect(status).toHaveText('Saved mileage history loaded.');
  const history=page.getByRole('region',{name:'Saved mileage history',exact:true});
  await expect(history).toContainText('No mileage has been saved for this trip.');
  async function capture(stage){
   await mkdir('.local/review',{recursive:true});
   for(const width of [360,390,768,1440]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(stage==='split')assert(await page.locator('.mileage-share-controls').evaluateAll(rows=>rows.length===2&&rows.every(row=>{
     const input=row.querySelector('input').getBoundingClientRect(),remove=row.querySelector('button').getBoundingClientRect();
     return input.width>=135&&remove.left-input.right>=7&&remove.right<=row.getBoundingClientRect().right+1;
    })));
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
    await page.screenshot({path:'.local/review/mileage-'+stage+'-'+name+'-'+width+'.png',fullPage:true});
   }
  }
  await capture('form');
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Actual miles',{exact:true}).fill('14.7500');
  await page.getByLabel('Type of travel',{exact:true}).selectOption('business_rig');
  await page.getByLabel('Job attribution',{exact:true}).selectOption('split');
  await page.getByRole('button',{name:'Add this job',exact:true}).click();
  await expect(page.getByLabel('This job share (%)',{exact:true})).toBeFocused();
  await page.getByLabel('Job date',{exact:true}).fill('2026-11-05');
  await page.getByRole('button',{name:'Find saved jobs',exact:true}).click();
  await expect(page.getByText('No saved jobs were found for this date.',{exact:true})).toBeVisible();
  await page.getByLabel('Job date',{exact:true}).fill('2026-11-04');
  await page.getByRole('button',{name:'Find saved jobs',exact:true}).click();
  await page.getByLabel('Saved job to add',{exact:true}).selectOption(other.jobId);
  await page.getByRole('button',{name:'Add selected job',exact:true}).click();
  await expect(page.getByLabel(/Nov 4.*share \(%\)/)).toBeFocused();
  await page.getByLabel('This job share (%)',{exact:true}).fill('60.123456');
  await page.getByLabel(/Nov 4.*share \(%\)/).fill('25');
  const note='=SUM(1,2)';
  await page.getByLabel('Notes (optional)',{exact:true}).fill(note);
  let submissions=0;
  const pattern='**/api/business/scheduling/mileage-save';
  await page.route(pattern,async route=>{
   submissions++;
   const response=await route.fetch();
   if(name==='webkit')await route.abort('failed');
   else await route.fulfill({response});
  });
  const save=page.getByRole('button',{name:'Save mileage',exact:true});
  await save.click();
  await expect(page.getByRole('group',{name:'Record mileage',exact:true}).getByRole('alert')).toContainText('totaling exactly 100%');
  assert.equal(submissions,0);
  await page.getByLabel(/Nov 4.*share \(%\)/).fill('39.876544');
  await capture('split');
  await page.setViewportSize({width:390,height:844});
  await save.focus();
  await page.keyboard.press('Enter');
  if(name==='webkit'){
   await expect(status).toContainText('The save outcome is unknown');
   const saved=await page.evaluate(()=>sessionStorage.getItem('crest.mileage.pending-reference.v1'));
   assert(saved&&!saved.includes(note)&&!saved.includes('14.7500')&&!saved.includes(other.jobId)&&!saved.includes('60.123456'));
   await page.getByRole('button',{name:'Check original mileage',exact:true}).click();
  }
  await expect(status).toHaveText('Mileage saved.');
  assert.equal(submissions,1);
  await page.unroute(pattern);
  await expect(history).toContainText('14.7500 actual miles');
  await expect(page.getByLabel('Reason for correction',{exact:true})).toBeHidden();
  await page.getByText('Correct saved mileage',{exact:true}).click();
  await page.getByLabel('Actual miles',{exact:true}).fill('15.125');
  await page.getByLabel('Job attribution',{exact:true}).selectOption('split');
  await expect(page.getByLabel('This job share (%)',{exact:true})).toHaveValue('60.123456');
  await page.getByLabel('This job share (%)',{exact:true}).fill('80');
  await page.getByLabel(/Previously allocated job \d+ share/).fill('20');
  await page.getByLabel('Reason for correction',{exact:true}).fill('Synthetic odometer correction');
  await page.getByRole('button',{name:'Save correction',exact:true}).click();
  await expect(status).toHaveText('Mileage saved.');
  await expect(history).toContainText('15.1250 actual miles');
  await expect(history).toContainText('14.7500 actual miles');
  await page.reload();
  await trip.click();
  await expect(history).toContainText('Synthetic odometer correction');
  const split=history.locator('li').filter({hasText:'Version 2'}).first();
  await split.locator('summary').click();
  await expect(split).toContainText('80% · This job');
  await expect(split).toContainText('20% · Open allocated job');
  await expect(split.getByRole('link',{name:/Open allocated job/})).toHaveAttribute('href','/schedule?job='+other.jobId);
  await capture('saved');
  const button=page.getByRole('button',{name:'Download loaded history (CSV + JSON)',exact:true});
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  assert.equal(download.suggestedFilename(),'crest-mileage-history-page.zip');
  const files=unzipSync(await readFile(await download.path()));
  const exported=JSON.parse(strFromU8(files['mileage_history.json']));
  assert.deepEqual(exported.evidence.map(row=>row.actual_miles),['14.7500','15.1250']);
  assert.equal(exported.evidence[0].notes,note);
  assert.equal(exported.allocations.length,4);
  for(const [i,shares]of [['0.60123456','0.39876544'],['0.80000000','0.20000000']].entries()){
   const entries=exported.allocations.filter(row=>row.evidence_id===exported.evidence[i].id);
   assert.equal(entries.find(row=>row.job_id===jobId).fraction,shares[0]);
   assert.equal(entries.find(row=>row.job_id===other.jobId).fraction,shares[1]);
  }
  assert.deepEqual(exported.audits.map(row=>row.entity_kind).sort(),
   ['leg_job_allocations','leg_job_allocations','leg_job_allocations','leg_job_allocations','mileage_evidence','mileage_evidence']);
  assert(strFromU8(files['mileage_evidence.csv']).includes('"\'=SUM(1,2)"'));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.scope,'mileage_history_page');
  assert.equal(manifest.completeBackup,false);
  assert.equal(manifest.parts.length,6);
  for(const {name,bytes,sha256}of manifest.parts){
   assert.equal(files[name].byteLength,bytes);
   assert.equal(createHash('sha256').update(files[name]).digest('hex'),sha256);
  }
  let blockedReads=0,unexpectedDownloads=0;
  page.on('download',()=>{unexpectedDownloads++;});
  await page.route('**/api/business/scheduling/mileage-history',async route=>{
   blockedReads++;
   await route.abort('failed');
  });
  await button.click();
  await expect(status).toHaveText('Saved trips or access could not be verified. Reload to try again.');
  await expect(history).toHaveCount(0);
  assert.equal(blockedReads,1);
  assert.equal(unexpectedDownloads,0);
 }finally{
  await browser?.close();
  await fixture.close();
 }
});
