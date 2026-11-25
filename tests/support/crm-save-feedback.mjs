import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewCrmSaveFeedback(page,fixture,engine,kind,stage){
 const confirmed=['saved','resolved'].includes(stage),status=page.locator('.customer-directory-status[data-confirmed]');
 const facts=async()=>{const out={};for(const [schema,table]of [['crest','customers'],['crest','vehicles'],['crest_private','operations'],['crest_private','audit_events']])out[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;return out;};
 const before=await facts(),viewport=page.viewportSize(),motion=await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'reduce':'no-preference'),observations=[];
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);
 try{
  await expect(status).toHaveAttribute('data-confirmed',String(confirmed));await expect(status).toBeFocused();
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);await status.scrollIntoViewIfNeeded();
   await page.emulateMedia({reducedMotion:'no-preference'});
   await expect(status).toHaveCSS('background-color',confirmed?'rgb(237, 245, 239)':'rgba(0, 0, 0, 0)');
   const read=()=>status.evaluate(node=>{const s=getComputedStyle(node),b=node.getBoundingClientRect();return {width:b.width,height:b.height,padding:s.padding,border:s.borderInlineStartWidth,background:s.backgroundColor,color:s.color,transition:s.transitionDuration,animation:s.animationName,focused:document.activeElement===node,overflow:document.documentElement.scrollWidth>innerWidth};});
   const normal=await read();assert.equal(normal.overflow,false);assert.equal(normal.focused,true);assert.equal(normal.animation,'none');assert(normal.transition.split(',').every(value=>value.trim()==='0.16s'));
   await page.emulateMedia({reducedMotion:'reduce'});const reduced=await read();assert.equal(reduced.transition,'0s');assert.equal(reduced.animation,'none');for(const key of ['width','height','padding','border','focused'])assert.equal(reduced[key],normal[key]);
   assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
   await mkdir('.local/review',{recursive:true});await page.screenshot({path:'.local/review/crm-feedback-'+kind+'-'+stage+'-'+engine+'-'+width+'.png',animations:'disabled'});
   observations.push({width,normal,reduced});
  }
  assert.equal(requests,0,'Feedback inspection must not trigger business or authentication requests');assert.deepEqual(await facts(),before,'Feedback inspection must preserve customer, vehicle, operation and audit facts');
  await writeFile('.local/review/crm-feedback-'+kind+'-'+stage+'-'+engine+'.json',JSON.stringify({kind,stage,confirmed,observations,requests},null,2)+'\n');
 }finally{page.off('request',observe);await page.emulateMedia({reducedMotion:motion});await page.setViewportSize(viewport);}
}

export async function reviewCrmLoading(page,engine,kind,enter){
 const directory={customer:['customers','Customer directory'],vehicle:['vehicles','Vehicle directory'],lead:['leads','Lead directory'],address:['customers/addresses','Customer address directory'],service:['services','Service directory']}[kind];assert(directory,'Known real directory required');
 const path='/api/business/'+directory[0]+'/context',pattern='**'+path,viewport=page.viewportSize(),motion=await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'reduce':'no-preference');
 let release,finishRoute,routeFailure,routed=false;const gate=new Promise(resolve=>{release=resolve;}),finished=new Promise(resolve=>{finishRoute=resolve;}),held=page.waitForRequest(request=>new URL(request.url()).pathname===path),handler=async route=>{routed=true;try{await gate;await route.continue();}catch(error){routeFailure=error;}finally{finishRoute();}};
 void held.catch(()=>undefined);
 await page.route(pattern,handler,{times:1});let inspectionFailure;let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};const observations=[],diagnostics=[];
 const diagnostic=response=>{const endpoint=new URL(response.url()).pathname;if(endpoint==='/api/auth/session'||/^\/api\/business\/(leads|services|customers\/addresses)\/[a-z-]+$/.test(endpoint)){diagnostics.push({endpoint,status:response.status()});if(diagnostics.length>24)diagnostics.shift();}};page.on('response',diagnostic);
 try{
  await enter();await held;const loading=page.locator('.directory-loading');await expect(loading).toBeVisible();await expect(loading).toHaveAttribute('aria-hidden','true');
  await expect(page.getByRole('region',{name:directory[1],exact:true})).toHaveAttribute('aria-busy','true');
  assert.equal(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),false,'A clean directory read must not warn of lost edits');
  page.on('request',observe);
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);await page.emulateMedia({reducedMotion:'no-preference'});
   const before=await loading.evaluate(node=>{const b=node.getBoundingClientRect(),bar=node.querySelector('.workspace-skeleton');return {width:b.width,height:b.height,animation:getComputedStyle(bar).animationName,overflow:document.documentElement.scrollWidth>innerWidth,controls:node.querySelectorAll('a,button,input,select,textarea').length};});
   assert.equal(before.animation,'workspace-skeleton-pass');assert.equal(before.overflow,false);assert.equal(before.controls,0);
   await page.emulateMedia({reducedMotion:'reduce'});const after=await loading.evaluate(node=>{const b=node.getBoundingClientRect();return {width:b.width,height:b.height,animation:getComputedStyle(node.querySelector('.workspace-skeleton')).animationName};});
   assert.equal(after.animation,'none');assert.equal(after.width,before.width);assert.equal(after.height,before.height);assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations,[]);
   await mkdir('.local/review',{recursive:true});await page.screenshot({path:'.local/review/crm-loading-'+kind+'-'+engine+'-'+width+'.png',animations:'disabled'});observations.push({width,before,after});
  }
  assert.equal(requests,0,'Loading inspection must not add or retry requests');await writeFile('.local/review/crm-loading-'+kind+'-'+engine+'.json',JSON.stringify({kind,observations,requests},null,2)+'\n');
 }catch(error){inspectionFailure=error;await mkdir('.local/review',{recursive:true});await writeFile('.local/review/crm-loading-failure-'+kind+'-'+engine+'.json',JSON.stringify({kind,path:new URL(page.url()).pathname,heading:await page.locator('h1').allTextContents(),status:await page.getByRole('status').allTextContents(),loadingCount:await page.locator('.directory-loading').count(),diagnostics},null,2)+'\n');}finally{page.off('request',observe);page.off('response',diagnostic);release();if(routed)await finished;try{await page.unroute(pattern,handler);await page.emulateMedia({reducedMotion:motion});await page.setViewportSize(viewport);}catch(error){inspectionFailure??=error;}}
 if(inspectionFailure)throw inspectionFailure;if(routeFailure)throw routeFailure;
}
