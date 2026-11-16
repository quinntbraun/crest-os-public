import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';

for(const engine of [chromium,webkit]){
 const browser=await engine.launch({timeout:15000});
 try{
  const page=await browser.newPage();
  await page.setContent('<main>Browser dependency check</main>',{timeout:10000});
  assert.equal(await page.locator('main').textContent({timeout:10000}),'Browser dependency check');
 }finally{
  await browser.close();
 }
}
