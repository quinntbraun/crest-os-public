import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function captureAmendmentScope(page,engine,state){
 const viewport=page.viewportSize(),overview=page.getByRole('region',{name:'Saved scope comparison',exact:true}),observations=[];
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);
 try{
  await expect(overview).toBeVisible();await mkdir('.local/review',{recursive:true});
  for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const [original,proposed,available]=await Promise.all([overview.getByRole('region',{name:'Original scope',exact:true}).boundingBox(),overview.locator('.amendment-scope-columns > section').last().boundingBox(),page.locator('.amendment-workspace-main').evaluate(node=>({width:node.getBoundingClientRect().width,threshold:40*parseFloat(getComputedStyle(document.documentElement).fontSize)}))]);
   assert(original&&proposed);if(available.width>=available.threshold)assert(proposed.x>=original.x+original.width,'wide original and proposed scope sit side by side');else assert(proposed.y>=original.y+original.height,'narrow original and proposed scope stay sequential');
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   observations.push({width,columns:available.width>=available.threshold?2:1,originalRows:await overview.getByRole('region',{name:'Original scope',exact:true}).getByRole('listitem').count(),resultingRows:await overview.locator('.amendment-scope-columns > section').last().getByRole('listitem').count()});
   await overview.screenshot({path:'.local/review/amendment-scope-'+state+'-'+engine+'-'+width+'.png'});
   if(width===390||width===1440)await page.screenshot({path:'.local/review/amendment-scope-'+state+'-'+engine+'-'+width+'-workspace.png',fullPage:true});
  }
  const originalDocument=overview.locator('.amendment-original-document');await originalDocument.locator(':scope > summary').click();await expect(originalDocument.getByRole('article')).toBeVisible();
  for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await originalDocument.screenshot({path:'.local/review/amendment-scope-'+state+'-'+engine+'-'+width+'-original-document.png'});}
  await originalDocument.locator(':scope > summary').click();await expect(originalDocument.getByRole('article')).toBeHidden();
  assert(observations.every(row=>row.originalRows===observations[0].originalRows&&row.resultingRows===observations[0].resultingRows),'every width retains equivalent original/resulting records');assert(state==='reopened'?observations[0].originalRows===0:observations[0].originalRows>0,'original scope has the actual expected empty/populated state');assert(state==='cancelled'?observations[0].resultingRows===0:observations[0].resultingRows>0,'resulting scope has the actual expected empty/populated state');assert.equal(requests,0,'reviewing the saved scope and complete original agreement never issues an API request');
  await writeFile('.local/review/amendment-scope-'+state+'-'+engine+'-layout.json',JSON.stringify({state,engine,apiRequests:requests,observations})+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(viewport);}
}
