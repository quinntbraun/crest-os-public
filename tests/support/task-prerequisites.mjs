import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const tasks=[['booking','/schedule/new','/quotes'],['work','/schedule/work','/schedule'],['completion','/schedule/work/complete','/schedule'],['interruption','/schedule/work/interrupt','/schedule'],['cancellation','/schedule/work/cancel','/schedule'],['mileage','/schedule/mileage','/schedule'],['work-time','/schedule/work/time','/schedule']];
export async function reviewTaskPrerequisites(page,{fixture:f,engine}){
 await mkdir('.local/review',{recursive:true});
 const source=async()=>(await f.client.query(`SELECT jsonb_build_object(
  'jobs',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM crest.jobs j WHERE j.business_id=$1),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest_private.audit_events e WHERE e.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;
 const before=await source(),errors=[];const failed=()=>errors.push('page-error');page.on('pageerror',failed);
 try{
  for(const [kind,path,href]of tasks){
   await page.goto(f.origin+path);const card=page.getByRole('region',{name:'Choose where to start',exact:true});await expect(card).toBeVisible();
   const action=card.getByRole('link',{name:kind==='booking'?'Open saved quotes':'Open Schedule',exact:true});await expect(action).toHaveAttribute('href',href);
   await expect(card.getByRole('heading',{name:'What happens next',exact:true})).toBeVisible();
   for(const width of [360,390,768,1100,1440]){
    await page.setViewportSize({width,height:width<768?844:950});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width<768){const button=await action.boundingBox(),nav=await page.getByRole('navigation',{name:'Main navigation',exact:true}).boundingBox();assert(button&&nav&&button.y>=0&&button.y+button.height<=nav.y,'entry action stays above phone navigation');}
    assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
    await page.screenshot({path:'.local/review/prerequisite-'+kind+'-'+engine+'-'+width+'.png',fullPage:true});
   }
   if(engine==='chromium'&&kind==='booking'){
    const cdp=await page.context().newCDPSession(page);try{await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument'),fonts=[];for(const selector of ['.task-prerequisite h2','.task-prerequisite .primary-action']){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector}),result=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});assert(result.fonts.some(font=>font.isCustomFont&&font.familyName.startsWith('IBM Plex Sans')));fonts.push({selector,fonts:result.fonts});}await writeFile('.local/review/prerequisite-served-fonts.json',JSON.stringify(fonts,null,2));}finally{await cdp.detach();}
   }
   await action.focus();await expect(action).toBeFocused();
  }
  await page.route('**/api/business/scheduling/workspace',route=>route.abort('failed'));
  try{for(const path of ['/schedule/new','/schedule/work','/schedule/mileage']){await page.goto(f.origin+path);await expect(page.getByRole('region',{name:'Choose where to start',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:path==='/schedule/new'?'Reload current accepted scope':path==='/schedule/work'?'Reload saved work':'Reload saved trips',exact:true})).toBeVisible();}}finally{await page.unroute('**/api/business/scheduling/workspace');}
  assert.deepEqual(await source(),before,'entry guidance and denied reads do not mutate jobs or business audit evidence');assert.equal(errors.length,0,'entry navigation must not emit page errors');
 }finally{page.off('pageerror',failed);}
}
