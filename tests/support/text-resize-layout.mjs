import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';

// Run only after a genuine configured screen has settled. Never save input
// values: equality uses an in-page digest and screenshots mask all form fields.
export async function reviewTextResize(page,engine,scope){
 assert(/^[a-z-]+$/.test(engine)&&/^[a-z-]+$/.test(scope));
 const originalViewport=page.viewportSize(),originalStyle=await page.locator('html').getAttribute('style');
 const fingerprint=()=>page.evaluate(async()=>{
  const values=[...document.querySelectorAll('input,select,textarea')].map(field=>[field.id,field.value,'checked' in field?field.checked:null]);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(values)));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 });
 const before=await fingerprint();await mkdir('.local/review',{recursive:true});
 try{
  for(const size of [16,32])for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'px';await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);scrollTo(0,0);},size);
   const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,inputs:[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')].filter(field=>field.getClientRects().length).map(field=>({size:parseFloat(getComputedStyle(field).fontSize),width:field.getBoundingClientRect().width}))}));
   assert(metrics.scrollWidth<=metrics.width,scope+' '+engine+' '+width+'px / '+size+'px text must reflow');
   assert(metrics.inputs.length>0,scope+' must inspect actual configured form controls');
   assert(metrics.inputs.every(input=>input.size>=size&&input.width>0),scope+' editable controls respect the requested text size');
   if(scope==='sign-in-form'){
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
    const control=await page.locator('.password-control').boundingBox(),input=await page.locator('.password-control input').boundingBox();
    assert(control&&input&&input.width>=control.width/2,'Password entry must retain at least half the available row instead of being crowded out by its visibility control');
   }
   if(size===32&&(width===320||width===768))await page.screenshot({path:'.local/review/text-resize-'+scope+'-'+engine+'-'+width+'.png',fullPage:true,mask:[page.locator('input,select,textarea')],maskColor:'#e8ecf5'});
  }
  assert.equal(await fingerprint(),before,'Resizing must preserve every entered form value and checkbox');
 }finally{
  await page.locator('html').evaluate((root,style)=>{if(style===null)root.removeAttribute('style');else root.setAttribute('style',style);},originalStyle);
  if(originalViewport)await page.setViewportSize(originalViewport);
 }
}
