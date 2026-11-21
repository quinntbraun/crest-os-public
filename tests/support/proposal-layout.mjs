import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';
export async function captureProposalState(page,name,state){
 const viewport=page.viewportSize();await mkdir('.local/review',{recursive:true});
 try{for(const width of [320,390,768,1440,1920]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const row of await page.locator('.proposal-rows li').all()){
   const [time,party,outcome,action]=await Promise.all(['.proposal-time','.proposal-party','.proposal-outcome','button'].map(selector=>row.locator(selector).boundingBox()));assert(time&&party&&outcome&&action&&action.height>=44);
   if(width>=1000){assert(party.x>=time.x+time.width&&outcome.x>=party.x+party.width&&action.x>=outcome.x+outcome.width,'desktop aligns time, identity, outcome and action');}
   else assert(time.y+time.height<=party.y&&party.y+party.height<=outcome.y&&outcome.y+outcome.height<=action.y,'phone puts time first with one review action');
  }
  await expect(page.getByRole('link',{name:'View confirmed jobs',exact:true})).toHaveAttribute('href','/schedule');
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:'.local/review/proposal-design-'+state+'-'+name+'-'+width+'.png',fullPage:true});
 }}finally{await page.setViewportSize(viewport);}
}
