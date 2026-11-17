import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,readFile} from 'node:fs/promises';
import {strFromU8,unzipSync} from 'fflate';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const columns='Id,Name,Phone,AutoId,Auto,Balance,Email,VIN';
const csv=[
 columns,
 'a,Fictional Riley,3175550100,v1,Sample Wagon,ignored-historical-value,,XY-1234',
 'b,Fictional Morgan,3175550100,,,,,',
 ',Missing identity,,,,,,',
 ...Array.from({length:25},(_,i)=>'c'+i+',Fictional contact '+i+',,,,,'+(i===0?' SAVED@EXAMPLE.TEST ':'')+','),
].join('\n');

// Read the reply while the browser still owns the fetch, before the UI can
// replace the request context. Playwright response bodies can be evicted.
async function captureJsonReply(page,path){
 await page.evaluate(path=>{
  const send=window.fetch;
  delete window.syntheticCapturedReply;
  window.fetch=async(input,init)=>{
   const response=await send.call(window,input,init);
   if(input===path){
    window.fetch=send;
    try{window.syntheticCapturedReply={body:await response.clone().json()};}
    catch{window.syntheticCapturedReply={failed:true};}
   }
   return response;
  };
 },path);
 return async()=>{
  await page.waitForFunction(()=>window.syntheticCapturedReply!==undefined);
  const captured=await page.evaluate(()=>{
   const result=window.syntheticCapturedReply;
   delete window.syntheticCapturedReply;
   return result;
  });
  assert(captured&&!captured.failed&&Object.hasOwn(captured,'body'),'The actual browser reply could not be captured');
  return captured.body;
 };
}

