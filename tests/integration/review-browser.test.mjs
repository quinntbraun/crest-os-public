// The explicit temporary memory preview, isolated from the owner's running
// sample server. This checks shared form/layout usability, never Auth or SQL.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium,webkit,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {buildReview,startReviewServer} from '../../review/server.mjs';
const assets=await buildReview('.local/review-browser');
await mkdir('.local/review/long-content',{recursive:true});
for(const [name,engine]of [['chromium',chromium],['webkit',webkit]])test(name+' explicit sample preview preserves long saved content without overflow or orphaned notices',{timeout:60000},async()=>{
 const app=await startReviewServer({port:0,assets});let browser;
 try{
  browser=await engine.launch();const context=await browser.newContext(),page=await context.newPage(),label='Synthetic '+('W'.repeat(190)),notes='Synthetic long notes é 😀\n'+('W'.repeat(1500));
  await page.goto(app.origin+'/customers');await expect(page.getByRole('banner').getByText('Sample data only',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add customer',exact:true}).click();await page.getByLabel('Customer name',{exact:true}).fill(label);await page.getByLabel('Phone value',{exact:true}).fill('+1 (555) 555-0123 ext 42');
  await page.getByText('Notes and more customer details',{exact:true}).click();await page.getByLabel('Record notes',{exact:true}).check();await page.getByLabel('Notes value',{exact:true}).fill(notes);
  await page.getByRole('button',{name:'Save customer',exact:true}).click();await page.getByRole('button',{name:'Load current customers',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();
  await expect(page.getByRole('heading',{name:'Edit customer',exact:true})).toBeFocused();await page.getByText(/^Version 1 ·/).click();await expect(page.locator('dd').filter({hasText:notes})).toBeVisible();
  for(const width of [360,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/long-content/customer-'+name+'-'+width+'.png',fullPage:true});
  }
  await page.reload();await page.getByRole('button',{name:label,exact:true}).click();await page.getByText('Notes and more customer details',{exact:true}).click();await expect(page.getByLabel('Notes value',{exact:true})).toHaveValue(notes);await expect(page.getByLabel('Phone value',{exact:true})).toHaveValue('+1 (555) 555-0123 ext 42');
  await context.close();
 }finally{try{await browser?.close();}finally{await app.close();}}
});
