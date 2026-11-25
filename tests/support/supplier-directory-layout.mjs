import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewSupplierDirectory(page,engine,snapshot){
 const bills=page.getByRole('region',{name:'Unpaid supplier bill drafts',exact:true});
 const entry=bills.locator('details.supplier-payable-task');
 if(await entry.count()&&await entry.getAttribute('open')!==null)await entry.locator(':scope > summary').press('Enter');
 await page.setViewportSize({width:390,height:900});
 await bills.getByRole('button',{name:'Load saved supplier bills',exact:true}).click();
 const back=bills.getByRole('button',{name:'Back to supplier drafts',exact:true});
 const directory=bills.getByRole('region',{name:'Saved supplier drafts',exact:true});
 await expect(directory.locator('article')).toHaveCount(8);
 await directory.getByRole('button',{name:'Load more supplier bills',exact:true}).click();
 await expect(directory.locator('article')).toHaveCount(9);
 await expect(directory.getByRole('button',{name:'Load more supplier bills',exact:true})).toHaveCount(0);
 const before=await snapshot(),observations=[];let requests=0;
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};
 const originalFont=await page.locator('html').evaluate(root=>({value:root.style.getPropertyValue('font-size'),priority:root.style.getPropertyPriority('font-size')}));
 page.on('request',observe);await mkdir('.local/review',{recursive:true});
 try{
  for(const size of [16,32])for(const width of [390,768,1440,1920]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'px';await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);},size);
   const room=await bills.evaluate(element=>({width:element.clientWidth,rootSize:parseFloat(getComputedStyle(document.documentElement).fontSize)}));
   const wide=room.width>=52*room.rootSize;
   const guidance=bills.getByRole('region',{name:'Supplier draft selection guidance',exact:true});
   if(wide)await expect(guidance).toBeVisible();else await expect(guidance).toBeHidden();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);
   if(width===390||width===1440)await bills.screenshot({path:'.local/review/supplier-directory-list-'+engine+'-'+width+'-'+size+'.png'});
   const row=directory.locator('article').nth(6),open=row.getByRole('button',{name:'Open supplier bill draft',exact:true});
   const supplier=await row.locator('h4').innerText();
   await open.scrollIntoViewIfNeeded();await open.focus();const scroll=await page.evaluate(()=>scrollY);
   await open.click();
   const selected=bills.getByRole('region',{name:'Selected supplier bill',exact:true});
   await expect(selected.getByRole('heading',{name:supplier,exact:true})).toBeFocused();
   await expect(bills.getByRole('form',{name:'Supplier bill draft',exact:true})).toBeHidden();
   if(wide){
    await expect(directory).toBeVisible();
    const list=await directory.boundingBox(),record=await bills.locator('.supplier-draft-inspector').boundingBox();
    assert(list&&record&&list.x+list.width<=record.x,'Wide directory remains beside the selected bill');
   }else await expect(directory).toBeHidden();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);
   if(width===390||width===1440)await bills.screenshot({path:'.local/review/supplier-directory-record-'+engine+'-'+width+'-'+size+'.png'});
   await back.click();await expect(open).toBeFocused();
   assert.equal(await page.evaluate(()=>scrollY),scroll,'Return keeps the exact directory scroll position');
   observations.push({width,textScale:size/16,wide,returnedToSameTrigger:true,returnedToSameScroll:true});
  }
  await page.locator('html').evaluate((root,font)=>{if(font.value)root.style.setProperty('font-size',font.value,font.priority);else root.style.removeProperty('font-size');},originalFont);
  await page.setViewportSize({width:390,height:900});
  const open=directory.getByRole('button',{name:'Open supplier bill draft',exact:true}).nth(6);await open.click();
  const editor=bills.locator('details.supplier-bill-editor');await editor.locator(':scope > summary').press('Enter');
  const purpose=bills.getByRole('form',{name:'Supplier bill draft',exact:true}).getByLabel('Business purpose',{exact:true});
  const saved=await purpose.inputValue();await purpose.fill('Unsaved directory return example');
  page.once('dialog',dialog=>dialog.dismiss());await back.click();
  await expect(purpose).toHaveValue('Unsaved directory return example');await expect(directory).toBeHidden();
  page.once('dialog',dialog=>dialog.accept());await back.click();
  await expect(open).toBeFocused();await open.click();
  await editor.locator(':scope > summary').press('Enter');await expect(purpose).toHaveValue(saved);
  await editor.locator(':scope > summary').press('Enter');await entry.locator(':scope > summary').press('Enter');
  await expect(back).toBeDisabled();await expect(bills.getByRole('button',{name:'Load saved supplier bills',exact:true})).toBeDisabled();
  await entry.locator(':scope > summary').press('Enter');await expect(back).toBeEnabled();
  await back.click();await expect(open).toBeFocused();
 }finally{
  page.off('request',observe);
  await page.locator('html').evaluate((root,font)=>{if(font.value)root.style.setProperty('font-size',font.value,font.priority);else root.style.removeProperty('font-size');},originalFont);
 }
 assert.equal(requests,0,'Directory selection, return and disclosure inspection must not issue application API requests');
 assert.deepEqual(await snapshot(),before,'Directory selection and return preserve all captured draft, financial, journal and audit rows');
 await writeFile('.local/review/supplier-directory-observations-'+engine+'.json',JSON.stringify({scope:'configured_supplier_directory_navigation_not_device_or_release_acceptance',observations,dirtyReturnDismissed:true,dirtyReturnAccepted:true,reviewLocksPreserved:true,inspectionRequests:requests},null,2)+'\n');
}
