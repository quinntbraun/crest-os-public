import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {expenseDollars} from '../../src/bookkeeping/expenses/expense-contract.ts';

export async function reviewSupplierRegister(page,engine,state,report,snapshot){
 const register=page.getByRole('region',{name:'Recorded supplier payables',exact:true});
 const originalViewport=page.viewportSize(),before=await snapshot();let requests=0;
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};
 await expect(register).toHaveAttribute('aria-busy','false');page.on('request',observe);await mkdir('.local/review',{recursive:true});
 try{for(const width of [320,390,768,1440,1920]){
  await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
  const summary=register.locator('.supplier-payable-summary');
  await expect(summary.locator('h3')).toHaveText('$'+expenseDollars(report.outstandingCents)+' outstanding');
  await expect(summary.locator('time')).toHaveAttribute('datetime',report.throughOn);
  await expect(summary.locator('dd')).toHaveText([String(report.openCount),String(report.rowCount)]);
  await expect(register.getByText('Showing '+report.rows.length+' of '+report.rowCount+' recorded bills through '+report.throughOn+'. The balance above covers the full register for that date.',{exact:true})).toBeVisible();
  const rows=register.locator('.supplier-payable-row');await expect(rows).toHaveCount(report.rows.length);
  for(const [index,row] of report.rows.entries()){
   const item=rows.nth(index);await expect(item.locator('h4')).toHaveText(row.vendor);
   await expect(item.locator('.supplier-payable-scope')).toHaveText('Balances through '+report.throughOn+' · USD');
   await expect(item.locator('.supplier-payable-amounts dt')).toHaveText(['Bill total','Paid','Outstanding']);
   await expect(item.locator('.supplier-payable-amounts dd')).toHaveText([row.grossCents,row.paidCents,row.remainingCents].map(cents=>'$'+expenseDollars(cents)));
   const retained=await item.locator('.supplier-payable-record').boundingBox(),payment=await item.locator(':scope > details').boundingBox();
   if(payment){assert(retained);const list=await register.locator('.supplier-payable-list').boundingBox();assert(list);if(list.width>=832){assert(retained.x+retained.width<=payment.x,'wide saved balances and payment task sit side by side');}else assert(retained.y+retained.height<=payment.y,'phone saved balances precede the payment task');}
  }
  if(state==='posted'&&width===1440){
   const fonts=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,regular:document.fonts.check('400 16px "IBM Plex Sans"'),semibold:document.fonts.check('600 16px "IBM Plex Sans"'),faces:[...document.fonts].filter(face=>face.family.includes('IBM Plex')).map(face=>({family:face.family,weight:face.weight,status:face.status}))}));
   fonts.assets=[];
   for(const file of ['IBMPlexSans-Regular.woff2','IBMPlexSans-SemiBold.woff2']){
    const response=await page.request.get(new URL('/fonts/'+file,page.url()).href),body=await response.body();
    const hash=value=>createHash('sha256').update(value).digest('hex');
    fonts.assets.push({file,status:response.status(),bytes:body.length,matchesBundled:hash(body)===hash(await readFile('public/fonts/'+file))});
   }
   if(engine==='chromium'){
    const cdp=await page.context().newCDPSession(page);fonts.platform=[];
    try{await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');
     for(const selector of ['.supplier-payable-summary h3','.supplier-payable-record h4','.supplier-payable-amounts dd','.supplier-payable-filter button']){
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});assert(nodeId);
      const {fonts:rendered}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
      fonts.platform.push({selector,fonts:rendered.map(font=>({family:font.familyName,name:font.postScriptName,custom:font.isCustomFont,glyphs:font.glyphCount}))});
     }
    }finally{await cdp.detach();}
   }
   await writeFile('.local/review/supplier-register-fonts-'+engine+'.json',JSON.stringify(fonts,null,2)+'\n');
   assert(fonts.regular&&fonts.semibold&&fonts.body.includes('IBM Plex Sans'));
   assert(fonts.assets.every(asset=>asset.status===200&&asset.matchesBundled));
   if(fonts.platform)assert(fonts.platform.every(row=>row.fonts.length&&row.fonts.every(font=>font.custom&&/^IBMPlexSans/.test(font.name))),'Supplier balance, vendor, amounts and filter action use the actual bundled font');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);
  await register.screenshot({path:'.local/review/supplier-register-'+state+'-'+engine+'-'+width+'.png'});
 }}finally{page.off('request',observe);if(originalViewport)await page.setViewportSize(originalViewport);}
 assert.equal(requests,0,'Register inspection must not submit application reads or writes');
 assert.deepEqual(await snapshot(),before,'Register inspection must preserve original financial and audit rows');
}
