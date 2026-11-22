import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewUnavailableRecordNavigation(page,fixture,engine){
 const observations=[];
 async function inspect(kind,state){
  const region=page.getByRole('region',{name:(kind==='customer'?'Customer':'Vehicle')+' directory',exact:true}),status=region.getByRole('status').first();
  await expect(region).toHaveAttribute('aria-busy','false');await expect(status).toBeFocused();
  await expect(region.locator('.directory-loading')).toHaveCount(0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
  await mkdir('.local/review',{recursive:true});await page.screenshot({path:'.local/review/record-unavailable-'+kind+'-'+state+'-'+engine+'.png',animations:'disabled'});observations.push({kind,state,focusedExplanation:true,width:await page.evaluate(()=>innerWidth)});return {region,status};
 }
 for(const kind of ['customer','vehicle']){
  await page.goto(fixture.origin+'/'+kind+'s?'+kind+'='+randomUUID());const status=page.getByRole('region',{name:(kind==='customer'?'Customer':'Vehicle')+' directory',exact:true}).getByRole('status').first();await expect(status).toContainText('was not found');const result=await inspect(kind,'missing');await expect(result.region.getByRole('button',{name:'Add '+kind,exact:true})).toBeVisible();await expect(result.region.getByRole('button',{name:'Save '+kind,exact:true})).toHaveCount(0);
 }
 const label='Synthetic unavailable navigation customer',created=await page.evaluate(async label=>{
  const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!session.ok)return {status:session.status,stage:'session'};const proof=await session.json(),headers={'content-type':'application/json','x-crest-csrf':proof.csrfToken},context=await fetch('/api/business/customers/context',{method:'POST',headers,body:'{}'});if(!context.ok)return {status:context.status,stage:'context'};const current=await context.json();
  const saved=await fetch('/api/business/customers/save',{method:'POST',headers,body:JSON.stringify({schemaVersion:1,operationId:crypto.randomUUID(),customerId:crypto.randomUUID(),expectedVersion:'0',recoveryEpoch:current.recoveryEpoch,displayName:label,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null})});return {status:saved.status,state:(await saved.json()).state};
 },label);assert.deepEqual(created,{status:200,state:'committed'});
 const facts=async()=>{const data={};for(const [schema,table]of [['crest','customers'],['crest','vehicles'],['crest_private','operations'],['crest_private','audit_events']])data[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;return data;},before=await facts();
 await page.setViewportSize({width:1440,height:900});await page.goto(fixture.origin+'/customers');const row=page.getByRole('button',{name:label,exact:true});await expect(row).toBeVisible();
 const cookie=(await page.context().cookies(fixture.origin)).find(cookie=>cookie.name==='__Host-crest_session');assert(cookie,'Owned synthetic browser session required');const sessionHash=createHash('sha256').update(cookie.value,'ascii').digest();
 const revoked=await fixture.client.query('UPDATE crest_private.app_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE actor_id=$1 AND token_hash=$2 AND revoked_at IS NULL',[fixture.actor,sessionHash]);assert.equal(revoked.rowCount,1);
 await row.click();const customerStatus=page.getByRole('region',{name:'Customer directory',exact:true}).getByRole('status').first();await expect(customerStatus).toContainText('could not be verified');const customer=await inspect('customer','revoked');await expect(customer.region.locator('.customer-list')).toHaveCount(0);await expect(page.getByText(label,{exact:true})).toHaveCount(0);await expect(customer.region.getByRole('link',{name:'Check sign-in',exact:true})).toHaveAttribute('href','/sign-in');await expect(customer.region.getByRole('button',{name:'Load current customers',exact:true})).toBeEnabled();
 await page.setViewportSize({width:390,height:900});await page.goto(fixture.origin+'/vehicles');const vehicleStatus=page.getByRole('status',{name:'Vehicle editor status',exact:true});await expect(vehicleStatus).toContainText('could not be verified');const vehicle=await inspect('vehicle','revoked');await expect(vehicle.region.locator('.customer-list')).toHaveCount(0);
 assert.deepEqual(await facts(),before,'Failed reads must not change customer, vehicle, operation or business audit records');await writeFile('.local/review/record-unavailable-navigation-'+engine+'.json',JSON.stringify({engine,observations,sourcePreserved:true},null,2)+'\n');
}
