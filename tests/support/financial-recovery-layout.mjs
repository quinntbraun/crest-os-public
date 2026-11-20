import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

// Inspect actual uncertain outcomes; no replacement response or recovery action.
export async function reviewFinancialRecovery(page,fixture,engine,kind,region,reference=null){
 const tables={
  account:['accounts','account_versions'],channel:['money_channel_versions'],
  mapping:['account_mapping_versions'],category:['account_mapping_versions'],
  worksheet:['opening_worksheet_revisions'],receivables:['opening_worksheet_revisions','opening_receivable_schedule_revisions'],
  supplier_upload:['supplier_bill_originals','supplier_bill_original_intents','supplier_bill_draft_revisions'],
  supplier_posting:['supplier_payables','financial_events','journal_entries','journal_lines'],
  supplier_payment:['supplier_payable_settlements','supplier_payables','money_movements','financial_events','journal_entries','journal_lines'],
  tax_pending:['tax_profiles'],tax_absent:['tax_profiles'],
 }[kind];
 assert(tables,'Known recovery workspace required');
 const facts=async()=>{const result={};for(const table of tables)result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM crest.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  result.audit=(await fixture.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[fixture.business])).rows;return result;};
 const name={account:'Check save status',channel:'Check interrupted review',mapping:'Check approval status',category:'Check approval status',worksheet:'Check original worksheet save',receivables:'Check original receivables save',supplier_upload:'Check original upload',supplier_posting:'Check original posting request',supplier_payment:'Check original posting request',tax_pending:'Check interrupted approval',tax_absent:'Check interrupted approval'}[kind];
 const check=region.getByRole('button',{name,exact:true});await expect(check).toBeEnabled();
 const before=await facts(),viewport=page.viewportSize(),focus=await page.evaluateHandle(()=>document.activeElement),observations=[];
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests++;};page.on('request',observe);
 try{
  if(reference!==null){
   const details=region.locator('details.account-original-reference');assert.equal(await details.evaluate(node=>node.open),false);
   await details.locator('summary').press('Enter');await expect(details.locator('code')).toHaveText(reference);
   await details.locator('summary').press('Enter');await expect(details.locator('summary')).toBeFocused();assert.equal(await details.evaluate(node=>node.open),false);
  }
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});await check.scrollIntoViewIfNeeded();await check.focus();
   assert(await check.evaluate(node=>{const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return y>=0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y));}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/finance-recovery-'+kind+'-'+engine+'-'+width+'.png'});observations.push({width,focusedCheckUnobscured:true});
  }
  assert.equal(requests,0,'Recovery layout and reference inspection makes no business request');assert.deepEqual(await facts(),before);
  await writeFile('.local/review/finance-recovery-'+kind+'-'+engine+'.json',JSON.stringify({kind,engine,observations,businessRequests:requests,sourcePreserved:true},null,2)+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(viewport);await focus.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focus.dispose();}
}
