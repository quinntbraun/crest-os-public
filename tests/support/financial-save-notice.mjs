import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';

export async function reviewFinancialSaveNotice(page,status,label,returnFocus=status){
 await expect(status).toHaveAttribute('data-confirmed','true');
 await expect(returnFocus).toBeFocused();
 const viewport=page.viewportSize(),scroll=await page.evaluate(()=>scrollY),message=await status.textContent(),requests=[];
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method());};
 page.on('request',observe);
 try{
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});
   await page.emulateMedia({reducedMotion:'reduce'});
   await expect(status).toHaveText(message);
   const layout=await status.evaluate(element=>{
    const box=element.getBoundingClientRect(),css=getComputedStyle(element);
    return {left:box.left,right:box.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
     duration:css.transitionDuration,border:css.borderInlineStartWidth};
   });
   assert(layout.left>=0&&layout.right<=layout.width+1&&layout.scrollWidth<=layout.width+1,'Saved feedback must fit without horizontal scrolling.');
   assert.equal(layout.duration,'0s','Reduced motion must disable the confirmation transition.');
   assert.equal(layout.border,'3px');
   await status.scrollIntoViewIfNeeded();
   await page.screenshot({path:'.local/review/financial-save-'+label+'-'+page.context().browser().browserType().name()+'-'+width+'.png',animations:'disabled'});
  }
  assert.deepEqual(requests,[],'Reviewing saved feedback must not make business requests.');
 }finally{
  page.off('request',observe);await page.emulateMedia({reducedMotion:null});
  if(viewport)await page.setViewportSize(viewport);
  await returnFocus.focus();await page.evaluate(y=>scrollTo(0,y),scroll);
 }
}
