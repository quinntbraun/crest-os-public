import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mkdir} from 'node:fs/promises';

export async function captureProposalHistory(page,name,fixture,holdId){
 const query=()=>fixture.client.query('SELECT crest_private.appointment_hold_projection(h) AS value FROM crest.appointment_hold_versions h WHERE business_id=$1 AND hold_id=$2 ORDER BY sequence',[fixture.business,holdId]).then(result=>result.rows.map(row=>row.value));
 const original=await query(),viewport=page.viewportSize(),requests=[],observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.method());};
 assert.equal(original.length,3);assert.deepEqual(original.map(row=>row.state),['proposed','proposed','withdrawn']);
 const history=page.getByRole('region',{name:'Proposal history',exact:true}),list=history.getByRole('list',{name:'Saved proposal versions',exact:true});
 await expect(list.locator(':scope > li')).toHaveCount(3);await expect(page.getByRole('region',{name:'Appointment proposals',exact:true})).toHaveAttribute('aria-busy','false');await mkdir('.local/review',{recursive:true});page.on('request',observe);
 try{for(const width of [320,390,768,1440,1920]){
  await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
  for(const row of original){
   assert(/^[1-9][0-9]*$/.test(row.sequence));const item=list.locator('li[data-sequence="'+row.sequence+'"]');
   await expect(item.locator('summary')).toContainText('Version '+row.sequence);await expect(item.locator('.proposal-state')).toHaveText(row.state==='withdrawn'?'Withdrawn':'Unconfirmed proposal');await expect(item.locator('.proposal-history-recorded time')).toHaveAttribute('datetime',row.created_at);await expect(item.locator('.proposal-history-reason')).toHaveText(row.reason??'Initial proposal');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);await page.screenshot({path:'.local/review/proposal-history-closed-'+name+'-'+width+'.png',fullPage:true});
  for(const row of original){const item=list.locator('li[data-sequence="'+row.sequence+'"]');await item.locator('summary').click();await expect(item.locator('dl')).toBeVisible();await expect(item.locator('dl')).toContainText(row.local_start.replace('T',' '));await expect(item.locator('dl')).toContainText(row.local_end.replace('T',' '));await expect(item.locator('dl')).toContainText(row.reason??'Initial proposal');await expect(item.locator('.field-help time')).toHaveText(row.created_at);}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);await page.screenshot({path:'.local/review/proposal-history-open-'+name+'-'+width+'.png',fullPage:true});
  for(const item of await list.locator(':scope > li').all()){await item.locator('summary').focus();await page.keyboard.press('Enter');await expect(item.locator('dl')).toBeHidden();}
 }}finally{page.off('request',observe);await page.setViewportSize(viewport);}
 assert.deepEqual(requests,[],'Inspecting retained versions must not dispatch application reads or writes');assert.deepEqual(await query(),original,'Version inspection must preserve every immutable stored proposal fact');
}
