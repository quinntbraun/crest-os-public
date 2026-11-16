import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {recoveryCluster} from '../support/recovery-drill.mjs';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const leadApi='/api/business/leads/';
async function send(page,path,data,proof){
 return page.evaluate(async({path,data,proof})=>{
  const headers={'content-type':'application/json'};
  if(proof)headers['x-crest-csrf']=proof;
  const reply=await fetch(path,{method:'POST',headers,body:JSON.stringify(data)});
  return {status:reply.status,body:await reply.json()};
 },{path,data,proof});
}

for(const [name,engine,width] of [['chromium',chromium,1280],['webkit',webkit,360]]){
 test(name+' reviews real lead and vehicle matches before changing any records',{timeout:300000},async()=>{
  const previous=process.env.CREST_TEST_DATABASE_URL;
  const cluster=previous===undefined?await recoveryCluster():null;
  if(cluster)process.env.CREST_TEST_DATABASE_URL=cluster.testDatabaseUrl;
  let fixture,browser;
  try{
   fixture=await sourceExportBrowserFixture({product:true,workspace:true,leadMatchReview:true});
   browser=await engine.launch();
   const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:860}});
   const page=await context.newPage();
   page.setDefaultTimeout(12000);
   await page.goto(fixture.origin+'/sign-in');
   const credentials=fixture.credentials();
   await page.getByLabel('Email',{exact:true}).fill(credentials.email);
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
   await page.getByRole('button',{name:'Sign in',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();

   const session=(await send(page,'/api/auth/session',{}));
   assert.equal(session.status,200);
   const proof=session.body.csrfToken;
   const {body:{recoveryEpoch}}=await send(page,leadApi+'context',{},proof);
   const base=()=>({schemaVersion:1,recoveryEpoch,operationId:randomUUID(),expectedVersion:'0'});
   const customerId=randomUUID(),vehicleId=randomUUID(),priorLeadId=randomUUID();
   const phone='3175550143',email='riley@example.test';
   const customer={...base(),customerId,displayName:'Fictional Riley Household',phone,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null};
   const wagon={...base(),vehicleId,label:'Silver Sample Wagon',year:2016,make:'Sample Make',model:'Touring',color:'Silver',vin:null,plate:'SAMPLE-8',kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
   const prior={...base(),leadId:priorLeadId,label:'Fictional earlier inquiry',customerId:null,sourceId:null,referralText:null,phone:null,email,requestedScope:null,availability:null,estimatedCents:null,followUpAt:null,notes:null};
   for(const [route,data] of [['/api/business/customers/save',customer],['/api/business/vehicles/save',wagon],[leadApi+'save',prior]]){
    assert.equal((await send(page,route,data,proof)).status,200,route);
   }

   await page.goto(fixture.origin+'/leads');
   await page.getByRole('button',{name:'Add lead',exact:true}).click();
   const editor=page.getByRole('form',{name:'Lead editor',exact:true});
   await editor.getByLabel('Lead label',{exact:true}).fill('Fictional new inquiry');
   await editor.getByLabel('Phone value',{exact:true}).fill(phone);
   await editor.getByLabel('Email value',{exact:true}).fill('RILEY@EXAMPLE.TEST');
   await editor.getByRole('button',{name:'Save lead',exact:true}).click();
   const heading=editor.getByRole('heading',{name:'Possible matches',exact:true});
   const card=editor.getByRole('region',{name:'Possible matches',exact:true});
   await expect(heading).toBeFocused();
   await expect(card.getByRole('listitem').filter({hasText:'Fictional Riley Household'})).toContainText('Same phone');
   await expect(card.getByRole('listitem').filter({hasText:'Fictional earlier inquiry'})).toContainText('Same email');
   await expect(card).not.toContainText(phone);
   await expect(card).not.toContainText(email);
   const {client,business}=fixture;
   const count=async()=>Number((await client.query('SELECT count(*) FROM crest.leads WHERE business_id=$1',[business])).rows[0].count);
   assert.equal(await count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual((await new AxeBuilder({page}).include('.lead-match-notice').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   const evidence=process.env.CREST_LEAD_MATCH_SCREENSHOTS;
   if(evidence){await mkdir(evidence,{recursive:true});await card.screenshot({path:evidence+'/'+name+'-contact.png',animations:'disabled'});}

   await card.getByRole('button',{name:'Edit details',exact:true}).click();
   await expect(editor.getByLabel('Phone value',{exact:true})).toBeFocused();
   await expect(card).toHaveCount(0);
   const contactRoute='**'+leadApi+'contact-review';
   const interrupted=route=>route.abort();
   await page.route(contactRoute,interrupted);
   await editor.getByRole('button',{name:'Save lead',exact:true}).click();
   const failed=editor.getByRole('region',{name:'Matches could not be checked',exact:true});
   await expect(failed).toBeVisible();
   assert.equal(await count(),1);
   await page.unroute(contactRoute,interrupted);
   await failed.getByRole('button',{name:'Retry match check',exact:true}).click();
   await expect(card).toBeVisible();

   const leadWrite=page.waitForRequest(request=>request.url().endsWith(leadApi+'save'));
   await card.getByRole('button',{name:'Save as entered',exact:true}).click();
   const newId=(await leadWrite).postDataJSON().leadId;
   await expect(page.getByRole('status',{name:'Lead editor status',exact:true})).toContainText('Lead saved');
   assert.equal(await count(),2);
   const {rows:[saved]}=await client.query('SELECT customer_id,phone_raw,email_raw FROM crest.leads WHERE business_id=$1 AND id=$2',[business,newId]);
   assert.equal(saved.customer_id,null);
   assert.equal(saved.phone_raw,phone);
   assert.equal(saved.email_raw,'RILEY@EXAMPLE.TEST');

   await page.goto(fixture.origin+'/leads?lead='+newId);
   const panel=page.getByRole('region',{name:'Lead vehicles',exact:true});
   await panel.getByRole('button',{name:'Load lead vehicles',exact:true}).click();
   await panel.getByRole('button',{name:'Add reported vehicle',exact:true}).click();
   const report=panel.getByRole('form',{name:'Lead vehicle editor',exact:true});
   await report.getByLabel('Reported vehicle label',{exact:true}).fill('Fictional new reported wagon');
   await report.getByLabel('Reported year',{exact:true}).fill('2016');
   await report.getByLabel('Reported make',{exact:true}).fill('sample make');
   await report.getByLabel('Reported model',{exact:true}).fill('Touring');
   await report.getByLabel('Reported plate',{exact:true}).fill('sample-8');
   await report.getByRole('button',{name:'Save vehicle report',exact:true}).click();
   const vehicleReview=report.getByRole('region',{name:'Possible matches',exact:true});
   await expect(vehicleReview).toContainText(wagon.label);
   await expect(vehicleReview).toContainText('Same plate text');
   await expect(vehicleReview).toContainText('Same year, make and model');
   assert.equal((await client.query('SELECT count(*) FROM crest.lead_vehicles WHERE business_id=$1',[business])).rows[0].count,'0');
   if(evidence)await vehicleReview.screenshot({path:evidence+'/'+name+'-vehicle.png',animations:'disabled'});
   const vehicleWrite=page.waitForRequest(request=>request.url().endsWith(leadApi+'vehicle-save'));
   await vehicleReview.getByRole('button',{name:'Save as entered',exact:true}).click();
   const reportId=(await vehicleWrite).postDataJSON().leadVehicleId;
   await expect(panel.getByRole('status',{name:'Lead vehicle editor status',exact:true})).toContainText('Vehicle report saved');
   const {rows:[savedReport]}=await client.query('SELECT vehicle_id,reported_vehicle FROM crest.lead_vehicles WHERE business_id=$1 AND id=$2',[business,reportId]);
   assert.equal(savedReport.vehicle_id,null);
   assert.equal(savedReport.reported_vehicle.plate,'sample-8');
   assert.equal((await client.query('SELECT version::text FROM crest.vehicles WHERE id=$1',[vehicleId])).rows[0].version,'1');
   assert.equal((await client.query('SELECT version::text FROM crest.customers WHERE id=$1',[customerId])).rows[0].version,'1');

   const reviewRequests=[];
   page.on('request',request=>{if(/\/(contact|vehicle)-review$/.test(new URL(request.url()).pathname))reviewRequests.push(request.url());});
   // Older runtimes return the same edit context without this optional header.
   await page.route('**'+leadApi+'context',async route=>{
    const response=await route.fetch(),headers={...response.headers()};
    delete headers['x-crest-lead-match-review'];
    await route.fulfill({response,headers});
   });
   await page.goto(fixture.origin+'/leads');
   await page.getByRole('button',{name:'Add lead',exact:true}).click();
   await editor.getByLabel('Lead label',{exact:true}).fill('Fictional legacy workspace inquiry');
   await editor.getByLabel('Phone value',{exact:true}).fill(phone);
   await editor.getByRole('button',{name:'Save lead',exact:true}).click();
   await expect(page.getByRole('status',{name:'Lead editor status',exact:true})).toContainText('Lead saved');
   assert.equal(await count(),3);
   await page.goto(fixture.origin+'/leads?lead='+newId);
   await panel.getByRole('button',{name:'Load lead vehicles',exact:true}).click();
   await panel.getByRole('button',{name:'Add reported vehicle',exact:true}).click();
   await report.getByLabel('Reported vehicle label',{exact:true}).fill('Fictional legacy workspace vehicle');
   await report.getByLabel('Reported plate',{exact:true}).fill(wagon.plate);
   await report.getByRole('button',{name:'Save vehicle report',exact:true}).click();
   await expect(panel.getByRole('status',{name:'Lead vehicle editor status',exact:true})).toContainText('Vehicle report saved');
   assert.deepEqual(reviewRequests,[]);
  }finally{
   await browser?.close();
   await fixture?.close();
   if(previous===undefined)delete process.env.CREST_TEST_DATABASE_URL;
   await cluster?.close();
  }
 });
}
