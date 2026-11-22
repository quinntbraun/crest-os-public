import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const keys=['crest.direct-receipt.pending-reference.v1','crest.payment-correction.pending-reference.v1','crest.fund-application.pending-reference.v1'];
export async function reviewPaymentAccessRecovery({page,region,engine,task,loadLabel,privateLabel,message,ready,jobId,facts,allowRead}){
 await expect(region.getByLabel(privateLabel)).toBeVisible();
 await allowRead();
 const before=await facts(),context=page.context(),cookies=await context.cookies(),viewport=page.viewportSize();
 const pending=await page.evaluate(names=>names.map(name=>sessionStorage.getItem(name)),keys);
 const observations=[];
 try{
  await context.clearCookies();
  const denied=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/session'&&response.status()===400);
  await region.getByRole('button',{name:loadLabel,exact:true}).click();await denied;
  await expect(region.getByRole('status')).toHaveText(message);
  await expect(region.getByRole('status')).toBeFocused();
  await expect(region.getByLabel(privateLabel)).toHaveCount(0);
  await expect(region.getByRole('link',{name:'Review interrupted saves',exact:true})).toHaveAttribute('href','/save-review');
  const signIn=region.getByRole('link',{name:'Sign in again',exact:true});
  await expect(signIn).toHaveAttribute('href','/sign-in?returnTo=schedule&job='+jobId);
  await mkdir('.local/review',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});await signIn.focus();
   const target=await signIn.evaluate(node=>{const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {height:r.height,focusedUnobscured:document.activeElement===node&&y>=0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y))};});
   assert(target.height>=44&&target.focusedUnobscured);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('.direct-receipt').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
   const capture='.local/review/finance-payment-denied-'+task+'-'+engine+'-'+width+'.png';
   await page.screenshot({path:capture,fullPage:true,animations:'disabled'});observations.push({width,...target,capture});
  }
  assert.deepEqual(await page.evaluate(names=>names.map(name=>sessionStorage.getItem(name)),keys),pending);
  assert.deepEqual(await facts(),before,'Denied reads preserve financial and business audit facts');
 }finally{await context.addCookies(cookies);await page.setViewportSize(viewport);}
 await allowRead();await region.getByRole('button',{name:loadLabel,exact:true}).click();
 await expect(region.getByRole('status')).toHaveText(ready);
 await expect(region.getByLabel(privateLabel)).toBeVisible();
 await expect(region.getByRole('link',{name:'Sign in again',exact:true})).toHaveCount(0);
 assert.deepEqual(await facts(),before,'Reloading the task does not write financial records');
 await writeFile('.local/review/finance-payment-denied-'+task+'-'+engine+'.json',JSON.stringify({observations,actualSessionDenial:true,loadedTaskCleared:true,wholeWorkspaceClearingClaimed:false,originalReferencesPreserved:true,financialFactsPreserved:true,reloadVerified:true},null,2)+'\n');
}
