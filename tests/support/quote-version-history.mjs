import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewQuoteVersionHistory(page,{engine,changedVersion=null,previousTotal=null,total=null}){
 const history=page.getByRole('region',{name:'Saved quote history',exact:true}),events=history.locator('.quote-history-timeline > li');
 const count=await events.count();assert(count>1,'A genuine saved multi-version quote is required');
 const requests=[],observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};
 const original=page.viewportSize(),inputs=await page.locator('#quote-edit input,#quote-edit textarea,#quote-edit select').evaluateAll(nodes=>nodes.map(node=>[node.id,node.value]));
 page.on('request',observe);
 try{
  for(const row of [events.first(),events.last()]){
   const recorded=row.locator('.amendment-event-time > time'),instant=await recorded.getAttribute('datetime');
   assert.match(instant,/^\d{4}-\d{2}-\d{2}T/);
   const zone=(await row.locator('.amendment-event-time').innerText()).split(' · ').at(-1);
   await expect(recorded).toHaveText(new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:zone}).format(new Date(instant)));
   const evidence=row.locator('.amendment-event-evidence'),toggle=evidence.locator('summary'),exact=evidence.locator('time');
   await expect(exact).toBeHidden();await toggle.press('Enter');await expect(toggle).toBeFocused();
   await expect(exact).toHaveAttribute('datetime',instant);await expect(exact).toHaveText(instant);await expect(exact).toBeVisible();
   const values=evidence.locator('dd');await expect(values).toHaveCount(6);
   for(const index of [2,3,4,5])await expect(values.nth(index)).toHaveText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
   await toggle.press('Enter');await expect(exact).toBeHidden();await expect(toggle).toBeFocused();
  }
  const row=changedVersion?events.filter({has:page.getByText('Version '+changedVersion+' · Draft',{exact:true})}):events.last();
  const comparison=row.locator('.quote-history-comparison'),toggle=comparison.locator(':scope > summary');
  await expect(comparison.locator('article')).toHaveCount(0);
  await toggle.press('Enter');await expect(comparison.locator('article')).toHaveCount(2);
  await expect(comparison.locator('.quote-history-comparison-version > h4').nth(0)).toHaveText(/^Before · Version [1-9][0-9]*$/);
  await expect(comparison.locator('.quote-history-comparison-version > h4').nth(1)).toHaveText(/^This version · [1-9][0-9]*$/);
  for(const article of await comparison.locator('article').all())await expect(article).toBeVisible();
  if(changedVersion){
   await expect(row.locator(':scope > header > strong')).toHaveText('Draft updated');
   await expect(row.locator('.amendment-event-amounts dd').nth(0)).toHaveText(previousTotal);
   await expect(row.locator('.amendment-event-amounts dd').nth(1)).toHaveText(total);
   await expect(comparison.locator('article').nth(0)).toContainText(previousTotal);
   await expect(comparison.locator('article').nth(1)).toContainText(total);
  }
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,430,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const boxes=await comparison.locator('article').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
   const box=await comparison.boundingBox();assert(box);
   if(box.width>=736)assert(boxes[0].right<=boxes[1].x,'wide comparison uses actual available container width');
   else assert(boxes[0].bottom<=boxes[1].y,'narrow comparison stacks saved content');
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await toggle.evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
   await page.screenshot({path:'.local/review/quote-version-comparison-'+(changedVersion?'edit-':'accepted-')+engine+'-'+width+'.png'});
  }
  await toggle.press('Enter');await expect(comparison.locator('article')).toHaveCount(0);await expect(toggle).toBeFocused();
  assert.deepEqual(await page.locator('#quote-edit input,#quote-edit textarea,#quote-edit select').evaluateAll(nodes=>nodes.map(node=>[node.id,node.value])),inputs);
  assert.deepEqual(requests,[],'Inspecting retained versions must not refetch or save business records');
 }finally{page.off('request',observe);if(original)await page.setViewportSize(original);}
}

export async function expectQuoteVersion(page,version,status,label){
 const history=page.getByRole('region',{name:'Saved quote history',exact:true});
 const row=history.locator('.quote-history-timeline > li').filter({has:page.getByText('Version '+version+' · '+status,{exact:true})});
 await expect(row).toBeVisible();
 await expect(row.locator(':scope > header > strong')).toHaveText(label);
 return row;
}
