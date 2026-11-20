import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function verifyMappingSignIn(page,fixture){
 try{await expect(page.getByRole('status')).toContainText('Signed in');}
 catch(error){console.info('MAPPING_SIGN_IN_DIAGNOSTIC '+JSON.stringify({provider:fixture.authDiagnostics(),requests:fixture.authRequestDiagnostics()}));throw error;}
}
export async function mappingBusinessSource(f){return (await f.client.query(`SELECT jsonb_build_object(
 'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM crest.account_mapping_versions v WHERE v.business_id=$1),
 'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest_private.audit_events e WHERE e.business_id=$1)) AS snapshot`,[f.business])).rows[0].snapshot;}
export async function reviewApprovalEntry(page,engine,kind){
 await mkdir('.local/review',{recursive:true});const original=page.viewportSize(),entry=page.getByRole('region',{name:'Choose an approval setting',exact:true});let reads=0;
 const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/finance-accounts/'))reads++;};page.on('request',observed);
 try{for(const width of [360,390,768,1100,1440]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});await expect(entry.getByRole('heading',{name:'Review an approval setting',exact:true})).toBeVisible();
  const selector=entry.getByRole('combobox');
  if(!await selector.isEnabled())console.info('Approval entry awaiting enabled control: '+engine+'/'+kind+'/'+width);
  await expect(selector).toBeEnabled();await selector.focus();await expect(selector).toBeFocused();
  await expect(entry.getByRole('button',{name:'Load approval settings',exact:true})).toBeDisabled();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:'.local/review/finance-'+kind+'-entry-'+engine+'-'+width+'.png',fullPage:true});}assert.equal(reads,0,'entry layout and focus make no financial request');}
 finally{page.off('request',observed);if(original)await page.setViewportSize(original);}
}
export async function assertMappingLayout(page,width){
 if(await page.locator('.category-mapping-workbench').count()){
  const detail=await page.locator('.category-mapping-detail').boundingBox(),form=await page.locator('.mapping-lookup-form').boundingBox(),history=await page.getByRole('region',{name:'Saved mapping history',exact:true}).boundingBox();assert(detail&&form&&history);
  assert(form.y+form.height<=history.y,'selected category actions precede its retained history');
  if(width>=1100){const directory=await page.locator('.category-mapping-directory').boundingBox();assert(directory&&directory.x+directory.width<=detail.x,'desktop category directory and detail remain side by side');}
  else await expect(page.locator('.category-mapping-directory')).toBeHidden();
  return;
 }
 const lookup=await page.locator('.mapping-lookup-pane').boundingBox(),history=await page.getByRole('region',{name:'Saved mapping history',exact:true}).boundingBox();assert(lookup&&history);
 if(width>=1100){const form=await page.locator('.mapping-lookup-form').boundingBox();assert(form&&Math.abs(form.y-history.y)<1,'desktop lookup and history align at the top');assert(lookup.x+lookup.width<=history.x,'desktop lookup and history remain side by side');}else assert(lookup.y+lookup.height<=history.y,'phone/tablet lookup and result precede history');
}

export async function reviewApprovalHistory(page,engine,kind,versions){
 const editor=page.getByRole('region',{name:'Mapping approvals',exact:true});
 const history=editor.getByRole('region',{name:'Saved mapping history',exact:true});
 const original=page.viewportSize();
 await expect(history.getByRole('listitem')).toHaveCount(versions);
 await expect(history.getByRole('link')).toHaveCount(0);
 const before=await editor.locator('input,textarea,select').evaluateAll(fields=>fields.map(field=>[field.id,field.value]));
 const expanded=[];
 const entries=history.locator('.mapping-period-timeline > li');
 for(const index of [...new Set([0,versions-1])]){
  const row=entries.nth(index),outer=row.locator(':scope > details'),evidence=row.locator('.mapping-period-evidence');
  const outerOpen=await outer.getAttribute('open')!==null,evidenceOpen=await evidence.getAttribute('open')!==null;
  expanded.push({outer,evidence,outerOpen,evidenceOpen});
  if(!outerOpen)await outer.locator(':scope > summary').click();
  await expect(row).toContainText('These dates show when the rule applies.');
  if(!evidenceOpen)await evidence.locator(':scope > summary').click();
  const dates=await outer.locator(':scope > summary time').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime')));
  assert(dates.length>=1&&dates.every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)));
  assert.deepEqual(await evidence.locator('time').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime'))),dates);
  for(const time of await evidence.locator('time').all())await expect(time).toHaveText(await time.getAttribute('datetime'));
  const facts=evidence.locator('dd');
  await expect(facts).toHaveCount(4);
  for(const index of [2,3])await expect(facts.nth(index)).toHaveText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
 }
 for(const width of [360,390,768,1100,1440]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0);});
  const proposal=await editor.locator('.mapping-approval-proposal').boundingBox(),retained=await history.boundingBox();
  assert(proposal&&retained);
  if(width>=1100){assert(proposal.x+proposal.width<=retained.x,'desktop history sits beside proposed effective dates');assert(Math.abs(proposal.y-retained.y)<1,'desktop history and proposal align');}
  else assert(proposal.y+proposal.height<=retained.y,'phone/tablet proposal precedes retained approvals');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
  await page.screenshot({path:'.local/review/finance-'+kind+'-embedded-history-'+engine+'-'+width+'.png',fullPage:true,animations:'disabled'});
 }
 for(const {outer,evidence,outerOpen,evidenceOpen} of expanded){
  if(!evidenceOpen)await evidence.locator(':scope > summary').click();
  if(!outerOpen)await outer.locator(':scope > summary').click();
 }
 assert.deepEqual(await editor.locator('input,textarea,select').evaluateAll(fields=>fields.map(field=>[field.id,field.value])),before,'responsive history review preserves proposal');
 if(original)await page.setViewportSize(original);
}