async function recordCounts(fixture){
 const {rows:[counts]}=await fixture.client.query(
  'SELECT (SELECT count(*) FROM crest.customers WHERE business_id=$1) AS customers, '+
  '(SELECT count(*) FROM crest.vehicles WHERE business_id=$1) AS vehicles',[fixture.business]);
 return counts;
}

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(name+' reviews fictional CSVs and sends only approved matching hints',{timeout:240000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL;
  const cluster=previous===undefined?await recoveryCluster():null;
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  const failures=[];
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,legacyContactMatches:true,legacyContactBatches:true,legacyContactEffects:true,legacyContactTargets:true,legacyContactDecisions:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:850}});
   const page=await context.newPage();
   page.setDefaultTimeout(10000);
   page.on('response',response=>{
    const path=new URL(response.url()).pathname;
    if(response.status()>=400&&path.startsWith('/api/'))failures.push([path,response.status()]);
   });
   const signIn=async()=>{
    const credentials=fixture.credentials();
    await page.getByLabel('Email',{exact:true}).fill(credentials.email);
    await page.getByLabel('Password',{exact:true}).fill(credentials.password);
    await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
   };
   const resumeWithFreshSession=async()=>{
    await context.clearCookies();
    await page.goto(fixture.origin+'/sign-in');
    await signIn();
    await page.goto(fixture.origin+'/customers/import-review');
    await expect(page.getByLabel('Contact CSV',{exact:true})).toBeEnabled();
   };
   await page.goto(fixture.origin+'/customers/import-review');
   const file=page.getByLabel('Contact CSV',{exact:true});
   await expect(file).toHaveCount(0);
   const denied=await page.evaluate(async()=>{
    const response=await fetch('/api/business/customers/legacy-matches',{method:'POST',
     headers:{'content-type':'application/json'},body:JSON.stringify({kind:'phone',hints:['3175550100']})});
    return {status:response.status,body:await response.json()};
   });
   assert.deepEqual(denied,{status:400,body:{error:'CUSTOMER_REQUEST_FAILED'}});
   await page.getByRole('link',{name:'Sign in to Crest OS',exact:true}).click();
   await signIn();

   await page.goto(fixture.origin+'/customers');
   await page.getByRole('button',{name:'Add customer',exact:true}).click();
   await page.getByLabel('Customer name',{exact:true}).fill('Fictional saved contact');
   await page.getByLabel('Phone value',{exact:true}).fill('(317) 555-0100');
   await page.getByLabel('Email value',{exact:true}).fill('saved@example.test');
   await page.getByRole('button',{name:'Save customer',exact:true}).click();
   await expect(page.getByRole('status').first()).toContainText('Customer saved');
   await page.goto(fixture.origin+'/vehicles');
   await page.getByRole('button',{name:'Add vehicle',exact:true}).click();
   await page.getByLabel('Vehicle label',{exact:true}).fill('Fictional saved wagon');
   await page.getByLabel('VIN',{exact:true}).fill('XY1234');
   await page.getByRole('button',{name:'Save vehicle',exact:true}).click();
   await expect(page.getByRole('status',{name:'Vehicle editor status',exact:true})).toContainText('Vehicle saved');
   await page.goto(fixture.origin+'/customers');
   await page.getByRole('link',{name:'Review a contact CSV',exact:true}).click();
   await expect(file).toBeEnabled();
   await expect(page.getByText(/up to 25 MiB and 100,000 records/)).toBeVisible();
   const counts=await recordCounts(fixture),reviewRequests=[];
   page.on('request',request=>{
    if(request.method()==='POST'&&!request.url().endsWith('/legacy-batches/stage'))reviewRequests.push({path:new URL(request.url()).pathname,body:request.postData()});
   });
   const choose=contents=>file.setInputFiles({name:'fictional-contacts.csv',mimeType:'text/csv',buffer:Buffer.from(contents)});
   const startedWorker=page.waitForEvent('worker');
   await choose(columns+'\na,"unfinished');
   assert.match((await startedWorker).url(),/\/_next\/static\//);
   const reviewStatus=page.getByRole('status',{name:'CSV review status',exact:true});
   await expect(reviewStatus).toContainText('Check the quoting');
   await choose(csv);
   await expect(page.getByText('28 CSV records',{exact:true})).toBeVisible();
   const map=(field,header)=>page.getByLabel(field,{exact:true}).selectOption(header);
   await map('Customer ID','Id');
   await map('Customer name','Name');
   await page.getByText('Additional customer details',{exact:true}).click();
   await map('Phone','Phone');
   await map('Email','Email');
   await page.getByText('Vehicle details',{exact:true}).click();
   await map('Vehicle ID','AutoId');
   await page.getByRole('button',{name:'Review file',exact:true}).click();
   await expect(reviewStatus).toHaveText('Map Vehicle ID and Vehicle label when reviewing vehicle details.');
   await map('Vehicle label','Auto');
   await map('VIN','VIN');
   await page.getByRole('button',{name:'Review file',exact:true}).click();
   await expect(reviewStatus).toHaveText('CSV review is ready.');
   const results=page.getByRole('region',{name:'CSV review results'});
   await expect(results.getByRole('heading',{name:'Review results'})).toBeFocused();
   await expect(page.locator('.legacy-source-workspace [aria-current="step"]')).toContainText('Review');
   await expect(results).toContainText('28 CSV records · 3 to review');
   await expect(results.getByText('Shared phone',{exact:true})).toHaveCount(2);
   await expect(results).toContainText('A customer or vehicle ID is missing or invalid.');
   await expect(results).toContainText('Sample Wagon');
   await results.getByText('Unmapped columns (1)',{exact:true}).click();
   await expect(results.getByText('Balance',{exact:true})).toBeVisible();
   await expect(results).not.toContainText('ignored-historical-value');
   await expect(results).toContainText('1–25 of 28');
   await results.getByRole('button',{name:'Next',exact:true}).click();
   await expect(results).toContainText('26–28 of 28');
   await results.getByLabel('Show records').selectOption('flagged');
   await expect(results.locator('.legacy-records > li')).toHaveCount(3);
   assert.deepEqual(await recordCounts(fixture),counts);
   assert(reviewRequests.length>=2);
   for(const request of reviewRequests){
    assert(['/api/auth/session','/api/business/settings'].includes(request.path),request.path);
    assert.equal(request.body,'{}');
   }

   const checkMatches=results.getByRole('button',{name:'Check saved records',exact:true});
   const customerRoute='**/api/business/customers/legacy-matches';
   await page.route(customerRoute,route=>route.abort());
   await checkMatches.click();
   await expect(reviewStatus).toHaveText('Saved records could not be checked. The file review is still available.');
   await expect(results).toContainText('28 CSV records · 3 to review');
   await page.unroute(customerRoute);
   reviewRequests.length=0;
   await checkMatches.click();
   await expect(reviewStatus).toHaveText('Saved-record check complete.');
   await expect(results).toContainText('28 CSV records · 4 to review');
   await expect(results.getByText('1 saved customer with this phone',{exact:true})).toHaveCount(2);
   await expect(results).toContainText('1 saved customer with this email');
   await expect(results).toContainText('1 saved vehicle with this VIN');
   assert.deepEqual(reviewRequests.filter(request=>request.path.endsWith('/legacy-matches')).map(request=>[request.path,JSON.parse(request.body)]),[
    ['/api/business/customers/legacy-matches',{kind:'phone',hints:['3175550100']}],
    ['/api/business/customers/legacy-matches',{kind:'email',hints:['SAVED@EXAMPLE.TEST']}],
    ['/api/business/vehicles/legacy-matches',{kind:'vin',hints:['XY1234']}],
   ]);
   assert.deepEqual(await recordCounts(fixture),counts);

   for(const width of [360,768,1440]){
    await page.setViewportSize({width,height:850});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow at '+width);
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    assert.deepEqual(audit.violations.map(({id,nodes})=>({id,targets:nodes.map(node=>node.target)})),[]);
   }
   await mkdir('.local/review',{recursive:true});
   await page.screenshot({path:'.local/review/workspace-contact-csv-'+name.toLowerCase()+'-1440.png',fullPage:true});
   const saveDraft=page.getByRole('form',{name:'Save import draft'});
   const stageRoute='/api/business/customers/legacy-batches/stage';
   await saveDraft.getByLabel('Source name').fill('Fictional former CRM');
   await page.evaluate(path=>{
    const realFetch=window.fetch;
    window.fetch=async(input,options)=>{
     const response=await realFetch.call(window,input,options);
     if(input===path){window.fetch=realFetch;throw new TypeError('Simulated lost save response');}
     return response;
    };
   },stageRoute);
   const firstResponse=page.waitForResponse(reply=>new URL(reply.url()).pathname===stageRoute&&reply.request().method()==='POST');
   await saveDraft.getByRole('button',{name:'Save import draft',exact:true}).click();
   await expect(saveDraft).toContainText('The save could not be confirmed.');
   assert.equal((await firstResponse).status(),200);
   await saveDraft.getByRole('button',{name:'Save import draft',exact:true}).click();
   await expect(saveDraft).toContainText('Import draft saved.');
   const {rows:[draft]}=await fixture.client.query('SELECT id,row_count,rejected_count FROM crest.legacy_contact_batches WHERE business_id=$1',[fixture.business]);
   assert.deepEqual([draft.row_count,draft.rejected_count],[28,1]);
   const {rows:[staged]}=await fixture.client.query('SELECT candidate FROM crest.legacy_contact_batch_rows WHERE batch_id=$1 AND source_row=2',[draft.id]);
   assert(!JSON.stringify(staged.candidate).includes('ignored-historical-value'));
   assert.equal(staged.candidate.customer.sourceId,'a');
   // Review and verification simulate a return visit after the initial upload.
   await resumeWithFreshSession();
   await expect(file).toBeEnabled();
   assert.equal(await file.evaluate(input=>input.files.length),0);
   await page.getByText('Saved import drafts',{exact:true}).click();
   const savedDrafts=page.getByRole('region',{name:'Saved import drafts',exact:true});
   const openSavedDraft=savedDrafts.getByRole('button',{name:'Open draft: Fictional former CRM',exact:true});
   await openSavedDraft.click();
   await expect(savedDrafts.getByRole('heading',{name:'Fictional former CRM'})).toBeFocused();
   await expect(savedDrafts.getByRole('button',{name:'Reload saved drafts'})).toHaveCount(0);
   await savedDrafts.getByRole('button',{name:'Back to saved drafts'}).click();
   await expect(openSavedDraft).toBeFocused();
   await openSavedDraft.press('Enter');
   await expect(savedDrafts.getByRole('heading',{name:'Fictional former CRM'})).toBeFocused();
   await expect(savedDrafts).toContainText('A customer or vehicle ID is missing or invalid.');
   await expect(savedDrafts).toContainText('Sample Wagon');
   const effectPanel=savedDrafts.getByRole('region',{name:'Import effect review'});
   const effectRoute='**/api/business/customers/legacy-batches/effects';
   await page.route(effectRoute,route=>route.abort(),{times:1});
   await effectPanel.getByRole('button',{name:'Check this draft'}).click();
   await expect(page.getByRole('status',{name:'Saved drafts status'})).toHaveText('The draft could not be checked. Try again.');
   // Retain the real response bytes before releasing them to the page.
   // Chromium may discard its response resource when the review changes.
   let retainedEffects;
   const retainEffects=async route=>{
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:45000});
    const bytes=await response.body();
    retainedEffects=JSON.parse(bytes.toString('utf8'));
    await route.fulfill({response,body:bytes});
   };
   await page.route(effectRoute,retainEffects);
   const effectResponse=page.waitForResponse(response=>response.url().endsWith('/legacy-batches/effects'));
   await effectPanel.getByRole('button',{name:'Check this draft'}).click();
   const verifiedEffects=await effectResponse;
   assert.equal(verifiedEffects.status(),200);
   assert.deepEqual(verifiedEffects.request().postDataJSON(),{batchId:draft.id,afterRow:1});
   await page.unroute(effectRoute,retainEffects);
   const stats=retainedEffects;assert(stats);
   assert.deepEqual([stats.candidateCustomers,stats.candidateVehicles,stats.candidateLinks,stats.reviewRows,stats.rejectedRows],[27,1,1,3,1]);
   await expect(effectPanel).toContainText('3 rows need review · 1 rejected');
   await expect(effectPanel.getByRole('listitem').filter({hasText:'Possible saved customer matches'})).toContainText('3');
   const findingRows=effectPanel.getByRole('region',{name:'Rows to review'});
   await expect(findingRows.getByText('Record 5',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('Email matches a saved customer',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('VIN matches a saved vehicle',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('Rejected record',{exact:true})).toBeVisible();
   const firstFinding=findingRows.locator('.legacy-records > li').filter({hasText:'Record 2'});
   await findingRows.getByRole('button',{name:'Next row',exact:true}).click();
   await expect(firstFinding.locator('.legacy-finding-name')).toBeFocused();
   const compareCustomers=firstFinding.getByRole('button',{name:'Compare saved customers'});
   const matchRoute='**/api/business/customers/legacy-batches/targets';
   await page.route(matchRoute,route=>route.abort(),{times:1});
   await compareCustomers.click();
   await expect(page.getByRole('status',{name:'Saved drafts status'})).toHaveText('Saved matches could not be loaded. Try again.');
   const targetResponse=page.waitForResponse(reply=>reply.url().endsWith('/legacy-batches/targets'));
   await compareCustomers.click();
   const targetReply=await targetResponse;
   assert.equal(targetReply.status(),200);
   assert.deepEqual(targetReply.request().postDataJSON(),{batchId:draft.id,row:2,kind:'customer',afterTarget:null});
   const matchedContact=firstFinding.getByRole('region',{name:'Saved customer matches'});
   await expect(matchedContact.getByRole('heading',{name:'Saved customer matches',exact:true})).toBeFocused();
   await expect(matchedContact.getByRole('region',{name:'Incoming CSV value',exact:true})).toContainText(await firstFinding.locator('.legacy-finding-name').innerText());
   await expect(matchedContact).toContainText('Fictional saved contact');
   await expect(matchedContact).toContainText('Same phone');
   await expect(matchedContact).not.toContainText('saved@example.test');
   await firstFinding.getByRole('button',{name:'Compare saved vehicles'}).click();
   const matchedVehicle=firstFinding.getByRole('region',{name:'Saved vehicle matches'});
   await expect(matchedVehicle).toContainText('Fictional saved wagon');
   await expect(matchedVehicle).toContainText('Same VIN');
   await expect(matchedContact).toHaveCount(0);
   await page.setViewportSize({width:360,height:850});
   const targetAudit=await new AxeBuilder({page}).include('.legacy-target-comparison').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(targetAudit.violations.map(issue=>issue.id),[]);
   await matchedVehicle.getByRole('heading',{name:'Saved vehicle matches',exact:true}).evaluate(heading=>heading.scrollIntoView({block:'center'}));
   await page.screenshot({path:'.local/review/workspace-contact-targets-'+name.toLowerCase()+'-360.png'});
   await firstFinding.getByRole('button',{name:'Hide saved vehicles'}).click();
   await expect(matchedVehicle).toHaveCount(0);
   await savedDrafts.getByRole('button',{name:'Next',exact:true}).click();
   await expect(savedDrafts).toContainText('Record 29');
   await expect(savedDrafts).not.toContainText('ignored-historical-value');
   await page.setViewportSize({width:360,height:850});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const savedAudit=await new AxeBuilder({page}).include('.legacy-saved-drafts').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(savedAudit.violations.map(issue=>issue.id),[]);
   await effectPanel.screenshot({path:'.local/review/workspace-contact-effect-'+name.toLowerCase()+'-360.png'});
   await page.screenshot({path:'.local/review/workspace-saved-contact-draft-'+name.toLowerCase()+'-360.png'});
   await findingRows.getByRole('heading',{name:'Rows to review'}).evaluate(heading=>heading.scrollIntoView({block:'start'}));
   await page.screenshot({path:'.local/review/workspace-contact-findings-'+name.toLowerCase()+'-360.png'});
   // Treat making decisions as its own owner visit. The endpoints use the same
   // rate budget as the rest of the application.
   await resumeWithFreshSession();
   await page.getByText('Saved import drafts',{exact:true}).click();
   await openSavedDraft.click();
   await effectPanel.getByRole('button',{name:'Check this draft'}).click();
   await expect(findingRows).toBeVisible();
   const editDecision=savedDrafts.getByRole('button',{name:'Edit decision for record 2',exact:true});
   await editDecision.click();
   const decision=savedDrafts.getByRole('region',{name:'Decision for record 2',exact:true});
   const decisionStatus=decision.getByRole('status');
   await expect(decision.getByRole('heading')).toBeFocused();
   await decision.getByLabel('Source key').fill('former-crm');
   await decision.getByLabel('Customer decision').selectOption('link');
   await decision.getByRole('button',{name:'Find saved customer matches'}).click();
   await decision.getByRole('radio',{name:/Fictional saved contact/}).check();
   await decision.getByLabel('Vehicle decision').selectOption('link');
   await decision.getByRole('button',{name:'Find saved vehicle matches'}).click();
   await decision.getByRole('radio',{name:/Fictional saved wagon/}).check();
   const decisionPath='/api/business/customers/legacy-batches/save-decision';
   await page.evaluate(path=>{
    const send=window.fetch;
    window.fetch=async(input,options)=>{
     const response=await send.call(window,input,options);
     if(input===path){window.fetch=send;throw new TypeError('Simulated lost decision reply');}
     return response;
    };
   },decisionPath);
   const saveDecision=decision.getByRole('button',{name:'Save decision',exact:true});
   const firstDecision=page.waitForResponse(reply=>reply.url().endsWith(decisionPath));
   await saveDecision.click();
   const committed=await firstDecision;
   assert.equal(committed.status(),200);
   await expect(decisionStatus).toContainText('The save could not be confirmed.');
   const readDecision=await captureJsonReply(page,decisionPath);
   const recoveredDecision=page.waitForResponse(reply=>reply.url().endsWith(decisionPath));
   await saveDecision.click();
   const repeated=await recoveredDecision;
   assert.equal(repeated.status(),200);
   assert.deepEqual(repeated.request().postDataJSON(),committed.request().postDataJSON());
   const storedDecision=await readDecision();
   const {legacyDecisionOutcome}=await import('../../src/customer/legacy-contact-decision-contract.ts');
   assert.equal(legacyDecisionOutcome(storedDecision,fixture.business,repeated.request().postDataJSON()).state,'committed');
   await expect(decisionStatus).toContainText('Decision saved.');
   await expect(saveDecision).toBeDisabled();
   assert.deepEqual([storedDecision.receipt.row,storedDecision.receipt.sourceNamespace,storedDecision.receipt.customerVersion,
    storedDecision.receipt.vehicleVersion,storedDecision.receipt.revision],[2,'former-crm','1','1',1]);
   const decisionAudit=await new AxeBuilder({page}).include('.legacy-decision-editor').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(decisionAudit.violations.map(issue=>issue.id),[]);
   await decision.getByRole('heading').evaluate(heading=>heading.scrollIntoView({block:'start'}));
   await page.screenshot({path:'.local/review/workspace-contact-decision-'+name.toLowerCase()+'-360.png'});
   await decision.getByRole('button',{name:'Close decision'}).click();
   await expect(editDecision).toBeFocused();
   await page.reload();
   await expect(file).toBeEnabled();
   await page.getByText('Saved import drafts',{exact:true}).click();
   await openSavedDraft.click();
   await editDecision.click();
   await expect(decision.getByLabel('Source key')).toHaveValue('former-crm');
   await expect(decision.getByLabel('Customer decision')).toHaveValue('link');
   await expect(decision.getByLabel('Vehicle decision')).toHaveValue('link');
   await expect(decision).toContainText('Saved revision 1');
   await decision.getByRole('button',{name:'Close decision'}).click();
   await savedDrafts.getByRole('button',{name:'Edit decision for record 4',exact:true}).click();
   const rejection=savedDrafts.getByRole('region',{name:'Decision for record 4',exact:true});
   await expect(rejection.getByLabel('Customer decision')).toHaveValue('skip');
   await expect(rejection.getByLabel('Source key')).toHaveValue('former-crm');
   await rejection.getByRole('button',{name:'Save decision'}).click();
   await expect(rejection.getByRole('status')).toContainText('Decision saved.');
   await rejection.getByRole('button',{name:'Close decision'}).click();
   const revisions=await fixture.client.query('SELECT source_row,revision FROM crest.legacy_contact_decisions WHERE batch_id=$1 ORDER BY source_row',[draft.id]);
   assert.deepEqual(revisions.rows,[{source_row:2,revision:1},{source_row:4,revision:1}]);
   assert.deepEqual(await recordCounts(fixture),counts);
   const largeCsv=Buffer.alloc(25*1024*1024,0x78);
   largeCsv.write('Id,Name,Ignored\n'+Array.from({length:100000},(_,index)=>index+','+
    (index<60&&index%2===0?'':'Fictional contact')+',').join('\n'));
   await choose(largeCsv);
   await expect(page.getByText('100,000 CSV records',{exact:true})).toBeVisible({timeout:25000});
   await map('Customer ID','Id');
   await map('Customer name','Name');
   await page.getByRole('button',{name:'Review file',exact:true}).click();
   await expect(results).toContainText('100,000 CSV records · 30 to review',{timeout:30000});
   await expect(results.locator('.legacy-records > li')).toHaveCount(25);
   await saveDraft.getByLabel('Source name').fill('Fictional maximum-size CSV');
   await saveDraft.getByRole('button',{name:'Save import draft',exact:true}).click();
   await expect(saveDraft).toContainText('Import draft saved.',{timeout:55000});
   const {rows:[capacity]}=await fixture.client.query("SELECT row_count FROM crest.legacy_contact_batches WHERE business_id=$1 AND source_label='Fictional maximum-size CSV'",[fixture.business]);
   assert.equal(capacity.row_count,100000);
   await savedDrafts.getByRole('button',{name:'Back to saved drafts'}).click();
   await savedDrafts.getByRole('button',{name:'Reload saved drafts'}).click();
   await savedDrafts.getByRole('button',{name:'Open draft: Fictional maximum-size CSV'}).click();
   await effectPanel.getByRole('button',{name:'Check this draft'}).click();
   await expect(effectPanel).toContainText('99,970',{timeout:20000});
   await expect(effectPanel).toContainText('0 rows need review · 30 rejected');
   await expect(findingRows.getByText('Record 2',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('Record 50',{exact:true})).toBeVisible();
   const nextFinding=effectPanel.getByRole('button',{name:'Next findings'});
   await nextFinding.press('Enter');
   await expect(findingRows.getByRole('heading',{name:'Rows to review'})).toBeFocused();
   await expect(findingRows.getByText('Record 52',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('Record 60',{exact:true})).toBeVisible();
   await expect(findingRows.getByText('Record 50',{exact:true})).toHaveCount(0);
   await expect(nextFinding).toBeDisabled();
   await effectPanel.getByRole('button',{name:'Previous findings'}).click();
   await expect(findingRows.getByRole('heading',{name:'Rows to review'})).toBeFocused();
   await expect(findingRows.getByText('Record 2',{exact:true})).toBeVisible();
   const skip=page.getByRole('link',{name:'Skip to content'});
   await expect(skip).toHaveCSS('clip-path','inset(50%)');
   await skip.focus();
   await expect(skip).toHaveCSS('clip-path','none');
   await page.evaluate(()=>dispatchEvent(new Event('pagehide')));
   await expect(reviewStatus).toHaveText('The file review was cleared while away.');
   await expect(file).toHaveCount(0);
   await expect(results).toHaveCount(0);
  }catch(error){
   if(failures.length)process.stderr.write(JSON.stringify(failures.slice(-12))+'\n');
   if(fixture){
    const admission=await fixture.client.query("SELECT count(*)::int AS requests FROM crest_private.session_request_admissions WHERE bucket='ordinary' AND admitted_at>clock_timestamp()-interval '1 minute' GROUP BY session_id ORDER BY count(*) DESC LIMIT 5");
    process.stderr.write('Recent fictional request counts '+JSON.stringify(admission.rows.map(row=>row.requests))+'\n');
   }
   throw error;
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

for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test(name+' approves saved contact choices and recovers an interrupted approval',{timeout:150000},async()=>{
  const cluster=process.env.CREST_TEST_DATABASE_URL===undefined?await recoveryCluster():null;
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,legacyContactMatches:true,legacyContactBatches:true,
    legacyContactEffects:true,legacyContactTargets:true,legacyContactDecisions:true,legacyContactApprovals:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:850}});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const file=page.getByLabel('Contact CSV',{exact:true});
   async function visit(){
    await context.clearCookies();
    await page.goto(fixture.origin+'/sign-in');
    const {email,password}=fixture.credentials();
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    const left=30_000-Date.now()%30_000;
    if(left<5_000)await delay(left+100);
    await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.credentials().code);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    await page.goto(fixture.origin+'/customers/import-review');
    await expect(file).toBeEnabled();
   }
   await visit();
   const counts=await recordCounts(fixture);
   await file.setInputFiles({name:'approval.csv',mimeType:'text/csv',buffer:Buffer.from('Id,Name\ncontact-1,Fictional contact\ncontact-2,Other fictional contact')});
   await page.getByLabel('Customer ID',{exact:true}).selectOption('Id');
   await page.getByLabel('Customer name',{exact:true}).selectOption('Name');
   await page.getByRole('button',{name:'Review file',exact:true}).click();
   const saveDraft=page.getByRole('form',{name:'Save import draft',exact:true});
   await saveDraft.getByLabel('Source name').fill('Fictional approval');
   await saveDraft.getByRole('button',{name:'Save import draft',exact:true}).click();
   await expect(saveDraft).toContainText('Import draft saved.');
   const panel=page.getByRole('region',{name:'Review and approve import',exact:true});
   const status=panel.getByRole('status',{name:'Import approval status',exact:true});
   const approve=panel.getByRole('button',{name:'Approve saved decisions',exact:true});
   const checkDecisions=panel.getByRole('button',{name:/^Check (saved decisions|decisions again)$/});
   async function open(){
    await page.getByText('Saved import drafts',{exact:true}).click();
    await page.getByRole('button',{name:'Open draft: Fictional approval',exact:true}).click();
   }
   await open();
   await checkDecisions.click();
   await expect(panel.getByText('Rows awaiting a saved decision')).toContainText('2');
   await expect(page.locator('.legacy-saved-drafts [aria-current="step"]')).toContainText('Review');
   const progress=page.locator('.legacy-review-progress');
   await expect(progress).toContainText('2 awaiting decision');
   await expect(progress).toHaveCSS('position','sticky');
   await expect(progress.getByRole('link',{name:'Review approval',exact:true})).toHaveAttribute('href','#legacy-import-approval');
   await expect(approve).toHaveCount(0);

   async function decide(row,action){
    await page.getByRole('button',{name:'Edit decision for record '+row,exact:true}).click();
    const editor=page.getByRole('region',{name:'Decision for record '+row,exact:true});
    const source=editor.getByLabel('Source key',{exact:true});
    await expect(source).toBeVisible();
    if(await source.isEditable())await source.fill('former-crm');
    await editor.getByLabel('Customer decision',{exact:true}).selectOption(action);
    await editor.getByRole('button',{name:'Save decision',exact:true}).click();
    await expect(editor.getByRole('status')).toContainText('Decision saved.');
    await editor.getByRole('button',{name:'Close decision',exact:true}).click();
   }
   await decide(2,'create');
   await expect(panel.getByText('A row decision may have changed. Check saved decisions again.')).toBeVisible();
   await expect(progress).toContainText('Check saved decisions for the current count.');
   await decide(3,'skip');

   // Separate owner visits exercise the real ordinary request budget.
   await visit();
   await open();
   await checkDecisions.click();
   await expect(status).toHaveText('Saved decisions checked.');
   await expect(page.locator('.legacy-saved-drafts [aria-current="step"]')).toContainText('Approve');
   const plan=panel.getByRole('table',{name:'Planned import changes',exact:true});
   await expect(plan.getByRole('row').filter({hasText:'Customers'}).getByRole('cell')).toHaveText(['1','0']);
   await expect(plan.getByRole('row').filter({hasText:'Vehicles'}).getByRole('cell')).toHaveText(['0','0']);
   await expect(panel.getByText('Rows to skip',{exact:false})).toContainText('1');
   await expect(approve).toBeDisabled();
   await panel.getByRole('checkbox',{name:'I reviewed these saved decisions.',exact:true}).check();
   await expect(approve).toBeEnabled();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('.legacy-approval').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);

   const path='/api/business/customers/legacy-batches/approve';
   await page.evaluate(path=>{
    const original=window.fetch;
    window.fetch=async(input,init)=>{
     const response=await original.call(window,input,init);
     if(input===path){
      window.fetch=original;
      window.syntheticApprovalReceipt=await response.json();
      throw new TypeError('Simulated lost approval acknowledgement');
     }
     return response;
    };
   },path);
   const firstReply=page.waitForResponse(reply=>reply.url().endsWith(path));await approve.click();
   const first=await firstReply;assert.equal(first.status(),200);
   await expect(status).toContainText('Approval could not be confirmed.');
   const readApproval=await captureJsonReply(page,path);
   const retryReply=page.waitForResponse(reply=>reply.url().endsWith(path));
   await panel.getByRole('button',{name:'Retry approval',exact:true}).click();
   const retry=await retryReply;assert.equal(retry.status(),200);
   assert.deepEqual(retry.request().postDataJSON(),first.request().postDataJSON());
   const retried=await readApproval();
   const original=await page.evaluate(()=>{const value=window.syntheticApprovalReceipt;delete window.syntheticApprovalReceipt;return value;});
   assert.deepEqual(retried,original);
   await expect(status).toHaveText('Approval recorded.');
   await expect(panel.getByText('Approved',{exact:true})).toBeVisible();
   await expect(panel.getByRole('button',{name:'Apply approved import'})).toHaveCount(0);
   await mkdir('.local/review',{recursive:true});
   await panel.screenshot({path:'.local/review/workspace-contact-approval-'+name.toLowerCase()+'-360.png'});

   await visit();
   await open();await checkDecisions.click();
   await expect(status).toHaveText('Current approval verified.');
   await decide(3,'create');await checkDecisions.click();
   await expect(status).toHaveText('Saved decisions checked.');
   await expect(panel.getByText('Approved',{exact:true})).toHaveCount(0);
   await expect(approve).toBeDisabled();
   assert.deepEqual(await recordCounts(fixture),counts);
   const saved=(await fixture.client.query('SELECT approval.id FROM crest.legacy_contact_approvals approval WHERE business_id=$1',[fixture.business])).rows;
   assert.deepEqual(saved,[{id:retried.receipt.approvalId}]);
   await context.close();
  }finally{
   try{await browser?.close();}finally{
    try{await fixture?.close();}finally{
     if(cluster){delete process.env.CREST_TEST_DATABASE_URL;await cluster.close();}
    }
   }
  }
 });
}

