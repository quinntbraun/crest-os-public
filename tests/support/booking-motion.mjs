import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Inspect actual controller outcomes, including an uncertain committed request.
// No replacement response, fixture-only UI state, delay or command is introduced.
export async function inspectBookingMotion(page,engine,phase){
 const status=page.locator('.booking-status'),viewport=page.viewportSize(),reports=[];
 const originalMotion=await page.evaluate(()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'reduce':'no-preference');
 let apiRequests=0;
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiRequests++;};
 page.on('request',observe);
 try{
  await expect(status).toHaveAttribute('data-phase',phase);
  await expect(status).toHaveCSS('background-color',phase==='committed'?'rgb(237, 245, 239)':'rgba(0, 0, 0, 0)');
  for(const width of [320,390,1440]){
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.setViewportSize({width,height:900});
   const normal=await status.evaluate(node=>{
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    return {width:rect.width,height:rect.height,transition:style.transitionDuration,animation:style.animationName,color:style.color,background:style.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(normal.overflow,false);
   assert.equal(normal.animation,'none','Status text and values never animate');
   assert(normal.transition.split(',').every(value=>value.trim()==='0.16s'),JSON.stringify(normal));
   const stage=page.locator('.booking-stage > section:not([hidden])').first();
   if(phase==='ready')await expect(stage).toHaveCSS('animation-duration','0.2s');
   await page.emulateMedia({reducedMotion:'reduce'});
   const reduced=await status.evaluate(node=>{
    const style=getComputedStyle(node),rect=node.getBoundingClientRect();
    return {width:rect.width,height:rect.height,transition:style.transitionDuration,animation:style.animationName};
   });
   assert.equal(reduced.transition,'0s');assert.equal(reduced.animation,'none');
   assert.equal(reduced.width,normal.width);assert.equal(reduced.height,normal.height);
   if(phase==='ready')await expect(stage).toHaveCSS('animation-name','none');
   await page.emulateMedia({reducedMotion:'no-preference'});
   if(phase==='committed'){
    const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations;
    assert.deepEqual(violations.map(v=>v.id),[]);
   }
   await mkdir('.local/review',{recursive:true});
   await page.screenshot({path:'.local/review/booking-motion-'+phase+'-'+engine+'-'+width+'.png',fullPage:true});
   reports.push({width,normal,reduced});
  }
  assert.equal(apiRequests,0,'Motion inspection makes no API request');
  await writeFile('.local/review/booking-motion-'+phase+'-'+engine+'.json',JSON.stringify({phase,reports,apiRequests},null,2)+'\n');
 }finally{page.off('request',observe);await page.emulateMedia({reducedMotion:originalMotion});await page.setViewportSize(viewport);}
}
