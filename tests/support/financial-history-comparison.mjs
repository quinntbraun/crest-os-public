import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const tables={account:'account_versions',tax:'tax_profiles',channel:'money_channel_versions',mapping:'account_mapping_versions'};
const date=value=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
const rates={unresolved:'Unresolved',non_taxable:'Verified non-taxable',exempt:'Verified exemption policy',inclusive_single:'Verified inclusive rate'};
const opening={unknown:'Opening unknown',verified_zero:'Verified zero opening',verified:'Verified opening amount'};
const money=value=>{const cents=BigInt(value),absolute=cents<0n?-cents:cents;return (cents<0n?'-':'')+'$'+(absolute/100n).toLocaleString('en-US')+'.'+(absolute%100n).toString().padStart(2,'0');};
async function source(fixture,kind){
 assert(tables[kind]);const extra=kind==='mapping'?',a.code::text AS account_code':kind==='tax'?',v.rate::text AS rate_text':kind==='channel'?',v.opening_cents::text AS opening_text':'';
 const join=kind==='mapping'?' LEFT JOIN crest.accounts a ON (a.business_id,a.id)=(v.business_id,v.account_id)':'';
 return (await fixture.client.query('SELECT v.audit_event_id::text AS audit,v.version::text AS version,to_jsonb(v)::text AS raw'+extra+' FROM crest.'+tables[kind]+' v'+join+' WHERE v.business_id=$1 ORDER BY v.audit_event_id',[fixture.business])).rows;
}
function values(kind,row){const s=JSON.parse(row.raw);
 if(kind==='account')return [s.name,s.active?'Active':'Archived',s.reason??'No reason recorded'];
 if(kind==='tax')return [date(s.effective_from),rates[s.treatment],row.rate_text??'Not recorded',s.verification_evidence??'Not recorded',s.reason];
 if(kind==='channel')return [s.label,s.active?'Open':'Closed',date(s.effective_from),opening[s.opening_state],s.opening_on===null?'Not recorded':date(s.opening_on),row.opening_text===null?'Not recorded':money(row.opening_text),s.ownership_evidence??'Not recorded',s.opening_evidence??'Not recorded',s.reason];
 return [row.account_code===null?'Closed':'Account '+row.account_code,date(s.effective_from),s.reason];
}
export async function reviewFinancialHistoryComparison(page,fixture,history,kind,label=kind){
 const before=await source(fixture,kind),rows=history.locator(kind==='account'?'.activity-timeline > li':'.mapping-history-list > li');
 const loaded=[];for(const row of await rows.all()){
  const comparison=row.locator('.financial-history-comparison');await expect(comparison).toHaveCount(1);
  const audit=kind==='mapping'?await row.locator('.mapping-period-evidence dd').nth(3).textContent():await row.locator('.financial-history-evidence dd').last().textContent();
  const retained=before.find(value=>value.audit===audit);assert(retained);await expect(comparison).toHaveAttribute('data-version',retained.version);
  loaded.push({row,comparison,retained});
 }
 assert(loaded.length>0);const chosen=loaded.find(value=>loaded.some(other=>BigInt(other.retained.version)===BigInt(value.retained.version)-1n))??loaded[0],previous=loaded.find(value=>BigInt(value.retained.version)===BigInt(chosen.retained.version)-1n);
 const original=page.viewportSize(),scroll=await page.evaluate(()=>scrollY),focused=await page.evaluateHandle(()=>document.activeElement);
 const inputs=await history.locator('input,textarea,select').evaluateAll(nodes=>nodes.map(node=>[node.id,node.value])),requests=[];
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};page.on('request',observe);
 const outer=kind==='tax'||kind==='mapping'?chosen.row.locator(':scope > details'):null,outerOpen=outer?await outer.getAttribute('open')!==null:false,wasOpen=await chosen.comparison.getAttribute('open')!==null;
 try{
  if(outer&&!outerOpen)await outer.locator(':scope > summary').press('Enter');
  if(!wasOpen)await expect(chosen.comparison.locator('.financial-history-comparison-content')).toHaveCount(0);
  if(!wasOpen)await chosen.comparison.locator(':scope > summary').press('Enter');
  await expect(chosen.comparison.locator('.financial-history-comparison-content')).toBeVisible();
  if(previous){
   await expect(chosen.comparison).toHaveAttribute('data-previous-version',previous.retained.version);
   const earlier=values(kind,previous.retained),current=values(kind,chosen.retained);
   await expect(chosen.comparison.locator('[data-side="before"] .financial-history-compare-value')).toHaveText(earlier);
   await expect(chosen.comparison.locator('[data-side="after"] .financial-history-compare-value')).toHaveText(current);
   const fields=chosen.comparison.locator('.financial-history-compare-values > div');await expect(fields).toHaveCount(earlier.length);
   for(let index=0;index<earlier.length;index++)await expect(fields.nth(index)).toHaveAttribute('data-changed',String(earlier[index]!==current[index]));
  }else{
   await expect(chosen.comparison.locator('[data-side]')).toHaveCount(0);
   await expect(chosen.comparison).toContainText(chosen.retained.version==='1'?'This is the first saved version.':'The previous version is not in the loaded history.');
  }
  const engine=page.context().browser().browserType().name();await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width===390||width===1440)assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   const toggle=await chosen.comparison.locator(':scope > summary').boundingBox();assert(toggle&&toggle.width>=44&&toggle.height>=44);
   await chosen.comparison.screenshot({path:'.local/review/financial-history-comparison-'+label+'-'+engine+'-'+width+'.png',animations:'disabled'});
  }
  assert.equal(requests.length,0,'Comparing loaded versions must not send a business request.');
  assert.equal(JSON.stringify(await source(fixture,kind))===JSON.stringify(before),true,'Comparisons preserve exact retained source text, including financial precision.');
  assert.deepEqual(await history.locator('input,textarea,select').evaluateAll(nodes=>nodes.map(node=>[node.id,node.value])),inputs);
 }finally{
  page.off('request',observe);
  if(!wasOpen&&await chosen.comparison.getAttribute('open')!==null){await chosen.comparison.locator(':scope > summary').press('Enter');await expect(chosen.comparison.locator('.financial-history-comparison-content')).toHaveCount(0);}
  if(outer&&!outerOpen&&await outer.getAttribute('open')!==null)await outer.locator(':scope > summary').press('Enter');
  if(original)await page.setViewportSize(original);
  await focused.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focused.dispose();await page.evaluate(value=>scrollTo({top:value,behavior:'instant'}),scroll);
 }
}