for(const [name,engine,background,automatic] of [['Chromium',chromium,false,false],['Chromium',chromium,true,false],['WebKit',webkit,true,true]]){
 test(name+' applies an approved contact file and reuses its saved source identity'+(background?' in the background':''),{timeout:210000},async()=>{
  const cluster=process.env.CREST_TEST_DATABASE_URL===undefined?await recoveryCluster():null;
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,legacyContactMatches:true,legacyContactBatches:true,
    legacyContactEffects:true,legacyContactTargets:true,legacyContactDecisions:true,legacyContactApprovals:true,legacyContactApplications:background?'background':true,automaticContactImport:automatic,legacyContactDownloads:background});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:360,height:850}});
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const file=page.getByLabel('Contact CSV',{exact:true});
   async function visit(){
    await context.clearCookies();
    await page.goto(fixture.origin+'/sign-in');
    const {email,password}=fixture.credentials();
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Password',{exact:true}).fill(password);
    const left=30_000-Date.now()%30_000;
    if(left<5_000)await delay(left+100);
    await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.credentials().code);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
    await page.goto(fixture.origin+'/customers/import-review');
    await expect(file).toBeEnabled();
   }
   async function stage(text,source,vehicles=false){
    await file.setInputFiles({name:'approved-contacts.csv',mimeType:'text/csv',buffer:Buffer.from(text)});
    await page.getByLabel('Customer ID',{exact:true}).selectOption('Id');
    await page.getByLabel('Customer name',{exact:true}).selectOption('Name');
    if(vehicles){
     await page.getByText('Vehicle details',{exact:true}).click();
     await page.getByLabel('Vehicle ID',{exact:true}).selectOption('VId');
     await page.getByLabel('Vehicle label',{exact:true}).selectOption('Vehicle');
    }
    await page.getByRole('button',{name:'Review file',exact:true}).click();
    const save=page.getByRole('form',{name:'Save import draft',exact:true});
    await save.getByLabel('Source name').fill(source);
    await save.getByRole('button',{name:'Save import draft',exact:true}).click();
    await expect(save).toContainText('Import draft saved.',{timeout:15000});
   }
   async function open(label){
    const drafts=page.getByText('Saved import drafts',{exact:true});
    const alreadyOpen=await drafts.evaluate(summary=>summary.parentElement.open);
    if(!alreadyOpen)await drafts.click();
    const button=page.getByRole('button',{name:'Open draft: '+label,exact:true});
    if(alreadyOpen&&!await button.isVisible())await page.getByRole('button',{name:'Reload saved drafts'}).click();
    await button.click();
   }
   async function edit(row){
    await page.getByRole('button',{name:'Edit decision for record '+row,exact:true}).click();
    const editor=page.getByRole('region',{name:'Decision for record '+row,exact:true});
    await expect(editor.getByLabel('Source key')).toBeVisible();
    return editor;
   }
   async function saveDecision(editor){
    await editor.getByRole('button',{name:'Save decision',exact:true}).click();
    await expect(editor.getByRole('status')).toContainText('Decision saved.');
    await editor.getByRole('button',{name:'Close decision',exact:true}).click();
   }
   await visit();
   const baseline=await recordCounts(fixture);
   await stage('Id,Name,VId,Vehicle\n001,Sample customer,v1,Sample wagon\n002,Skipped customer,,','Fictional first import',true);
   await open('Fictional first import');
   const first=await edit(2);
   await first.getByLabel('Source key').fill('previous-crm');
   await first.getByLabel('Customer decision').selectOption('create');
   await first.getByLabel('Vehicle decision').selectOption('create');
   await saveDecision(first);
   const second=await edit(3);
   await second.getByLabel('Customer decision').selectOption('skip');
   await saveDecision(second);
   const panel=page.getByRole('region',{name:'Review and approve import',exact:true});
   const status=panel.getByRole('status',{name:'Import approval status',exact:true});
   const apply=panel.getByRole('button',{name:background?'Start import':'Apply approved import',exact:true});

   await visit();
   await open('Fictional first import');
   await panel.getByRole('button',{name:'Check import status'}).click();
   await expect(status).toHaveText('Saved decisions checked.');
   await expect(apply).toHaveCount(0);
   await panel.getByRole('checkbox',{name:'I reviewed these saved decisions.'}).check();
   await panel.getByRole('button',{name:'Approve saved decisions'}).click();
   await expect(status).toHaveText('Approval recorded.');
   await expect(apply).toBeDisabled();
   await panel.getByRole('checkbox',{name:'I’m ready to apply this approved import.'}).check();

   if(automatic){
    // Hold the exact batch lock so the runner can start, but cannot commit
    // before the test exercises an uncertain reply and leaves the page.
    const draft=await fixture.client.query('SELECT id FROM crest.legacy_contact_batches WHERE business_id=$1 AND source_label=$2',
     [fixture.business,'Fictional first import']);
    assert.equal(draft.rowCount,1);
    await fixture.client.query('BEGIN');
    await fixture.client.query("SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.decide',$1::uuid,$2::uuid)::text,0))",
     [fixture.business,draft.rows[0].id]);
   }
   const path='/api/business/customers/legacy-batches/apply';
   await page.evaluate(path=>{
    const original=window.fetch;
    window.fetch=async(input,init)=>{
     const response=await original.call(window,input,init);
     if(input===path){
      window.fetch=original;
      window.syntheticImportReceipt=await response.json();
      throw new TypeError('Simulated lost import acknowledgement');
     }
     return response;
    };
   },path);
   const firstReply=page.waitForResponse(reply=>reply.url().endsWith(path));await apply.click();
   const applied=await firstReply;assert.equal(applied.status(),background?202:200);
   await expect(status).toContainText('The import outcome could not be confirmed.');
   const readImport=await captureJsonReply(page,path);
   const reply=page.waitForResponse(response=>response.url().endsWith(path));
   await panel.getByRole('button',{name:'Retry import',exact:true}).click();
   const retry=await reply;assert.equal(retry.status(),background?202:200);
   assert.deepEqual(retry.request().postDataJSON(),applied.request().postDataJSON());
   const recovered=await readImport();
   assert.deepEqual(recovered,await page.evaluate(()=>{
    const prior=window.syntheticImportReceipt;delete window.syntheticImportReceipt;return prior;
   }));
   const results=panel.getByRole('region',{name:'Import results',exact:true});
   if(background){
    await expect(status).toContainText('You can leave this page');
    await expect(page.locator('.legacy-review-progress')).toContainText('Import queued');
    await expect(results).toHaveCount(0);
    assert.deepEqual(await recordCounts(fixture),baseline);
    await page.goto(fixture.origin+'/customers');
    await page.goto(fixture.origin+'/customers/import-review');
    await expect(file).toBeEnabled();
    await open('Fictional first import');
    await expect(status).toContainText('You can leave this page');
    await expect(apply).toHaveCount(0);
    if(automatic){
     await fixture.client.query('COMMIT');
     await expect.poll(async()=>(await fixture.client.query(
      "SELECT outcome FROM crest_private.legacy_contact_apply_requests WHERE business_id=$1 AND operation_id=$2",
      [fixture.business,recovered.operationId])).rows[0]?.outcome,{timeout:50000}).toBe('committed');
     // A poll can finish while the owner is working elsewhere on the page.
     await expect(results.getByRole('heading',{name:'Import completed'})).toBeVisible({timeout:25000});
     await expect(status).toHaveText('Import completed.');
    }else{
     assert.equal(await fixture.dispatchContactImport(),true);
     assert.equal(await fixture.dispatchContactImport(),false);
     await panel.getByRole('button',{name:'Check import status'}).click();
     await expect(status).toHaveText('Saved import verified.');
    }
   }else{
    await expect(status).toHaveText('Import recorded.');
   }
   if(!automatic)await expect(results.getByRole('heading',{name:'Import completed'})).toBeFocused();
   await expect(results.getByRole('link',{name:'Created vehicle from record 2'})).toHaveAttribute('href',/vehicle=[0-9a-f-]+$/);
   await expect(results.getByRole('cell',{name:'Skipped',exact:true})).toBeVisible();
   await expect(page.locator('.legacy-saved-drafts [aria-current="step"]')).toContainText('Results');
   await expect(page.getByRole('button',{name:'Edit decision for record 2'})).toHaveCount(0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const audit=await new AxeBuilder({page}).include('.legacy-approval').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
   assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
   await mkdir('.local/review',{recursive:true});
   await results.screenshot({path:'.local/review/contact-import-results-'+name.toLowerCase()+(background?'-background':'')+'-360.png'});
   const after=await recordCounts(fixture);
   assert.equal(Number(after.customers)-Number(baseline.customers),1);
   assert.equal(Number(after.vehicles)-Number(baseline.vehicles),1);
   assert.equal((await fixture.client.query('SELECT count(*) AS count FROM crest.customer_vehicles WHERE business_id=$1',[fixture.business])).rows[0].count,'0');

   await visit();
   await open('Fictional first import');
   if(background){
    await expect(status).toHaveText('Import completed.');
   }else{
    await panel.getByRole('button',{name:'Check import status'}).click();
    await expect(status).toHaveText('Saved import verified.');
   }
   await expect(results).toContainText(background?recovered.operationId:recovered.receipt.operationId);
   const downloadButton=results.getByRole('button',{name:'Download import history'});
   if(background){
    const expectedOperation=recovered.operationId;
    const expectedBatch=retry.request().postDataJSON().batchId;
    const fileReady=page.waitForEvent('download');
    await downloadButton.click();
    const downloaded=await fileReady;
    assert.equal(downloaded.suggestedFilename(),'crest-contact-import-'+expectedBatch+'.zip');
    const archive=await readFile(await downloaded.path());
    const parts=unzipSync(archive);
    assert.deepEqual(Object.keys(parts).sort(),['import-receipt.json','import-requests.csv','row-results.csv']);
    const receipt=JSON.parse(strFromU8(parts['import-receipt.json']));
    assert.deepEqual([receipt.operationId,receipt.batchId,receipt.rowCount,receipt.skippedRows],[expectedOperation,expectedBatch,2,1]);
    assert.match(strFromU8(parts['row-results.csv']),/\r\n3,1,skip,,,none,,\r\n$/);
    assert(strFromU8(parts['import-requests.csv']).includes(expectedOperation+','));
    assert.equal((await fixture.client.query(`SELECT count(*)::int AS count FROM crest_private.audit_events
     WHERE business_id=$1 AND entity_kind='legacy_contact_downloads' AND entity_id=$2`,[fixture.business,expectedBatch])).rows[0].count,1);
    assert.deepEqual(await recordCounts(fixture),after);
   }else await expect(downloadButton).toHaveCount(0);
   await page.getByRole('button',{name:'Back to saved drafts'}).click();
   await stage('Id,Name\n001,Different source display name','Fictional updated import');
   await open('Fictional updated import');
   const repeat=await edit(2);
   await repeat.getByLabel('Source key').fill('previous-crm');
   await repeat.getByLabel('Customer decision').selectOption('link');
   await repeat.getByRole('button',{name:'Find saved customer matches'}).click();
   await repeat.getByRole('radio',{name:'Sample customer · Previously imported',exact:true}).check();
   await saveDecision(repeat);
   assert.deepEqual(await recordCounts(fixture),after);
   await context.close();
  }finally{
   try{await browser?.close();}finally{
    try{await fixture?.close();}finally{
     if(cluster){delete process.env.CREST_TEST_DATABASE_URL;await cluster.close();}
    }
   }
  }
 });
}
