import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

export async function financePriorityFacts(fixture,kind){
 assert(['opening','statement'].includes(kind),'Use the workflow’s actual schema profile');
 const facts={};
 const tables=['crest.journal_entries','crest_private.audit_events',...(kind==='opening'
  ?['crest.opening_worksheet_revisions','crest.opening_receivable_schedule_revisions']
  :['crest.statement_match_draft_revisions'])];
 for(const table of tables)
  facts[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
 return facts;
}

// Inspect a settled, genuine task without submitting or reloading its records.
export async function reviewRecoveryActionPriority(page,region,primary,snapshot,key){
 const before=await snapshot(),viewport=page.viewportSize(),observations=[],requests=[];
 const focus=await page.evaluateHandle(()=>document.activeElement);
 const position=await page.evaluate(()=>({x:scrollX,y:scrollY}));
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};
 page.on('request',observe);
 try{
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,430,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});
   await expect(primary).toBeEnabled();await primary.scrollIntoViewIfNeeded();await primary.focus();
   const prominent=region.locator('button:visible:not(.secondary),a.primary-action:visible:not(.secondary)');
   await expect(prominent).toHaveCount(1);assert.equal(await prominent.textContent(),await primary.textContent());
   const geometry=await primary.evaluate(node=>{
    const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return {height:r.height,focusedUnobscured:document.activeElement===node&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y)),
     overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert(geometry.height>=44);assert.equal(geometry.focusedUnobscured,true);assert.equal(geometry.overflow,false);
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
   const capture='.local/review/task-priority-'+key+'-'+width+'.png';
   await page.screenshot({path:capture,fullPage:true,animations:'disabled'});observations.push({width,...geometry,capture});
  }
  assert.deepEqual(await snapshot(),before,'Inspection preserves saved business facts and audit history');
  assert.deepEqual(requests,[],'Inspection does not issue a business request');
  await writeFile('.local/review/task-priority-'+key+'.json',JSON.stringify({observations,businessRequests:requests,sourceFactsPreserved:true},null,2)+'\n');
 }finally{
  page.off('request',observe);await page.setViewportSize(viewport);
  await focus.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focus.dispose();
  await page.evaluate(p=>scrollTo({left:p.x,top:p.y,behavior:'instant'}),position);
 }
}
