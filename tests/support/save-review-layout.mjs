import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function captureSaveReview(page,engine,state,widths=[390,1440]){
 const viewport=page.viewportSize(),card=page.getByRole('region',{name:'Original save review',exact:true}),observations=[];let requests=0;const track=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',track);
 try{
  await expect(card).toBeVisible();await mkdir('.local/review',{recursive:true});
  for(const width of widths){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const evidence=card.getByRole('complementary',{name:'Review evidence',exact:true});if(await evidence.count()){const [outcome,details]=await Promise.all([card.locator('.save-review-outcome').boundingBox(),evidence.boundingBox()]);assert(outcome&&details);if(width>=880)assert(details.x>=outcome.x+outcome.width);else assert(details.y>=outcome.y+outcome.height);}
   const returnLink=card.locator('.save-review-actions a').first();if(await returnLink.count())assert(await returnLink.evaluate(node=>{const reference=node.closest('.save-review-card').querySelector('.save-review-reference');return !reference||!!(node.compareDocumentPosition(reference)&Node.DOCUMENT_POSITION_FOLLOWING);}), 'safe action precedes technical reference');
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:'.local/review/save-review-outcome-'+state+'-'+engine+'-'+width+'.png',fullPage:true});observations.push({width,hasReference:await evidence.count()===1});
  }
  const picker=page.getByRole('complementary',{name:'Save selection',exact:true});await expect(picker.getByLabel('Interrupted save type',{exact:true})).toBeHidden();await picker.locator('summary').click();await expect(picker.getByLabel('Interrupted save type',{exact:true})).toBeVisible();await picker.locator('summary').click();assert.equal(requests,0,'layout and alternate-save disclosure issue no API request');
  await writeFile('.local/review/save-review-outcome-'+state+'-'+engine+'-layout.json',JSON.stringify({state,engine,apiRequests:requests,observations})+'\n');
 }finally{page.off('request',track);await page.setViewportSize(viewport);}
}
