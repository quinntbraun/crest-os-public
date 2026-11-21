import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

// Observe genuine saved/dirty/review states without issuing a business command.
export async function reviewSupplierDraft(page,engine,state,snapshot){
 const root=page.getByRole('region',{name:'Unpaid supplier bill drafts',exact:true});
 const originalViewport=page.viewportSize(),originalFont=await page.locator('html').evaluate(root=>({value:root.style.getPropertyValue('font-size'),priority:root.style.getPropertyPriority('font-size')}));
 const originalRootSize=await page.locator('html').evaluate(root=>getComputedStyle(root).fontSize);
 const before=await snapshot(),observations=[],findings=[];let requests=0;
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};
 page.on('request',observe);await mkdir('.local/review',{recursive:true});
 try{for(const size of [16,32])for(const width of [320,390,768,1100,1440,1920]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'px';await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);scrollTo(0,0);},size);
  const metrics=await root.evaluate(section=>{
   const controls=[...section.querySelectorAll('button,input:not([type="checkbox"]),select,summary')].filter(element=>{
    if(!element.getClientRects().length)return false;
    for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.open&&!parent.querySelector(':scope > summary')?.contains(element))return false;
    return true;
   });
   const clipped=controls.filter(element=>{const box=element.getBoundingClientRect();return box.left<0||box.right>innerWidth+1||(['BUTTON','SUMMARY'].includes(element.tagName)&&element.scrollWidth>element.clientWidth+1);}).length;
   const small=controls.filter(element=>{const box=element.getBoundingClientRect();return box.width<44||box.height<44;}).length;
   return {overflow:document.documentElement.scrollWidth>innerWidth,clippedControls:clipped,smallControls:small};
  });
  const axe=(await new AxeBuilder({page}).analyze()).violations.map(value=>value.id);
  const row={state,width,textScale:size/16,...metrics,axe};observations.push(row);
  if(metrics.overflow||metrics.clippedControls||metrics.smallControls||axe.length)findings.push(row);
  if(width===320||width===1440)await root.screenshot({path:'.local/review/supplier-draft-'+state+'-'+engine+'-'+width+'-'+size+'.png'});
 }}finally{
  page.off('request',observe);
  await page.locator('html').evaluate((root,font)=>{if(font.value)root.style.setProperty('font-size',font.value,font.priority);else root.style.removeProperty('font-size');},originalFont);
  await page.setViewportSize(originalViewport);
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
 }
 const restoredRootSize=await page.locator('html').evaluate(root=>getComputedStyle(root).fontSize);
 await writeFile('.local/review/supplier-draft-observations-'+state+'-'+engine+'.json',JSON.stringify({scope:'configured_supplier_draft_text_resize_not_browser_zoom_device_or_release_acceptance',originalFont,originalRootSize,restoredRootSize,observations,findings},null,2)+'\n');
 assert.equal(restoredRootSize,originalRootSize,'Inspection restores the original root text size');
 assert.equal(requests,0,'Supplier draft inspection must not send application API requests');
 assert.deepEqual(await snapshot(),before,'Supplier draft inspection must preserve financial, draft and audit rows');
 return findings;
}
