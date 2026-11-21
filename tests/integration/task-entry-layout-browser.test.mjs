import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {sourceExportBrowserFixture} from '../support/source-export-browser-fixture.mjs';

const entries=[
 ['booking','/schedule/new','Start with accepted work','/quotes'],
 ['work','/schedule/work','Choose the job you are working on','/schedule'],
 ['completion','/schedule/work/complete','Choose a job to finish','/schedule'],
 ['interruption','/schedule/work/interrupt','Open the trip you need to interrupt','/schedule'],
 ['cancellation','/schedule/work/cancel','Choose the visit to review','/schedule'],
 ['mileage','/schedule/mileage','Choose a saved trip','/schedule'],
 ['work-time','/schedule/work/time','Open a job’s recorded time','/schedule'],
];

for(const [name,engine] of [['chromium',chromium],['webkit',webkit]])test(name+' configured task-entry guidance preserves access, destinations and readable layout',{timeout:240000},async()=>{
 const f=await sourceExportBrowserFixture({product:true,workspace:true,catalog:true,quotes:true,quoteReview:true,quoteCommercial:true,scheduling:true,amendments:true,amendmentAcceptance:true,fieldSessions:true,jobCompletion:true,jobMileage:true,workTime:true,workBoundary:true,workStart:true,workEnd:true,mobileDeparture:true,unfulfilledCancellation:true});
 let browser;const observations=[],findings=[];
 try{
  browser=await engine.launch();const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:900}}),page=await context.newPage();
  await page.goto(f.origin+'/sign-in');const credentials=f.credentials();
  await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const snapshot=()=>f.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[f.business]).then(result=>result.rows);
  const original=await snapshot();await mkdir('.local/review',{recursive:true});
  for(const [kind,path,title,href]of entries){
   await page.goto(f.origin+path);const guide=page.getByRole('region',{name:'Choose where to start',exact:true});
   await expect(guide.getByRole('heading',{name:title,exact:true})).toBeVisible();
   const action=guide.getByRole('link',{name:kind==='booking'?'Open saved quotes':'Open Schedule',exact:true});
   await expect(action).toHaveAttribute('href',href);await expect(guide.getByRole('listitem')).toHaveCount(2);
   if(kind==='mileage')await expect(guide.getByRole('link',{name:'Open standalone travel',exact:true})).toHaveAttribute('href','/schedule/travel');
   let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);
   const style=await page.locator('html').getAttribute('style');
   try{for(const size of [16,32])for(const width of [320,390,768,1100,1440,1920]){
    await page.setViewportSize({width,height:900});await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'px';await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);scrollTo(0,0);},size);
    const metrics=await guide.evaluate(section=>{
     const box=section.getBoundingClientRect(),css=getComputedStyle(section),main=section.querySelector('.task-prerequisite-main').getBoundingClientRect(),next=section.querySelector('.task-prerequisite-guide').getBoundingClientRect(),action=section.querySelector('.primary-action'),button=action.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(action);
     const room=box.width-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-2;
     return {overflow:document.documentElement.scrollWidth>innerWidth,room,rootSize:parseFloat(getComputedStyle(document.documentElement).fontSize),stacked:main.bottom<=next.top+1,columns:main.right<=next.left,actionFits:[...range.getClientRects()].every(rect=>rect.left>=button.left-1&&rect.right<=button.right+1),target:button.width>=44&&button.height>=44};
    });
    const violations=(await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),expectedColumns=metrics.room>=44*metrics.rootSize;
    const row={kind,width,textScale:size/16,...metrics,expectedColumns,axe:violations};observations.push(row);
    if(metrics.overflow||!metrics.actionFits||!metrics.target||violations.length||!(expectedColumns?metrics.columns:metrics.stacked))findings.push(row);
    if(width===320||width===1440)await guide.screenshot({path:'.local/review/task-entry-'+kind+'-'+name+'-'+width+'-'+size+'.png'});
   }}finally{page.off('request',observe);await page.locator('html').evaluate((root,value)=>{if(value===null)root.removeAttribute('style');else root.setAttribute('style',value);},style);}
   assert.equal(requests,0,'Inspecting the entry guide must not send application API requests');
   await action.focus();await expect(action).toBeFocused();
  }
  assert.deepEqual(await snapshot(),original,'Guide inspection and navigation must not mutate business audit history');
  await writeFile('.local/review/task-entry-observations-'+name+'.json',JSON.stringify({scope:'configured_entry_guides_only_not_operational_command_or_physical_device_acceptance',observations,findings},null,2)+'\n');
  assert.equal(findings.length,0,'Task-entry layout findings are retained in the observations artifact');
 }finally{await browser?.close();await f.close();}
});
