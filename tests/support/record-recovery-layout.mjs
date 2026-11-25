import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

// Inspect the real pending operation. Never retain a reference or record value.
export async function reviewRecordRecovery(page,{client,business},engine,kind,reference){
 const table={customer:'customers',vehicle:'vehicles',lead:'leads',address:'addresses'}[kind];assert(table);
 const check=page.getByRole('button',{name:'Check '+kind+' save status',exact:true});await expect(check).toBeEnabled();
 // The record's disclosure is identified by its summary, not by its reference.
 const disclosure=page.locator('details.save-review-reference').filter({has:page.locator('summary').filter({hasText:/^Original save reference$/})});
 const facts=async()=>{const rows={};for(const [schema,name]of [['crest',table],['crest_private','operations'],['crest_private','audit_events']]){
  rows[name]=(await client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+name+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[business])).rows;
 }return createHash('sha256').update(JSON.stringify(rows)).digest('hex');};
 const before=await facts(),viewport=page.viewportSize(),scroll=await page.evaluate(()=>({x:scrollX,y:scrollY})),focus=await page.evaluateHandle(()=>document.activeElement),observations=[];
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);
 try{
  assert.equal(await disclosure.evaluate(node=>node.open),false);
  const summary=disclosure.locator('summary');await summary.focus();await summary.press('Enter');
  await expect(disclosure.locator('code')).toHaveText(reference);await summary.press('Enter');await expect(summary).toBeFocused();assert.equal(await disclosure.evaluate(node=>node.open),false);
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,1440]){
   await page.setViewportSize({width,height:900});await check.scrollIntoViewIfNeeded();await check.focus();await page.evaluate(()=>new Promise(requestAnimationFrame));
   assert(await check.evaluate(node=>{const r=node.getBoundingClientRect(),nav=document.querySelector('.workspace-destinations'),bottom=nav&&getComputedStyle(nav).position==='fixed'?Math.min(innerHeight,nav.getBoundingClientRect().top):innerHeight;return r.top>=0&&r.bottom<=bottom&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/record-recovery-'+kind+'-'+engine+'-'+width+'.png',mask:[page.locator('input,textarea')],maskColor:'#e8ecf5'});
   observations.push({width,focusedCheckUnobscured:true,referenceCollapsed:true});
  }
  assert.equal(requests,0,'Reference and layout inspection makes no API request');assert.equal(await facts(),before,'Record, operation and audit evidence remains unchanged');
  await writeFile('.local/review/record-recovery-'+kind+'-'+engine+'.json',JSON.stringify({kind,engine,observations,apiRequests:requests,sourcePreserved:true,exactReferenceVerified:true},null,2)+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(viewport);await page.evaluate(position=>scrollTo(position.x,position.y),scroll);await focus.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focus.dispose();}
}
