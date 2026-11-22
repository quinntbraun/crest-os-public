import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

// Exercise the live details/review stages without submitting, replacing replies,
// or changing the workflow's existing focus and conservation assertions.
export async function reviewTaskActionPriority(page,fixture,engine,kind,phase,primary,taskSelector='form'){
 await expect(primary).toBeEnabled();
 const form=primary.locator('xpath=ancestor::form[1]');
 assert.equal(await form.count(),1,'The inspected action belongs to one task form');
 const facts=async()=>{
  const result={};
  for(const table of ['crest.jobs','crest.work_intervals','crest.travel_legs','crest_private.audit_events'])
   result[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  return result;
 };
 const values=()=>form.evaluate(node=>Array.from(node.elements).filter(field=>field.matches('input,textarea,select')).map(field=>({id:field.id,name:field.name,value:field.value,checked:field.checked})));
 const before=await facts(),fields=await values(),viewport=page.viewportSize();
 const focus=await page.evaluateHandle(()=>document.activeElement),scroll=await page.evaluate(()=>({x:scrollX,y:scrollY}));
 const observations=[],requests=[];
 const observe=request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/business/'))requests.push({method:request.method(),path});};
 page.on('request',observe);
 try{
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,430,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(async()=>{await document.fonts.ready;});
   await primary.scrollIntoViewIfNeeded();await primary.focus();
   const result=await primary.evaluate((node,selector)=>{
    const visible=element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility==='visible'&&rect.width>0&&rect.height>0;};
    const controls=Array.from(node.closest(selector).querySelectorAll('button,a.primary-action,input[type="submit"]')).filter(visible);
    const prominent=controls.filter(element=>!element.classList.contains('secondary'));
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    return {primaryCount:prominent.length,expectedIsPrimary:prominent[0]===node,primaryLabel:node.textContent.trim(),background:style.backgroundColor,color:style.color,
     focusedUnobscured:document.activeElement===node&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&node.contains(document.elementFromPoint(x,y)),
     targetHeight:rect.height,secondary:controls.filter(element=>element.classList.contains('secondary')).map(element=>({label:element.textContent.trim(),background:getComputedStyle(element).backgroundColor,height:element.getBoundingClientRect().height})),
     overflow:document.documentElement.scrollWidth>innerWidth};
   },taskSelector);
   assert.equal(result.primaryCount,1,'Only the current task stage has primary emphasis');
   assert.equal(result.expectedIsPrimary,true);assert.equal(result.focusedUnobscured,true);assert.equal(result.overflow,false);assert(result.targetHeight>=44);
   assert.equal(result.background,kind==='cancellation'&&phase==='review'?'rgb(141, 50, 52)':'rgb(32, 43, 70)');
   for(const secondary of result.secondary){assert.notEqual(secondary.background,result.background);assert(secondary.height>=44);}
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(row=>row.id),[]);
   const path='.local/review/task-priority-'+kind+'-'+phase+'-'+engine+'-'+width+'.png';
   await page.screenshot({path,fullPage:true,animations:'disabled'});observations.push({width,...result,capture:path});
  }
  assert.deepEqual(await values(),fields,'Inspection preserves all entered details');
  assert.deepEqual(await facts(),before,'Inspection preserves job, work, trip and audit history');
  assert.deepEqual(requests,[],'Priority inspection makes no business request');
  await writeFile('.local/review/task-priority-'+kind+'-'+phase+'-'+engine+'.json',JSON.stringify({kind,phase,engine,observations,businessRequests:requests,enteredDetailsPreserved:true,sourceFactsPreserved:true},null,2)+'\n');
 }finally{
  page.off('request',observe);await page.setViewportSize(viewport);
  await focus.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focus.dispose();
  await page.evaluate(position=>window.scrollTo({left:position.x,top:position.y,behavior:'instant'}),scroll);
 }
}
