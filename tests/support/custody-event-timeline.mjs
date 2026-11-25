import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
export async function reviewCustodyEventTimeline(page,panel,{fixture,expected,engine,scenario}){
 const snapshot=async()=>(await fixture.client.query(`SELECT jsonb_build_object(
  'cases',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM crest.custody_cases c WHERE c.business_id=$1),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM crest.custody_events e WHERE e.business_id=$1),
  'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM crest_private.audit_events a WHERE a.business_id=$1)) AS snapshot`,[fixture.business])).rows[0].snapshot;
 const before=await snapshot(),original=page.viewportSize(),history=panel.getByRole('region',{name:'Saved handoff timeline',exact:true}),rows=history.locator('.custody-event-timeline > li');let requests=0;
 const observed=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observed);
 try{
  await expect(rows).toHaveCount(expected.events.length);
  for(const [index,event]of expected.events.entries()){
   const row=rows.nth(index);await expect(row.locator('header strong')).toHaveText(event.action==='received'?'Received':'Released');
   await expect(row.locator('header time')).toHaveAttribute('datetime',event.effectiveAt);await expect(row.locator('header time')).toHaveAttribute('title',event.effectiveAt);
   await expect(row.locator('.custody-handoff-recorded time')).toHaveAttribute('datetime',event.recordedAt);await expect(row.getByText(event.person.displayName,{exact:true})).toBeVisible();
   if(event.missingPhotoReason!==null){await expect(row.locator('.custody-handoff-photo')).toContainText('Missing');await expect(row.locator('.custody-handoff-photo')).toContainText(event.missingPhotoReason);await expect(row.getByRole('button',{name:'View condition photo',exact:true})).toHaveCount(0);}
   else{await expect(row.locator('.custody-handoff-photo')).toContainText('Verified condition photo linked');await expect(row.getByRole('button',{name:'View condition photo',exact:true})).toBeVisible();}
   const summary=row.getByText('Exact evidence for handoff '+event.version,{exact:true});await summary.press('Enter');
   const evidence=row.locator('.custody-handoff-evidence');await expect(evidence).toContainText(event.effectiveAt);await expect(evidence).toContainText(event.recordedAt);await expect(evidence).toContainText(event.eventId);await expect(evidence).toContainText(event.authorizationConfigId);
  }
  await mkdir('.local/review',{recursive:true});for(const width of [360,390,768,1100,1440]){
   await page.setViewportSize({width,height:900});await history.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('[aria-label="Vehicle custody"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/custody-timeline-'+scenario+'-'+engine+'-'+width+'.png',fullPage:true});
  }
  assert.equal(requests,0,'handoff evidence disclosure and responsive inspection make no API request');assert.deepEqual(await snapshot(),before,'reading handoff evidence preserves cases, events and audit');
 }finally{page.off('request',observed);if(original)await page.setViewportSize(original);}
}
