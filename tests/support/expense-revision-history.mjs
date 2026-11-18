import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function reviewExpenseRevisionHistory(page,f,name){
 const snapshot=async()=>(await f.client.query(`SELECT jsonb_build_object(
  'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.expense_id,e.revision) FROM crest.expense_revisions e WHERE e.business_id=$1),
  'events',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a WHERE a.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;
 const before=await snapshot(),history=page.getByRole('list',{name:'Retained expense revisions',exact:true});let requests=0;
 const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observed);
 try{
  const entries=history.locator(':scope > li');await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText('Revision 3: $13.99 USD');await expect(entries.nth(2)).toContainText('Revision 1: $12.99 USD');
  await expect(entries.nth(0)).toContainText('Amount retained for history');
  await expect(entries.nth(0).getByRole('region',{name:'Reason for revision 3',exact:true})).toContainText('Duplicate synthetic record');
  await history.getByText('What changed in revision 3 (1 field)',{exact:true}).press('Enter');
  const voidComparison=entries.nth(0).locator('.expense-revision-comparison');await expect(voidComparison).toContainText('Record state');await expect(voidComparison).toContainText('BeforeRecorded');await expect(voidComparison).toContainText('This revisionVoid');
  await history.getByText('What changed in revision 2 (1 field)',{exact:true}).press('Enter');
  const correction=entries.nth(1).locator('.expense-revision-comparison');await expect(correction).toContainText('$12.99 USD');await expect(correction).toContainText('$13.99 USD');
  await history.getByText('Saved values and exact evidence for revision 1',{exact:true}).press('Enter');
  const exactTime=entries.nth(2).locator('.expense-revision-evidence time');const timestamp=await exactTime.getAttribute('datetime');assert.match(timestamp,/\.\d{6}Z$/);await expect(exactTime).toHaveText(timestamp);
  await expect(entries.nth(2).locator('header time')).toHaveAttribute('title',timestamp);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);await page.screenshot({path:'.local/review/expense-revision-history-'+name+'-'+width+'.png',fullPage:true});}
  assert.equal(requests,0,'history expansion, comparisons and viewport changes make no API request');assert.deepEqual(await snapshot(),before,'history reads do not change revisions or audit records');
 }finally{page.off('request',observed);}
}
