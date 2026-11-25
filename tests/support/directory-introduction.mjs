import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const directories={
 customer:{label:'Customer',add:'Add customer',search:'Customer search',action:'Find a customer',desktop:768,form:'Customer editor'},
 vehicle:{label:'Vehicle',add:'Add vehicle',search:'Vehicle search',action:'Find a vehicle',desktop:768,form:'Vehicle editor'},
 service:{label:'Service',add:'Add service',search:'Find a service',action:'Find a service',desktop:1100,form:'Service editor'},
 source:{label:'Lead source',add:'Add lead source',search:'Lead source search',action:'Find a lead source',desktop:1100,form:'Lead source editor'},
};
export async function reviewDirectoryIntroduction(page,{kind,engine,state}){
 const directory=directories[kind];assert(directory);
 const original=page.viewportSize();
 await expect(page.getByRole('button',{name:directory.add,exact:true})).toBeEnabled();
 const guide=page.getByRole('region',{name:directory.label+' directory introduction',exact:true});
 await mkdir('.local/review',{recursive:true});
 for(const width of [360,390,768,1100,1440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
  if(width>=directory.desktop){
   await expect(guide).toBeVisible();
   let requests=0;
   const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests++;};
   page.on('request',observe);
   try{
    await guide.getByRole('button',{name:directory.action,exact:true}).press('Enter');
    await expect(page.getByRole('searchbox',{name:directory.search,exact:true})).toBeFocused();
    assert.equal(requests,0,'The directory guide only moves focus and sends no business request');
   }finally{page.off('request',observe);}
  }else await expect(guide).toBeHidden();
  await expect(page.getByRole('form',{name:directory.form,exact:true})).toHaveCount(0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(kind==='source'){const search=await page.getByRole('searchbox',{name:directory.search,exact:true}).boundingBox();assert(search&&search.width>=160,'Source search stays usable in a narrow directory pane');}
  const builder=new AxeBuilder({page});
  const audit=await (kind==='source'?builder:builder.withTags(['wcag2a','wcag2aa','wcag21aa'])).analyze();
  assert.deepEqual(audit.violations.map(issue=>issue.id),[]);
  await page.screenshot({path:'.local/review/directory-'+kind+'-'+state+'-'+engine+'-'+width+'.png'});
 }
 if(original)await page.setViewportSize(original);
}
