import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function reviewFieldSubmissionAccess({page,fixture,region,trigger,privateTarget,message,task,engine,jobId}){
 const context=page.context(),cookies=await context.cookies(),viewport=page.viewportSize();
 const notice=region.locator(':scope > [role="status"]');
 const snapshot=async()=>{
  const data={};
  for(const [schema,table] of [['crest','jobs'],['crest','travel_legs'],['crest','custody_cases'],['crest','custody_events'],['crest_private','operations'],['crest_private','audit_events']])
   data[schema+'.'+table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+schema+'.'+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  return JSON.stringify(data);
 };
 const references=()=>page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('crest.')&&k.includes('pending')).sort().map(k=>[k,sessionStorage.getItem(k)]));
 await expect(privateTarget).toBeVisible();
 const before=await snapshot(),pending=JSON.stringify(await references()),writes=[];
 const observe=request=>{if(/\/(?:pickup-trip-save|pickup-collection-save|pickup-release-save|pickup-return-failure-save|custody-save|custody-photo\/(?:reserve|upload|verify))$/.test(new URL(request.url()).pathname))writes.push(1);};
 page.on('request',observe);const observations=[];
 try{
  await context.clearCookies();
  const denied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/session'&&r.status()===400);
  await trigger.click();await denied;
  await expect(notice).toHaveText(message);await expect(notice).toBeFocused();
  await expect(privateTarget).toHaveCount(0);
  const signIn=region.getByRole('link',{name:'Sign in',exact:true});
  await expect(signIn).toHaveAttribute('href','/sign-in?returnTo=schedule&job='+jobId);
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});await signIn.scrollIntoViewIfNeeded();await signIn.focus();
   assert(await signIn.evaluate(node=>{const r=node.getBoundingClientRect();return r.height>=44&&document.activeElement===node&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.deepEqual((await new AxeBuilder({page}).include('html').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(x=>x.id),[]);
   await mkdir('.local/review',{recursive:true});const capture='.local/review/field-denied-'+task+'-'+engine+'-'+width+'.png';
   await region.screenshot({path:capture,animations:'disabled'});observations.push({width,capture});
  }
  assert.equal(JSON.stringify(await references())===pending,true,'Original references stay byte-identical');
  assert.equal(await snapshot()===before,true,'Denied pre-submission changes no business or audit facts');
  assert.equal(writes.length,0,'Session denial prevents the command from being dispatched');
 }finally{page.off('request',observe);await context.addCookies(cookies);await page.setViewportSize(viewport);}
 await writeFile('.local/review/field-denied-'+task+'-'+engine+'.json',JSON.stringify({task,engine,observations,actualSessionDenied:true,loadedTaskCleared:true,wholeWorkspaceClearingClaimed:false,noCommandDispatched:true,referencesPreserved:true,businessFactsPreserved:true},null,2)+'\n');
}
