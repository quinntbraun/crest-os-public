import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {reviewFinancialHistoryComparison} from './financial-history-comparison.mjs';
const entities={account:'accounts',tax:'tax_profiles',channel:'money_channel_versions'};
const entries=(history,kind)=>history.locator(kind==='account'?'.activity-timeline > li':'.mapping-history-list > li');
async function retained(fixture,kind){assert(entities[kind]);return (await fixture.client.query(`SELECT id::text,
 to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS stamp,actor_id::text AS actor
 FROM crest_private.audit_events WHERE business_id=$1 AND entity_kind=$2`,[fixture.business,entities[kind]])).rows;}

export async function reviewFinancialHistoryRecording(page,fixture,history,kind){
 const source=await retained(fixture,kind),rows=entries(history,kind);assert(await rows.count()>0);
 const scroll=await page.evaluate(()=>scrollY),focused=await page.evaluateHandle(()=>document.activeElement),requests=[];
 const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/business/'))requests.push(request.method()+' '+new URL(request.url()).pathname);};
 page.on('request',observe);
 try{
  for(const row of await rows.all()){
   const evidence=row.locator('.financial-history-evidence'),facts=evidence.locator('dd');await expect(facts).toHaveCount(3);
   const id=await facts.nth(2).textContent(),expected=source.find(value=>value.id===id);assert(expected,'A displayed recording must match an actual retained audit event.');
   assert.equal((await facts.nth(0).textContent())===expected.stamp,true,'Exact recording precision must be retained.');
   assert.equal((await facts.nth(1).textContent())===expected.actor,true,'Recording actor must come from the actual event.');
   const time=row.locator('.financial-history-recorded time');await expect(time).toHaveAttribute('datetime',expected.stamp);
   await expect(time).toHaveText(new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'}).format(new Date(expected.stamp)));
  }
  for(const row of [rows.first(),rows.last()]){
   const disclosure=row.locator('details').filter({has:page.locator('.financial-history-evidence')}),wasOpen=await disclosure.getAttribute('open')!==null;
   if(!wasOpen)await disclosure.locator(':scope > summary').press('Enter');
   await expect(row.locator('.financial-history-evidence')).toBeVisible();
   if(!wasOpen)await disclosure.locator(':scope > summary').press('Enter');
  }
 }finally{page.off('request',observe);await focused.evaluate(node=>{if(node instanceof HTMLElement&&node.isConnected)node.focus({preventScroll:true});});await focused.dispose();await page.evaluate(value=>scrollTo({top:value,behavior:'instant'}),scroll);}
 assert.equal(requests.length,0,'Recording inspection must not refetch, save, or retire financial work.');
 await reviewFinancialHistoryComparison(page,fixture,history,kind);
}
export async function reviewFinancialHistoryRecordingCsv(csv,fixture,history,kind){
 assert(csv.includes('"Recorded in Crest (UTC)","Recorded by reference"'));
 const source=await retained(fixture,kind);for(const row of await entries(history,kind).all()){
  const id=await row.locator('.financial-history-evidence dd').last().textContent(),expected=source.find(value=>value.id===id);assert(expected);
  assert(csv.includes(JSON.stringify(expected.stamp)+','+JSON.stringify(expected.actor)),'Loaded CSV must preserve the actual recording pair.');
 }
}
