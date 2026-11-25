import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function captureSavedJob(page,engine,state){
 const viewport=page.viewportSize(),scroll=await page.evaluate(()=>window.scrollY),focus=await page.evaluateHandle(()=>document.activeElement),job=page.getByRole('article',{name:'Saved job',exact:true}),observations=[];
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);
 try{
  await expect(job).toBeVisible();await expect(job.locator('.schedule-job-vehicle')).toContainText('Vehicle · ');const visit=job.locator('.schedule-job-visit-details');await mkdir('.local/review',{recursive:true});
  for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});if(width>=880)await expect(visit.locator('.schedule-job-facts')).toBeVisible();else await expect(visit.locator('.schedule-job-facts')).toBeHidden();const initiallyOpen=await visit.getAttribute('open')!==null;assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const header=await job.locator('.schedule-job-heading').boundingBox(),action=job.locator('.schedule-job-heading .schedule-job-primary :is(button,a)').first();assert(header);let actionOffset=null;if(await action.count()){const box=await action.boundingBox();assert(box);actionOffset=box.y-header.y;if(width<=390)assert(actionOffset<360,'normal saved-job action remains near the top');}
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await job.screenshot({path:'.local/review/saved-job-layout-'+state+'-'+engine+'-'+width+'.png'});
   if(initiallyOpen){await visit.locator(':scope > summary').press('Enter');await expect(visit.locator('.schedule-job-facts')).toBeHidden();}await visit.locator(':scope > summary').press('Enter');await expect(visit.locator('.schedule-job-facts')).toBeVisible();await expect(visit.getByText('Work location',{exact:true})).toBeVisible();await expect(visit.getByText('Contact for this visit',{exact:true})).toBeVisible();assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await visit.screenshot({path:'.local/review/saved-job-layout-'+state+'-'+engine+'-'+width+'-contact.png'});if(!initiallyOpen){await visit.locator(':scope > summary').press('Enter');await expect(visit.locator('.schedule-job-facts')).toBeHidden();}observations.push({width,headerHeight:header.height,actionOffset,contactInitiallyOpen:initiallyOpen});
  }
  assert.equal(requests,0,'saved contact/location disclosure and responsive layout never fetch or write');await writeFile('.local/review/saved-job-layout-'+state+'-'+engine+'-layout.json',JSON.stringify({engine,state,apiRequests:requests,observations})+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(viewport);await focus.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});}).catch(()=>{});await focus.dispose();await page.evaluate(y=>window.scrollTo(0,y),scroll);}
}
