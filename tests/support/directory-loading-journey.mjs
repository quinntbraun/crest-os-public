import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {reviewCrmLoading} from './crm-save-feedback.mjs';

const leaveGuard=page=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});

async function reviewFirstSave(page,kind){
 const collection=kind==='address'?'customers/addresses':kind+'s',path='/api/business/'+collection+'/context',pattern='**'+path;
 let release,finished,routeError,routed=false;const gate=new Promise(resolve=>release=resolve),done=new Promise(resolve=>finished=resolve),held=page.waitForRequest(r=>new URL(r.url()).pathname===path);
 void held.catch(()=>undefined);
 const handler=async route=>{routed=true;try{await gate;await route.continue();}catch(error){routeError=error;}finally{finished();}};
 await page.route(pattern,handler,{times:1});let failure;
 const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/business/'+collection+'/save');void saved.catch(()=>undefined);
 try{
  await page.getByRole('button',{name:'Save '+kind,exact:true}).click();await held;assert.equal(await leaveGuard(page),true,'Save reverification must protect even an unchanged blank new address');
 }catch(error){failure=error;}finally{release();if(routed)await done;await page.unroute(pattern,handler);}
 if(failure)throw failure;if(routeError)throw routeError;
 const response=await saved;assert.equal(response.status(),200);assert.equal((await response.json()).state,'committed');await expect.poll(()=>leaveGuard(page)).toBe(false);
}

export async function reviewDirectoryLoadingJourney(page,fixture,engine){
 const customer=await page.evaluate(async()=>{
  const proof=await (await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json(),headers={'content-type':'application/json','x-crest-csrf':proof.csrfToken},context=await (await fetch('/api/business/customers/context',{method:'POST',headers,body:'{}'})).json(),customerId=crypto.randomUUID();
  const response=await fetch('/api/business/customers/save',{method:'POST',headers,body:JSON.stringify({schemaVersion:1,operationId:crypto.randomUUID(),customerId,expectedVersion:'0',recoveryEpoch:context.recoveryEpoch,displayName:'Synthetic directory loading customer',phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null})});return {status:response.status,state:(await response.json()).state,customerId};
 });assert.equal(customer.status,200);assert.equal(customer.state,'committed');
 for(const [kind,path,region]of [['lead','/leads','Lead directory'],['service','/services','Service directory'],['address','/addresses?customer='+customer.customerId,'Customer address directory']]){
  await reviewCrmLoading(page,engine,kind,()=>page.goto(fixture.origin+path));await expect(page.getByRole('region',{name:region,exact:true})).toHaveAttribute('aria-busy','false');await expect(page.locator('.directory-loading')).toHaveCount(0);assert.equal(await leaveGuard(page),false);
  await page.getByRole('button',{name:'Add '+kind,exact:true}).click();
  if(kind==='lead')await page.getByLabel('Lead label',{exact:true}).fill('Synthetic directory loading lead');
  if(kind==='service'){await page.getByLabel('Service code',{exact:true}).fill('synthetic-loading-'+engine);await page.getByLabel('Service name',{exact:true}).fill('Synthetic loading service');await page.getByLabel('What is included',{exact:true}).fill('Synthetic inspection only');}
  if(kind==='address'){assert.equal(await leaveGuard(page),false,'The untouched blank address is not a dirty draft');await page.getByRole('button',{name:'Review address',exact:true}).click();}
  else assert.equal(await leaveGuard(page),true,'Real unsaved input must retain its leave guard');
  await reviewFirstSave(page,kind);
 }
}
