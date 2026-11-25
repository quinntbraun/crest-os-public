import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewScheduleTaskReturn(page,fixture,jobId){
 const facts=async()=>{
  const out={};
  for(const [schema,table] of [['crest','jobs'],['crest','appointments'],['crest','schedule_reservations'],['crest','schedule_overrides'],['crest_private','operations'],['crest_private','audit_events']]){
   out[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  }
  return out;
 };
 const before=await facts(),engine=page.context().browser().browserType().name();
 const from=await page.getByLabel('From date',{exact:true}).inputValue(),through=await page.getByLabel('Through date',{exact:true}).inputValue();
 await mkdir('.local/review',{recursive:true});
 for(const width of [390,1440])for(const [buttonName,title,label] of [['Change appointment…','Change appointment','change'],['Cancel this job…','Cancel scheduled job','cancel']]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
  const origin=page.locator('[data-schedule-job="'+jobId+'"]');await origin.scrollIntoViewIfNeeded();await origin.focus();
  const scroll=await page.evaluate(()=>scrollY);
  await origin.press('Enter');
  const review=page.getByRole('region',{name:'Job review',exact:true});
  await expect(page.locator('.schedule-reader')).toHaveAttribute('aria-busy','false');
  await review.getByRole('button',{name:buttonName,exact:true}).press('Enter');
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Saved job change',exact:true})).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.job-change-status')).toHaveAttribute('data-phase','ready');
  const input=new URL(page.url()).searchParams;
  assert.equal(input.get('plannerFrom'),from);assert.equal(input.get('plannerThrough'),through);
  assert.equal(input.get('plannerView'),'month');assert.equal(input.get('plannerFocus'),jobId);
  assert.equal(input.get('plannerWidth'),String(width));assert.equal(input.get('plannerY'),String(scroll));
  await page.screenshot({path:'.local/review/schedule-context-'+label+'-'+engine+'-'+width+'.png',animations:'disabled'});
  await page.getByRole('link',{name:'Back to saved job',exact:true}).click();
  await expect(page.getByRole('region',{name:'Saved visit',exact:true})).toHaveAttribute('aria-busy','false');
  await page.getByRole('navigation',{name:'Job navigation',exact:true}).getByRole('link',{name:'Back to Schedule',exact:true}).click();
  await expect(page.getByRole('region',{name:'Saved schedule',exact:true})).toHaveAttribute('aria-busy','false');
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByLabel('From date',{exact:true})).toHaveValue(from);await expect(page.getByLabel('Through date',{exact:true})).toHaveValue(through);
  await expect(page.getByRole('region',{name:'Saved work calendar',exact:true}).getByRole('button',{name:'Month',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(origin).toBeFocused();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
  await page.screenshot({path:'.local/review/schedule-context-return-'+label+'-'+engine+'-'+width+'.png',animations:'disabled'});
 }
 await page.getByRole('region',{name:'Saved work calendar',exact:true}).getByRole('button',{name:'Next month',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved schedule',exact:true})).toHaveAttribute('aria-busy','false');
 const nextFrom=await page.getByLabel('From date',{exact:true}).inputValue();assert.notEqual(nextFrom,from);
 const arrangements=page.getByRole('navigation',{name:'Schedule tools',exact:true}).getByRole('link',{name:'Service arrangements',exact:true});
 const nextContext=new URL(await arrangements.getAttribute('href'),fixture.origin).searchParams;
 assert.equal(nextContext.get('plannerFrom'),nextFrom);
 for(const name of ['plannerFocus','plannerY','plannerWidth'])assert.equal(nextContext.has(name),false,'A new period must not carry a stale origin.');
 await arrangements.click();await expect(page.getByRole('heading',{name:'Service arrangements',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Service arrangements workspace',exact:true})).toHaveAttribute('aria-busy','false');
 await page.getByRole('navigation',{name:'Service arrangement tools',exact:true}).getByRole('link',{name:'Schedule',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved schedule',exact:true})).toHaveAttribute('aria-busy','false');
 await expect(page.getByLabel('From date',{exact:true})).toHaveValue(nextFrom);
 assert.deepEqual(await facts(),before,'Navigating between task pages must preserve business and audit source.');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
 await expect(page.locator('[data-schedule-job]')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 await expect(page.locator('[data-schedule-job]')).toHaveCount(0);
}

export async function reviewScheduleRecordReturn(page,fixture,jobId){
 const facts=async()=>{
  const out={};
  for(const [schema,table] of [['crest','jobs'],['crest','appointments'],['crest','schedule_reservations'],['crest','schedule_overrides'],['crest_private','operations'],['crest_private','audit_events']]){
   out[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  }
  return out;
 };
 const before=await facts(),engine=page.context().browser().browserType().name(),width=page.viewportSize().width;
 const from=await page.getByLabel('From date',{exact:true}).inputValue(),through=await page.getByLabel('Through date',{exact:true}).inputValue();
 await mkdir('.local/review',{recursive:true});
 for(const kind of ['customer','vehicle']){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
  const origin=page.locator('[data-schedule-job="'+jobId+'"]');await origin.scrollIntoViewIfNeeded();await origin.focus();
  const scroll=await page.evaluate(()=>scrollY);await origin.press('Enter');
  await expect(page.locator('.schedule-reader')).toHaveAttribute('aria-busy','false');
  const review=page.getByRole('region',{name:'Job review',exact:true});
  if(kind==='vehicle'){const section=review.getByRole('region',{name:'Vehicles for this job',exact:true});const details=section.locator('details').first();if(!await details.evaluate(el=>el.open))await details.locator('summary').click();}
  const record=review.getByRole('link',kind==='customer'?{name:'Open customer record',exact:true}:{name:/^Open vehicle record for /}).first();
  const assertContext=href=>{const params=new URL(href,fixture.origin).searchParams;assert.equal(params.get('plannerFrom'),from);assert.equal(params.get('plannerThrough'),through);assert.equal(params.get('plannerView'),'month');assert.equal(params.get('plannerFocus'),jobId);assert.equal(params.get('plannerY'),String(scroll));assert.equal(params.get('plannerWidth'),String(width));};
  assertContext(await record.getAttribute('href'));await record.click();
  const back=page.getByRole('link',{name:'Back to saved job',exact:true});await expect(back).toBeVisible();assertContext(await back.getAttribute('href'));
  if(kind==='customer')await page.getByRole('navigation',{name:'Customer record sections',exact:true}).getByRole('button',{name:'Visits',exact:true}).click();
  const visits=page.locator('.record-job-history');if(!await visits.evaluate(el=>el.open))await visits.locator('summary').click();
  const savedVisit=visits.locator('a[href*="job='+jobId+'"]');await expect(savedVisit).toBeVisible();assertContext(await savedVisit.getAttribute('href'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
  await page.screenshot({path:'.local/review/schedule-record-context-'+kind+'-'+engine+'-'+width+'.png',animations:'disabled'});
  await savedVisit.click();await expect(page.getByRole('region',{name:'Saved visit',exact:true})).toHaveAttribute('aria-busy','false');
  const history=page.getByRole('link',{name:kind==='customer'?'Back to customer visits':/^Back to vehicle visits/}).first();await expect(history).toBeVisible();assertContext(await history.getAttribute('href'));await history.click();
  await expect(visits.locator('summary')).toBeFocused();assertContext(await back.getAttribute('href'));await back.click();
  await expect(page.getByRole('region',{name:'Saved visit',exact:true})).toHaveAttribute('aria-busy','false');
  await page.getByRole('navigation',{name:'Job navigation',exact:true}).getByRole('link',{name:'Back to Schedule',exact:true}).click();
  await expect(page.getByRole('region',{name:'Saved schedule',exact:true})).toHaveAttribute('aria-busy','false');
  await expect(page.getByLabel('From date',{exact:true})).toHaveValue(from);await expect(page.getByLabel('Through date',{exact:true})).toHaveValue(through);
  await expect(origin).toBeFocused();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
 }
 assert.deepEqual(await facts(),before,'Record-history navigation must preserve all business and audit facts.');
}
