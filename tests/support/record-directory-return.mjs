import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function directoryReturnSignIn(page,fixture){
 await page.goto(fixture.origin+'/sign-in');const credentials=fixture.credentials();
 await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 const remainder=30000-Date.now()%30000,ready=Math.max(fixture.nextBrowserCodeAt,remainder<6000?Date.now()+remainder:0);if(ready>=Date.now())await delay(ready-Date.now()+250);
 await page.getByLabel('Authenticator code',{exact:true}).fill(fixture.credentials().code);const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login');await page.getByRole('button',{name:'Sign in',exact:true}).click();assert.equal((await response).status(),200);await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
}

export async function reviewRecordDirectoryReturn(page,fixture,engine,kind){
 const prefix='Synthetic return '+kind,label=index=>prefix+' '+String(index).padStart(3,'0'),plural=kind+'s';
 const seeded=await page.evaluate(async({kind,prefix})=>{
  const session=await fetch('/api/auth/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!session.ok)return {stage:'session',status:session.status};const proof=await session.json(),headers={'content-type':'application/json','x-crest-csrf':proof.csrfToken},root='/api/business/'+kind+'s/';
  const context=await fetch(root+'context',{method:'POST',headers,body:'{}'});if(!context.ok)return {stage:'context',status:context.status};const current=await context.json();if(current.writeState!=='ready')return {stage:'write_state'};
  const idPrefix=crypto.randomUUID().slice(0,24);
  for(let i=1;i<=28;i++){
   const name=prefix+' '+String(i).padStart(3,'0'),draft=kind==='customer'?{displayName:name,phone:null,email:null,contactPreference:null,outreachOptOut:false,notes:null,customerSince:null,archived:false,archiveReason:null}:{label:name,year:null,make:null,model:null,color:null,vin:null,plate:null,kind:'customer_vehicle',notes:null,archived:false,archiveReason:null};
   const response=await fetch(root+'save',{method:'POST',headers,body:JSON.stringify({schemaVersion:1,operationId:crypto.randomUUID(),[kind+'Id']:idPrefix+String(i).padStart(12,'0'),expectedVersion:'0',recoveryEpoch:current.recoveryEpoch,...draft})});if(!response.ok)return {stage:'save',index:i,status:response.status};if((await response.json()).state!=='committed')return {stage:'outcome',index:i};
  }
  return {stage:'seeded',count:28};
 },{kind,prefix});assert.deepEqual(seeded,{stage:'seeded',count:28});
 const facts=async()=>{const out={};for(const [schema,table]of [['crest','customers'],['crest','vehicles'],['crest_private','operations'],['crest_private','audit_events']])out[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;return out;},before=await facts(),observations=[];
 const position=()=>page.evaluate(()=>({y:scrollY,lists:[...document.querySelectorAll('.vehicle-results')].map(el=>el.scrollTop)}));
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});await page.goto(fixture.origin+'/'+plural);const directory=page.getByRole('region',{name:(kind==='customer'?'Customer':'Vehicle')+' directory',exact:true});
  await expect(directory).toHaveAttribute('aria-busy','false');const search=page.getByLabel(kind==='customer'?'Customer search':'Vehicle search',{exact:true});await search.fill(prefix);await page.getByRole('button',{name:'Search '+plural,exact:true}).click();await expect(directory).toHaveAttribute('aria-busy','false');
  const target=page.getByRole('button',{name:label(23),exact:true}),field=page.getByLabel(kind==='customer'?'Customer name':'Vehicle label',{exact:true}),back=page.getByRole('button',{name:kind==='customer'?/Back to customers/:'Back to vehicle list',exact:kind==='vehicle'});
  await target.scrollIntoViewIfNeeded();await target.focus();await page.evaluate(()=>document.fonts.ready);const origin=await position();assert(origin.y>200||origin.lists.some(top=>top>200),'The return must exercise a genuinely scrolled list');
  await target.press('Enter');await expect(directory).toHaveAttribute('aria-busy','false');if(kind==='vehicle')await page.getByRole('button',{name:'Edit vehicle',exact:true}).click();await expect(field).toHaveValue(label(23));const draft='Unsaved '+label(23);await field.fill(draft);
  const reads=[];const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'+plural+'/'))reads.push(new URL(request.url()).pathname);};page.on('request',observe);try{await back.click();await expect(target).toBeFocused();await expect.poll(position).toEqual(origin);assert.deepEqual(reads,[]);}finally{page.off('request',observe);}
  await expect(search).toHaveValue(prefix);await target.press('Enter');await expect(field).toHaveValue(draft);await field.fill(label(23));await back.click();await expect(target).toBeFocused();
  await page.getByRole('button',{name:kind==='customer'?'Next customer page':'Next vehicle page',exact:true}).click();await expect(directory).toHaveAttribute('aria-busy','false');const last=page.getByRole('button',{name:label(28),exact:true});await expect(last).toBeVisible();await expect(page.getByRole('button',{name:label(23),exact:true})).toHaveCount(0);
  await last.scrollIntoViewIfNeeded();await last.focus();const paged=await position();await last.press('Enter');await expect(directory).toHaveAttribute('aria-busy','false');await back.click();await expect(last).toBeFocused();await expect.poll(position).toEqual(paged);await expect(search).toHaveValue(prefix);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
  await mkdir('.local/review',{recursive:true});await page.screenshot({path:'.local/review/directory-return-'+kind+'-'+engine+'-'+width+'.png',animations:'disabled'});observations.push({width,origin,paged});
  await last.press('Enter');await expect(directory).toHaveAttribute('aria-busy','false');await page.setViewportSize({width:width===390?430:1280,height:860});await back.click();await expect(last).toBeFocused();assert(await last.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}));
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(directory.locator('.customer-list')).toHaveCount(0);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await expect(directory.locator('.customer-list')).toHaveCount(0);
 }
 assert.deepEqual(await facts(),before,'Directory navigation must not change business or audit records');await writeFile('.local/review/directory-return-'+kind+'-'+engine+'.json',JSON.stringify({kind,engine,observations,sourceConserved:true},null,2)+'\n');
}
