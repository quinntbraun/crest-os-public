import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewAcceptedAmendmentHistory(page,f,record,{stage,engine,state,label}){
 const milestone=name=>console.log('SYNTHETIC_AMENDMENT_HISTORY_PHASE '+engine+' '+stage+' '+name);
 const events=record.history;
 assert(Array.isArray(events)&&events.length>0&&events.length<=1000);
 assert.equal(events.at(-1).after.state,state);
 const panel=page.locator('.amendment-activity'),history=panel.locator(':scope > details').first();
 if(!await history.evaluate(element=>element.open))await history.locator(':scope > summary').click();
 const firstButton=page.getByRole('button',{name:'First amendment history page',exact:true});
  milestone("first_read_started");
 const [firstRead]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/business/quotes/amendments/read'&&response.request().method()==='POST'&&response.request().postDataJSON().afterVersion==='0'),firstButton.click()]);
 assert.equal(firstRead.status(),200);await firstRead.finished();
  milestone("first_read_finished");
 await expect(page.getByRole('status')).toHaveText('Showing the first retained amendment history page.');await expect(firstButton).toBeEnabled();
 const rows=panel.locator('.amendment-timeline > li');
 for(let offset=0;offset<events.length;offset+=5){
  await expect(rows.locator(':scope > header > span')).toHaveText(events.slice(offset,offset+5).map(event=>'Version '+event.revision+' · '+event.after.state));
  if(offset+5<events.length){await page.getByRole('button',{name:'Next amendment history page',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Showing the next retained amendment history page.');await expect(firstButton).toBeEnabled();}
 }
  milestone("history_paged");
 await expect(page.getByRole('button',{name:'Next amendment history page',exact:true})).toHaveCount(0);
 const last=rows.last(),event=events.at(-1);
 await expect(last.locator(':scope > header > strong')).toHaveText(label);
 const snapshot=async()=>({revisions:(await f.client.query('SELECT to_jsonb(r)::text AS value FROM crest.quote_revisions r WHERE business_id=$1 ORDER BY id',[f.business])).rows,audits:(await f.client.query('SELECT to_jsonb(a)::text AS value FROM crest_private.audit_events a WHERE business_id=$1 ORDER BY to_jsonb(a)::text COLLATE "C"',[f.business])).rows});
  milestone("source_snapshot_started");
 const before=await snapshot(),knownRoutes=new Set(f.requests.map(row=>row.path)),observations=[];let requests=0,phase='open_evidence';const track=request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/business/')){requests++;if(observations.length<12)observations.push({route:knownRoutes.has(path)&&/^\/api\/business\/[a-z/-]{1,150}$/.test(path)?path:'other_business',phase,method:['GET','POST'].includes(request.method())?request.method():'other',resource:request.resourceType(),at:Date.now()});}};page.on('request',track);
  milestone("source_snapshot_finished");
 try{
  const confirmation=page.getByRole('region',{name:'Saved amendment acceptance',exact:true});
  if(state==='Accepted'){
   const acceptance=record.source.acceptance,zone=record.source.revision.timezone;
   assert.equal(record.source.schemaVersion,2);
   assert(acceptance&&typeof acceptance.recordedAt==='string');
   const stamps=[acceptance.request.body.confirmationEffectiveAt,acceptance.recordedAt],times=confirmation.locator(':scope > .customer-values time'),format=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:zone});
   await expect(times).toHaveCount(2);
   for(let index=0;index<stamps.length;index++){await expect(times.nth(index)).toHaveAttribute('datetime',stamps[index]);await expect(times.nth(index)).toHaveText(format.format(new Date(stamps[index])));}
   const exact=confirmation.locator(':scope > details'),wasOpen=await exact.getAttribute('open')!==null;
   if(!wasOpen)await exact.locator(':scope > summary').press('Enter');
   await expect(exact.locator('dl dd')).toHaveText([...stamps,zone]);
   for(const time of await exact.locator('time').all())await expect(time).toBeVisible();
   if(!wasOpen)await exact.locator(':scope > summary').press('Enter');
  }else{
   assert.equal(record.source.schemaVersion,1);
   await expect(confirmation).toHaveCount(0);
  }
  const evidence=last.locator('.amendment-event-evidence'),content=last.locator('.amendment-event-content');
  await evidence.locator(':scope > summary').focus();await page.keyboard.press('Enter');
  for(const value of [event.at,event.after.timezone,event.actorId,event.eventId,event.operationId,event.after.id])await expect(evidence.getByText(value,{exact:true})).toBeVisible();
  await expect(evidence.locator('time')).toHaveAttribute('datetime',event.at);
  phase='open_content';await content.locator(':scope > summary').click();await expect(content.getByRole('article')).toBeVisible();
  await mkdir('.local/review',{recursive:true});
  for(const width of [360,390,768,1100,1440]){
   phase='viewport_'+width;await page.setViewportSize({width,height:900});await page.evaluate(async()=>{await document.fonts.ready;});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  milestone("axe_started");
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(value=>value.id),[]);
  milestone("axe_finished");
   const small=await panel.locator('summary,button').evaluateAll(nodes=>nodes.filter(node=>node.checkVisibility()).filter(node=>{const box=node.getBoundingClientRect();return box.height<44||box.width<44;}).map(node=>node.tagName));
   assert.deepEqual(small,[]);
  milestone("capture_started");
   await panel.screenshot({path:'.local/review/amendment-history-'+stage+'-'+engine+'-'+width+'.png'});
   if(state==='Accepted')await confirmation.screenshot({path:'.local/review/amendment-confirmation-'+stage+'-'+engine+'-'+width+'.png'});
  milestone("capture_finished");
  }
  phase='close_content';await content.locator(':scope > summary').click();phase='close_evidence';await evidence.locator(':scope > summary').click();
  milestone("final_snapshot_started");
  const after=await snapshot(),diagnostic=JSON.stringify({stage,initialReadCompleted:true,requests,observations});
  assert.deepEqual(after,before,'retained history must preserve revisions and audit evidence '+diagnostic);
  assert.equal(requests,0,'retained history disclosure must not request business data '+diagnostic);
  milestone("inspection_complete");
 }finally{page.off('request',track);}
 await page.setViewportSize({width:390,height:900});
}
