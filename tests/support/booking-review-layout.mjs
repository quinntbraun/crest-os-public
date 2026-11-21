import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function captureBookingReview(page,engine,state){
 const original=page.viewportSize(),reports=[];let requests=0;
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};
 page.on('request',observe);
 await mkdir('.local/review',{recursive:true});
 try{
  const details=page.locator('.booking-summary-details'),wasOpen=await details.evaluate(node=>node.open),toggle=details.locator(':scope > summary');
  if(!wasOpen){await toggle.focus();await page.keyboard.press('Enter');}
  await expect(details).toHaveAttribute('open','');
  await expect(details.locator('.booking-selected-work > li')).toHaveCount(2);
  await expect(details).toContainText('Explicit synthetic complimentary scope · $0.00');
  await expect(details).toContainText('Synthetic interior · $250.00');
  if(!wasOpen){await toggle.focus();await page.keyboard.press('Enter');await expect(details).not.toHaveAttribute('open','');}
  for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   const summary=page.getByRole('complementary',{name:'Visit summary',exact:true});
   await expect(summary).toContainText('Synthetic lifecycle customer');
   await expect(summary).toContainText('Visit draft · No time reserved');
   await expect(summary).toContainText('2 work items · 1 vehicle');
   const details=summary.locator('details');
   if(width<950)await expect(details).not.toHaveAttribute('open','');
   else await expect(details).toHaveAttribute('open','');
   const geometry=await summary.evaluate(node=>({height:node.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(geometry.overflow,false);
   if(width<=390)assert(geometry.height<260,'Normal phone summary must leave room for the active booking step');
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
   assert.deepEqual(violations.map(v=>v.id),[],JSON.stringify(violations.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target)}))));
   await page.screenshot({path:'.local/review/booking-review-'+state+'-'+engine+'-'+width+'.png',fullPage:true});
   reports.push({width,...geometry});
  }
  assert.equal(requests,0,'Reviewing draft scope and changing layout makes no API request');
  await writeFile('.local/review/booking-review-'+state+'-'+engine+'.json',JSON.stringify({reports,requests},null,2)+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(original);}
}

export async function exerciseUnavailableBookingReview(page,fixture,engine){
 const review=page.getByRole('region',{name:'Schedule conflict review',exact:true});
 await expect(review).toHaveAttribute('data-review-state','not-reviewed');
 const counts=async()=>Promise.all(['jobs','schedule_reservations'].map(async table=>(await fixture.client.query('SELECT count(*)::int AS n FROM crest.'+table+' WHERE business_id=$1',[fixture.business])).rows[0].n));
 const before=await counts();let release,arrived=false,routeError,observationError;const gate=new Promise(resolve=>{release=resolve;}),tasks=[];
 const finish=async route=>{const upstream=await route.fetch({maxRetries:0,maxRedirects:0,timeout:40000});assert.equal(upstream.status(),200);arrived=true;await gate;await route.fulfill({status:503,contentType:'application/json',headers:{'cache-control':'no-store'},body:JSON.stringify({error:'SCHEDULING_REQUEST_FAILED'})});};
 const route=intercept=>{const task=finish(intercept).catch(error=>{routeError=error;});tasks.push(task);return task;};
 await page.route('**/api/business/scheduling/slot-review',route);
 try{
  await page.getByRole('button',{name:'Review schedule',exact:true}).click();
  await expect(review).toHaveAttribute('data-review-state','checking');
  // The authenticating read may still be starting when busy first renders.
  // Observe disclosure I/O only after that actual upstream read is held here.
  await expect.poll(()=>arrived,{timeout:15000}).toBe(true);
  await expect(review).not.toContainText('No overlapping confirmed visits found.');
  await captureBookingReview(page,engine,'checking');
  release();await expect(review).toHaveAttribute('data-review-state','unavailable');
  await expect(review).toContainText('Schedule review could not be verified.');
  await expect(review).not.toContainText('No overlapping confirmed visits found.');
  await page.getByRole('button',{name:'Confirm and save job',exact:true}).click();
  await expect(page.getByRole('form',{name:'Confirmed visit booking',exact:true}).getByRole('alert')).toContainText('Review the current schedule');
  assert.deepEqual(await counts(),before);
  await captureBookingReview(page,engine,'unavailable');
 }catch(error){observationError=error;}
 finally{release();await Promise.all(tasks);await page.unroute('**/api/business/scheduling/slot-review',route);}
 if(routeError)throw routeError;
 if(observationError)throw observationError;
}
