import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

export async function reviewAccountingReportWorkspace(page,region,{label,values,pickerExpected=true}){
 assert.equal(typeof pickerExpected,'boolean');
 const reading=region.locator('[data-report-reading]'),header=reading.locator('header');
 await expect(header).toBeFocused();
 for(const [name,value]of values){const item=reading.getByText(name,{exact:true});await expect(item).toBeVisible();await expect(item.locator('..')).toContainText(value);}
 const requests=[],observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};page.on('request',observe);
 try{
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});await header.evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
   const order=await reading.evaluate(element=>{const details=element.querySelector('header')?.nextElementSibling,form=element.parentElement?.querySelector('form');return details&&form?{summaryBottom:details.getBoundingClientRect().bottom,controlsTop:form.getBoundingClientRect().top}:null;});assert(order&&order.summaryBottom<=order.controlsTop+2,'verified snapshot precedes date controls: '+JSON.stringify(order));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   const picker=page.getByRole('navigation',{name:'Report navigation',exact:true});
   if(!pickerExpected)await expect(picker).toHaveCount(0);
   else if(width>=1100){await expect(picker).toBeVisible();assert.equal(await picker.evaluate(element=>getComputedStyle(element).position),'sticky');const left=await picker.boundingBox(),right=await region.boundingBox();assert(left&&right&&right.x>=left.x+left.width,'report reads beside the persistent picker');}
   for(const input of await region.locator('form input[type="date"]').all()){const style=await input.evaluate(element=>({size:parseFloat(getComputedStyle(element).fontSize),height:element.getBoundingClientRect().height}));assert(style.size>=16&&style.height>=44);}
   await page.screenshot({path:'.local/review/accounting-report-workspace-'+label+'-'+width+'.png',fullPage:true});await page.screenshot({path:'.local/review/accounting-report-workspace-'+label+'-viewport-'+width+'.png'});
  }
  assert.deepEqual(requests,[],'reading report context must not issue business requests');
 }finally{page.off('request',observe);}
}
